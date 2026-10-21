/* ============================================================
   Network plugin: Avalanche (Primary Network validator, avalanchego)
   Mechanisms modelled:
   - binary version vs on-disk database version (migration, codec crash)
   - network upgrade activation with a minimum version (Helicon / 1.15.0)
   - replay after (re)start, health checks, P-Chain uptime as seen by others
   - advertised public-ip vs actual IP (reachability on 9651)
   ============================================================ */
(function (S) {
  'use strict';
  const C = S.C;
  const MIN = '1.15.0';
  const BINP = '/usr/local/bin/avalanchego';
  const CFGP = '/etc/avalanche/config.json';
  const DB = '/home/ubuntu/.avalanchego/db';
  const STAKING = '/home/ubuntu/.avalanchego/staking';
  const REPLAY_RATE = 13.5;          // blocks / sim second while replaying (12,923 blocks ≈ 16 min)
  const MIGRATION_BLOCKS = 12923;
  const dbv = v => (S.semverCmp(v, MIN) >= 0 ? 'v1.4.6' : 'v1.4.5');
  const BIN = v => `\x7fELF avalanchego/${v} [database=${dbv(v)}, rpcchainvm=${S.semverCmp(v, MIN) >= 0 ? 46 : 45}, go=1.25.10]`;
  const binVer = c => { const m = /avalanchego\/(\d+\.\d+\.\d+)/.exec(c || ''); return m ? m[1] : null; };
  const TARBALL = v => 'TARBALL:' + JSON.stringify({ files: { [`avalanchego-v${v}/avalanchego`]: { c: BIN(v), mode: '755' } } });

  /* ---------- helpers on node state ---------- */
  const av = n => n.av;
  const svc = n => n.services.avalanchego;
  const act = w => w.chain.activation;
  const cfg = (w, n) => { try { return JSON.parse(S.fsRead(w, n, CFGP)); } catch (e) { return null; } };
  const cfgIp = (w, n) => (cfg(w, n) || {})['public-ip'];
  const versionOk = (w, n) => act(w) === null || w.t < act(w) || (av(n).running && S.semverCmp(av(n).running, MIN) >= 0);
  const ipOk = (w, n) => cfgIp(w, n) === n.ip && !n.sgBlocked;
  const active = n => svc(n).state === 'active';
  const connected = (w, n) => active(n) && versionOk(w, n) && ipOk(w, n);
  const healthy = (w, n) => active(n) && av(n).replay <= 0 && versionOk(w, n) && ipOk(w, n);
  const uptimePct = n => 100 * (1 - av(n).up.down / av(n).up.elapsed);
  const projected = n => 100 * (1 - av(n).up.down / av(n).up.period);
  const tip = w => Math.floor(w.chain.cHeight0 + w.t / 2);
  function healthChecks(w, n) {
    const ok = m => ({ message: m, timestamp: S.isoTime(w.now()), duration: 12034, contiguousFailures: 0, timeOfFirstFailure: null });
    const bad = (e, since) => ({ error: e, timestamp: S.isoTime(w.now()), duration: 9087, contiguousFailures: Math.max(1, Math.floor((w.t - since) / 30)), timeOfFirstFailure: S.isoTime(new Date(w.base + since * 1000)) });
    const s = svc(n), c = {};
    c.bls = ok({ blsKey: 'matches registered key' });
    c.database = ok(null);
    c.diskspace = ok({ availableDiskBytes: (n.disk.size - n.disk.used) * 1073741824 });
    c.bootstrapped = av(n).replay > 0 ? bad(`chains not bootstrapped: [C] (executing blocks, ${Math.round(av(n).replay)} remaining)`, s.since) : ok([]);
    if (!versionOk(w, n)) c.network = bad(`node version avalanchego/${av(n).running} is incompatible with activated network upgrade ${w.chain.upgrade} (requires >= ${MIN})`, act(w));
    else if (!ipOk(w, n)) c.network = bad('primary network validator has no inbound connections', s.since);
    else c.network = ok({ connectedPeers: av(n).peers, timeSinceLastMsgReceived: '153ms', timeSinceLastMsgSent: '98ms', sendFailRate: 0 });
    c.C = av(n).replay > 0 ? bad('not yet run', s.since) : ok({ consensus: { outstandingBlocks: 0 } });
    c.P = ok({ consensus: { outstandingBlocks: 0 } });
    c.X = ok({ consensus: { outstandingBlocks: 0 } });
    c.router = ok({ longestRunningRequest: '0s', outstandingRequests: 0 });
    return c;
  }
  const firstFailing = (w, n) => { if (!active(n)) return svc(n).state === 'activating' ? 'avalanchego is not running (restart loop, exit-code)' : 'avalanchego is not running'; const c = healthChecks(w, n); const k = Object.keys(c).find(k => c[k].error); return k ? `${k}: ${c[k].error}` : 'process not running'; };

  function log(w, n, level, msg) { S.log(w, n, 'avalanchego', level, `${level === 'FATAL' ? 'FATAL' : level.padEnd(5)} ${msg}`); }
  function sysLog(w, n, msg) { S.log(w, n, 'avalanchego', 'SYS', msg); }

  /* ---------- process lifecycle ---------- */
  function start(w, n) {
    const s = svc(n), a = av(n);
    s.pid = 1000 + Math.floor(w.rand() * 30000);
    s.since = w.t;
    const binFile = S.fsGet(n, BINP);
    const ver = binVer(S.fsRead(w, n, BINP));
    if (!ver) { sysLog(w, n, `avalanchego.service: Failed at step EXEC spawning ${BINP}: No such file or directory`); return crash(w, n, 203); }
    const c = cfg(w, n);
    if (!c) { log(w, n, 'FATAL', `couldn't load node config: invalid character in ${CFGP} (check JSON syntax)`); return crash(w, n, 1); }
    if (!S.fsGet(n, STAKING + '/staker.crt') || !S.fsGet(n, STAKING + '/signer.key')) {
      log(w, n, 'FATAL', `couldn't initialize staking: open ${STAKING}/staker.crt: no such file or directory`);
      S.flag(w, 'lost_identity');
      return crash(w, n, 1);
    }
    log(w, n, 'INFO', `<main> app/app.go:183 initializing node {"version": "avalanchego/${ver}", "commit": "a3f40fd", "nodeID": "${n.nodeID}"}`);
    if (a.db && S.semverCmp(ver, a.db) < 0) {
      log(w, n, 'INFO', '<main> chains/manager.go:301 creating chain {"subnetID": "11111111111111111111111111111111LpoYY", "chainID": "11111111111111111111111111111111LpoYY"}');
      log(w, n, 'FATAL', 'chains/manager.go:393 error creating required chain error while creating new snowman vm failed to load the database state: unknown codec version');
      a.codecCrashes++;
      if (binFile && binFile.by === 'user') S.flag(w, 'rollback');
      S.lesson(w, 'codec', S.LL('数据库只能向前迁移', 'The database only moves forward'), S.LL('新版本第一次启动时，会把数据库转换成新格式。旧版本的二进制读不了新格式，启动即退出，报 <code>unknown codec version</code>。解决办法是重新装上新版本，不需要删除数据库重新同步。', 'The first start of a new release converts the database to a new format. An older binary cannot read it and exits at startup with <code>unknown codec version</code>. The fix is to install the newer release again; there is no need to wipe and resync.'));
      return crash(w, n, 1);
    }
    if (!a.db || S.semverCmp(ver, a.db) > 0) {
      if (!a.db) { log(w, n, 'INFO', '<main> database is empty — starting state sync from peers'); a.replay += 22 * 3600 * REPLAY_RATE; }
      else { log(w, n, 'INFO', `<main> database/manager.go:88 migrating database ${dbv(a.db)} → ${dbv(ver)} (${w.chain.upgrade})`); a.replay += MIGRATION_BLOCKS; }
      a.db = ver;
      S.lesson(w, 'replay', S.LL('重启后的区块重放', 'Replaying blocks after a restart'), S.LL('节点启动后要先追上停机期间产生的区块，升级时还要先完成数据库迁移。这段时间 /ext/health 会报告不健康，日志里持续出现 executing block。这是正常过程，等待即可，不要回滚，也不要反复重启。', 'After a start the node has to catch up on the blocks it missed, and after an upgrade it first migrates the database. During that time /ext/health reports unhealthy and the log keeps printing executing block. This is expected. Wait for it; do not roll back and do not keep restarting.'));
    } else {
      const down = a.stoppedAt != null ? Math.max(0, w.t - a.stoppedAt) : 0;
      a.replay += 120 + Math.round(down / 2);
    }
    s.state = 'active'; a.running = ver; a.lastProgressLog = w.t; a.stoppedAt = null;
    log(w, n, 'INFO', `<main> node/node.go:1490 node started {"publicIP": "${c['public-ip']}", "stakingPort": 9651, "replayingBlocks": ${Math.round(a.replay)}}`);
    return null;
  }
  function crash(w, n, code) {
    const s = svc(n), a = av(n);
    s.state = 'activating'; s.exitStatus = code; s.restarts = (s.restarts || 0) + 1;
    a.running = null; a.nextRestart = w.t + 5; a.stoppedAt = a.stoppedAt ?? w.t;
    sysLog(w, n, `avalanchego.service: Main process exited, code=exited, status=${code}/FAILURE`);
    sysLog(w, n, 'avalanchego.service: Failed with result \'exit-code\'.');
    return null;
  }
  function stop(w, n) {
    const s = svc(n), a = av(n);
    if (s.state === 'active') { log(w, n, 'INFO', '<main> received signal: terminated — shutting down'); log(w, n, 'INFO', '<main> node/node.go:1601 finished node shutdown'); }
    a.stoppedAt = s.state === 'active' ? w.t : (a.stoppedAt ?? w.t);
    s.state = 'inactive'; a.running = null; s.since = w.t;
    sysLog(w, n, 'avalanchego.service: Deactivated successfully.');
  }
  function restart(w, n) { stop(w, n); sysLog(w, n, 'Started avalanchego.service - Avalanche Node.'); start(w, n); }

  /* ---------- world setup ---------- */
  function makeNode(w, sp) {
    const n = S.makeHost({
      id: sp.moniker, moniker: sp.moniker, hostname: `validator-${sp.moniker}`, instanceId: sp.instanceId, region: sp.region,
      ip: sp.ip, probeIp: sp.probeIp || sp.ip, nodeID: sp.nodeID, kind: 'node', homeUser: 'ubuntu',
      mem: { total: sp.memGB * 1024, used: Math.round(sp.memGB * 1024 * 0.48) }, disk: { size: 1664, used: 1302, dev: '/dev/nvme0n1p1' },
      instanceType: sp.type, upBase: 86400 * 6, bootAt: 0,
    });
    n.av = {
      db: sp.db, running: null, replay: 0, peers: sp.peers || 2370, stoppedAt: null, nextRestart: null, codecCrashes: 0,
      validator: sp.validator !== false, offline: 0, lastWarn: -1e9, lastErr: -1e9, lastIpWarn: -1e9, lastInfo: 0,
      up: { elapsed: sp.elapsedDays * 86400, down: sp.downHours * 3600, period: sp.periodDays * 86400 }, potentialReward: sp.reward, weight: sp.weight,
    };
    S.fsWrite(n, BINP, BIN(sp.bin), { mode: '755', owner: 'root', size: 98234112 });
    S.fsWrite(n, CFGP, JSON.stringify({ 'network-id': 'mainnet', 'public-ip': sp.cfgIp || sp.ip, 'http-host': '127.0.0.1', 'db-dir': DB, 'sybil-protection-enabled': true, 'staking-port': 9651, 'api-admin-enabled': true, 'api-health-enabled': true, 'api-info-enabled': true }, null, 2) + '\n');
    S.fsWrite(n, '/etc/systemd/system/avalanchego.service', `[Unit]\nDescription=Avalanche Node\nWants=network-online.target\nAfter=network-online.target\nRequiresMountsFor=${DB}\n\n[Service]\nUser=ubuntu\nGroup=ubuntu\nType=simple\nExecStart=${BINP} --config-file=${CFGP}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=120\nLimitNOFILE=32768\n\n[Install]\nWantedBy=multi-user.target\n`);
    ['staker.crt', 'staker.key', 'signer.key'].forEach(f => S.fsWrite(n, `${STAKING}/${f}`, f === 'staker.crt' ? '-----BEGIN CERTIFICATE-----\nMIIFNzCCAx+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAAMCAXDTk5MTIzMTAwMDAw\n(simulated)\n-----END CERTIFICATE-----\n' : f === 'staker.key' ? '-----BEGIN PRIVATE KEY-----\n(simulated — never print a real private key)\n-----END PRIVATE KEY-----\n' : '(32-byte BLS secret key, binary)', { mode: '400', owner: 'ubuntu' }));
    S.fsWrite(n, '/home/ubuntu/.avalanchego/configs/chains/C/config.json', '{"state-sync-enabled": true}\n', { owner: 'ubuntu' });
    S.fsWrite(n, `${DB}/mainnet/v1.4.5/MANIFEST-004211`, '(leveldb manifest)', { owner: 'ubuntu', size: 1114 });
    S.fsWrite(n, '/home/ubuntu/.avalanchego/logs/main.log', (w2, h) => (h.journal.avalanchego || []).filter(e => e.level !== 'SYS').slice(-200).map(e => `[${S.fmtLogTime(new Date(w2.base + e.t * 1000))}] ${e.msg}`).join('\n') + '\n', { owner: 'ubuntu' });
    if (sp.tmpBinary) S.fsWrite(n, `/tmp/avalanchego-v${sp.tmpBinary}/avalanchego`, BIN(sp.tmpBinary), { mode: '755', owner: 'root' });
    if (sp.prevBin) S.fsWrite(n, BINP + '.prev', BIN(sp.prevBin), { mode: '755', owner: 'root' });
    n.dirs.add('/tmp'); n.dirs.add('/root'); n.dirs.add('/home/ssm-user');
    const exec = `${BINP} --config-file=${CFGP}`;
    n.services.avalanchego = { name: 'avalanchego', desc: 'Avalanche Node', unitPath: '/etc/systemd/system/avalanchego.service', state: 'inactive', since: -86400 * 6, pid: 1542, exec, restarts: 0, memStr: () => `${(n.mem.used / 1024 * 0.8).toFixed(1)}G`, tasks: 31 };
    n.services['avalanche-collector'] = { name: 'avalanche-collector', desc: 'Avalanche Metrics Collector', unitPath: '/etc/systemd/system/avalanche-collector.service', state: 'active', since: -86400 * 6, pid: 1610, exec: '/bin/bash /opt/avalanche-collector/collector.sh' };
    n.services['grafana-agent'] = { name: 'grafana-agent', desc: 'Monitoring system and forwarder', unitPath: '/usr/lib/systemd/system/grafana-agent.service', state: 'active', since: -86400 * 6, pid: 1622, exec: '/usr/bin/grafana-agent --config.file /etc/grafana-agent.yaml' };
    n.services['amazon-ssm-agent'] = { name: 'amazon-ssm-agent', desc: 'amazon-ssm-agent', unitPath: '/etc/systemd/system/amazon-ssm-agent.service', state: 'active', since: -86400 * 6, pid: 812, exec: '/usr/bin/amazon-ssm-agent' };
    n.isBusy = (w2, p) => p === BINP && active(n);
    n.procs = w2 => active(n) ? [{ user: 'ubuntu', pid: svc(n).pid, cpu: av(n).replay > 0 ? '312' : '41.2', mem: '48.1', cmd: svc(n).exec }] : [];
    n.listening = w2 => active(n) ? [{ addr: '127.0.0.1:9650', proc: 'avalanchego', pid: svc(n).pid }, { addr: '*:9651', proc: 'avalanchego', pid: svc(n).pid }, { addr: '*:9101', proc: 'nc', pid: 1610 }] : [{ addr: '*:9101', proc: 'nc', pid: 1610 }];
    // boot state
    if (sp.start !== false) {
      start(w, n);
      if (sp.replay !== undefined) av(n).replay = sp.replay; else av(n).replay = 0;
      if (sp.stoppedAt !== undefined) av(n).stoppedAt = sp.stoppedAt;
      svc(n).since = sp.since ?? -86400 * 6; svc(n).pid = sp.pid || 1542;
      (n.journal.avalanchego || []).forEach(e => { e.t = svc(n).since; });
    }
    return n;
  }

  /* ---------- tick ---------- */
  function tick(w, dt) {
    const A = act(w);
    if (A !== null && w.t - dt < A && w.t >= A) {
      S.event(w, 'sys', S.LL(`<b>${w.chain.upgrade} 已激活</b>（${S.fmtClock(w.now())}）。低于 ${MIN} 的节点不再参与验证。`, `<b>${w.chain.upgrade} activated</b> (${S.fmtClock(w.now())}). Nodes below ${MIN} no longer validate.`));
      if (Object.values(w.nodes).some(n => !versionOk(w, n))) S.lesson(w, 'activation', S.LL('网络升级的截止时间', 'Network upgrade deadlines'), S.LL('激活之后，版本低于要求的节点会被其他验证者断开，在 P-Chain 上被记为离线。在线率由其他验证者记录，从这一刻起按分钟累计损失。', 'Once the upgrade activates, peers disconnect nodes below the required version and the P-Chain records them as offline. Other validators keep that record, so uptime is now being lost minute by minute.'));
    }
    Object.values(w.nodes).forEach(n => {
      const s = svc(n), a = av(n);
      if (s.state === 'activating' && w.t >= a.nextRestart) {
        sysLog(w, n, `avalanchego.service: Scheduled restart job, restart counter is at ${s.restarts}.`);
        sysLog(w, n, 'Started avalanchego.service - Avalanche Node.');
        start(w, n);
      }
      if (s.state === 'active') {
        if (a.replay > 0) {
          a.replay = Math.max(0, a.replay - REPLAY_RATE * dt);
          if (w.t - a.lastProgressLog >= 20 || a.replay === 0) {
            a.lastProgressLog = w.t;
            if (a.replay > 0) log(w, n, 'INFO', `<C Chain> core/blockchain.go:1652 executing block {"height": ${tip(w) - Math.round(a.replay)}, "remaining": ${Math.round(a.replay)}}`);
            else { log(w, n, 'INFO', '<C Chain> bootstrapping finished; snowman consensus started'); log(w, n, 'INFO', '<main> health/health.go:142 health check passed'); }
          }
        }
        if (!versionOk(w, n)) {
          if (w.t - a.lastErr >= 30) { a.lastErr = w.t; log(w, n, 'ERROR', `<P Chain> network/peer.go:1022 dropping peer: incompatible version (local avalanchego/${a.running}, network requires >= ${MIN})`); }
        } else if (A !== null && w.t < A && a.running && S.semverCmp(a.running, MIN) < 0 && A - w.t < 6 * 3600 && w.t - a.lastWarn >= 300) {
          a.lastWarn = w.t; log(w, n, 'WARN', `<main> imminent network upgrade - update immediately: ${w.chain.upgrade} activates at ${S.fmtClock(new Date(w.base + A * 1000))}, this node runs avalanchego/${a.running}`);
        }
        if (!ipOk(w, n) && w.t - s.since > 60 && w.t - a.lastIpWarn >= 120) { a.lastIpWarn = w.t; log(w, n, 'WARN', `<main> health/health.go:256 health check failing {"check": "network", "error": "primary network validator has no inbound connections", "advertisedIP": "${cfgIp(w, n)}"}`); }
        if (healthy(w, n) && w.t - a.lastInfo >= 120) { a.lastInfo = w.t; log(w, n, 'INFO', `<P Chain> snowman/transitive.go:418 consensus accepted block {"height": ${Math.floor(25028167 + w.t / 3)}}`); }
      }
      a.up.elapsed += dt;
      if (a.validator && !connected(w, n)) { a.up.down += dt; a.offline += dt; }
      w.stats.offline[n.id] = a.offline;
    });
  }

  /* ---------- HTTP ---------- */
  const rpc = (id, result) => ({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', result, id: id ?? 1 }) });
  const rpcErr = (id, msg) => ({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: msg }, id: id ?? 1 }) });
  function validatorRecord(w, n, selfView) {
    return {
      txID: '2bmkBkPzUYJpHtvq7jTRpjZzQcMhZ4cJ6V5ZpAEjnXMk3tUoJz', startTime: String(Math.floor((w.base / 1000) - av(n).up.elapsed + w.t)),
      endTime: String(Math.floor(w.base / 1000 + (av(n).up.period - av(n).up.elapsed) + w.t)), weight: String(av(n).weight * 1e9), nodeID: n.nodeID,
      uptime: selfView ? (99.9 + w.rand() * 0.09).toFixed(4) : uptimePct(n).toFixed(4), connected: selfView ? true : connected(w, n),
      potentialReward: String(av(n).potentialReward * 1e9), delegationFee: '2.0000',
    };
  }
  async function http(w, host, req, ctx) {
    const nodes = Object.values(w.nodes);
    if (req.host === 'checkip.amazonaws.com') return { status: 200, body: (host.ip || '203.0.113.50') + '\n' };
    if (req.host === 'github.com' && /\/ava-labs\/avalanchego\/releases\/download\//.test(req.path)) {
      const m = /v(\d+\.\d+\.\d+)\/avalanchego-linux-amd64-v\1\.tar\.gz$/.exec(req.path);
      if (!m || !['1.14.1', '1.14.2', '1.15.0'].includes(m[1])) return { status: 404, body: 'Not Found' };
      return { status: 200, body: TARBALL(m[1]), size: 41943040, wait: 4 };
    }
    if (req.host === 'api.avax.network') {
      if (req.path === '/ext/bc/P' && req.json && req.json.method === 'platform.getCurrentValidators') {
        const ids = (req.json.params && req.json.params.nodeIDs) || null;
        const list = nodes.filter(n => av(n).validator && (!ids || ids.includes(n.nodeID))).map(n => validatorRecord(w, n, false));
        S.lesson(w, 'indep', S.LL('在线率由其他验证者记录', 'Uptime is measured by other validators'), S.LL('api.avax.network 返回的 <code>uptime</code> 和 <code>connected</code> 来自网络中的其他节点。质押期结束时，奖励按这个视角判定。', 'The <code>uptime</code> and <code>connected</code> values from api.avax.network come from other nodes on the network. Rewards are decided from this view when the staking period ends.'));
        return rpc(req.json.id, { validators: list });
      }
      if (req.path === '/ext/bc/C/rpc') return rpc(req.json && req.json.id, '0x' + tip(w).toString(16));
      return { status: 404, body: '404 page not found' };
    }
    if ((req.host === '127.0.0.1' || req.host === 'localhost') && host.kind === 'node' && host.av) {
      const n = host;
      if (String(req.port || '80') !== '9650') return { error: 7, msg: `Failed to connect to ${req.host} port ${req.port || 80} after 0 ms: Couldn't connect to server` };
      if (!active(n)) return { error: 7, msg: 'Failed to connect to 127.0.0.1 port 9650 after 0 ms: Couldn\'t connect to server' };
      if (req.path.startsWith('/ext/health')) {
        if (req.path.endsWith('/liveness')) return { status: 200, body: JSON.stringify({ checks: {}, healthy: true }) };
        const checks = healthChecks(w, n), ok = healthy(w, n);
        return { status: ok ? 200 : 503, body: JSON.stringify({ checks, healthy: ok }) };
      }
      const j = req.json || {}, p = j.params || {};
      if (req.path === '/ext/info') {
        switch (j.method) {
          case 'info.isBootstrapped': return rpc(j.id, { isBootstrapped: !(p.chain === 'C' && av(n).replay > 0) });
          case 'info.peers': return rpc(j.id, { numPeers: String(versionOk(w, n) ? av(n).peers : 41), peers: [] });
          case 'info.getNodeID': return rpc(j.id, { nodeID: n.nodeID, nodePOP: { publicKey: '0x8f95423f7142d00a48e1014a3de8d28907d420dc33b3052a6dee03a3f2941a393c2351e354704ca66a3fc29870282e15', proofOfPossession: '0x86a3ab4c45cfe31cae34c1d06f212434ac71b1be6cfe046c80c162e057614a94a5bc9f1ded1a7029deb0ba4ca7c9b71411e293438691be79c2dbf19d1ca7c3eadb9c756246fc5de5b7b89511c7d7302ae051d9e03d7991138299b5ed6a570a98' } });
          case 'info.getNodeVersion': return rpc(j.id, { version: `avalanchego/${av(n).running}`, databaseVersion: dbv(av(n).running), rpcProtocolVersion: S.semverCmp(av(n).running, MIN) >= 0 ? '46' : '45', gitCommit: 'a3f40fd0738eb65398346cdbc7bb18d93e2a60d5', vmVersions: { avm: 'v1.15.0', evm: 'v0.15.4', platform: 'v1.15.0' } });
          case 'info.getNodeIP': return rpc(j.id, { ip: `${cfgIp(w, n)}:9651` });
          case 'info.uptime':
            S.lesson(w, 'infouptime', S.LL('info.uptime 衡量的是网络', 'info.uptime measures the network'), S.LL('rewardingStakePercentage 表示本节点能看到多少质押在线，它反映的是网络整体状况，而不是本节点的在线率。用它做告警，会在其他验证者掉线时让整个节点群一起误报。查看自己的在线率，请向独立节点调用 <code>platform.getCurrentValidators</code>。', 'rewardingStakePercentage is how much stake this node can see online. It describes the network, not this node. Alerting on it pages a whole fleet whenever other validators drop off. To check your own uptime, call <code>platform.getCurrentValidators</code> on an independent node.'));
            return rpc(j.id, { rewardingStakePercentage: '94.5732', weightedAveragePercentage: '97.8121' });
          default: return rpcErr(j.id, `the method ${j.method} does not exist/is not available`);
        }
      }
      if (req.path === '/ext/bc/P' && j.method === 'platform.getCurrentValidators') {
        const ids = p.nodeIDs || null;
        const list = nodes.filter(m => av(m).validator && (!ids || ids.includes(m.nodeID))).map(m => validatorRecord(w, m, m === n));
        if (!ids || ids.includes(n.nodeID)) S.lesson(w, 'selfview', S.LL('节点无法证明自己在线', 'A node cannot vouch for itself'), S.LL('在节点本地查询它自己的记录，uptime 总是接近 99.9%：节点离线期间什么也观察不到，而它观察到的时段自然都是在线的。请改为查询 api.avax.network。', 'Asking a node about its own record always shows about 99.9%: while it was down it observed nothing, and whatever it did observe it was online for. Query api.avax.network instead.'));
        return rpc(j.id, { validators: list });
      }
      if (req.path === '/ext/bc/C/rpc') return rpc(j.id, '0x' + (tip(w) - Math.round(av(n).replay)).toString(16));
      return { status: 404, body: '404 page not found' };
    }
    return null;
  }

  /* ---------- alert rules (names/thresholds from alerting/chain/avalanche.yaml) ---------- */
  const nodesOf = w => Object.values(w.nodes);
  const rules = [
    { name: 'AvalancheNodeUnhealthy', severity: 'critical', for: 120, check: w => nodesOf(w).filter(n => !healthy(w, n)).map(n => ({ instance: n.hostname, summary: `health check failing — ${firstFailing(w, n)}` })) },
    { name: 'NodeDown', severity: 'critical', for: 300, check: w => nodesOf(w).filter(n => !active(n)).map(n => ({ instance: n.hostname, summary: 'job="avalanchego" up == 0 (cannot scrape /ext/metrics)' })) },
    { name: 'AvalancheValidatorNotConnected', severity: 'critical', for: 900, check: w => nodesOf(w).filter(n => av(n).validator && !connected(w, n)).map(n => ({ instance: n.hostname, summary: 'api.avax.network reports connected=false; uptime is being lost' })) },
    { name: 'AvalancheRewardingStakeLow', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => av(n).validator && uptimePct(n) < 95).map(n => ({ instance: n.hostname, summary: `P-Chain uptime ${uptimePct(n).toFixed(2)}% < 95%` })) },
    { name: 'AvalancheRewardingStakeCritical', severity: 'critical', for: 600, check: w => nodesOf(w).filter(n => av(n).validator && uptimePct(n) < 90).map(n => ({ instance: n.hostname, summary: `P-Chain uptime ${uptimePct(n).toFixed(2)}% < 90% (below the reward threshold)` })) },
    { name: 'AvalancheBlocksBehind', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => active(n) && av(n).replay > 100).map(n => ({ instance: n.hostname, summary: `C-Chain ${Math.round(av(n).replay)} blocks behind` })) },
    { name: 'ExternalProbeFailure', severity: 'critical', for: 300, check: w => nodesOf(w).filter(n => !(active(n) && n.probeIp === n.ip && !n.sgBlocked)).map(n => ({ instance: `${n.probeIp}:9651`, summary: `validator-${n.moniker} · tcp_connect failed from us-east-1, eu-west-1, ap-southeast-1` })) },
    { name: 'ComponentUpgradeAvailable', severity: 'warning', for: 0, check: w => w.chain.showUpgradeAlert ? nodesOf(w).filter(n => S.semverCmp(binVer(S.fsRead(w, n, BINP)) || '0.0.0', MIN) < 0).map(n => ({ instance: `avalanche/${n.moniker}`, summary: `avalanchego ${binVer(S.fsRead(w, n, BINP))} → ${MIN} · instance=fleet-watchtower` })) : [] },
  ];

  /* ---------- automation: the upgrade primitive ---------- */
  async function primitive(w, n, ver, mode, out, sig) {
    if (S.fsGet(n, '/etc/staking-identity-retired')) { out(C.red('[  error] refusing: this host is retired (/etc/staking-identity-retired) — restarting it would resurrect a second signer')); return { ok: false }; }
    out(`[  upgrade] ${n.hostname}: downloading avalanchego v${ver} from github.com/ava-labs/avalanchego`);
    await S.sleep(w, 20, sig);
    S.fsWrite(n, BINP + '.prev', S.fsRead(w, n, BINP), { mode: '755', owner: 'root', by: 'automation' });
    S.fsWrite(n, BINP, BIN(ver), { mode: '755', owner: 'root', by: 'automation', size: 98234112 });
    out(`[  upgrade] installed /usr/local/bin/avalanchego (previous kept as avalanchego.prev); systemctl restart avalanchego`);
    restart(w, n);
    const limit = mode === 'v1' ? 300 : 3600, t0 = w.t;
    while (w.t - t0 < limit) {
      await S.sleep(w, 30, sig);
      if (sig && sig.aborted) { out(C.gray('[   detach] stopped waiting; the upgrade continues on the node')); return { ok: false, detached: true }; }
      if (healthy(w, n)) { out(C.green(`[   health] ext-health healthy=True (${S.fmtDur(w.t - t0)})`)); return { ok: true }; }
      if (mode !== 'v1' && Math.round(w.t - t0) % 300 < 30) out(C.gray(`[     wait] not healthy yet — replaying, ${Math.round(av(n).replay)} blocks remaining`));
    }
    if (mode === 'v1') {
      out(C.yellow(`[ rollback] not healthy within 300s — restoring previous binary (avalanchego.prev)`));
      S.fsWrite(n, BINP, S.fsRead(w, n, BINP + '.prev'), { mode: '755', owner: 'root', by: 'automation' });
      restart(w, n);
      return { ok: false, rolledBack: true };
    }
    if (active(n)) { out(C.yellow('[ rollback] rollback-withheld: avalanchego is running and the database has been migrated forward — NOT rolling back. check: journalctl -u avalanchego | grep executing')); return { ok: false, withheld: true }; }
    out(C.red('[ rollback] new binary never started — restoring avalanchego.prev'));
    S.fsWrite(n, BINP, S.fsRead(w, n, BINP + '.prev'), { mode: '755', owner: 'root', by: 'automation' });
    restart(w, n);
    return { ok: false, rolledBack: true };
  }

  /* ---------- commands: node ---------- */
  const nodeCommands = {
    avalanchego: ctx => {
      if (ctx.args.includes('--version')) { const v = binVer(S.fsRead(ctx.w, ctx.host, ctx.name.includes('/') ? ctx.resolve(ctx.name) : BINP)); return `avalanchego/${v} [database=${dbv(v)}, rpcchainvm=${S.semverCmp(v, MIN) >= 0 ? 46 : 45}, commit=a3f40fd0738eb65398346cdbc7bb18d93e2a60d5, go=1.25.10]\n`; }
      return { code: 1, out: `${C.gray(S.L('avalanchego 由 systemd 管理：systemctl status|restart avalanchego', 'avalanchego runs under systemd: systemctl status|restart avalanchego'))}\n` };
    },
  };
  nodeCommands['avalanchego.prev'] = ctx => nodeCommands.avalanchego(ctx);
  nodeCommands['avalanchego.prev'].hidden = true;

  /* ---------- commands: laptop ---------- */
  function findNode(w, key) { return Object.values(w.nodes).find(n => n.moniker === key || n.instanceId === key || n.hostname === key); }
  function openSession(ctx, n) {
    ctx.sh.push({ host: n, user: 'ssm-user', cwd: '/home/ssm-user', env: { HOME: '/home/ssm-user', USER: 'ssm-user' } });
    return `\nStarting session with SessionId: ops-${n.id}-0a1b2c3d\n${C.gray(S.L(`已登录 ${n.hostname}（${n.region}）。sudo -i 切换到 root，exit 退出。`, `Connected to ${n.hostname} (${n.region}). sudo -i for root, exit to leave.`))}\n`;
  }
  const laptopCommands = {
    ssm: ctx => {
      const n = findNode(ctx.w, ctx.args[0]);
      if (!n) return { code: 1, out: `${S.L('用法：ssm <节点名>。可选节点：', 'usage: ssm <node>. Nodes: ')}${Object.values(ctx.w.nodes).map(x => x.moniker).join(' ')}\n` };
      return openSession(ctx, n);
    },
    aws: async ctx => {
      const f = ctx.flags, [svcName, op] = f._;
      if (svcName === 'sts' && op === 'get-caller-identity') return JSON.stringify({ UserId: 'AROAEXAMPLE7ONCALL:ops', Account: '111122223333', Arn: 'arn:aws:sts::111122223333:assumed-role/oncall-operator/ops' }, null, 4) + '\n';
      if (svcName === 'ssm' && op === 'start-session') {
        const n = findNode(ctx.w, f.target);
        if (!n) return { code: 254, out: `\nAn error occurred (InvalidInstanceId) when calling the StartSession operation: ${f.target || '(missing --target)'} is not a valid instance id\n` };
        const region = f.region || 'us-east-1';
        if (region !== n.region) return { code: 254, out: `\nAn error occurred (TargetNotConnected) when calling the StartSession operation: ${n.instanceId} is not connected.\n${C.gray(S.L(`（这台实例在 ${n.region}，当前查询的是 ${region}。加上 --region ${n.region}）`, `(this instance is in ${n.region}, not ${region}; add --region ${n.region})`))}\n` };
        return openSession(ctx, n);
      }
      if (svcName === 'ec2' && op === 'describe-instances') {
        const region = f.region || 'us-east-1';
        const rows = Object.values(ctx.w.nodes).filter(n => n.region === region).map(n => [`validator-${n.moniker}`, n.instanceId, n.ip, n.instanceType, 'running']);
        if (!rows.length) return `${C.gray(S.L(`（${region} 没有实例。节点所在区域：`, `(no instances in ${region}. Nodes run in: `) + [...new Set(Object.values(ctx.w.nodes).map(n => n.region))].join(', ') + S.L('）', ')'))}\n`;
        return S.table(rows, ['Name', 'InstanceId', 'PublicIpAddress', 'InstanceType', 'State']) + '\n';
      }
      if (svcName === 'ssm' && op === 'send-command') {
        const n = findNode(ctx.w, f['instance-ids']);
        if (!n) return { code: 254, out: 'An error occurred (InvalidInstanceId) when calling the SendCommand operation\n' };
        const m = /commands=\[(.*)\]/s.exec(f.parameters || '');
        let cmds = []; try { cmds = JSON.parse('[' + (m ? m[1] : '') + ']'); } catch (e) { return { code: 252, out: 'Error parsing parameter \'--parameters\': expected commands=["..."]\n' }; }
        const id = 'c' + Math.floor(ctx.w.rand() * 1e12).toString(16) + '-4b1e-9b54-' + Math.floor(ctx.w.rand() * 1e8).toString(16);
        ctx.sh.push({ host: n, user: 'root', cwd: '/', env: { HOME: '/root' } });
        let buf = '';
        try { buf = await ctx.sh.capture(cmds.join('\n').replace(/\n/g, ' ; ')); } finally { ctx.sh.pop(); }
        (ctx.w.ssmResults = ctx.w.ssmResults || {})[id] = { n, out: buf.slice(0, 24000), status: ctx.sh.lastCode === 0 ? 'Success' : 'Failed' };
        return JSON.stringify({ Command: { CommandId: id, DocumentName: 'AWS-RunShellScript', Status: 'Pending', InstanceIds: [n.instanceId] } }, null, 4) + '\n';
      }
      if (svcName === 'ssm' && op === 'get-command-invocation') {
        const r = (ctx.w.ssmResults || {})[f['command-id']];
        if (!r) return { code: 254, out: 'An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation\n' };
        return JSON.stringify({ CommandId: f['command-id'], InstanceId: r.n.instanceId, Status: r.status, StandardOutputContent: r.out, StandardErrorContent: '' }, null, 4) + '\n';
      }
      if (svcName === 'ssm' && op === 'wait') return '';
      return { code: 2, out: `${C.gray(S.L('本练习支持：', 'Available in this lab: ') + 'aws sts get-caller-identity · aws ec2 describe-instances --region R · aws ssm start-session --region R --target ID · aws ssm send-command / get-command-invocation')}\n` };
    },
    staking: async ctx => {
      const a = ctx.args.slice(); let region = 'us-east-1';
      while (a[0] && a[0].startsWith('--')) { const k = a.shift(); if (k === '--region') region = a.shift(); else if (k === '--profile') a.shift(); }
      const sub = a.shift(), f = S.parseFlags(a), proto = f._[0];
      if (!sub || sub === '--help') return `Usage: staking [--region R] COMMAND\n  health <protocol> --env prod --moniker M\n  upgrade <protocol> --env prod --moniker M --version X.Y.Z\n  ls [protocol] --env prod\n`;
      if (sub === 'ls') return `${C.gray('[      done] 0 deployments')}  ${C.gray(S.L('（这些节点早于部署工具接管，缺少 ManagedBy 标签，所以 ls 列不出来。health 和 upgrade 按 Protocol、Env、Moniker 查找，可以正常使用）', '(these nodes predate the tool and lack the ManagedBy tag, so ls does not list them; health and upgrade look nodes up by Protocol, Env and Moniker and still work)'))}\n`;
      if (proto !== 'avalanche') return { code: 1, out: `[     error] unknown protocol: ${proto || '(missing)'}\n` };
      const env = f.env || 'dev';
      const n = Object.values(ctx.w.nodes).find(x => x.moniker === f.moniker);
      if (!n || env !== 'prod' || n.region !== region) {
        const why = env !== 'prod' ? S.L('（--env 默认是 dev，生产节点需要 --env prod）', '(--env defaults to dev; production nodes need --env prod)') : n && n.region !== region ? S.L(`（节点在 ${n.region}，请在子命令前加 --region ${n.region}）`, `(the node is in ${n.region}; put --region ${n.region} before the subcommand)`) : '';
        return { code: 1, out: `[     error] no deployment found for avalanche/${env}/${f.moniker || '?'} in ${region} ${C.gray(why)}\n` };
      }
      if (sub === 'health') {
        await ctx.sleep(4);
        const ok = healthy(ctx.w, n);
        return { code: ok ? 0 : 3, out: `[    health] ext-health  {'detail': 'healthy=${ok ? 'True' : 'False'}', 'ok': ${ok ? 'True' : 'False'}}\n[      done] passed=${ok ? 'True' : 'False'}\n` };
      }
      if (sub === 'upgrade') {
        const v = String(f.version || '').replace(/^v/, '');
        if (!/^\d+\.\d+\.\d+$/.test(v)) return { code: 1, out: '[     error] --version X.Y.Z is required\n' };
        const r = await primitive(ctx.w, n, v, 'v2', line => ctx.write(line + '\n'), ctx.sig);
        if (r.ok) { ctx.write(`[      done] Version tag set to ${v}\n`); return { code: 0 }; }
        return { code: r.detached ? 130 : 3 };
      }
      return { code: 1, out: `[     error] unsupported in simulator: ${sub}\n` };
    },
    gh: async ctx => {
      const [g, sub, num] = ctx.flags._;
      const pr = ctx.w.chain.pr;
      if (g !== 'pr' || !pr) return { code: 1, out: `${C.gray(S.L('本练习支持：', 'Available in this lab: ') + 'gh pr list · gh pr view <n> · gh pr merge <n>')}\n` };
      const deadline = () => {
        const A = act(ctx.w); if (A === null) return '';
        const left = A - ctx.w.t;
        return left > 86400 ? `Network deadline: ${S.fmtClock(new Date(ctx.w.base + A * 1000))}` : left > 0 ? C.red(`⛔ DEADLINE IS TODAY — ${S.fmtDur(left)} left`) : C.red(`⛔ DEADLINE PASSED ${S.fmtDur(-left)} ago`);
      };
      if (sub === 'list') return pr.merged ? 'no open pull requests in example-staking/fleet\n' : `#${pr.n}  ${pr.title}  ${C.gray('upgrade/avalanche-1.15.0')}  OPEN\n`;
      if (sub === 'view') return `${C.bold(pr.title)}\nexample-staking/fleet #${pr.n} · ${pr.merged ? C.magenta('MERGED') : C.green('OPEN')} · fleet-bot\n\n${deadline()}\n\n  upgrades/manifest/avalanche.yaml\n${Object.values(ctx.w.nodes).map(n => `    - moniker: ${n.moniker}\n      components:\n-       avalanchego: ${binVer(S.fsRead(ctx.w, n, BINP))}\n+       avalanchego: ${MIN}`).join('\n')}\n\n${C.gray('Merging this PR authorises upgrade-apply.yml to roll these nodes (max 2 at a time).')}\n`;
      if (sub === 'merge') {
        if (String(num) !== String(pr.n)) return { code: 1, out: `GraphQL: Could not resolve to a PullRequest with the number of ${num}.\n` };
        if (pr.merged) return { code: 1, out: `! Pull request #${pr.n} was already merged\n` };
        pr.merged = true;
        S.event(ctx.w, 'sys', S.LL(`已合并 PR #${pr.n}。<b>upgrade-apply</b> 工作流开始滚动升级，每次最多 2 台。`, `PR #${pr.n} merged. The <b>upgrade-apply</b> workflow starts a rolling upgrade, at most 2 nodes at a time.`));
        rollFleet(ctx.w, ctx.w.chain.primitive || 'v2');
        return `${C.green('✓')} Merged pull request #${pr.n} (${pr.title})\n${C.gray(S.L('upgrade-apply 已触发，进度显示在右侧的事件记录中。', 'upgrade-apply started; progress appears in the event log on the right.'))}\n`;
      }
      return { code: 1, out: 'unknown gh pr subcommand\n' };
    },
    nc: async ctx => {
      const [ip, port] = ctx.flags._.filter(x => !x.startsWith('-'));
      if (!ip || !port) return { code: 1, out: 'usage: nc -zv <ip> <port>\n' };
      const n = Object.values(ctx.w.nodes).find(x => x.ip === ip && active(x) && !x.sgBlocked);
      await ctx.sleep(n ? 0.3 : 5);
      if (n && String(port) === '9651') return `Connection to ${ip} 9651 port [tcp/*] succeeded!\n`;
      return { code: 1, out: `nc: connect to ${ip} port ${port} (tcp) timed out: Operation now in progress\n` };
    },
  };

  async function rollFleet(w, mode) {
    const order = Object.values(w.nodes);
    for (let i = 0; i < order.length; i += 2) {
      const batch = order.slice(i, i + 2);
      await Promise.all(batch.map(async n => {
        S.event(w, 'sys', S.LL(`upgrade-apply · <b>${n.moniker}</b>：开始（升级脚本 ${mode}）`, `upgrade-apply · <b>${n.moniker}</b>: started (upgrade script ${mode})`));
        const lines = [];
        const r = await primitive(w, n, MIN, mode, l => lines.push(S.stripAnsi(l)), null);
        if (r.ok) S.event(w, 'ok', S.LL(`upgrade-apply · <b>${n.moniker}</b>：升级完成并通过验证`, `upgrade-apply · <b>${n.moniker}</b>: upgrade applied and verified`));
        else S.event(w, 'bad', S.LL(`upgrade-apply · <b>${n.moniker}</b>：升级失败。${S.esc(lines[lines.length - 1] || '')}`, `upgrade-apply · <b>${n.moniker}</b>: upgrade failed. ${S.esc(lines[lines.length - 1] || '')}`));
      }));
    }
  }

  /* ---------- side panel ---------- */
  const panel = {
    mount(el) {
      el.innerHTML = `<div class="mech-head"></div><div class="avx-grid"></div><p class="mech-note">${S.L('在线率是 P-Chain 上其他验证者对这台节点的记录（通过 api.avax.network 查询）。进度条表示"从现在起不再离线"时的期末在线率，红线是 90% 的奖励门槛（ACP-267）。', 'Uptime is what other validators recorded for this node on the P-Chain (queried through api.avax.network). The bar is the end-of-period uptime if the node stays online from now on; the red mark is the 90% reward threshold (ACP-267).')}</p>`;
    },
    update(el, w) {
      const A = act(w), L = S.L;
      const head = el.querySelector('.mech-head');
      if (A !== null) {
        const left = A - w.t;
        head.innerHTML = left > 0
          ? `<span class="mh-k">${L(`${w.chain.upgrade} 激活倒计时`, `${w.chain.upgrade} activates in`)}</span><span class="mh-v ${left < 1800 ? 'warn' : ''}">${S.fmtDur(left)}</span><span class="mh-s">${L('最低版本', 'minimum version')} ${MIN}</span>`
          : `<span class="mh-k">${L(`${w.chain.upgrade} 已激活`, `${w.chain.upgrade} active for`)}</span><span class="mh-v bad">${S.fmtDur(-left)}</span><span class="mh-s">${L(`低于 ${MIN} 的节点不再验证`, `nodes below ${MIN} no longer validate`)}</span>`;
      } else head.innerHTML = `<span class="mh-k">Avalanche Primary Network</span><span class="mh-s">${L('C-Chain 高度', 'C-Chain height')} ${tip(w).toLocaleString()}</span>`;
      el.querySelector('.avx-grid').innerHTML = Object.values(w.nodes).map(n => {
        const s = svc(n), a = av(n);
        let st, cls;
        if (s.state === 'activating') { st = L(`反复崩溃 ×${s.restarts}`, `crash loop ×${s.restarts}`); cls = 'bad'; }
        else if (s.state !== 'active') { st = L('已停止', 'stopped'); cls = 'bad'; }
        else if (!versionOk(w, n)) { st = L('版本过低，被网络断开', 'version too old, rejected'); cls = 'bad'; }
        else if (a.replay > 0) { st = L(`重放中，剩 ${Math.round(a.replay).toLocaleString()} 块`, `replaying, ${Math.round(a.replay).toLocaleString()} blocks left`); cls = 'warn'; }
        else if (!ipOk(w, n)) { st = L('无法从外部连接', 'unreachable from outside'); cls = 'bad'; }
        else { st = 'healthy'; cls = 'ok'; }
        const proj = projected(n), cur = uptimePct(n);
        const pos = v => Math.max(0, Math.min(100, (v - 85) / 15 * 100));
        const binv = binVer(S.fsRead(w, n, BINP));
        return `<div class="avx-node ${cls}">
          <div class="an-top"><b>${n.moniker}</b><span class="an-reg">${n.region}</span><span class="pill ${cls}">${st}</span></div>
          <div class="an-row"><span>${L('运行版本', 'running')}</span><b class="mono">${a.running || '—'}</b><span>${L('磁盘上的版本', 'on disk')}</span><b class="mono">${binv || L('缺失', 'missing')}</b><span>${L('数据库', 'database')}</span><b class="mono">${a.db ? dbv(a.db) : L('空', 'empty')}</b></div>
          ${a.replay > 0 && s.state === 'active' ? `<div class="bar"><i style="width:${Math.max(2, 100 - a.replay / (MIGRATION_BLOCKS + 500) * 100)}%"></i></div>` : ''}
          ${a.validator ? `<div class="an-row"><span>connected</span><b class="${connected(w, n) ? 'okc' : 'badc'}">${connected(w, n) ? 'true' : 'false'}</b><span>${L('当前在线率', 'uptime now')}</span><b class="mono">${cur.toFixed(3)}%</b><span>${L('本次离线', 'offline here')}</span><b class="mono ${a.offline >= 1 ? 'badc' : ''}">${S.fmtDur(a.offline)}</b></div>
          <div class="ubar"><i style="width:${pos(proj)}%" class="${proj < 90 ? 'b' : proj < 95 ? 'w' : ''}"></i><em style="left:${pos(90)}%"></em><span>${L('期末', 'end of period')} ${proj.toFixed(3)}%</span></div>` : `<div class="an-row"><span>${L('不在验证者集合中', 'not in the validator set')}</span></div>`}
        </div>`;
      }).join('');
    },
  };

  const LOGO = () => '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#E84142"/><path transform="translate(0 1.8)" fill="#fff" d="M11.47 22.37H8.37C7.71 22.37 7.39 22.37 7.2 22.25C6.98 22.11 6.85 21.88 6.84 21.63C6.83 21.4 6.99 21.12 7.31 20.55L14.97 7.05C15.3 6.47 15.46 6.19 15.67 6.08C15.89 5.97 16.16 5.97 16.39 6.08C16.59 6.19 16.76 6.47 17.08 7.05L18.66 9.8C19.02 10.42 19.2 10.74 19.28 11.06C19.36 11.42 19.36 11.8 19.28 12.16C19.2 12.49 19.02 12.8 18.66 13.42L14.64 20.54C14.27 21.18 14.09 21.49 13.85 21.73C13.57 21.99 13.25 22.18 12.89 22.28C12.56 22.37 12.2 22.37 11.47 22.37ZM19.31 22.37H23.75C24.41 22.37 24.74 22.37 24.93 22.24C25.15 22.11 25.28 21.87 25.29 21.62C25.3 21.4 25.15 21.13 24.84 20.59L22.58 16.73C22.24 16.16 22.08 15.89 21.88 15.79C21.65 15.67 21.39 15.67 21.17 15.79C20.96 15.89 20.8 16.17 20.47 16.73L18.25 20.54C17.92 21.12 17.76 21.4 17.77 21.63C17.79 21.88 17.91 22.11 18.13 22.25C18.32 22.37 18.65 22.37 19.31 22.37Z"/></svg>';

  S.registerNetwork({
    id: 'avalanche', name: 'Avalanche', color: '#f5a623', logo: LOGO,
    init(w, cfg) {
      w.chain = { activation: cfg.activation ?? null, upgrade: cfg.upgrade || 'Helicon', cHeight0: 87015424, pr: cfg.pr || null, primitive: cfg.primitive || 'v2', showUpgradeAlert: !!cfg.showUpgradeAlert };
      (cfg.nodes || []).forEach(sp => { w.nodes[sp.moniker] = makeNode(w, sp); });
    },
    tick, http, rules, nodeCommands, laptopCommands, panel,
    serviceAction(w, h, s, action) {
      if (s.name !== 'avalanchego') { if (action === 'stop') s.state = 'inactive'; else { s.state = 'active'; s.since = w.t; } return; }
      if (S.fsGet(h, '/etc/staking-identity-retired') && action !== 'stop') { S.flag(w, 'double_sign'); }
      if (action === 'stop') stop(w, h);
      else if (action === 'start') { if (s.state !== 'active') { sysLog(w, h, 'Started avalanchego.service - Avalanche Node.'); start(w, h); } }
      else if (action === 'restart' || action === 'reload') restart(w, h);
    },
    onRemoved(w, h, p) {
      if (!h.av) return;
      if (p === DB || p.startsWith(DB + '/') || p === '/home/ubuntu/.avalanchego') { if (!Object.keys(h.fs).some(k => k.startsWith(DB + '/'))) { h.av.db = null; S.flag(w, 'wipe_db'); } }
      if (p === STAKING || p.startsWith(STAKING) || p === '/home/ubuntu/.avalanchego') S.flag(w, 'lost_identity');
    },
    helpers: { healthy, connected, versionOk, ipOk, uptimePct, projected, binVer, BIN, MIN, active },
  });
})(SIM);
