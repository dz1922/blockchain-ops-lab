/* ============================================================
   Network plugin: Canton (a Splice validator node on the Global Synchronizer)
   Mechanisms modelled:
   - the validator node as a docker compose project: postgres, participant, validator app,
     two web UIs and nginx; health checks, depends_on ordering, restart vs recreate,
     a named postgres volume that outlives its containers
   - mining rounds (about 10 minutes); the validator records liveness activity once per round
   - sync lag: the participant's cursor vs wall clock (ledger-indexer /status), and the round
     the validator last recorded vs the round the SV scans report (scan-proxy /api/sync)
   - traffic: purchased extra traffic (bytes) that every submission consumes; automated
     top-ups and manual purchases paid in CC from the validator wallet
   - Splice versions: the MainNet-ready release is the one 2/3 of SV scans report; once the SVs
     switch to the new packages, a node left on the old release stops recording activity
   ============================================================ */
(function (S) {
  'use strict';
  const C = S.C, LL = S.LL;
  const DIR = '/opt/splice-node/docker-compose/validator';
  const ENVP = DIR + '/.env', COMPOSEP = DIR + '/compose.yaml';
  const PROJECT = 'splice-validator';
  const VOL = 'splice-validator_postgres-splice', VOLP = '/var/lib/docker/volumes/' + VOL;
  const DAEMON = '/etc/docker/daemon.json';
  const REPO = 'ghcr.io/digital-asset/decentralized-canton-sync/docker/';
  const ROUND = 600;            // seconds per mining round
  const CATCHUP = 300;          // seconds of synchronizer time replayed per second while catching up
  const LAG_OK = 120;           // cursor lag under which the validator can act on current data
  const SYNCED = 5;             // rounds; /api/sync reports synced within this many rounds of the SV head
  const MIN_TOPUP = 200000;     // bytes; smallest traffic purchase the network accepts
  const USD_PER_MB = 60, CC_USD = 0.16, REWARD = 4.1, RECORD_BYTES = 2400;
  const RED_LINE = 50000;       // dashboard threshold for Traffic Remainder
  const GB = 1073741824;
  const ccFor = b => b / 1e6 * USD_PER_MB / CC_USD;
  const hex = (seed, len) => { const r = S.rng(seed); let s = ''; for (let i = 0; i < len; i++) s += '0123456789abcdef'[Math.floor(r() * 16)]; return s; };
  const hstr = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const NS = '1220' + hex(101, 64);
  const PARTY = `validator-01::${NS}`;
  const PARTICIPANT = `PAR::validator-01::${NS}`;
  const DOMAIN = `global-domain::1220${hex(202, 64)}`;
  const SPONSOR = `sv-3::1220${hex(303, 64)}`;
  const PARTNER = `validator-07::1220${hex(404, 64)}`;
  const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbmlzdHJhdG9yIiwiYXVkIjoiaHR0cHM6Ly92YWxpZGF0b3IuZXhhbXBsZSJ9.dHJhaW5pbmctb25seS1ub3QtYS1yZWFsLXRva2Vu';
  const err = (out, code = 1) => ({ code, out: out.endsWith('\n') ? out : out + '\n' });
  const gray = s => C.gray(s);
  const fmtB = b => Math.round(b).toLocaleString('en-US');
  const iso = (w, t) => new Date(w.base + t * 1000).toISOString();
  const tagOf = img => (img || '').slice((img || '').lastIndexOf(':') + 1);

  /* ---------- compose services ---------- */
  const SPECS = [
    { svc: 'postgres-splice', img: e => `postgres:${e.POSTGRES_VERSION || '14'}`, cmd: '"docker-entrypoint.s…"', ports: '5432/tcp', boot: 8, gb: 0.43 },
    { svc: 'participant', img: e => `${e.IMAGE_REPO}canton-participant:${e.IMAGE_TAG}`, cmd: '"/app/entrypoint.sh"', ports: '5001-5002/tcp, 7575/tcp', boot: 75, gb: 1.21, splice: true },
    { svc: 'validator', img: e => `${e.IMAGE_REPO}validator-app:${e.IMAGE_TAG}`, cmd: '"/app/entrypoint.sh"', ports: '5003/tcp', boot: 50, gb: 1.05, splice: true, envKeys: ['MIGRATION_ID', 'PARTY_HINT', 'TARGET_TRAFFIC_THROUGHPUT', 'MIN_TOPUP_INTERVAL'] },
    { svc: 'wallet-web-ui', img: e => `${e.IMAGE_REPO}wallet-web-ui:${e.IMAGE_TAG}`, cmd: '"/docker-entrypoint.…"', ports: '8080/tcp', boot: 4, gb: 0.07, splice: true },
    { svc: 'ans-web-ui', img: e => `${e.IMAGE_REPO}ans-web-ui:${e.IMAGE_TAG}`, cmd: '"/docker-entrypoint.…"', ports: '8080/tcp', boot: 4, gb: 0.07, splice: true },
    { svc: 'nginx', img: () => 'nginx:1.27.3', cmd: '"/docker-entrypoint.…"', ports: '0.0.0.0:80->80/tcp', boot: 3, gb: 0.19 },
  ];
  const WAITS = { participant: 'postgres-splice', validator: 'participant' };   // depends_on: condition: service_healthy
  const AUX = [
    { svc: 'ledger-indexer', name: 'ledger-indexer', image: 'ledger-indexer:2.3.1', cmd: '"python -m indexer"', ports: '127.0.0.1:8090->8090/tcp', boot: 5, gb: 0.31 },
    { svc: 'scan-proxy', name: 'scan-proxy', image: 'scan-proxy:1.9.0', cmd: '"node server.js"', ports: '127.0.0.1:8100->8100/tcp', boot: 5, gb: 0.28 },
  ];
  const specOf = svc => SPECS.find(s => s.svc === svc);

  /* ---------- small helpers on node state ---------- */
  const ctrList = n => Object.values(n.cn.ctrs).sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
  const bySvc = (n, svc) => Object.values(n.cn.ctrs).find(r => r.svc === svc && (r.project === PROJECT || r.project === svc));
  const running = r => !!r && r.state === 'running';
  const healthy = r => running(r) && r.health === 'healthy';
  const dockerUp = n => n.services.docker.state === 'active';
  const logPath = id => `/var/lib/docker/containers/${id}/${id}-json.log`;
  const netRound = w => w.chain.round0 + Math.floor((w.t + w.chain.phase) / ROUND);
  const roundLeft = w => ROUND - ((w.t + w.chain.phase) % ROUND);
  const quorum = w => {
    const svs = w.chain.svs, need = Math.ceil(svs.length * 2 / 3);
    const vs = [...new Set(svs.map(s => s.v))].sort((a, b) => S.semverCmp(b, a));
    return vs.find(v => svs.filter(s => S.semverCmp(s.v, v) >= 0).length >= need) || vs[vs.length - 1];
  };
  const atLeast = (w, v) => w.chain.svs.filter(s => S.semverCmp(s.v, v) >= 0).length;
  const localTag = n => { const v = bySvc(n, 'validator'); return v ? tagOf(v.image) : null; };
  const versionOk = (w, n) => { const ch = w.chain; return ch.switchAt == null || w.t < ch.switchAt || S.semverCmp(localTag(n) || '0.0.0', ch.required) >= 0; };
  const processing = n => { const cn = n.cn, p = bySvc(n, 'participant'); return dockerUp(n) && healthy(p) && !cn.full && !cn.pgCorrupt; };
  const behind = (w, n) => netRound(w) - n.cn.ourRound;
  const synced = (w, n) => behind(w, n) <= SYNCED && n.cn.lag < LAG_OK;
  const unhealthyCount = n => dockerUp(n) ? ctrList(n).filter(r => running(r) && r.health === 'unhealthy').length : 0;
  const upMetric = (n, svc) => { if (!dockerUp(n)) return false; const r = bySvc(n, svc); return running(r) && r.health !== 'unhealthy'; };
  const topupTarget = r => (r && parseInt(r.env.TARGET_TRAFFIC_THROUGHPUT, 10)) || 0;
  const parseDur = s => { const m = /^(\d+)\s*(s|m|h)?$/.exec(String(s || '').trim()); return m ? +m[1] * ({ s: 1, m: 60, h: 3600 }[m[2] || 's']) : 60; };
  const parseSize = s => { const m = /^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i.exec(String(s || '')); if (!m) return 0; return +m[1] * ({ k: 1 / 1048576, m: 1 / 1024, g: 1 }[(m[2] || 'm').toLowerCase()]); };
  const logCap = opts => opts && opts['max-size'] ? parseSize(opts['max-size']) * (parseInt(opts['max-file'] || '1', 10) || 1) : 0;

  /* ---------- disk accounting (GB) ---------- */
  function diskParts(n) {
    const cn = n.cn;
    return {
      os: cn.osGB, aux: cn.auxGB,
      imgs: cn.images.reduce((s, i) => s + i.gb, 0),
      logs: Object.values(cn.logs).reduce((s, l) => s + l.gb, 0),
      pg: cn.vol ? cn.vol.gb : 0,
    };
  }
  const diskUsed = n => { const p = diskParts(n); return p.os + p.aux + p.imgs + p.logs + p.pg; };
  const diskPct = n => Math.min(100, diskUsed(n) / n.disk.size * 100);
  function duEntries(n) {
    const cn = n.cn, p = diskParts(n), out = [];
    const OS = { '/usr': 0.44, '/snap': 0.17, '/var/cache': 0.07, '/var/log': 0.05, '/var/lib/apt': 0.03, '/var/lib/snapd': 0.12, '/opt/splice-node': 0.01, '/opt/canton-collector': 0.001, '/boot': 0.02, '/home': 0.01, '/root': 0.001, '/etc': 0.006 };
    const tot = Object.values(OS).reduce((s, x) => s + x, 0);
    Object.entries(OS).forEach(([k, v]) => out.push({ p: k, gb: cn.osGB * v / tot }));
    out.push({ p: '/var/lib/docker/overlay2', gb: p.imgs });
    out.push({ p: '/var/lib/docker/image', gb: 0.02 });
    out.push({ p: '/var/lib/docker/volumes/ledger-indexer_data/_data', gb: cn.auxGB });
    if (cn.vol && cn.vol.gb > 0) {
      out.push({ p: VOLP + '/_data/base', gb: Math.max(0.01, cn.vol.gb - 1.1) });
      out.push({ p: VOLP + '/_data/pg_wal', gb: Math.min(1, cn.vol.gb * 0.4) });
      out.push({ p: VOLP + '/_data/global', gb: 0.0006 });
    }
    Object.entries(cn.logs).forEach(([id, l]) => { if (!l.unlinked && !l.gone) out.push({ p: `/var/lib/docker/containers/${id}`, gb: l.gb + 0.00003 }); });
    return out;
  }
  function sizeAt(n, p) {
    const es = duEntries(n);
    const inside = es.filter(e => p === '/' || e.p === p || e.p.startsWith(p + '/'));
    if (inside.length) return inside.reduce((s, e) => s + e.gb, 0);
    const parent = es.find(e => p.startsWith(e.p + '/'));
    return parent ? parent.gb : 0;
  }
  const fmtGB = gb => gb >= 10 ? `${Math.round(gb)}G` : gb >= 1 ? `${gb.toFixed(1)}G` : gb * 1024 >= 1 ? `${Math.round(gb * 1024)}M` : `${Math.max(4, Math.round(gb * 1048576))}K`;
  const fmtDockerSize = gb => gb >= 1 ? `${gb.toFixed(2).replace(/\.?0+$/, '')}GB` : `${Math.round(gb * 1000)}MB`;

  /* ---------- logging ---------- */
  const LOGGER = {
    boot: 'c.d.c.p.ParticipantNodeBootstrap:participant=participant',
    db: 'c.d.c.r.DbStorageSingle:participant=participant',
    seq: `c.d.c.s.c.SequencerClientImplPekko:participant=participant/psid=${DOMAIN.slice(0, 26)}…`,
    sync: 'c.d.c.p.s.CantonSyncService:participant=participant',
    app: 'o.l.s.v.ValidatorApp',
    topup: 'o.l.s.v.a.TopupMemberTrafficTrigger',
    coupon: 'o.l.s.v.a.ReceiveFaucetCouponTrigger',
    pkg: 'o.l.s.v.a.AmuletRulesPackageCheck',
    onboard: 'o.l.s.v.ValidatorOnboarding',
  };
  const THREAD = { participant: 'canton-env-ec-41', validator: 'splice-env-ec-17' };
  function clog(w, n, rec, level, logger, msg) {
    if (!rec) return;
    const ts = new Date(w.base + w.t * 1000).toISOString();
    let line;
    if (rec.svc === 'postgres-splice') line = `${ts.replace('T', ' ').replace('Z', ' UTC')} [${rec.pgPid || 68}] ${logger}:  ${msg}`;
    else if (rec.svc === 'nginx' || /web-ui$/.test(rec.svc)) line = msg;
    else if (rec.project !== PROJECT) line = `${ts} ${level} ${msg}`;
    else line = `${ts} [${THREAD[rec.svc] || 'main'}] ${level.padEnd(5)} ${logger} - ${msg}`;
    S.log(w, n, 'ctr:' + rec.id, level, line);
  }
  const plog = (w, n, level, logger, msg) => clog(w, n, bySvc(n, 'participant'), level, logger, msg);
  const vlog = (w, n, level, logger, msg) => clog(w, n, bySvc(n, 'validator'), level, logger, msg);
  const pglog = (w, n, level, label, msg) => clog(w, n, bySvc(n, 'postgres-splice'), level, label, msg);
  function jsonLog(w, h, rec) {
    return (h.journal['ctr:' + rec.id] || []).slice(-200).map(e => JSON.stringify({ log: S.stripAnsi(e.msg) + '\n', stream: e.level === 'ERROR' || e.level === 'WARN' || e.level === 'FATAL' ? 'stderr' : 'stdout', time: iso(w, e.t) })).join('\n') + '\n';
  }

  /* ---------- container lifecycle ---------- */
  let idSeq = 0;
  function logOptsFor(w, n) {
    const d = n.cn.daemon || {}, o = d['log-opts'] || {};
    if (o['max-size']) return { 'max-size': o['max-size'], 'max-file': o['max-file'] || '1' };
    const m = /max-size:\s*"?([\w.]+)"?/.exec(S.fsRead(w, n, COMPOSEP) || '');
    return m ? { 'max-size': m[1], 'max-file': '3' } : {};
  }
  function createCtr(w, n, spec, image, env, opt = {}) {
    const id = hex(Math.floor(w.rand() * 1e9) + (++idSeq) * 7919, 64);
    const name = spec.name || `${PROJECT}-${spec.svc}-1`;
    const rec = { id, name, svc: spec.svc, project: spec.name ? spec.svc : PROJECT, spec, image, env: Object.assign({}, env || {}), state: 'created', health: null, created: opt.created ?? w.t, started: null, finished: null, exitCode: 0, restarts: 0, okSince: null, badSince: null, logOpts: logOptsFor(w, n), pgPid: 60 + Math.floor(w.rand() * 40) };
    n.cn.ctrs[name] = rec;
    n.cn.logs[id] = { gb: opt.logGB || 0, unlinked: false, gone: false };
    S.fsWrite(n, logPath(id), (w2, h) => jsonLog(w2, h, rec), { mode: '640', owner: 'root' });
    return rec;
  }
  function startCtr(w, n, rec) {
    const cn = n.cn;
    rec.state = 'running'; rec.started = w.t; rec.finished = null; rec.okSince = null; rec.badSince = null; rec.health = 'starting'; rec.migrating = false;
    const L = cn.logs[rec.id];
    if (!S.fsGet(n, logPath(rec.id))) { S.fsWrite(n, logPath(rec.id), (w2, h) => jsonLog(w2, h, rec), { mode: '640', owner: 'root' }); L.gb = 0; L.gone = false; L.unlinked = false; }
    const tag = tagOf(rec.image);
    if (rec.svc === 'postgres-splice') {
      if (cn.vol && cn.vol.fresh) { pglog(w, n, 'INFO', 'LOG', 'database system was shut down at (never); initializing new cluster'); }
      pglog(w, n, 'INFO', 'LOG', 'starting PostgreSQL 14.17 (Debian 14.17-1.pgdg120+1) on x86_64-pc-linux-gnu');
      pglog(w, n, 'INFO', 'LOG', 'listening on IPv4 address "0.0.0.0", port 5432');
    } else if (rec.svc === 'participant') {
      clog(w, n, rec, 'INFO', 'c.d.c.CantonAppDriver$', `Starting Canton version 3.4.12 (Splice ${tag})`);
      if (S.semverCmp(tag, cn.dbVersion) > 0 && !(cn.vol && cn.vol.fresh)) { rec.migrating = true; clog(w, n, rec, 'INFO', LOGGER.db, `Database schema was written by Splice ${cn.dbVersion}; applying migrations for ${tag}`); }
      if (S.semverCmp(tag, cn.dbVersion) < 0) clog(w, n, rec, 'ERROR', LOGGER.db, `Database schema was written by Splice ${cn.dbVersion}, which is newer than this release (${tag}). Refusing to start.`);
    } else if (rec.svc === 'validator') {
      const t = topupTarget(rec);
      clog(w, n, rec, 'INFO', LOGGER.app, `Starting validator app, Splice version ${tag}, migration id ${rec.env.MIGRATION_ID}`);
      clog(w, n, rec, 'INFO', LOGGER.app, `buy-extra-traffic: target-throughput = ${t} B/s, min-topup-interval = ${rec.env.MIN_TOPUP_INTERVAL || '1m'}${t ? '' : ' (automated top-ups disabled)'}`);
      if (cn.quorumAtStart !== undefined && S.semverCmp(tag, quorum(w)) > 0) {
        S.flag(w, 'ahead_of_quorum');
        S.lesson(w, 'ahead', LL('最新发布不等于可以上主网', 'The latest release is not the MainNet release'), LL(`${tag} 已经发布，但只有 ${atLeast(w, tag)}/${w.chain.svs.length} 个 SV 在运行它。可以上主网的版本，是至少 2/3 的 SV scan 报告的版本。比 SV 法定多数更新的版本，可能依赖网络还没有采纳的改动。`, `${tag} is published, but only ${atLeast(w, tag)} of ${w.chain.svs.length} SVs run it. The MainNet-ready release is the one at least 2/3 of SV scans report. A release ahead of the SV quorum can depend on changes the network has not adopted yet.`));
      }
    } else if (rec.svc === 'nginx') {
      clog(w, n, rec, 'INFO', '', '/docker-entrypoint.sh: Configuration complete; ready for start up');
    }
  }
  function stopCtr(w, n, rec, code = 0) {
    const cn = n.cn;
    if (rec.state === 'running') {
      if (rec.svc === 'postgres-splice') pglog(w, n, 'INFO', 'LOG', 'received fast shutdown request');
      else if (rec.project === PROJECT && rec.spec.splice) clog(w, n, rec, 'INFO', rec.svc === 'participant' ? LOGGER.boot : LOGGER.app, 'Received SIGTERM, shutting down');
    }
    const wasRunning = rec.state === 'running';
    rec.state = 'exited'; rec.health = null; rec.finished = w.t; rec.exitCode = wasRunning ? (rec.spec.splice ? 143 : 0) : rec.exitCode;
    const L = cn.logs[rec.id];
    if (L && L.unlinked) { L.gb = 0; L.unlinked = false; L.gone = true; }
  }
  function removeCtr(w, n, rec) {
    if (rec.state === 'running') stopCtr(w, n, rec);
    delete n.cn.ctrs[rec.name];
    delete n.cn.logs[rec.id];
    S.fsRemove(n, '/var/lib/docker/containers/' + rec.id, true);
  }
  function becameHealthy(w, n, rec) {
    const cn = n.cn;
    rec.health = 'healthy';
    const tag = tagOf(rec.image);
    if (rec.svc === 'postgres-splice') pglog(w, n, 'INFO', 'LOG', 'database system is ready to accept connections');
    if (rec.svc === 'participant') {
      if (cn.vol && cn.vol.fresh) {
        cn.vol.fresh = false; cn.identityLost = true;
        cn.party = `validator-01::1220${hex(Math.floor(w.t) + 77, 64)}`;
        clog(w, n, rec, 'WARN', LOGGER.boot, `No node identity found in the database; generating a new namespace key. New participant id PAR::${cn.party}`);
        S.lesson(w, 'identity', LL('数据库里保存着节点身份', 'The database holds the node identity'), LL('participant 的命名空间密钥、party 与交易历史都在 postgres 卷里。删掉这个卷，节点启动时会生成一个全新的身份。原来的 validator party、它持有的 CC 和累计的奖励都无法再由这台节点控制，只能从身份备份恢复，或者重新申请上线。', 'The participant\'s namespace key, its parties and the transaction history live in the postgres volume. Delete that volume and the node starts with a brand-new identity. The old validator party, the CC it holds and its accrued rewards are no longer controlled by this node; only an identity backup or a new onboarding gets the operator back.'));
      }
      if (S.semverCmp(tag, cn.dbVersion) > 0) { cn.dbVersion = tag; clog(w, n, rec, 'INFO', LOGGER.db, `Database migrations for Splice ${tag} applied`); }
      clog(w, n, rec, 'INFO', LOGGER.boot, `Participant ${PARTICIPANT.slice(0, 32)}… initialised`);
      clog(w, n, rec, 'INFO', LOGGER.sync, `Connected to synchronizer ${DOMAIN} through 13 SV sequencers (read threshold 5)`);
    }
    if (rec.svc === 'validator') {
      clog(w, n, rec, 'INFO', LOGGER.app, `Validator app is ready; validator party ${cn.party}`);
      cn.nextTopup = w.t; cn.nextTopupNote = w.t;
    }
  }
  function healthStep(w, n, rec) {
    if (rec.state !== 'running') return;
    const cn = n.cn;
    let ok = true;
    if (rec.svc === 'postgres-splice') ok = !cn.pgCorrupt;
    else if (rec.svc === 'participant') ok = healthy(bySvc(n, 'postgres-splice')) && S.semverCmp(tagOf(rec.image), cn.dbVersion) >= 0;
    else if (rec.svc === 'validator') { const p = bySvc(n, 'participant'); ok = healthy(p) && !cn.identityLost && String(rec.env.MIGRATION_ID) === String(w.chain.migrationId) && tagOf(p.image) === tagOf(rec.image); }
    const boot = rec.spec.boot + (rec.migrating ? 45 : 0);
    if (ok) {
      rec.badSince = null;
      if (rec.okSince == null) rec.okSince = w.t;
      if (rec.health !== 'healthy' && w.t - Math.max(rec.started, rec.okSince) >= boot) becameHealthy(w, n, rec);
    } else {
      rec.okSince = null;
      if (rec.badSince == null) rec.badSince = w.t;
      if (rec.health !== 'unhealthy' && w.t - rec.badSince >= 60 && (rec.health === 'healthy' || w.t - rec.started >= 150)) {
        rec.health = 'unhealthy';
        if (rec.svc === 'participant') clog(w, n, rec, 'ERROR', LOGGER.db, healthy(bySvc(n, 'postgres-splice')) ? 'Participant cannot start: database schema is from a newer release' : 'Failed to connect to postgres-splice:5432: Connection refused. Retrying.');
        if (rec.svc === 'validator') {
          if (cn.identityLost) clog(w, n, rec, 'ERROR', LOGGER.onboard, `Onboarding of ${cn.party} failed: the onboarding secret has already been used by ${PARTY}`);
          else if (String(rec.env.MIGRATION_ID) !== String(w.chain.migrationId)) clog(w, n, rec, 'ERROR', LOGGER.app, `Configured MIGRATION_ID ${rec.env.MIGRATION_ID} does not match the synchronizer's current migration id ${w.chain.migrationId}`);
          else clog(w, n, rec, 'ERROR', LOGGER.app, 'Ledger API of the participant is unavailable; readiness check failing');
        }
      }
    }
  }

  /* ---------- version watcher ---------- */
  function runWatcher(w, n) {
    const cn = n.cn, q = quorum(w), loc = localTag(n);
    const v = bySvc(n, 'validator');
    const health = running(v) ? 1 : 0;
    cn.watch = Object.assign(cn.watch || {}, { last: w.t, quorum: q, local: loc, health, needed: health && loc && S.semverCmp(q, loc) > 0 ? 1 : 0, at: atLeast(w, q), total: w.chain.svs.length });
    const line = `${iso(w, w.t).replace(/\.\d+Z$/, 'Z')} scans=${w.chain.svs.length} reachable=${w.chain.svs.length} quorum=${q} (${atLeast(w, q)}/${w.chain.svs.length} report >= ${q}, need ${Math.ceil(w.chain.svs.length * 2 / 3)}) local=${health ? loc : 'unreadable'} upgrade_needed=${cn.watch.needed}`;
    cn.watchLog.push(line); if (cn.watchLog.length > 200) cn.watchLog.shift();
    S.log(w, n, 'splice-version-watcher', 'INFO', line);
  }

  /* ---------- tick ---------- */
  function tick(w, dt) {
    const ch = w.chain;
    (ch.svPlan || []).forEach(p => { if (!p.done && w.t >= p.at) { p.done = true; ch.svs[p.i].v = p.v; } });
    if (ch.switchAt != null && w.t - dt < ch.switchAt && w.t >= ch.switchAt) {
      S.event(w, 'sys', LL(`SV 投票生效：Amulet 规则切换到 Splice ${ch.required} 的 Daml 包。低于 ${ch.required} 的验证者无法再处理新的规则合约。`, `The SV vote takes effect: AmuletRules switch to the Daml packages of Splice ${ch.required}. Validators below ${ch.required} can no longer process the new rules contracts.`));
      if (Object.values(w.nodes).some(n => !versionOk(w, n))) S.lesson(w, 'switch', LL('法定多数之后还有一个生效时间', 'After the quorum comes an effective date'), LL('2/3 的 SV 升级之后，SV 会投票决定新 Daml 包的生效时间。到点之前，旧版本的验证者还能工作；到点之后，它读不懂新的规则合约，每一轮都记录不了活动，奖励就此损失。容器依然显示 healthy。', 'Once 2/3 of the SVs have upgraded, they vote on when the new Daml packages take effect. Until then an old validator keeps working. After that it cannot read the new rules contracts, records no activity in any round, and loses the rewards. Its containers still report healthy.'));
    }
    Object.values(w.nodes).forEach(n => nodeTick(w, n, dt));
  }
  function nodeTick(w, n, dt) {
    const cn = n.cn;
    // a container log emptied with a shell redirect (": > file") instead of truncate
    Object.values(cn.ctrs).forEach(rec => {
      const f = S.fsGet(n, logPath(rec.id)); const L = cn.logs[rec.id];
      if (f && typeof f.c !== 'function') { L.gb = 0; f.c = (w2, h) => jsonLog(w2, h, rec); }
      if (f) f.size = Math.round(L.gb * GB);
    });
    cn.full = diskUsed(n) >= n.disk.size - 0.01;
    if (dockerUp(n)) Object.values(cn.ctrs).forEach(rec => healthStep(w, n, rec));
    const p = bySvc(n, 'participant'), v = bySvc(n, 'validator');
    const proc = processing(n);
    if (proc) {
      if (cn.lag > LAG_OK && w.t >= cn.nextCatchLog) { cn.nextCatchLog = w.t + 30; plog(w, n, 'INFO', LOGGER.seq, `Catching up: processed sequenced events up to ${iso(w, w.t - cn.lag).replace(/\.\d+Z$/, 'Z')}, ${S.fmtDur(cn.lag)} behind`); }
      const was = cn.lag;
      cn.lag = Math.max(1.2 + w.rand() * 0.6, cn.lag - CATCHUP * dt);
      if (was > LAG_OK && cn.lag <= LAG_OK) { plog(w, n, 'INFO', LOGGER.seq, 'Caught up with the sequencers; processing live events'); S.event(w, 'ok', LL('participant 已追上 sequencer。', 'The participant has caught up with the sequencers.')); }
    } else cn.lag += dt;
    // disk full: postgres cannot extend its files; the participant stops persisting events
    if (cn.full && dockerUp(n) && w.t >= cn.nextFullLog) {
      cn.nextFullLog = w.t + 60;
      pglog(w, n, 'ERROR', 'ERROR', `could not extend file "base/16384/41877.${12 + Math.floor(w.rand() * 3)}": No space left on device`);
      pglog(w, n, 'INFO', 'HINT', 'Check free disk space.');
      if (running(p)) plog(w, n, 'WARN', LOGGER.db, 'DB operation insertSequencedEvents failed, retrying in 10s: org.postgresql.util.PSQLException: ERROR: could not extend file "base/16384/41877.12": No space left on device');
      if (running(p)) plog(w, n, 'WARN', LOGGER.seq, 'Event processing is blocked: storing sequenced events failed; the subscription is paused');
      S.log(w, n, 'docker', 'ERROR', 'level=error msg="Error writing log message" container=' + (p ? p.id.slice(0, 12) : '?') + ' error="write /var/lib/docker/containers/…-json.log: no space left on device"');
    }
    if (cn.pgCorrupt && dockerUp(n) && w.t >= cn.nextPanic) { cn.nextPanic = w.t + 30; pglog(w, n, 'FATAL', 'PANIC', 'could not locate a valid checkpoint record'); }
    // traffic: every submission consumes purchased extra traffic
    const vOk = healthy(v);
    if (proc && cn.lag < LAG_OK && running(v)) cn.remainder = Math.max(0, cn.remainder - cn.consume * dt);
    // rounds and liveness activity
    const r = netRound(w);
    if (r > cn.lastRound) {
      for (let k = cn.lastRound; k < r; k++) if (cn.ourRound < k) { cn.missed++; if (running(v)) vlog(w, n, 'WARN', LOGGER.coupon, `Round ${k} closed without a liveness activity record for ${cn.party.slice(0, 26)}…`); }
      cn.lastRound = r;
    }
    const canRec = vOk && proc && cn.lag < LAG_OK && !cn.identityLost;
    if (canRec && cn.ourRound < r) {
      if (!versionOk(w, n)) {
        if (w.t >= cn.nextPkgErr) { cn.nextPkgErr = w.t + 120; vlog(w, n, 'ERROR', LOGGER.pkg, `AmuletRules now require splice-amulet from Splice ${w.chain.required}; this node runs ${localTag(n)}. Cannot record activity for round ${r}. Upgrade the validator.`); }
      } else if (cn.remainder > 0) {
        cn.ourRound = r; cn.remainder = Math.max(0, cn.remainder - RECORD_BYTES); cn.wallet += REWARD; cn.recorded++;
        vlog(w, n, 'INFO', LOGGER.coupon, `Recorded validator liveness activity for round ${r}`);
      } else if (w.t >= cn.nextTrafficErr) {
        cn.nextTrafficErr = w.t + 60;
        plog(w, n, 'WARN', LOGGER.seq, `Send request rejected by the sequencer: SEQUENCER_NOT_ENOUGH_TRAFFIC_CREDIT(9,0): member ${PARTICIPANT.slice(0, 32)}… has 0 bytes of extra traffic left and its base rate is used up`);
        vlog(w, n, 'ERROR', LOGGER.coupon, `Failed to record liveness activity for round ${r}: ABORTED: SEQUENCER_NOT_ENOUGH_TRAFFIC_CREDIT. Will retry.`);
      }
    }
    if (cn.remainder <= 0 && !cn.saidEmpty && proc) {
      cn.saidEmpty = true;
      S.event(w, 'bad', LL('extra traffic 已用完。participant 提交的交易开始被 sequencer 拒绝。', 'Extra traffic is used up. The sequencers start rejecting the participant\'s submissions.'));
      S.lesson(w, 'traffic', LL('每一笔提交都要消耗 traffic', 'Every submission consumes traffic'), LL('向 Global Synchronizer 提交交易，按字节消耗 traffic。traffic 用 CC 购买，验证者应用可以按 target-throughput 自动补充。买来的 traffic 用完后，只剩一点免费的基础额度，不够日常运行：读取照常，提交失败，每一轮的活动记录都写不进去。', 'Submitting to the Global Synchronizer consumes traffic, counted in bytes. Traffic is bought with CC, and the validator app can top it up automatically at a target throughput. Once the purchased traffic is gone only a small free base rate remains, which is not enough for normal operation: reads still work, submissions fail, and no round gets its activity record.'));
    }
    if (cn.remainder > 0) cn.saidEmpty = false;
    cn.minRem = Math.min(cn.minRem, cn.remainder);
    // automated top-ups
    if (vOk && w.t >= cn.nextTopup) {
      const tgt = topupTarget(v), iv = parseDur(v.env.MIN_TOPUP_INTERVAL);
      cn.nextTopup = w.t + iv;
      if (tgt > 0) {
        const amt = Math.max(MIN_TOPUP, tgt * iv);
        const pend = cn.pending.filter(x => x.party === cn.party).reduce((s, x) => s + x.bytes, 0);
        if (cn.remainder + pend < amt) {
          const cost = ccFor(amt);
          if (cn.wallet >= cost) {
            cn.wallet -= cost; cn.spent += cost;
            cn.pending.push({ at: w.t + 30, bytes: amt, party: cn.party, auto: true });
            vlog(w, n, 'INFO', LOGGER.topup, `Buying ${fmtB(amt)} bytes of extra traffic for ${cost.toFixed(4)} CC (target-throughput ${tgt} B/s, min-topup-interval ${iv}s)`);
          } else vlog(w, n, 'WARN', LOGGER.topup, `Insufficient funds for a traffic top-up: need ${cost.toFixed(4)} CC, the wallet holds ${cn.wallet.toFixed(4)} CC`);
        }
      } else if (w.t >= cn.nextTopupNote) {
        cn.nextTopupNote = w.t + 300;
        vlog(w, n, 'INFO', LOGGER.topup, `Skipping top-up: target-throughput is 0 (automated top-ups disabled). Extra traffic remaining: ${fmtB(cn.remainder)} bytes`);
      }
    }
    cn.pending = cn.pending.filter(x => {
      if (w.t < x.at) return true;
      if (x.req) x.req.status = x.fail ? 'failed' : 'completed';
      if (x.fail) return false;
      if (x.party === cn.party) {
        cn.remainder += x.bytes; cn.purchased += x.bytes;
        vlog(w, n, 'INFO', LOGGER.topup, `Extra traffic limit for ${PARTICIPANT.slice(0, 32)}… raised by ${fmtB(x.bytes)} bytes`);
        S.event(w, 'ok', x.auto ? LL(`自动充值完成：${fmtB(x.bytes)} bytes。`, `Automated top-up completed: ${fmtB(x.bytes)} bytes.`) : LL(`购买的 traffic 已到账：${fmtB(x.bytes)} bytes。`, `Purchased traffic arrived: ${fmtB(x.bytes)} bytes.`));
        if (x.auto) S.lesson(w, 'topup', LL('自动充值', 'Automated top-ups'), LL('验证者应用每隔 min-topup-interval 检查一次 traffic 余额，低于一次充值量时用钱包里的 CC 再买一批。target-throughput 设为 0 等于关闭这个功能。改 .env 之后要让容器按新配置重建（docker compose up -d），restart 不会重新读取 .env。', 'Every min-topup-interval the validator app checks its traffic and, when less than one top-up remains, buys another batch with CC from its wallet. Setting target-throughput to 0 turns this off. After editing .env the container has to be recreated with the new settings (docker compose up -d); a restart does not read .env again.'));
      }
      return false;
    });
    // logs grow; a full disk stops them
    if (!cn.full && dockerUp(n)) Object.values(cn.ctrs).forEach(rec => {
      if (rec.state !== 'running') return;
      const L = cn.logs[rec.id];
      const perDay = rec.svc === 'participant' ? (cn.lag > LAG_OK ? 6 : 1) : rec.svc === 'validator' ? 0.3 : 0.01;
      L.gb += perDay * dt / 86400;
      const cap = logCap(rec.logOpts); if (cap) L.gb = Math.min(L.gb, cap);
    });
    // version watcher (systemd timer, every 15 min)
    if (w.t >= cn.watch.next) { cn.watch.next = w.t + 900; if (n.services['splice-version-watcher'].enabled !== false) runWatcher(w, n); }
    // bookkeeping
    if (!vOk) cn.vDown += dt;
    ['grafana-agent', 'node_exporter'].forEach(k => { const s = n.services[k]; if (s.state !== 'active') s.downFor = (s.downFor || 0) + dt; else s.downFor = 0; });
    cn.peakPct = Math.max(cn.peakPct || 0, diskPct(n));
  }

  /* ---------- docker daemon ---------- */
  function dockerStop(w, n) {
    if (!dockerUp(n)) return;
    ctrList(n).forEach(rec => { rec.wasRunning = rec.state === 'running'; if (rec.wasRunning) stopCtr(w, n, rec); });
    const s = n.services.docker; s.state = 'inactive'; s.since = w.t;
    S.log(w, n, 'docker', 'INFO', 'level=info msg="Processing signal \'terminated\'"');
    S.log(w, n, 'docker', 'INFO', 'level=info msg="Daemon shutdown complete"');
  }
  function dockerStart(w, n) {
    const s = n.services.docker;
    const raw = S.fsRead(w, n, DAEMON);
    let cfg = {};
    if (raw !== null && raw.trim()) {
      try { cfg = JSON.parse(raw); }
      catch (e) {
        s.state = 'failed'; s.since = w.t; s.exitStatus = 1;
        S.log(w, n, 'docker', 'ERROR', `unable to configure the Docker daemon with file ${DAEMON}: invalid character in JSON (${e.message})`);
        S.log(w, n, 'docker', 'SYS', 'docker.service: Main process exited, code=exited, status=1/FAILURE');
        return;
      }
    }
    const before = JSON.stringify((n.cn.daemon || {})['log-opts'] || {});
    n.cn.daemon = cfg;
    s.state = 'active'; s.since = w.t; s.pid = 900 + Math.floor(w.rand() * 300);
    S.log(w, n, 'docker', 'INFO', 'level=info msg="Starting up"');
    S.log(w, n, 'docker', 'INFO', 'level=info msg="Docker daemon" commit=41ca978 containerd-snapshotter=false storage-driver=overlay2 version=27.3.1');
    ctrList(n).forEach(rec => { if (rec.wasRunning) { rec.restarts++; startCtr(w, n, rec); } rec.wasRunning = false; });
    S.log(w, n, 'docker', 'INFO', 'level=info msg="API listen on /run/docker.sock"');
    if (JSON.stringify(cfg['log-opts'] || {}) !== before && cfg['log-opts'] && cfg['log-opts']['max-size']) {
      S.lesson(w, 'logopts', LL('日志设置只对新建的容器生效', 'Log settings apply to new containers only'), LL('daemon.json 里的 log-opts 是新容器的默认值。已经存在的容器保留创建时的设置，重启 docker 也不会改变。要让现有容器用上新的上限，需要重建它们，例如 docker compose up -d --force-recreate。可以用 docker inspect 查看 HostConfig.LogConfig 确认。', 'log-opts in daemon.json are the defaults for new containers. Existing containers keep the settings they were created with, even across a docker restart. To give them the new limit, recreate them, for example with docker compose up -d --force-recreate. Check HostConfig.LogConfig with docker inspect.'));
    }
  }

  /* ---------- HTTP ---------- */
  const J = (status, obj) => ({ status, body: JSON.stringify(obj) });
  const authed = ctx => !!ctx && (ctx.args || []).some(a => /^Authorization:\s*Bearer\s+/i.test(a) && a.replace(/^Authorization:\s*Bearer\s+/i, '').trim() === TOKEN);
  const refused = (host, port) => ({ error: 7, msg: `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server` });
  const knownParty = (w, n, p) => p === n.cn.party || p === PARTY || p === SPONSOR || p === PARTNER;
  function validatorApi(w, n, req, ctx, sub) {
    const cn = n.cn, v = bySvc(n, 'validator');
    if (!running(v)) return { status: 502, body: '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx/1.27.3</center>\r\n</body>\r\n</html>\n' };
    if (sub === '/livez') return { status: 200, body: '' };
    if (sub === '/readyz') return v.health === 'healthy' ? { status: 200, body: '' } : { status: 503, body: 'The server is currently unable to handle the request' };
    if (sub === '/version') return J(200, { version: tagOf(v.image), commit_ts: '2026-09-30T11:04:52Z' });
    if (v.health !== 'healthy') return { status: 503, body: 'The server is currently unable to handle the request' };
    if (!authed(ctx)) return J(401, { error: 'The supplied authentication is invalid' });
    if (sub === '/v0/validator-user') return J(200, { party_id: cn.party, user_name: 'administrator', featured: false });
    if (sub === '/v0/wallet/balance') return J(200, { round: cn.ourRound, effective_unlocked_qty: cn.wallet.toFixed(10), effective_locked_qty: '0.0000000000', total_holding_fees: '0.4211000000' });
    let m = /^\/v0\/scan-proxy\/domains\/([^/]+)\/members\/([^/]+)\/traffic-status$/.exec(sub);
    if (m) {
      if (decodeURIComponent(m[1]) !== DOMAIN) return J(404, { error: `Synchronizer ${decodeURIComponent(m[1])} not found` });
      if (decodeURIComponent(m[2]) !== PARTICIPANT) return J(404, { error: `No traffic state for member ${decodeURIComponent(m[2])}` });
      const limit = cn.purchased + 0;
      return J(200, { traffic_status: { actual: { total_consumed: limit - Math.round(cn.remainder), total_limit: limit }, target: { total_purchased: cn.purchased + cn.pending.filter(x => x.party === cn.party).reduce((s, x) => s + x.bytes, 0) } } });
    }
    if (sub === '/v0/scan-proxy/dso-sequencers') return J(200, { domainSequencers: [{ domainId: DOMAIN, sequencers: w.chain.svs.map((s, i) => ({ migrationId: w.chain.migrationId, id: `SEQ::${s.name}::1220${hex(500 + i, 8)}…`, url: `https://sequencer-${w.chain.migrationId}.${s.name}.example`, svName: s.name })) }] });
    m = /^\/v0\/wallet\/buy-traffic-requests\/([^/]+)\/status$/.exec(sub);
    if (m) {
      const r = cn.requests[decodeURIComponent(m[1])];
      if (!r) return J(404, { error: `No buy traffic request with tracking id ${decodeURIComponent(m[1])}` });
      return J(200, r.status === 'completed' ? { status: 'completed', transaction_id: r.tx } : r.status === 'failed' ? { status: 'failed', failure_reason: 'rejected' } : { status: 'created' });
    }
    if (sub === '/v0/wallet/buy-traffic-requests') {
      if (req.method !== 'POST') return J(405, { error: 'HTTP method not allowed, supported methods: POST' });
      const j = req.json;
      if (!j || typeof j !== 'object') return J(400, { error: 'The request content was malformed: expected a JSON object' });
      for (const k of ['receiving_validator_party_id', 'domain_id', 'traffic_amount', 'tracking_id']) if (j[k] === undefined || j[k] === '') return J(400, { error: `The request content was malformed: Object is missing required member '${k}'` });
      const party = String(j.receiving_validator_party_id), amt = Number(j.traffic_amount);
      if (!/^[A-Za-z0-9_.-]+::1220[0-9a-f]{64}$/.test(party)) return J(400, { error: `Invalid party id: ${party}` });
      if (j.domain_id !== DOMAIN) return J(400, { error: `Unknown synchronizer id: ${j.domain_id}` });
      if (!Number.isInteger(amt) || amt <= 0) return J(400, { error: 'traffic_amount must be a positive integer number of bytes' });
      if (amt < MIN_TOPUP) return J(400, { error: `Traffic amount ${amt} is below the minimum top-up amount of ${MIN_TOPUP} bytes` });
      if (cn.requests[j.tracking_id]) return J(409, { error: `A buy traffic request with tracking id ${j.tracking_id} already exists` });
      const cost = ccFor(amt);
      if (cost > cn.wallet) return J(400, { error: `Insufficient funds: the purchase costs ${cost.toFixed(4)} CC and the wallet holds ${cn.wallet.toFixed(4)} CC` });
      const known = knownParty(w, n, party);
      const reqRec = { status: 'created', tx: '1220' + hex(Math.floor(w.t) + amt, 60) };
      cn.requests[j.tracking_id] = reqRec;
      if (known) { cn.wallet -= cost; cn.spent += cost; }
      cn.pending.push({ at: w.t + 45, bytes: amt, party, req: reqRec, fail: !known });
      vlog(w, n, 'INFO', 'o.l.s.w.a.BuyTrafficRequestTrigger', `Created buy traffic request ${j.tracking_id}: ${fmtB(amt)} bytes for ${party.slice(0, 30)}…, ${cost.toFixed(4)} CC`);
      if (party !== cn.party && known) {
        S.flag(w, 'wrong_party');
        S.event(w, 'bad', LL(`这笔 traffic 买给了 <code>${S.esc(party.slice(0, 18))}…</code>，不是本验证者。CC 已经花掉，无法撤回。`, `This traffic was bought for <code>${S.esc(party.slice(0, 18))}…</code>, not for this validator. The CC is spent and cannot be recovered.`));
        S.lesson(w, 'wrongparty', LL('traffic 记在接收方名下', 'Traffic is credited to the receiving party'), LL('任何人都可以替任何验证者购买 traffic，CC 一经支付就被销毁。receiving_validator_party_id 填错，traffic 就记到了别人的节点上。本验证者的 party 用 <code>/v0/validator-user</code> 查询，不要从笔记或聊天里复制。', 'Anyone can buy traffic for any validator, and the CC paid is burned. With the wrong receiving_validator_party_id the traffic lands on someone else\'s node. Look up your own party with <code>/v0/validator-user</code> rather than copying one from notes or chat.'));
      }
      return J(200, { request_contract_id: '00' + hex(Math.floor(w.t) + 3, 66) });
    }
    return J(404, { error: 'The requested resource could not be found.' });
  }
  function collectorMetrics(w, n) {
    const cn = n.cn, src = upMetric(n, 'scan-proxy'), idx = upMetric(n, 'ledger-indexer');
    const lines = [
      ['canton_collector_scrape_timestamp_seconds', Math.floor((w.base / 1000) + w.t)],
      ['canton_containers_total', dockerUp(n) ? ctrList(n).filter(running).length : 0],
      ['canton_containers_healthy', dockerUp(n) ? ctrList(n).filter(r => running(r) && r.health === 'healthy').length : 0],
      ['canton_containers_unhealthy', unhealthyCount(n)],
      ['canton_participant_up', upMetric(n, 'participant') ? 1 : 0],
      ['canton_validator_up', upMetric(n, 'validator') ? 1 : 0],
      ['canton_domain_time_lag_seconds', idx ? cn.lag.toFixed(1) : -1],
      ['canton_blocks_behind', src ? behind(w, n) : -1],
      ['canton_synced', src && synced(w, n) ? 1 : 0],
      ['canton_head_round', src ? netRound(w) : 0],
      ['canton_chain_data_source_up', src ? 1 : 0],
      ['canton_validator_health', src && synced(w, n) && upMetric(n, 'participant') && upMetric(n, 'validator') ? 1 : 0],
      ['canton_collector_scrape_success', 1],
    ];
    return lines.map(([k, v]) => `# TYPE ${k} gauge\n${k} ${v}`).join('\n') + '\n';
  }
  async function http(w, host, req, ctx) {
    const n = host.cn ? host : null;
    const h = req.host;
    let m = /^scan\.sv-(\d+)\.example$/.exec(h);
    if (m) {
      const sv = w.chain.svs[+m[1] - 1];
      if (!sv) return null;
      if (!n) return { status: 403, body: '<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center><center>Request blocked: source IP is not an allowlisted validator</center></body></html>' };
      if (req.path === '/api/scan/version') return J(200, { version: sv.v, commit_ts: '2026-09-30T11:04:52Z' });
      if (req.path === '/api/scan/v0/scans') return J(200, { scans: [{ domainId: DOMAIN, scans: w.chain.svs.map(s => ({ publicUrl: `https://scan.${s.name}.example`, svName: s.name })) }] });
      if (req.path === '/api/scan/v0/dso-sequencers') return J(200, { domainSequencers: [{ domainId: DOMAIN, sequencers: w.chain.svs.map(s => ({ migrationId: w.chain.migrationId, url: `https://sequencer-${w.chain.migrationId}.${s.name}.example`, svName: s.name })) }] });
      if (req.path === '/api/scan/v0/round-of-latest-data') return J(200, { round: netRound(w), effectiveAt: iso(w, w.t) });
      return J(404, { error: 'The requested resource could not be found.' });
    }
    if (h === 'api.github.com' && /^\/repos\/canton-network\/splice\/releases(\/latest)?$/.test(req.path)) {
      const rel = v => ({ tag_name: v, name: `Splice ${v}`, html_url: `https://github.com/canton-network/splice/releases/tag/${v}`, prerelease: false });
      return req.path.endsWith('/latest') ? J(200, rel(w.chain.latest)) : J(200, [...w.chain.released].reverse().map(rel));
    }
    if (h === 'github.com' && (m = /^\/canton-network\/splice\/releases\/tag\/(.+)$/.exec(req.path))) {
      if (!w.chain.released.includes(m[1])) return { status: 404, body: 'Not Found' };
      return { status: 200, body: `Splice ${m[1]}\n\nRelease notes: minor release. No migration-id change; upgrade the images in place and keep the database.\nDocker images: ${REPO}{canton-participant,validator-app,wallet-web-ui,ans-web-ui}:${m[1]}\n` };
    }
    if (!n) {
      if (h === 'localhost' || h === '127.0.0.1' || /\.localhost$/.test(h)) return refused(h, req.port || 80);
      return null;
    }
    const cn = n.cn;
    if (ctx && ctx.execIn) {
      const rec = ctx.execIn;
      if ((h === 'localhost' || h === '127.0.0.1') && rec.svc === 'validator' && String(req.port) === '5003' && req.path.startsWith('/api/validator')) return validatorApi(w, n, req, ctx, req.path.slice('/api/validator'.length));
      if (h === 'localhost' || h === '127.0.0.1') return refused(h, req.port || 80);
    }
    if (h === 'localhost' || h === '127.0.0.1') {
      const port = String(req.port || '80');
      const auxUp = name => dockerUp(n) && running(cn.ctrs[name]);
      if (port === '8100') {
        if (!auxUp('scan-proxy')) return refused(h, port);
        if (req.path !== '/api/sync') return J(404, { error: 'not found' });
        const b = behind(w, n);
        if (!synced(w, n) && Object.values(cn.ctrs).filter(r => r.project === PROJECT).every(healthy)) S.lesson(w, 'healthybehind', LL('容器健康不等于节点同步', 'Healthy containers are not a synced node'), LL('docker 的健康检查只回答"进程是否在响应"。participant 可能在正常响应的同时停在几天前的位置。判断节点是否跟上，要比较 SV scan 报告的当前轮次和本验证者最后记录活动的轮次（/api/sync），以及 participant 处理事件的时间落后墙上时钟多少（/status 的 cursor_lag_seconds）。', 'A docker health check only answers whether the process responds. A participant can respond normally while sitting days behind. To know whether the node keeps up, compare the round the SV scans report with the round this validator last recorded (/api/sync), and how far the participant\'s processed events trail wall-clock time (cursor_lag_seconds in /status).'));
        return J(200, { network_round: netRound(w), our_round: cn.ourRound, rounds_behind: b, synced: synced(w, n), network_round_source: 'sv scan (round-of-latest-data)', party_id: cn.party });
      }
      if (port === '8090') {
        if (!auxUp('ledger-indexer')) return refused(h, port);
        if (req.path !== '/status') return J(404, { error: 'not found' });
        return J(200, { cursor_lag_seconds: +cn.lag.toFixed(1), max_seq: Math.floor(cn.seq0 + (w.t - cn.lag) * 3.2), latest_record_time: iso(w, w.t - cn.lag), participant: 'participant:5001' });
      }
      if (port === '9101') return n.services['canton-collector'].state === 'active' ? { status: 200, body: collectorMetrics(w, n) } : refused(h, port);
      if (port === '9100') return n.services.node_exporter.state === 'active' ? { status: 200, body: `# HELP node_filesystem_avail_bytes Filesystem space available to non-root users in bytes.\nnode_filesystem_avail_bytes{device="${n.disk.dev}",fstype="ext4",mountpoint="/"} ${Math.max(0, Math.round((n.disk.size - diskUsed(n)) * GB))}\nnode_filesystem_size_bytes{device="${n.disk.dev}",fstype="ext4",mountpoint="/"} ${n.disk.size * GB}\n` } : refused(h, port);
      if (port === '80') return auxUp(`${PROJECT}-nginx-1`) ? { status: 404, body: '<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx/1.27.3</center></body></html>\n' } : refused(h, port);
      return refused(h, port);
    }
    if (h === 'wallet.localhost' || h === 'ans.localhost') {
      const ng = cn.ctrs[`${PROJECT}-nginx-1`];
      if (!dockerUp(n) || !running(ng)) return refused(h, req.port || 80);
      if (!req.path.startsWith('/api/validator')) return { status: 200, body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Splice Wallet</title></head><body><div id="root"></div></body></html>\n' };
      return validatorApi(w, n, req, ctx, req.path.slice('/api/validator'.length));
    }
    return null;
  }

  /* ---------- alert rules (names and thresholds from alerting/chain/canton.yaml) ---------- */
  const nodesOf = w => Object.values(w.nodes);
  const flow = n => n.services['grafana-agent'].state === 'active';
  const coll = n => flow(n) && n.services['canton-collector'].state === 'active';
  const rules = [
    { name: 'CantonContainerUnhealthy', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => coll(n) && unhealthyCount(n) > 0).map(n => ({ instance: n.hostname, summary: `Canton has unhealthy container(s) on ${n.hostname}` })) },
    { name: 'CantonContainersCritical', severity: 'critical', for: 120, check: w => nodesOf(w).filter(n => coll(n) && unhealthyCount(n) >= 3).map(n => ({ instance: n.hostname, summary: `${unhealthyCount(n)} Canton containers unhealthy on ${n.hostname}` })) },
    { name: 'CantonParticipantDown', severity: 'critical', for: 300, check: w => nodesOf(w).filter(n => coll(n) && !upMetric(n, 'participant')).map(n => ({ instance: n.hostname, summary: `Canton participant down on ${n.hostname}` })) },
    { name: 'CantonValidatorDown', severity: 'critical', for: 300, check: w => nodesOf(w).filter(n => coll(n) && !upMetric(n, 'validator')).map(n => ({ instance: n.hostname, summary: `Canton validator app down on ${n.hostname}` })) },
    { name: 'CantonCollectorDown', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => flow(n) && n.services['canton-collector'].state !== 'active').map(n => ({ instance: n.hostname, summary: `Canton metrics collector failing on ${n.hostname}` })) },
    { name: 'CantonAgentHeartbeatMissing', severity: 'critical', for: 0, check: w => nodesOf(w).filter(n => ['grafana-agent', 'node_exporter'].some(k => (n.services[k].downFor || 0) >= 600)).map(n => ({ instance: n.hostname, summary: `Canton monitoring agent lost on ${n.hostname}` })) },
    { name: 'CantonBehindChainTip', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => coll(n) && upMetric(n, 'scan-proxy') && behind(w, n) >= 100).map(n => ({ instance: n.hostname, summary: `Canton validator is ${behind(w, n)} rounds behind chain tip on ${n.hostname}` })) },
    { name: 'CantonSeverelyBehindChainTip', severity: 'critical', for: 120, check: w => nodesOf(w).filter(n => coll(n) && upMetric(n, 'scan-proxy') && behind(w, n) >= 1000).map(n => ({ instance: n.hostname, summary: `Canton validator severely behind chain tip (${behind(w, n)} rounds) on ${n.hostname}` })) },
    { name: 'CantonSyncStalled', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => coll(n) && upMetric(n, 'ledger-indexer') && n.cn.lag > 900).map(n => ({ instance: n.hostname, summary: `Canton chain-tip lag ${Math.round(n.cn.lag)}s on ${n.hostname}` })) },
    { name: 'CantonSpliceVersionDrift', severity: 'warning', for: 0, check: w => nodesOf(w).filter(n => flow(n) && n.cn.watch.needed === 1).map(n => ({ instance: n.hostname, summary: `Canton validator running outdated Splice: ${n.hostname} (${n.cn.watch.local} -> ${n.cn.watch.quorum})` })) },
    { name: 'CantonSpliceVersionWatcherStale', severity: 'warning', for: 300, check: w => nodesOf(w).filter(n => flow(n) && w.t - n.cn.watch.last > 3600).map(n => ({ instance: n.hostname, summary: `Splice version watcher stale on ${n.hostname}` })) },
    { name: 'CantonSpliceVersionWatcherUnhealthy', severity: 'warning', for: 5400, check: w => nodesOf(w).filter(n => flow(n) && n.cn.watch.health === 0).map(n => ({ instance: n.hostname, summary: `Splice version watcher unhealthy on ${n.hostname}` })) },
    { name: 'CantonChainDataSourceDown', severity: 'warning', for: 600, check: w => nodesOf(w).filter(n => coll(n) && !upMetric(n, 'scan-proxy')).map(n => ({ instance: n.hostname, summary: `Canton sync-lag source unavailable on ${n.hostname}` })) },
  ];

  /* ---------- docker CLI ---------- */
  function human(sec) {
    sec = Math.max(0, sec);
    if (sec < 1) return 'Less than a second';
    if (sec < 60) return `${Math.floor(sec)} seconds`;
    if (sec < 120) return 'About a minute';
    if (sec < 3600) return `${Math.floor(sec / 60)} minutes`;
    if (sec < 7200) return 'About an hour';
    if (sec < 172800) return `${Math.floor(sec / 3600)} hours`;
    if (sec < 1209600) return `${Math.floor(sec / 86400)} days`;
    if (sec < 5259600) return `${Math.floor(sec / 604800)} weeks`;
    return `${Math.floor(sec / 2629800)} months`;
  }
  const stateWord = r => r.state === 'running' ? 'running' : r.state === 'created' ? 'created' : 'exited';
  function statusStr(w, r) {
    if (r.state === 'running') return `Up ${human(w.t - r.started)}${r.health ? (r.health === 'starting' ? ' (health: starting)' : ` (${r.health})`) : ''}`;
    if (r.state === 'created') return 'Created';
    return `Exited (${r.exitCode}) ${human(w.t - r.finished)} ago`;
  }
  const HEAD = { Names: 'NAMES', Name: 'NAME', Status: 'STATUS', State: 'STATE', Image: 'IMAGE', ID: 'CONTAINER ID', Ports: 'PORTS', RunningFor: 'CREATED', CreatedAt: 'CREATED AT', Command: 'COMMAND', Service: 'SERVICE', Repository: 'REPOSITORY', Tag: 'TAG', Size: 'SIZE' };
  function fmtRows(fmt, objs) {
    let tpl = String(fmt).replace(/\\t/g, '\t'), table = false;
    if (/^table\s/.test(tpl)) { table = true; tpl = tpl.replace(/^table\s+/, ''); }
    const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
    const render = o => tpl.replace(/\{\{\s*(json\s+)?\.([\w.]+)\s*\}\}/g, (mm, js, path) => { const v = get(o, path); return js || (v && typeof v === 'object') ? JSON.stringify(v ?? null) : v === undefined ? '<no value>' : String(v); }).replace(/\{\{\s*json\s+\.\s*\}\}/g, () => JSON.stringify(o));
    const rows = objs.map(render);
    if (!table) return rows.join('\n') + (rows.length ? '\n' : '');
    const head = tpl.replace(/\{\{\s*(?:json\s+)?\.([\w.]+)\s*\}\}/g, (mm, p) => HEAD[p] || p.toUpperCase());
    const cells = [head, ...rows].map(l => l.split('\t'));
    const width = Math.max(...cells.map(c => c.length));
    return S.table(cells.map(c => c.concat(Array(width - c.length).fill('')))) + '\n';
  }
  function findCtr(n, key) { if (!key) return null; return n.cn.ctrs[key] || Object.values(n.cn.ctrs).find(r => key.length >= 3 && r.id.startsWith(key)) || null; }
  const psObj = (w, r) => ({ ID: r.id.slice(0, 12), Names: r.name, Name: r.name, Image: r.image, Command: r.spec.cmd, Status: statusStr(w, r), State: stateWord(r), Ports: r.state === 'running' ? r.spec.ports : '', RunningFor: `${human(w.t - r.created)} ago`, CreatedAt: iso(w, r.created), Service: r.svc });
  function envList(w, n, r) {
    const base = ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'];
    if (r.svc === 'validator') return base.concat(Object.entries(r.env).map(([k, v]) => `${k}=${v}`), ['SPLICE_APP_VALIDATOR_PARTICIPANT_ADDRESS=participant', 'SPLICE_APP_VALIDATOR_SCAN_ADDRESS=https://scan.sv-3.example', 'SPLICE_APP_VALIDATOR_SV_SPONSOR_ADDRESS=https://sv.sv-3.example', 'SPLICE_APP_VALIDATOR_WALLET_USER_NAME=administrator']);
    if (r.svc === 'participant') return base.concat(['CANTON_PARTICIPANT_POSTGRES_SERVER=postgres-splice', 'CANTON_PARTICIPANT_POSTGRES_PORT=5432', 'CANTON_PARTICIPANT_POSTGRES_DB=participant-' + w.chain.migrationId, 'AUTH_TARGET_AUDIENCE=https://validator.example']);
    if (r.svc === 'postgres-splice') return base.concat(['POSTGRES_USER=cnadmin', 'POSTGRES_PASSWORD=(redacted)', 'PGDATA=/var/lib/postgresql/data']);
    return base;
  }
  function healthObj(w, n, r) {
    const bad = r.health === 'unhealthy';
    const out = bad ? (r.svc === 'validator' ? 'curl: (22) The requested URL returned error: 503' : r.svc === 'participant' ? 'grpc health: NOT_SERVING' : '/var/run/postgresql:5432 - no response') : '';
    const t1 = iso(w, w.t - 10);
    return { Status: r.health, FailingStreak: bad ? Math.max(1, Math.floor((w.t - (r.badSince || w.t)) / 30)) : 0, Log: [{ Start: t1, End: t1, ExitCode: bad ? 1 : 0, Output: out }] };
  }
  function inspectObj(w, n, r) {
    const o = {
      Id: r.id, Created: iso(w, r.created), Path: '/app/entrypoint.sh', Args: [],
      State: { Status: stateWord(r), Running: r.state === 'running', Paused: false, Restarting: false, OOMKilled: false, Dead: false, Pid: r.state === 'running' ? 3000 + parseInt(r.id.slice(0, 3), 16) : 0, ExitCode: r.state === 'running' ? 0 : r.exitCode, StartedAt: r.started != null ? iso(w, r.started) : '0001-01-01T00:00:00Z', FinishedAt: r.finished != null ? iso(w, r.finished) : '0001-01-01T00:00:00Z' },
      Image: 'sha256:' + hex(hstr(r.image), 64),
      LogPath: logPath(r.id), Name: '/' + r.name, RestartCount: r.restarts,
      HostConfig: { LogConfig: { Type: 'json-file', Config: r.logOpts }, RestartPolicy: { Name: 'always', MaximumRetryCount: 0 } },
      Mounts: r.svc === 'postgres-splice' ? [{ Type: 'volume', Name: VOL, Source: VOLP + '/_data', Destination: '/var/lib/postgresql/data', Driver: 'local', Mode: 'z', RW: true }] : r.svc === 'ledger-indexer' ? [{ Type: 'volume', Name: 'ledger-indexer_data', Source: '/var/lib/docker/volumes/ledger-indexer_data/_data', Destination: '/data', Driver: 'local', Mode: 'z', RW: true }] : [],
      Config: { Hostname: r.id.slice(0, 12), Image: r.image, Env: envList(w, n, r), Labels: { 'com.docker.compose.project': r.project, 'com.docker.compose.service': r.svc, 'com.docker.compose.project.working_dir': r.project === PROJECT ? DIR : `/opt/${r.svc}` } },
    };
    if (r.health && r.state === 'running') o.State.Health = healthObj(w, n, r);
    return o;
  }
  const volumeInUse = n => Object.values(n.cn.ctrs).filter(r => r.svc === 'postgres-splice' && r.project === PROJECT);
  function wipeVolume(w, n) {
    if (!n.cn.vol) return;
    n.cn.vol = null;
    S.fsRemove(n, VOLP, true);
    S.flag(w, 'wipe_db');
    S.event(w, 'bad', LL(`卷 <code>${VOL}</code> 已删除：participant 的身份密钥、party 和全部账本数据都随之消失。`, `Volume <code>${VOL}</code> deleted: the participant's identity keys, its parties and all ledger data are gone with it.`));
  }
  function ensureVolume(w, n) {
    if (n.cn.vol) return false;
    n.cn.vol = { gb: 0.05, fresh: true };
    S.fsWrite(n, VOLP + '/_data/PG_VERSION', '14\n', { owner: 'root', mode: '600' });
    return true;
  }
  function imageRefs(n) { return new Set(Object.values(n.cn.ctrs).map(r => r.image)); }
  const hasImage = (n, img) => n.cn.images.some(i => `${i.repo}:${i.tag}` === img);
  function registryHas(w, img) {
    if (img.startsWith(REPO)) return w.chain.released.includes(tagOf(img));
    return ['postgres:14', 'nginx:1.27.3'].includes(img);
  }
  function addImage(w, n, img, gb, ageSec = 0) {
    if (hasImage(n, img)) return;
    const i = img.lastIndexOf(':');
    n.cn.images.push({ repo: img.slice(0, i), tag: img.slice(i + 1), id: hex(hstr(img), 12), gb, created: w.t - ageSec });
  }
  const gbOfImage = img => { const s = SPECS.find(x => img.includes(x.svc === 'postgres-splice' ? 'postgres:' : x.svc === 'participant' ? 'canton-participant:' : x.svc === 'validator' ? 'validator-app:' : `${x.svc}:`)); return s ? s.gb : 0.3; };

  function dPs(ctx, args) {
    const w = ctx.w, n = ctx.host;
    let all = false, quiet = false, fmt = null; const filters = [];
    for (let i = 0; i < args.length; i++) {
      const x = args[i];
      if (x === '-a' || x === '--all') all = true;
      else if (x === '-q' || x === '--quiet') quiet = true;
      else if (x === '-aq' || x === '-qa') { all = true; quiet = true; }
      else if (x === '--format') fmt = args[++i];
      else if (x.startsWith('--format=')) fmt = x.slice(9);
      else if (x === '-f' || x === '--filter') filters.push(args[++i] || '');
      else if (x.startsWith('--filter=')) filters.push(x.slice(9));
      else if (x === '--no-trunc') { /* ignore */ }
      else return err(`unknown flag: ${x}\nSee 'docker ps --help'.`, 125);
    }
    let list = ctrList(n).filter(r => all || r.state === 'running');
    for (const f of filters) {
      const [k, v] = f.split('=');
      if (k === 'health') list = list.filter(r => r.state === 'running' && (r.health || 'none') === v);
      else if (k === 'name') list = list.filter(r => r.name.includes(v));
      else if (k === 'status') list = list.filter(r => stateWord(r) === v);
      else return err(`invalid argument "${f}" for "-f, --filter" flag: invalid filter '${k}'`, 125);
    }
    if (quiet) return list.map(r => r.id.slice(0, 12)).join('\n') + (list.length ? '\n' : '');
    if (fmt) return fmtRows(fmt, list.map(r => psObj(w, r)));
    return S.table(list.map(r => { const o = psObj(w, r); return [o.ID, o.Image, o.Command, o.RunningFor, o.Status, o.Ports, o.Names]; }), ['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES']) + '\n';
  }
  async function followLogs(ctx, keys, render) {
    const n = ctx.host;
    let last = Math.max(0, ...keys.map(k => { const j = n.journal[k] || []; return j.length ? j[j.length - 1].id : 0; }));
    while (!ctx.sig.aborted) {
      await ctx.sleep(1);
      const fresh = keys.flatMap(k => (n.journal[k] || []).filter(e => e.id > last).map(e => ({ k, e }))).sort((a, b) => a.e.id - b.e.id);
      if (fresh.length) { last = fresh[fresh.length - 1].e.id; ctx.write(fresh.map(x => render(x.k, x.e)).join('\n') + '\n'); }
    }
  }
  const color = e => e.level === 'ERROR' || e.level === 'FATAL' ? C.red(e.msg) : e.level === 'WARN' ? C.yellow(e.msg) : e.msg;
  const sinceSec = s => { const m = /^(\d+)(s|m|h)$/.exec(s || ''); return m ? +m[1] * ({ s: 1, m: 60, h: 3600 }[m[2]]) : null; };
  async function dLogs(ctx, args) {
    const w = ctx.w, n = ctx.host;
    let tail = null, follow = false, since = null, name = null;
    for (let i = 0; i < args.length; i++) {
      const x = args[i];
      if (x === '--tail' || x === '-n') tail = args[++i];
      else if (x.startsWith('--tail=')) tail = x.slice(7);
      else if (x === '-f' || x === '--follow') follow = true;
      else if (x === '--since') since = args[++i];
      else if (x === '-t' || x === '--timestamps') { /* lines already carry timestamps */ }
      else if (x.startsWith('-')) return err(`unknown flag: ${x}\nSee 'docker logs --help'.`, 125);
      else name = x;
    }
    if (!name) return err('"docker logs" requires exactly 1 argument.\nSee \'docker logs --help\'.\n\nUsage:  docker logs [OPTIONS] CONTAINER', 1);
    const r = findCtr(n, name);
    if (!r) return err(`Error response from daemon: No such container: ${name}`);
    const key = 'ctr:' + r.id;
    let es = n.journal[key] || [];
    const s = sinceSec(since); if (s) es = es.filter(e => e.t >= w.t - s);
    if (tail !== null && tail !== 'all') es = es.slice(-Math.max(0, parseInt(tail, 10) || 0));
    const out = es.map(color).join('\n');
    if (!follow || !ctx.interactive) return out ? out + '\n' : '';
    if (out) ctx.write(out + '\n');
    ctx.write(gray(S.L('（跟随日志中，Ctrl+C 退出。新日志跟随模拟时钟产生）', '(following; Ctrl+C to stop. New lines arrive on the simulated clock)')) + '\n');
    await followLogs(ctx, [key], (k, e) => color(e));
  }
  function dInspect(ctx, args) {
    const w = ctx.w, n = ctx.host;
    let fmt = null; const names = [];
    for (let i = 0; i < args.length; i++) { if (args[i] === '-f' || args[i] === '--format') fmt = args[++i]; else if (args[i].startsWith('--format=')) fmt = args[i].slice(9); else if (args[i] === '--type') i++; else names.push(args[i]); }
    if (!names.length) return err('"docker inspect" requires at least 1 argument.');
    const objs = [], missing = [];
    names.forEach(x => {
      const r = findCtr(n, x);
      if (r) objs.push(inspectObj(w, n, r));
      else if (x === VOL && n.cn.vol) objs.push({ CreatedAt: iso(w, -86400 * 160), Driver: 'local', Labels: { 'com.docker.compose.project': PROJECT, 'com.docker.compose.volume': 'postgres-splice' }, Mountpoint: VOLP + '/_data', Name: VOL, Options: null, Scope: 'local' });
      else missing.push(x);
    });
    let out = fmt ? fmtRows(fmt, objs) : JSON.stringify(objs, null, 4) + '\n';
    if (missing.length) return { code: 1, out: out + missing.map(x => `Error: No such object: ${x}`).join('\n') + '\n' };
    return out;
  }
  async function dExec(ctx, args) {
    const w = ctx.w, n = ctx.host;
    let i = 0;
    while (i < args.length && args[i].startsWith('-')) { if (args[i] === '-u' || args[i] === '--user' || args[i] === '-e' || args[i] === '-w') i += 2; else i++; }
    const name = args[i], cmd = args.slice(i + 1);
    if (!name || !cmd.length) return err('"docker exec" requires at least 2 arguments.\nSee \'docker exec --help\'.');
    const r = findCtr(n, name);
    if (!r) return err(`Error response from daemon: No such container: ${name}`);
    if (r.state !== 'running') return err(`Error response from daemon: container ${r.id} is not running`);
    const c0 = cmd[0];
    if (c0 === 'env' || c0 === 'printenv') return envList(w, n, r).join('\n') + '\n';
    if (c0 === 'curl' && (r.svc === 'validator' || r.svc === 'participant')) return S.commands.curl(Object.assign({}, ctx, { args: cmd.slice(1), argv0: 'curl', execIn: r }));
    if (c0 === 'pg_isready' && r.svc === 'postgres-splice') return n.cn.pgCorrupt ? err('/var/run/postgresql:5432 - no response', 2) : '/var/run/postgresql:5432 - accepting connections\n';
    if (c0 === 'cat' || c0 === 'ls' || c0 === 'sh' || c0 === 'bash' || c0 === 'psql') return err(gray(S.L('这个练习只支持在容器里运行 env、curl 和 pg_isready。', 'Only env, curl and pg_isready are available inside containers in this lab.')), 126);
    return err(`OCI runtime exec failed: exec failed: unable to start container process: exec: "${c0}": executable file not found in $PATH: unknown`, 126);
  }
  function configDrift(w, n, r) {
    if (r.project !== PROJECT) return false;
    const env = readEnv(w, n); if (!env) return false;
    const d = desired(env, specOf(r.svc));
    return d.image !== r.image || JSON.stringify(d.env) !== JSON.stringify(r.env);
  }
  function restartLesson(w, n, recs) {
    if (recs.some(r => configDrift(w, n, r))) S.lesson(w, 'restartenv', LL('restart 不会应用新配置', 'restart does not apply new settings'), LL('docker restart 和 docker compose restart 只是重启已有的容器，镜像和环境变量都保持创建时的样子。修改 .env 里的 IMAGE_TAG 或其他变量后，要用 docker compose up -d，compose 会比较配置，按需重建容器。可以用 docker inspect 查看容器实际使用的镜像和环境变量。', 'docker restart and docker compose restart restart the existing containers, with the image and environment they were created with. After changing IMAGE_TAG or another variable in .env, run docker compose up -d: compose compares the configuration and recreates what changed. docker inspect shows the image and environment a container actually runs with.'));
  }
  async function dLife(ctx, sub, args) {
    const w = ctx.w, n = ctx.host;
    const names = args.filter(a => !a.startsWith('-'));
    if (!names.length) return err(`"docker ${sub}" requires at least 1 argument.`);
    let out = '', code = 0;
    const recs = [];
    for (const x of names) {
      const r = findCtr(n, x);
      if (!r) { out += `Error response from daemon: No such container: ${x}\n`; code = 1; continue; }
      recs.push(r);
      if (sub !== 'start' && r.state === 'running') { await ctx.sleep(r.spec.splice ? 6 : 1); stopCtr(w, n, r); }
      if (sub !== 'stop') startCtr(w, n, r);
      out += x + '\n';
    }
    if (sub === 'restart') restartLesson(w, n, recs);
    return { code, out };
  }
  function dRm(ctx, args) {
    const w = ctx.w, n = ctx.host, force = args.some(a => /^-\w*f/.test(a) || a === '--force');
    let out = '', code = 0;
    args.filter(a => !a.startsWith('-')).forEach(x => {
      const r = findCtr(n, x);
      if (!r) { out += `Error response from daemon: No such container: ${x}\n`; code = 1; return; }
      if (r.state === 'running' && !force) { out += `Error response from daemon: cannot remove container "/${r.name}": container is running: stop the container before removing or force remove\n`; code = 1; return; }
      removeCtr(w, n, r); out += x + '\n';
    });
    return { code, out };
  }
  function dImages(ctx) {
    const w = ctx.w, n = ctx.host;
    return S.table(n.cn.images.slice().sort((a, b) => b.created - a.created).map(i => [i.repo, i.tag, i.id, `${human(w.t - i.created)} ago`, fmtDockerSize(i.gb)]), ['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE']) + '\n';
  }
  const pruneWarn = (what) => err(`WARNING! This will remove ${what}.\nAre you sure you want to continue? [y/N] \n${gray(S.L('（这个终端不能回答提示。确认要执行，请加 -f）', '(this terminal cannot answer the prompt; add -f to confirm)'))}`, 1);
  async function dImagePrune(ctx, args) {
    const n = ctx.host, all = args.some(a => a === '-a' || a === '--all' || /^-\w*a/.test(a)), force = args.some(a => a === '-f' || a === '--force' || /^-\w*f/.test(a));
    if (!force) return pruneWarn(all ? 'all images without at least one container associated to them' : 'all dangling images');
    if (!all) return 'Total reclaimed space: 0B\n';
    await ctx.sleep(4);
    const used = imageRefs(n);
    const gone = n.cn.images.filter(i => !used.has(`${i.repo}:${i.tag}`));
    n.cn.images = n.cn.images.filter(i => used.has(`${i.repo}:${i.tag}`));
    const total = gone.reduce((s, i) => s + i.gb, 0);
    if (!gone.length) return 'Total reclaimed space: 0B\n';
    return `Deleted Images:\n${gone.map(i => `untagged: ${i.repo}:${i.tag}\ndeleted: sha256:${i.id}${hex(hstr(i.repo + i.tag) ^ 0x5bd1e995, 52)}`).join('\n')}\n\nTotal reclaimed space: ${fmtDockerSize(total)}\n`;
  }
  function dVolume(ctx, args) {
    const w = ctx.w, n = ctx.host, sub = args[0], rest = args.slice(1);
    const vols = () => (n.cn.vol ? [VOL] : []).concat(['ledger-indexer_data']);
    if (sub === 'ls') return S.table(vols().map(v => ['local', v]), ['DRIVER', 'VOLUME NAME']) + '\n';
    if (sub === 'inspect') return dInspect(ctx, rest);
    if (sub === 'rm') {
      const names = rest.filter(a => !a.startsWith('-'));
      let out = '', code = 0;
      names.forEach(x => {
        if (x === VOL && n.cn.vol) {
          const users = volumeInUse(n);
          if (users.length) { out += `Error response from daemon: remove ${VOL}: volume is in use - [${users.map(r => r.id).join(', ')}]\n`; code = 1; return; }
          wipeVolume(w, n); out += x + '\n';
        } else if (x === 'ledger-indexer_data') { out += `Error response from daemon: remove ledger-indexer_data: volume is in use - [${n.cn.ctrs['ledger-indexer'] ? n.cn.ctrs['ledger-indexer'].id : ''}]\n`; code = 1; }
        else { out += `Error response from daemon: get ${x}: no such volume\n`; code = 1; }
      });
      return { code, out };
    }
    if (sub === 'prune') {
      const all = rest.some(a => a === '-a' || a === '--all' || /^-\w*a/.test(a)), force = rest.some(a => a === '-f' || a === '--force' || /^-\w*f/.test(a));
      if (!force) return pruneWarn(all ? 'all local volumes not used by at least one container' : 'anonymous local volumes not used by at least one container');
      if (all && n.cn.vol && !volumeInUse(n).length) { const gb = n.cn.vol.gb; wipeVolume(w, n); return `Deleted Volumes:\n${VOL}\n\nTotal reclaimed space: ${fmtDockerSize(gb)}\n`; }
      return 'Total reclaimed space: 0B\n';
    }
    return err(`Usage:  docker volume COMMAND\n\nCommands:\n  inspect  ls  prune  rm`);
  }
  async function dSystem(ctx, args) {
    const w = ctx.w, n = ctx.host, sub = args[0], rest = args.slice(1);
    if (sub === 'df') {
      const used = imageRefs(n), imgs = n.cn.images, ig = imgs.reduce((s, i) => s + i.gb, 0), rec = imgs.filter(i => !used.has(`${i.repo}:${i.tag}`)).reduce((s, i) => s + i.gb, 0);
      const cs = ctrList(n), vg = (n.cn.vol ? n.cn.vol.gb : 0) + n.cn.auxGB;
      return S.table([
        ['Images', String(imgs.length), String(imgs.filter(i => used.has(`${i.repo}:${i.tag}`)).length), fmtDockerSize(ig), `${fmtDockerSize(rec)} (${Math.round(rec / Math.max(ig, 0.001) * 100)}%)`],
        ['Containers', String(cs.length), String(cs.filter(running).length), '1.21MB', '0B (0%)'],
        ['Local Volumes', String((n.cn.vol ? 1 : 0) + 1), String((n.cn.vol ? 1 : 0) + 1), fmtDockerSize(vg), '0B (0%)'],
        ['Build Cache', '0', '0', '0B', '0B'],
      ], ['TYPE', 'TOTAL', 'ACTIVE', 'SIZE', 'RECLAIMABLE']) + '\n';
    }
    if (sub === 'prune') {
      const all = rest.some(a => a === '-a' || a === '--all' || /^-\w*a/.test(a)), force = rest.some(a => a === '-f' || a === '--force' || /^-\w*f/.test(a));
      if (!force) return pruneWarn(`all stopped containers, all networks not used by at least one container, ${all ? 'all images without at least one container associated to them' : 'all dangling images'}, unused build cache${rest.includes('--volumes') ? ', anonymous volumes not used by at least one container' : ''}`);
      const stopped = ctrList(n).filter(r => r.state !== 'running');
      stopped.forEach(r => removeCtr(w, n, r));
      let out = stopped.length ? `Deleted Containers:\n${stopped.map(r => r.id).join('\n')}\n\n` : '';
      if (all) { const r = await dImagePrune(ctx, ['-a', '-f']); out += typeof r === 'string' ? r : r.out; }
      else out += 'Total reclaimed space: 0B\n';
      return out;
    }
    if (sub === 'info') return 'Server Version: 27.3.1\nStorage Driver: overlay2\nLogging Driver: json-file\nDocker Root Dir: /var/lib/docker\n';
    return err('Usage:  docker system COMMAND\n\nCommands:\n  df  prune');
  }

  /* ---------- docker compose ---------- */
  function readEnv(w, n) {
    const txt = S.fsRead(w, n, ENVP);
    if (txt === null) return null;
    const env = {};
    txt.split('\n').forEach(l => { if (/^\s*#/.test(l)) return; const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
    return env;
  }
  function desired(env, spec) { return { image: spec.img(env), env: (spec.envKeys || []).reduce((o, k) => { o[k] = env[k] ?? ''; return o; }, {}) }; }
  const projectCtrs = n => SPECS.map(s => n.cn.ctrs[`${PROJECT}-${s.svc}-1`]).filter(Boolean);
  async function waitHealthy(ctx, n, rec) {
    const t0 = ctx.w.t;
    ctx.write(` ${C.gray('⠿')} Container ${S.pad(rec.name, 36)} Waiting\n`);
    while (!ctx.sig.aborted) {
      if (rec.health === 'healthy') { ctx.write(` ${C.green('✔')} Container ${S.pad(rec.name, 36)} ${C.green('Healthy')}  ${(ctx.w.t - t0).toFixed(1)}s\n`); return true; }
      if (rec.state !== 'running' || rec.health === 'unhealthy' || ctx.w.t - t0 > 900) { ctx.write(` ${C.red('✘')} Container ${S.pad(rec.name, 36)} ${C.red('Error')}\n`); return false; }
      await ctx.sleep(2);
    }
    return false;
  }
  async function composeUp(ctx, n, env, opts) {
    const w = ctx.w;
    if (!env.IMAGE_TAG || !env.IMAGE_REPO) return err(`WARN[0000] The "IMAGE_TAG" variable is not set. Defaulting to a blank string.\nError response from daemon: invalid reference format`, 1);
    let specs = SPECS.filter(s => !opts.svcs.length || opts.svcs.includes(s.svc));
    if (opts.svcs.length && opts.svcs.some(x => !specOf(x))) return err(`no such service: ${opts.svcs.find(x => !specOf(x))}`);
    const want = specs.map(s => ({ s, d: desired(env, s) }));
    const missing = want.filter(x => !hasImage(n, x.d.image));
    if (missing.length) {
      ctx.write(`[+] Pulling ${missing.length}/${missing.length}\n`);
      for (const x of missing) {
        if (!registryHas(w, x.d.image)) { ctx.write(` ${C.red('✘')} ${x.s.svc} Error manifest for ${x.d.image} not found: manifest unknown: manifest unknown\n`); return err(`Error response from daemon: manifest for ${x.d.image} not found: manifest unknown: manifest unknown`, 18); }
        await ctx.sleep(10 * x.s.gb + 2); if (ctx.sig.aborted) return { code: 130 };
        addImage(w, n, x.d.image, x.s.gb);
        ctx.write(` ${C.green('✔')} ${x.s.svc} Pulled\n`);
      }
    }
    ctx.write(`[+] Running ${want.length}/${want.length}\n`);
    if (ensureVolume(w, n)) ctx.write(` ${C.green('✔')} Volume "${VOL}"  ${C.green('Created')}\n`);
    for (const x of want) {
      let rec = n.cn.ctrs[`${PROJECT}-${x.s.svc}-1`];
      const depName = WAITS[x.s.svc];
      if (depName && !opts.noDeps) {
        const dep = n.cn.ctrs[`${PROJECT}-${depName}-1`];
        if (dep && dep.health !== 'healthy') { if (!await waitHealthy(ctx, n, dep)) return err(`dependency failed to start: container ${dep.name} is unhealthy`, 1); }
      }
      if (!rec) {
        rec = createCtr(w, n, x.s, x.d.image, x.d.env); startCtr(w, n, rec);
        ctx.write(` ${C.green('✔')} Container ${S.pad(rec.name, 36)} ${C.green('Started')}\n`);
      } else if (opts.force || rec.image !== x.d.image || JSON.stringify(rec.env) !== JSON.stringify(x.d.env)) {
        ctx.write(` ${C.gray('⠿')} Container ${S.pad(rec.name, 36)} Recreate\n`);
        await ctx.sleep(x.s.splice ? 8 : 2);
        removeCtr(w, n, rec);
        rec = createCtr(w, n, x.s, x.d.image, x.d.env); startCtr(w, n, rec);
        ctx.write(` ${C.green('✔')} Container ${S.pad(rec.name, 36)} ${C.green('Recreated')}\n`);
      } else if (rec.state !== 'running') {
        startCtr(w, n, rec);
        ctx.write(` ${C.green('✔')} Container ${S.pad(rec.name, 36)} ${C.green('Started')}\n`);
      } else ctx.write(` ${C.green('✔')} Container ${S.pad(rec.name, 36)} Running\n`);
    }
    return { code: 0 };
  }
  async function composeDown(ctx, n, vols) {
    const w = ctx.w, recs = projectCtrs(n).reverse();
    ctx.write(`[+] Running ${recs.length + 1 + (vols ? 1 : 0)}/${recs.length + 1 + (vols ? 1 : 0)}\n`);
    for (const r of recs) {
      await ctx.sleep(r.state === 'running' ? (r.spec.splice ? 6 : 1) : 0.2);
      removeCtr(w, n, r);
      ctx.write(` ${C.green('✔')} Container ${S.pad(r.name, 36)} ${C.green('Removed')}\n`);
    }
    if (vols && n.cn.vol) { wipeVolume(w, n); ctx.write(` ${C.green('✔')} Volume ${S.pad(VOL, 39)} ${C.green('Removed')}\n`); }
    ctx.write(` ${C.green('✔')} Network ${S.pad('splice-validator_splice_validator', 38)} ${C.green('Removed')}\n`);
    return { code: 0 };
  }
  function composeConfig(w, n, env) {
    return (S.fsRead(w, n, COMPOSEP) || '').replace(/\$\{([A-Z_]+)(?::-([^}]*))?\}/g, (m, k, d) => env[k] ?? d ?? '');
  }
  async function compose(ctx, args) {
    const w = ctx.w, n = ctx.host;
    let file = null, i = 0;
    while (i < args.length && args[i].startsWith('-')) {
      if (args[i] === '-f' || args[i] === '--file') { file = args[i + 1]; i += 2; }
      else if (args[i] === '--project-directory') { file = args[i + 1] + '/compose.yaml'; i += 2; }
      else if (args[i] === '-p' || args[i] === '--project-name' || args[i] === '--env-file') i += 2;
      else i++;
    }
    const sub = args[i], rest = args.slice(i + 1);
    if (!sub) return 'Usage:  docker compose [OPTIONS] COMMAND\n\nCommands:\n  config  down  images  logs  ps  pull  restart  start  stop  up  version\n';
    if (sub === 'version') return 'Docker Compose version v2.29.7\n';
    const cand = file ? [ctx.resolve(file)] : ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].map(f => S.norm(ctx.sess.cwd + '/' + f));
    const path = cand.find(p => S.fsGet(n, p));
    if (!path) return err(`no configuration file provided: not found ${file ? '' : gray(S.L(`（compose 文件在 ${DIR}，先 cd 过去，或加 -f）`, `(the compose file is in ${DIR}; cd there first, or pass -f)`))}`, 14);
    const env = readEnv(w, n) || {};
    const flags = rest.filter(a => a.startsWith('-')), svcs = rest.filter((a, k) => !a.startsWith('-') && !(k > 0 && ['--tail', '-n', '-t', '--timeout'].includes(rest[k - 1])));
    const sel = () => projectCtrs(n).filter(r => !svcs.length || svcs.includes(r.svc));
    switch (sub) {
      case 'ps': {
        const all = flags.includes('-a') || flags.includes('--all');
        const list = sel().filter(r => all || r.state === 'running');
        const fmt = rest[rest.indexOf('--format') + 1];
        if (flags.includes('--format') && fmt) return fmtRows(fmt, list.map(r => psObj(w, r)));
        return S.table(list.map(r => { const o = psObj(w, r); return [o.Names, o.Image, o.Command, o.Service, o.RunningFor, o.Status, o.Ports]; }), ['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS']) + '\n';
      }
      case 'config': return composeConfig(w, n, env);
      case 'images': return S.table(sel().map(r => [r.name, r.image.slice(0, r.image.lastIndexOf(':')), tagOf(r.image), hex(hstr(r.image), 12), fmtDockerSize(gbOfImage(r.image))]), ['CONTAINER', 'REPOSITORY', 'TAG', 'IMAGE ID', 'SIZE']) + '\n';
      case 'pull': {
        if (!env.IMAGE_TAG) return err('Error response from daemon: invalid reference format');
        const specs = SPECS.filter(s => !svcs.length || svcs.includes(s.svc));
        ctx.write(`[+] Pulling ${specs.length}/${specs.length}\n`);
        let failed = null;
        for (const s of specs) {
          const img = s.img(env);
          if (!registryHas(w, img)) { ctx.write(` ${C.red('✘')} ${s.svc} Error manifest for ${img} not found: manifest unknown: manifest unknown\n`); failed = failed || img; continue; }
          const have = hasImage(n, img);
          await ctx.sleep(have ? 0.6 : 10 * s.gb + 2); if (ctx.sig.aborted) return { code: 130 };
          addImage(w, n, img, s.gb);
          ctx.write(` ${C.green('✔')} ${s.svc} Pulled\n`);
        }
        if (failed) return err(`Error response from daemon: manifest for ${failed} not found: manifest unknown: manifest unknown`, 18);
        return { code: 0 };
      }
      case 'up': {
        if (!flags.some(f => f === '-d' || f === '--detach' || /^-\w*d/.test(f))) return err(gray(S.L('docker compose up 不加 -d 会占住终端，Ctrl+C 还会停掉容器。请用 docker compose up -d。', 'docker compose up without -d holds the terminal, and Ctrl+C stops the containers. Use docker compose up -d.')));
        return composeUp(ctx, n, env, { svcs, force: flags.includes('--force-recreate'), noDeps: flags.includes('--no-deps') });
      }
      case 'down': return composeDown(ctx, n, flags.includes('-v') || flags.includes('--volumes'));
      case 'restart': case 'stop': case 'start': {
        const recs = sel();
        ctx.write(`[+] ${sub === 'stop' ? 'Stopping' : sub === 'start' ? 'Running' : 'Restarting'} ${recs.length}/${recs.length}\n`);
        const order = sub === 'stop' ? recs.slice().reverse() : recs;
        for (const r of order) {
          if (sub !== 'start' && r.state === 'running') { await ctx.sleep(r.spec.splice ? 6 : 1); stopCtr(w, n, r); }
          if (sub !== 'stop') { if (r.state !== 'running') startCtr(w, n, r); }
          ctx.write(` ${C.green('✔')} Container ${S.pad(r.name, 36)} ${C.green(sub === 'stop' ? 'Stopped' : 'Started')}\n`);
        }
        if (sub === 'restart') restartLesson(w, n, recs);
        return { code: 0 };
      }
      case 'logs': {
        const tail = rest[rest.indexOf('--tail') + 1] ?? rest[rest.indexOf('-n') + 1];
        const hasTail = rest.includes('--tail') || rest.includes('-n');
        const recs = sel();
        const pre = r => `${C.cyan(S.pad(r.svc + '-1', 19))}| `;
        let es = recs.flatMap(r => { let x = n.journal['ctr:' + r.id] || []; if (hasTail) x = x.slice(-Math.max(0, parseInt(tail, 10) || 0)); return x.map(e => ({ r, e })); }).sort((a, b) => a.e.id - b.e.id);
        const out = es.map(x => pre(x.r) + color(x.e)).join('\n');
        if (!(flags.includes('-f') || flags.includes('--follow')) || !ctx.interactive) return out ? out + '\n' : '';
        if (out) ctx.write(out + '\n');
        const byKey = {}; recs.forEach(r => { byKey['ctr:' + r.id] = r; });
        await followLogs(ctx, Object.keys(byKey), (k, e) => pre(byKey[k]) + color(e));
        return;
      }
    }
    return err(`unknown docker command: "compose ${sub}"`);
  }

  async function docker(ctx) {
    const w = ctx.w, n = ctx.host, a = ctx.args;
    if (a[0] === '--version' || a[0] === '-v') return 'Docker version 27.3.1, build ce12230\n';
    if (a[0] === 'compose' && (a[1] === 'version' || a[1] === '--version')) return 'Docker Compose version v2.29.7\n';
    if (!ctx.isRoot) return err(`permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json": dial unix /var/run/docker.sock: connect: permission denied ${gray(S.L('（需要 root：先 sudo -i，或在命令前加 sudo）', '(needs root: sudo -i first, or prefix with sudo)'))}`);
    if (!dockerUp(n)) return err('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
    const sub = a[0], rest = a.slice(1);
    switch (sub) {
      case 'ps': return dPs(ctx, rest);
      case 'logs': return dLogs(ctx, rest);
      case 'inspect': return dInspect(ctx, rest);
      case 'exec': return dExec(ctx, rest);
      case 'restart': case 'stop': case 'start': return dLife(ctx, sub, rest);
      case 'rm': return dRm(ctx, rest);
      case 'images': return dImages(ctx);
      case 'image': if (rest[0] === 'ls') return dImages(ctx); if (rest[0] === 'prune') return dImagePrune(ctx, rest.slice(1)); break;
      case 'volume': return dVolume(ctx, rest);
      case 'system': return dSystem(ctx, rest);
      case 'info': return dSystem(ctx, ['info']);
      case 'compose': return compose(ctx, rest);
      case undefined: return 'Usage:  docker [OPTIONS] COMMAND\n\nCommon Commands:\n  ps  logs  inspect  exec  restart  images  volume  system  compose\n';
    }
    return err(`docker: '${sub}' is not a docker command.\nSee 'docker --help'`);
  }

  /* ---------- other node commands ---------- */
  function du(ctx) {
    const n = ctx.host, a = ctx.args;
    if (!n.cn) return err('du: not available');
    const hum = a.some(x => /^-\w*h/.test(x)), sum = a.some(x => /^-\w*s/.test(x)) || !a.some(x => /max-depth|^-d$/.test(x));
    const depthIdx = a.findIndex(x => x === '-d'); const md = a.find(x => x.startsWith('--max-depth='));
    const depth = md ? parseInt(md.split('=')[1], 10) : depthIdx >= 0 ? parseInt(a[depthIdx + 1], 10) : null;
    let targets = a.filter((x, k) => !x.startsWith('-') && !(k > 0 && a[k - 1] === '-d'));
    if (!targets.length) targets = ['.'];
    const exp = [];
    targets.forEach(t => {
      if (t.endsWith('/*')) { const base = ctx.resolve(t.slice(0, -2)); S.fsList(n, base).forEach(c => exp.push({ shown: (t.slice(0, -1) + c), p: S.norm(base + '/' + c) })); }
      else exp.push({ shown: t, p: ctx.resolve(t) });
    });
    const f = gb => hum ? fmtGB(gb) : String(Math.max(4, Math.round(gb * 1048576)));
    let out = '', code = 0;
    exp.forEach(x => {
      if (!S.fsIsDir(n, x.p) && !S.fsGet(n, x.p)) { out += `du: cannot access '${x.shown}': No such file or directory\n`; code = 1; return; }
      if (x.p.startsWith('/var/lib/docker') && !ctx.isRoot) { out += `du: cannot read directory '${x.shown}': Permission denied\n`; code = 1; return; }
      if (depth === 1 && !sum) S.fsList(n, x.p).forEach(c => { const cp = S.norm(x.p + '/' + c); if (S.fsIsDir(n, cp) && !S.fsGet(n, cp)) out += `${f(sizeAt(n, cp))}\t${S.norm(x.shown + '/' + c)}\n`; });
      out += `${f(sizeAt(n, x.p))}\t${x.shown}\n`;
    });
    return { code, out };
  }
  function truncate(ctx) {
    const n = ctx.host, a = ctx.args;
    let size = null; const files = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-s' || a[i] === '--size') size = a[++i];
      else if (/^-s\d+$/.test(a[i])) size = a[i].slice(2);
      else if (a[i].startsWith('--size=')) size = a[i].slice(7);
      else files.push(a[i]);
    }
    if (size === null || !files.length) return err("truncate: you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information.");
    if (size !== '0') return err(S.L('truncate: 本练习只支持 -s 0', 'truncate: only -s 0 is supported in this lab'));
    let out = '', code = 0;
    files.forEach(f => {
      const p = ctx.resolve(f);
      if (!ctx.sh.canWrite(p)) { out += `truncate: cannot open '${f}' for writing: Permission denied\n`; code = 1; return; }
      const rec = n.cn && Object.values(n.cn.ctrs).find(r => logPath(r.id) === p);
      if (rec && S.fsGet(n, p)) { n.cn.logs[rec.id].gb = 0; const fe = S.fsGet(n, p); fe.size = 0; return; }
      if (S.fsIsDir(n, p) && !S.fsGet(n, p)) { out += `truncate: cannot open '${f}' for writing: Is a directory\n`; code = 1; return; }
      S.fsWrite(n, p, '');
    });
    return { code, out };
  }
  const isScript = (ctx, name) => S.norm(ctx.resolve(ctx.name)) === `${DIR}/${name}`;
  const stopSh = async ctx => {
    if (!isScript(ctx, 'stop.sh')) return err(`bash: ${ctx.name}: No such file or directory`, 127);
    if (!ctx.isRoot) return docker(Object.assign({}, ctx, { args: ['ps'] }));
    if (!dockerUp(ctx.host)) return err('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
    const D = ctx.args.includes('-D');
    ctx.write(D ? 'Stopping the validator and deleting its data (-D)\n' : 'Stopping the validator\n');
    return composeDown(ctx, ctx.host, D);
  };
  const startSh = async ctx => {
    if (!isScript(ctx, 'start.sh')) return err(`bash: ${ctx.name}: No such file or directory`, 127);
    if (!ctx.isRoot) return docker(Object.assign({}, ctx, { args: ['ps'] }));
    if (!dockerUp(ctx.host)) return err('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
    const env = readEnv(ctx.w, ctx.host) || {};
    ctx.write(`Starting the validator: Splice ${env.IMAGE_TAG}, migration id ${env.MIGRATION_ID}\n`);
    return composeUp(ctx, ctx.host, env, { svcs: [], force: false, noDeps: false });
  };
  stopSh.hidden = true; startSh.hidden = true;
  const colon = () => ({ code: 0 }); colon.hidden = true;
  const nodeCommands = { docker, du, truncate, ':': colon, 'stop.sh': stopSh, 'start.sh': startSh };

  /* ---------- laptop ---------- */
  function openSession(ctx, n) {
    ctx.sh.push({ host: n, user: 'ssm-user', cwd: '/home/ssm-user', env: { HOME: '/home/ssm-user', USER: 'ssm-user' } });
    return `\nStarting session with SessionId: ops-${n.id}-5e2c9a71\n${gray(S.L(`已登录 ${n.hostname}（${n.region}）。sudo -i 切换到 root，exit 退出。`, `Connected to ${n.hostname} (${n.region}). sudo -i for root, exit to leave.`))}\n`;
  }
  const findNode = (w, key) => Object.values(w.nodes).find(x => x.id === key || x.instanceId === key || x.hostname === key);
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
        if ((f.region || 'us-east-1') !== n.region) return err(`\nAn error occurred (TargetNotConnected) when calling the StartSession operation: ${n.instanceId} is not connected.`, 254);
        return openSession(ctx, n);
      }
      return err(gray(S.L('本练习支持：', 'Available in this lab: ') + 'aws sts get-caller-identity · aws ssm start-session --region us-east-1 --target ID'), 2);
    },
  };

  /* ---------- side panel ---------- */
  const VCOL = ['#7f9180', '#f5a623', '#3fd0c9', '#7cc4ff', '#d69cff'];
  const panel = {
    mount(el) {
      el.innerHTML = `<div class="mech-head"></div><div class="sol-gauges cn-g"></div><div class="avx-grid cn-c"></div><p class="mech-note">${S.L('mining round 大约每 10 分钟一轮。健康的验证者每轮记录一次活动并获得奖励，错过的轮次不能补。每一笔提交都消耗用 CC 购买的 traffic。红线是看板上 Traffic Remainder 的 50,000 阈值。可以上主网的 Splice 版本，是至少 2/3 的 SV 报告的版本。', 'A mining round lasts about 10 minutes. A healthy validator records activity once per round and earns rewards for it; a missed round cannot be made up. Every submission consumes traffic bought with CC. The red mark is the 50,000 threshold of the Traffic Remainder column on the dashboard. The MainNet-ready Splice release is the one at least 2/3 of SVs report.')}</p>`;
    },
    update(el, w) {
      const L = S.L, n = Object.values(w.nodes)[0], cn = n.cn, r = netRound(w), b = behind(w, n), q = quorum(w), loc = localTag(n) || '—';
      el.querySelector('.mech-head').innerHTML = `<span class="mh-k">Global Synchronizer · round</span><span class="mh-v">${r.toLocaleString('en-US')}</span><span class="mh-s">${L('下一轮', 'next round in')} ${S.fmtDur(roundLeft(w))}${w.chain.switchAt != null ? ` · ${w.t < w.chain.switchAt ? L(`新包 ${S.fmtDur(w.chain.switchAt - w.t)} 后生效`, `new packages in ${S.fmtDur(w.chain.switchAt - w.t)}`) : L(`已切换到 ${w.chain.required} 的包`, `packages of ${w.chain.required} active`)}` : ''}</span>`;
      const rem = cn.remainder, remCls = rem < RED_LINE ? 'badc' : '';
      const tgt = topupTarget(bySvc(n, 'validator'));
      const vers = [...new Set(w.chain.svs.map(s => s.v))].sort(S.semverCmp);
      const dot = v => VCOL[(vers.indexOf(v) + VCOL.length) % VCOL.length];
      const svDots = w.chain.svs.map(s => `<span title="${s.name} ${s.v}" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:3px;background:${dot(s.v)}"></span>`).join('');
      const legend = vers.map(v => `<span style="white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot(v)};margin-right:3px"></span>${v} ×${w.chain.svs.filter(s => s.v === v).length}</span>`).join(' &nbsp;');
      const verCls = S.semverCmp(loc === '—' ? '0.0.0' : loc, q) < 0 ? (versionOk(w, n) ? 'warnc' : 'badc') : S.semverCmp(loc, q) > 0 ? 'warnc' : '';
      el.querySelector('.cn-g').innerHTML = `
        <div class="g"><span class="k">${L('本验证者最后记录的轮次 / SV 轮次', 'last round recorded / SV round')}</span><b class="${b >= 1000 ? 'badc' : b >= 100 ? 'warnc' : b > SYNCED ? 'warnc' : ''}">${b.toLocaleString('en-US')} ${L('轮落后', b === 1 ? 'round behind' : 'rounds behind')}</b><span class="s">${cn.ourRound.toLocaleString('en-US')} / ${r.toLocaleString('en-US')} · ${synced(w, n) ? L('已同步（不超过 5 轮）', 'synced (5 rounds or less)') : L('未同步', 'not synced')} · ${L('本次错过', 'missed here')} ${cn.missed}</span><div class="bar"><i class="${b >= 100 ? 'b' : b > SYNCED ? 'w' : ''}" style="width:${Math.min(100, b / 120 * 100)}%"></i><em class="r" style="left:${100 / 120 * 100}%"></em></div></div>
        <div class="g"><span class="k">${L('participant 处理进度落后墙上时钟', 'participant cursor behind wall clock')}</span><b class="${cn.lag > 900 ? 'badc' : cn.lag > LAG_OK ? 'warnc' : ''}">${cn.lag < 60 ? cn.lag.toFixed(1) + ' s' : S.fmtDur(cn.lag)}</b><span class="s">${cn.full ? L('磁盘已满，事件无法写入', 'disk full, events cannot be stored') : processing(n) ? (cn.lag > LAG_OK ? L(`追赶中，约 ${S.fmtDur(cn.lag / CATCHUP)} 追平`, `catching up, about ${S.fmtDur(cn.lag / CATCHUP)} to go`) : L('实时', 'live')) : L('participant 未在处理事件', 'participant not processing')}</span><div class="bar"><i class="${cn.lag > 900 ? 'b' : ''}" style="width:${Math.min(100, cn.lag / 1800 * 100)}%"></i><em class="r" style="left:50%"></em></div></div>
        <div class="g"><span class="k">Traffic Remainder</span><b class="${remCls}">${fmtB(rem)} bytes</b><span class="s">${tgt ? L(`自动充值：开（${tgt} B/s）`, `automated top-up: on (${tgt} B/s)`) : L('自动充值：关（target-throughput = 0）', 'automated top-up: off (target-throughput = 0)')} · ${L('钱包', 'wallet')} ${cn.wallet.toFixed(1)} CC</span><div class="bar"><i class="${rem < RED_LINE ? 'b' : ''}" style="width:${Math.min(100, rem / 400000 * 100)}%"></i><em class="r" style="left:${RED_LINE / 400000 * 100}%"></em></div></div>
        <div class="g"><span class="k">${L('Splice 版本：本节点 / SV 法定多数（2/3）', 'Splice: this node / SV quorum (2/3)')}</span><b class="${verCls}">${loc} / ${q}</b><span class="s" style="line-height:1.9">${svDots}<br>${legend}</span></div>`;
      const rows = ctrList(n).slice().sort((x, y) => (x.project === PROJECT ? 0 : 1) - (y.project === PROJECT ? 0 : 1) || SPECS.findIndex(s => s.svc === x.svc) - SPECS.findIndex(s => s.svc === y.svc)).map(c => {
        const cls = !dockerUp(n) || c.state !== 'running' ? 'badc' : c.health === 'unhealthy' ? 'badc' : c.health === 'starting' ? 'warnc' : 'okc';
        const st = !dockerUp(n) ? 'down' : c.state !== 'running' ? (c.state === 'created' ? 'created' : 'exited') : c.health || 'running';
        return `<span>${c.svc}</span><b class="mono">${tagOf(c.image)}</b><b class="${cls}">${st}</b>`;
      }).join('');
      const bad = !dockerUp(n) || projectCtrs(n).length < SPECS.length || projectCtrs(n).some(c => !healthy(c));
      const pct = diskPct(n);
      el.querySelector('.cn-c').innerHTML = `<div class="avx-node ${bad ? 'warn' : 'ok'}"><div class="an-top"><b>${n.id}</b><span class="an-reg">docker compose · ${PROJECT}</span><span class="pill ${bad ? 'warn' : 'ok'}">${dockerUp(n) ? `${projectCtrs(n).filter(healthy).length}/${SPECS.length} healthy` : 'docker down'}</span></div>
        <div class="an-row" style="grid-template-columns:1fr auto auto">${rows}</div>
        <div class="an-row" style="grid-template-columns:auto 1fr auto auto"><span>${L('磁盘', 'disk')} /</span><span></span><b class="mono ${pct >= 99.9 ? 'badc' : pct >= 85 ? 'warnc' : ''}">${Math.round(pct)}%</b><span>${Math.round(diskUsed(n))}/${n.disk.size}G</span></div>
        <div class="an-row" style="grid-template-columns:auto 1fr"><span>party</span><b class="mono ${cn.identityLost ? 'badc' : ''}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cn.party.slice(0, 28)}…</b></div></div>`;
    },
  };

  /* ---------- world setup ---------- */
  const COMPOSE_YAML = `name: splice-validator

services:
  postgres-splice:
    image: "postgres:\${POSTGRES_VERSION}"
    environment:
      - POSTGRES_USER=cnadmin
      - POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password
    volumes:
      - postgres-splice:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cnadmin"]
      interval: 10s
    restart: always

  participant:
    image: "\${IMAGE_REPO}canton-participant:\${IMAGE_TAG}"
    environment:
      - CANTON_PARTICIPANT_POSTGRES_SERVER=postgres-splice
      - CANTON_PARTICIPANT_POSTGRES_DB=participant-\${MIGRATION_ID}
    depends_on:
      postgres-splice:
        condition: service_healthy
    restart: always

  validator:
    image: "\${IMAGE_REPO}validator-app:\${IMAGE_TAG}"
    environment:
      - MIGRATION_ID=\${MIGRATION_ID}
      - PARTY_HINT=\${PARTY_HINT}
      - SPLICE_APP_VALIDATOR_SV_SPONSOR_ADDRESS=\${SPONSOR_SV_ADDRESS}
      - SPLICE_APP_VALIDATOR_SCAN_ADDRESS=\${SCAN_ADDRESS}
      - TARGET_TRAFFIC_THROUGHPUT=\${TARGET_TRAFFIC_THROUGHPUT}
      - MIN_TOPUP_INTERVAL=\${MIN_TOPUP_INTERVAL}
      - |
        ADDITIONAL_CONFIG_TOPUP=canton.validator-apps.validator_backend.domains.global.buy-extra-traffic {
          target-throughput = \${TARGET_TRAFFIC_THROUGHPUT}
          min-topup-interval = \${MIN_TOPUP_INTERVAL}
        }
    depends_on:
      participant:
        condition: service_healthy
    restart: always

  wallet-web-ui:
    image: "\${IMAGE_REPO}wallet-web-ui:\${IMAGE_TAG}"
    restart: always

  ans-web-ui:
    image: "\${IMAGE_REPO}ans-web-ui:\${IMAGE_TAG}"
    restart: always

  nginx:
    image: "nginx:1.27.3"
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - validator
      - wallet-web-ui
      - ans-web-ui
    restart: always

volumes:
  postgres-splice:
`;
  function envFile(cfg) {
    return `# Splice validator: docker compose settings
IMAGE_REPO=${REPO}
IMAGE_TAG=${cfg.tag || '0.8.2'}
POSTGRES_VERSION=14
MIGRATION_ID=4
PARTY_HINT=validator-01
SPONSOR_SV_ADDRESS=https://sv.sv-3.example
SCAN_ADDRESS=https://scan.sv-3.example

# Automated traffic top-ups: bytes per second of throughput to buy traffic for.
# 0 disables automated top-ups.${cfg.topupNote ? '\n' + cfg.topupNote : ''}
TARGET_TRAFFIC_THROUGHPUT=${cfg.target ?? 2000}
MIN_TOPUP_INTERVAL=1m
`;
  }
  function makeNode(w, cfg) {
    const n = S.makeHost({
      id: 'canton-01', moniker: 'canton-01', hostname: 'canton-01', instanceId: 'i-0c4a7e19d2b3f5a68', region: 'us-east-1', ip: '203.0.113.41', kind: 'node', homeUser: 'ubuntu',
      mem: { total: 64 * 1024, used: 23 * 1024 }, disk: { size: cfg.diskGB || 250, dev: '/dev/nvme0n1p1' }, cpus: 16, load: [1.21, 1.34, 1.29], upBase: 86400 * 40, bootAt: 0,
    });
    // df reads host.disk.used; keep it live so a freed file shows up at once
    Object.defineProperty(n.disk, 'used', { get: () => Math.min(n.disk.size, Math.round(diskUsed(n))), enumerable: true });
    const tag = cfg.tag || '0.8.2';
    const cn = n.cn = {
      ctrs: {}, logs: {}, images: [], vol: { gb: cfg.pgGB ?? 41.6, fresh: false }, osGB: 13.7, auxGB: 3.1, dbVersion: tag, party: PARTY, identityLost: false, pgCorrupt: false,
      lag: cfg.lag ?? 1.4, ourRound: 0, lastRound: 0, missed: 0, recorded: 0, remainder: cfg.remainder ?? 268000, purchased: 48120000, wallet: cfg.wallet ?? 2180, spent: 0, consume: cfg.consume ?? 15,
      pending: [], requests: {}, nextTopup: 0, nextTopupNote: 0, nextTrafficErr: 0, nextPkgErr: 0, nextFullLog: 0, nextPanic: 0, nextCatchLog: 0, vDown: 0, minRem: Infinity,
      daemon: null, watch: { last: -1e9, next: cfg.watchPhase ?? 300, needed: 0, health: 1, quorum: null, local: null }, watchLog: [], seq0: 81234567,
    };
    cn.purchased += cn.remainder;
    n.services.docker = { name: 'docker', desc: 'Docker Application Container Engine', unitPath: '/usr/lib/systemd/system/docker.service', state: 'active', since: -86400 * 40, pid: 1187, exec: '/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock', memStr: () => '612.4M', tasks: 48 };
    n.services.containerd = { name: 'containerd', desc: 'containerd container runtime', unitPath: '/usr/lib/systemd/system/containerd.service', state: 'active', since: -86400 * 40, pid: 1102, exec: '/usr/bin/containerd' };
    n.services['canton-collector'] = { name: 'canton-collector', desc: 'Canton Metrics Collector', unitPath: '/etc/systemd/system/canton-collector.service', state: 'active', since: -86400 * 40, pid: 1630, exec: '/bin/bash /opt/canton-collector/collector.sh' };
    n.services['grafana-agent'] = { name: 'grafana-agent', desc: 'Monitoring system and forwarder', unitPath: '/usr/lib/systemd/system/grafana-agent.service', state: 'active', since: -86400 * 40, pid: 1642, exec: '/usr/bin/grafana-agent --config.file /etc/grafana-agent.yaml' };
    n.services.node_exporter = { name: 'node_exporter', desc: 'Node Exporter', unitPath: '/etc/systemd/system/node_exporter.service', state: 'active', since: -86400 * 40, pid: 1655, exec: '/usr/local/bin/node_exporter --web.listen-address=:9100 --collector.textfile.directory=/var/lib/node_exporter/textfile_collector' };
    n.services['splice-version-watcher'] = { name: 'splice-version-watcher', desc: 'Splice version watcher (runs every 15 min from splice-version-watcher.timer)', unitPath: '/etc/systemd/system/splice-version-watcher.service', state: 'inactive', since: -300, pid: 0, exec: '/usr/local/bin/splice-version-watcher.sh' };
    n.services['amazon-ssm-agent'] = { name: 'amazon-ssm-agent', desc: 'amazon-ssm-agent', unitPath: '/etc/systemd/system/amazon-ssm-agent.service', state: 'active', since: -86400 * 40, pid: 812, exec: '/usr/bin/amazon-ssm-agent' };
    // files
    S.fsWrite(n, COMPOSEP, COMPOSE_YAML);
    S.fsWrite(n, ENVP, envFile(cfg));
    S.fsWrite(n, DIR + '/nginx.conf', 'events {}\nhttp {\n  server { listen 80; server_name wallet.localhost;\n    location /api/validator { proxy_pass http://validator:5003/api/validator; }\n    location / { proxy_pass http://wallet-web-ui:8080/; }\n  }\n  server { listen 80; server_name ans.localhost;\n    location /api/validator { proxy_pass http://validator:5003/api/validator; }\n    location / { proxy_pass http://ans-web-ui:8080/; }\n  }\n}\n');
    S.fsWrite(n, DIR + '/start.sh', '#!/bin/bash\n# Starts the validator with the settings in .env (docker compose up -d).\nset -euo pipefail\ncd "$(dirname "$0")"\ndocker compose up -d\n', { mode: '755' });
    S.fsWrite(n, DIR + '/stop.sh', '#!/bin/bash\n# Stops the validator (docker compose down).\n#   -D  also delete the database volume: ALL participant and validator data, including the node identity.\nset -euo pipefail\ncd "$(dirname "$0")"\nif [[ "${1:-}" == "-D" ]]; then docker compose down -v; else docker compose down; fi\n', { mode: '755' });
    S.fsWrite(n, '/root/operator.jwt', TOKEN + '\n', { mode: '600', owner: 'root' });
    S.fsWrite(n, DAEMON, cfg.daemonJson ?? '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "100m", "max-file": "3" }\n}\n');
    try { cn.daemon = JSON.parse(S.fsRead(w, n, DAEMON)); } catch (e) { cn.daemon = {}; }
    S.fsWrite(n, VOLP + '/_data/PG_VERSION', '14\n', { mode: '600', owner: 'root' });
    S.fsWrite(n, VOLP + '/_data/postgresql.conf', "listen_addresses = '*'\nmax_connections = 300\nshared_buffers = 4GB\n", { mode: '600', owner: 'root' });
    S.fsWrite(n, VOLP + '/_data/global/pg_control', '(binary)', { mode: '600', owner: 'root', size: 8192 });
    S.fsWrite(n, VOLP + '/_data/base/16384/41877', '(relation data)', { mode: '600', owner: 'root', size: 1073741824 });
    S.fsWrite(n, VOLP + '/_data/pg_wal/00000001000000A2000000C7', '(wal segment)', { mode: '600', owner: 'root', size: 16777216 });
    S.fsWrite(n, '/var/lib/docker/volumes/ledger-indexer_data/_data/indexer.db', '(sqlite)', { owner: 'root', size: 3328599654 });
    ['/var/lib/docker/overlay2', '/var/lib/docker/image', '/var/lib/docker/network', '/var/lib/docker/buildkit', '/usr', '/snap', '/boot', '/var/cache', '/var/log', '/var/lib/apt', '/var/lib/snapd', '/home/ubuntu', '/home/ssm-user', '/tmp', '/root', '/etc'].forEach(d => n.dirs.add(d));
    S.fsWrite(n, '/dev/null', '');
    S.fsWrite(n, '/opt/canton-collector/collector.sh', '#!/bin/bash\n# Canton metrics collector: container health from docker inspect, chain-tip sync from\n# http://127.0.0.1:8100/api/sync (scan-proxy) and http://127.0.0.1:8090/status (ledger-indexer).\n# Serves Prometheus text on :9101 for grafana-agent.\n', { mode: '755' });
    S.fsWrite(n, '/etc/systemd/system/canton-collector.service', '[Unit]\nDescription=Canton Metrics Collector\nAfter=network-online.target docker.service\n\n[Service]\nEnvironment="LISTEN_PORT=9101"\nEnvironment="SYNC_URL=http://127.0.0.1:8100/api/sync"\nEnvironment="STATUS_URL=http://127.0.0.1:8090/status"\nExecStart=/opt/canton-collector/collector.sh\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n');
    S.fsWrite(n, '/etc/systemd/system/splice-version-watcher.service', '[Unit]\nDescription=Splice version watcher\n\n[Service]\nType=oneshot\nExecStart=/usr/local/bin/splice-version-watcher.sh\n');
    S.fsWrite(n, '/etc/systemd/system/splice-version-watcher.timer', '[Unit]\nDescription=Run the Splice version watcher every 15 minutes\n\n[Timer]\nOnCalendar=*:0/15\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n');
    S.fsWrite(n, '/usr/local/bin/splice-version-watcher.sh', '#!/bin/bash\n# 1. list SV scans: GET https://scan.sv-3.example/api/scan/v0/scans\n# 2. GET <scan>/api/scan/version on every scan\n# 3. quorum = highest version reported by >= 2/3 of the scans\n# 4. local = image tag of the running splice-validator-validator-1 container\n# 5. write canton_splice_* metrics to /var/lib/node_exporter/textfile_collector/splice_version.prom\n', { mode: '755' });
    S.fsWrite(n, '/var/log/splice-version-watcher.log', (w2, h) => h.cn.watchLog.join('\n') + '\n');
    S.fsWrite(n, '/var/lib/node_exporter/textfile_collector/splice_version.prom', (w2, h) => {
      const x = h.cn.watch;
      return `# HELP canton_splice_upgrade_needed 1 when the 2/3 SV quorum version is ahead of the running validator\ncanton_splice_upgrade_needed{chain="canton",local_version="${x.local || ''}",quorum_version="${x.quorum || ''}"} ${x.needed}\ncanton_splice_quorum_svs{chain="canton",version="${x.quorum || ''}"} ${x.at || 0}\ncanton_splice_svs_total{chain="canton"} ${x.total || 0}\ncanton_splice_watcher_health{chain="canton"} ${x.health}\ncanton_splice_watcher_last_run_timestamp_seconds{chain="canton"} ${Math.floor(w2.base / 1000 + x.last)}\n`;
    });
    // images
    const ageTag = cfg.tagAge ?? 86400 * 21;
    (cfg.oldTags || []).forEach((t, k) => SPECS.filter(s => s.splice).forEach(s => addImage(w, n, s.img({ IMAGE_REPO: REPO, IMAGE_TAG: t }), s.gb + 0.04 * k, ageTag + 86400 * 30 * (cfg.oldTags.length - k))));
    const env0 = readEnv(w, n);
    SPECS.forEach(s => addImage(w, n, s.img(env0), s.gb, s.splice ? ageTag : 86400 * 90));
    (cfg.prepulled || []).forEach(t => SPECS.filter(s => s.splice).forEach(s => addImage(w, n, s.img({ IMAGE_REPO: REPO, IMAGE_TAG: t }), s.gb, 3600)));
    AUX.forEach(a => addImage(w, n, a.image, a.gb, 86400 * 60));
    // containers, running for a while
    const since = -(cfg.upFor ?? ageTag);
    SPECS.forEach(s => {
      const d = desired(env0, s);
      const rec = createCtr(w, n, s, d.image, d.env, { created: since, logGB: s.svc === 'participant' ? (cfg.partLogGB ?? 0.28) : s.svc === 'validator' ? 0.12 : 0.002 });
      const save = w.t; w.t = since; startCtr(w, n, rec); rec.health = 'healthy'; w.t = save;
    });
    AUX.forEach(a => { const rec = createCtr(w, n, a, a.image, {}, { created: -86400 * 60, logGB: 0.01 }); const save = w.t; w.t = -86400 * 60; startCtr(w, n, rec); rec.health = 'healthy'; w.t = save; });
    // the node's recent history
    const r0 = netRound(w);
    cn.lastRound = r0; cn.ourRound = r0 - (cfg.behindRounds || 0);
    const at = (t, fn) => { const save = w.t; w.t = t; fn(); w.t = save; };
    const p = bySvc(n, 'participant'), v = bySvc(n, 'validator');
    at(since + 80, () => { clog(w, n, p, 'INFO', LOGGER.boot, `Participant ${PARTICIPANT.slice(0, 32)}… initialised`); clog(w, n, p, 'INFO', LOGGER.sync, `Connected to synchronizer ${DOMAIN} through 13 SV sequencers (read threshold 5)`); });
    at(since + 130, () => { clog(w, n, v, 'INFO', LOGGER.app, `Validator app is ready; validator party ${PARTY}`); });
    const okUntil = cfg.stalledFor ? -cfg.stalledFor : 0;
    for (let k = 5; k >= 1; k--) {
      const t = okUntil - k * ROUND + 40;
      if (t > since + 200) at(t, () => clog(w, n, v, 'INFO', LOGGER.coupon, `Recorded validator liveness activity for round ${cn.ourRound - k + 1}`));
    }
    if (cfg.stalledFor) {
      for (let k = 0; k < 6; k++) at(okUntil + k * 4000 + 30, () => {
        pglog(w, n, 'ERROR', 'ERROR', `could not extend file "base/16384/41877.12": No space left on device`);
        clog(w, n, p, 'WARN', LOGGER.db, 'DB operation insertSequencedEvents failed, retrying in 10s: org.postgresql.util.PSQLException: ERROR: could not extend file "base/16384/41877.12": No space left on device');
      });
    }
    if (cfg.fillDisk) { const L = cn.logs[p.id]; L.gb = 0; L.gb = Math.max(0.5, n.disk.size - diskUsed(n) + 0.004); }
    cn.full = diskUsed(n) >= n.disk.size - 0.01;
    S.log(w, n, 'docker', 'INFO', 'level=info msg="API listen on /run/docker.sock"');
    runWatcher(w, n);
    cn.quorumAtStart = quorum(w);
    // processes and sockets
    n.procs = () => dockerUp(n) ? [{ user: 'root', pid: 1187, cpu: '1.2', mem: '0.9', cmd: '/usr/bin/dockerd -H fd://' }].concat(ctrList(n).filter(running).filter(r => r.spec.splice || r.svc === 'postgres-splice').map(r => ({ user: r.svc === 'postgres-splice' ? '999' : 'root', pid: 3000 + parseInt(r.id.slice(0, 3), 16), cpu: r.svc === 'participant' ? '38.4' : r.svc === 'validator' ? '21.7' : '2.1', mem: r.svc === 'participant' ? '9.8' : r.svc === 'validator' ? '6.1' : '3.4', cmd: r.svc === 'postgres-splice' ? 'postgres' : r.svc === 'participant' ? 'java -jar /app/canton.jar daemon --config /app/participant.conf' : r.svc === 'validator' ? 'java -jar /app/splice-node.jar --config /app/validator.conf' : 'nginx: master process' }))) : [];
    n.listening = () => (dockerUp(n) ? [{ addr: '0.0.0.0:80', proc: 'docker-proxy', pid: 2210 }, { addr: '127.0.0.1:8090', proc: 'docker-proxy', pid: 2231 }, { addr: '127.0.0.1:8100', proc: 'docker-proxy', pid: 2244 }] : []).concat([{ addr: '*:9100', proc: 'node_exporter', pid: 1655 }, { addr: '*:9101', proc: 'python3', pid: 1631 }]);
    return n;
  }

  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#0f7f86"/><text x="16" y="20.5" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff">C</text></svg>';

  S.registerNetwork({
    id: 'canton', name: 'Canton', color: '#3fd0c9', logo: LOGO,
    desc: LL('Splice 验证者节点：docker compose 下的 participant、验证者应用与 postgres，mining round 与活动记录，按字节计费的 traffic，以及跟随 SV 法定多数的版本升级。', 'Splice validator nodes: the participant, validator app and postgres under docker compose, mining rounds and activity records, traffic billed by the byte, and upgrades that follow the SV quorum.'),
    init(w, cfg) {
      w.chain = {
        round0: cfg.round0 ?? 48211, phase: cfg.roundPhase ?? 420, migrationId: 4,
        svs: (cfg.svs || Array(13).fill(cfg.tag || '0.8.2')).map((v, i) => ({ name: `sv-${i + 1}`, v })),
        svPlan: (cfg.svPlan || []).map(([at, i, v]) => ({ at, i, v })),
        switchAt: cfg.switchAt ?? null, required: cfg.required || null,
        released: cfg.released || ['0.8.0', '0.8.1', '0.8.2'], latest: cfg.latest || (cfg.released ? cfg.released[cfg.released.length - 1] : '0.8.2'),
      };
      w.nodes['canton-01'] = makeNode(w, cfg);
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(
        `# canton-01（Splice 验证者，MainNet）\n- 登录：ssm canton-01，然后 sudo -i\n- compose 目录：${DIR}\n- 验证者 party：用 wallet API 的 /v0/validator-user 查询\n- participant：${PARTICIPANT}\n- synchronizer：${DOMAIN}\n- 上线担保 SV：sv-3，party ${SPONSOR}\n- 合作方验证者（上月用本钱包代付过 traffic）：${PARTNER}\n- wallet API：节点上的 http://wallet.localhost/api/validator，token 在 /root/operator.jwt\n- 同步状态：curl -s 127.0.0.1:8100/api/sync（scan-proxy）· curl -s 127.0.0.1:8090/status（ledger-indexer）\n- 版本监视：/var/log/splice-version-watcher.log\n`,
        `# canton-01 (Splice validator, MainNet)\n- log in: ssm canton-01, then sudo -i\n- compose directory: ${DIR}\n- validator party: ask the wallet API, /v0/validator-user\n- participant: ${PARTICIPANT}\n- synchronizer: ${DOMAIN}\n- onboarding sponsor SV: sv-3, party ${SPONSOR}\n- partner validator (this wallet paid its traffic last month): ${PARTNER}\n- wallet API: http://wallet.localhost/api/validator on the node; token in /root/operator.jwt\n- sync status: curl -s 127.0.0.1:8100/api/sync (scan-proxy) · curl -s 127.0.0.1:8090/status (ledger-indexer)\n- version watcher: /var/log/splice-version-watcher.log\n`));
    },
    tick, http, rules, nodeCommands, laptopCommands, panel,
    serviceAction(w, h, s, action) {
      if (!h.cn) { s.state = action === 'stop' ? 'inactive' : 'active'; s.since = w.t; return; }
      if (s.name === 'docker') {
        if (action === 'stop') dockerStop(w, h);
        else if (action === 'start') { if (!dockerUp(h)) dockerStart(w, h); }
        else { dockerStop(w, h); dockerStart(w, h); }
        return;
      }
      if (s.name === 'splice-version-watcher') { if (action !== 'stop') runWatcher(w, h); s.state = 'inactive'; s.since = w.t; return; }
      if (action === 'stop') { s.state = 'inactive'; s.since = w.t; }
      else { s.state = 'active'; s.since = w.t; s.pid = 1600 + Math.floor(w.rand() * 300); }
    },
    onRemoved(w, h, p) {
      if (!h.cn) return;
      const cn = h.cn;
      // anything inside (or above) the postgres volume
      if ((p === VOLP || p.startsWith(VOLP + '/') || (VOLP + '/').startsWith(p + '/')) && cn.vol) {
        const intact = ['/_data/PG_VERSION', '/_data/global/pg_control', '/_data/base/16384/41877', '/_data/pg_wal/00000001000000A2000000C7'].every(f => S.fsGet(h, VOLP + f));
        if (!intact) {
          S.flag(w, 'wipe_db');
          cn.pgCorrupt = true;
          if (!S.fsGet(h, VOLP + '/_data/base/16384/41877')) cn.vol.gb = Math.min(cn.vol.gb, 1.2);
          S.event(w, 'bad', LL('postgres 卷里的文件被删除了。数据库已经损坏，participant 的身份和账本数据无法从这台机器恢复。', 'Files inside the postgres volume were deleted. The database is corrupt, and the participant\'s identity and ledger data cannot be recovered from this machine.'));
        }
      }
      // container logs: a deleted log stays allocated while the container holds it open
      Object.values(cn.ctrs).forEach(rec => {
        if (S.fsGet(h, logPath(rec.id))) return;
        const L = cn.logs[rec.id];
        if (!L || L.unlinked || L.gone) return;
        if (rec.state === 'running' && L.gb > 0.5) {
          L.unlinked = true;
          S.lesson(w, 'unlinked', LL('删掉的文件还占着空间', 'A deleted file still takes space'), LL('容器运行时，dockerd 一直打开着它的日志文件。rm 只删掉了目录项，数据块要等文件句柄关闭（容器停止或重建）才会释放，所以 df 看不到变化，du 却找不到这个文件。清空正在写入的日志要用 truncate -s 0。', 'While a container runs, dockerd keeps its log file open. rm only removes the directory entry; the blocks are freed when the handle closes, when the container stops or is recreated. df shows no change, and du can no longer find the file. To empty a log that is being written, use truncate -s 0.'));
        } else { L.gb = 0; L.gone = true; }
      });
    },
    helpers: {
      DOMAIN, PARTY, SPONSOR, PARTNER, PARTICIPANT, DIR, RED_LINE,
      node: w => w.nodes['canton-01'],
      round: netRound, behind, synced, quorum, versionOk, diskPct, localTag,
      remainder: w => w.nodes['canton-01'].cn.remainder,
      topupOn: w => topupTarget(bySvc(w.nodes['canton-01'], 'validator')) > 0 && healthy(bySvc(w.nodes['canton-01'], 'validator')),
      current: w => { const n = w.nodes['canton-01']; return n.cn.ourRound === netRound(w); },
      allHealthy: w => { const n = w.nodes['canton-01']; return dockerUp(n) && projectCtrs(n).length === SPECS.length && projectCtrs(n).every(healthy); },
      runs: (w, v) => { const n = w.nodes['canton-01']; return ['participant', 'validator'].every(s => { const r = bySvc(n, s); return running(r) && tagOf(r.image) === v; }); },
      logLimited: w => { const r = bySvc(w.nodes['canton-01'], 'participant'); return !!(r && running(r) && r.logOpts['max-size']); },
      identityOk: w => { const n = w.nodes['canton-01']; return !n.cn.identityLost && !n.cn.pgCorrupt && !!n.cn.vol; },
    },
  });
})(SIM);
