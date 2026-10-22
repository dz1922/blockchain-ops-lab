/* ============================================================
   Network plugin: Avalanche (Primary Network validator, avalanchego)
   Mechanisms modelled:
   - binary version vs on-disk database version (migration, codec crash)
   - network upgrade activation with a minimum version (Helicon / 1.15.0)
   - replay after (re)start, health checks, P-Chain uptime as seen by others
   - advertised public-ip vs actual IP (reachability on 9651)
   - root disk usage, the 512 MiB low-disk shutdown, online EBS growth
   - end-of-period uptime and planned downtime (instance resizes)
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
  // a fresh host (guided lab) keeps its service object aside until a unit file exists
  const svc = n => n.services.avalanchego || n.avSvc;
  // per-node data paths; nodes built by makeNode use the defaults under /home/ubuntu
  const homeOf = n => n.avHome || '/home/ubuntu/.avalanchego';
  const dbOf = n => n.avHome ? n.avHome + '/db' : DB;
  const stakingOf = n => n.avHome ? n.avHome + '/staking' : STAKING;
  const bootDone = n => !av(n).boot || ['P', 'X', 'C'].every(c => av(n).boot[c] <= 0);
  // host firewall: only fresh hosts carry a ufw state; everything else is open as before
  const fwAllows = (n, port) => !n.ufw || !n.ufw.active || n.ufw.rules.some(r => String(r).split('/')[0] === String(port));
  const act = w => w.chain.activation;
  const cfg = (w, n) => { try { return JSON.parse(S.fsRead(w, n, n.cfgPath || CFGP)); } catch (e) { return null; } };
  const cfgIp = (w, n) => (cfg(w, n) || {})['public-ip'];
  const versionOk = (w, n) => act(w) === null || w.t < act(w) || (av(n).running && S.semverCmp(av(n).running, MIN) >= 0);
  const ipOk = (w, n) => cfgIp(w, n) === n.ip && !n.sgBlocked && fwAllows(n, 9651);
  const active = n => svc(n).state === 'active';
  const connected = (w, n) => active(n) && versionOk(w, n) && ipOk(w, n);
  // the no-inbound-connections health check only applies to a node in the validator set
  const reachOk = (w, n) => (n.fresh && !av(n).validator) || ipOk(w, n);
  const healthy = (w, n) => active(n) && av(n).replay <= 0 && bootDone(n) && versionOk(w, n) && reachOk(w, n);
  const uptimePct = n => av(n).up.elapsed > 0 ? 100 * (1 - av(n).up.down / av(n).up.elapsed) : 100;
  const projected = n => 100 * (1 - av(n).up.down / av(n).up.period);
  const tip = w => Math.floor(w.chain.cHeight0 + w.t / 2);
  const GiB = 1073741824, MIN_FREE = 512 * 1048576, WARN_FREE = GiB;
  const JDIR = '/var/log/journal/ec2a7f3c9e1b4d5f8a6c2e0b7d9f1a3c';
  const hasDb = n => Object.keys(n.fs).some(k => k.startsWith(dbOf(n) + '/'));
  function sizeUnder(n, p) {
    let b = 0;
    Object.keys(n.fs).forEach(k => { if (k === p || k.startsWith(p === '/' ? '/' : p + '/')) b += n.fs[k].size || 0; });
    const DATA = dbOf(n) + '/mainnet/v1.4.5';
    if (hasDb(n) && (DATA === p || DATA.startsWith(p === '/' ? '/' : p + '/'))) b += av(n).dbGB * GiB;
    if (p === '/') b += n.disk.base * GiB;
    return b;
  }
  const diskUsed = n => sizeUnder(n, '/') / GiB;
  const availGB = n => Math.max(0, n.disk.size - diskUsed(n));
  const availPct = n => 100 * availGB(n) / n.disk.size;
  const periodLeft = n => av(n).up.period - av(n).up.elapsed;
  function human(b) {
    const u = ['', 'K', 'M', 'G', 'T']; let i = 0, v = b;
    while (v >= 1024 && i < 4) { v /= 1024; i++; }
    if (i === 0) return String(Math.ceil(v));
    return (v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v))) + u[i];
  }
  function healthChecks(w, n) {
    const ok = m => ({ message: m, timestamp: S.isoTime(w.now()), duration: 12034, contiguousFailures: 0, timeOfFirstFailure: null });
    const bad = (e, since) => ({ error: e, timestamp: S.isoTime(w.now()), duration: 9087, contiguousFailures: Math.max(1, Math.floor((w.t - since) / 30)), timeOfFirstFailure: S.isoTime(new Date(w.base + since * 1000)) });
    const s = svc(n), c = {};
    c.bls = ok({ blsKey: 'matches registered key' });
    c.database = ok(null);
    c.diskspace = availGB(n) * GiB < WARN_FREE ? bad(`remaining available disk space (${Math.round(availGB(n) * GiB)}) is below the warning threshold of disk space (${WARN_FREE})`, s.since) : ok({ availableDiskBytes: Math.round(availGB(n) * GiB) });
    c.bootstrapped = av(n).replay > 0 ? bad(`chains not bootstrapped: [C] (executing blocks, ${Math.round(av(n).replay)} remaining)`, s.since) : ok([]);
    if (!versionOk(w, n)) c.network = bad(`node version avalanchego/${av(n).running} is incompatible with activated network upgrade ${w.chain.upgrade} (requires >= ${MIN})`, act(w));
    else if (!reachOk(w, n)) c.network = bad('primary network validator has no inbound connections', s.since);
    else c.network = ok({ connectedPeers: av(n).peers, timeSinceLastMsgReceived: '153ms', timeSinceLastMsgSent: '98ms', sendFailRate: 0 });
    c.C = av(n).replay > 0 ? bad('not yet run', s.since) : ok({ consensus: { outstandingBlocks: 0 } });
    c.P = ok({ consensus: { outstandingBlocks: 0 } });
    c.X = ok({ consensus: { outstandingBlocks: 0 } });
    c.router = ok({ longestRunningRequest: '0s', outstandingRequests: 0 });
    if (av(n).boot) {
      const left = ['P', 'X', 'C'].filter(k => av(n).boot[k] > 0);
      if (left.length) c.bootstrapped = bad(`chains not bootstrapped: [${left.join(' ')}]`, s.since);
      left.forEach(k => { c[k] = bad('not yet run', s.since); });
    }
    return c;
  }
  const firstFailing = (w, n) => { if (!active(n)) return svc(n).state === 'activating' ? 'avalanchego is not running (restart loop, exit-code)' : 'avalanchego is not running'; const c = healthChecks(w, n); const k = Object.keys(c).find(k => c[k].error); return k ? `${k}: ${c[k].error}` : 'process not running'; };

  function log(w, n, level, msg) { S.log(w, n, 'avalanchego', level, `${level === 'FATAL' ? 'FATAL' : level.padEnd(5)} ${msg}`); }
  function sysLog(w, n, msg) { S.log(w, n, 'avalanchego', 'SYS', msg); }

  /* ---------- process lifecycle ---------- */
  function start(w, n) {
    if (n.fresh) return startFresh(w, n);
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
    if (availGB(n) * GiB < MIN_FREE) return lowDisk(w, n);
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
  function lowDisk(w, n) {
    log(w, n, 'FATAL', `<main> node/node.go:1318 low on disk space. Shutting down... {"remainingDiskBytes": ${Math.round(availGB(n) * GiB)}, "requiredDiskBytes": ${MIN_FREE}}`);
    S.lesson(w, 'lowdisk', S.LL('磁盘不足时节点会自行退出', 'The node stops itself when the disk is nearly full'), S.LL('可用空间低于 1 GiB 时，avalanchego 的 diskspace 健康检查开始失败；低于 512 MiB 时，节点会自行退出，以免写坏数据库。systemd 每 5 秒把它拉起来一次，它每次都会再次退出。腾出空间或者扩容根卷之后，下一次自动重启就会恢复，不需要删除数据库。', 'Below 1 GiB of free space the diskspace health check fails. Below 512 MiB avalanchego shuts itself down so it does not corrupt the database. systemd starts it again every 5 seconds and it exits again each time. Once space is freed or the root volume is grown, the next automatic restart recovers. The database does not need to be deleted.'));
    return crash(w, n, 1);
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
      mem: { total: sp.memGB * 1024, used: Math.round(sp.memGB * 1024 * 0.48) }, disk: { size: (sp.disk && sp.disk.size) || 1664, used: 1302, dev: '/dev/nvme0n1p1' },
      instanceType: sp.type, upBase: 86400 * 6, bootAt: 0,
    });
    n.av = {
      db: sp.db, running: null, replay: 0, peers: sp.peers || 2370, stoppedAt: null, nextRestart: null, codecCrashes: 0,
      validator: sp.validator !== false, offline: 0, lastWarn: -1e9, lastErr: -1e9, lastIpWarn: -1e9, lastInfo: 0,
      up: { elapsed: sp.elapsedDays * 86400, down: sp.downHours * 3600, period: sp.periodDays * 86400 }, potentialReward: sp.reward, weight: sp.weight,
      dbGB: (sp.disk && sp.disk.dbGB) || 1280,
    };
    n.vol = { id: 'vol-0' + sp.instanceId.slice(3).split('').reverse().join(''), size: n.disk.size, visible: n.disk.size, part: n.disk.size, type: 'gp3', iops: 3000, throughput: 125, mods: [] };
    S.fsWrite(n, BINP, BIN(sp.bin), { mode: '755', owner: 'root', size: 98234112 });
    S.fsWrite(n, CFGP, JSON.stringify({ 'network-id': 'mainnet', 'public-ip': sp.cfgIp || sp.ip, 'http-host': '127.0.0.1', 'db-dir': DB, 'sybil-protection-enabled': true, 'staking-port': 9651, 'api-admin-enabled': true, 'api-health-enabled': true, 'api-info-enabled': true }, null, 2) + '\n');
    S.fsWrite(n, '/etc/systemd/system/avalanchego.service', `[Unit]\nDescription=Avalanche Node\nWants=network-online.target\nAfter=network-online.target\nRequiresMountsFor=${DB}\n\n[Service]\nUser=ubuntu\nGroup=ubuntu\nType=simple\nExecStart=${BINP} --config-file=${CFGP}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=120\nLimitNOFILE=32768\n\n[Install]\nWantedBy=multi-user.target\n`);
    ['staker.crt', 'staker.key', 'signer.key'].forEach(f => S.fsWrite(n, `${STAKING}/${f}`, f === 'staker.crt' ? '-----BEGIN CERTIFICATE-----\nMIIFNzCCAx+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAAMCAXDTk5MTIzMTAwMDAw\n(simulated)\n-----END CERTIFICATE-----\n' : f === 'staker.key' ? '-----BEGIN PRIVATE KEY-----\n(simulated — never print a real private key)\n-----END PRIVATE KEY-----\n' : '(32-byte BLS secret key, binary)', { mode: '400', owner: 'ubuntu' }));
    S.fsWrite(n, '/home/ubuntu/.avalanchego/configs/chains/C/config.json', '{"state-sync-enabled": true}\n', { owner: 'ubuntu' });
    S.fsWrite(n, `${DB}/mainnet/v1.4.5/MANIFEST-004211`, '(leveldb manifest)', { owner: 'ubuntu', size: 1114 });
    ['CURRENT', 'LOCK', 'LOG', '3204198.ldb', '3204203.ldb', '3204209.ldb'].forEach(f => S.fsWrite(n, `${DB}/mainnet/v1.4.5/${f}`, '(leveldb data)', { owner: 'ubuntu', size: f.endsWith('.ldb') ? 2097152 : 16 }));
    const jGB = (sp.disk && sp.disk.journalGB) || 1.8, nArch = Math.max(1, Math.round(jGB - 0.125));
    for (let i = 0; i < nArch; i++) S.fsWrite(n, `${JDIR}/system@5f1c2a3b4c5d6e7f-00000000000${(1000 + i * 3711).toString(16)}-000640${(9000 + i * 97).toString(16)}aa.journal~`, '(journal)', { size: Math.round((jGB - 0.125) / nArch * GiB), age: (nArch - i) * 4 });
    S.fsWrite(n, `${JDIR}/system.journal`, '(journal)', { size: 134217728, age: 0 });
    n.disk.base = 0;
    n.disk.base = sp.disk && sp.disk.base != null ? sp.disk.base : 1302 - diskUsed(n);
    (sp.files || []).forEach(f => { S.fsWrite(n, f.path, f.c, { owner: f.owner || 'root', size: f.fill ? Math.round((n.disk.size - f.leaveGB - diskUsed(n)) * GiB) : f.size }); });
    S.fsWrite(n, '/home/ubuntu/.avalanchego/logs/main.log', (w2, h) => (h.journal.avalanchego || []).filter(e => e.level !== 'SYS').slice(-200).map(e => `[${S.fmtLogTime(new Date(w2.base + e.t * 1000))}] ${e.msg}`).join('\n') + '\n', { owner: 'ubuntu' });
    if (sp.tmpBinary) S.fsWrite(n, `/tmp/avalanchego-v${sp.tmpBinary}/avalanchego`, BIN(sp.tmpBinary), { mode: '755', owner: 'root' });
    if (sp.prevBin) S.fsWrite(n, BINP + '.prev', BIN(sp.prevBin), { mode: '755', owner: 'root' });
    n.dirs.add('/tmp'); n.dirs.add('/root'); n.dirs.add('/home/ssm-user');
    n.disk.used = diskUsed(n);
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
      if (sp.restarts) svc(n).restarts = sp.restarts;
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
      if (n.fresh) freshTick(w, n, dt);
      n.disk.used = diskUsed(n);
      n.vol.mods.forEach(m => {
        if (m.state === 'modifying' && w.t - m.start >= 60) { m.state = 'optimizing'; n.vol.visible = m.target; }
        if (m.state === 'optimizing' && w.t - m.start >= 2400) { m.state = 'completed'; m.end = w.t; }
      });
      if (s.state === 'active' && availGB(n) * GiB < MIN_FREE) lowDisk(w, n);
      if (s.state === 'activating' && w.t >= a.nextRestart && n.powered !== false) {
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
        if (!reachOk(w, n) && w.t - s.since > 60 && w.t - a.lastIpWarn >= 120) { a.lastIpWarn = w.t; log(w, n, 'WARN', `<main> health/health.go:256 health check failing {"check": "network", "error": "primary network validator has no inbound connections", "advertisedIP": "${cfgIp(w, n)}"}`); }
        if (healthy(w, n) && w.t - a.lastInfo >= 120) { a.lastInfo = w.t; log(w, n, 'INFO', `<P Chain> snowman/transitive.go:418 consensus accepted block {"height": ${Math.floor(25028167 + w.t / 3)}}`); }
      }
      if (!n.fresh || a.validator) a.up.elapsed += dt;
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
      potentialReward: String(Math.round(av(n).potentialReward * 1e9)), delegationFee: n.fresh ? (av(n).fee * 100).toFixed(4) : '2.0000',
    };
  }
  async function http(w, host, req, ctx) {
    const nodes = Object.values(w.nodes);
    if (req.host === 'checkip.amazonaws.com') return { status: 200, body: (host.ip || '203.0.113.50') + '\n' };
    if (w.chain.fresh) { const r = freshHttp(w, host, req); if (r) return r; }
    if (req.host === 'github.com' && /\/ava-labs\/avalanchego\/releases\/download\//.test(req.path)) {
      const m = /v(\d+\.\d+\.\d+)\/avalanchego-linux-amd64-v\1\.tar\.gz$/.exec(req.path);
      if (!m || !['1.14.1', '1.14.2', '1.15.0'].includes(m[1])) return { status: 404, body: 'Not Found' };
      return { status: 200, body: TARBALL(m[1]), size: 41943040, wait: 4 };
    }
    if (req.host === 'api.avax.network') {
      if (req.path === '/ext/bc/P' && req.json && req.json.method === 'platform.getCurrentValidators') {
        const ids = (req.json.params && req.json.params.nodeIDs) || null;
        const list = nodes.filter(n => av(n).validator && (!ids || ids.includes(n.nodeID))).map(n => validatorRecord(w, n, false));
        w.chain.seen = w.chain.seen || {};
        nodes.filter(n => !ids || ids.includes(n.nodeID)).forEach(n => { w.chain.seen[n.moniker] = true; if (n.fresh && av(n).validator) n.fresh.seenAt = w.t; });
        if (list.length) S.flag(w, 'pchain_view');
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
        if (n.fresh && ok && av(n).validator) n.fresh.healthAt = w.t;
        return { status: ok ? 200 : 503, body: JSON.stringify({ checks, healthy: ok }) };
      }
      const j = req.json || {}, p = j.params || {};
      if (req.path === '/ext/info') {
        switch (j.method) {
          case 'info.isBootstrapped':
            if (av(n).boot) {
              const ch = { P: 'P', X: 'X', C: 'C', '11111111111111111111111111111111LpoYY': 'P', '2oYMBNV4eNHyqk2fjjV5nVQLDbtmNJzq5s3qs3Lo6ftnC6FByM': 'X', '2q9e4r6Mu3U68nU1fYjgbR6JvwrRx36CohpAX5UQxse55x1Q5': 'C' }[p.chain];
              if (!ch) return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: `there is no chain with alias/ID '${p.chain || ''}'`, data: null }, id: j.id ?? 1 }) };
              return rpc(j.id, { isBootstrapped: av(n).boot[ch] <= 0 });
            }
            return rpc(j.id, { isBootstrapped: !(p.chain === 'C' && av(n).replay > 0) });
          case 'info.peers': return rpc(j.id, { numPeers: String(versionOk(w, n) ? av(n).peers : 41), peers: [] });
          case 'info.getNodeID':
            if (n.fresh) n.fresh.idAt = w.t;
            return rpc(j.id, { nodeID: n.nodeID, nodePOP: n.pop || { publicKey: '0x8f95423f7142d00a48e1014a3de8d28907d420dc33b3052a6dee03a3f2941a393c2351e354704ca66a3fc29870282e15', proofOfPossession: '0x86a3ab4c45cfe31cae34c1d06f212434ac71b1be6cfe046c80c162e057614a94a5bc9f1ded1a7029deb0ba4ca7c9b71411e293438691be79c2dbf19d1ca7c3eadb9c756246fc5de5b7b89511c7d7302ae051d9e03d7991138299b5ed6a570a98' } });
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

  /* ---------- alert rules (names/thresholds from the production avalanche, disk and probe rules) ---------- */
  // a fresh host is not under monitoring until it is registered as a validator
  const nodesOf = w => Object.values(w.nodes).filter(n => !n.fresh || av(n).validator);
  const rules = [
    { name: 'AvalancheNodeUnhealthy', severity: 'critical', for: 120, check: w => nodesOf(w).filter(n => !healthy(w, n)).map(n => ({ instance: n.hostname, summary: `health check failing — ${firstFailing(w, n)}` })) },
    { name: 'NodeDown', severity: 'critical', for: 300, check: w => nodesOf(w).filter(n => !active(n)).map(n => ({ instance: n.hostname, summary: 'job="avalanchego" up == 0 (cannot scrape /ext/metrics)' })) },
    { name: 'AvalancheValidatorNotConnected', severity: 'critical', for: 900, check: w => nodesOf(w).filter(n => av(n).validator && !connected(w, n)).map(n => ({ instance: n.hostname, summary: 'api.avax.network reports connected=false; uptime is being lost' })) },
    { name: 'AvalancheRewardingStakeLow', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => av(n).validator && uptimePct(n) < 95).map(n => ({ instance: n.hostname, summary: `P-Chain uptime ${uptimePct(n).toFixed(2)}% < 95%` })) },
    { name: 'AvalancheRewardingStakeCritical', severity: 'critical', for: 600, check: w => nodesOf(w).filter(n => av(n).validator && uptimePct(n) < 90).map(n => ({ instance: n.hostname, summary: `P-Chain uptime ${uptimePct(n).toFixed(2)}% < 90% (below the reward threshold)` })) },
    { name: 'AvalancheBlocksBehind', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => active(n) && av(n).replay > 100).map(n => ({ instance: n.hostname, summary: `C-Chain ${Math.round(av(n).replay)} blocks behind` })) },
    { name: 'ExternalProbeFailure', severity: 'critical', for: 300, check: w => nodesOf(w).filter(n => !(active(n) && n.probeIp === n.ip && !n.sgBlocked)).map(n => ({ instance: `${n.probeIp}:9651`, summary: `validator-${n.moniker} · tcp_connect failed from us-east-1, eu-west-1, ap-southeast-1` })) },
    { name: 'AvalancheRewardAtRiskAtPeriodEnd', severity: 'critical', for: 1800, check: w => nodesOf(w).filter(n => av(n).validator && uptimePct(n) < 92 && periodLeft(n) < 604800).map(n => ({ instance: n.hostname, summary: `${n.hostname} is under 92% with under a week left - the reward is about to be lost (uptime ${uptimePct(n).toFixed(2)}%, period ends in ${S.fmtDur(periodLeft(n))})` })) },
    { name: 'DiskSpaceLow', severity: 'warning', for: 600, check: w => nodesOf(w).filter(n => n.powered !== false && availPct(n) < 15).map(n => ({ instance: `${n.hostname}:/`, summary: `Disk space is low on ${n.hostname}:/ (${availPct(n).toFixed(1)}% available)` })) },
    { name: 'DiskSpaceCritical', severity: 'critical', for: 300, check: w => nodesOf(w).filter(n => n.powered !== false && availPct(n) < 5).map(n => ({ instance: `${n.hostname}:/`, summary: `Disk space is critically low on ${n.hostname}:/ (${availPct(n).toFixed(2)}% available)` })) },
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

  /* ---------- commands: disk and volume ---------- */
  const positional = (args, valueFlags = []) => { const out = []; for (let i = 0; i < args.length; i++) { if (valueFlags.includes(args[i])) { i++; continue; } if (args[i].startsWith('-')) continue; out.push(args[i]); } return out; };
  const exists = (n, p) => !!S.fsGet(n, p) || S.fsIsDir(n, p);
  nodeCommands.df = ctx => {
    const n = ctx.host, h = S.hasFlag(ctx.args, '-h');
    const size = n.disk.size * GiB, used = diskUsed(n) * GiB, avail = Math.max(0, size - used);
    const f = b => h ? human(b) : String(Math.ceil(b / 1024));
    let rows = [[n.disk.dev, f(size), f(used), f(avail), Math.ceil(used / size * 100) + '%', '/'],
      ['tmpfs', h ? '7.7G' : '8031012', '0', h ? '7.7G' : '8031012', '0%', '/dev/shm'],
      ['/dev/nvme0n1p15', h ? '105M' : '106858', h ? '6.1M' : '6186', h ? '99M' : '100672', '6%', '/boot/efi']];
    const want = positional(ctx.args);
    if (want.length) rows = rows.filter(r => want.some(p => { const q = ctx.resolve(p); return r[5] === '/' ? !q.startsWith('/dev/shm') && !q.startsWith('/boot/efi') : q.startsWith(r[5]); }));
    return S.table(rows, ['Filesystem', h ? 'Size' : '1K-blocks', 'Used', h ? 'Avail' : 'Available', 'Use%', 'Mounted on']) + '\n';
  };
  nodeCommands.du = ctx => {
    const n = ctx.host, h = S.hasFlag(ctx.args, '-h');
    const depth = S.opt(ctx.args, ['--max-depth', '-d']);
    const paths = positional(ctx.args, ['-d', '--max-depth']); if (!paths.length) paths.push('.');
    const f = b => h ? human(Math.max(4096, b)) : String(Math.ceil(Math.max(4096, b) / 1024));
    let out = '', code = 0;
    for (const a of paths) {
      const p = ctx.resolve(a);
      if (!exists(n, p)) { out += `du: cannot access '${a}': No such file or directory\n`; code = 1; continue; }
      if (String(depth) === '1' && !S.fsGet(n, p)) S.fsList(n, p).forEach(c => { const q = S.norm(p + '/' + c); out += `${f(sizeUnder(n, q))}\t${a.replace(/\/$/, '')}/${c}\n`; });
      out += `${f(sizeUnder(n, p))}\t${a}\n`;
    }
    return { code, out };
  };
  nodeCommands.find = ctx => {
    const n = ctx.host, a = ctx.args;
    const root = ctx.resolve(a[0] && !a[0].startsWith('-') ? a[0] : '.');
    const sz = S.opt(a, ['-size']);
    const m = sz && /^\+(\d+)([kMG])$/.exec(sz);
    const min = m ? +m[1] * { k: 1024, M: 1048576, G: GiB }[m[2]] : 0;
    const hits = Object.keys(n.fs).filter(k => k.startsWith(root === '/' ? '/' : root + '/') && (n.fs[k].size || 0) > min).sort();
    const ex = a.indexOf('-exec');
    if (ex >= 0 && a[ex + 1] === 'du') return hits.map(k => `${human(n.fs[k].size || 0)}\t${k}`).join('\n') + (hits.length ? '\n' : '');
    if (ex >= 0 && a[ex + 1] === 'ls') return hits.map(k => `-rw-r--r-- 1 ${n.fs[k].owner || 'root'} ${n.fs[k].owner || 'root'} ${human(n.fs[k].size || 0)} Oct 14 21:47 ${k}`).join('\n') + (hits.length ? '\n' : '');
    return hits.join('\n') + (hits.length ? '\n' : '');
  };
  nodeCommands.journalctl = ctx => {
    const n = ctx.host, a = ctx.args;
    const jfiles = () => Object.keys(n.fs).filter(k => k.startsWith(JDIR + '/'));
    const total = () => jfiles().reduce((t, k) => t + (n.fs[k].size || 0), 0);
    if (a.includes('--disk-usage')) return `Archived and active journals take up ${human(total())} in the file system.\n`;
    const vi = a.findIndex(x => /^--vacuum-(size|time)/.test(x));
    if (vi < 0) return S.commands.journalctl(ctx);
    if (!ctx.isRoot) return { code: 1, out: `Failed to open journal directory ${JDIR}: Permission denied\n` };
    const kind = /size/.test(a[vi]) ? 'size' : 'time';
    const val = a[vi].includes('=') ? a[vi].split('=')[1] : a[vi + 1] || '';
    const mm = /^(\d+)([KMGd]?)$/.exec(val);
    if (!mm) return { code: 1, out: `Failed to parse --vacuum-${kind}= value: ${val}\n` };
    const archived = jfiles().filter(k => k.endsWith('~')).sort((x, y) => (n.fs[y].age || 0) - (n.fs[x].age || 0));
    let freed = 0, out = '', cur = total();
    const limit = kind === 'size' ? +mm[1] * ({ K: 1024, M: 1048576, G: GiB }[mm[2]] || 1) : null;
    archived.forEach(k => {
      const fl = n.fs[k];
      if (kind === 'size' ? cur <= limit : (fl.age || 0) < +mm[1]) return;
      out += `Deleted archived journal ${k} (${human(fl.size)}).\n`; cur -= fl.size; freed += fl.size; S.fsRemove(n, k);
    });
    return out + `Vacuuming done, freed ${human(freed)} of archived journals from ${JDIR}.\n`;
  };
  nodeCommands.lsblk = ctx => {
    const n = ctx.host, g = gb => { const t = gb / 1024; return t >= 1 ? t.toFixed(1).replace(/\.0$/, '') + 'T' : gb + 'G'; };
    return `NAME         MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nnvme0n1      259:0    0 ${g(n.vol.visible).padStart(5)}  0 disk \n├─nvme0n1p1  259:1    0 ${g(n.vol.part).padStart(5)}  0 part /\n├─nvme0n1p14 259:2    0    4M  0 part \n└─nvme0n1p15 259:3    0  106M  0 part /boot/efi\n`;
  };
  const SECT = 2097152, START = 227328;
  nodeCommands.growpart = ctx => {
    const n = ctx.host, [dev, part] = positional(ctx.args);
    if (!dev || !part) return { code: 2, out: 'growpart disk partition\n   rewrite partition table so that partition takes up all the space it can\n' };
    if (!ctx.isRoot) return { code: 2, out: `FAILED: ${dev}: Permission denied\n` };
    if (dev !== '/dev/nvme0n1') return { code: 2, out: dev === '/dev/nvme0n1p1' ? 'FAILED: /dev/nvme0n1p1: is a partition, give the disk (growpart /dev/nvme0n1 1)\n' : `FAILED: ${dev}: does not exist\n` };
    if (String(part) !== '1') return { code: 1, out: `NOCHANGE: partition ${part} could only be grown by 0 [fudge=2048]\n` };
    const old = n.vol.part * SECT - START;
    if (n.vol.visible <= n.vol.part) return { code: 1, out: `NOCHANGE: partition 1 is size ${old}. it cannot be grown\n` };
    n.vol.part = n.vol.visible;
    const neu = n.vol.part * SECT - START;
    return `CHANGED: partition=1 start=${START} old: size=${old} end=${old + START} new: size=${neu} end=${neu + START}\n`;
  };
  nodeCommands.resize2fs = ctx => {
    const n = ctx.host, [dev] = positional(ctx.args);
    const head = 'resize2fs 1.47.0 (5-Feb-2023)\n';
    if (!dev) return { code: 1, out: head + 'Usage: resize2fs [-d debug_flags] [-f] [-F] [-M] [-P] [-p] device [-b|-s|new_size] [-S RAID-stride] [-z undo_file]\n' };
    if (!['/dev/nvme0n1p1', '/dev/root'].includes(dev)) return { code: 1, out: head + `resize2fs: No such file or directory while trying to open ${dev}\nCouldn't find valid filesystem superblock.\n` };
    if (!ctx.isRoot) return { code: 1, out: head + 'resize2fs: Permission denied to resize filesystem\n' };
    const blocks = gb => gb * 262144;
    if (n.vol.part <= n.disk.size) return { code: 0, out: head + `The filesystem is already ${blocks(n.disk.size)} (4k) blocks long.  Nothing to do!\n\n` };
    const before = n.disk.size; n.disk.size = n.vol.part;
    return head + `Filesystem at ${dev} is mounted on /; on-line resizing required\nold_desc_blocks = ${Math.ceil(blocks(before) / 32768 / 64)}, new_desc_blocks = ${Math.ceil(blocks(n.disk.size) / 32768 / 64)}\nThe filesystem on ${dev} is now ${blocks(n.disk.size)} (4k) blocks long.\n\n`;
  };
  nodeCommands.xfs_growfs = () => ({ code: 1, out: 'xfs_growfs: / is not a mounted XFS filesystem\n' });
  nodeCommands.xfs_growfs.hidden = true;

  /* ---------- commands: small calculators (both on nodes and on the workstation) ---------- */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = x => String(x).padStart(2, '0');
  const dateCmd = ctx => {
    const a = ctx.args; let d = ctx.w.now();
    const di = a.findIndex(x => x === '-d' || x === '--date' || x.startsWith('--date=') || x.startsWith('-d@'));
    if (di >= 0) {
      const v = a[di].startsWith('--date=') ? a[di].slice(7) : a[di].startsWith('-d@') ? a[di].slice(2) : a[di + 1] || '';
      if (/^@-?\d+(\.\d+)?$/.test(v)) d = new Date(parseFloat(v.slice(1)) * 1000);
      else if (v !== 'now') return { code: 1, out: `date: invalid date '${v}'\n` };
    }
    const fmt = a.find(x => x.startsWith('+'));
    const Y = d.getUTCFullYear(), M = p2(d.getUTCMonth() + 1), D = p2(d.getUTCDate()), T = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
    if (!fmt) return `${DAYS[d.getUTCDay()]} ${MONS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${T} UTC ${Y}\n`;
    return fmt.slice(1).replace(/%([FTYmdHMSsZ])/g, (_, c) => ({ F: `${Y}-${M}-${D}`, T, Y, m: M, d: D, H: p2(d.getUTCHours()), M: p2(d.getUTCMinutes()), S: p2(d.getUTCSeconds()), s: String(Math.floor(d.getTime() / 1000)), Z: 'UTC' })[c]) + '\n';
  };
  /* bc: + - * / % ^ and parentheses, with bc's scale rules for * and / */
  function bcEval(src, scale) {
    const toks = src.match(/\d*\.?\d+|[-+*/%^()]/g) || [];
    if (toks.join('') !== src.replace(/\s+/g, '')) throw new Error('syntax');
    let i = 0;
    const num = t => ({ v: parseFloat(t), s: t.includes('.') ? t.split('.')[1].length : 0 });
    const prim = () => { const t = toks[i++]; if (t === '(') { const r = add(); if (toks[i++] !== ')') throw new Error('syntax'); return r; } if (t === '-') { const r = prim(); return { v: -r.v, s: r.s }; } if (t === undefined || !/\d/.test(t)) throw new Error('syntax'); return num(t); };
    const pow = () => { const b = prim(); if (toks[i] === '^') { i++; const e = pow(); return { v: Math.pow(b.v, Math.trunc(e.v)), s: Math.min(b.s * Math.abs(Math.trunc(e.v)), Math.max(scale, b.s)) }; } return b; };
    const mul = () => { let l = pow(); while (['*', '/', '%'].includes(toks[i])) { const op = toks[i++], r = pow(); if (op === '*') l = { v: l.v * r.v, s: Math.min(l.s + r.s, Math.max(scale, l.s, r.s)) }; else if (op === '/') { if (r.v === 0) throw new Error('Divide by zero'); l = { v: l.v / r.v, s: scale }; } else l = { v: l.v % r.v, s: Math.max(l.s, r.s) }; } return l; };
    const add = () => { let l = mul(); while (toks[i] === '+' || toks[i] === '-') { const op = toks[i++], r = mul(); l = { v: op === '+' ? l.v + r.v : l.v - r.v, s: Math.max(l.s, r.s) }; } return l; };
    const r = add(); if (i !== toks.length) throw new Error('syntax');
    return r;
  }
  const bc = ctx => {
    let scale = S.hasFlag(ctx.args, '-l') ? 20 : 0, out = '';
    for (const st of String(ctx.stdin || '').split(/[;\n]/).map(x => x.trim()).filter(Boolean)) {
      const m = /^scale\s*=\s*(\d+)$/.exec(st);
      if (m) { scale = +m[1]; continue; }
      try {
        const r = bcEval(st, scale), f = Math.pow(10, r.s), t = Math.trunc(r.v * f + (r.v >= 0 ? 1e-9 : -1e-9)) / f;
        out += t.toFixed(r.s).replace(/^(-?)0\./, '$1.') + '\n';
      } catch (e) { out += e.message === 'Divide by zero' ? 'Runtime error (func=(main), adr=5): Divide by zero\n' : '(standard_in) 1: syntax error\n'; }
    }
    return out;
  };
  nodeCommands.date = dateCmd; nodeCommands.bc = bc;

  /* ---------- commands: laptop ---------- */
  function findNode(w, key) { return Object.values(w.nodes).find(n => n.moniker === key || n.instanceId === key || n.hostname === key); }
  function openSession(ctx, n) {
    if (n.powered === false) return { code: 254, out: `\nAn error occurred (TargetNotConnected) when calling the StartSession operation: ${n.instanceId} is not connected.\n${C.gray(S.L('（实例当前处于 stopped 状态）', '(the instance is currently stopped)'))}\n` };
    ctx.sh.push({ host: n, user: 'ssm-user', cwd: '/home/ssm-user', env: { HOME: '/home/ssm-user', USER: 'ssm-user' } });
    n.sessions = (n.sessions || 0) + 1;
    return `\nStarting session with SessionId: ops-${n.id}-0a1b2c3d\n${C.gray(S.L(`已登录 ${n.hostname}（${n.region}）。sudo -i 切换到 root，exit 退出。`, `Connected to ${n.hostname} (${n.region}). sudo -i for root, exit to leave.`))}\n`;
  }
  /* ---------- EBS: describe, modify (online), modification progress ---------- */
  function ebs(ctx, op, f) {
    const w = ctx.w, region = f.region || 'us-east-1';
    const inRegion = Object.values(w.nodes).filter(n => n.region === region);
    const volJson = n => ({ Attachments: [{ AttachTime: '2025-11-02T17:21:44+00:00', Device: '/dev/sda1', InstanceId: n.instanceId, State: 'attached', VolumeId: n.vol.id, DeleteOnTermination: true }], AvailabilityZone: region + 'a', CreateTime: '2025-11-02T17:21:40.112000+00:00', Encrypted: true, Size: n.vol.size, SnapshotId: 'snap-0c1d2e3f4a5b6c7d8', State: 'in-use', VolumeId: n.vol.id, Iops: n.vol.iops, VolumeType: n.vol.type, MultiAttachEnabled: false, Throughput: n.vol.throughput });
    const modJson = (n, m) => Object.assign({ VolumeId: n.vol.id, ModificationState: m.state, TargetSize: m.target, TargetIops: 3000, TargetVolumeType: 'gp3', TargetThroughput: 125, TargetMultiAttachEnabled: false, OriginalSize: m.from, OriginalIops: 3000, OriginalVolumeType: 'gp3', OriginalThroughput: 125, OriginalMultiAttachEnabled: false, Progress: m.state === 'completed' ? 100 : m.state === 'modifying' ? Math.min(9, Math.floor((w.t - m.start) / 7)) : Math.min(99, 10 + Math.floor((w.t - m.start) / 26)), StartTime: S.isoTime(new Date(w.base + m.start * 1000)).replace('Z', '+00:00') }, m.end ? { EndTime: S.isoTime(new Date(w.base + m.end * 1000)).replace('Z', '+00:00') } : {});
    const ids = String(f['volume-ids'] || f['volume-id'] || '').split(/[ ,]/).filter(Boolean);
    const fm = /Name=attachment\.instance-id,Values=([\w-]+)/.exec(f.filters || '');
    let vols = inRegion.filter(n => (!ids.length || ids.includes(n.vol.id)) && (!fm || fm[1] === n.instanceId));
    if (op === 'describe-volumes') {
      if (ids.length && !vols.length) return { code: 254, out: `\nAn error occurred (InvalidVolume.NotFound) when calling the DescribeVolumes operation: The volume '${ids[0]}' does not exist.\n` };
      if (f.output === 'table') {
        const rows = vols.map(n => [n.vol.id, String(n.vol.size), n.vol.type, String(n.vol.iops), String(n.vol.throughput)]);
        const wd = [0, 1, 2, 3, 4].map(i => Math.max(...rows.map(r => r[i].length), 1) + 2);
        const bar = '+' + wd.map(x => '-'.repeat(x + 2)).join('+') + '+';
        const title = 'DescribeVolumes';
        return `${'-'.repeat(bar.length)}\n|${' '.repeat(Math.floor((bar.length - 2 - title.length) / 2))}${title}${' '.repeat(Math.ceil((bar.length - 2 - title.length) / 2))}|\n${bar}\n${rows.map(r => '|' + r.map((c, i) => '  ' + c.padEnd(wd[i])).join('|') + '|').join('\n')}\n${bar}\n`;
      }
      return JSON.stringify({ Volumes: vols.map(volJson) }, null, 4) + '\n';
    }
    if (op === 'describe-volumes-modifications') {
      if (ids.length && !vols.length) return { code: 254, out: `\nAn error occurred (InvalidVolume.NotFound) when calling the DescribeVolumesModifications operation: The volume '${ids[0]}' does not exist.\n` };
      return JSON.stringify({ VolumesModifications: vols.flatMap(n => n.vol.mods.map(m => modJson(n, m))) }, null, 4) + '\n';
    }
    const vid = f['volume-id'];
    if (!vid) return { code: 252, out: '\naws: error: the following arguments are required: --volume-id\n' };
    const n = inRegion.find(x => x.vol.id === vid);
    if (!n) return { code: 254, out: `\nAn error occurred (InvalidVolume.NotFound) when calling the ModifyVolume operation: The volume '${vid}' does not exist.${Object.values(w.nodes).some(x => x.vol.id === vid) ? ' ' + C.gray(S.L('（卷不在这个区域，检查 --region）', '(the volume is in another region; check --region)')) : ''}\n` };
    const size = parseInt(f.size, 10);
    if (!size) return { code: 254, out: '\nAn error occurred (MissingParameter) when calling the ModifyVolume operation: At least one of size, iops, throughput or volume type must be specified.\n' };
    const last = n.vol.mods[n.vol.mods.length - 1];
    if (last && w.t - last.start < 6 * 3600) return { code: 254, out: '\nAn error occurred (VolumeModificationRateExceeded) when calling the ModifyVolume operation: You\'ve reached the maximum modification rate per volume limit. Wait at least 6 hours between modifications per EBS volume.\n' };
    if (size < n.vol.size) return { code: 254, out: `\nAn error occurred (InvalidParameterValue) when calling the ModifyVolume operation: New size cannot be smaller than existing size of ${n.vol.size} GiB.\n` };
    if (size === n.vol.size) return { code: 254, out: '\nAn error occurred (InvalidParameterCombination) when calling the ModifyVolume operation: The parameter combination is not valid: the requested modification is the same as the current volume configuration.\n' };
    if (size > 16384) return { code: 254, out: '\nAn error occurred (InvalidParameterValue) when calling the ModifyVolume operation: Volume of 16385GiB is too large for volume type gp3; maximum is 16384GiB.\n' };
    const m = { start: w.t, from: n.vol.size, target: size, state: 'modifying' };
    n.vol.mods.push(m); n.vol.size = size;
    S.event(w, 'sys', S.LL(`<b>${n.moniker}</b> 的根卷 ${vid} 开始扩容：${m.from} → ${size} GiB（在线进行，不需要停机）。`, `Root volume ${vid} of <b>${n.moniker}</b> is being resized: ${m.from} → ${size} GiB (online, no downtime).`));
    return JSON.stringify({ VolumeModification: modJson(n, m) }, null, 4) + '\n';
  }

  /* ---------- pull requests: the upgrade manifest (A1/A2) and instance changes ---------- */
  const prList = w => w.chain.prs || (w.chain.pr ? [w.chain.pr] : []);
  const REPO = 'example-staking/fleet';
  async function resizeFlow(w, pr) {
    const n = w.nodes[pr.moniker];
    S.event(w, 'sys', S.LL(`instance-resize · <b>${n.moniker}</b>：停止 avalanchego，停止实例，改为 ${pr.to}`, `instance-resize · <b>${n.moniker}</b>: stopping avalanchego and the instance, changing it to ${pr.to}`));
    stop(w, n); n.powered = false;
    await S.sleep(w, pr.downMin * 60 - 90);
    n.instanceType = pr.to; n.mem = { total: pr.memGB * 1024, used: Math.round(pr.memGB * 1024 * 0.3) }; n.powered = true; n.bootAt = w.t; n.upBase = 0;
    sysLog(w, n, 'Started avalanchego.service - Avalanche Node.'); start(w, n);
    S.event(w, 'sys', S.LL(`instance-resize · <b>${n.moniker}</b>：实例已在 ${pr.to} 上启动，avalanchego 正在重放区块`, `instance-resize · <b>${n.moniker}</b>: the instance is up on ${pr.to}; avalanchego is replaying blocks`));
    for (let i = 0; i < 120 && !healthy(w, n); i++) await S.sleep(w, 30);
    if (healthy(w, n)) S.event(w, 'ok', S.LL(`instance-resize · <b>${n.moniker}</b>：完成，节点健康`, `instance-resize · <b>${n.moniker}</b>: done, the node is healthy`));
  }
  async function gh(ctx) {
    const w = ctx.w, f = ctx.flags, [g, sub, num] = f._;
    const prs = prList(w);
    if (g !== 'pr' || !prs.length) return { code: 1, out: `${C.gray(S.L('本练习支持：', 'Available in this lab: ') + 'gh pr list · gh pr view <n> · gh pr merge <n>' + (w.chain.prs ? ' · gh pr close <n> · gh pr edit <n> --add-label L · gh pr comment <n> --body TEXT' : ''))}\n` };
    const deadline = () => {
      const A = act(w); if (A === null) return '';
      const left = A - w.t;
      return left > 86400 ? `Network deadline: ${S.fmtClock(new Date(w.base + A * 1000))}` : left > 0 ? C.red(`⛔ DEADLINE IS TODAY — ${S.fmtDur(left)} left`) : C.red(`⛔ DEADLINE PASSED ${S.fmtDur(-left)} ago`);
    };
    const state = pr => pr.merged ? C.magenta('MERGED') : pr.closed ? C.red('CLOSED') : C.green('OPEN');
    if (sub === 'list') {
      const open = prs.filter(p => !p.merged && !p.closed);
      if (!open.length) return `no open pull requests in ${REPO}\n`;
      return open.map(p => `#${p.n}  ${p.title}  ${C.gray(p.branch || 'upgrade/avalanche-1.15.0')}${(p.labels || []).length ? '  ' + C.yellow(p.labels.join(', ')) : ''}  OPEN`).join('\n') + '\n';
    }
    const pr = prs.find(p => String(p.n) === String(num));
    if (['view', 'merge', 'close', 'edit', 'comment'].includes(sub) && !pr) return { code: 1, out: `GraphQL: Could not resolve to a PullRequest with the number of ${num}. (repository.pullRequest)\n` };
    const url = `https://github.com/${REPO}/pull/${pr && pr.n}`;
    if (sub === 'view') {
      if (pr.kind === 'resize') return `${C.bold(pr.title)}\n${REPO} #${pr.n} · ${state(pr)} · ${pr.author}${(pr.labels || []).length ? ' · labels: ' + pr.labels.join(', ') : ''}\n\n${pr.body}\n${(pr.comments || []).map(c => `\n${C.bold('ops')} commented\n  ${c}\n`).join('')}\n${C.gray(`View this pull request on GitHub: ${url}`)}\n`;
      return `${C.bold(pr.title)}\n${REPO} #${pr.n} · ${state(pr)} · fleet-bot\n\n${deadline()}\n\n  upgrades/manifest/avalanche.yaml\n${Object.values(w.nodes).map(n => `    - moniker: ${n.moniker}\n      components:\n-       avalanchego: ${binVer(S.fsRead(w, n, BINP))}\n+       avalanchego: ${MIN}`).join('\n')}\n\n${C.gray('Merging this PR authorises upgrade-apply.yml to roll these nodes (max 2 at a time).')}\n`;
    }
    if (sub === 'merge') {
      if (pr.merged) return { code: 1, out: `! Pull request #${pr.n} was already merged\n` };
      if (pr.closed) return { code: 1, out: `X Pull request #${pr.n} is closed\n` };
      pr.merged = true;
      if (pr.kind === 'resize') {
        S.event(w, 'sys', S.LL(`已合并 PR #${pr.n}。<b>instance-resize</b> 工作流开始处理 ${pr.moniker}。`, `PR #${pr.n} merged. The <b>instance-resize</b> workflow starts on ${pr.moniker}.`));
        resizeFlow(w, pr);
        return `${C.green('✓')} Merged pull request #${pr.n} (${pr.title})\n${C.gray(S.L('instance-resize 已触发，进度显示在右侧的事件记录中。', 'instance-resize started; progress appears in the event log on the right.'))}\n`;
      }
      S.event(w, 'sys', S.LL(`已合并 PR #${pr.n}。<b>upgrade-apply</b> 工作流开始滚动升级，每次最多 2 台。`, `PR #${pr.n} merged. The <b>upgrade-apply</b> workflow starts a rolling upgrade, at most 2 nodes at a time.`));
      rollFleet(w, w.chain.primitive || 'v2');
      return `${C.green('✓')} Merged pull request #${pr.n} (${pr.title})\n${C.gray(S.L('upgrade-apply 已触发，进度显示在右侧的事件记录中。', 'upgrade-apply started; progress appears in the event log on the right.'))}\n`;
    }
    if (sub === 'close') {
      if (pr.merged) return { code: 1, out: `X Pull request #${pr.n} can't be closed because it was already merged\n` };
      if (pr.closed) return { code: 0, out: `! Pull request #${pr.n} is already closed\n` };
      pr.closed = true;
      const cm = f.comment || f.c; if (typeof cm === 'string') (pr.comments = pr.comments || []).push(cm);
      return `${C.red('✓')} Closed pull request #${pr.n} (${pr.title})\n`;
    }
    if (sub === 'edit') {
      const add = f['add-label'], rm = f['remove-label'];
      if (typeof add !== 'string' && typeof rm !== 'string') return { code: 1, out: 'nothing to edit: use --add-label or --remove-label\n' };
      pr.labels = pr.labels || [];
      if (typeof add === 'string') add.split(',').map(x => x.trim()).filter(Boolean).forEach(l => { if (!pr.labels.includes(l)) pr.labels.push(l); });
      if (typeof rm === 'string') pr.labels = pr.labels.filter(l => !rm.split(',').map(x => x.trim()).includes(l));
      return url + '\n';
    }
    if (sub === 'comment') {
      const body = f.body || f.b;
      if (typeof body !== 'string') return { code: 1, out: 'must provide --body when not running interactively\n' };
      (pr.comments = pr.comments || []).push(body);
      return `${url}#issuecomment-${2391000000 + Math.floor(w.rand() * 99999)}\n`;
    }
    return { code: 1, out: 'unknown gh pr subcommand\n' };
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
        const rows = Object.values(ctx.w.nodes).filter(n => n.region === region).map(n => [`validator-${n.moniker}`, n.instanceId, n.ip, n.instanceType, n.powered === false ? 'stopped' : 'running']);
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
      if (svcName === 'ec2' && ['describe-volumes', 'modify-volume', 'describe-volumes-modifications'].includes(op)) return ebs(ctx, op, f);
      return { code: 2, out: `${C.gray(S.L('本练习支持：', 'Available in this lab: ') + 'aws sts get-caller-identity · aws ec2 describe-instances|describe-volumes|modify-volume|describe-volumes-modifications --region R · aws ssm start-session --region R --target ID · aws ssm send-command / get-command-invocation')}\n` };
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
    gh,
    date: dateCmd, bc,
    nc: async ctx => {
      const [ip, port] = ctx.flags._.filter(x => !x.startsWith('-'));
      if (!ip || !port) return { code: 1, out: 'usage: nc -zv <ip> <port>\n' };
      const n = Object.values(ctx.w.nodes).find(x => x.ip === ip && active(x) && !x.sgBlocked && fwAllows(x, port));
      const apiOpen = n && n.fresh && String(port) === '9650' && !loopback(httpHost(ctx.w, n));
      await ctx.sleep(n && (String(port) === '9651' || apiOpen) ? 0.3 : 5);
      if (n && String(port) === '9651') { if (n.fresh) n.fresh.ncAt = ctx.w.t; return `Connection to ${ip} 9651 port [tcp/*] succeeded!\n`; }
      if (apiOpen) return `Connection to ${ip} 9650 port [tcp/*] succeeded!\n`;
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

  /* ---------- a fresh host (guided lab, step 2): only built when config.freshNodes is set ----------
     Ubuntu with nothing installed. ufw filters inbound traffic. The operator downloads and verifies the
     release, creates the service user, config and unit, starts the node and watches P, X and C bootstrap. */
  const UNITP = '/etc/systemd/system/avalanchego.service';
  const BOOT = { P: 5400, X: 1500, C: 6000 };     // simulated seconds of first sync per chain (compressed)
  const BOOT_TOTAL = BOOT.P + BOOT.X + BOOT.C;
  const BOOT_DB_GB = 412;                         // database size once state sync and bootstrap are done
  const BUCKET = 'example-validator-backups';
  const loopback = h => ['127.0.0.1', 'localhost', '::1'].includes(String(h));
  const httpHost = (w, n) => { const c = cfg(w, n); return c && c['http-host'] !== undefined ? String(c['http-host']) : '127.0.0.1'; };
  function users(n) {
    const m = {};
    String(S.fsRead(null, n, '/etc/passwd') || '').split('\n').forEach(l => { const f = l.split(':'); if (f[0] && f.length >= 7) m[f[0]] = { uid: +f[2], gid: +f[3], home: f[5], shell: f[6] }; });
    return m;
  }
  function unitOf(w, n) {
    const c = S.fsRead(w, n, UNITP);
    if (c == null) return null;
    const get = k => { const m = new RegExp('^\\s*' + k + '\\s*=(.*)$', 'm').exec(c); return m ? m[1].trim() : null; };
    return { user: get('User') || 'root', exec: get('ExecStart') || '', desc: get('Description') || 'avalanchego.service', limit: get('LimitNOFILE') };
  }
  // systemd sees the unit once the file exists (a never-loaded unit is loaded on first reference)
  function syncUnit(w, n) {
    const u = unitOf(w, n), s = n.avSvc;
    if (u) { n.services.avalanchego = s; s.exec = u.exec; s.desc = u.desc; }
    else if (n.services.avalanchego && s.state !== 'active' && s.state !== 'activating') delete n.services.avalanchego;
  }
  function startFresh(w, n) {
    const s = svc(n), a = av(n), u = unitOf(w, n) || { user: 'root', exec: '' };
    s.pid = 1000 + Math.floor(w.rand() * 30000);
    s.since = w.t;
    const exe = u.exec.split(/\s+/)[0] || BINP;
    const ver = binVer(S.fsRead(w, n, exe));
    if (!ver) { sysLog(w, n, `avalanchego.service: Failed at step EXEC spawning ${exe}: No such file or directory`); return crash(w, n, 203); }
    const us = users(n), who = us[u.user];
    if (!who) {
      sysLog(w, n, 'avalanchego.service: Failed to determine user credentials: No such process');
      sysLog(w, n, `avalanchego.service: Failed at step USER spawning ${exe}: No such process`);
      return crash(w, n, 217);
    }
    const cm = /--config-file[= ](\S+)/.exec(u.exec);
    n.cfgPath = cm ? cm[1] : null;
    let c = {};
    if (n.cfgPath) {
      const raw = S.fsRead(w, n, n.cfgPath);
      if (raw == null) { log(w, n, 'FATAL', `couldn't load node config: open ${n.cfgPath}: no such file or directory`); return crash(w, n, 1); }
      c = cfg(w, n);
      if (!c) { log(w, n, 'FATAL', `couldn't load node config: invalid character in ${n.cfgPath} (check JSON syntax)`); return crash(w, n, 1); }
    }
    if (!S.fsIsDir(n, who.home)) { log(w, n, 'FATAL', `couldn't create data directory: mkdir ${who.home}/.avalanchego: no such file or directory`); return crash(w, n, 1); }
    n.avHome = (u.user === 'root' ? '/root' : who.home) + '/.avalanchego';
    const ST = stakingOf(n);
    log(w, n, 'INFO', `<main> app/app.go:183 initializing node {"version": "avalanchego/${ver}", "commit": "a3f40fd"}`);
    if (!S.fsGet(n, ST + '/staker.crt') || !S.fsGet(n, ST + '/signer.key')) {
      if (a.validator) {
        log(w, n, 'FATAL', `couldn't initialize staking: open ${ST}/staker.crt: no such file or directory`);
        S.flag(w, 'lost_identity');
        return crash(w, n, 1);
      }
      S.fsWrite(n, ST + '/staker.crt', '-----BEGIN CERTIFICATE-----\nMIIFNzCCAx+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAAMCAXDTk5MTIzMTAwMDAw\n(simulated)\n-----END CERTIFICATE-----\n', { mode: '400', owner: u.user, size: 1984 });
      S.fsWrite(n, ST + '/staker.key', '-----BEGIN PRIVATE KEY-----\n(simulated - never print a real private key)\n-----END PRIVATE KEY-----\n', { mode: '400', owner: u.user, size: 3272 });
      S.fsWrite(n, ST + '/signer.key', '(32-byte BLS secret key, binary)', { mode: '400', owner: u.user, size: 32 });
      log(w, n, 'INFO', `<main> config/config.go:1121 no staking key found, generating a new TLS key and certificate {"keyPath": "${ST}/staker.key", "certPath": "${ST}/staker.crt"}`);
      log(w, n, 'INFO', `<main> config/config.go:1178 no BLS signer key found, generating a new one {"path": "${ST}/signer.key"}`);
    }
    log(w, n, 'INFO', `<main> node/node.go:291 initializing staking identity {"nodeID": "${n.nodeID}"}`);
    if (availGB(n) * GiB < MIN_FREE) return lowDisk(w, n);
    if (a.db && S.semverCmp(ver, a.db) < 0) {
      log(w, n, 'FATAL', 'chains/manager.go:393 error creating required chain error while creating new snowman vm failed to load the database state: unknown codec version');
      return crash(w, n, 1);
    }
    if (!a.db) {
      a.db = ver; a.boot = Object.assign({}, BOOT); a.bootLog = {};
      const D = dbOf(n) + '/mainnet/v1.4.5';
      ['CURRENT', 'LOCK', 'LOG', 'MANIFEST-000004'].forEach(f => S.fsWrite(n, `${D}/${f}`, '(leveldb data)', { owner: u.user, size: 16 }));
      log(w, n, 'INFO', '<main> database is empty - bootstrapping the Primary Network from peers (P-Chain first, then X-Chain and C-Chain)');
    } else if (S.semverCmp(ver, a.db) > 0) { log(w, n, 'INFO', `<main> database/manager.go:88 migrating database ${dbv(a.db)} → ${dbv(ver)}`); a.replay += MIGRATION_BLOCKS; a.db = ver; }
    else if (bootDone(n)) { const down = a.stoppedAt != null ? Math.max(0, w.t - a.stoppedAt) : 0; a.replay += 60 + Math.round(down / 2); }
    s.state = 'active'; a.running = ver; a.lastProgressLog = w.t; a.stoppedAt = null;
    log(w, n, 'INFO', `<main> node/node.go:1490 node started {"publicIP": "${c['public-ip'] || '(auto)'}", "stakingPort": ${c['staking-port'] || 9651}, "httpHost": "${httpHost(w, n)}", "httpPort": ${c['http-port'] || 9650}}`);
    return null;
  }
  const CHAIN_NAME = { P: 'P Chain', X: 'X Chain', C: 'C Chain' };
  function freshTick(w, n, dt) {
    syncUnit(w, n);
    const s = svc(n), a = av(n);
    if (s.state !== 'active') return;
    if (!loopback(httpHost(w, n)) && fwAllows(n, 9650)) S.flag(w, 'api_public');
    if (!a.boot || bootDone(n) || !versionOk(w, n)) return;
    const b = a.boot, run = b.P > 0 ? ['P'] : ['X', 'C'].filter(k => b[k] > 0);
    run.forEach(k => {
      b[k] = Math.max(0, b[k] - dt);
      const done = 1 - b[k] / BOOT[k], eta = S.fmtDur(b[k]).replace(/\s/g, '');
      const last = a.bootLog[k] || -1e9;
      if (b[k] === 0) {
        log(w, n, 'INFO', k === 'C' ? '<C Chain> snowman/bootstrap/bootstrapper.go:771 finished state sync and bootstrapping {"height": ' + tip(w) + '}' : `<${CHAIN_NAME[k]}> snowman/bootstrap/bootstrapper.go:771 finished bootstrapping`);
        if (bootDone(n)) { log(w, n, 'INFO', '<main> all chains bootstrapped; snowman consensus started on P, X and C'); log(w, n, 'INFO', '<main> health/health.go:142 health check passed'); a.lastInfo = w.t; }
      } else if (w.t - last >= 30) {
        a.bootLog[k] = w.t;
        if (k === 'P') {
          const total = 25028167 + Math.floor(w.t / 3);
          log(w, n, 'INFO', done < 0.5 ? `<P Chain> bootstrap/bootstrapper.go:612 fetching blocks {"numFetchedBlocks": ${Math.floor(total * done * 2)}, "numTotalBlocks": ${total}, "eta": "${eta}"}` : `<P Chain> bootstrap/interval/blocks.go:191 executing blocks {"numExecuted": ${Math.floor(total * (done - 0.5) * 2)}, "numToExecute": ${total}, "eta": "${eta}"}`);
        } else if (k === 'X') {
          log(w, n, 'INFO', `<X Chain> bootstrap/bootstrapper.go:612 fetching blocks {"numFetchedBlocks": ${Math.floor(98420 * done)}, "numTotalBlocks": 98420, "eta": "${eta}"}`);
        } else {
          log(w, n, 'INFO', done < 0.85 ? `<C Chain> sync/statesync/trie_sync_stats.go:162 state sync: syncing leafs {"leafs": ${Math.floor(310e6 * done / 0.85)}, "eta": "${eta}"}` : `<C Chain> sync/client/client.go:212 state sync: fetching blocks {"remaining": ${Math.floor(256 * (1 - done) / 0.15)}}`);
        }
      }
    });
    a.dbGB = BOOT_DB_GB * (1 - ['P', 'X', 'C'].reduce((t, k) => t + b[k], 0) / BOOT_TOTAL);
  }
  const SIG_DATE = 'Tue Sep  8 16:20:41 2026 UTC';
  const RELEASE_FPR = '5395BDA1129CAC3E74699D07D93080B0C0D5FE8B';
  function freshHttp(w, host, req) {
    if (req.host === 'github.com') {
      const m = /\/ava-labs\/avalanchego\/releases\/download\/v(\d+\.\d+\.\d+)\/(avalanchego-linux-amd64-v\1\.tar\.gz)\.sig$/.exec(req.path);
      if (m) return ['1.14.1', '1.14.2', '1.15.0'].includes(m[1]) ? { status: 200, body: 'SIG:' + JSON.stringify({ file: m[2], ver: m[1] }), size: 566 } : { status: 404, body: 'Not Found' };
    }
    if (req.host === 'downloads.avax.network') {
      if (req.path === '/avalanchego.gpg.key') return { status: 200, body: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQINBF7T...(Ava Labs, Inc. release signing key, simulated)\n-----END PGP PUBLIC KEY BLOCK-----\n', size: 3127 };
      return { status: 404, body: 'Not Found' };
    }
    return null;
  }
  function registerFresh(w, n, o) {
    const a = av(n);
    if (!bootDone(n) || !active(n)) S.flag(w, 'early_register');
    a.validator = true; a.offline = 0;
    a.up = { elapsed: 0, down: 0, period: o.durSec };
    a.weight = o.stake; a.fee = o.fee;
    a.potentialReward = +(o.stake * 0.071 * o.durSec / (365 * 86400)).toFixed(4);
    n.fresh.valStart = w.t; n.fresh.txID = o.txID;
  }
  function backupOk(w, n) {
    const ST = stakingOf(n), obj = w.chain.s3 || {};
    return ['staker.crt', 'staker.key', 'signer.key'].every(f => { const local = S.fsRead(w, n, ST + '/' + f); return local != null && Object.keys(obj).some(k => k.endsWith('/' + f) && obj[k].c === local); });
  }
  function makeFreshNode(w, sp) {
    const n = S.makeHost({
      id: sp.moniker, moniker: sp.moniker, hostname: sp.hostname || `validator-${sp.moniker}`, instanceId: sp.instanceId, region: sp.region,
      ip: sp.ip, probeIp: sp.ip, nodeID: sp.nodeID, pop: sp.pop, kind: 'node', homeUser: 'ubuntu',
      mem: { total: sp.memGB * 1024, used: 900 }, disk: { size: sp.diskGB, used: 0, dev: '/dev/nvme0n1p1' },
      cpus: sp.cpus || 8, instanceType: sp.type, upBase: 2400, bootAt: 0, load: [0.03, 0.06, 0.02],
    });
    n.fresh = {};
    n.av = {
      db: null, running: null, replay: 0, peers: sp.peers || 2370, stoppedAt: null, nextRestart: null, codecCrashes: 0,
      validator: false, offline: 0, lastWarn: -1e9, lastErr: -1e9, lastIpWarn: -1e9, lastInfo: 0,
      up: { elapsed: 0, down: 0, period: 1 }, potentialReward: 0, weight: 0, fee: 0.02, dbGB: 0, boot: null,
    };
    n.vol = { id: 'vol-0' + sp.instanceId.slice(3).split('').reverse().join(''), size: sp.diskGB, visible: sp.diskGB, part: sp.diskGB, type: 'gp3', iops: 3000, throughput: 125, mods: [] };
    n.ufw = { active: true, rules: [] };
    S.fsWrite(n, '/etc/passwd', 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nsyslog:x:107:113::/home/syslog:/usr/sbin/nologin\nubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash\nssm-user:x:1001:1001::/home/ssm-user:/bin/sh\n');
    S.fsWrite(n, '/etc/os-release', 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.3 LTS (Noble Numbat)"\nVERSION_CODENAME=noble\nID=ubuntu\n');
    S.fsWrite(n, '/home/ubuntu/.bashrc', '# ~/.bashrc\n', { owner: 'ubuntu' });
    ['/tmp', '/root', '/home/ssm-user', '/usr/local/bin', '/etc/systemd/system'].forEach(d => n.dirs.add(d));
    n.disk.base = 6.4; n.disk.used = diskUsed(n);
    n.avSvc = { name: 'avalanchego', desc: 'avalanchego.service', unitPath: UNITP, state: 'inactive', since: 0, pid: 0, exec: '', restarts: 0, enabled: false, memStr: () => `${(1.2 + 8 * (av(n).dbGB / BOOT_DB_GB)).toFixed(1)}G`, tasks: 31 };
    n.services['amazon-ssm-agent'] = { name: 'amazon-ssm-agent', desc: 'amazon-ssm-agent', unitPath: '/etc/systemd/system/amazon-ssm-agent.service', state: 'active', since: -2400, pid: 812, exec: '/usr/bin/amazon-ssm-agent' };
    n.isBusy = (w2, p) => p === BINP && active(n);
    n.procs = w2 => active(n) ? [{ user: (unitOf(w2, n) || {}).user || 'root', pid: svc(n).pid, cpu: bootDone(n) ? '38.4' : '296', mem: '22.0', cmd: svc(n).exec }] : [];
    n.listening = w2 => active(n) ? [{ addr: `${loopback(httpHost(w2, n)) ? '127.0.0.1' : httpHost(w2, n) === '0.0.0.0' ? '0.0.0.0' : httpHost(w2, n)}:9650`, proc: 'avalanchego', pid: svc(n).pid }, { addr: '*:9651', proc: 'avalanchego', pid: svc(n).pid }] : [];
    n.commands = freshCommands(n);
    return n;
  }

  /* ---------- commands that exist only on a fresh host ---------- */
  function freshCommands(n) {
    const K = S.commands;
    const pos = (args, valueFlags = []) => { const out = []; for (let i = 0; i < args.length; i++) { if (valueFlags.includes(args[i])) { i++; continue; } if (args[i].startsWith('-') && args[i] !== '-') continue; out.push(args[i]); } return out; };
    const cmds = {};
    cmds.systemctl = async ctx => {
      syncUnit(ctx.w, n);
      let args = ctx.args.slice();
      const now = args.includes('--now'); args = args.filter(x => x !== '--now');
      const sub = args[0], wasEnabled = n.avSvc.enabled;
      const r = await K.systemctl(Object.assign({}, ctx, { args }));
      let out = (r && r.out) || '', code = (r && r.code) || 0;
      if (sub === 'enable' && code === 0 && args.slice(1).some(x => x.replace(/\.service$/, '') === 'avalanchego') && n.services.avalanchego && !wasEnabled) out = `Created symlink /etc/systemd/system/multi-user.target.wants/avalanchego.service → ${UNITP}.\n` + out;
      if (now && code === 0 && (sub === 'enable' || sub === 'disable')) { const r2 = await K.systemctl(Object.assign({}, ctx, { args: [sub === 'enable' ? 'start' : 'stop', ...args.slice(1)] })); out += (r2 && r2.out) || ''; code = (r2 && r2.code) || 0; }
      return { code, out };
    };
    cmds.avalanchego = ctx => {
      if (!S.fsGet(n, BINP)) return { code: 127, out: `bash: ${ctx.name}: command not found\n` };
      return nodeCommands.avalanchego(ctx);
    };
    cmds.nproc = () => `${n.cpus}\n`;
    cmds.ulimit = ctx => {
      const a = ctx.args.join(' ');
      if (/-a/.test(a)) return 'real-time non-blocking time  (microseconds, -R) unlimited\ncore file size              (blocks, -c) 0\nfile size                   (blocks, -f) unlimited\nmax locked memory           (kbytes, -l) 8192\nopen files                          (-n) 1024\nmax user processes                  (-u) 63601\nvirtual memory              (kbytes, -v) unlimited\n';
      return /H/.test(a) ? '524288\n' : '1024\n';
    };
    cmds.printf = ctx => {
      const [fmt, ...vals] = ctx.args;
      if (fmt === undefined) return { code: 2, out: 'printf: usage: printf [-v var] format [arguments]\n' };
      let i = 0;
      return fmt.replace(/\\(n|t|\\|"|')|%(%|s|d)/g, (m, e, f) => e ? { n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'" }[e] : f === '%' ? '%' : String(vals[i++] ?? (f === 'd' ? 0 : '')));
    };
    cmds.id = ctx => {
      const who = pos(ctx.args)[0];
      if (!who) return K.id(ctx);
      const u = users(n)[who];
      if (!u) return { code: 1, out: `id: '${who}': no such user\n` };
      return `uid=${u.uid}(${who}) gid=${u.gid}(${who}) groups=${u.gid}(${who})\n`;
    };
    cmds.useradd = ctx => {
      const a = ctx.args, VAL = ['-s', '--shell', '-d', '--home-dir', '-g', '--gid', '-G', '--groups', '-c', '--comment', '-u', '--uid'];
      if (!ctx.isRoot) return { code: 1, out: 'useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later.\n' };
      const name = pos(a, VAL)[0];
      if (!name) return { code: 2, out: 'Usage: useradd [options] LOGIN\n' };
      if (!/^[a-z_][a-z0-9_-]*$/.test(name)) return { code: 3, out: `useradd: invalid user name '${name}': use --badname to ignore\n` };
      const us = users(n);
      if (us[name]) return { code: 9, out: `useradd: user '${name}' already exists\n` };
      const sys = a.includes('-r') || a.includes('--system');
      const mk = (a.includes('-m') || a.includes('--create-home')) && !a.includes('-M');
      const home = S.opt(a, ['-d', '--home-dir']) || `/home/${name}`;
      const shell = S.opt(a, ['-s', '--shell']) || (sys ? '/usr/sbin/nologin' : '/bin/sh');
      const ids = Object.values(us).map(u => u.uid);
      let uid = sys ? 999 : 1002; while (ids.includes(uid)) uid += sys ? -1 : 1;
      S.fsWrite(n, '/etc/passwd', S.fsRead(ctx.w, n, '/etc/passwd') + `${name}:x:${uid}:${uid}::${home}:${shell}\n`);
      if (mk) n.dirs.add(home);
      return '';
    };
    cmds.ufw = ctx => {
      const u = n.ufw, a = ctx.args.filter(x => x !== '--force');
      if (!ctx.isRoot) return { code: 1, out: 'ERROR: You need to be root to run this script\n' };
      const sub = a[0];
      const spec = x => { const m = /^(\d+)(\/(tcp|udp))?$/.exec(x || ''); return m ? m[1] + (m[3] ? '/' + m[3] : '') : null; };
      const table = () => u.rules.length ? `\nTo                         Action      From\n--                         ------      ----\n${u.rules.map(r => `${r.padEnd(27)}ALLOW       Anywhere`).join('\n')}\n${u.rules.map(r => `${(r + ' (v6)').padEnd(27)}ALLOW       Anywhere (v6)`).join('\n')}\n` : '';
      if (!sub || sub === 'status') {
        if (!u.active) return 'Status: inactive\n';
        if (a[1] === 'verbose') return `Status: active\nLogging: on (low)\nDefault: deny (incoming), allow (outgoing), deny (routed)\nNew profiles: skip\n${table()}`;
        return `Status: active\n${table()}`;
      }
      if (sub === 'enable') { u.active = true; return 'Firewall is active and enabled on system startup\n'; }
      if (sub === 'disable') { u.active = false; return 'Firewall stopped and disabled on system startup\n'; }
      if (sub === 'reload') return u.active ? 'Firewall reloaded\n' : 'Firewall not enabled (skipping reload)\n';
      if (sub === 'default') return `Default incoming policy changed to '${a[1] || 'deny'}'\n(be sure to update your rules accordingly)\n`;
      if (sub === 'allow') {
        const r = spec(a[1] === 'in' ? a[2] : a[1]);
        if (!r) return { code: 1, out: S.L('ERROR: 本练习支持 ufw allow <端口>[/tcp]\n', 'ERROR: this lab supports ufw allow <port>[/tcp]\n') };
        if (u.rules.includes(r)) return 'Skipping adding existing rule\nSkipping adding existing rule (v6)\n';
        u.rules.push(r); return 'Rule added\nRule added (v6)\n';
      }
      if (sub === 'delete' || sub === 'deny') {
        const r = spec(sub === 'delete' ? a[2] : a[1]);
        const had = u.rules.length; u.rules = u.rules.filter(x => x !== r);
        if (sub === 'deny') return 'Rule updated\nRule updated (v6)\n';
        return had !== u.rules.length ? 'Rule deleted\nRule deleted (v6)\n' : 'Could not delete non-existent rule\nCould not delete non-existent rule (v6)\n';
      }
      return { code: 1, out: `ERROR: Invalid syntax\n${S.C.gray(S.L('（本练习支持：ufw status [verbose] · ufw allow|delete allow <端口>/tcp · ufw enable|disable）', '(this lab supports: ufw status [verbose] · ufw allow|delete allow <port>/tcp · ufw enable|disable)'))}\n` };
    };
    cmds.gpg = ctx => {
      const a = ctx.args, files = pos(a);
      if (a.includes('--import')) {
        const text = files.length ? S.fsRead(ctx.w, n, ctx.resolve(files[0])) : ctx.stdin;
        if (!text || !text.includes('BEGIN PGP PUBLIC KEY BLOCK')) return { code: 2, out: 'gpg: no valid OpenPGP data found.\ngpg: Total number processed: 0\n' };
        if (n.gpgKey) return 'gpg: key D93080B0C0D5FE8B: "Ava Labs, Inc. <contact@avalabs.org>" not changed\ngpg: Total number processed: 1\ngpg:              unchanged: 1\n';
        n.gpgKey = true;
        return `gpg: keybox '${ctx.sh.home()}/.gnupg/pubring.kbx' created\ngpg: ${ctx.sh.home()}/.gnupg/trustdb.gpg: trustdb created\ngpg: key D93080B0C0D5FE8B: public key "Ava Labs, Inc. <contact@avalabs.org>" imported\ngpg: Total number processed: 1\ngpg:               imported: 1\n`;
      }
      if (a.includes('--list-keys') || a.includes('-k') || a.includes('--fingerprint')) {
        if (!n.gpgKey) return '';
        return `pub   rsa4096 2020-05-31 [SC]\n      ${a.includes('--fingerprint') ? '5395 BDA1 129C AC3E 7469  9D07 D930 80B0 C0D5 FE8B' : RELEASE_FPR}\nuid           [ unknown] Ava Labs, Inc. <contact@avalabs.org>\nsub   rsa4096 2020-05-31 [E]\n\n`;
      }
      if (a.includes('--verify')) {
        const sigF = files[0], dataF = files[1] || (sigF || '').replace(/\.sig$/, '');
        if (!sigF) return { code: 2, out: 'usage: gpg --verify SIGFILE [DATAFILE]\n' };
        const sig = S.fsRead(ctx.w, n, ctx.resolve(sigF));
        if (sig == null) return { code: 2, out: `gpg: can't open '${sigF}': No such file or directory\ngpg: verify signatures failed: No such file or directory\n` };
        let meta; try { meta = JSON.parse(sig.replace(/^SIG:/, '')); } catch (e) { meta = null; }
        if (!sig.startsWith('SIG:') || !meta) return { code: 2, out: 'gpg: no valid OpenPGP data found.\ngpg: the signature could not be verified.\n' };
        const data = S.fsRead(ctx.w, n, ctx.resolve(dataF));
        if (data == null) return { code: 2, out: `gpg: no signed data\ngpg: can't hash datafile: No data\n` };
        const head = `gpg: Signature made ${SIG_DATE}\ngpg:                using RSA key ${RELEASE_FPR}\n`;
        if (!n.gpgKey) return { code: 2, out: head + 'gpg: Can\'t check signature: No public key\n' };
        if (data !== TARBALL(meta.ver)) return { code: 1, out: head + 'gpg: BAD signature from "Ava Labs, Inc. <contact@avalabs.org>" [unknown]\n' };
        n.fresh.verified = meta.ver;
        return head + 'gpg: Good signature from "Ava Labs, Inc. <contact@avalabs.org>" [unknown]\ngpg: WARNING: This key is not certified with a trusted signature!\ngpg:          There is no indication that the signature belongs to the owner.\nPrimary key fingerprint: 5395 BDA1 129C AC3E 7469  9D07 D930 80B0 C0D5 FE8B\n';
      }
      return { code: 2, out: `gpg: ${S.L('本练习支持：gpg --import [文件] · gpg --verify 签名 文件 · gpg --list-keys', 'this lab supports: gpg --import [FILE] · gpg --verify SIG FILE · gpg --list-keys')}\n` };
    };
    cmds.aws = async ctx => {
      const a = ctx.args, VAL = ['--sse', '--region', '--profile', '--sse-kms-key-id', '--output'];
      const p = pos(a, VAL), w = ctx.w, obj = w.chain.s3;
      if (p[0] === 'sts' && p[1] === 'get-caller-identity') return JSON.stringify({ UserId: `AROAEXAMPLEINSTANCE:${n.instanceId}`, Account: '111122223333', Arn: `arn:aws:sts::111122223333:assumed-role/${n.moniker}-instance-role/${n.instanceId}` }, null, 4) + '\n';
      if (p[0] !== 's3' || !['cp', 'ls'].includes(p[1])) return { code: 2, out: `${S.C.gray(S.L('本练习支持：aws sts get-caller-identity · aws s3 cp [--recursive] 源 目标 [--sse aws:kms] · aws s3 ls s3://桶/前缀/', 'Available in this lab: aws sts get-caller-identity · aws s3 cp [--recursive] SRC DST [--sse aws:kms] · aws s3 ls s3://bucket/prefix/'))}\n` };
      const s3 = x => { const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(x || ''); return m ? { bucket: m[1], key: m[2] } : null; };
      await ctx.sleep(1);
      if (p[1] === 'ls') {
        const t = s3(p[2]);
        if (!t) return { code: 1, out: '\naws: error: the following arguments are required: s3 path\n' };
        if (t.bucket !== BUCKET) return { code: 254, out: '\nAn error occurred (AccessDenied) when calling the ListObjectsV2 operation: Access Denied\n' };
        const pre = t.key && !t.key.endsWith('/') ? t.key + '/' : t.key;
        const keys = Object.keys(obj).filter(k => k.startsWith(pre));
        const dirs = [...new Set(keys.map(k => k.slice(pre.length)).filter(r => r.includes('/')).map(r => r.split('/')[0]))];
        const filesHere = keys.filter(k => !k.slice(pre.length).includes('/'));
        if (['staker.crt', 'staker.key', 'signer.key'].every(f => filesHere.some(k => k.endsWith('/' + f)))) n.fresh.listedAt = w.t;
        const d = k => S.fmtClock(new Date(w.base + obj[k].at * 1000)).slice(0, 19);
        return dirs.map(x => `                           PRE ${x}/`).concat(filesHere.map(k => `${d(k)} ${String(obj[k].size).padStart(10)} ${k.slice(pre.length)}`)).join('\n') + (dirs.length || filesHere.length ? '\n' : '');
      }
      const [src, dst] = [p[2], p[3]], t = s3(dst);
      if (!src || !dst) return { code: 252, out: '\naws: error: the following arguments are required: paths\n' };
      if (!t) return { code: 1, out: S.L('本练习只支持把文件上传到 S3（目标写成 s3://桶/前缀/）\n', 'this lab only supports uploads to S3 (the destination is s3://bucket/prefix/)\n') };
      const rec = a.includes('--recursive'), sp = ctx.resolve(src);
      const list = rec ? Object.keys(n.fs).filter(k => k.startsWith(sp.replace(/\/$/, '') + '/')).sort() : (S.fsGet(n, sp) ? [sp] : []);
      if (!list.length) return { code: 1, out: rec ? '' : `\nThe user-provided path ${src} does not exist.\n` };
      let out = '', code = 0;
      for (const f of list) {
        const rel = rec ? f.slice(sp.replace(/\/$/, '').length + 1) : f.slice(f.lastIndexOf('/') + 1);
        const key = t.key === '' || t.key.endsWith('/') ? t.key + rel : (rec ? t.key + '/' + rel : t.key);
        if (t.bucket !== BUCKET) { out += `upload failed: ${f} to s3://${t.bucket}/${key} An error occurred (AccessDenied) when calling the PutObject operation: Access Denied\n`; code = 1; continue; }
        if (!ctx.sh.canRead(f)) { out += `upload failed: ${f} to s3://${t.bucket}/${key} [Errno 13] Permission denied: '${f}'\n`; code = 1; continue; }
        const c = S.fsRead(w, n, f);
        obj[key] = { c, size: S.fsGet(n, f).size || String(c).length, at: w.t, sse: S.opt(a, ['--sse']) || null };
        out += `upload: ${rec ? src.replace(/\/$/, '') + '/' + rel : src} to s3://${t.bucket}/${key}\n`;
      }
      return { code, out };
    };
    return cmds;
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
        if (n.powered === false) { st = L('实例已停止', 'instance stopped'); cls = 'bad'; }
        else if (n.fresh && !n.services.avalanchego) { st = L('尚未安装', 'not installed'); cls = 'warn'; }
        else if (s.state === 'activating') { st = L(`反复崩溃 ×${s.restarts}`, `crash loop ×${s.restarts}`); cls = 'bad'; }
        else if (s.state !== 'active') { st = L('已停止', 'stopped'); cls = 'bad'; }
        else if (!versionOk(w, n)) { st = L('版本过低，被网络断开', 'version too old, rejected'); cls = 'bad'; }
        else if (a.replay > 0) { st = L(`重放中，剩 ${Math.round(a.replay).toLocaleString()} 块`, `replaying, ${Math.round(a.replay).toLocaleString()} blocks left`); cls = 'warn'; }
        else if (!bootDone(n)) { const left = ['P', 'X', 'C'].filter(k => a.boot[k] > 0); st = L(`引导中：${left.join('、')}`, `bootstrapping ${left.join(', ')}`); cls = 'warn'; }
        else if (!ipOk(w, n)) { st = L('无法从外部连接', 'unreachable from outside'); cls = 'bad'; }
        else { st = 'healthy'; cls = 'ok'; }
        const proj = projected(n), cur = uptimePct(n);
        const pos = v => Math.max(0, Math.min(100, (v - 85) / 15 * 100));
        const binv = binVer(S.fsRead(w, n, BINP));
        return `<div class="avx-node ${cls}">
          <div class="an-top"><b>${n.moniker}</b><span class="an-reg">${n.region}</span><span class="pill ${cls}">${st}</span></div>
          <div class="an-row"><span>${L('运行版本', 'running')}</span><b class="mono">${a.running || '—'}</b><span>${L('磁盘上的版本', 'on disk')}</span><b class="mono">${binv || L('缺失', 'missing')}</b><span>${L('数据库', 'database')}</span><b class="mono">${a.db ? dbv(a.db) : L('空', 'empty')}</b></div>
          <div class="an-row"><span>${L('根盘', 'root disk')}</span><b class="mono ${availPct(n) < 5 ? 'badc' : ''}">${Math.ceil(100 - availPct(n))}% · ${human(availGB(n) * GiB)} ${L('可用', 'free')}</b><span>${L('机型', 'type')}</span><b class="mono">${n.instanceType}</b></div>
          ${a.boot && !bootDone(n) && s.state === 'active' ? `<div class="bar"><i style="width:${Math.max(2, 100 * (1 - ['P', 'X', 'C'].reduce((t, k) => t + Math.max(0, a.boot[k]), 0) / BOOT_TOTAL))}%"></i></div>` : ''}
          ${a.replay > 0 && s.state === 'active' ? `<div class="bar"><i style="width:${Math.max(2, 100 - a.replay / (MIGRATION_BLOCKS + 500) * 100)}%"></i></div>` : ''}
          ${a.validator ? `<div class="an-row"><span>connected</span><b class="${connected(w, n) ? 'okc' : 'badc'}">${connected(w, n) ? 'true' : 'false'}</b><span>${L('当前在线率', 'uptime now')}</span><b class="mono">${cur.toFixed(3)}%</b><span>${L('本次离线', 'offline here')}</span><b class="mono ${a.offline >= 1 ? 'badc' : ''}">${S.fmtDur(a.offline)}</b></div>
          <div class="ubar"><i style="width:${pos(proj)}%" class="${proj < 90 ? 'b' : proj < 95 ? 'w' : ''}"></i><em style="left:${pos(90)}%"></em><span>${L('期末', 'end of period')} ${proj.toFixed(3)}% · ${L('剩余', 'ends in')} ${S.fmtDur(periodLeft(n))}</span></div>` : `<div class="an-row"><span>${L('不在验证者集合中', 'not in the validator set')}</span></div>`}
        </div>`;
      }).join('');
    },
  };

  const LOGO = () => '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#E84142"/><path transform="translate(0 1.8)" fill="#fff" d="M11.47 22.37H8.37C7.71 22.37 7.39 22.37 7.2 22.25C6.98 22.11 6.85 21.88 6.84 21.63C6.83 21.4 6.99 21.12 7.31 20.55L14.97 7.05C15.3 6.47 15.46 6.19 15.67 6.08C15.89 5.97 16.16 5.97 16.39 6.08C16.59 6.19 16.76 6.47 17.08 7.05L18.66 9.8C19.02 10.42 19.2 10.74 19.28 11.06C19.36 11.42 19.36 11.8 19.28 12.16C19.2 12.49 19.02 12.8 18.66 13.42L14.64 20.54C14.27 21.18 14.09 21.49 13.85 21.73C13.57 21.99 13.25 22.18 12.89 22.28C12.56 22.37 12.2 22.37 11.47 22.37ZM19.31 22.37H23.75C24.41 22.37 24.74 22.37 24.93 22.24C25.15 22.11 25.28 21.87 25.29 21.62C25.3 21.4 25.15 21.13 24.84 20.59L22.58 16.73C22.24 16.16 22.08 15.89 21.88 15.79C21.65 15.67 21.39 15.67 21.17 15.79C20.96 15.89 20.8 16.17 20.47 16.73L18.25 20.54C17.92 21.12 17.76 21.4 17.77 21.63C17.79 21.88 17.91 22.11 18.13 22.25C18.32 22.37 18.65 22.37 19.31 22.37Z"/></svg>';

  S.registerNetwork({
    id: 'avalanche', name: 'Avalanche', color: '#f5a623', logo: LOGO,
    desc: S.LL('Primary Network 验证者：avalanchego 的进程与配置、数据库版本、网络升级、P-Chain 在线率与奖励门槛。', 'Primary Network validators: the avalanchego process and its config, database versions, network upgrades, P-Chain uptime and the reward threshold.'),
    init(w, cfg) {
      w.chain = { activation: cfg.activation ?? null, upgrade: cfg.upgrade || 'Helicon', cHeight0: 87015424, pr: cfg.pr ? Object.assign({}, cfg.pr) : null, primitive: cfg.primitive || 'v2', showUpgradeAlert: !!cfg.showUpgradeAlert, fresh: !!cfg.freshNodes, s3: {} };
      (cfg.nodes || []).forEach(sp => { w.nodes[sp.moniker] = makeNode(w, sp); });
      (cfg.freshNodes || []).forEach(sp => { w.nodes[sp.moniker] = makeFreshNode(w, sp); });
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
      const DB = dbOf(h), STAKING = stakingOf(h), HOME = homeOf(h);
      if (h.fresh && !h.av.db) return;
      if (p === DB || p.startsWith(DB + '/') || p === HOME) { if (!Object.keys(h.fs).some(k => k.startsWith(DB + '/'))) { h.av.db = null; S.flag(w, 'wipe_db'); } }
      if (p === STAKING || p.startsWith(STAKING) || p === HOME) S.flag(w, 'lost_identity');
      if (p.startsWith(DB + '/') && Object.keys(h.fs).some(k => k.startsWith(DB + '/'))) {
        S.flag(w, 'db_files');
      }
    },
    helpers: { healthy, connected, versionOk, ipOk, uptimePct, projected, binVer, BIN, MIN, active, availPct, diskUsed, periodLeft, bootDone, unitOf, users, httpHost, loopback, fwAllows, registerFresh, backupOk, stakingOf, cfg },
  });
})(SIM);
