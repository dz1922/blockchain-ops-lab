/* ============================================================
   Network plugin: Ethereum (Besu execution client, Teku beacon node and validator client)
   Mechanisms modelled:
   - 12 s slots and 32-slot epochs on the real mainnet clock; head and finality as the local beacon sees them
   - the beacon node drives the execution client over the Engine API: no engine calls, no imported blocks
   - catch-up after a beacon restart (about one hour per day of downtime); optimistic until caught up
   - one attestation duty per validator per epoch: hit or miss, reward or penalty, 1-day attester efficiency
   - validator client: loaded keys, doppelganger wait, per-key slashing protection, EIP-3076 interchange
   - one key signing on two machines in the same epoch is a double vote, and the validator is slashed
   - two layouts: a Stereum docker stack (service yamls, nightly unattended update) and a systemd stack
   ============================================================ */
(function (S) {
  'use strict';
  const C = S.C;
  const GENESIS = 1606824023, SPS = 12, SPE = 32;
  const GVR = '0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95';
  const MERGE_SLOT = 4700013, MERGE_BLOCK = 15537394;
  const SYNC_RATE = 2;                    // slots per second while catching up
  const REWARD = 14200, PENALTY = 10900;  // gwei per epoch, attestation hit / miss
  const SLASH_PENALTY = 7812500;          // gwei, initial penalty (32 ETH / 4096)
  const WINDOW = 225;                     // epochs per day
  const FAR = '18446744073709551615';
  const ST = '/mnt/ethereum-data/stereum';

  /* ---------- small helpers ---------- */
  function hx(seed, len = 64) {
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const r = S.rng(h); let s = '';
    while (s.length < len) s += Math.floor(r() * 16).toString(16);
    return s;
  }
  const netSlot = w => Math.floor((w.now() / 1000 - GENESIS) / SPS);
  const ep = s => Math.floor(s / SPE);
  const blockAt = s => MERGE_BLOCK + Math.floor((s - MERGE_SLOT) * 0.991);
  const slotOfBlock = b => MERGE_SLOT + Math.round((b - MERGE_BLOCK) / 0.991);
  const hex = n => '0x' + Math.floor(n).toString(16);
  const groupDigits = n => Math.floor(n).toLocaleString('en-US');
  const short = pk => pk.slice(2, 8) + '…' + pk.slice(-4);
  const tsAt = (w, t) => { const d = new Date(w.base + t * 1000).toISOString(); return `${d.slice(0, 10)} ${d.slice(11, 23)}`; };
  const flagVal = (args, name, dflt) => {
    const i = args.findIndex(x => x === name || x.startsWith(name + '='));
    if (i < 0) return dflt;
    if (args[i].includes('=')) return args[i].slice(args[i].indexOf('=') + 1);
    return args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
  };
  function dockerDur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 1) return 'Less than a second';
    if (sec < 60) return `${sec} seconds`;
    if (sec < 120) return 'About a minute';
    if (sec < 3600) return `${Math.floor(sec / 60)} minutes`;
    if (sec < 7200) return 'About an hour';
    if (sec < 2 * 86400) return `${Math.floor(sec / 3600)} hours`;
    return `${Math.floor(sec / 86400)} days`;
  }

  /* ---------- logging in each client's own format ---------- */
  function preLog(w, n, unit, t, level, msg) {
    const j = n.journal[unit] = n.journal[unit] || [];
    n.logSeq = (n.logSeq || 0) + 1;
    j.push({ t, level, msg, id: n.logSeq });
  }
  const tekuLine = (w, t, lvl, msg) => `${tsAt(w, t)} ${lvl.padEnd(5)} - ${msg}`;
  const besuLine = (w, t, lvl, cls, msg) => `${tsAt(w, t)}+00:00 | vert.x-worker-thread-0 | ${lvl.padEnd(5)} | ${cls} | ${msg}`;
  function tlog(w, n, c, lvl, msg) { S.log(w, n, c.name, lvl, tekuLine(w, w.t, lvl, msg)); }
  function blog(w, n, c, lvl, cls, msg) { S.log(w, n, c.name, lvl, besuLine(w, w.t, lvl, cls, msg)); }
  function sysLog(w, n, unit, msg) { S.log(w, n, unit, 'SYS', msg); }

  /* ---------- components ---------- */
  const running = c => !!c && !c.removed && c.state === 'running';
  const ready = (w, c) => running(c) && !c.hung && w.t >= c.readyAt;
  const comps = n => Object.values(n.eth.c).filter(c => c && !c.removed);
  const elServing = (w, n) => ready(w, n.eth.c.el) && !(n.eth.elWipedAt != null && w.t - n.eth.elWipedAt < 20 * 3600);
  // the beacon answers REST while it starts, but only imports once it got past startup
  const clImports = (w, n) => ready(w, n.eth.c.cl) && n.eth.c.cl.crashAt == null;
  function argsOf(w, n, c) {
    if (c.kind === 'docker') return c.cfg.args;
    const unit = S.fsRead(w, n, c.unitPath) || '';
    const m = /ExecStart=(.*(?:\\\n.*)*)/.exec(unit);
    return m ? m[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean) : [];
  }
  // Teku enables QUIC by default from 26.7.0, on UDP 9001 unless --p2p-quic-port says otherwise
  const QUIC_FROM = '26.7.0';
  function portsOf(args, version) {
    const quicSet = args.some(x => x.startsWith('--p2p-quic-port'));
    const quicOn = quicSet || S.semverCmp(version, QUIC_FROM) >= 0;
    const p = { p2p: Number(flagVal(args, '--p2p-port', '9000')), quic: quicOn ? Number(flagVal(args, '--p2p-quic-port', '9001')) : null };
    p.collide = p.quic !== null && p.p2p === p.quic;
    return p;
  }
  function clPorts(w, n, c) { return portsOf(argsOf(w, n, c), c.version); }
  function syncSvc(w, c) {
    if (!c.svc) return;
    const s = c.svc;
    s.state = c.state === 'running' ? 'active' : c.state === 'restarting' ? 'activating' : c.state === 'failed' ? 'failed' : 'inactive';
    s.since = c.since; s.pid = c.pid; s.restarts = c.restarts; s.exitStatus = c.exitCode;
  }
  function setState(w, c, st, code) {
    c.state = st; c.since = w.t;
    if (code !== undefined) c.exitCode = code;
    if (st !== 'running') c.hung = false;
    syncSvc(w, c);
  }

  /* ---------- validator keys and slashing protection ---------- */
  const vcData = n => n.eth.stack === 'stereum' ? `${ST}/teku-${n.eth.c.vc.uuid}/data` : '/var/lib/teku-vc';
  const keyDir = n => n.eth.stack === 'stereum' ? vcData(n) + '/validator/key-manager/local' : '/var/lib/teku-vc/validator-keys';
  const pwPath = (n, f) => n.eth.stack === 'stereum' ? vcData(n) + '/validator/key-manager/local-passwords/' + f.replace(/\.json$/, '.txt') : keyDir(n) + '/' + f.replace(/\.json$/, '.txt');
  const spDir = dataPath => dataPath + '/validator/slashprotection';
  const spPath = (dataPath, pk) => `${spDir(dataPath)}/${pk.replace(/^0x/, '')}.yml`;
  function keystoreJson(v) {
    return JSON.stringify({ crypto: { kdf: { function: 'scrypt', params: { dklen: 32, n: 262144, r: 8, p: 1, salt: hx(v.pubkey + 'salt') }, message: '' }, checksum: { function: 'sha256', params: {}, message: hx(v.pubkey + 'sum') }, cipher: { function: 'aes-128-ctr', params: { iv: hx(v.pubkey + 'iv', 32) }, message: hx(v.pubkey + 'ct') } }, description: '', pubkey: v.pubkey.slice(2), path: 'm/12381/3600/0/0/0', uuid: `${hx(v.pubkey, 8)}-${hx(v.pubkey + 1, 4)}-4${hx(v.pubkey + 2, 3)}-a${hx(v.pubkey + 3, 3)}-${hx(v.pubkey + 4, 12)}`, version: 4 }, null, 2) + '\n';
  }
  function keysOnDisk(w, n) {
    const dir = keyDir(n), keys = [], errs = [];
    S.fsList(n, dir).filter(f => f.endsWith('.json')).forEach(f => {
      let pk = null;
      try { pk = '0x' + JSON.parse(S.fsRead(w, n, dir + '/' + f)).pubkey; } catch (e) { errs.push(`Failed to load keystore ${dir}/${f}: invalid JSON`); return; }
      if (!S.fsGet(n, pwPath(n, f))) { errs.push(`Failed to load keystore ${dir}/${f}: password file ${pwPath(n, f)} not found`); return; }
      keys.push(pk);
    });
    return { keys, errs };
  }
  function spGet(w, n, dataPath, pk) {
    const c = S.fsRead(w, n, spPath(dataPath, pk));
    if (c === null) return null;
    const m = /lastSignedAttestationTargetEpoch:\s*(\d+)/.exec(c);
    return m ? Number(m[1]) : null;
  }
  function spSet(w, n, dataPath, pk, e) {
    S.fsWrite(n, spPath(dataPath, pk), `---\ngenesisValidatorsRoot: "${GVR}"\nlastSignedBlockSlot: 0\nlastSignedAttestationSourceEpoch: ${e - 1}\nlastSignedAttestationTargetEpoch: ${e}\n`, { owner: n.eth.stack === 'stereum' ? '2000' : 'teku' });
  }
  function interchange(w, n, dataPath, pks) {
    return { metadata: { interchange_format_version: '5', genesis_validators_root: GVR }, data: pks.map(pk => { const e = spGet(w, n, dataPath, pk); return { pubkey: pk, signed_blocks: [], signed_attestations: e === null ? [] : [{ source_epoch: String(e - 1), target_epoch: String(e) }] }; }) };
  }
  function importInterchange(w, n, dataPath, text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { return { error: 'Failed to parse slashing protection interchange file: not valid JSON' }; }
    if (!j || !j.metadata || !Array.isArray(j.data)) return { error: 'Failed to parse slashing protection interchange file: missing metadata or data' };
    if (j.metadata.genesis_validators_root !== GVR) return { error: `Genesis validators root ${j.metadata.genesis_validators_root} does not match the network (${GVR})` };
    const done = [];
    j.data.forEach(d => {
      const max = Math.max(-1, ...(d.signed_attestations || []).map(a => Number(a.target_epoch)));
      if (max < 0) return;
      const cur = spGet(w, n, dataPath, d.pubkey);
      spSet(w, n, dataPath, d.pubkey, Math.max(max, cur ?? -1));
      if (dataPath === vcData(n)) (n.eth.imported = n.eth.imported || {})[d.pubkey] = Math.max(max, cur ?? -1);
      done.push(d.pubkey);
    });
    return { done };
  }

  /* ---------- process lifecycle ---------- */
  function start(w, n, c) {
    const E = n.eth;
    c.pid = 1000 + Math.floor(w.rand() * 60000); c.startedAt = w.t; c.crashAt = null; c.nextStart = null;
    setState(w, c, 'running', 0);
    if (c.kind === 'systemd') sysLog(w, n, c.name, `Started ${c.name}.service - ${c.svc.desc}.`);
    if (c.role === 'el') {
      c.readyAt = w.t + 15;
      blog(w, n, c, 'INFO', 'Besu', `Starting Besu ${c.version}`);
      blog(w, n, c, 'INFO', 'Runner', 'Ethereum main loop is up.');
      if (E.elWipedAt != null) blog(w, n, c, 'INFO', 'SnapSyncDownloader', 'Starting snap sync from an empty database');
    } else if (c.role === 'cl') {
      const p = clPorts(w, n, c);
      c.readyAt = w.t + 20;
      tlog(w, n, c, 'INFO', `Teku version: teku/v${c.version}/linux-x86_64/-eclipseadoptium-openjdk64bit-java-21`);
      tlog(w, n, c, 'INFO', `Configuration | Network: mainnet, Storage Mode: PRUNE, P2P port: ${p.p2p}, QUIC port: ${p.quic === null ? 'disabled' : p.quic}`);
      if (p.collide) { c.crashAt = w.t + 38; return; }
      if (E.cpSync) { E.cpSync = false; E.clHead = Math.max(E.clHead, (ep(netSlot(w)) - 2) * SPE); tlog(w, n, c, 'INFO', 'Database is empty: initializing from checkpoint state at https://beaconstate.info'); }
      tlog(w, n, c, 'INFO', `Loaded latest finalized state from database at epoch ${ep(Math.floor(E.clHead)) - 2}`);
      if (netSlot(w) - Math.floor(E.clHead) > 64) S.lesson(w, 'catchup', S.LL('重启之后的追赶', 'Catching up after a restart'), S.LL('beacon 节点从数据库中保存的 head 开始追赶，大约每停机一天需要一小时。追赶期间节点处于 optimistic 状态，验证者不出证明。各种落后告警会同时出现，追平后自行恢复。这段时间不要再重启任何组件。', 'The beacon node resumes from the head stored in its database and needs about one hour per day of downtime to catch up. While it catches up it is optimistic and the validator does not attest. All the lag alerts fire together and clear on their own once it is in sync. Do not restart anything while it catches up.'));
    } else if (c.role === 'vc') {
      c.readyAt = w.t + 10;
      const { keys, errs } = keysOnDisk(w, n);
      if (errs.length) {
        errs.forEach(e => tlog(w, n, c, 'FATAL', e));
        tlog(w, n, c, 'FATAL', 'Exiting due to fatal error');
        setState(w, c, c.kind === 'docker' ? 'restarting' : 'failed', 2); c.restarts++; c.nextStart = c.kind === 'docker' ? w.t + 8 : null;
        return;
      }
      c.keys = keys;
      tlog(w, n, c, 'INFO', `Teku version: teku/v${c.version}/linux-x86_64/-eclipseadoptium-openjdk64bit-java-21`);
      tlog(w, n, c, keys.length ? 'INFO' : 'WARN', keys.length ? `Loaded ${keys.length} Validators: ${keys.map(k => k.slice(2, 8)).join(', ')}` : 'No validators loaded. The validator client will not perform any duties');
      if (c.doppel && keys.length) {
        c.dopEnd = (ep(netSlot(w)) + 3) * SPE; c.dopSeen = false;
        tlog(w, n, c, 'INFO', `Starting doppelganger detection for public keys: ${keys.map(k => k.slice(0, 10) + '…').join(', ')}. Duties will not be performed for at least 2 epochs`);
      } else c.dopEnd = null;
      keys.forEach(pk => {
        const v = val(w, pk);
        if (v && v.everSigned && spGet(w, n, vcData(n), pk) === null) S.flag(w, 'no_interchange');
      });
    } else c.readyAt = w.t + 3;
  }
  function stop(w, n, c, code = 143) {
    if (running(c)) {
      if (c.role === 'cl' || c.role === 'vc') tlog(w, n, c, 'INFO', 'Shutting down');
      if (c.role === 'el') blog(w, n, c, 'INFO', 'Runner', 'Stopping Besu');
    }
    c.keys = [];
    setState(w, c, c.kind === 'docker' ? 'exited' : 'inactive', code);
    if (c.kind === 'systemd') sysLog(w, n, c.name, `${c.name}.service: Deactivated successfully.`);
  }
  function restart(w, n, c) { if (c.kind === 'systemd') sysLog(w, n, c.name, `Stopping ${c.name}.service - ${c.svc.desc}...`); stop(w, n, c); start(w, n, c); }
  function crashCl(w, n, c) {
    const p = clPorts(w, n, c);
    tlog(w, n, c, 'INFO', `Starting libp2p network on tcp/${p.p2p}, quic/udp/${p.quic}`);
    tlog(w, n, c, 'ERROR', `Failed to start discovery service on udp/${p.p2p}`);
    S.log(w, n, c.name, 'ERROR', `java.net.BindException: Address already in use\n\tat java.base/sun.nio.ch.Net.bind0(Native Method)\n\tat io.netty.channel.socket.nio.NioDatagramChannel.doBind(NioDatagramChannel.java:201)\n\tat org.ethereum.beacon.discovery.network.NettyDiscoveryServerImpl.start(NettyDiscoveryServerImpl.java:72)`);
    tlog(w, n, c, 'FATAL', 'Exiting due to fatal error in discovery service');
    c.restarts++; c.crashAt = null; c.nextStart = w.t + 6;
    setState(w, c, c.kind === 'docker' ? 'restarting' : 'activating', 2);
    if (c.kind === 'systemd') { sysLog(w, n, c.name, `${c.name}.service: Main process exited, code=exited, status=2/INVALIDARGUMENT`); }
  }

  /* ---------- Stereum service yaml ---------- */
  const svcYamlPath = c => `/etc/stereum/services/${c.uuid}.yaml`;
  function svcYaml(c) {
    return `id: ${c.uuid}\nservice: ${c.svcType}\nimage: ${c.cfg.image}\nnetwork: stereum\nuser: "2000"\nautoupdate: true\nports:\n${c.ports.length ? c.ports.map(p => `  - ${p}`).join('\n') : '  []'}\nvolumes:\n${c.vols.map(v => `  - ${v}`).join('\n')}\ncommand:\n${c.cfg.args.map(a => `  - ${a}`).join('\n')}\n`;
  }
  function parseSvcYaml(txt) {
    txt = String(txt || '').replace(/\\n/g, '\n');
    const img = /^image:\s*(\S+)/m.exec(txt);
    const lines = txt.split('\n'); const i = lines.findIndex(l => /^command:\s*$/.test(l)); const args = [];
    if (i >= 0) for (let j = i + 1; j < lines.length; j++) {
      const m = /^\s*-\s+(.*?)\s*$/.exec(lines[j]);
      if (m) args.push(m[1].replace(/^["']|["']$/g, ''));
      else if (lines[j].trim() === '') continue;
      else break;
    }
    return { image: img ? img[1] : null, args: args.flatMap(a => a.split(/\s+(?=--)/)) };
  }
  function recreate(w, n, c) {
    const y = S.fsRead(w, n, svcYamlPath(c));
    if (y === null) return { error: `no service definition ${svcYamlPath(c)}` };
    const cfg = parseSvcYaml(y);
    if (!cfg.image) return { error: `${svcYamlPath(c)}: no image` };
    if (running(c)) stop(w, n, c);
    c.cfg = cfg; c.version = (cfg.image.split(':')[1] || 'latest').replace(/^v/, '');
    c.removed = false; c.restarts = 0; c.createdAt = w.t; c.id = hx(c.name + w.t, 64);
    if (c.role === 'vc') S.flag(w, 'vc_restart');
    start(w, n, c);
    if (c.role === 'cl') { const p = clPorts(w, n, c); if (!p.collide) S.lesson(w, 'quic', S.LL('客户端升级改变了默认值', 'An upgrade changed a default'), S.LL('新版本默认启用 QUIC，并且默认使用 UDP 9001。这台节点用 <code>--p2p-port=9001</code> 自定义了 P2P 端口，两个监听器抢同一个端口，discovery 绑定失败后进程退出。显式写上 <code>--p2p-quic-port</code> 可以消除冲突。修改要写进服务定义并重建容器，以后的自动升级才会保留它。', 'The new release enables QUIC by default on UDP 9001. This node sets a custom <code>--p2p-port=9001</code>, so two listeners want the same port, discovery fails to bind, and the process exits. Pinning <code>--p2p-quic-port</code> removes the collision. The change belongs in the service definition, followed by a container recreate, so later automatic updates keep it.')); }
    return { ok: true };
  }

  /* ---------- world setup ---------- */
  function stereumHost(w, sp) {
    const ids = { el: '3f6c2a10-8d4e-4b7a-9c1d-2e5f7a9b0c14', cl: '9b2e7d41-5a3c-4f8e-b6d2-1c0a9e8f7d23', vc: 'c4a81f2e-6b9d-4e3a-8f7c-5d2b1a0e9c36', mev: '71d0e5b8-2c4f-4a9e-9b3d-8e6f1c2a5d47', prom: 'e2f49c63-0a7b-4d1e-8c5f-3b9a6d2e1f58', nexp: '5a8d3b16-9e2c-4f7a-b1d4-6c0e8f3a2b69' };
    const nm = k => `stereum-${ids[k]}`;
    const jwt = `${ST}/besu-${ids.el}/engine.jwt`;
    const v = sp.versions;
    const defs = [
      { key: 'el', role: 'el', svcType: 'BesuService', image: `hyperledger/besu:${v.besu}`, entry: '/opt/besu/bin/besu', ports: ['0.0.0.0:30303:30303/tcp', '0.0.0.0:30303:30303/udp', '127.0.0.1:8545:8545/tcp'], vols: [`${ST}/besu-${ids.el}/data:/opt/app/data`, `${jwt}:/engine.jwt`],
        args: ['--network=mainnet', '--data-path=/opt/app/data', '--data-storage-format=BONSAI', '--sync-mode=SNAP', '--p2p-port=30303', '--rpc-http-enabled=true', '--rpc-http-host=0.0.0.0', '--rpc-http-port=8545', '--rpc-http-api=ETH,NET,WEB3', '--host-allowlist=*', '--engine-rpc-port=8551', '--engine-host-allowlist=*', '--engine-jwt-secret=/engine.jwt', '--metrics-enabled=true', '--metrics-host=0.0.0.0', '--metrics-port=9545'] },
      { key: 'cl', role: 'cl', svcType: 'TekuBeaconService', image: `consensys/teku:${v.teku}`, entry: '/opt/teku/bin/teku', ports: ['0.0.0.0:9001:9001/tcp', '0.0.0.0:9001:9001/udp', ...(sp.quicPinned ? ['0.0.0.0:9002:9002/udp'] : []), '127.0.0.1:5051:5051/tcp'], vols: [`${ST}/teku-${ids.cl}/data:/opt/app/data`, `${jwt}:/engine.jwt`],
        args: ['--network=mainnet', '--data-path=/opt/app/data', '--data-storage-mode=prune', '--p2p-port=9001', ...(sp.quicPinned ? ['--p2p-quic-port=9002'] : []), '--p2p-peer-upper-bound=100', `--ee-endpoint=http://${nm('el')}:8551`, '--ee-jwt-secret-file=/engine.jwt', '--checkpoint-sync-url=https://beaconstate.info', '--rest-api-enabled=true', '--rest-api-interface=0.0.0.0', '--rest-api-port=5051', '--rest-api-host-allowlist=*', '--metrics-enabled=true', '--metrics-interface=0.0.0.0', '--metrics-port=8008', `--builder-endpoint=http://${nm('mev')}:18550`, '--validators-builder-registration-default-enabled=true'] },
      { key: 'vc', role: 'vc', svcType: 'TekuValidatorService', image: `consensys/teku:${v.tekuVc || v.teku}`, entry: '/opt/teku/bin/teku', ports: ['127.0.0.1:5052:5052/tcp'], vols: [`${ST}/teku-${ids.vc}/data:/opt/app/data`],
        args: ['vc', '--network=mainnet', '--data-path=/opt/app/data', `--beacon-node-api-endpoint=http://${nm('cl')}:5051`, '--validator-api-enabled=true', '--validator-api-interface=0.0.0.0', '--validator-api-port=5052', '--validator-api-host-allowlist=*', '--validator-api-keystore-file=/opt/app/data/validator/api/validator-api.p12', '--validator-api-keystore-password-file=/opt/app/data/validator/api/validator-api.pass', '--validators-proposer-default-fee-recipient=0x5e7a0b9c2d4f6e8a1b3c5d7e9f0a2b4c6d8e0f13', '--validators-builder-registration-default-enabled=true'] },
      { key: 'mev', role: 'mev', svcType: 'FlashbotsMevBoostService', image: `flashbots/mev-boost:${v.mev}`, entry: '/app/mev-boost', ports: [], vols: [], args: ['-mainnet', '-addr', '0.0.0.0:18550', '-relay-check', '-relays', 'https://0xac6e77dfe25ecd6110b8e780608cce0dab71fdd5ebea22a16c0205200f2f8e2e3ad3b71d3499c54ad14d6c21b41a37ae@boost-relay.flashbots.net'] },
      { key: 'prom', role: 'aux', svcType: 'PrometheusService', image: 'prom/prometheus:v3.5.0', entry: '/bin/prometheus', ports: ['127.0.0.1:9090:9090/tcp'], vols: ['/etc/stereum/services/prometheus:/etc/prometheus'], args: ['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.retention.time=15d'] },
      { key: 'nexp', role: 'aux', svcType: 'PrometheusNodeExporterService', image: 'prom/node-exporter:v1.9.1', entry: '/bin/node_exporter', ports: [], vols: ['/:/host:ro,rslave'], args: ['--path.rootfs=/host'] },
    ];
    defs.forEach(d => {
      const c = { key: d.key, role: d.role, kind: 'docker', uuid: ids[d.key], name: nm(d.key), svcType: d.svcType, entry: d.entry, ports: d.ports, vols: d.vols, cfg: { image: d.image, args: d.args }, version: d.image.split(':')[1].replace(/^v/, ''), state: 'exited', since: -86400 * 20, createdAt: sp.createdAt ?? -86400 * 20, restarts: 0, exitCode: 0, id: hx(nm(d.key), 64), keys: [] };
      if (sp.created && sp.created[d.key] != null) c.createdAt = sp.created[d.key];
      sp.n.eth.c[d.key] = c;
      S.fsWrite(sp.n, svcYamlPath(c), svcYaml(c));
    });
    const n = sp.n;
    S.fsWrite(n, jwt, hx('jwt' + sp.id) + '\n', { mode: '600', owner: '2000' });
    S.fsWrite(n, `${ST}/besu-${ids.el}/data/database/000412.sst`, '(rocksdb)', { owner: '2000', size: 67108864 });
    S.fsWrite(n, `${ST}/teku-${ids.cl}/data/beacon/db/001187.ldb`, '(leveldb)', { owner: '2000', size: 2097152 });
    S.fsWrite(n, `${ST}/teku-${ids.vc}/data/validator/key-manager/validator-api-bearer`, `api-token-0x${hx('bearer' + sp.id, 32)}\n`, { mode: '600', owner: '2000' });
    S.fsWrite(n, `${ST}/teku-${ids.vc}/data/validator/api/validator-api.p12`, '(PKCS#12 keystore)', { mode: '600', owner: '2000' });
    S.fsWrite(n, '/etc/stereum/stereum.yaml', `stereum_settings:\n  settings:\n    controls_install_path: /opt/stereum\n    os_user: stereum\n    updates:\n      lane: stable\n      unattended:\n        install: true\n`);
    S.fsWrite(n, '/etc/stereum/services/prometheus/prometheus.yml', 'global:\n  scrape_interval: 15s\nscrape_configs:\n  - job_name: besu\n  - job_name: teku_beacon\n  - job_name: teku_validator\n  - job_name: node_exporter\n');
    S.fsWrite(n, '/usr/local/bin/stereum-recreate', '#!/bin/bash\n# ops helper: recreate one Stereum service container from its service yaml.\n# Keeps the container name (stereum-<id>), the "stereum" network and the volumes,\n# and re-reads image: and command: from /etc/stereum/services/<id>.yaml.\n# A plain `docker restart` keeps the old container config and does NOT re-read the yaml.\nset -euo pipefail\nid="${1#stereum-}"\nyaml="/etc/stereum/services/${id}.yaml"\n[ -f "$yaml" ] || { echo "stereum-recreate: no such service: $yaml" >&2; exit 1; }\n# ... renders `docker run -d --name stereum-$id --network stereum --restart unless-stopped ...` from $yaml\n', { mode: '755' });
    S.fsWrite(n, '/var/log/stereum-update.log', sp.updateLog || '');
    n.commands = { 'stereum-recreate': stereumRecreate };
    n.services.docker = { name: 'docker', desc: 'Docker Application Container Engine', unitPath: '/usr/lib/systemd/system/docker.service', state: 'active', since: -86400 * 41, pid: 1088, exec: '/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock' };
    n.services.besu = { name: 'besu', desc: 'Besu Ethereum client', unitPath: '/etc/systemd/system/besu.service', state: 'inactive', since: -86400 * 41, pid: 0, exec: '/usr/local/bin/besu --config-file=/etc/besu/config.toml', enabled: false, legacy: true };
    n.services.teku = { name: 'teku', desc: 'Teku Ethereum consensus client', unitPath: '/etc/systemd/system/teku.service', state: 'inactive', since: -86400 * 41, pid: 0, exec: '/usr/local/bin/teku --config-file=/etc/teku/config.yaml', enabled: false, legacy: true };
    S.fsWrite(n, '/etc/systemd/system/besu.service', '[Unit]\nDescription=Besu Ethereum client\n\n[Service]\nUser=besu\nExecStart=/usr/local/bin/besu --config-file=/etc/besu/config.toml\n\n[Install]\nWantedBy=multi-user.target\n');
    S.fsWrite(n, '/etc/systemd/system/teku.service', '[Unit]\nDescription=Teku Ethereum consensus client\n\n[Service]\nUser=teku\nExecStart=/usr/local/bin/teku --config-file=/etc/teku/config.yaml\n\n[Install]\nWantedBy=multi-user.target\n');
    n.crontab = '# m h dom mon dow command\n0 0 * * * /etc/stereum/unattended-update.sh >> /var/log/stereum-update.log 2>&1\n';
    n.mounts = [['/dev/nvme0n1p1', 96, 31, '/'], ['/dev/nvme1n1', 3576, 2142, '/mnt/ethereum-data']];
  }

  function systemdHost(w, sp) {
    const n = sp.n, v = sp.versions;
    const units = [
      { key: 'el', role: 'el', name: 'besu', desc: 'Besu execution client', user: 'besu', exec: `/opt/besu/bin/besu \\\n  --network=mainnet --data-path=/var/lib/besu --data-storage-format=BONSAI --sync-mode=SNAP \\\n  --p2p-port=30303 --rpc-http-enabled --rpc-http-host=127.0.0.1 --rpc-http-api=ETH,NET,WEB3 \\\n  --engine-rpc-port=8551 --engine-jwt-secret=/etc/eth/jwt.hex --metrics-enabled`, version: v.besu },
      { key: 'cl', role: 'cl', name: 'teku-beacon', desc: 'Teku beacon node', user: 'teku', exec: `/opt/teku/bin/teku \\\n  --network=mainnet --data-path=/var/lib/teku-beacon --data-storage-mode=prune \\\n  --p2p-port=9001 --p2p-quic-port=9002 \\\n  --ee-endpoint=http://127.0.0.1:8551 --ee-jwt-secret-file=/etc/eth/jwt.hex \\\n  --checkpoint-sync-url=https://beaconstate.info \\\n  --rest-api-enabled --rest-api-port=5051 --builder-endpoint=http://127.0.0.1:18550 --metrics-enabled`, version: v.teku },
      { key: 'vc', role: 'vc', name: 'teku-vc', desc: 'Teku validator client', user: 'teku', exec: `/opt/teku/bin/teku vc \\\n  --network=mainnet --data-path=/var/lib/teku-vc \\\n  --beacon-node-api-endpoint=http://127.0.0.1:5051 \\\n  --validator-keys=/var/lib/teku-vc/validator-keys:/var/lib/teku-vc/validator-keys \\\n  --doppelganger-detection-enabled=true \\\n  --validator-api-enabled --validator-api-port=5052 \\\n  --validator-api-keystore-file=/var/lib/teku-vc/api/validator-api.p12 \\\n  --validator-api-keystore-password-file=/var/lib/teku-vc/api/validator-api.pass \\\n  --validators-proposer-default-fee-recipient=0x5e7a0b9c2d4f6e8a1b3c5d7e9f0a2b4c6d8e0f13`, version: v.teku },
      { key: 'mev', role: 'mev', name: 'mev-boost', desc: 'mev-boost', user: 'mevboost', exec: '/usr/local/bin/mev-boost -mainnet -addr 127.0.0.1:18550 -relay-check -relays https://0xac6e77dfe25ecd6110b8e780608cce0dab71fdd5ebea22a16c0205200f2f8e2e3ad3b71d3499c54ad14d6c21b41a37ae@boost-relay.flashbots.net', version: v.mev },
    ];
    units.forEach(u => {
      const unitPath = `/etc/systemd/system/${u.name}.service`;
      S.fsWrite(n, unitPath, `[Unit]\nDescription=${u.desc}\nWants=network-online.target\nAfter=network-online.target${u.key === 'cl' ? ' besu.service' : u.key === 'vc' ? ' teku-beacon.service' : ''}\n\n[Service]\nUser=${u.user}\nGroup=${u.user}\nType=simple\nExecStart=${u.exec}\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=300\n${u.key !== 'mev' ? 'Environment=JAVA_OPTS=-Xmx8g\n' : ''}\n[Install]\nWantedBy=multi-user.target\n`);
      const svc = n.services[u.name] = { name: u.name, desc: u.desc, unitPath, state: 'inactive', since: -86400 * 20, pid: 0, exec: u.exec.replace(/ \\\n\s*/g, ' ').slice(0, 96) + ' …', enabled: true, memStr: () => (u.key === 'el' ? '11.4G' : u.key === 'cl' ? '7.2G' : u.key === 'vc' ? '1.1G' : '38.0M'), tasks: u.key === 'mev' ? 9 : 88 };
      n.eth.c[u.key] = { key: u.key, role: u.role, kind: 'systemd', name: u.name, unitPath, svc, version: u.version, state: 'inactive', since: -86400 * 20, createdAt: -86400 * 20, restarts: 0, exitCode: 0, keys: [], doppel: u.key === 'vc' };
    });
    S.fsWrite(n, '/etc/eth/jwt.hex', hx('jwt' + sp.id) + '\n', { mode: '640', owner: 'root' });
    S.fsWrite(n, '/var/lib/besu/database/000731.sst', '(rocksdb)', { owner: 'besu', size: 67108864 });
    S.fsWrite(n, '/var/lib/teku-beacon/beacon/db/002241.ldb', '(leveldb)', { owner: 'teku', size: 2097152 });
    S.fsWrite(n, '/var/lib/teku-vc/api/validator-api.p12', '(PKCS#12 keystore)', { mode: '600', owner: 'teku' });
    S.fsWrite(n, '/var/lib/teku-vc/validator/key-manager/validator-api-bearer', `api-token-0x${hx('bearer' + sp.id, 32)}\n`, { mode: '600', owner: 'teku' });
    n.dirs.add('/var/lib/teku-vc/validator-keys'); n.dirs.add('/var/lib/teku-vc/validator/slashprotection');
    S.fsWrite(n, '/etc/systemd/system/eth-engine-watchdog.service', '[Unit]\nDescription=Restart a hung teku-beacon when the execution layer stops advancing\n\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/eth-engine-watchdog\n');
    S.fsWrite(n, '/etc/systemd/system/eth-engine-watchdog.timer', '[Unit]\nDescription=Run eth-engine-watchdog every 2 minutes\n\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=2min\n\n[Install]\nWantedBy=timers.target\n');
    S.fsWrite(n, '/usr/local/sbin/eth-engine-watchdog', '#!/bin/bash\n# Restarts teku-beacon when eth_blockNumber has not advanced for 5 minutes while besu is up and peered.\n# Refuses (escalates) when besu is unreachable, has zero peers, the daily cap (3) is reached,\n# or two restarts in a row did not restore progress. Never touches teku-vc.\n', { mode: '755' });
    n.services['eth-engine-watchdog'] = { name: 'eth-engine-watchdog', desc: 'Restart a hung teku-beacon when the execution layer stops advancing', unitPath: '/etc/systemd/system/eth-engine-watchdog.service', state: 'inactive', since: -600, pid: 0, exec: '/usr/local/sbin/eth-engine-watchdog' };
    n.eth.timer = { active: sp.watchdog !== false, enabled: sp.watchdog !== false, since: sp.watchdog === false ? -86400 * 3 + 7331 : -86400 * 20, lastRun: sp.watchdog === false ? -86400 * 3 + 7331 : -60, acted: null, escalated: null, failures: 0, today: 0, next: 30 };
    n.commands = { teku: tekuCli, besu: ctx => ctx.args.includes('--version') ? `besu/v${n.eth.c.el.version}/linux-x86_64/openjdk-java-21\n` : { code: 1, out: C.gray(S.L('besu 由 systemd 管理：systemctl status|restart besu\n', 'besu runs under systemd: systemctl status|restart besu\n')) } };
    n.mounts = [['/dev/nvme0n1p1', 3576, 1874, '/']];
  }

  function makeNode(w, sp) {
    const n = S.makeHost({
      id: sp.id, moniker: sp.id, hostname: sp.id, instanceId: sp.instanceId, region: sp.region, ip: sp.ip, kind: 'node', homeUser: 'ubuntu',
      mem: { total: 64 * 1024, used: 41 * 1024 }, disk: { size: 3576, used: 2142, dev: '/dev/nvme1n1' }, cpus: 16, load: [2.81, 2.64, 2.70], upBase: 86400 * 20, bootAt: 0,
    });
    n.eth = { stack: sp.stack, c: {}, elHead: 0, elLastAdv: 0, clHead: 0, clLastSlot: 0, clLastAdv: 0, headSeenAt: 0, elPeers: 25, clPeers: 68, lastLog: {}, imported: {} };
    sp.n = n;
    if (sp.stack === 'stereum') stereumHost(w, sp); else systemdHost(w, sp);
    n.services['eth-collector'] = { name: 'eth-collector', desc: 'Ethereum metrics collector', unitPath: '/etc/systemd/system/eth-collector.service', state: 'active', since: -86400 * 20, pid: 1611, exec: '/opt/eth-collector/collector.sh' };
    n.services['grafana-agent'] = { name: 'grafana-agent', desc: 'Monitoring system and forwarder', unitPath: '/usr/lib/systemd/system/grafana-agent.service', state: 'active', since: -86400 * 20, pid: 1622, exec: '/usr/bin/grafana-agent --config.file /etc/grafana-agent.yaml' };
    n.services['amazon-ssm-agent'] = { name: 'amazon-ssm-agent', desc: 'amazon-ssm-agent', unitPath: '/etc/systemd/system/amazon-ssm-agent.service', state: 'active', since: -86400 * 20, pid: 812, exec: '/usr/bin/amazon-ssm-agent' };
    n.dirs.add('/tmp'); n.dirs.add('/root'); n.dirs.add('/home/ssm-user');
    n.procs = w2 => comps(n).filter(running).map(c => ({ user: c.kind === 'docker' ? '2000' : (c.role === 'el' ? 'besu' : c.role === 'mev' ? 'mevboost' : 'teku'), pid: c.pid, cpu: c.role === 'el' ? '84.2' : c.role === 'cl' ? (c.hung ? '0.3' : '61.7') : '3.1', mem: c.role === 'el' ? '17.8' : c.role === 'cl' ? '11.2' : '1.7', cmd: c.kind === 'docker' ? `${c.entry} ${c.cfg.args.slice(0, 3).join(' ')} …` : c.svc.exec }));
    n.listening = w2 => {
      const out = [], E = n.eth;
      if (running(E.c.el)) out.push({ addr: '*:30303', proc: 'java', pid: E.c.el.pid }, { addr: (E.stack === 'stereum' ? '0.0.0.0' : '127.0.0.1') + ':8545', proc: E.stack === 'stereum' ? 'docker-proxy' : 'java', pid: E.c.el.pid }, { addr: '127.0.0.1:8551', proc: 'java', pid: E.c.el.pid });
      if (ready(w2, E.c.cl) || (running(E.c.cl) && E.c.cl.hung)) out.push({ addr: '*:9001', proc: 'java', pid: E.c.cl.pid }, { addr: '127.0.0.1:5051', proc: E.stack === 'stereum' ? 'docker-proxy' : 'java', pid: E.c.cl.pid });
      if (running(E.c.vc)) out.push({ addr: '127.0.0.1:5052', proc: E.stack === 'stereum' ? 'docker-proxy' : 'java', pid: E.c.vc.pid });
      return out;
    };
    return n;
  }

  /* boot every component, then rewind its clocks so it looks long-running */
  function boot(w, n, sp) {
    const E = n.eth, ns = netSlot(w);
    E.clHead = sp.clBehind ? ns - sp.clBehind : ns;
    E.clLastSlot = Math.floor(E.clHead);
    E.elHead = blockAt(Math.floor(E.clHead));
    E.clLastAdv = sp.clBehind ? -sp.clBehind * SPS : 0;
    E.elLastAdv = E.clLastAdv;
    E.headSeenAt = sp.hung ? E.clLastAdv : 0;
    comps(n).forEach(c => {
      if (sp.stopped && sp.stopped.includes(c.key)) return;
      start(w, n, c);
      c.readyAt = -1; c.startedAt = c.since = Math.max(sp.upSince ?? -86400 * 6, c.createdAt);
      syncSvc(w, c);
    });
    (n.journal && Object.keys(n.journal)).forEach(u => { n.journal[u].length = 0; });
    if (sp.hung) { E.c.cl.hung = true; }
    if (sp.crashLoop) {
      const c = E.c.cl;
      c.restarts = sp.crashLoop.restarts; c.createdAt = sp.crashLoop.createdAt;
      setState(w, c, 'restarting', 2); c.since = -4; c.nextStart = 2; c.startedAt = -40; c.crashAt = null;
    }
  }

  /* ---------- duty schedule ---------- */
  const dutySlot = (v, e) => e * SPE + ((v.index * 7 + e * 13) % SPE);
  const val = (w, pk) => w.chain.vals.find(v => v.pubkey === pk);
  function signerHosts(w, v) { return Object.values(w.nodes).filter(n => running(n.eth.c.vc) && (n.eth.c.vc.keys || []).includes(v.pubkey)); }
  function beaconProblem(w, n) {
    const E = n.eth, cl = E.c.cl, el = E.c.el;
    if (!running(cl) || w.t < cl.readyAt) return 'java.net.ConnectException: Connection refused';
    if (cl.hung) return 'java.net.SocketTimeoutException: timeout';
    if (!elServing(w, n)) return 'Beacon node is syncing (execution client offline)';
    if (cl.crashAt != null) return 'Beacon node is syncing';
    if (netSlot(w) - Math.floor(E.clHead) > 1) return 'Beacon node is syncing';
    return null;
  }
  function evalDuty(w, v, e, ds) {
    if (v.slashed != null) { v.hist.push({ e, hit: false, slashed: true }); return; }
    const signers = [], root = hx('root' + ds);
    Object.values(w.nodes).forEach(n => {
      const vc = n.eth.c.vc;
      if (!running(vc) || w.t < vc.readyAt || !(vc.keys || []).includes(v.pubkey)) return;
      if (vc.dopEnd != null && ds < vc.dopEnd) return;
      const why = beaconProblem(w, n);
      if (why) { if (w.t - (vc.lastWarn || -1e9) > 30) { vc.lastWarn = w.t; tlog(w, n, vc, 'WARN', `Validator   *** Failed to produce attestation  Slot: ${ds}  Validator: ${v.pubkey.slice(2, 8)}  Reason: ${why}`); } return; }
      const last = spGet(w, n, vcData(n), v.pubkey);
      if (last !== null && last >= e) { tlog(w, n, vc, 'ERROR', `Validator   *** Slashing protection not permitting attestation  Slot: ${ds}  Validator: ${v.pubkey.slice(2, 8)}  (target epoch ${e} <= last signed ${last})`); return; }
      spSet(w, n, vcData(n), v.pubkey, e);
      signers.push(n);
      tlog(w, n, vc, 'INFO', `Validator   *** Published attestation        Count: 1, Slot: ${ds}, Root: ${root.slice(0, 4)}..${root.slice(-4)}`);
    });
    // doppelganger: a client still in its waiting period sees the key live elsewhere
    Object.values(w.nodes).forEach(n => {
      const vc = n.eth.c.vc;
      if (!running(vc) || vc.dopEnd == null || !(vc.keys || []).includes(v.pubkey) || !signers.length || signers.includes(n)) return;
      tlog(w, n, vc, 'FATAL', `Doppelganger detected. Validator ${v.pubkey.slice(0, 10)}… is live on another node (epoch ${e}). Shutting down`);
      stop(w, n, vc, 1);
      setState(w, vc, vc.kind === 'docker' ? 'exited' : 'failed', 1);
      S.lesson(w, 'doppel', S.LL('doppelganger 检测是最后一道保险', 'Doppelganger detection is the last safety net'), S.LL('启用 doppelganger 检测的验证者客户端，启动后先观察两个 epoch。如果网络上同一把钥匙仍在出证明，它就自行退出，不签任何东西。它只在启动时检查一次：如果另一边是之后才启动的，例如夜间自动更新重建了旧容器，它就发现不了。', 'A validator client with doppelganger detection watches for two epochs after it starts. If the same key is still attesting on the network, it exits without signing anything. It only checks at startup: if the other side starts later, for example when a nightly update recreates the old container, it cannot see it.'));
    });
    if (signers.length) v.everSigned = true;
    if (signers.length >= 2) return slash(w, v, e, signers);
    const hit = signers.length === 1;
    v.bal += hit ? REWARD : -PENALTY;
    v.hist.push({ e, hit, by: hit ? signers[0].id : null });
    if (v.hist.length > 400) v.hist.splice(0, v.hist.length - 400);
    if (hit) { v.lastSigner = signers[0].id; (v.lastBy = v.lastBy || {})[signers[0].id] = e; w.chain.hitsLab++; }
    else {
      w.chain.missLab++;
      S.lesson(w, 'miss', S.LL('错过证明的代价', 'What a missed attestation costs'), S.LL('每个验证者每个 epoch（32 个 slot，6.4 分钟）有一次证明任务。按时被打包，获得约 0.000014 ETH；错过，被扣约 0.000011 ETH。单次的金额很小，但每一次都会计入一天的 attester 效率，低于 93% 会触发 <code>EthValidatorEfficiencyLow</code>。', 'Each validator has one attestation duty per epoch (32 slots, 6.4 minutes). Included on time, it earns about 0.000014 ETH; missed, it loses about 0.000011 ETH. Each one is small, but every miss counts against the 1-day attester efficiency, and below 93% <code>EthValidatorEfficiencyLow</code> fires.'));
    }
  }
  function slash(w, v, e, signers) {
    v.slashed = e; v.bal -= SLASH_PENALTY;
    v.hist.push({ e, hit: false, slashed: true });
    S.flag(w, 'slashed'); S.flag(w, 'two_signers');
    signers.forEach(n => tlog(w, n, n.eth.c.vc, 'ERROR', `Validator ${v.pubkey.slice(0, 10)}… has been SLASHED (status active_slashed). Duties are no longer performed`));
    S.event(w, 'bad', S.LL(`<b>验证者 ${v.index} 被罚没。</b>${signers.map(n => n.id).join(' 和 ')} 在 epoch ${e} 用同一把钥匙各签了一次证明（double vote）。`, `<b>Validator ${v.index} was slashed.</b> ${signers.map(n => n.id).join(' and ')} each signed an attestation for epoch ${e} with the same key (a double vote).`));
    S.lesson(w, 'slashing', S.LL('罚没的后果', 'What slashing does'), S.LL('同一个 target epoch 签出两份不同的证明，任何人都可以把证据提交上链。验证者会被立即扣除一部分余额、强制退出，并在大约 36 天的退出期内继续被扣罚；同一时期被罚没的验证者越多，追加的扣罚越大。这个过程无法撤销。', 'Two different attestations for the same target epoch are evidence that anyone can submit on chain. The validator loses part of its balance at once, is forced to exit, and keeps being penalised for about 36 days until it can withdraw; the more validators slashed in the same period, the larger the extra penalty. None of it can be undone.'));
  }
  function efficiency(v) {
    const h = v.hist.slice(-WINDOW);
    return h.length ? 100 * h.filter(x => x.hit).length / h.length : 100;
  }

  /* ---------- watchdog (systemd stack) ---------- */
  function runWatchdog(w, n, why) {
    const E = n.eth, T = E.timer, el = E.c.el, cl = E.c.cl;
    T.lastRun = w.t; T.next = w.t + 120;
    n.services['eth-engine-watchdog'].pid = 20000 + Math.floor(w.rand() * 40000);
    const unit = 'eth-engine-watchdog';
    const say = m => sysLog(w, n, unit, `eth-engine-watchdog: ${m}`);
    const stall = Math.round(w.t - E.elLastAdv);
    if (!ready(w, el)) { T.escalated = 'execution RPC unreachable'; say(`execution RPC 127.0.0.1:8545 unreachable -> ESCALATE (a beacon restart cannot fix this)`); return; }
    if (running(cl) && w.t - cl.startedAt < 600 && stall >= 300) { say(`el_block=${E.elHead} unchanged for ${stall}s, but teku-beacon started ${Math.round(w.t - cl.startedAt)}s ago -> waiting for it to sync`); return; }
    if (stall < 300) { T.failures = 0; T.escalated = null; say(`ok: el_block=${E.elHead} advancing, peers=${E.elPeers}${why === 'manual' ? ' (manual run)' : ''}`); return; }
    if (E.elPeers === 0) { T.escalated = 'besu has zero peers'; say('el_block unchanged but besu has 0 peers -> ESCALATE (network problem)'); return; }
    if (T.today >= 3) { T.escalated = 'daily restart cap reached'; say('el_block unchanged, daily restart cap (3) reached -> ESCALATE'); return; }
    if (T.failures >= 2) { T.escalated = 'two restarts did not restore progress'; say('el_block unchanged after 2 restarts -> ESCALATE'); return; }
    say(`el_block=${E.elHead} unchanged for ${stall}s, besu healthy (peers=${E.elPeers}) -> restarting teku-beacon`);
    T.today++; T.failures++; T.acted = w.t;
    restart(w, n, cl);
    S.event(w, 'sys', S.LL(`eth-engine-watchdog 在 <b>${n.id}</b> 上重启了 teku-beacon。`, `eth-engine-watchdog restarted teku-beacon on <b>${n.id}</b>.`));
  }

  /* ---------- Stereum nightly updater ---------- */
  function unattendedUpdate(w, n) {
    const lines = [`${S.fmtClock(w.now())} unattended-update: checking images (lane: stable)`];
    comps(n).concat(Object.values(n.eth.c).filter(c => c && c.removed)).forEach(c => {
      if (c.kind !== 'docker' || S.fsRead(w, n, svcYamlPath(c)) === null) return;
      const before = running(c);
      recreateQuiet(w, n, c);
      lines.push(`${S.fmtClock(w.now())} unattended-update: ${c.svcType} (${c.name}) ${c.cfg.image} up to date, container recreated`);
      if (c.role === 'vc' && !before && c.keys.length) {
        S.event(w, 'warn', S.LL(`<b>eth-01 的夜间自动更新</b>重建并启动了验证者客户端容器，它载入了 ${c.keys.length} 把钥匙。`, `<b>The nightly unattended update on eth-01</b> recreated and started the validator client container, and it loaded ${c.keys.length} key(s).`));
        S.lesson(w, 'midnight', S.LL('停掉的容器会被重建', 'A stopped container gets recreated'), S.LL('Stereum 的自动更新按服务定义重建所有容器，包括被手工停掉的那个。只停容器不删钥匙，旧机器在下一个午夜就会重新开始签名。退役一台验证者机器，要先把钥匙从它的验证者客户端里删除。', 'Stereum\'s unattended update recreates every container from its service definition, including one that was stopped by hand. If the container is stopped but the key is not removed, the old machine starts signing again at the next midnight. To retire a validator machine, delete the key from its validator client first.'));
      }
    });
    S.fsWrite(n, '/var/log/stereum-update.log', (S.fsRead(w, n, '/var/log/stereum-update.log') || '') + lines.join('\n') + '\n');
  }
  function recreateQuiet(w, n, c) {
    const cfg = parseSvcYaml(S.fsRead(w, n, svcYamlPath(c)));
    if (running(c)) stop(w, n, c);
    c.cfg = cfg; c.version = (cfg.image.split(':')[1] || '').replace(/^v/, ''); c.removed = false; c.restarts = 0; c.createdAt = w.t; c.id = hx(c.name + w.t, 64);
    start(w, n, c);
  }

  /* ---------- tick ---------- */
  function tickNode(w, n, dt, ns) {
    const E = n.eth, el = E.c.el, cl = E.c.cl, vc = E.c.vc;
    comps(n).forEach(c => {
      if (c.state === 'running' && c.crashAt != null && w.t >= c.crashAt) crashCl(w, n, c);
      else if ((c.state === 'restarting' || c.state === 'activating') && c.nextStart != null && w.t >= c.nextStart) {
        if (c.kind === 'systemd') sysLog(w, n, c.name, `${c.name}.service: Scheduled restart job, restart counter is at ${c.restarts}.`);
        start(w, n, c);
      }
    });
    const elUp = elServing(w, n);
    const clUp = ready(w, cl);
    if (clImports(w, n) && elUp) {
      if (E.clHead < ns) E.clHead = Math.min(ns, E.clHead + SYNC_RATE * dt);
      if (ns - E.clHead <= 1) E.clHead = ns;
      const b = blockAt(Math.floor(E.clHead));
      if (b > E.elHead) { E.elHead = b; E.elLastAdv = w.t; }
    }
    if (Math.floor(E.clHead) > E.clLastSlot) { E.clLastSlot = Math.floor(E.clHead); E.clLastAdv = w.t; }
    if (clUp) E.headSeenAt = w.t;
    if (clUp) E.clPeers = Math.min(68, Math.max(E.clPeers, 12 + Math.floor((w.t - cl.readyAt) / 40)));
    else if (!running(cl)) E.clPeers = 0;
    const syncing = clUp && ns - Math.floor(E.clHead) > 1;
    const L = E.lastLog, every = (k, sec) => { if (w.t - (L[k] ?? -1e9) >= sec) { L[k] = w.t; return true; } return false; };
    // besu
    if (running(el) && w.t >= el.readyAt) {
      if (clUp && !syncing && every('elImp', SPS)) { const h = hx('b' + E.elHead); blog(w, n, el, 'INFO', 'AbstractEngineNewPayload', `Imported #${groupDigits(E.elHead)} / ${120 + (E.elHead % 170)} tx / ${16} ws / base fee ${(0.4 + (E.elHead % 97) / 60).toFixed(2)} gwei / ${groupDigits(14e6 + (E.elHead % 997) * 9001)} (${(39 + (E.elHead % 31)).toFixed(1)}%) gas / (0x${h.slice(0, 4)}...${h.slice(-6)}) in 0.${100 + (E.elHead % 300)}s. Peers: ${E.elPeers}`); }
      else if (clUp && syncing && every('elBack', 30)) blog(w, n, el, 'INFO', 'BackwardSyncContext', `Backward sync phase 2 of 2, ${Math.min(99.9, 100 * (1 - (ns - E.clHead) / Math.max(1, ns - E.clHead + 50))).toFixed(2)}% completed, imported ${Math.floor(w.t - cl.readyAt) * 2} blocks of at least ${Math.floor(ns - E.clHead) + Math.floor(w.t - cl.readyAt) * 2}. Peers: ${E.elPeers}`);
      else if (w.t - E.elLastAdv >= 120 && every('elQos', 120)) blog(w, n, el, 'WARN', 'EngineQosTimer', 'Execution engine not called in 120 seconds, consensus client may not be connected');
    }
    // teku beacon
    if (clUp) {
      if (!elUp && every('clEl', 30)) tlog(w, n, cl, 'WARN', 'Execution Client is offline');
      else if (syncing && every('clSync', SPS)) tlog(w, n, cl, 'INFO', `Syncing     *** Target slot: ${ns}, Head slot: ${Math.floor(E.clHead)}, Remaining slots: ${ns - Math.floor(E.clHead)}, Connected peers: ${E.clPeers}`);
      else if (!syncing && elUp && every('clSlot', SPS)) { const r = hx('blk' + ns); tlog(w, n, cl, 'INFO', `Slot Event  *** Slot: ${ns}, Block: ${r.slice(0, 6)}..${r.slice(-4)}, Justified: ${ep(ns) - 1}, Finalized: ${ep(ns) - 2}, Peers: ${E.clPeers}`); }
    }
    // validator client while its doppelganger window closes
    if (running(vc) && vc.dopEnd != null && ns >= vc.dopEnd) { tlog(w, n, vc, 'INFO', 'Doppelganger detection finished: no doppelgangers detected. Performing duties'); vc.dopEnd = null; }
    // watchdog timer
    if (E.timer && E.timer.active && w.t >= (E.timer.next ?? E.timer.lastRun + 120)) runWatchdog(w, n, 'timer');
    if (E.timer && E.timer.acted != null && w.t - E.timer.acted > 900) E.timer.acted = null;
    // Stereum nightly update at 00:00 UTC
    if (E.stack === 'stereum') {
      const d0 = Math.floor((w.base / 1000 + w.t - dt) / 86400), d1 = Math.floor((w.base / 1000 + w.t) / 86400);
      if (d1 > d0) unattendedUpdate(w, n);
    }
  }
  function tick(w, dt) {
    const ns = netSlot(w), ch = w.chain;
    Object.values(w.nodes).forEach(n => tickNode(w, n, dt, ns));
    ch.vals.forEach(v => {
      while (ns >= dutySlot(v, v.next) + 1) { evalDuty(w, v, v.next, dutySlot(v, v.next)); v.next++; }
    });
    // the same key loaded in two running validator clients
    ch.vals.forEach(v => { if (signerHosts(w, v).length >= 2) { S.flag(w, 'two_signers'); if (!ch.saidTwo) { ch.saidTwo = true; S.event(w, 'bad', S.LL(`验证者 ${v.index} 的钥匙同时载入在两台机器的验证者客户端中：${signerHosts(w, v).map(n => n.id).join('、')}。`, `The key of validator ${v.index} is loaded in validator clients on two machines: ${signerHosts(w, v).map(n => n.id).join(', ')}.`)); } } });
    const e = ep(ns);
    if (ch.lastEpoch !== undefined && e !== ch.lastEpoch) S.emit('eth-epoch', w, e);
    ch.lastEpoch = e;
  }

  /* ---------- view of a node, as the collector and the REST API see it ---------- */
  function view(w, n) {
    const E = n.eth, ns = netSlot(w), cl = E.c.cl, el = E.c.el;
    const clUp = ready(w, cl), elUp = elServing(w, n);
    const head = Math.floor(E.clHead), dist = Math.max(0, ns - head);
    return { ns, head, dist, clUp, elUp, hung: running(cl) && cl.hung, syncing: clUp && dist > 1, optimistic: clUp && dist > 1, elOffline: clUp && !elUp, finalized: ep(head) - 2 };
  }
  const attestingFrom = (w, v, hostId) => { const last = v.hist[v.hist.length - 1]; return !!last && last.hit && last.by === hostId && v.slashed == null; };

  /* ---------- HTTP ---------- */
  const j = (status, obj) => ({ status, body: JSON.stringify(obj) });
  const rpc = (id, result) => j(200, { jsonrpc: '2.0', id: id ?? 1, result });
  const refused = (h, p) => ({ error: 7, msg: `Failed to connect to ${h} port ${p} after 0 ms: Couldn't connect to server` });
  function valJson(w, v) {
    return { index: String(v.index), balance: String(Math.round(v.bal)), status: v.slashed != null ? 'active_slashed' : 'active_ongoing', validator: { pubkey: v.pubkey, withdrawal_credentials: '0x010000000000000000000000' + v.withdrawal, effective_balance: '32000000000', slashed: v.slashed != null, activation_eligibility_epoch: String(v.activation - 7), activation_epoch: String(v.activation), exit_epoch: v.slashed != null ? String(v.slashed + 260) : FAR, withdrawable_epoch: v.slashed != null ? String(v.slashed + 8192) : FAR } };
  }
  async function beaconApi(w, n, req, ctx) {
    const E = n.eth, cl = E.c.cl, V = view(w, n);
    if (running(cl) && cl.hung) {
      await ctx.sleep(30);
      S.lesson(w, 'absent', S.LL('读不到的指标不会告警', 'A value that cannot be read never alerts'), S.LL('beacon 进程还在，端口也在监听，但它已经不再处理请求。监控读不到 head slot，"head 不再前进"一类的规则拿不到数据，也就不会触发。Besu 本身是健康的，它的区块高度可以读到，于是成为唯一可靠的信号：没有 Engine API 调用，就没有新区块。', 'The beacon process is alive and its port is open, but it no longer answers. Monitoring cannot read the head slot, so rules like "head stopped advancing" get no data and never fire. Besu is healthy and its block number can still be read, which makes it the only reliable signal: no Engine API calls, no new blocks.'));
      return { error: 28, msg: 'Operation timed out after 30001 milliseconds with 0 bytes received' };
    }
    if (!V.clUp) return refused(req.host, 5051);
    const p = req.path, ns = V.ns;
    const opt = V.optimistic;
    if (p === '/eth/v1/node/syncing') return j(200, { data: { head_slot: String(V.head), sync_distance: String(V.dist), is_syncing: V.syncing, is_optimistic: opt, el_offline: V.elOffline } });
    if (p === '/eth/v1/node/health') return { status: V.syncing || V.elOffline ? 206 : 200, body: '' };
    if (p === '/eth/v1/node/version') return j(200, { data: { version: `teku/v${cl.version}/linux-x86_64/-eclipseadoptium-openjdk64bit-java-21` } });
    if (p === '/eth/v1/node/peer_count') return j(200, { data: { disconnected: '41', connecting: '0', connected: String(E.clPeers), disconnecting: '0' } });
    let m;
    if ((m = /^\/eth\/v1\/beacon\/headers\/(head|finalized|\d+)$/.exec(p))) {
      const slot = m[1] === 'head' ? V.head : m[1] === 'finalized' ? V.finalized * SPE : Number(m[1]);
      if (slot > V.head) return j(404, { code: 404, message: `Not found: block at slot ${slot}` });
      const r = hx('blk' + slot);
      return j(200, { execution_optimistic: opt, finalized: m[1] === 'finalized', data: { root: '0x' + r, canonical: true, header: { message: { slot: String(slot), proposer_index: String(100000 + (slot * 7919) % 1000000), parent_root: '0x' + hx('blk' + (slot - 1)), state_root: '0x' + hx('st' + slot), body_root: '0x' + hx('bd' + slot) }, signature: '0x' + hx('sig' + slot, 192) } } });
    }
    if (/^\/eth\/v1\/beacon\/states\/(head|finalized)\/finality_checkpoints$/.test(p)) {
      const cp = e => ({ epoch: String(e), root: '0x' + hx('cp' + e) });
      return j(200, { execution_optimistic: opt, finalized: false, data: { previous_justified: cp(ep(V.head) - 2), current_justified: cp(ep(V.head) - 1), finalized: cp(V.finalized) } });
    }
    if ((m = /^\/eth\/v1\/beacon\/states\/(head|finalized)\/validators\/(\w+)$/.exec(p))) {
      const v = w.chain.vals.find(x => String(x.index) === m[2] || x.pubkey === m[2]);
      if (!v) return j(404, { code: 404, message: 'Could not find validator' });
      return j(200, { execution_optimistic: opt, finalized: false, data: valJson(w, v) });
    }
    if ((m = /^\/eth\/v1\/validator\/liveness\/(\d+)$/.exec(p))) {
      const e = Number(m[1]), cur = ep(ns);
      if (req.method !== 'POST') return j(405, { code: 405, message: 'Method not allowed' });
      if (e > cur || e < cur - 1) return j(400, { code: 400, message: `Invalid epoch range: ${e}. Only the current (${cur}) and previous (${cur - 1}) epochs are supported` });
      let ids = []; try { ids = JSON.parse(req.body || '[]'); } catch (x) { return j(400, { code: 400, message: 'Invalid request body' }); }
      return j(200, { data: ids.map(id => { const v = w.chain.vals.find(x => String(x.index) === String(id)); const hEnt = v && v.hist.find(x => x.e === e); return { index: String(id), is_live: !!(hEnt && hEnt.hit) }; }) });
    }
    if (p.startsWith('/eth/')) return j(404, { code: 404, message: 'Not found' });
    return j(404, { code: 404, message: 'Not found' });
  }
  function besuRpc(w, n, req) {
    const E = n.eth, el = E.c.el, V = view(w, n);
    if (!ready(w, el)) return refused(req.host, 8545);
    const b = req.json || {};
    if (!b.method) return j(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    switch (b.method) {
      case 'eth_blockNumber':
        if (V.hung || !V.clUp) S.lesson(w, 'engine', S.LL('执行层由共识层驱动', 'The consensus client drives the execution client'), S.LL('合并之后，执行客户端不再自己决定导入哪个区块。beacon 节点通过 Engine API（<code>engine_newPayload</code>、<code>engine_forkchoiceUpdated</code>，端口 8551，用 JWT 认证）把每个区块交给它。beacon 不再调用，Besu 就停在原来的高度，同时进程、RPC 和对等节点数都显示正常，日志每两分钟打印一次 <code>Execution engine not called in 120 seconds</code>。', 'Since the Merge the execution client no longer decides which block to import. The beacon node hands it every block over the Engine API (<code>engine_newPayload</code>, <code>engine_forkchoiceUpdated</code>, port 8551, authenticated with a JWT). When the beacon stops calling, Besu stays at the same height while its process, RPC and peer count all look healthy, and it logs <code>Execution engine not called in 120 seconds</code> every two minutes.'));
        return rpc(b.id, hex(E.elHead));
      case 'eth_syncing': return rpc(b.id, V.clUp && V.syncing ? { startingBlock: hex(E.elHead - 50), currentBlock: hex(E.elHead), highestBlock: hex(blockAt(V.ns)) } : false);
      case 'net_peerCount': return rpc(b.id, hex(E.elPeers));
      case 'web3_clientVersion': return rpc(b.id, `besu/v${el.version}/linux-x86_64/openjdk-java-21`);
      case 'eth_chainId': return rpc(b.id, '0x1');
      case 'net_version': return rpc(b.id, '1');
      case 'eth_getBlockByNumber': {
        const num = E.elHead, ts = GENESIS + slotOfBlock(num) * SPS;
        return rpc(b.id, { number: hex(num), hash: '0x' + hx('b' + num), parentHash: '0x' + hx('b' + (num - 1)), timestamp: hex(ts), miner: '0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97', gasUsed: hex(14e6 + (num % 997) * 9001), gasLimit: '0x2aea540', baseFeePerGas: hex(4e8 + (num % 97) * 1e7), transactions: [] });
      }
      default:
        if (/^engine_/.test(b.method)) return { status: 401, body: 'Unauthorized' };
        return j(200, { jsonrpc: '2.0', id: b.id ?? 1, error: { code: -32601, message: 'Method not found' } });
    }
  }
  function keymanager(w, n, req) {
    const vc = n.eth.c.vc;
    if (!running(vc) || w.t < vc.readyAt) return refused(req.host, 5052);
    if (!/^https:/.test(req.url)) return { error: 52, msg: 'Empty reply from server' };
    if (req.path !== '/eth/v1/keystores') return j(404, { code: 404, message: 'Not found' });
    const ro = n.eth.stack !== 'stereum';
    if (req.method === 'GET') return j(200, { data: (vc.keys || []).map(pk => ({ validating_pubkey: pk, derivation_path: 'm/12381/3600/0/0/0', readonly: ro })) });
    if (req.method === 'DELETE') {
      let pks; try { pks = JSON.parse(req.body || '{}').pubkeys; } catch (x) { pks = null; }
      if (!Array.isArray(pks)) return j(400, { code: 400, message: 'Invalid body: expected {"pubkeys": [...]}' });
      const data = pks.map(pk => {
        if ((vc.keys || []).includes(pk)) {
          if (ro) return { status: 'error', message: `Unable to delete validator ${pk}: it was loaded from the command line (read-only)` };
          vc.keys = vc.keys.filter(k => k !== pk);
          S.fsRemove(n, `${keyDir(n)}/${pk}.json`); S.fsRemove(n, pwPath(n, `${pk}.json`));
          tlog(w, n, vc, 'INFO', `Removed validator ${pk.slice(0, 10)}… via the key manager API`);
          return { status: 'deleted' };
        }
        return spGet(w, n, vcData(n), pk) !== null ? { status: 'not_active' } : { status: 'not_found' };
      });
      const ic = interchange(w, n, vcData(n), pks.filter((pk, i) => data[i].status !== 'not_found' && data[i].status !== 'error'));
      S.lesson(w, 'kmdelete', S.LL('删除钥匙同时导出保护记录', 'Deleting a key also exports its protection history'), S.LL('Keymanager API 的 <code>DELETE /eth/v1/keystores</code> 会让客户端立即停止使用这把钥匙，并在同一个响应里返回它的 EIP-3076 slashing protection 记录。停止签名和导出记录一步完成，中间不会再多签一次。', 'The Keymanager API call <code>DELETE /eth/v1/keystores</code> makes the client stop using the key at once and returns its EIP-3076 slashing protection history in the same response. Signing stops and the history is exported in one step, with no chance of one more signature in between.'));
      return j(200, { data, slashing_protection: JSON.stringify(ic) });
    }
    if (req.method === 'POST') return j(400, { code: 400, message: 'Invalid body: keystores and passwords are required' });
    return j(405, { code: 405, message: 'Method not allowed' });
  }
  async function http(w, host, req, ctx) {
    const local = req.host === 'localhost' || req.host === '127.0.0.1';
    if (req.host === 'checkip.amazonaws.com') return { status: 200, body: (host.ip || '203.0.113.50') + '\n' };
    if (req.host === 'beaconcha.in' && /^\/api\/v1\/validator\//.test(req.path)) {
      const m = /^\/api\/v1\/validator\/(\w+)(\/attestations)?$/.exec(req.path);
      const v = m && w.chain.vals.find(x => String(x.index) === m[1] || x.pubkey === m[1]);
      if (!v) return j(200, { status: 'ERROR: invalid validator argument', data: null });
      if (m[2]) {
        const h = v.hist.slice(-10).reverse();
        return j(200, { status: 'OK', data: h.map(x => ({ attesterslot: dutySlot(v, x.e), committeeindex: (v.index + x.e) % 64, epoch: x.e, inclusionslot: x.hit ? dutySlot(v, x.e) + 1 : 0, status: x.hit ? 1 : 0, validatorindex: v.index })) });
      }
      return j(200, { status: 'OK', data: { activationeligibilityepoch: v.activation - 7, activationepoch: v.activation, balance: Math.round(v.bal), effectivebalance: 32000000000, exitepoch: v.slashed != null ? v.slashed + 260 : 9223372036854775807, pubkey: v.pubkey, slashed: v.slashed != null, status: v.slashed != null ? 'slashed' : 'active_online', validatorindex: v.index, withdrawableepoch: 9223372036854775807, withdrawalcredentials: '0x010000000000000000000000' + v.withdrawal } });
    }
    if (!local || !host.eth) return null;
    const port = String(req.port || '80');
    if (port === '5051') return beaconApi(w, host, req, ctx);
    if (port === '8545') return besuRpc(w, host, req);
    if (port === '8551') return ready(w, host.eth.c.el) ? { status: 401, body: 'Unauthorized' } : refused(req.host, 8551);
    if (port === '5052') return keymanager(w, host, req);
    if (port === '18550') return running(host.eth.c.mev) ? j(200, {}) : refused(req.host, 18550);
    if (port === '9090' && host.eth.stack === 'stereum') return req.path === '/-/ready' ? { status: 200, body: 'Prometheus Server is Ready.\n' } : j(200, { status: 'success', data: { resultType: 'vector', result: [] } });
    return refused(req.host, port);
  }

  /* ---------- commands ---------- */
  const err = (out, code = 1) => ({ code, out: out.endsWith('\n') ? out : out + '\n' });
  const gray = s => C.gray(s);
  function findComp(n, ref) {
    if (!ref) return null;
    const all = Object.values(n.eth.c).filter(c => c && !c.removed && c.kind === 'docker');
    return all.find(c => c.name === ref || c.name === '/' + ref) || (ref.length >= 3 ? all.find(c => c.id.startsWith(ref)) : null) || null;
  }
  function dockerStatus(w, c) {
    if (c.state === 'running') return `Up ${dockerDur(w.t - c.startedAt)}`;
    if (c.state === 'restarting') return `Restarting (${c.exitCode}) ${dockerDur(w.t - c.since)} ago`;
    return `Exited (${c.exitCode}) ${dockerDur(w.t - c.since)} ago`;
  }
  function dockerPortsCol(c) {
    if (c.state !== 'running') return '';
    return c.ports.map(p => { const m = /^(.*):(\d+):(\d+)\/(\w+)$/.exec(p); return m ? `${m[1]}:${m[2]}->${m[3]}/${m[4]}` : p; }).join(', ');
  }
  function fmtTemplate(tpl, obj) {
    return tpl.replace(/\\t/g, '\t').replace(/\{\{\s*(json\s+)?\.([\w.]+)\s*\}\}/g, (_, js, path) => {
      let v = obj; path.split('.').forEach(k => { v = v == null ? undefined : v[k]; });
      if (js) return JSON.stringify(v);
      return v === undefined ? '<no value>' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  function psRow(w, c) {
    const full = `${c.entry} ${c.cfg.args.join(' ')}`;
    return { ID: c.id.slice(0, 12), Image: c.cfg.image, Command: `"${full}"`, CommandShort: `"${full.slice(0, 19)}…"`, CreatedAt: S.fmtClock(new Date(w.base + c.createdAt * 1000)), RunningFor: `${dockerDur(w.t - c.createdAt)} ago`, Status: dockerStatus(w, c), State: c.state, Ports: dockerPortsCol(c), Names: c.name };
  }
  function inspectObj(w, n, c) {
    const iso = t => new Date(w.base + t * 1000).toISOString();
    return {
      Id: c.id, Created: iso(c.createdAt), Path: c.entry, Args: c.cfg.args,
      State: { Status: c.state, Running: c.state === 'running', Paused: false, Restarting: c.state === 'restarting', OOMKilled: false, Dead: false, Pid: c.state === 'running' ? c.pid : 0, ExitCode: c.exitCode, Error: '', StartedAt: iso(c.startedAt ?? c.createdAt), FinishedAt: c.state === 'running' ? '0001-01-01T00:00:00Z' : iso(c.since) },
      Image: 'sha256:' + hx(c.cfg.image), Name: '/' + c.name, RestartCount: c.restarts,
      HostConfig: { RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }, NetworkMode: 'stereum' },
      Mounts: c.vols.map(v => { const [src, dst] = v.split(':'); return { Type: 'bind', Source: src, Destination: dst, RW: !/:ro/.test(v) }; }),
      Config: { Hostname: c.id.slice(0, 12), User: '2000', Image: c.cfg.image, Cmd: c.cfg.args, Entrypoint: [c.entry], Labels: { 'stereum.service': c.svcType } },
    };
  }
  const DOCKER_HELP_ = () => gray(S.L('本练习支持：docker ps [-a] [--format …] · logs [--tail N] [--since 1h] NAME · inspect NAME [--format …] · restart|stop|start [-t N] NAME · rm [-f] NAME · run --rm --volumes-from VC consensys/teku:TAG slashing-protection export …', 'Available in this lab: docker ps [-a] [--format …] · logs [--tail N] [--since 1h] NAME · inspect NAME [--format …] · restart|stop|start [-t N] NAME · rm [-f] NAME · run --rm --volumes-from VC consensys/teku:TAG slashing-protection export …'));
  const docker = async ctx => {
    const n = ctx.host, w = ctx.w;
    if (!n.eth || n.eth.stack !== 'stereum') return err(`bash: docker: command not found ${gray(S.L('（这台机器的客户端由 systemd 管理：systemctl status besu teku-beacon teku-vc）', '(the clients on this host run under systemd: systemctl status besu teku-beacon teku-vc)'))}`, 127);
    if (!ctx.isRoot) return err('permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json": dial unix /var/run/docker.sock: connect: permission denied');
    const a = ctx.args.slice(), sub = a.shift();
    const fmt = S.opt(a, ['--format', '-f']);
    switch (sub) {
      case undefined: case '--help': return 'Usage:  docker [OPTIONS] COMMAND\n\n' + DOCKER_HELP_() + '\n';
      case 'ps': {
        const all = S.hasFlag(a, '-a') || a.includes('--all');
        const list = Object.values(n.eth.c).filter(c => c && !c.removed && (all || c.state === 'running' || c.state === 'restarting'));
        const rows = list.map(c => psRow(w, c));
        if (fmt) {
          const table = fmt.startsWith('table ');
          const tpl = table ? fmt.slice(6) : fmt;
          const lines = rows.map(r => fmtTemplate(tpl, r).split('\t'));
          if (!table) return lines.map(l => l.join('\t').replace(/\t/g, '  ')).join('\n') + (lines.length ? '\n' : '');
          const head = fmtTemplate(tpl.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_, k) => ({ ID: 'CONTAINER ID', Image: 'IMAGE', Command: 'COMMAND', CreatedAt: 'CREATED AT', RunningFor: 'CREATED', Status: 'STATUS', State: 'STATE', Ports: 'PORTS', Names: 'NAMES' }[k] || k.toUpperCase())), {}).split('\t');
          return S.table(lines, head) + '\n';
        }
        return S.table(rows.map(r => [r.ID, r.Image, r.CommandShort, r.RunningFor, r.Status, r.Ports, r.Names]), ['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES']) + '\n';
      }
      case 'logs': {
        const tail = S.opt(a, ['--tail', '-n']), since = S.opt(a, ['--since']);
        const ref = a.filter((x, i) => !x.startsWith('-') && !['--tail', '-n', '--since'].includes(a[i - 1])).pop();
        const c = findComp(n, ref);
        if (!c) return err(`Error response from daemon: No such container: ${ref || ''}`);
        let es = (n.journal[c.name] || []).filter(e => e.level !== 'SYS');
        if (since) { const m = /^(\d+)(s|m|h)$/.exec(since); if (m) { const sec = +m[1] * ({ s: 1, m: 60, h: 3600 })[m[2]]; es = es.filter(e => e.t >= w.t - sec); } }
        if (tail && tail !== 'all') es = es.slice(-parseInt(tail, 10));
        else if (!tail) es = es.slice(-400);
        const out = es.map(e => e.msg).join('\n');
        if (c.role === 'cl' && c.restarts > 3) S.lesson(w, 'flap', S.LL('反复重启会骗过存活检查', 'A crash loop fools liveness checks'), S.LL('容器每 45 秒左右重启一次，每次都短暂地"活着"。基于 <code>up == 0 for 2m</code> 的告警从来凑不满 2 分钟，基于瞬时值加 <code>for</code> 窗口的告警也会被抓取间隙一次次清零。只有看链是否前进的规则（<code>increase(eth_head_slot[15m]) == 0</code>）不受间隙影响。', 'The container restarts about every 45 seconds and is briefly "up" each time. An alert on <code>up == 0 for 2m</code> never collects two straight minutes, and alerts on instant values with a <code>for</code> window keep being reset by the scrape gaps. Only a rule that asks whether the chain advances (<code>increase(eth_head_slot[15m]) == 0</code>) is immune to the gaps.'));
        return out ? out + '\n' : '';
      }
      case 'inspect': {
        const refs = a.filter((x, i) => !x.startsWith('-') && !['--format', '-f'].includes(a[i - 1]));
        const cs = refs.map(r => findComp(n, r));
        if (!refs.length) return err('"docker inspect" requires at least 1 argument.');
        if (cs.some(x => !x)) return err(`Error: No such object: ${refs[cs.findIndex(x => !x)]}`);
        const objs = cs.map(c => inspectObj(w, n, c));
        if (fmt) return objs.map(o => fmtTemplate(fmt, o)).join('\n') + '\n';
        return JSON.stringify(objs, null, 4) + '\n';
      }
      case 'restart': case 'stop': case 'start': case 'kill': {
        const refs = a.filter((x, i) => !x.startsWith('-') && !['-t', '--time', '-s'].includes(a[i - 1]));
        if (!refs.length) return err(`"docker ${sub}" requires at least 1 argument.`);
        let out = '', code = 0;
        for (const r of refs) {
          const c = findComp(n, r);
          if (!c) { out += `Error response from daemon: No such container: ${r}\n`; code = 1; continue; }
          if (sub !== 'start') await ctx.sleep(c.role === 'el' ? 8 : 3);
          if (c.role === 'vc' && sub !== 'start') S.flag(w, 'vc_restart');
          if (sub === 'stop' || sub === 'kill') { if (c.state !== 'exited') stop(w, n, c, sub === 'kill' ? 137 : 143); }
          else if (sub === 'start') { if (c.state !== 'running') start(w, n, c); }
          else { stop(w, n, c); start(w, n, c); }
          if (c.role === 'cl' && sub !== 'stop') {
            const y = parseSvcYaml(S.fsRead(w, n, svcYamlPath(c)));
            if (JSON.stringify(y.args) !== JSON.stringify(c.cfg.args)) S.lesson(w, 'reread', S.LL('docker restart 不会重读服务定义', 'docker restart does not re-read the service definition'), S.LL('容器的启动参数是在创建时确定的。修改 <code>/etc/stereum/services/&lt;id&gt;.yaml</code> 之后，<code>docker restart</code> 仍然用旧参数启动。要让修改生效，必须按服务定义重建容器。', 'A container\'s arguments are fixed when it is created. After editing <code>/etc/stereum/services/&lt;id&gt;.yaml</code>, <code>docker restart</code> still starts it with the old arguments. The container has to be recreated from the service definition for the change to apply.'));
          }
          out += r + '\n';
        }
        return { code, out };
      }
      case 'rm': {
        const force = S.hasFlag(a, '-f') || a.includes('--force');
        const refs = a.filter(x => !x.startsWith('-'));
        let out = '', code = 0;
        for (const r of refs) {
          const c = findComp(n, r);
          if (!c) { out += `Error response from daemon: No such container: ${r}\n`; code = 1; continue; }
          if (c.state === 'running' && !force) { out += `Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove\n`; code = 1; continue; }
          if (c.role === 'vc') S.flag(w, 'vc_restart');
          if (c.state === 'running') stop(w, n, c, 137);
          c.removed = true; c.keys = [];
          out += r + '\n';
        }
        return { code, out };
      }
      case 'run': {
        const vf = S.opt(a, ['--volumes-from']);
        const iSub = a.indexOf('slashing-protection');
        const image = a.find(x => /^consensys\/teku(:|$)/.test(x));
        if (!vf || iSub < 0 || !image) return err(`docker: ${S.L('本练习的 docker run 只用于一次性的客户端命令。', 'in this lab docker run is only for one-off client commands.')}\n${DOCKER_HELP_()}`, 125);
        const c = findComp(n, vf);
        if (!c) return err(`docker: Error response from daemon: No such container: ${vf}.`, 125);
        const rest = a.slice(iSub + 1), op = rest[0];
        const dp = flagVal(rest, '--data-path', null);
        const hostOf = p => { const mnt = c.vols.map(v => v.split(':')).find(([, dst]) => p === dst || p.startsWith(dst + '/')); return mnt ? mnt[0] + p.slice(mnt[1].length) : null; };
        if (!dp) return err('Missing required option: \'--data-path=<PATH>\'', 2);
        const hdp = hostOf(dp);
        await ctx.sleep(6);
        if (op === 'export') {
          const to = flagVal(rest, '--to', null); if (!to) return err('Missing required option: \'--to=<FILE>\'', 2);
          const hto = hostOf(to); if (!hto) return err(`Unable to write ${to}: No such file or directory`, 1);
          const pks = S.fsList(n, spDir(hdp)).filter(f => f.endsWith('.yml')).map(f => '0x' + f.replace(/\.yml$/, ''));
          S.fsWrite(n, hto, JSON.stringify(interchange(w, n, hdp, pks)) + '\n', { owner: '2000' });
          return `Exporting slashing protection database...\nSlashing protection data written to ${to}\n${running(c) ? C.yellow(`WARNING: ${c.name} is still running and may sign again after this export\n`) : ''}`;
        }
        if (op === 'import') {
          const from = flagVal(rest, '--from', null); const hf = from && hostOf(from); const t = hf && S.fsRead(w, n, hf);
          if (t == null) return err(`Unable to read ${from}: No such file or directory`);
          const r = importInterchange(w, n, hdp, t); if (r.error) return err(r.error);
          return `Reading slashing protection data from ${from}\nUpdated ${r.done.length} validator slashing protection records\n`;
        }
        return err(`Unknown subcommand '${op || ''}'. Did you mean: export, import?`, 2);
      }
      case 'exec': case 'compose': case 'images': case 'pull': case 'update': case 'network': case 'volume': case 'stats': case 'top':
        return err(DOCKER_HELP_());
      default: return err(`docker: '${sub}' is not a docker command.\nSee 'docker --help'`);
    }
  };
  const stereumRecreate = async ctx => {
    const n = ctx.host, w = ctx.w, ref = (ctx.args[0] || '').replace(/^stereum-/, '').replace(/\.yaml$/, '').replace(/^.*\//, '');
    if (!ref || ref === '--help' || ref === '-h') return 'usage: stereum-recreate <service-id | stereum-<service-id>>\n  Recreates the container from /etc/stereum/services/<service-id>.yaml (same name, network and volumes).\n';
    if (!ctx.isRoot) return err('stereum-recreate: must be run as root');
    const c = Object.values(n.eth.c).find(x => x && x.uuid === ref);
    if (!c) return err(`stereum-recreate: no such service: /etc/stereum/services/${ref}.yaml`);
    const y = S.fsRead(w, n, svcYamlPath(c)); const cfg = parseSvcYaml(y);
    ctx.write(`stereum-recreate: reading ${svcYamlPath(c)}\nstereum-recreate: image ${cfg.image}, ${cfg.args.length} command args\nstereum-recreate: docker rm -f ${c.name}\n`);
    await ctx.sleep(c.role === 'el' ? 10 : 4);
    const r = recreate(w, n, c);
    if (r.error) return err('stereum-recreate: ' + r.error);
    return `stereum-recreate: docker run -d --name ${c.name} --network stereum --restart unless-stopped ${c.vols.map(v => '-v ' + v).join(' ')} ${cfg.image} ${cfg.args.join(' ')}\n${c.id}\n`;
  };
  async function tekuCli(ctx) {
    const n = ctx.host, w = ctx.w, a = ctx.args;
    if (a.includes('--version')) return `teku/v${n.eth.c.cl.version}/linux-x86_64/-eclipseadoptium-openjdk64bit-java-21\n`;
    if (a[0] !== 'slashing-protection') return err(gray(S.L('teku 由 systemd 管理：systemctl status|restart teku-beacon / teku-vc。离线命令：teku slashing-protection export|import --data-path=… --to|--from=…', 'teku runs under systemd: systemctl status|restart teku-beacon / teku-vc. Offline commands: teku slashing-protection export|import --data-path=… --to|--from=…')));
    const op = a[1], dp = flagVal(a, '--data-path', null);
    if (!dp) return err('Missing required option: \'--data-path=<PATH>\'', 2);
    if (!ctx.isRoot) return err(`Unable to access ${dp}: Permission denied`);
    await ctx.sleep(4);
    if (op === 'export') {
      const to = flagVal(a, '--to', null); if (!to) return err('Missing required option: \'--to=<FILE>\'', 2);
      const pks = S.fsList(n, spDir(ctx.resolve(dp))).filter(f => f.endsWith('.yml')).map(f => '0x' + f.replace(/\.yml$/, ''));
      S.fsWrite(n, ctx.resolve(to), JSON.stringify(interchange(w, n, ctx.resolve(dp), pks)) + '\n');
      return `Exporting slashing protection database...\nSlashing protection data written to ${to}\n`;
    }
    if (op === 'import') {
      const from = flagVal(a, '--from', null); if (!from) return err('Missing required option: \'--from=<FILE>\'', 2);
      const t = ctx.read(from); if (t === null) return err(`Unable to read ${from}: No such file or directory`);
      const r = importInterchange(w, n, ctx.resolve(dp), t); if (r.error) return err(r.error);
      if (ctx.resolve(dp) === vcData(n) && r.done.length) S.lesson(w, 'eip3076', S.LL('EIP-3076：带着记录迁移', 'EIP-3076: move the history with the key'), S.LL('验证者客户端只拒绝和自己数据库里的记录相冲突的签名。新机器上的数据库是空的，它不知道旧机器签过什么。EIP-3076 interchange 文件把旧机器上每把钥匙最后签过的 source/target epoch 带过来，导入之后，新客户端不会签出与之冲突的证明。', 'A validator client only refuses signatures that conflict with records in its own database. The database on a new machine is empty and knows nothing about what the old one signed. An EIP-3076 interchange file carries the last signed source and target epochs of each key across; after the import the new client will not sign an attestation that conflicts with them.'));
      return `Reading slashing protection data from ${from}\nUpdated ${r.done.length} validator slashing protection records\n`;
    }
    return err(`Unknown subcommand '${op || ''}'. Did you mean: export, import, repair?`, 2);
  }
  const awk = ctx => {
    let a = ctx.args.slice(), sep = null;
    if (a[0] === '-F') { sep = a[1]; a = a.slice(2); } else if (a[0] && a[0].startsWith('-F')) { sep = a[0].slice(2); a = a.slice(1); }
    const prog = a[0] || '';
    const m = /^\s*((?:!?\/[^/]*\/\s*(?:&&\s*)?)*)\s*(?:\{(.*)\})?\s*$/.exec(prog);
    if (!m) return err(`awk: syntax error in program: ${prog}`, 2);
    const conds = [...(m[1] || '').matchAll(/(!?)\/([^/]*)\//g)].map(x => ({ neg: !!x[1], re: new RegExp(x[2]) }));
    const acts = (m[2] === undefined ? 'print' : m[2]).split(';').map(s => s.trim()).filter(Boolean);
    const text = a[1] ? ctx.read(a[1]) : ctx.stdin;
    if (text === null) return err(`awk: cannot open "${a[1]}" (No such file or directory)`, 2);
    let out = '';
    for (const line of String(text).replace(/\n$/, '').split('\n')) {
      if (!line && !text) continue;
      if (!conds.every(c => c.re.test(line) !== c.neg)) continue;
      const f = sep ? line.split(sep) : line.trim().split(/\s+/);
      let stop = false;
      for (const act of acts) {
        if (act === 'exit') { stop = true; break; }
        const pm = /^print\s*(.*)$/.exec(act);
        if (!pm) return err(`awk: unsupported statement: ${act}`, 2);
        out += (pm[1] ? pm[1].split(/\s*,\s*/).map(x => x === '$0' ? line : /^\$\d+$/.test(x) ? (f[+x.slice(1) - 1] ?? '') : x === '$NF' ? f[f.length - 1] : x.replace(/^"|"$/g, '')).join(' ') : line) + '\n';
      }
      if (stop) break;
    }
    return out;
  };
  const df = ctx => {
    const ms = ctx.host.mounts || [[ctx.host.disk.dev || '/dev/root', ctx.host.disk.size, ctx.host.disk.used, '/']];
    const h = S.hasFlag(ctx.args, '-h');
    const f = v => h ? (v >= 1000 ? (v / 1024).toFixed(1) + 'T' : v + 'G') : String(v * 1024 * 1024);
    const want = ctx.args.filter(x => !x.startsWith('-'));
    const mountOf = p => ms.filter(m => m[3] === '/' || p === m[3] || p.startsWith(m[3] + '/')).sort((a, b) => b[3].length - a[3].length)[0];
    const sel = want.length ? [...new Set(want.map(p => mountOf(ctx.resolve(p))))] : ms;
    const rows = sel.map(m => [m[0], f(m[1]), f(m[2]), f(m[1] - m[2]), Math.round(m[2] / m[1] * 100) + '%', m[3]]);
    if (!want.length) rows.push(['tmpfs', h ? '32G' : '32826968', '0', h ? '32G' : '32826968', '0%', '/dev/shm']);
    return S.table(rows, ['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on']) + '\n';
  };
  df.hidden = true;
  const crontab = ctx => {
    if (!S.hasFlag(ctx.args, '-l')) return err(gray(S.L('本练习只支持 crontab -l', 'only crontab -l is available in this lab')));
    if (!ctx.isRoot || !ctx.host.crontab) return err(`no crontab for ${ctx.sess.user}`);
    return ctx.host.crontab;
  };
  // timers are not services in the core shell; handle the watchdog timer here and pass the rest through
  const systemctl = async ctx => {
    const n = ctx.host, T = n.eth && n.eth.timer;
    const pos = ctx.args.filter(x => !x.startsWith('-')), sub = pos[0], units = pos.slice(1);
    const now = ctx.args.includes('--now');
    const isTimer = u => /\.timer$/.test(u);
    if (sub === 'list-timers') {
      const rows = [];
      if (T && T.active) rows.push([S.fmtDate(new Date(ctx.w.base + T.next * 1000)), `${S.fmtDur(Math.max(0, T.next - ctx.w.t))} left`, S.fmtDate(new Date(ctx.w.base + T.lastRun * 1000)), `${S.fmtDur(ctx.w.t - T.lastRun)} ago`, 'eth-engine-watchdog.timer', 'eth-engine-watchdog.service']);
      rows.push(['Wed 2026-10-07 00:00:00 UTC', '-', 'Tue 2026-10-06 00:00:01 UTC', '-', 'logrotate.timer', 'logrotate.service']);
      return S.table(rows, ['NEXT', 'LEFT', 'LAST', 'PASSED', 'UNIT', 'ACTIVATES']) + `\n${rows.length} timers listed.\n`;
    }
    if (!units.some(isTimer)) return S.commands.systemctl(ctx);
    const u = units.find(isTimer);
    if (!T || u !== 'eth-engine-watchdog.timer') return { code: sub === 'status' ? 4 : 5, out: `Unit ${u} could not be found.\n` };
    const w = ctx.w;
    const needRoot = ['start', 'stop', 'restart', 'enable', 'disable'];
    if (needRoot.includes(sub) && !ctx.isRoot) return err(`Failed to ${sub} ${u}: Access denied ${gray(S.L('（需要 root：先 sudo -i，或在命令前加 sudo）', '(needs root: sudo -i first, or prefix with sudo)'))}`);
    const startT = () => { if (!T.active) { T.active = true; T.since = w.t; T.next = w.t + 5; sysLog(w, n, 'eth-engine-watchdog', 'Started eth-engine-watchdog.timer - Run eth-engine-watchdog every 2 minutes.'); } };
    switch (sub) {
      case 'status': {
        const since = S.fmtDate(new Date(w.base + T.since * 1000)) + `; ${S.fmtDur(w.t - T.since)} ago`;
        return { code: T.active ? 0 : 3, out: `${T.active ? C.green('●') : '○'} eth-engine-watchdog.timer - Run eth-engine-watchdog every 2 minutes\n     Loaded: loaded (/etc/systemd/system/eth-engine-watchdog.timer; ${T.enabled ? 'enabled' : 'disabled'}; preset: enabled)\n     Active: ${T.active ? C.green('active (waiting)') : 'inactive (dead)'} since ${since}\n    Trigger: ${T.active ? `${S.fmtDate(new Date(w.base + T.next * 1000))}; ${S.fmtDur(Math.max(0, T.next - w.t))} left` : 'n/a'}\n   Triggers: ● eth-engine-watchdog.service\n` };
      }
      case 'is-active': return { code: T.active ? 0 : 3, out: (T.active ? 'active' : 'inactive') + '\n' };
      case 'is-enabled': return { code: T.enabled ? 0 : 1, out: (T.enabled ? 'enabled' : 'disabled') + '\n' };
      case 'start': case 'restart': startT(); return '';
      case 'stop': T.active = false; T.since = w.t; sysLog(w, n, 'eth-engine-watchdog', 'Stopped eth-engine-watchdog.timer.'); return '';
      case 'enable': T.enabled = true; if (now) startT(); return `Created symlink /etc/systemd/system/timers.target.wants/eth-engine-watchdog.timer → /etc/systemd/system/eth-engine-watchdog.timer.\n`;
      case 'disable': T.enabled = false; if (now) { T.active = false; T.since = w.t; } return 'Removed "/etc/systemd/system/timers.target.wants/eth-engine-watchdog.timer".\n';
      default: return S.commands.systemctl(ctx);
    }
  };
  systemctl.hidden = true;
  const aws = async ctx => {
    const f = ctx.flags, [svc, op, a1, a2] = f._;
    const w = ctx.w, s3 = w.chain.s3;
    if (svc === 's3' && op === 'ls') {
      const pre = (a1 || '').replace(/\/?$/, '/');
      if (!a1) return '2026-03-02 10:14:07 example-eth-ops\n';
      const keys = Object.keys(s3).filter(k => k.startsWith(pre));
      return keys.map(k => `${S.fmtClock(new Date(w.base + s3[k].t * 1000)).slice(0, 19)} ${String(s3[k].c.length).padStart(10)} ${k.slice(pre.length)}`).join('\n') + (keys.length ? '\n' : '');
    }
    if (svc === 's3' && op === 'cp') {
      if (!a1 || !a2) return err('usage: aws s3 cp <LocalPath> <S3Uri> or <S3Uri> <LocalPath>', 252);
      await ctx.sleep(1);
      if (/^s3:\/\//.test(a1)) {
        const o = s3[a1];
        if (!o) return err(`fatal error: An error occurred (404) when calling the HeadObject operation: Key "${a1.replace(/^s3:\/\/[^/]+\//, '')}" does not exist`);
        let dst = ctx.resolve(a2); if (S.fsIsDir(ctx.host, dst) && !S.fsGet(ctx.host, dst)) dst = S.norm(dst + '/' + a1.slice(a1.lastIndexOf('/') + 1));
        if (!ctx.sh.canWrite(dst)) return err(`download failed: ${a1} to ${a2} [Errno 13] Permission denied: '${dst}'`);
        S.fsWrite(ctx.host, dst, o.c, { owner: ctx.sess.user === 'root' ? 'root' : ctx.sess.user });
        return `download: ${a1} to ${a2}\n`;
      }
      if (!/^s3:\/\/example-eth-ops\//.test(a2)) return err(`upload failed: ${a1} to ${a2} An error occurred (AccessDenied) when calling the PutObject operation: Access Denied`);
      const c = ctx.read(a1);
      if (c === null) return err(`The user-provided path ${a1} does not exist.`, 255);
      if (!ctx.sh.canRead(ctx.resolve(a1))) return err(`upload failed: ${a1} to ${a2} [Errno 13] Permission denied: '${ctx.resolve(a1)}'`);
      const key = a2.endsWith('/') ? a2 + a1.slice(a1.lastIndexOf('/') + 1) : a2;
      s3[key] = { c, t: w.t, from: ctx.host.id };
      return `upload: ${a1} to ${key}\n`;
    }
    return err(gray(S.L('节点上可用：aws s3 ls s3://example-eth-ops/… · aws s3 cp 源 目标', 'Available on the node: aws s3 ls s3://example-eth-ops/… · aws s3 cp SRC DST')), 2);
  };
  const nodeCommands = { docker, aws, awk, crontab, df, systemctl };

  function findNode(w, key) { return Object.values(w.nodes).find(n => n.id === key || n.instanceId === key || n.hostname === key); }
  function openSession(ctx, n) {
    ctx.sh.push({ host: n, user: 'ssm-user', cwd: '/home/ssm-user', env: { HOME: '/home/ssm-user', USER: 'ssm-user' } });
    return `\nStarting session with SessionId: ops-${n.id}-0a1b2c3d\n${gray(S.L(`已登录 ${n.hostname}（${n.region}）。sudo -i 切换到 root，exit 退出。`, `Connected to ${n.hostname} (${n.region}). sudo -i for root, exit to leave.`))}\n`;
  }
  const laptopCommands = {
    ssm: ctx => {
      const n = findNode(ctx.w, ctx.args[0]);
      if (!n) return err(`${S.L('用法：ssm <节点名>。可选节点：', 'usage: ssm <node>. Nodes: ')}${Object.keys(ctx.w.nodes).join(' ')}`);
      return openSession(ctx, n);
    },
    aws: ctx => {
      const f = ctx.flags, [svc, op] = f._;
      if (svc === 'sts' && op === 'get-caller-identity') return JSON.stringify({ UserId: 'AROAEXAMPLE7ONCALL:ops', Account: '111122223333', Arn: 'arn:aws:sts::111122223333:assumed-role/oncall-operator/ops' }, null, 4) + '\n';
      if (svc === 'ssm' && op === 'start-session') {
        const n = findNode(ctx.w, f.target);
        if (!n) return err(`\nAn error occurred (InvalidInstanceId) when calling the StartSession operation: ${f.target || '(missing --target)'} is not a valid instance id`, 254);
        if ((f.region || 'us-east-1') !== n.region) return err(`\nAn error occurred (TargetNotConnected) when calling the StartSession operation: ${n.instanceId} is not connected.\n${gray(S.L(`（这台实例在 ${n.region}，加上 --region ${n.region}）`, `(this instance is in ${n.region}; add --region ${n.region})`))}`, 254);
        return openSession(ctx, n);
      }
      if (svc === 'ec2' && op === 'describe-instances') {
        const region = f.region || 'us-east-1';
        const rows = Object.values(ctx.w.nodes).filter(n => n.region === region).map(n => [n.hostname, n.instanceId, n.ip, 'm6i.4xlarge', 'running']);
        if (!rows.length) return gray(S.L(`（${region} 没有实例。节点所在区域：`, `(no instances in ${region}. Nodes run in: `) + [...new Set(Object.values(ctx.w.nodes).map(n => n.region))].join(', ') + S.L('）', ')')) + '\n';
        return S.table(rows, ['Name', 'InstanceId', 'PublicIpAddress', 'InstanceType', 'State']) + '\n';
      }
      return err(gray(S.L('本练习支持：', 'Available in this lab: ') + 'aws sts get-caller-identity · aws ec2 describe-instances --region R · aws ssm start-session --region R --target ID'), 2);
    },
  };

  /* ---------- alert rules (names, thresholds and for: from alerting/chain/ethereum.yaml) ---------- */
  const nodesOf = w => Object.values(w.nodes);
  const R = (name, severity, forSec, fn) => ({ name, severity, for: forSec, check: w => nodesOf(w).flatMap(n => { const s = fn(w, n, view(w, n)); return s ? [{ instance: n.hostname, summary: s }] : []; }) });
  const rules = [
    R('EthCollectorScrapeFailing', 'warning', 600, (w, n) => n.services['eth-collector'].state !== 'active' && `eth metrics collector is failing to scrape on ${n.hostname}`),
    R('EthExecutionDown', 'critical', 120, (w, n) => !ready(w, n.eth.c.el) && w.t - (n.eth.c.el.since ?? 0) > 15 && `Besu execution client is down on ${n.hostname}`),
    R('EthExecutionStalled', 'critical', 300, (w, n) => ready(w, n.eth.c.el) && w.t - n.eth.elLastAdv >= 600 && `Execution layer has imported no blocks for 10 minutes on ${n.hostname}`),
    R('EthWatchdogRecovered', 'warning', 0, (w, n) => n.eth.timer && n.eth.timer.acted != null && `Engine watchdog restarted the consensus client on ${n.hostname}`),
    R('EthWatchdogEscalated', 'critical', 300, (w, n) => n.eth.timer && n.eth.timer.escalated && `Engine watchdog will NOT auto-recover ${n.hostname} - human needed (${n.eth.timer.escalated})`),
    R('EthWatchdogStale', 'warning', 600, (w, n) => n.eth.timer && w.t - n.eth.timer.lastRun > 900 && `Engine watchdog has not run for 15 minutes on ${n.hostname}`),
    R('EthValidatorClientDown', 'critical', 300, (w, n) => !ready(w, n.eth.c.vc) && n.eth.c.vc.monitored !== false && `Teku validator client is down on ${n.hostname}`),
    R('EthMevBoostDown', 'warning', 600, (w, n) => !running(n.eth.c.mev) && `mev-boost is down on ${n.hostname}`),
    R('EthExecutionNotSynced', 'warning', 900, (w, n, V) => V.clUp && V.optimistic && `Besu is not fully synced on ${n.hostname}`),
    R('EthBeaconSyncing', 'warning', 1800, (w, n, V) => V.clUp && V.syncing && `Teku beacon node is syncing on ${n.hostname}`),
    R('EthBeaconSlotsBehind', 'warning', 600, (w, n, V) => V.clUp && V.dist > 32 && `Teku is more than one epoch behind on ${n.hostname}`),
    R('EthBeaconSlotsSignificantlyBehind', 'critical', 300, (w, n, V) => V.clUp && V.dist > 225 && `Teku is more than one finality period behind on ${n.hostname}`),
    R('EthHeadSlotStalled', 'critical', 600, (w, n) => w.t - n.eth.clLastAdv >= 900 && w.t - n.eth.headSeenAt < 900 && `Beacon head slot has stopped advancing on ${n.hostname}`),
    { name: 'EthValidatorEfficiencyLow', severity: 'critical', for: 1800, check: w => w.chain.vals.filter(v => efficiency(v) < 93).map(v => ({ instance: v.lastSigner || v.home, summary: `Ethereum validator efficiency ${efficiency(v).toFixed(1)}% - eth index ${v.index} on ${v.lastSigner || v.home}` })) },
  ];

  /* ---------- side panel ---------- */
  const cell = (bg, title, extra = '') => `<i title="${title}" style="display:inline-block;width:9px;height:14px;margin-right:2px;border-radius:2px;background:${bg};${extra}"></i>`;
  const panel = {
    mount(el) {
      el.innerHTML = `<div class="mech-head"></div><div class="eth-clock" style="margin:-.2rem 0 .6rem"></div><div class="avx-grid eth-nodes"></div><div class="avx-grid eth-vals" style="margin-top:.5rem"></div><p class="mech-note">${S.L('每个 slot 12 秒，32 个 slot 为一个 epoch。beacon 节点通过 Engine API 驱动 Besu 导入区块。每个验证者每个 epoch 有一次证明任务（时钟条上的圆点）：绿色为按时打包，红色为错过，灰色为尚未到来。', 'A slot is 12 seconds and an epoch is 32 slots. The beacon node drives Besu over the Engine API to import blocks. Each validator has one attestation duty per epoch (the dot on the clock strip): green is included on time, red is missed, grey has not happened yet.')}</p>`;
    },
    update(el, w) {
      const L = S.L, ns = netSlot(w), e = ep(ns), idx = ns % SPE;
      el.querySelector('.mech-head').innerHTML = `<span class="mh-k">mainnet · epoch ${e.toLocaleString('en-US')}</span><span class="mh-v">slot ${idx + 1}/32</span><span class="mh-s">${L('网络 head', 'network head')} ${ns.toLocaleString('en-US')} · ${L('已最终确定', 'finalized')} epoch ${(e - 2).toLocaleString('en-US')}</span>`;
      const duties = new Set(w.chain.vals.map(v => dutySlot(v, e) % SPE));
      el.querySelector('.eth-clock').innerHTML = Array.from({ length: SPE }, (_, i) => cell(i < idx ? 'var(--line-2)' : i === idx ? 'var(--blue)' : 'var(--panel-3)', `slot ${e * SPE + i}`, duties.has(i) ? 'box-shadow:inset 0 -4px 0 var(--amber)' : '')).join('');
      el.querySelector('.eth-nodes').innerHTML = Object.values(w.nodes).map(n => {
        const E = n.eth, V = view(w, n), cl = E.c.cl, el2 = E.c.el, vc = E.c.vc;
        let st, cls;
        if (!cl || cl.removed || cl.state === 'exited' || cl.state === 'inactive' || cl.state === 'failed') { st = L('beacon 已停止', 'beacon stopped'); cls = 'bad'; }
        else if (cl.state === 'restarting' || cl.state === 'activating' || cl.crashAt != null) { st = L(`beacon 反复崩溃 ×${cl.restarts}`, `beacon crash loop ×${cl.restarts}`); cls = 'bad'; }
        else if (cl.hung) { st = L('beacon 无响应', 'beacon hung'); cls = 'bad'; }
        else if (!V.clUp) { st = L('beacon 启动中', 'beacon starting'); cls = 'warn'; }
        else if (V.elOffline) { st = L('执行层离线', 'EL offline'); cls = 'bad'; }
        else if (V.syncing) { st = L(`追赶中，落后 ${V.dist} slot`, `catching up, ${V.dist} slots behind`); cls = 'warn'; }
        else { st = L('已同步', 'in sync'); cls = 'ok'; }
        const elStall = Math.round(w.t - E.elLastAdv);
        const vcSt = !running(vc) ? (vc && vc.state === 'failed' ? 'failed' : L('已停止', 'stopped')) : w.t < vc.readyAt ? L('启动中', 'starting') : vc.dopEnd != null ? L(`doppelganger 检测，剩 ${Math.max(0, vc.dopEnd - ns)} slot`, `doppelganger wait, ${Math.max(0, vc.dopEnd - ns)} slots`) : L(`${(vc.keys || []).length} 把钥匙`, `${(vc.keys || []).length} key(s)`);
        return `<div class="avx-node ${cls}">
          <div class="an-top"><b>${n.id}</b><span class="an-reg">${E.stack === 'stereum' ? 'Stereum · docker' : 'systemd'}</span><span class="pill ${cls}">${st}</span></div>
          <div class="an-row"><span>EL besu ${el2.version}</span><b class="mono ${ready(w, el2) ? (elStall >= 120 ? 'warnc' : '') : 'badc'}">${ready(w, el2) ? '#' + E.elHead.toLocaleString('en-US') : L('离线', 'down')}</b><span>${L('上次导入', 'last import')}</span><b class="mono ${elStall >= 120 ? 'badc' : ''}">${elStall < 24 ? L('刚刚', 'just now') : S.fmtDur(elStall) + L('前', ' ago')}</b></div>
          <div class="an-row"><span>CL teku ${cl ? cl.version : ''}</span><b class="mono">${V.clUp ? 'slot ' + V.head.toLocaleString('en-US') : '—'}</b><span>${L('落后', 'behind')}</span><b class="mono ${V.clUp && V.dist > 32 ? 'badc' : ''}">${V.clUp ? V.dist + ' slot' : '?'}</b></div>
          <div class="an-row"><span>VC</span><b class="mono ${running(vc) ? '' : 'badc'}">${vcSt}</b><span>${L('已最终确定', 'finalized')}</span><b class="mono">${V.clUp ? 'epoch ' + V.finalized.toLocaleString('en-US') : '?'}</b></div>
        </div>`;
      }).join('');
      el.querySelector('.eth-vals').innerHTML = w.chain.vals.map(v => {
        const recent = v.hist.slice(-15);
        const cells = recent.map(x => cell(x.slashed ? '#b36bff' : x.hit ? 'var(--lime)' : 'var(--red)', `epoch ${x.e}: ${x.slashed ? 'slashed' : x.hit ? 'included' + (x.by ? ' · ' + x.by : '') : 'missed'}`)).join('') + cell('var(--panel-3)', `epoch ${v.next}: ${L('待执行', 'pending')}`, 'outline:1px dashed var(--line-2)');
        const eff = efficiency(v), d = (v.bal - v.bal0) / 1e9;
        const signers = signerHosts(w, v).map(n => n.id);
        const cls = v.slashed != null ? 'bad' : signers.length > 1 ? 'bad' : recent.length && !recent[recent.length - 1].hit ? 'warn' : 'ok';
        return `<div class="avx-node ${cls}">
          <div class="an-top"><b>${L('验证者', 'validator')} ${v.index}</b><span class="an-reg mono">${short(v.pubkey)}</span><span class="pill ${cls}">${v.slashed != null ? 'slashed' : signers.length ? L('签名方 ', 'signer ') + signers.join(' + ') : L('无人签名', 'no signer')}</span></div>
          <div style="margin-top:.4rem;line-height:0">${cells}</div>
          <div class="an-row"><span>${L('1 天效率', '1-day efficiency')}</span><b class="mono ${eff < 93 ? 'badc' : eff < 98 ? 'warnc' : 'okc'}">${eff.toFixed(1)}%</b><span>${L('本次余额变化', 'balance change')}</span><b class="mono ${d < 0 ? 'badc' : 'okc'}">${d >= 0 ? '+' : ''}${d.toFixed(6)} ETH</b></div>
          <div class="an-row"><span>${L('本次命中', 'hits')}</span><b class="mono">${w.chain.hitsLab}</b><span>${L('本次错过', 'misses')}</span><b class="mono ${w.chain.missLab ? 'badc' : ''}">${w.chain.missLab}</b></div>
        </div>`;
      }).join('');
    },
  };

  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#627EEA"/><g fill="#fff"><path fill-opacity=".6" d="M16.5 4v8.87l7.5 3.35z"/><path d="M16.5 4 9 16.22l7.5-3.35z"/><path fill-opacity=".6" d="M16.5 21.97V28l7.5-10.38z"/><path d="M16.5 28v-6.03L9 17.62z"/><path fill-opacity=".2" d="m16.5 20.57 7.5-4.35-7.5-3.35z"/><path fill-opacity=".6" d="m9 16.22 7.5 4.35v-7.7z"/></g></svg>';

  /* ---------- registration ---------- */
  const HOSTS = {
    'eth-01': { id: 'eth-01', instanceId: 'i-0d4e6f8a0b2c4e6f1', region: 'us-west-2', ip: '198.51.100.31', stack: 'stereum' },
    'eth-02': { id: 'eth-02', instanceId: 'i-0e5f7a9b1c3d5e7f2', region: 'us-west-2', ip: '198.51.100.32', stack: 'systemd' },
  };
  const VAL = { index: 1234567, pubkey: '0x8a1f3c5e7b9d2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e6b8d0f1a3c5e7b9d2f4a6c8e0b1d', withdrawal: '7f3a9c1e5b2d8f4a6c0e9b7d3f1a5c8e2b4d6f90', activation: 298114 };

  S.registerNetwork({
    id: 'ethereum', name: 'Ethereum', color: '#7cc4ff', logo: LOGO,
    desc: S.LL('Besu 与 Teku 验证者：slot 与 epoch、Engine API 把共识层和执行层连在一起、证明任务与效率、同步与追赶、slashing 保护与钥匙迁移。', 'Besu and Teku validators: slots and epochs, the Engine API that links the consensus and execution clients, attestation duties and efficiency, sync and catch-up, slashing protection and moving a key.'),
    init(w, cfg) {
      w.chain = { vals: [], s3: {}, hitsLab: 0, missLab: 0 };
      (cfg.hosts || []).forEach(hc => {
        const sp = Object.assign({}, HOSTS[hc.id], hc);
        w.nodes[sp.id] = makeNode(w, sp);
        boot(w, w.nodes[sp.id], sp);
      });
      const ns = netSlot(w), e0 = ep(ns);
      const v = Object.assign({ hist: [], everSigned: true, home: cfg.keyOn, lastSigner: cfg.keyOn }, VAL);
      v.bal = v.bal0 = 32004137112;
      v.next = dutySlot(v, e0) + 1 <= ns ? e0 + 1 : e0;
      const missed = cfg.missedEpochs || 0;
      for (let e = v.next - WINDOW; e < v.next; e++) { const miss = e >= v.next - missed || (cfg.scatter && (e * 37) % 101 === 0); v.hist.push({ e, hit: !miss, by: miss ? null : cfg.keyOn }); }
      v.bal0 = v.bal;
      w.chain.vals.push(v);
      // key material and slashing protection on the host that holds the key
      Object.values(w.nodes).forEach(n => {
        const E = n.eth, vc = E.c.vc, holds = n.id === cfg.keyOn;
        const lastSigned = v.next - 1 - (holds ? (missed ? missed : 0) : 0);
        if (holds) {
          (v.lastBy = v.lastBy || {})[n.id] = lastSigned;
          if (E.stack === 'stereum') { S.fsWrite(n, `${keyDir(n)}/${v.pubkey}.json`, keystoreJson(v), { mode: '600', owner: '2000' }); S.fsWrite(n, pwPath(n, `${v.pubkey}.json`), hx('pw' + v.pubkey, 40) + '\n', { mode: '600', owner: '2000' }); }
          else { const f = 'keystore-m_12381_3600_0_0_0-1739518246'; S.fsWrite(n, `${keyDir(n)}/${f}.json`, keystoreJson(v), { mode: '600', owner: 'teku' }); S.fsWrite(n, `${keyDir(n)}/${f}.txt`, hx('pw' + v.pubkey, 40) + '\n', { mode: '600', owner: 'teku' }); }
          spSet(w, n, vcData(n), v.pubkey, lastSigned);
          if (running(vc)) { vc.keys = [v.pubkey]; vc.dopEnd = null; }
        }
        // replay recent history into the logs so docker logs / journalctl look lived-in
        if (running(vc)) {
          for (let k = Math.max(0, v.hist.length - 6); k < v.hist.length; k++) {
            const x = v.hist[k], ds = dutySlot(v, x.e), t = (GENESIS + ds * SPS) - w.base / 1000;
            if (!holds) continue;
            const r = hx('root' + ds);
            preLog(w, n, vc.name, t, x.hit ? 'INFO' : 'WARN', x.hit ? tekuLine(w, t, 'INFO', `Validator   *** Published attestation        Count: 1, Slot: ${ds}, Root: ${r.slice(0, 4)}..${r.slice(-4)}`) : tekuLine(w, t, 'WARN', `Validator   *** Failed to produce attestation  Slot: ${ds}  Validator: ${v.pubkey.slice(2, 8)}  Reason: ${cfg.missReason || 'Beacon node is syncing'}`));
          }
        }
      });
    },
    tick, http, rules, nodeCommands, laptopCommands, panel,
    serviceAction(w, h, s, action) {
      if (!h.eth) return;
      const c = Object.values(h.eth.c).find(x => x && x.svc === s);
      if (!c) {
        if (s.name === 'eth-engine-watchdog') { if (action !== 'stop') runWatchdog(w, h, 'manual'); return; }
        if (s.legacy) {
          if (action === 'stop') return;
          s.state = 'failed'; s.since = w.t;
          S.log(w, h, s.name, 'ERROR', `${s.name === 'besu' ? 'Besu' : 'Teku'} failed to start: java.net.BindException: Address already in use (${s.name === 'besu' ? 'tcp/30303' : 'tcp/9001'})`);
          S.log(w, h, s.name, 'SYS', `${s.name}.service: Main process exited, code=exited, status=1/FAILURE`);
          return;
        }
        if (action === 'stop') s.state = 'inactive'; else { s.state = 'active'; s.since = w.t; }
        return;
      }
      if (c.role === 'vc' && action !== 'start') S.flag(w, 'vc_restart');
      if (c.role === 'vc' && action === 'start' && c.state !== 'running') S.flag(w, 'vc_restart');
      if (action === 'stop') { sysLog(w, h, c.name, `Stopping ${c.name}.service - ${s.desc}...`); stop(w, h, c); }
      else if (action === 'start') { if (!running(c)) start(w, h, c); }
      else restart(w, h, c);
    },
    onFileChanged(w, h, p) {
      if (!h.eth || !/^\/etc\/stereum\/services\/[\w-]+\.yaml$/.test(p)) return;
      const t = S.fsRead(w, h, p);
      if (t && t.includes('\\n')) S.fsWrite(h, p, t.replace(/\\n/g, '\n'));
    },
    onRemoved(w, h, p) {
      if (!h.eth) return;
      const E = h.eth, st = E.stack === 'stereum';
      const dbs = [
        { dir: st ? `${ST}/teku-${E.c.cl.uuid}/data/beacon` : '/var/lib/teku-beacon/beacon', what: 'cl' },
        { dir: st ? `${ST}/besu-${E.c.el.uuid}/data/database` : '/var/lib/besu/database', what: 'el' },
        { dir: spDir(vcData(h)), what: 'sp' },
      ];
      dbs.forEach(d => {
        if (!(p === d.dir || p.startsWith(d.dir + '/') || d.dir.startsWith(p + '/'))) return;
        if (Object.keys(h.fs).some(k => k.startsWith(d.dir + '/'))) return;
        if ((E.wiped = E.wiped || {})[d.what]) return;
        E.wiped[d.what] = true; S.flag(w, 'wipe_db');
        if (d.what === 'cl') E.cpSync = true;
        if (d.what === 'el') E.elWipedAt = w.t;
      });
    },
    helpers: {
      view, efficiency, attestingFrom, running, ready, netSlot, ep, keysOnDisk, spGet: (w, n, pk) => spGet(w, n, vcData(n), pk), clPorts, parseSvcYaml, svcYamlPath,
      portsOf, preLog, tekuLine, besuLine, tsAt, blockAt, hx, dutySlot,
      val: w => w.chain.vals[0], lastEntry: w => { const v = w.chain.vals[0]; return v.hist[v.hist.length - 1]; },
    },
  });
})(SIM);
