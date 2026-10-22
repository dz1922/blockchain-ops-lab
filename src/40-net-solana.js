/* ============================================================
   Network plugin: Solana (Agave validator, Alpenglow cluster)
   Mechanisms modelled:
   - 200 ms slots, 432,000-slot epochs (about one day), 4-slot leader windows
   - Votor: votes are messages, not transactions; each slot is finalised by
     stake-weighted certificates (fast ≥80%, slow 60% + 60%, skip ≥60%)
   - an offline leader's window collapses into skip certificates → skip rate
   - Validator Admission Ticket: when the bank crosses into epoch N, the set for
     N+1 is chosen and 0.8 SOL is debited from each admitted vote account;
     short of ticket + rent, or without a BLS key, the validator sits out N+1
   - lastVote vs tip; delinquent when more than 128 slots behind
   - one identity, one voter: a second machine with the staked key = equivocation
   - vote_history-<IDENTITY>.bin and set-identity, which requires it by default
   ============================================================ */
(function (S) {
  'use strict';
  const C = S.C;
  const SLOTS_PER_SEC = 5, EPOCH = 432000, EPOCH_SEC = EPOCH / SLOTS_PER_SEC;
  const TICKET = 0.8, RENT_VOTE = 0.02685864, ADMIT = TICKET + RENT_VOTE, TX_FEE = 0.000005;
  const VOTE_FLOOR = 5, ID_FLOOR = 9, DELINQ = 128, VERSION = '4.3.2';
  const LEDGER = '/mnt/ledger';

  function keyContent(pk) {
    let h = 0; for (const ch of pk) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const r = S.rng(h); return '[' + Array.from({ length: 64 }, () => Math.floor(r() * 256)).join(',') + ']';
  }
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  // the BLS public key derived from an authorized voter keypair (48 bytes, shown in base58)
  function blsOf(pk) {
    let h = 7; for (const ch of String(pk)) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    const r = S.rng(h); return Array.from({ length: 66 }, () => B58[Math.floor(r() * 58)]).join('');
  }
  const pubkeyOf = (w, content) => w.chain.keyfiles[String(content || '').trim()] || null;
  const slot = w => Math.floor(w.chain.slot0 + w.t * SLOTS_PER_SEC);
  const epoch = w => Math.floor(slot(w) / EPOCH);
  const slotIndex = w => slot(w) % EPOCH;
  const toBoundary = w => (EPOCH - slotIndex(w)) / SLOTS_PER_SEC;
  const bal = (w, pk, cluster = 'testnet') => cluster === 'testnet' ? (w.chain.bal[pk] ?? 0) : (w.chain.mainnetBal[pk] ?? 0);
  const voteBal = w => (w.chain.vote ? bal(w, w.chain.vote) : 0);
  const sv = n => n.sol;
  const svc = n => n.services['agave-validator'];
  const runningIdentity = (w, n) => svc(n).state === 'active' ? sv(n).identity : null;
  const inSet = (w, e = epoch(w)) => w.chain.admitted[e] === true;
  // fresh install (guided lab): the node must also run with the vote account that exists on chain
  const isVoting = (w, n) => svc(n).state === 'active' && (!sv(n).phase || sv(n).phase === 'run') && sv(n).catchup <= 0 && sv(n).identity === w.chain.identity && !!w.chain.identity && !w.chain.conflict && inSet(w) && (!w.chain.fresh || (!!w.chain.vote && sv(n).vote === w.chain.vote));
  const behind = w => Math.max(0, slot(w) - w.chain.lastVote);
  const quiet = w => w.chain.fresh && !w.chain.everVoted; // a validator that has never voted is not delinquent, it is not there yet
  const delinquent = w => !quiet(w) && behind(w) > DELINQ;
  const median = w => 16 * 0.97 * (w.chain.creditsFrom != null ? Math.max(1, slot(w) - w.chain.creditsFrom) : Math.max(1, slotIndex(w)));
  const ratio = w => w.chain.credits / Math.max(1, median(w));
  const skipRate = w => (w.chain.leaderSlots ? w.chain.skippedSlots / w.chain.leaderSlots * 100 : 0);
  // admission for epoch e is decided when the bank crosses into e-1; reasons follow validatorAdmissionTicketStatus
  const admitReason = w => !w.chain.vote ? 'vote account not found' : !w.chain.bls ? 'no BLS pubkey' : voteBal(w) < ADMIT ? 'insufficient funds' : null;

  // this validator's leader windows (4 slots) start every 900 s of simulated time, at 300 + k·900
  const WIN0 = 300, WINP = 900;
  const winSlot = (w, t) => Math.floor((w.chain.slot0 + t * SLOTS_PER_SEC) / 4) * 4;
  // cluster-wide Votor outcome for a slot: deterministic, mostly fast-finalised
  function hash(a) { let h = Math.imul(a ^ 0x9e3779b9, 2654435761) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function certOf(w, s) {
    const lw = w.chain.lastWindow;
    if (lw && s >= lw.slot && s < lw.slot + 4) return lw.skipped ? 'skip' : 'fast';
    const r = hash(Math.floor(s / 4) * 7919 + (s % 4));
    if (hash(Math.floor(s / 4)) < 0.006) return 'skip'; // some other leader was offline: its window becomes skip certificates
    return r < 0.06 ? 'slow' : 'fast';
  }

  function log(w, n, lvl, msg) { S.log(w, n, 'agave-validator', lvl, `[${S.isoTime(w.now())} ${lvl.padEnd(5)} solana_core::${msg}`); }
  function logm(w, n, lvl, mod, msg) { S.log(w, n, 'agave-validator', lvl, `[${S.isoTime(w.now())} ${lvl.padEnd(5)} ${mod}] ${msg}`); }
  const UNIT = '/etc/systemd/system/agave-validator.service';
  const vhPath = pk => `${LEDGER}/vote_history-${pk}.bin`;
  const vhBody = (pk, s) => `(binary vote history) node_pubkey=${pk} last_vote_slot=${s}\n`;
  const unitIdentity = (w, n) => { const m = /--identity\s+(\S+)/.exec(S.fsRead(w, n, UNIT) || ''); return m ? pubkeyOf(w, S.fsRead(w, n, m[1])) : null; };
  const SNAP_RE = /^(?:incremental-)?snapshot-(?:\d+-)?(\d+)-[A-Za-z]\w*\.tar\.zst$/;
  const SNAP_BYTES = 22977616281;
  const MAX_SNAP_AGE = 2500; // --maximum-local-snapshot-age, in slots: about 8 minutes at 200 ms
  const GAIN = 25, LOSS = -1.8; // net slots per second while replaying, and while depending on repair
  function localSnapshot(n) {
    let best = null;
    S.fsList(n, LEDGER).forEach(f => { const m = SNAP_RE.exec(f); if (m && (best === null || +m[1] > best)) best = +m[1]; });
    return best;
  }
  function vhMissingOnStart(w, n, pk) {
    if (pk !== w.chain.identity) return;
    logm(w, n, 'WARN', 'solana_core::consensus', `Vote history for ${pk} not found at ${vhPath(pk)}; starting with an empty vote history`);
  }
  function start(w, n) {
    if (w.chain.fresh) return startFresh(w, n);
    const s = svc(n), x = sv(n), ch = w.chain;
    const unit = S.fsRead(w, n, UNIT) || '';
    const m = /--identity\s+(\S+)/.exec(unit);
    const kp = m ? S.fsRead(w, n, m[1]) : null;
    const pk = pubkeyOf(w, kp);
    s.pid = 2000 + Math.floor(w.rand() * 30000); s.since = w.t;
    if (!pk) { log(w, n, 'ERROR', `validator] Failed to read identity keypair ${m ? m[1] : '(none)'}`); s.state = 'failed'; return; }
    x.identity = pk; s.state = 'active'; x.phase = null; x.gain = GAIN;
    const down = x.stoppedAt != null ? w.t - x.stoppedAt : 0;
    log(w, n, 'INFO', `validator] Starting validator with: identity ${pk}, vote account ${w.chain.vote}`);
    if (!S.fsGet(n, vhPath(pk))) vhMissingOnStart(w, n, pk);
    if (!ch.snapshots) {
      x.catchup = 1200 + down * SLOTS_PER_SEC;
      log(w, n, 'INFO', `validator] loading snapshot; then catching up ${Math.round(x.catchup)} slots`);
      return;
    }
    const local = localSnapshot(n), remote = slot(w) - 760;
    if (/--no-snapshot-fetch/.test(unit)) {
      if (local === null) {
        logm(w, n, 'ERROR', 'solana_ledger::bank_forks_utils', `No snapshot archives found in ${LEDGER} and --no-snapshot-fetch was given. Unable to load a bank.`);
        s.state = 'failed'; s.exitStatus = 1;
        S.log(w, n, 'agave-validator', 'SYS', 'agave-validator.service: Main process exited, code=exited, status=1/FAILURE');
        return;
      }
      logm(w, n, 'INFO', 'agave_validator::bootstrap', `--no-snapshot-fetch: not searching for a newer snapshot; using the local snapshot at slot ${local}`);
      x.phase = 'load'; x.phaseUntil = w.t + 240; x.snapSlot = local;
    } else if (local !== null && remote - local <= MAX_SNAP_AGE) {
      logm(w, n, 'INFO', 'agave_validator::bootstrap', `Local snapshot at slot ${local} is within --maximum-local-snapshot-age (${MAX_SNAP_AGE}) of the newest known snapshot (${remote}); using it`);
      x.phase = 'load'; x.phaseUntil = w.t + 240; x.snapSlot = local;
    } else {
      logm(w, n, 'INFO', 'agave_validator::bootstrap', `Searching for an RPC service with a snapshot from a known validator (--known-validator x2, --only-known-rpc)`);
      logm(w, n, 'INFO', 'agave_validator::bootstrap', `Highest local snapshot slot: ${local ?? 'none'}. Highest snapshot from known validators: ${remote}. Local snapshot is older than --maximum-local-snapshot-age (${MAX_SNAP_AGE} slots); downloading`);
      x.phase = 'download'; x.phaseUntil = w.t + 150; x.snapSlot = remote; x.dlStart = w.t;
    }
  }
  function stop(w, n) { const s = svc(n); if (s.state === 'active') log(w, n, 'INFO', 'validator] exit requested — shutting down'); s.state = 'inactive'; s.since = w.t; sv(n).stoppedAt = w.t; sv(n).phase = null; }
  function phaseTick(w, n, dt) {
    const x = sv(n);
    if (x.phase === 'download') {
      const pct = Math.min(100, Math.round((w.t - x.dlStart) / 150 * 100));
      if (Math.floor(w.t) % 30 < dt && w.t < x.phaseUntil) logm(w, n, 'INFO', 'solana_file_download', `downloading http://198.51.100.77:8899/snapshot.tar.zst: ${pct}% (${(SNAP_BYTES / 1073741824 * pct / 100).toFixed(1)} GiB of 21.4 GiB, 152.3 MiB/s)`);
      if (w.t >= x.phaseUntil) {
        const f = `snapshot-${x.snapSlot}-9Rf3kTqZbW2xLmN8vYc5HdP1sGa4JeU7oKt6Bw3Xy2Q.tar.zst`;
        S.fsWrite(n, `${LEDGER}/${f}`, '(zstd compressed snapshot archive)', { owner: 'sol', size: SNAP_BYTES });
        logm(w, n, 'INFO', 'agave_validator::bootstrap', `Downloaded full snapshot archive to ${LEDGER}/${f}`);
        // the blockstore opens after the download; that is where a missing LimitNOFILE shows up
        if (w.chain.fresh && x.nofile < 1000000) {
          logm(w, n, 'ERROR', 'solana_ledger::blockstore', `Unable to increase the maximum open file descriptor limit to 1000000 from ${x.nofile}`);
          logm(w, n, 'ERROR', 'agave_validator', 'Failed to start validator: Blockstore error: UnableToSetOpenFileDescriptorLimit');
          return failSvc(w, n, 1);
        }
        x.phase = 'load'; x.phaseUntil = w.t + 210;
      }
    } else if (x.phase === 'load' && w.t >= x.phaseUntil) {
      x.phase = 'run'; x.catchup = Math.max(0, slot(w) - x.snapSlot); x.gain = x.catchup > 100000 ? LOSS : GAIN;
      logm(w, n, 'INFO', 'solana_ledger::bank_forks_utils', `Loaded bank from snapshot at slot ${x.snapSlot}; ${Math.round(x.catchup)} slots behind the cluster`);
      if (x.gain < 0) logm(w, n, 'WARN', 'solana_core::repair_service', `blockstore has no shreds for slots ${x.snapSlot + 1}..; replay depends on repair from peers`);
    }
  }

  function makeNode(w, sp) {
    const n = S.makeHost({ id: sp.id, moniker: sp.id, hostname: sp.hostname, instanceId: sp.instanceId, region: sp.region, ip: sp.ip, kind: 'node', homeUser: 'sol', role: sp.role, mem: { total: 512 * 1024, used: 301 * 1024 }, disk: { size: 3800, used: 1610, dev: '/dev/md1p1' }, cpus: 48, load: [21.4, 20.9, 20.1], upBase: 86400 * 9, bootAt: 0 });
    n.sol = { identity: null, catchup: 0, stoppedAt: null };
    S.fsWrite(n, '/home/sol/validator-keypair.json', keyContent(w.chain.identity), { mode: '600', owner: 'sol' });
    if (sp.unstaked) S.fsWrite(n, '/home/sol/unstaked-identity.json', keyContent(sp.unstaked), { mode: '600', owner: 'sol' });
    const known = w.chain.snapshots ? `  --known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \\\n  --known-validator dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92 \\\n  --only-known-rpc \\\n` : '';
    S.fsWrite(n, UNIT, `[Unit]\nDescription=Agave Validator (testnet)\nAfter=network-online.target\n\n[Service]\nUser=sol\nLimitNOFILE=1000000\nExecStart=/home/sol/.local/share/solana/install/active_release/bin/agave-validator \\\n  --identity ${sp.identityPath} \\\n  --vote-account ${w.chain.vote} \\\n${known}  --ledger ${LEDGER}${sp.noFetch ? ' --no-snapshot-fetch' : ''} --rpc-port 8899 --dynamic-port-range 8000-8020 \\\n  --entrypoint entrypoint.testnet.solana.com:8001 --expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\\n  --limit-ledger-size --log -\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n`);
    S.fsWrite(n, '/home/sol/.config/solana/cli/config.yml', '---\njson_rpc_url: http://localhost:8899\nkeypair_path: /home/sol/validator-keypair.json\ncommitment: confirmed\n', { owner: 'sol' });
    if (sp.stakedHistory !== false) S.fsWrite(n, vhPath(w.chain.identity), vhBody(w.chain.identity, w.chain.slot0 - 1), { owner: 'sol' });
    if (sp.unstakedHistory) S.fsWrite(n, vhPath(sp.unstaked), vhBody(sp.unstaked, w.chain.slot0 - 1), { owner: 'sol' });
    ['rocksdb/CURRENT', 'rocksdb/MANIFEST-018233', 'rocksdb/OPTIONS-018231', 'accounts/run/.keep', 'genesis.bin', 'admin.rpc'].forEach(f => S.fsWrite(n, `${LEDGER}/${f}`, '(binary)', { owner: 'sol' }));
    n.dirs.add('/tmp'); n.dirs.add('/root'); n.dirs.add('/home/ssm-user');
    n.services['agave-validator'] = { name: 'agave-validator', desc: 'Agave Validator (testnet)', unitPath: UNIT, state: 'inactive', since: -86400 * 9, pid: 2231, exec: '/home/sol/.local/share/solana/install/active_release/bin/agave-validator --identity … --ledger /mnt/ledger', memStr: () => '301.2G', tasks: 412 };
    n.services['amazon-ssm-agent'] = { name: 'amazon-ssm-agent', desc: 'amazon-ssm-agent', unitPath: '/etc/systemd/system/amazon-ssm-agent.service', state: 'active', since: -86400 * 9, pid: 812, exec: '/usr/bin/amazon-ssm-agent' };
    n.procs = () => svc(n).state === 'active' ? [{ user: 'sol', pid: svc(n).pid, cpu: '1840', mem: '58.8', cmd: 'agave-validator --identity ' + sp.identityPath + ' --ledger /mnt/ledger' }] : [];
    n.listening = () => svc(n).state === 'active' ? [{ addr: '127.0.0.1:8899', proc: 'agave-validator', pid: svc(n).pid }, { addr: '*:8001', proc: 'agave-validator', pid: svc(n).pid }] : [];
    if (sp.running) { start(w, n); n.sol.catchup = 0; n.sol.phase = null; svc(n).since = -86400 * 9; (n.journal['agave-validator'] || []).forEach(e => { e.t = -86400 * 9; }); }
    return n;
  }

  /* A primary restarted after a long outage with --no-snapshot-fetch: it loaded a two-day-old
     local snapshot and now depends on repair for every missing slot, so it falls further behind. */
  function staleRestart(w, n, o) {
    const ch = w.chain, x = sv(n), s = svc(n), t0 = w.t;
    const downAt = -o.downFor;
    ch.lastVote = Math.floor(ch.slot0 + downAt * SLOTS_PER_SEC);
    const full = Math.floor(ch.lastVote / 25000) * 25000, inc = ch.lastVote - (ch.lastVote % 100) - 100;
    S.fsWrite(n, `${LEDGER}/snapshot-${full}-7HcQ2vWx9TbN4mRk8sYd3LfPa6JeZu5Gq1oBt2Xw9Kp.tar.zst`, '(zstd compressed snapshot archive)', { owner: 'sol', size: 22410137600 });
    S.fsWrite(n, `${LEDGER}/incremental-snapshot-${full}-${inc}-4bTr8kWq2ZxN6mHc9vYd1LsPf3JaGu7Ek5oRt2Qw8Mn.tar.zst`, '(zstd compressed snapshot archive)', { owner: 'sol', size: 1288490188 });
    S.fsWrite(n, vhPath(ch.identity), vhBody(ch.identity, ch.lastVote), { owner: 'sol' });
    w.t = downAt; log(w, n, 'INFO', `vote] voted slot ${ch.lastVote}`); s.state = 'active'; stop(w, n);
    S.log(w, n, 'agave-validator', 'SYS', 'agave-validator.service: Deactivated successfully.');
    w.t = -o.restartedAgo;
    S.log(w, n, 'agave-validator', 'SYS', 'Started agave-validator.service - Agave Validator (testnet).');
    start(w, n);
    w.t = -o.restartedAgo + 240; phaseTick(w, n, 5);
    const tLoad = -o.restartedAgo + 240, us = t => Math.floor(inc + (SLOTS_PER_SEC + LOSS) * (t - tLoad));
    for (let t = tLoad + 30; t < 0; t += 90) {
      w.t = t;
      log(w, n, 'INFO', `replay_stage] catching up: ${slot(w) - us(t)} slots behind`);
      logm(w, n, 'WARN', 'solana_core::repair_service', `repair: slot ${us(t) + 1} still incomplete; requested 1024 shreds from 9 peers, received 0`);
    }
    w.t = t0;
    x.phase = 'run'; x.gain = LOSS; x.catchup = slot(w) - us(0); x.stoppedAt = null;
    s.since = -o.restartedAgo; s.state = 'active';
    return downAt;
  }

  /* ---------- epoch boundary: the admission ticket ---------- */
  function boundary(w, e) {
    const ch = w.chain, span = ch.creditsFrom != null ? Math.max(1, e * EPOCH - ch.creditsFrom) : EPOCH, prevCredits = ch.credits / (16 * 0.97 * span);
    const why = admitReason(w);
    const p = Object.values(w.nodes).find(n => sv(n).identity === ch.identity && svc(n).state === 'active') || Object.values(w.nodes)[0];
    if (!why) {
      ch.bal[ch.vote] -= TICKET; ch.admitted[e + 1] = true; ch.ticketsPaid = (ch.ticketsPaid || 0) + 1;
      S.event(w, 'ok', S.LL(`epoch ${e} 开始。vote account 被扣除 ${TICKET} SOL 准入费，验证者进入 epoch ${e + 1} 的验证者集合。vote account 余额 ${voteBal(w).toFixed(3)} SOL。`, `Epoch ${e} began. The ${TICKET} SOL admission ticket was debited from the vote account, and the validator is in the set for epoch ${e + 1}. Vote account balance: ${voteBal(w).toFixed(3)} SOL.`));
      if (ch.fresh && !ch.firstAdmitted) { ch.firstAdmitted = e + 1; S.flag(w, 'admitted'); }
    } else {
      ch.admitted[e + 1] = false;
      if (ch.vote) {
        const zh = why === 'no BLS pubkey' ? 'vote account 没有登记 BLS 公钥' : why === 'insufficient funds' ? `vote account 余额 ${voteBal(w).toFixed(3)} SOL，不够准入费加免租金额（${ADMIT.toFixed(3)} SOL）` : '找不到 vote account';
        const en = why === 'no BLS pubkey' ? 'the vote account has no BLS public key' : why === 'insufficient funds' ? `the vote account holds ${voteBal(w).toFixed(3)} SOL, less than the ticket plus rent (${ADMIT.toFixed(3)} SOL)` : 'the vote account was not found';
        S.event(w, 'bad', S.LL(`epoch ${e} 开始。${zh}，验证者被排除在 epoch ${e + 1} 之外：整个 epoch 不能投票、不能出块、没有奖励。`, `Epoch ${e} began. ${en[0].toUpperCase() + en.slice(1)}, so the validator is left out of epoch ${e + 1}: no voting, no blocks and no rewards for all of it.`));
        ch.excludedEpoch = ch.excludedEpoch ?? e + 1; ch.excludedWhy = ch.excludedWhy ?? why;
        S.lesson(w, 'vat-out', S.LL('准入在 epoch 边界决定', 'Admission is decided at the epoch boundary'), S.LL(`bank 进入 epoch N 的那一刻，运行时选出 epoch N+1 的验证者集合，并从每个入选的 vote account 扣除准入费。此刻余额不足准入费加免租金额，或者没有 BLS 公钥，验证者就缺席整个 N+1。N 开始之后再充值，最早只能赶上 N+2。所以 vote account 必须在边界之前充好。`, `When the bank crosses into epoch N, the runtime picks the validator set for epoch N+1 and debits the ticket from each admitted vote account. A vote account short of the ticket plus rent at that moment, or without a BLS key, sits out all of N+1. A top-up made after N has started counts only from N+2. Fund the vote account before the boundary.`));
      } else S.event(w, 'sys', S.LL(`epoch ${e} 开始。`, `Epoch ${e} began.`));
      if (p && ch.vote) logm(w, p, 'WARN', 'solana_runtime::bank', `vote account ${ch.vote} not admitted to epoch ${e + 1}: ${why}`);
    }
    if (ch.everVoted || !ch.fresh) S.event(w, 'sys', S.LL(`epoch ${e - 1} 的 credits 与集群中位数之比为 ${prevCredits.toFixed(2)}。`, `Credits ratio for epoch ${e - 1}: ${prevCredits.toFixed(2)} of the cluster median.`));
    if (!inSet(w, e) && inSet(w, e - 1)) {
      S.event(w, 'bad', S.LL(`epoch ${e} 不在验证者集合中：验证者停止投票。`, `Not in the validator set for epoch ${e}: the validator stops voting.`));
      if (p) logm(w, p, 'WARN', 'solana_core::votor', `identity ${ch.identity} is not in the validator set for epoch ${e}; not voting`);
    }
    if (inSet(w, e) && !inSet(w, e - 1) && ch.vote) S.event(w, 'ok', S.LL(`epoch ${e} 开始，验证者进入验证者集合，可以投票了。`, `Epoch ${e} began with the validator in the set. It may vote now.`));
    ch.credits = 0; ch.creditsFrom = null; ch.leaderSlots = 0; ch.skippedSlots = 0;
  }

  function tick(w, dt) {
    const ch = w.chain;
    const mt = ch.maintenance;
    if (mt) {
      const h = w.nodes[mt.host];
      if (!mt.offDone && w.t >= mt.off) {
        mt.offDone = true;
        if (svc(h).state === 'active') stop(w, h);
        S.log(w, h, 'agave-validator', 'SYS', 'System is powering off for scheduled maintenance.');
        h.powered = false;
        S.event(w, 'sys', S.LL(`机房按计划给 <b>${h.id}</b> 所在的机柜断电维护。`, `The data centre powers off the rack holding <b>${h.id}</b> for scheduled maintenance.`));
      }
      if (mt.offDone && !mt.onDone && w.t >= mt.on) {
        mt.onDone = true; h.powered = true; h.bootAt = w.t; h.upBase = 0;
        S.event(w, 'sys', S.LL(`维护结束，<b>${h.id}</b> 重新通电启动。`, `Maintenance is over and <b>${h.id}</b> powers back on.`));
        if (svc(h).enabled !== false) { S.log(w, h, 'agave-validator', 'SYS', 'Started agave-validator.service - Agave Validator (testnet).'); start(w, h); }
      }
    }
    const e = epoch(w);
    while (ch.lastEpoch < e) { ch.lastEpoch++; boundary(w, ch.lastEpoch); }

    Object.values(w.nodes).forEach(n => {
      const x = sv(n), s = svc(n);
      if (s.state === 'active' && x.phase && x.phase !== 'run') { phaseTick(w, n, dt); return; }
      if (s.state === 'active' && x.catchup > 0) {
        x.catchup = Math.max(0, x.catchup - (x.gain ?? GAIN) * dt);
        if (Math.floor(w.t) % 30 < dt) log(w, n, 'INFO', `replay_stage] catching up: ${Math.round(x.catchup)} slots behind`);
        if (x.gain < 0 && Math.floor(w.t) % 90 < dt) logm(w, n, 'WARN', 'solana_core::repair_service', `repair: slot ${slot(w) - Math.round(x.catchup) + 1} still incomplete; requested 1024 shreds from 9 peers, received 0`);
      }
    });
    const voters = Object.values(w.nodes).filter(n => isVoting(w, n));
    const stakedActive = Object.values(w.nodes).filter(n => svc(n).state === 'active' && !!ch.identity && sv(n).identity === ch.identity);
    if (stakedActive.length > 1 && !ch.conflict) {
      S.flag(w, 'double_sign');
      S.lesson(w, 'double', S.LL('一个 identity 只能在一台机器上投票', 'One identity, one voting machine'), S.LL('两台机器同时用质押 identity 运行，会为同一个 slot 签出相互矛盾的投票，这就是双签（equivocation），任何时候都不能发生。备用机平时应使用非质押 identity；切换时先让主节点用 set-identity 换成非质押 identity，把 vote history 文件拷到备用机，再让备用机接管。', 'Two machines running the staked identity sign conflicting votes for the same slots. That is equivocation, and it must never happen. A standby runs an unstaked identity. To fail over, first switch the primary to an unstaked identity with set-identity, copy the vote history file to the standby, and only then let the standby take over.'));
    }
    if (stakedActive.length > 1) ch.conflictUntil = w.t + 1200;
    ch.conflict = w.t < (ch.conflictUntil || -1);
    if (ch.conflict && Math.floor(w.t) % 30 < dt) Object.values(w.nodes).forEach(n => { if (svc(n).state === 'active') logm(w, n, 'ERROR', 'solana_core::votor', `conflicting vote for slot ${slot(w) - 2} signed by identity ${ch.identity} seen from another node; refusing to vote`); });
    if (ch.fresh && voters.length && !ch.everVoted) {
      ch.everVoted = true; ch.firstVoteAt = w.t; ch.firstVoteEpoch = e; ch.creditsFrom = slot(w); ch.credits = 0;
      S.event(w, 'ok', S.LL(`第一票已发出：${voters[0].id} 开始为 vote account ${ch.vote.slice(0, 6)}… 投票。`, `First vote sent: ${voters[0].id} is now voting for vote account ${ch.vote.slice(0, 6)}….`));
    }
    if (ch.fresh && ch.withdrawer && !w.flags.withdrawer_hot && Object.values(w.nodes).some(n => Object.values(n.fs).some(f => typeof f.c === 'string' && pubkeyOf(w, f.c) === ch.withdrawer))) S.flag(w, 'withdrawer_hot');

    // leader windows: an admitted, staked validator leads 4 slots every 900 s; offline, the window becomes skip certificates
    if (!ch.fresh && ch.staked !== false) {
      for (let k = Math.ceil((w.t - dt - WIN0) / WINP); WIN0 + k * WINP <= w.t; k++) {
        const t = WIN0 + k * WINP;
        if (t <= w.t - dt || !inSet(w)) continue;
        const produced = voters.length > 0;
        ch.leaderSlots += 4; if (!produced) ch.skippedSlots += 4;
        ch.lastWindow = { slot: winSlot(w, t), skipped: !produced };
        if (produced) log(w, voters[0], 'INFO', `replay_stage] leader for slots ${winSlot(w, t)}..${winSlot(w, t) + 3}; 4 blocks fast-finalized`);
        else {
          S.event(w, 'warn', S.LL(`本验证者的 leader 窗口（slot ${winSlot(w, t)}–${winSlot(w, t) + 3}）没有出块，集群为这 4 个 slot 生成了 skip 证书。`, `This validator's leader window (slots ${winSlot(w, t)}–${winSlot(w, t) + 3}) produced no blocks; the cluster formed skip certificates for all four.`));
          S.lesson(w, 'skipcert', S.LL('离线 leader 的窗口变成 skip 证书', 'An offline leader\'s window becomes skip certificates'), S.LL('在 Alpenglow 下，验证者在本地超时之前收不到 leader 的块，就投 skip 票。60% 的质押投了 skip，就形成 skip 证书，集群随即进入下一个 slot。离线 leader 的 4 个 slot 很快就变成 4 张 skip 证书，链不会停，但这些 slot 计入它的 skip rate，出块收入也没有了。', 'Under Alpenglow, a validator that has not received the leader\'s block before a local timeout casts a skip vote. Once 60% of stake has voted skip, a skip certificate forms and the cluster moves to the next slot. An offline leader\'s four slots quickly become four skip certificates. The chain does not stall, but the slots count towards that leader\'s skip rate and earn it no block revenue.'));
        }
      }
    }
    if (voters.length >= 1 && !ch.conflict) {
      ch.lastVote = slot(w);
      voters.forEach(n => S.fsWrite(n, vhPath(ch.identity), vhBody(ch.identity, ch.lastVote), { owner: 'sol' }));
      ch.credits += 16 * 0.985 * SLOTS_PER_SEC * dt;
      if (Math.floor(w.t) % 60 < dt) log(w, voters[0], 'INFO', `votor] slot ${slot(w) - 1}: notarize vote sent; finalized via fast path (${(86 + Math.floor(hash(slot(w)) * 10))}% of stake)`);
    } else {
      ch.noVoteSec = (ch.noVoteSec || 0) + dt;
      const p = Object.values(w.nodes).find(n => svc(n).state === 'active' && sv(n).identity === ch.identity && (!sv(n).phase || sv(n).phase === 'run') && sv(n).catchup <= 0);
      if (p && !inSet(w) && ch.vote && Math.floor(w.t) % 60 < dt) logm(w, p, 'WARN', 'solana_core::votor', `identity ${ch.identity} is not in the validator set for epoch ${e}; not voting`);
    }
    if (delinquent(w)) { ch.delinquentSec = (ch.delinquentSec || 0) + dt; if (!ch.saidDelinquent) { ch.saidDelinquent = true; S.lesson(w, 'delinq', S.LL('什么是 delinquent', 'What delinquent means'), S.LL('最后一票落后链头超过 128 个 slot（200 ms 下约 26 秒）后，RPC 节点会把这个验证者列入 delinquent。此时它挣不到投票奖励，质押池也可能撤回委托。', 'When the last vote falls more than 128 slots behind the tip, about 26 seconds at 200 ms, RPC nodes list the validator as delinquent. It earns no vote rewards, and stake pools may withdraw their delegation.')); } }
    if (!quiet(w)) { ch.minVoteBal = Math.min(ch.minVoteBal ?? 1e9, voteBal(w)); ch.minBal = Math.min(ch.minBal ?? 1e9, bal(w, ch.identity)); }
  }


  /* ---------- commands ---------- */
  function clusterOf(ctx) {
    const a = ctx.args;
    if (a.includes('-ut')) return 'testnet';
    if (a.includes('-um')) return 'mainnet';
    const u = S.opt(a, ['--url', '-u']);
    if (u) return /testnet|^t$/.test(u) ? 'testnet' : /mainnet|^m$/.test(u) ? 'mainnet' : /localhost|127\.0\.0\.1/.test(u) ? 'local' : 'mainnet';
    return ctx.host.kind === 'laptop' ? 'mainnet' : 'local';
  }
  const stripCl = args => { const out = []; for (let i = 0; i < args.length; i++) { if (['-ut', '-um', '-ud', '-ul'].includes(args[i])) continue; if (args[i] === '--url' || args[i] === '-u') { i++; continue; } out.push(args[i]); } return out; };
  const solana = async ctx => {
    const w = ctx.w, ch = w.chain;
    let cl = clusterOf(ctx);
    if (cl === 'local') {
      const sv0 = ctx.host.sol && svc(ctx.host).state === 'active';
      if (!sv0) return { code: 1, out: 'Error: error sending request for url (http://localhost:8899/): Connection refused\n' };
      cl = 'testnet';
    }
    const args = stripCl(ctx.args), sub = args[0];
    const defaultKp = ctx.host.kind === 'laptop' ? null : '/home/sol/validator-keypair.json';
    const addTestnet = C.gray(S.L('（这是 testnet 的账户，请加 -ut）', '(this is a testnet account; add -ut)'));
    await ctx.sleep(0.5);
    switch (sub) {
      case 'config': return `Config File: ${ctx.host.kind === 'laptop' ? '/home/ops/.config/solana/cli/config.yml' : '/home/sol/.config/solana/cli/config.yml'}\nRPC URL: ${ctx.host.kind === 'laptop' ? 'https://api.mainnet-beta.solana.com' : 'http://localhost:8899'}\nKeypair Path: ${ctx.host.kind === 'laptop' ? '/home/ops/.config/solana/id.json' : defaultKp}\nCommitment: confirmed\n${ctx.host.kind === 'laptop' ? C.gray(S.L('（默认连接 mainnet。查询 testnet 请加 -ut）', '(the default cluster is mainnet; add -ut for testnet)')) + '\n' : ''}`;
      case 'slot': return slot(w) + '\n';
      case 'epoch-info': {
        if (cl === 'testnet') S.flag(w, 'epoch_checked');
        return `Block height: ${slot(w) - 3133700}\nSlot: ${slot(w)}\nEpoch: ${epoch(w)}\nTransaction Count: 39184623311\nEpoch Slot Range: [${epoch(w) * EPOCH}..${(epoch(w) + 1) * EPOCH})\nEpoch Completed Percent: ${(slotIndex(w) / EPOCH * 100).toFixed(3)}%\nEpoch Completed Slots: ${slotIndex(w)}/${EPOCH} (${EPOCH - slotIndex(w)} remaining)\nEpoch Completed Time: ${S.fmtDur(slotIndex(w) / SLOTS_PER_SEC)}/1d 0h (${S.fmtDur(toBoundary(w))} remaining)\n${cl === 'mainnet' ? C.gray(S.L('（这是 mainnet 的 epoch。这台验证者在 testnet，请加 -ut）', '(this is the mainnet epoch; the validator is on testnet, add -ut)')) + '\n' : ''}`;
      }
      case 'address': return defaultKp ? pubkeyOf(w, S.fsRead(w, ctx.host, defaultKp)) + '\n' : 'Error: No such file or directory (os error 2)\n';
      case 'balance': {
        let pk = args[1];
        if (!pk && defaultKp) pk = pubkeyOf(w, S.fsRead(w, ctx.host, defaultKp));
        if (!pk) return { code: 1, out: 'Error: No such file or directory (os error 2)\n' };
        if (pk.endsWith('.json')) pk = pubkeyOf(w, ctx.read(pk));
        const b = bal(w, pk, cl);
        if (cl === 'testnet' && (pk === ch.identity || pk === ch.vote)) checkVerified(w);
        const ours = pk === ch.identity || pk === ch.vote;
        return `${b.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')} SOL\n${cl === 'mainnet' && ours ? C.gray(S.L('（这是 mainnet 上的余额。这台验证者在 testnet，请加 -ut）', '(this is the mainnet balance; the validator is on testnet, add -ut)')) + '\n' : ''}`;
      }
      case 'validators': {
        if (cl !== 'testnet') return `${C.gray(S.L('（这台验证者在 testnet，mainnet 列表里没有它。请加 -ut）', '(this validator is on testnet and not in the mainnet list; add -ut)'))}\n`;
        const ours = ch.fresh
          ? [delinquent(w) ? C.red('⚠') : ' ', ch.identity, ch.vote, `${ch.commission}%`, String(ch.lastVote), String(ch.lastVote - 1), '-', String(Math.round(ch.credits)), VERSION, '0 SOL (0.00%)']
          : [delinquent(w) ? C.red('⚠') : ' ', ch.identity, ch.vote, '0%', String(w.chain.lastVote), String(w.chain.lastVote - 1), `${skipRate(w).toFixed(2)}%`, String(Math.round(w.chain.credits)), VERSION, '12.5 SOL (0.01%)'];
        checkVerified(w);
        // getVoteAccounts leaves out unstaked validators that are not voting, so a new one appears only once it votes
        const listed = !ch.fresh || (ch.everVoted && !delinquent(w));
        if (ch.fresh && listed) S.flag(w, 'fresh_seen');
        const rows = [...(listed ? [ours] : []), [' ', '5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on', 'GBU4potq4TjsmXtXv1X2N3tP8Kpt2k5sGxkPbDJmw6aS', '10%', String(slot(w)), String(slot(w) - 1), '1.20%', String(Math.round(median(w))), VERSION, '1.2M SOL (0.77%)'], [' ', 'dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92', 'B6S9wMXqo7Vgm7RAA4oqpn6U6aCgeqoyD5ZvtPYa7b4s', '5%', String(slot(w)), String(slot(w) - 1), '0.84%', String(Math.round(median(w) * 0.99)), VERSION, '980K SOL (0.63%)']];
        const note = ch.fresh ? '' : delinquent(w) ? C.red(S.L(`Delinquent Stake: 12.5 SOL。本验证者在 delinquent 列表中，最后一票落后 ${behind(w)} slots`, `Delinquent Stake: 12.5 SOL. This validator is delinquent; its last vote is ${behind(w)} slots behind`)) : '';
        return S.table(rows, ['', 'Identity', 'Vote Account', 'Commission', 'Last Vote', 'Root Slot', 'Skip Rate', 'Credits', 'Version', 'Active Stake']) + `\n${note}\n`;
      }
      case 'vote-account': {
        if (!ch.vote || args[1] !== ch.vote) return { code: 1, out: `Error: account ${args[1] || ''} not found or is not a vote account\n` };
        if (cl !== 'testnet') return { code: 1, out: `Error: account ${args[1]} not found ${addTestnet}\n` };
        checkVerified(w);
        if (ch.bls) S.flag(w, 'bls_seen');
        const ts = ch.everVoted || !ch.fresh ? `${S.isoTime(new Date(w.base + (w.t - behind(w) / SLOTS_PER_SEC) * 1000))} from slot ${ch.lastVote}` : `${S.isoTime(new Date(w.base + ch.voteCreatedAt * 1000))} from slot 0`;
        return `Account Balance: ${voteBal(w).toFixed(8)} SOL\nValidator Identity: ${ch.identity}\nVote Authority: {${epoch(w)}: "${ch.identity}"}\nBLS Public Key: ${ch.bls || 'None'}\nWithdraw Authority: ${ch.withdrawer || '9pLqVw3Ns8kTz6RcXyM2bJd5Hf4Ue7GaQ1oLt3Kn8WpZ'}\nCredits: ${Math.round(ch.credits)}\nCommission: ${ch.commission ?? 0}%\nRoot Slot: ${ch.everVoted || !ch.fresh ? ch.lastVote - 1 : '~'}\nRecent Timestamp: ${ts}\n${ch.everVoted || !ch.fresh ? '' : 'Epoch Voting History: (none)\n'}`;
      }
      case 'catchup': {
        if (!args.includes('--our-localhost') && ctx.host.kind === 'laptop') return { code: 1, out: S.L('Error: --our-localhost 只能在验证者机器上使用。在工作电脑上请用 solana validators -ut\n', 'Error: --our-localhost only works on the validator host. From the workstation use solana validators -ut\n') };
        const x = ctx.host.sol;
        if (!x || svc(ctx.host).state !== 'active') return { code: 1, out: 'Error: error sending request for url (http://localhost:8899/): Connection refused\n' };
        if (x.phase && x.phase !== 'run') return { code: 1, out: `Error: error sending request for url (http://localhost:8899/): error trying to connect: tcp connect error: Connection refused (os error 111) ${C.gray(S.L('（节点还在启动：RPC 要等快照加载完才开放。用 agave-validator -l /mnt/ledger monitor 看启动进度）', '(the node is still starting; RPC opens after the snapshot has loaded. Watch progress with agave-validator -l /mnt/ledger monitor)'))}\n` };
        if (x.catchup > 0 && x.gain < 0) return `${x.identity} has ${Math.round(x.catchup)} slot(s) behind (us:${slot(w) - Math.round(x.catchup)} them:${slot(w)}), our node is falling behind at ${x.gain.toFixed(1)} slots/second (average: ${(x.gain + 0.1).toFixed(1)} slots/second)\n`;
        if (x.catchup > 0) return `${x.identity} has ${Math.round(x.catchup)} slot(s) behind (us:${slot(w) - Math.round(x.catchup)} them:${slot(w)}), our node is gaining at ${GAIN.toFixed(1)} slots/second (average ${(GAIN - 0.1).toFixed(1)} slots/second, ETA: ${S.fmtDur(x.catchup / GAIN)})\n`;
        checkVerified(w);
        return `${x.identity} has caught up (us:${slot(w)} them:${slot(w)})\n`;
      }
      case 'gossip': {
        if (cl !== 'testnet') return `${C.gray(S.L('（这台验证者在 testnet，mainnet 的 gossip 里没有它。请加 -ut）', '(this validator is on testnet and not in mainnet gossip; add -ut)'))}\n`;
        const rows = Object.values(w.nodes).filter(n => n.powered !== false && svc(n).state === 'active').map(n => [n.ip, sv(n).identity, '8001', '8003', 'none', VERSION, '1438204551']);
        rows.push(['198.51.100.77', '5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on', '8001', '8003', '198.51.100.77:8899', VERSION, '1438204551'], ['198.51.100.78', 'dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92', '8001', '8003', '198.51.100.78:8899', VERSION, '1438204551']);
        const head = ['IP Address', 'Identity', 'Gossip', 'TPU', 'RPC Address', 'Version', 'Feature Set'];
        const wd = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
        const line = r => r.map((c, i) => c.padEnd(wd[i])).join(' | ').replace(/\s+$/, '');
        return [line(head), wd.map(n => '-'.repeat(n)).join('-+-'), ...rows.map(line), `Nodes: ${rows.length}`].join('\n') + '\n';
      }
      case 'airdrop': {
        if (cl !== 'testnet') return { code: 1, out: 'Error: airdrops are disabled on mainnet-beta\n' };
        const amt = parseFloat(args[1]); const pk = args[2];
        if (ch.airdrops >= 1) return { code: 1, out: 'Error: airdrop request failed. This can happen when the rate limit is reached.\n' };
        if (!(amt > 0) || amt > 1) return { code: 1, out: 'Error: airdrop request failed (testnet faucet limit is 1 SOL per request)\n' };
        ch.airdrops++; ch.bal[pk] = (ch.bal[pk] || 0) + amt;
        return `Requesting airdrop of ${amt} SOL\n\nSignature: 4Kz8…airdrop\n\n${bal(w, pk).toFixed(4)} SOL\n`;
      }
      case 'transfer': {
        const to = args[1], amt = parseFloat(args[2]);
        let from = S.opt(ctx.args, ['--from', '-k']);
        if (!to || !(amt > 0)) return { code: 1, out: 'usage: solana transfer <RECIPIENT> <AMOUNT> --from <KEYPAIR> [--fee-payer <KEYPAIR>]\n' };
        // the workstation has a default keypair, as a real CLI install usually does
        const defKp = ctx.sh.home() + '/.config/solana/id.json';
        if (!from && S.fsGet(ctx.host, defKp)) from = defKp;
        if (!from && defaultKp && ctx.sess.user === 'sol' && S.fsGet(ctx.host, defaultKp)) from = defaultKp; // the node's CLI config points at the identity
        const book = cl === 'testnet' ? ch.bal : ch.mainnetBal;
        if (!(book[to] > 0) && !ctx.args.includes('--allow-unfunded-recipient')) return { code: 1, out: `Error: The recipient address (${to}) is not funded. Add \`--allow-unfunded-recipient\` to complete the transfer${cl === 'mainnet' && (to === ch.identity || to === ch.vote) ? C.gray(S.L('  （这个地址在 mainnet 上没有余额。这台验证者在 testnet，请加 -ut）', '  (this address holds nothing on mainnet; the validator is on testnet, add -ut)')) : ''}\n` };
        if (!from) return { code: 1, out: `Error: Dynamic program error: No default signer found, run "solana-keygen new -o ${ctx.host.kind === 'laptop' ? '/home/ops' : '/home/sol'}/.config/solana/id.json" to create a new one ${C.gray(S.L('（用 --from 指定付款的 keypair 文件）', '(pass the paying keypair with --from)'))}\n` };
        const fromPk = pubkeyOf(w, ctx.read(from));
        if (!fromPk) return { code: 1, out: `Error: could not read keypair file "${from}"\n` };
        if ((book[fromPk] || 0) < amt + TX_FEE) return { code: 1, out: `Error: Account ${fromPk} has insufficient funds for spend (${amt} SOL) + fee (0.000005 SOL)${cl === 'mainnet' ? C.gray(S.L('  （当前操作的是 mainnet。这台验证者在 testnet，请加 -ut）', '  (this ran against mainnet; the validator is on testnet, add -ut)')) : ''}\n` };
        await ctx.sleep(1.5);
        book[fromPk] -= amt + TX_FEE; book[to] = (book[to] || 0) + amt;
        if (cl === 'testnet' && to === ch.identity) S.event(w, 'ok', S.LL(`向 identity 转入 ${amt} SOL（testnet），当前余额 ${bal(w, to).toFixed(3)} SOL。`, `Transferred ${amt} SOL to the identity (testnet). Balance is now ${bal(w, to).toFixed(3)} SOL.`));
        if (cl === 'testnet' && to === ch.identity && !ch.fresh) S.lesson(w, 'id-role', S.LL('identity 不再为投票付费', 'The identity no longer pays for votes'), S.LL('在 Alpenglow 下投票是消息，不是交易。identity 仍然签名、收出块收入、付普通交易费，它的余额并不随投票下降。准入费从 vote account 扣，给 identity 充值不影响准入。', 'Under Alpenglow a vote is a message, not a transaction. The identity still signs, receives block revenue and pays ordinary transaction fees, but its balance does not fall with each vote. The admission ticket comes from the vote account, and funding the identity does nothing for admission.'));
        else if (cl === 'testnet' && to === ch.vote) S.event(w, 'ok', S.LL(`向 vote account 转入 ${amt} SOL（testnet），当前余额 ${bal(w, to).toFixed(3)} SOL。`, `Transferred ${amt} SOL to the vote account (testnet). Balance is now ${bal(w, to).toFixed(3)} SOL.`));
        else if (ch.fresh && cl === 'testnet') S.event(w, 'ok', S.LL(`向 ${to.slice(0, 6)}… 转入 ${amt} SOL（testnet），当前余额 ${bal(w, to).toFixed(3)} SOL。`, `Transferred ${amt} SOL to ${to.slice(0, 6)}… (testnet). Balance is now ${bal(w, to).toFixed(3)} SOL.`));
        if (cl === 'testnet' && fromPk === ch.identity) S.lesson(w, 'id-refill', S.LL('从 identity 转给 vote account', 'Refilling the vote account from the identity'), S.LL(`运维常从 identity 给 vote account 补钱。identity 自己也有下限：它要付普通交易的手续费，告警在低于 ${ID_FLOOR} SOL 时响。转出之后两个账户都要在各自的下限之上。`, `Operators often refill the vote account from the identity. The identity has its own floor: it pays ordinary transaction fees, and its alert fires below ${ID_FLOOR} SOL. After the transfer, both accounts must stay above their floors.`));
        if (cl === 'mainnet') {
          S.flag(w, 'mainnet_spend');
          S.lesson(w, 'mainnet-spend', S.LL('这笔转账发生在 mainnet', 'That transfer happened on mainnet'), S.LL('工作电脑上的 CLI 默认连接 mainnet，默认 keypair 里是真钱。同一个地址在每个集群上都存在，所以转账不会报错，SOL 只是到了 mainnet 上这个地址里。处理 testnet 验证者时，每条命令都显式写上 <code>-ut</code> 和 <code>--from</code>。', 'The CLI on the workstation defaults to mainnet, and its default keypair holds real funds. The same address exists on every cluster, so the transfer succeeds; the SOL simply lands at that address on mainnet. When working on a testnet validator, give every command an explicit <code>-ut</code> and <code>--from</code>.'));
        }
        return `\nSignature: 3vZ8kq${Math.floor(w.rand() * 1e9).toString(36)}…\n\n`;
      }
      case 'vote-authorize-voter-checked': return authorizeVoter(ctx, args, cl);
      case 'vote-update-commission-collector': return commissionCollector(ctx, args, cl);
      case 'withdraw-from-vote-account': {
        if (!ch.vote || args[1] !== ch.vote) return { code: 1, out: `Error: account ${args[1] || ''} not found or is not a vote account\n` };
        return { code: 1, out: `Error: Invalid signer: the authorized withdrawer ${ch.withdrawer || '9pLqVw3Ns8kTz6RcXyM2bJd5Hf4Ue7GaQ1oLt3Kn8WpZ'} must sign ${C.gray(S.L('（只有 withdrawer 能从 vote account 取款；它离线保存。vote account 需要的是充值，不是取款）', '(only the withdrawer can take SOL out, and it is kept offline. The vote account needs a deposit, not a withdrawal)'))}\n` };
      }
      case 'create-vote-account':
        if (ch.fresh) return createVoteAccount(ctx, args, cl);
      // falls through
      default:
        return { code: 1, out: `${C.gray(S.L('本练习支持：', 'Available in this lab: ') + 'solana config get · slot · epoch-info · balance [PK] · validators · gossip · vote-account VOTE · catchup --our-localhost · transfer TO AMT --from KP · airdrop AMT PK · vote-authorize-voter-checked VOTE VOTER_KP VOTER_KP · vote-update-commission-collector VOTE block-revenue VOTE WITHDRAWER_KP' + (ch.fresh ? ' · create-vote-account VOTE_KP IDENTITY_KP WITHDRAWER --commission N --fee-payer KP' : '') + S.L('（集群用 -ut / -um / --url）', ' (cluster: -ut / -um / --url)'))}\n` };
    }
  };
  const isPubkey = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
  const valuedOpts = ['--fee-payer', '--commission', '--authorized-voter', '--seed', '--keypair', '-k', '--memo', '--with-compute-unit-price'];
  const positional = args => { const pos = []; for (let i = 1; i < args.length; i++) { if (valuedOpts.includes(args[i])) { i++; continue; } if (args[i].startsWith('-')) continue; pos.push(args[i]); } return pos; };
  const keyReader = ctx => p => {
    const c = ctx.read(p);
    if (c === null) return { err: `Error: could not read keypair file "${p}". Run "solana-keygen new" to create a keypair file: No such file or directory (os error 2)` };
    if (!ctx.sh.canRead(ctx.resolve(p))) return { err: `Error: could not read keypair file "${p}": Permission denied (os error 13)` };
    const pk = pubkeyOf(ctx.w, c);
    return pk ? { pk } : { err: `Error: could not read keypair file "${p}": not a valid keypair` };
  };
  function feePayer(ctx, args, readKp) {
    const fpArg = S.opt(args, ['--fee-payer']) || S.opt(args, ['--keypair', '-k']);
    if (fpArg) return readKp(fpArg);
    const d = ctx.sh.home() + '/.config/solana/id.json', c = S.fsRead(ctx.w, ctx.host, d);
    if (c === null) return { err: `Error: Dynamic program error: No default signer found, run "solana-keygen new -o ${d}" to create a new one ${C.gray(S.L('（用 --fee-payer 指定付手续费的 keypair）', '(pass the paying keypair with --fee-payer)'))}` };
    return { pk: pubkeyOf(ctx.w, c) };
  }
  const notOnTestnet = cl => C.gray(S.L('  （当前操作的是 mainnet。这台验证者在 testnet，请加 -ut）', '  (this ran against mainnet; the validator is on testnet, add -ut)'));
  async function createVoteAccount(ctx, args, cl) {
    const w = ctx.w, ch = w.chain;
    const pos = positional(args);
    if (pos.length < 3) return { code: 1, out: 'error: The following required arguments were not provided:\n    <ACCOUNT_KEYPAIR>\n    <IDENTITY_KEYPAIR>\n    <WITHDRAWER_PUBKEY>\n\nUSAGE:\n    solana create-vote-account [OPTIONS] <ACCOUNT_KEYPAIR> <IDENTITY_KEYPAIR> <WITHDRAWER_PUBKEY>\n' };
    const readKp = keyReader(ctx);
    const acct = readKp(pos[0]); if (acct.err) return { code: 1, out: acct.err + '\n' };
    const ident = readKp(pos[1]); if (ident.err) return { code: 1, out: ident.err + '\n' };
    let wd;
    if (isPubkey(pos[2]) && ctx.read(pos[2]) === null) wd = pos[2];
    else { const r = readKp(pos[2]); if (r.err) return { code: 1, out: r.err + '\n' }; wd = r.pk; }
    const comm = S.opt(args, ['--commission']);
    const commission = comm === undefined ? 100 : Number(comm);
    if (!Number.isInteger(commission) || commission < 0 || commission > 100) return { code: 1, out: `error: Invalid value for '--commission <PERCENTAGE>': invalid value '${comm}'\n` };
    const fp = feePayer(ctx, args, readKp); if (fp.err) return { code: 1, out: fp.err + '\n' };
    const payer = fp.pk;
    if (!args.includes('--allow-unsafe-authorized-withdrawer')) {
      if (wd === acct.pk) return { code: 1, out: 'Error: Invalid parameter: Authorized withdrawer pubkey is identical to vote account pubkey, an unsafe configuration\n' };
      if (wd === ident.pk) return { code: 1, out: `Error: Invalid parameter: Authorized withdrawer pubkey is identical to identity account pubkey, an unsafe configuration ${C.gray(S.L('（withdrawer 应当是另一把离线保存的钥匙）', '(the withdrawer should be a separate key kept offline)'))}\n` };
    }
    const book = cl === 'testnet' ? ch.bal : ch.mainnetBal;
    if (cl === 'testnet' && ch.votes[acct.pk]) return { code: 1, out: `Error: Vote account ${acct.pk} already exists\n` };
    if ((book[payer] || 0) < RENT_VOTE + 0.00001) return { code: 1, out: `Error: Account ${payer} has insufficient funds for spend (${RENT_VOTE} SOL) + fee (0.00001 SOL)${cl === 'mainnet' ? notOnTestnet(cl) : ''}\n` };
    await ctx.sleep(1.5);
    book[payer] -= RENT_VOTE + 0.00001; book[acct.pk] = (book[acct.pk] || 0) + RENT_VOTE;
    if (cl === 'testnet') {
      ch.votes[acct.pk] = { identity: ident.pk, withdrawer: wd, commission };
      Object.assign(ch, { vote: acct.pk, identity: ident.pk, withdrawer: wd, commission, voteCreatedAt: w.t, bls: null });
      S.event(w, 'ok', S.LL(`testnet 上已创建 vote account ${acct.pk.slice(0, 6)}…，佣金 ${commission}%。余额只有免租金额 ${RENT_VOTE} SOL。`, `Vote account ${acct.pk.slice(0, 6)}… created on testnet, commission ${commission}%. It holds only its rent-exempt minimum, ${RENT_VOTE} SOL.`));
    }
    return `Signature: 4Vt${Math.floor(w.rand() * 1e12).toString(36)}Qm9cR2kXwL7pNz…\n`;
  }
  // registers the BLS public key derived from the authorized voter; passing the same keypair twice keeps the voter unchanged
  async function authorizeVoter(ctx, args, cl) {
    const w = ctx.w, ch = w.chain, pos = positional(args);
    if (pos.length < 3) return { code: 1, out: 'error: The following required arguments were not provided:\n    <VOTE_ACCOUNT_ADDRESS>\n    <AUTHORIZED_KEYPAIR>\n    <NEW_AUTHORIZED_KEYPAIR>\n\nUSAGE:\n    solana vote-authorize-voter-checked <VOTE_ACCOUNT_ADDRESS> <AUTHORIZED_KEYPAIR> <NEW_AUTHORIZED_KEYPAIR>\n' };
    if (!ch.vote || pos[0] !== ch.vote || cl !== 'testnet') return { code: 1, out: `Error: account ${pos[0]} not found or is not a vote account${cl !== 'testnet' && pos[0] === ch.vote ? ' ' + C.gray(S.L('（这是 testnet 的 vote account，请加 -ut）', '(this is a testnet vote account; add -ut)')) : ''}\n` };
    const readKp = keyReader(ctx);
    const cur = readKp(pos[1]); if (cur.err) return { code: 1, out: cur.err + '\n' };
    const nxt = readKp(pos[2]); if (nxt.err) return { code: 1, out: nxt.err + '\n' };
    if (cur.pk !== ch.identity) return { code: 1, out: `Error: Invalid signer: ${cur.pk} is not the authorized voter for epoch ${epoch(w)}\n` };
    if (nxt.pk !== cur.pk) return { code: 1, out: C.gray(S.L('本练习只用这条命令登记 BLS 公钥：两个参数都传当前的 authorized voter keypair，voter 保持不变。\n', 'This lab uses the command only to register the BLS key: pass the current authorized voter keypair for both arguments, so the voter stays the same.\n')) };
    const fp = feePayer(ctx, args, readKp); if (fp.err) return { code: 1, out: fp.err + '\n' };
    if ((ch.bal[fp.pk] || 0) < TX_FEE) return { code: 1, out: `Error: Account ${fp.pk} has insufficient funds for fee (0.000005 SOL)\n` };
    await ctx.sleep(1.5);
    ch.bal[fp.pk] -= TX_FEE;
    const had = ch.bls; ch.bls = blsOf(nxt.pk);
    if (!had) S.event(w, 'ok', S.LL(`vote account 已登记 BLS 公钥 ${ch.bls.slice(0, 8)}…，authorized voter 不变。`, `BLS public key ${ch.bls.slice(0, 8)}… registered on the vote account; the authorized voter is unchanged.`));
    return `Signature: 2Bk${Math.floor(w.rand() * 1e12).toString(36)}Lr7sPq4WxN…\n`;
  }
  // block revenue lands in the given account from epoch E+2; needs the authorized withdrawer
  async function commissionCollector(ctx, args, cl) {
    const w = ctx.w, ch = w.chain, pos = positional(args);
    if (pos.length < 4 || !['block-revenue', 'inflation-rewards'].includes(pos[1])) return { code: 1, out: 'usage: solana vote-update-commission-collector <VOTE_ACCOUNT> <block-revenue|inflation-rewards> <COLLECTOR_ADDRESS> <AUTHORIZED_WITHDRAWER_KEYPAIR>\n' };
    if (!ch.vote || pos[0] !== ch.vote || cl !== 'testnet') return { code: 1, out: `Error: account ${pos[0]} not found or is not a vote account${cl !== 'testnet' && pos[0] === ch.vote ? ' ' + C.gray(S.L('（这是 testnet 的 vote account，请加 -ut）', '(this is a testnet vote account; add -ut)')) : ''}\n` };
    const readKp = keyReader(ctx);
    const wd = readKp(pos[3]); if (wd.err) return { code: 1, out: wd.err + '\n' };
    if (ch.withdrawer && wd.pk !== ch.withdrawer) return { code: 1, out: `Error: Invalid signer: ${wd.pk} is not the authorized withdrawer\n` };
    await ctx.sleep(1.5);
    const from = epoch(w) + (pos[1] === 'block-revenue' ? 2 : 1);
    ch.collector = Object.assign(ch.collector || {}, { [pos[1]]: { to: pos[2], from } });
    if (pos[1] === 'block-revenue' && pos[2] === ch.vote) S.flag(w, 'autofund');
    S.event(w, 'ok', S.LL(`${pos[1] === 'block-revenue' ? '出块收入' : '通胀奖励佣金'}的收款账户改为 ${pos[2].slice(0, 6)}…，从 epoch ${from} 起生效。`, `The ${pos[1] === 'block-revenue' ? 'block revenue' : 'inflation reward commission'} collector is now ${pos[2].slice(0, 6)}…, effective from epoch ${from}.`));
    return `Signature: 5Cc${Math.floor(w.rand() * 1e12).toString(36)}Tn2vQw8ZkR…\n`;
  }
  // a check from on-chain data counts once both accounts are above their floors and the validator is voting
  function checkVerified(w) {
    const ch = w.chain;
    if (w.flags.verified || ch.fresh || delinquent(w) || voteBal(w) < VOTE_FLOOR || bal(w, ch.identity) < ID_FLOOR) return;
    S.flag(w, 'verified'); S.event(w, 'ok', S.LL('已通过链上数据确认验证者状态。', 'Validator status confirmed from on-chain data.'));
  }
  const WORDS = 'orbit velvet canal frost humble ladder pistol oyster ripple gentle tunnel saddle copper meadow hazard bright anchor violin glimpse tomato wander kitten blossom drastic method radar shrimp patrol ivory lunar bamboo cabin dizzy fabric jungle kernel lobster magnet noble pencil quantum rescue sketch talent unveil walnut yellow zebra'.split(' ');
  // keypairs generated in the fresh-install lab: the first file with each standard name gets a fixed pubkey, so the guided steps can name it
  const FRESH_PK = { 'validator-keypair.json': '8vRtQm4KcZ7wLx2NbYp9HsJd3Fa6Ue5GkT1nWq7XzMpA', 'vote-account-keypair.json': 'Vt3kPq8WmZ2xRc6NbLd9Hf5Jy7Ts4Ua1GeK3nQrW8sMx', 'authorized-withdrawer-keypair.json': 'Wd9pLq4XkT7mVz2NcR8bHs5Jy3Fa6GeU1oKt4Pw7Qn2Y' };
  function keygenNew(ctx) {
    const w = ctx.w, ch = w.chain, a = ctx.args.slice(1);
    const outArg = S.opt(a, ['-o', '--outfile']);
    const path = ctx.resolve(outArg || '~/.config/solana/id.json');
    if (S.fsGet(ctx.host, path) && !a.includes('--force')) return { code: 1, out: `Refusing to overwrite ${path} without --force flag\n` };
    if (!ctx.sh.canWrite(path)) return { code: 1, out: 'Error: Permission denied (os error 13)\n' };
    const base = path.slice(path.lastIndexOf('/') + 1);
    const pk = FRESH_PK[base] && !ch.issued[base] ? FRESH_PK[base] : Array.from({ length: 44 }, () => B58[Math.floor(w.rand() * 58)]).join('');
    ch.issued[base] = true;
    const c = keyContent(pk); ch.keyfiles[c] = pk;
    S.fsWrite(ctx.host, path, c, { mode: '600', owner: ctx.sess.user, by: 'user', at: w.t });
    if (ctx.host.kind !== 'laptop' && /withdraw/i.test(base)) S.flag(w, 'withdrawer_hot');
    const noPass = a.includes('--no-bip39-passphrase'), bar = '='.repeat(80);
    const words = Array.from({ length: 12 }, () => WORDS[Math.floor(w.rand() * WORDS.length)]).join(' ');
    let out = 'Generating a new keypair\n';
    if (!noPass) out += `\nFor added security, enter a BIP39 passphrase\n\nNOTE! This passphrase improves security of the recovery seed phrase NOT the\nkeypair file itself, which is stored as insecure plain text\n\nBIP39 Passphrase (empty for none): ${C.gray(S.L('（模拟器按空口令处理）', '(the simulator takes an empty passphrase)'))}\n\n`;
    out += `Wrote new keypair to ${path}\n${bar}\npubkey: ${pk}\n${bar}\nSave this seed phrase${noPass ? '' : ' and your BIP39 passphrase'} to recover your new keypair:\n${words}\n${bar}\n`;
    return out;
  }
  const solanaKeygen = ctx => {
    if (ctx.args[0] === 'new' && ctx.w.chain.fresh) return keygenNew(ctx);
    const [sub, file] = ctx.args;
    if (!['pubkey', 'bls_pubkey'].includes(sub) || !file) return { code: 1, out: 'usage: solana-keygen pubkey <KEYPAIR_FILE>\n       solana-keygen bls_pubkey <AUTHORIZED_VOTER_KEYPAIR>\n' };
    const c = ctx.read(file);
    if (c === null) return { code: 1, out: `Error: No such file or directory (os error 2)\n` };
    if (!ctx.sh.canRead(ctx.resolve(file))) return { code: 1, out: 'Error: Permission denied (os error 13)\n' };
    const pk = pubkeyOf(ctx.w, c);
    if (!pk) return 'Error: invalid keypair\n';
    return (sub === 'bls_pubkey' ? blsOf(pk) : pk) + '\n';
  };
  const agave = async ctx => {
    const w = ctx.w, n = ctx.host;
    if (ctx.args.includes('--version')) {
      if (!w.chain.fresh) return `agave-validator ${VERSION} (src:${SRC[VERSION]}; feat:1438204551, client:Agave)\n`;
      const v = binVersion(ctx, 'agave-validator') || VERSION;
      S.flag(w, 'agave_version');
      return `agave-validator ${v} (src:${SRC[v] || '9c41d07e'}; feat:${/^4\.3\./.test(v) ? '1438204551' : '2718562410'}, client:Agave)\n`;
    }
    const subs = ['monitor', 'exit', 'set-identity', 'contact-info', 'wait-for-restart-window'];
    const si = ctx.args.findIndex(a => subs.includes(a)), sub = ctx.args[si];
    if (!n.sol || svc(n).state !== 'active') return { code: 1, out: `Error: Unable to connect to validator admin RPC at ${LEDGER}/admin.rpc (is the validator running?)\n` };
    const admin = () => ctx.isRoot || ctx.sess.user === 'sol';
    if (sub === 'exit') { if (!admin()) return { code: 1, out: 'Error: Permission denied (admin.rpc)\n' }; stop(w, n); S.log(w, n, 'agave-validator', 'SYS', 'agave-validator.service: Scheduled restart job (Restart=on-failure not triggered by clean exit)'); return 'Exit request sent\n'; }
    if (sub === 'contact-info') return `Identity: ${n.sol.identity}\nGossip: ${n.ip}:8001\nTPU: ${n.ip}:8003\nRPC: 127.0.0.1:8899\n`;
    if (sub === 'set-identity') {
      if (!w.chain.setIdentity) return { code: 1, out: C.gray(S.L('本练习不需要用到 set-identity。\n', 'set-identity is not needed in this lab.\n')) };
      if (!admin()) return { code: 1, out: 'Error: Permission denied (admin.rpc)\n' };
      const rest = ctx.args.slice(si + 1), override = rest.includes('--do-not-require-vote-history');
      const file = rest.find(a => !a.startsWith('-'));
      if (!file) return { code: 1, out: 'error: The following required arguments were not provided:\n    <IDENTITY>\n\nUSAGE:\n    agave-validator --ledger <DIR> set-identity [--do-not-require-vote-history] <IDENTITY>\n' };
      const c = ctx.read(file);
      if (c === null) return { code: 1, out: `Error: Unable to read keypair file ${file}: No such file or directory (os error 2)\n` };
      const pk = pubkeyOf(w, c);
      if (!pk) return { code: 1, out: `Error: Unable to read keypair file ${file}: invalid keypair\n` };
      ctx.write(`New validator identity path: ${ctx.resolve(file)}\n`);
      await ctx.sleep(1);
      if (rest.includes('--require-tower')) ctx.write(C.gray(S.L('（--require-tower 属于 TowerBFT。在 Alpenglow 下，set-identity 默认就要求 vote history 文件）\n', '(--require-tower belonged to TowerBFT. Under Alpenglow, set-identity requires the vote history file by default)\n')));
      // the staked identity carries consensus state; switching to it needs that identity's vote history unless overridden
      if (pk === w.chain.identity && !S.fsGet(n, vhPath(pk))) {
        if (!override) return { code: 1, out: `Error: set_identity request failed: Unable to load vote history for identity ${pk}: ${vhPath(pk)}: No such file or directory (os error 2) ${C.gray(S.L('（先把主节点的 vote history 文件拷过来。--do-not-require-vote-history 只用于紧急情况：主节点无法访问或已损坏，而且本机已经追过它的最后一票）', '(copy the primary\'s vote history file here first. --do-not-require-vote-history is for emergencies only: the primary is unreachable or corrupted, and this node has caught up past its last vote)'))}\n` };
        logm(w, n, 'WARN', 'solana_core::consensus', `--do-not-require-vote-history: no vote history for ${pk} at ${vhPath(pk)}; continuing with an empty vote history`);
        const reachable = Object.values(w.nodes).some(o => o !== n && o.powered !== false);
        if (reachable) {
          S.flag(w, 'vh_override');
          S.lesson(w, 'vh-override', S.LL('vote history 跟着 identity 走', 'The vote history travels with the identity'), S.LL('vote history 文件记录这个 identity 已经投过的票。备用机没有它，就不知道主节点刚刚为哪些 slot 投过什么票，可能为同一个 slot 投出不同的票。<code>set-identity</code> 默认要求这个文件。<code>--do-not-require-vote-history</code> 只在紧急情况下使用：主节点无法访问或已损坏，而且备用机已经追过主节点的最后一票。主节点还能访问时，先把文件拷过来。', 'The vote history file records the votes this identity has already cast. Without it, the standby does not know what the primary just voted for in recent slots, and can vote differently for the same slot. <code>set-identity</code> requires the file by default. <code>--do-not-require-vote-history</code> is for emergencies only: the primary is unreachable or corrupted, and the standby has caught up past the primary\'s last vote. While the primary is reachable, copy the file over first.'));
        }
      }
      const prev = n.sol.identity; n.sol.identity = pk;
      logm(w, n, 'WARN', 'agave_validator::admin_rpc_service', `Identity set to ${pk} (was ${prev})`);
      return '';
    }
    if (sub === 'wait-for-restart-window' && w.chain.fresh) {
      ctx.write(`${C.gray('⠁')} Fetching leader schedule for epoch ${epoch(w)}...\n`);
      await ctx.sleep(1);
      ctx.write(`${C.gray('⠂')} Validator ${n.sol.identity} has no leader slots in epoch ${epoch(w)}\n`);
      S.flag(w, 'restart_window');
      return C.green('Ready to restart') + '\n';
    }
    if (sub === 'wait-for-restart-window') {
      const idle = parseFloat(S.opt(ctx.args, ['--min-idle-time']) || '10');
      const nextLeader = () => 300 + Math.ceil((w.t - 300) / 900) * 900;
      ctx.write(`${C.gray('⠁')} Fetching leader schedule for epoch ${epoch(w)}...\n`);
      await ctx.sleep(1);
      let L = nextLeader();
      while (L - w.t < idle * 60) {
        if (ctx.sig.aborted) return { code: 130 };
        ctx.write(`${C.gray('⠂')} ${S.fmtDur(w.t % 86400).padStart(7)} | Validator will be leader soon. Next leader slot is ${Math.floor(w.chain.slot0 + L * SLOTS_PER_SEC)} (in ${S.fmtDur(L - w.t)}); waiting for ${idle} minutes of idle time\n`);
        await ctx.sleep(Math.min(30, L - w.t + 3));
        L = nextLeader();
      }
      ctx.write(`${C.gray('⠄')} Next leader slot is ${Math.floor(w.chain.slot0 + L * SLOTS_PER_SEC)}, ${S.fmtDur(L - w.t)} from now\n`);
      return C.green('Ready to restart') + '\n';
    }
    if (sub !== 'monitor') return { code: 1, out: 'usage: agave-validator --ledger /mnt/ledger monitor|exit|contact-info|wait-for-restart-window|set-identity\n' };
    ctx.write(`Ledger location: ${LEDGER}\nIdentity: ${n.sol.identity}\nGenesis Hash: 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY\nVersion: ${n.sol.version || VERSION}\nShred Version: 64475\nGossip Address: ${n.ip}:8001\nTPU Address: ${n.ip}:8003\n${C.gray(S.L('（Ctrl+C 退出）', '(Ctrl+C to stop)'))}\n`);
    const t0 = w.t;
    while (!ctx.sig.aborted) {
      const x = n.sol, b = voteBal(w);
      if (svc(n).state !== 'active') { ctx.write(C.red('Validator exited\n')); return { code: 1 }; }
      if (x.phase === 'download') ctx.write(`⠒ ${S.fmtDur(w.t - t0).padStart(7)} | Validator startup: DownloadingSnapshot { slot: ${x.snapSlot}, rpc_addr: 198.51.100.77:8899 }...\n`);
      else if (x.phase === 'load') ctx.write(`⠒ ${S.fmtDur(w.t - t0).padStart(7)} | Validator startup: LoadingLedger...\n`);
      else {
        const voting = isVoting(w, n);
        ctx.write(`${voting ? '⠋' : C.red('⚠')} ${S.fmtDur(w.t - t0).padStart(7)} | Processed Slot: ${slot(w) - Math.round(x.catchup)} | Confirmed Slot: ${slot(w) - Math.round(x.catchup)} | Finalized Slot: ${slot(w) - Math.round(x.catchup) - 1} | Full Snapshot Slot: ${x.snapSlot || slot(w) - 42000} | ${voting ? 'Voting' : C.red('NOT voting')} | Vote Account ${b < VOTE_FLOOR ? C.red('◎' + b.toFixed(6)) : '◎' + b.toFixed(6)}\n`);
      }
      await ctx.sleep(2);
    }
  };

  /* scp between the primary and the standby (they share an SSH key for the sol and root users) */
  const findHost = (w, key) => Object.values(w.nodes).find(x => x.id === key || x.hostname === key || x.ip === key);
  const scp = async ctx => {
    const w = ctx.w, args = ctx.args.filter(a => !/^-[pqrvC]+$/.test(a));
    if (args.length !== 2) return { code: 1, out: 'usage: scp [-p] source target\n' };
    const parse = x => { const m = /^(?:([\w.-]+)@)?([\w.-]+):(.*)$/.exec(x); return m ? { user: m[1], host: m[2], path: m[3] } : null; };
    const rs = parse(args[0]), rd = parse(args[1]), r = rs || rd;
    if (!r || (rs && rd)) return { code: 1, out: S.L('scp: 本练习只支持在本机和另一台节点之间拷贝：scp 文件 节点:/路径\n', 'scp: this lab supports copying between this host and one other node: scp FILE NODE:/PATH\n') };
    const user = r.user || ctx.sess.user;
    if (user !== 'root' && user !== 'sol') return { code: 255, out: `${user}@${r.host}: Permission denied (publickey).\nscp: Connection closed\n` };
    const remote = findHost(w, r.host);
    if (!remote) return { code: 255, out: `ssh: Could not resolve hostname ${r.host}: Name or service not known\nscp: Connection closed\n` };
    await ctx.sleep(1);
    if (remote.powered === false) return { code: 255, out: `ssh: connect to host ${r.host} port 22: Connection timed out\nscp: Connection closed\n` };
    const rhome = user === 'root' ? '/root' : '/home/sol';
    const rpath = p => S.norm(p.startsWith('/') ? p : rhome + '/' + p);
    const srcHost = rs ? remote : ctx.host, srcPath = rs ? rpath(rs.path) : ctx.resolve(args[0]);
    const dstHost = rd ? remote : ctx.host, dstPath = rd ? rpath(rd.path || '.') : ctx.resolve(args[1]);
    const f = S.fsGet(srcHost, srcPath);
    if (!f) return { code: 1, out: `scp: ${srcPath}: No such file or directory\n` };
    const base = srcPath.slice(srcPath.lastIndexOf('/') + 1);
    const isDir = S.fsIsDir(dstHost, dstPath) && !S.fsGet(dstHost, dstPath);
    const target = isDir ? S.norm(dstPath + '/' + base) : dstPath;
    if (!S.fsIsDir(dstHost, target.slice(0, target.lastIndexOf('/')) || '/')) return { code: 1, out: `scp: dest open "${dstPath}": No such file or directory\nscp: failed to upload file ${srcPath} to ${dstPath}\n` };
    const body = S.fsRead(w, srcHost, srcPath);
    S.fsWrite(dstHost, target, body, { mode: f.mode, owner: user === 'root' ? (f.owner || 'root') : 'sol', size: f.size, by: 'user', at: w.t });
    const size = f.size || body.length;
    return `${base.padEnd(52)} 100% ${size < 1024 ? size : (size / 1024).toFixed(0) + 'KB'}   ${(1.2 + w.rand()).toFixed(1)}MB/s   00:00\n`;
  };

  const nodeCommands = { solana, 'solana-keygen': solanaKeygen, 'agave-validator': agave, scp };
  const laptopCommands = {
    solana, 'solana-keygen': solanaKeygen,
    ssm: ctx => {
      const n = Object.values(ctx.w.nodes).find(x => x.id === ctx.args[0] || x.instanceId === ctx.args[0]);
      if (!n) return { code: 1, out: `${S.L('用法：ssm <节点名>。可选节点：', 'usage: ssm <node>. Nodes: ')}${Object.keys(ctx.w.nodes).join(' ')}\n` };
      if (n.powered === false) return { code: 254, out: `\nAn error occurred (TargetNotConnected) when calling the StartSession operation: ${n.instanceId} is not connected.\n` };
      ctx.sh.push({ host: n, user: 'ssm-user', cwd: '/home/ssm-user', env: { HOME: '/home/ssm-user', USER: 'ssm-user' } });
      return `\nStarting session with SessionId: ops-${n.id}-7f3e\n${C.gray(S.L(`已登录 ${n.hostname}（${n.region}）。sudo -i 切换到 root，exit 退出。`, `Connected to ${n.hostname} (${n.region}). sudo -i for root, exit to leave.`))}\n`;
    },
    aws: ctx => {
      const f = ctx.flags;
      if (f._[0] === 'ssm' && f._[1] === 'start-session') return laptopCommands.ssm(Object.assign({}, ctx, { args: [f.target] }));
      return { code: 2, out: C.gray(S.L('这个练习里用 ssm <节点名> 登录即可。\n', 'In this lab, log in with ssm <node>.\n')) };
    },
  };

  /* ---------- fresh install (step 2: run a validator from scratch, cfg.fresh) ----------
     A new Ubuntu host with nothing installed. Agave is built from a release tag, the operator
     writes validator.sh and the systemd unit, and startup checks fail the way agave-validator does. */
  const TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY', MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const BIN_MARK = 'ELF 64-bit LSB pie executable, x86-64';
  const OPS_WALLET = 'Hq3sRm8KvT2xNc7LbZp4Wd9Jf6Ya5GeU1kTn3Bw8XyQs';
  const SRC = { '4.3.2': '6d2a9e4c', '4.3.1': '51c8f0b3', '4.3.0': '3f0e2a1b', '4.2.5': '9c41d07e' };
  const TAG_RE = /^v4\.(3\.[0-2]|2\.5)$/;
  const SYSCTL_DEFAULT = { 'net.core.rmem_default': 212992, 'net.core.rmem_max': 212992, 'net.core.wmem_default': 212992, 'net.core.wmem_max': 212992, 'vm.max_map_count': 65530, 'fs.nr_open': 1048576 };
  const NET_KEYS = ['net.core.rmem_default', 'net.core.rmem_max', 'net.core.wmem_default', 'net.core.wmem_max'];
  const netOk = n => NET_KEYS.every(k => (n.sysctl[k] || 0) >= 134217728);
  const portsOpen = (n, lo, hi) => {
    for (let p = lo; p <= hi; p++) for (const pr of ['tcp', 'udp']) if (!n.ufw.rules.some(r => p >= r.lo && p <= r.hi && (r.proto === 'any' || r.proto === pr))) return false;
    return true;
  };
  const execBit = mode => /x/.test(mode || '') || /^[0-7]*[1357][0-7]{2}$/.test(mode || '');
  const binAt = (w, n, p) => { const c = S.fsRead(w, n, p); return c && c.startsWith(BIN_MARK) ? (/agave ([\d.]+)/.exec(c) || [])[1] || '?' : null; };
  const pathDirs = ctx => ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'].concat(String(ctx.sess.env.PATH || '').split(':').filter(Boolean));
  function binVersion(ctx, name) {
    if (ctx.name.includes('/')) return binAt(ctx.w, ctx.host, ctx.resolve(ctx.name));
    for (const d of pathDirs(ctx)) { const v = binAt(ctx.w, ctx.host, S.norm(d + '/' + name)); if (v) return v; }
    return null;
  }
  function failSvc(w, n, code) {
    const s = svc(n);
    s.state = 'failed'; s.exitStatus = code; sv(n).phase = null; sv(n).stoppedAt = w.t;
    S.log(w, n, 'agave-validator', 'SYS', `agave-validator.service: Main process exited, code=exited, status=${code}/${code === 203 ? 'EXEC' : 'FAILURE'}`);
    S.log(w, n, 'agave-validator', 'SYS', "agave-validator.service: Failed with result 'exit-code'.");
  }
  function startFresh(w, n) {
    const s = svc(n), x = sv(n), ch = w.chain;
    const sys = m => S.log(w, n, 'agave-validator', 'SYS', m), say = m => S.log(w, n, 'agave-validator', 'INFO', m);
    const unit = S.fsRead(w, n, UNIT) || '';
    s.pid = 2000 + Math.floor(w.rand() * 30000); s.since = w.t; s.state = 'active'; s.exitStatus = 0;
    Object.assign(x, { phase: null, gain: 25, identity: null, vote: null, catchup: 0 });
    const d = /^Description=(.*)$/m.exec(unit); if (d) s.desc = d[1];
    sys(`Started agave-validator.service - ${s.desc}.`);
    const em = /^ExecStart=(\S+)/m.exec(unit);
    if (!em) { sys('agave-validator.service: Service has no ExecStart=, ExecStop=, or SuccessAction=. Refusing.'); return failSvc(w, n, 1); }
    s.exec = em[1];
    const script = S.fsRead(w, n, em[1]);
    if (script === null) { sys(`agave-validator.service: Failed to locate executable ${em[1]}: No such file or directory`); return failSvc(w, n, 203); }
    if (!execBit(S.fsGet(n, em[1]).mode)) { sys(`agave-validator.service: Failed to execute ${em[1]}: Permission denied`); return failSvc(w, n, 203); }
    const user = (/^User=(\S+)/m.exec(unit) || [])[1] || 'root';
    const lines = script.replace(/\\\n/g, ' ').split('\n');
    const li = lines.findIndex(l => /(^|\s|\/)agave-validator(\s|$)/.test(l));
    if (li < 0) { say(`${em[1]} finished without starting agave-validator`); return failSvc(w, n, 1); }
    const toks = lines[li].trim().split(/\s+/).filter(t => t !== 'exec');
    const bin = toks[0];
    const envPath = ((/^Environment="?PATH=([^"\n]*)/m.exec(unit) || [])[1] || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin').split(':');
    const ver = bin.includes('/') ? binAt(w, n, bin) : envPath.map(dd => binAt(w, n, S.norm(dd + '/agave-validator'))).find(Boolean);
    if (!ver) { say(`${em[1]}: line ${li + 1}: exec: ${bin}: not found`); return failSvc(w, n, 127); }
    const opt = k => { const i = toks.indexOf(k); return i > 0 ? toks[i + 1] : undefined; };
    const all = k => toks.map((t, i) => (t === k ? toks[i + 1] : null)).filter(Boolean);
    const has = k => toks.includes(k);
    const fromSol = p => S.norm(p.startsWith('/') ? p : '/home/sol/' + p);
    // 1. OS network limits (checked before anything else)
    if (!has('--no-os-network-limits-test') && !netOk(n)) {
      say('OS network limit test failed. See: https://docs.anza.xyz/operations/guides/validator-start#system-tuning');
      return failSvc(w, n, 1);
    }
    // 2. identity keypair, read as the unit's User
    const idArg = opt('--identity');
    if (!idArg) { say('error: The following required arguments were not provided:\n    --identity <KEYPAIR>'); return failSvc(w, n, 2); }
    const idf = S.fsGet(n, fromSol(idArg));
    if (!idf) { say(`Error: Failed to read identity keypair from ${idArg}: No such file or directory (os error 2)`); return failSvc(w, n, 1); }
    if (user !== 'root' && /^[46]00$/.test(idf.mode || '') && idf.owner !== user) {
      say(`Error: Failed to read identity keypair from ${idArg}: Permission denied (os error 13)`);
      S.lesson(w, 'fresh-owner', S.LL('服务以 sol 用户运行', 'The service runs as sol'), S.LL('keypair 文件由 root 生成，权限是 600，属主是 root。unit 里写了 <code>User=sol</code>，进程读不到它。用 <code>chown sol:sol</code> 把属主改成 sol。', 'The keypair was generated by root with mode 600, so root owns it. The unit says <code>User=sol</code>, and the process cannot read the file. Give it to sol with <code>chown sol:sol</code>.'));
      return failSvc(w, n, 1);
    }
    const pk = pubkeyOf(w, S.fsRead(w, n, fromSol(idArg)));
    if (!pk) { say(`Error: Failed to read identity keypair from ${idArg}: invalid keypair`); return failSvc(w, n, 1); }
    // 3. vote account argument
    const va = opt('--vote-account');
    if (!va && !has('--no-voting')) { say('error: The following required arguments were not provided:\n    --vote-account <ADDRESS>'); return failSvc(w, n, 2); }
    const votePk = !va ? null : isPubkey(va) && !/\.json$/.test(va) ? va : pubkeyOf(w, S.fsRead(w, n, fromSol(va)));
    if (va && !votePk) { say(`error: Invalid value for '--vote-account <ADDRESS>': unable to read ${va}`); return failSvc(w, n, 2); }
    log(w, n, 'INFO', `validator] Starting validator with: identity ${pk}, vote account ${votePk || '(none, --no-voting)'}`);
    // 4. entrypoints, port reachability, genesis
    const eps = all('--entrypoint');
    if (!eps.length) { logm(w, n, 'ERROR', 'agave_validator', `no --entrypoint given and no genesis in ${LEDGER}; unable to join a cluster`); return failSvc(w, n, 1); }
    const onMainnet = eps.some(e => /mainnet/.test(e));
    const range = String(opt('--dynamic-port-range') || '8000-10000').split('-').map(Number);
    const hi = Math.min(range[1] || range[0], range[0] + 12);
    logm(w, n, 'INFO', 'solana_gossip::gossip_service', `Checking that tcp ports [${range[0]}, ${range[0] + 1}] and udp ports [${range[0]}..${hi}] are reachable from ${eps[0]}`);
    if (!portsOpen(n, range[0], hi)) {
      logm(w, n, 'ERROR', 'solana_net_utils', `Received no response at tcp/${range[0]}, check your port configuration`);
      logm(w, n, 'ERROR', 'agave_validator::bootstrap', 'Failed to verify reachable ports');
      return failSvc(w, n, 1);
    }
    const genesis = onMainnet ? MAINNET_GENESIS : TESTNET_GENESIS, exp = opt('--expected-genesis-hash');
    if (exp && exp !== genesis) { logm(w, n, 'ERROR', 'agave_validator', `Genesis hash mismatch: expected ${exp} but downloaded genesis hash is ${genesis}`); return failSvc(w, n, 1); }
    // 5. the vote account must already exist, belong to this identity, and the identity must be funded
    if (votePk) {
      const v = onMainnet ? null : ch.votes[votePk];
      const err = !v ? `vote account does not exist: ${votePk}` : v.identity !== pk ? `account's identity (${v.identity}) does not match the validator's identity ${pk}` : !((onMainnet ? ch.mainnetBal : ch.bal)[pk] > 0) ? `identity account does not exist: ${pk}` : null;
      if (err) { logm(w, n, 'ERROR', 'agave_validator::bootstrap', `Failed to check vote account: ${err}`); return failSvc(w, n, 1); }
    }
    if (!all('--known-validator').length) logm(w, n, 'WARN', 'agave_validator::bootstrap', 'No --known-validator given: a snapshot will be accepted from any RPC peer');
    x.identity = pk; x.vote = votePk; x.version = ver;
    const nf = (/^LimitNOFILE=(\S+)/m.exec(unit) || [])[1];
    x.nofile = nf === 'infinity' ? 1e9 : nf ? Number(nf) : 1024;
    // 6. snapshot: a new host has none, so it downloads one unless told not to
    const local = localSnapshot(n), remote = slot(w) - 760;
    if (has('--no-snapshot-fetch') && local === null) {
      logm(w, n, 'ERROR', 'solana_ledger::bank_forks_utils', `No snapshot archives found in ${LEDGER} and --no-snapshot-fetch was given. Unable to load a bank.`);
      return failSvc(w, n, 1);
    }
    if (local !== null && (has('--no-snapshot-fetch') || remote - local <= MAX_SNAP_AGE)) {
      logm(w, n, 'INFO', 'agave_validator::bootstrap', `Using the local snapshot at slot ${local}`);
      x.phase = 'load'; x.phaseUntil = w.t + 240; x.snapSlot = local;
      if (x.nofile < 1000000) { logm(w, n, 'ERROR', 'solana_ledger::blockstore', `Unable to increase the maximum open file descriptor limit to 1000000 from ${x.nofile}`); return failSvc(w, n, 1); }
      return;
    }
    logm(w, n, 'INFO', 'agave_validator::bootstrap', `Searching for an RPC service with a snapshot${has('--only-known-rpc') ? ' from a known validator (--only-known-rpc)' : ''}`);
    logm(w, n, 'INFO', 'agave_validator::bootstrap', `Highest local snapshot slot: ${local ?? 'none'}. Highest snapshot available: ${remote}; downloading`);
    x.phase = 'download'; x.phaseUntil = w.t + 150; x.snapSlot = remote; x.dlStart = w.t;
  }

  function freshCommands() {
    const gate = (name, fn) => ctx => binVersion(ctx, name) ? fn(ctx) : { code: 127, out: `bash: ${ctx.name}: command not found ${C.gray(S.L('（Agave 还没有安装到这台机器上）', '(Agave is not installed on this host yet)'))}\n` };
    const lsblk = ctx => { S.flag(ctx.w, 'fresh_disks'); return 'NAME         MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS\nnvme0n1      259:0    0   200G  0 disk \n├─nvme0n1p1  259:1    0 199.9G  0 part /\n└─nvme0n1p15 259:2    0    99M  0 part /boot/efi\nnvme1n1      259:3    0   2.9T  0 disk /mnt/ledger\nnvme2n1      259:4    0   1.9T  0 disk /mnt/accounts\n'; };
    const df = ctx => {
      S.flag(ctx.w, 'fresh_disks');
      const n = ctx.host, snaps = Object.keys(n.fs).filter(p => p.startsWith(LEDGER + '/') && /\.tar\.zst$/.test(p)).length;
      const run = svc(n).state === 'active' && sv(n).phase !== 'download';
      const rows = [['/dev/root', '194G', '6.4G', '188G', '4%', '/'], ['/dev/nvme1n1', '2.9T', snaps ? (run ? '96G' : '22G') : '28M', snaps ? '2.8T' : '2.9T', snaps ? '3%' : '1%', '/mnt/ledger'], ['/dev/nvme2n1', '1.9T', run && sv(n).phase === 'run' ? '312G' : '19M', run && sv(n).phase === 'run' ? '1.6T' : '1.9T', run && sv(n).phase === 'run' ? '17%' : '1%', '/mnt/accounts'], ['tmpfs', '189G', '0', '189G', '0%', '/dev/shm']];
      const want = ctx.args.filter(a => !a.startsWith('-')).map(a => ctx.resolve(a));
      const pick = want.length ? rows.filter(r => want.some(p => p === r[5] || (r[5] !== '/' && p.startsWith(r[5] + '/')))) : rows;
      return S.table(pick, ['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on']) + '\n';
    };
    const sysctl = ctx => {
      const n = ctx.host, a = ctx.args;
      const set = (k, v) => { if (!ctx.isRoot) return `sysctl: permission denied on key "${k}"\n`; n.sysctl[k] = Number(v); return `${k} = ${v}\n`; };
      const applyFile = p => {
        const c = S.fsRead(ctx.w, n, ctx.resolve(p));
        if (c === null) return { code: 255, out: `sysctl: cannot open "${p}": No such file or directory\n` };
        let out = '';
        c.split('\n').forEach(l => { const m = /^\s*([\w.]+)\s*=\s*(\S+)/.exec(l); if (m) out += set(m[1], m[2]); });
        return { code: 0, out };
      };
      if (a[0] === '-p') return applyFile(a[1] || '/etc/sysctl.conf');
      if (a[0] === '--system') {
        let out = '';
        S.fsList(n, '/etc/sysctl.d').filter(f => f.endsWith('.conf')).forEach(f => { out += `* Applying /etc/sysctl.d/${f} ...\n` + applyFile(`/etc/sysctl.d/${f}`).out; });
        return out + '* Applying /etc/sysctl.conf ...\n';
      }
      if (a[0] === '-w') { const m = /^([\w.]+)=(\S+)$/.exec(a[1] || ''); return m ? set(m[1], m[2]) : { code: 255, out: 'sysctl: "-w" requires KEY=VALUE\n' }; }
      if (!a.length || a[0] === '-a') return Object.keys(n.sysctl).sort().map(k => `${k} = ${n.sysctl[k]}`).join('\n') + '\n';
      let out = '', code = 0;
      a.filter(k => !k.startsWith('-')).forEach(k => { if (n.sysctl[k] === undefined) { out += `sysctl: cannot stat /proc/sys/${k.replace(/\./g, '/')}: No such file or directory\n`; code = 255; } else out += `${k} = ${n.sysctl[k]}\n`; });
      return { code, out };
    };
    const ufw = ctx => {
      const n = ctx.host, a = ctx.args;
      if (!ctx.isRoot) return { code: 1, out: 'ERROR: You need to be root to run this script\n' };
      if (a[0] === 'status') {
        if (!n.ufw.rules.length) return 'Status: active\n';
        const r = n.ufw.rules.map(x => `${x.lo === x.hi ? x.lo : x.lo + ':' + x.hi}${x.proto === 'any' ? '' : '/' + x.proto}`);
        return 'Status: active\n\nTo                         Action      From\n--                         ------      ----\n' + r.map(s => `${s.padEnd(27)}ALLOW       Anywhere`).concat(r.map(s => `${(s + ' (v6)').padEnd(27)}ALLOW       Anywhere (v6)`)).join('\n') + '\n';
      }
      if (a[0] === 'allow') {
        const m = /^(\d+)(?::(\d+))?(?:\/(tcp|udp))?$/.exec(a[1] || '');
        if (!m) return { code: 1, out: `ERROR: Bad port '${a[1] || ''}'\n` };
        if (m[2] && !m[3]) return { code: 1, out: "ERROR: Must specify 'tcp' or 'udp' with multiple ports\n" };
        const rule = { lo: +m[1], hi: +(m[2] || m[1]), proto: m[3] || 'any' };
        if (n.ufw.rules.some(r => r.lo === rule.lo && r.hi === rule.hi && r.proto === rule.proto)) return 'Skipping adding existing rule\nSkipping adding existing rule (v6)\n';
        n.ufw.rules.push(rule);
        return 'Rule added\nRule added (v6)\n';
      }
      return { code: 1, out: C.gray(S.L('本练习支持：ufw status、ufw allow 端口[:端口]/tcp|udp\n', 'Available here: ufw status, ufw allow PORT[:PORT]/tcp|udp\n')) };
    };
    const git = async ctx => {
      const n = ctx.host, a = ctx.args, sub = a[0];
      n.agaveSrc = n.agaveSrc || {};
      if (sub === 'clone') {
        const pos = []; let branch = null;
        for (let i = 1; i < a.length; i++) { if (a[i] === '--branch' || a[i] === '-b') { branch = a[++i]; continue; } if (a[i] === '--depth') { i++; continue; } if (a[i].startsWith('-')) continue; pos.push(a[i]); }
        if (!pos[0]) return { code: 129, out: 'usage: git clone [<options>] [--] <repo> [<dir>]\n' };
        const name = pos[1] || pos[0].replace(/\.git$/, '').split('/').pop(), dir = ctx.resolve(name);
        if (!/github\.com[/:]anza-xyz\/agave(\.git)?$/.test(pos[0])) return { code: 128, out: `Cloning into '${name}'...\nremote: Repository not found.\nfatal: repository '${pos[0]}' not found\n` };
        if (S.fsList(n, dir).length) return { code: 128, out: `fatal: destination path '${name}' already exists and is not an empty directory.\n` };
        if (!ctx.sh.canWrite(dir + '/x')) return { code: 1, out: `fatal: could not create work tree dir '${name}': Permission denied\n` };
        if (branch && !TAG_RE.test(branch) && branch !== 'master') return { code: 128, out: `Cloning into '${name}'...\nwarning: Could not find remote branch ${branch} to clone.\nfatal: Remote branch ${branch} not found in upstream origin\n` };
        ctx.write(`Cloning into '${name}'...\n`);
        await ctx.sleep(5);
        ['Cargo.toml', 'README.md', 'rust-toolchain.toml', 'validator/Cargo.toml', '.git/HEAD'].forEach(f => S.fsWrite(n, `${dir}/${f}`, '(source)\n', { owner: ctx.sess.user }));
        S.fsWrite(n, `${dir}/scripts/cargo-install-all.sh`, '#!/usr/bin/env bash\n# usage: cargo-install-all.sh [+<cargo version>] [options] <install directory>\n', { mode: '755', owner: ctx.sess.user });
        n.agaveSrc[dir] = branch || 'master';
        return 'remote: Enumerating objects: 9613, done.\nremote: Counting objects: 100% (9613/9613), done.\nremote: Compressing objects: 100% (7322/7322), done.\nremote: Total 9613 (delta 2190), reused 5106 (delta 1544), pack-reused 0 (from 0)\nReceiving objects: 100% (9613/9613), 21.84 MiB | 24.10 MiB/s, done.\nResolving deltas: 100% (2190/2190), done.\n' + (branch && branch !== 'master' ? `Note: switching to '${(SRC[branch.slice(1)] || '9c41d07e') + '2b5a'}'.\n\nYou are in 'detached HEAD' state.\n` : '');
      }
      const repo = Object.keys(n.agaveSrc).find(r => ctx.sess.cwd === r || ctx.sess.cwd.startsWith(r + '/'));
      if (!repo) return { code: 128, out: 'fatal: not a git repository (or any of the parent directories): .git\n' };
      if (sub === 'checkout' && a[1]) {
        if (!TAG_RE.test(a[1]) && a[1] !== 'master') return { code: 1, out: `error: pathspec '${a[1]}' did not match any file(s) known to git\n` };
        n.agaveSrc[repo] = a[1];
        return `Note: switching to '${a[1]}'.\n\nYou are in 'detached HEAD' state.\nHEAD is now at ${SRC[a[1].slice(1)] || '9c41d07e'} Bump version to ${a[1].replace(/^v/, '')}\n`;
      }
      if (sub === 'describe' || sub === 'status') return sub === 'describe' ? n.agaveSrc[repo] + '\n' : `HEAD detached at ${n.agaveSrc[repo]}\nnothing to commit, working tree clean\n`;
      return { code: 1, out: C.gray(S.L('本练习支持：git clone、git checkout、git describe --tags\n', 'Available here: git clone, git checkout, git describe --tags\n')) };
    };
    const build = async ctx => {
      const n = ctx.host, w = ctx.w;
      const self = ctx.name.includes('/') ? ctx.resolve(ctx.name) : ctx.resolve('scripts/cargo-install-all.sh');
      const repo = self.replace(/\/scripts\/cargo-install-all\.sh$/, ''), tag = (n.agaveSrc || {})[repo];
      if (!tag) return { code: 127, out: `bash: ${ctx.name}: No such file or directory\n` };
      const pos = ctx.args.filter(x => !x.startsWith('-') && !x.startsWith('+'));
      if (pos.length !== 1) return { code: 1, out: 'usage: cargo-install-all.sh [+<cargo version>] [options] <install directory>\n' };
      const dest = ctx.resolve(pos[0]);
      if (!ctx.sh.canWrite(dest + '/bin/x')) return { code: 1, out: `mkdir: cannot create directory '${dest}/bin': Permission denied\n` };
      const ver = tag === 'master' ? '4.4.0' : tag.slice(1);
      ctx.write(`+ cargo build --locked --release --bins\n${C.gray(S.L('（编译需要几分钟模拟时间，可以把右上角的时钟调快）', '(the build takes several simulated minutes; speed up the clock at the top right)'))}\n`);
      for (const crate of ['solana-sdk', 'agave-feature-set', 'solana-accounts-db', 'solana-runtime', 'solana-core', 'agave-validator']) {
        await ctx.sleep(50);
        if (ctx.sig.aborted) return { code: 130, out: '^C\n' };
        ctx.write(`   Compiling ${crate} v${ver} (${repo}/${crate.replace(/^(solana|agave)-/, '')})\n`);
      }
      ['agave-validator', 'agave-ledger-tool', 'agave-watchtower', 'solana', 'solana-keygen'].forEach(b => S.fsWrite(n, `${dest}/bin/${b}`, `${BIN_MARK}, dynamically linked (agave ${ver})`, { mode: '755', owner: ctx.sess.user, size: 182000000 }));
      return `    Finished \`release\` profile [optimized] target(s) in 5m 02s\n+ mkdir -p ${dest}/bin\n+ cp -fv target/release/agave-validator target/release/agave-ledger-tool target/release/agave-watchtower target/release/solana target/release/solana-keygen ${dest}/bin\n${tag === 'master' ? C.yellow(S.L('（这是 master 分支的开发版本，不是发布版本）', '(this is a development build from master, not a release)')) + '\n' : ''}${/^v4\.2\./.test(tag) ? C.yellow(S.L('（4.2 早于 Alpenglow，不能参与现在集群的共识。请用 v4.3.x）', '(4.2 predates Alpenglow and cannot take part in consensus on the cluster today; use v4.3.x)')) + '\n' : ''}Done after 302 seconds\n`;
    };
    const printf = ctx => {
      if (!ctx.args.length) return { code: 2, out: 'printf: usage: printf format [arguments]\n' };
      const rest = ctx.args.slice(1); let i = 0;
      return ctx.args[0].replace(/\\(n|t|\\)|%(s|%)/g, (m, e, f) => e === 'n' ? '\n' : e === 't' ? '\t' : e === '\\' ? '\\' : f === '%' ? '%' : (rest[i++] ?? ''));
    };
    const chown = ctx => {
      const pos = ctx.args.filter(a => !a.startsWith('-')), [spec, ...files] = pos, user = (spec || '').split(':')[0];
      if (!files.length) return { code: 1, out: `chown: missing operand after '${spec || ''}'\n` };
      if (!ctx.isRoot) return { code: 1, out: `chown: changing ownership of '${files[0]}': Operation not permitted\n` };
      if (!['sol', 'root', 'ubuntu'].includes(user)) return { code: 1, out: `chown: invalid user: '${spec}'\n` };
      let out = '', code = 0;
      files.forEach(f => {
        const p = ctx.resolve(f), file = S.fsGet(ctx.host, p);
        if (file) file.owner = user;
        else if (S.fsIsDir(ctx.host, p)) { if (S.hasFlag(ctx.args, '-R')) Object.keys(ctx.host.fs).filter(k => k.startsWith(p + '/')).forEach(k => { ctx.host.fs[k].owner = user; }); }
        else { out += `chown: cannot access '${f}': No such file or directory\n`; code = 1; }
      });
      return { code, out };
    };
    // systemctl on the new host: the unit does not exist until the operator writes it; enable --now enables and starts
    const systemctl = async ctx => {
      const n = ctx.host, K = S.commands.systemctl;
      const now = ctx.args.includes('--now'), args = ctx.args.filter(a => a !== '--now');
      const pos = args.filter(a => !a.startsWith('-')), sub = pos[0], names = pos.slice(1).map(x => x.replace(/\.service$/, ''));
      const sub2 = (a2, extra) => K(Object.assign({}, ctx, { args: a2.concat(extra || []) }));
      if (names.includes('agave-validator') && !S.fsGet(n, UNIT) && (ctx.isRoot || ['status', 'cat', 'is-active', 'is-enabled'].includes(sub))) {
        if (sub === 'status') return { code: 4, out: 'Unit agave-validator.service could not be found.\n' };
        if (sub === 'cat') return { code: 1, out: 'No files found for agave-validator.service.\n' };
        if (sub === 'is-active') return { code: 3, out: 'inactive\n' };
        if (sub === 'is-enabled') return { code: 1, out: 'Failed to get unit file state for agave-validator.service: No such file or directory\n' };
        if (sub === 'enable' || sub === 'disable') return { code: 1, out: `Failed to ${sub} unit: Unit file agave-validator.service does not exist.\n` };
        if (['start', 'restart', 'stop'].includes(sub)) return { code: 5, out: `Failed to ${sub} agave-validator.service: Unit agave-validator.service not found.\n` };
      }
      if ((sub === 'enable' || sub === 'disable') && ctx.isRoot) {
        const was = names.map(x => n.services[x] && n.services[x].enabled);
        const r = await sub2([sub], names);
        if (r && r.code) return r;
        let out = names.map((x, i) => x === 'agave-validator' && !!was[i] !== (sub === 'enable') ? (sub === 'enable' ? `Created symlink /etc/systemd/system/multi-user.target.wants/agave-validator.service → ${UNIT}.\n` : 'Removed "/etc/systemd/system/multi-user.target.wants/agave-validator.service".\n') : '').join('');
        if (now) { const r2 = await sub2([sub === 'enable' ? 'start' : 'stop'], names); out += (r2 && r2.out) || ''; return { code: (r2 && r2.code) || 0, out }; }
        return out;
      }
      return K(Object.assign({}, ctx, { args }));
    };
    const ulimit = ctx => (ctx.args.includes('-Hn') ? '1048576\n' : ctx.args.some(a => /n/.test(a)) ? '1024\n' : 'unlimited\n');
    return {
      'agave-validator': gate('agave-validator', agave), solana: gate('solana', solana), 'solana-keygen': gate('solana-keygen', solanaKeygen),
      nproc: () => '32\n', lsblk, df, sysctl, ufw, ulimit, git, 'cargo-install-all.sh': build, printf, chown, systemctl,
    };
  }

  // the first slot of epoch e minus the slots left before its end: toB seconds before the boundary into e+1
  const slotAt = (e, toB) => e * EPOCH + EPOCH - Math.round(toB * SLOTS_PER_SEC);
  function initFresh(w, cfg) {
    const fund = 'FuNd8m3XtTq6vLZkqk3vW8a2QVeG5r7cUTh2JbVyN1Ks';
    const e0 = cfg.epoch ?? 1131, slot0 = slotAt(e0, cfg.toBoundary ?? 8 * 3600);
    w.chain = { identity: null, vote: null, withdrawer: null, commission: null, bls: null, fund, slot0, lastVote: slot0 - 1, lastEpoch: e0, admitted: { [e0]: false, [e0 + 1]: false }, leaderSlots: 0, skippedSlots: 0, bal: { [fund]: 412.5 }, mainnetBal: { [OPS_WALLET]: 48.6 }, credits: 0, airdrops: 0, keyfiles: {}, snapshots: true, setIdentity: false, maintenance: null, noVoteSec: 0, fresh: true, votes: {}, issued: {}, everVoted: false, startEpoch: e0 };
    [fund, OPS_WALLET].forEach(pk => { w.chain.keyfiles[keyContent(pk)] = pk; });
    const n = S.makeHost({ id: 'sol-new', moniker: 'sol-new', hostname: 'sol-new', instanceId: 'i-0c7e5a3b1d9f24680', region: 'us-west-2', ip: '198.51.100.31', kind: 'node', homeUser: 'sol', role: 'primary', freshHost: true, mem: { total: 384 * 1024, used: 3 * 1024 }, disk: { size: 194, used: 6, dev: '/dev/root' }, cpus: 32, load: [0.04, 0.02, 0.0], upBase: 1800, bootAt: 0 });
    n.sol = { identity: null, catchup: 0, stoppedAt: null };
    n.sysctl = Object.assign({}, SYSCTL_DEFAULT);
    n.ufw = { rules: [] };
    ['/home/sol', LEDGER, '/mnt/accounts', '/tmp', '/root', '/home/ssm-user', '/opt', '/usr/local/bin', '/etc/sysctl.d', '/etc/systemd/system'].forEach(d => n.dirs.add(d));
    S.fsWrite(n, '/etc/os-release', 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.3 LTS (Noble Numbat)"\nID=ubuntu\n');
    S.fsWrite(n, '/etc/sysctl.d/99-sysctl.conf', '# Kernel system variables. See sysctl.d(5).\n');
    S.fsWrite(n, '/home/sol/.profile', '# ~/.profile: executed by the command interpreter for login shells.\n', { owner: 'sol' });
    n.services['agave-validator'] = { name: 'agave-validator', desc: 'agave-validator.service', unitPath: UNIT, state: 'inactive', enabled: false, since: 0, pid: 0, exec: '/home/sol/bin/validator.sh', memStr: () => (sv(n).phase === 'download' ? '6.1G' : sv(n).phase === 'load' ? '88.4G' : '214.7G'), tasks: 412 };
    n.services['amazon-ssm-agent'] = { name: 'amazon-ssm-agent', desc: 'amazon-ssm-agent', unitPath: '/etc/systemd/system/amazon-ssm-agent.service', state: 'active', since: -1800, pid: 812, exec: '/usr/bin/amazon-ssm-agent' };
    n.procs = () => (svc(n).state === 'active' ? [{ user: 'sol', pid: svc(n).pid, cpu: sv(n).phase === 'run' ? '1210' : '310', mem: '41.2', cmd: 'agave-validator --identity /home/sol/validator-keypair.json --ledger /mnt/ledger' }] : []);
    n.listening = () => (svc(n).state === 'active' ? [{ addr: '127.0.0.1:8899', proc: 'agave-validator', pid: svc(n).pid }, { addr: '0.0.0.0:8000', proc: 'agave-validator', pid: svc(n).pid }, { addr: '0.0.0.0:8001', proc: 'agave-validator', pid: svc(n).pid }] : []);
    n.commands = freshCommands();
    w.nodes['sol-new'] = n;
    S.fsWrite(w.laptop, '/home/ops/funding-testnet.json', keyContent(fund), { mode: '600', owner: 'ops' });
    S.fsWrite(w.laptop, '/home/ops/.config/solana/id.json', keyContent(OPS_WALLET), { mode: '600', owner: 'ops' });
    S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(
      '# 新 testnet 验证者：sol-new\n- 主机：sol-new（i-0c7e5a3b1d9f24680，198.51.100.31，us-west-2），用 ssm sol-new 登录\n- 系统盘之外有两块 NVMe，已挂载到 /mnt/ledger 和 /mnt/accounts，属主是 sol\n- 镜像里有 Rust 工具链和编译依赖；Agave 还没有安装\n- testnet 资金钥匙：~/funding-testnet.json\n- ~/.config/solana/id.json 是 CLI 的默认 keypair，里面是 mainnet 的 SOL，不要用于 testnet\n- 这台电脑上的 CLI 默认连接 mainnet；testnet 命令要加 -ut\n',
      '# New testnet validator: sol-new\n- host: sol-new (i-0c7e5a3b1d9f24680, 198.51.100.31, us-west-2); log in with ssm sol-new\n- two NVMe drives besides the system disk, mounted at /mnt/ledger and /mnt/accounts, owned by sol\n- the image has the Rust toolchain and build dependencies; Agave is not installed\n- testnet funding key: ~/funding-testnet.json\n- ~/.config/solana/id.json is the CLI default keypair and holds mainnet SOL; not for testnet work\n- the CLI on this workstation defaults to mainnet; testnet commands need -ut\n'));
  }

  /* ---------- alert rules (production names, thresholds and `for`) ---------- */
  const inst = '127.0.0.1:9201', who = w => `validator-sol-testnet - identity ${w.chain.identity}`;
  const rules = [
    { name: 'SolanaIdentityBalanceLow', severity: 'critical', for: 900, check: w => bal(w, w.chain.identity) < ID_FLOOR ? [{ instance: inst, summary: `Solana testnet identity balance ${bal(w, w.chain.identity).toFixed(2)} SOL, under the ${ID_FLOOR} SOL floor - ${who(w)}` }] : [] },
    { name: 'SolanaVoteAccountBalanceLow', severity: 'critical', for: 900, check: w => voteBal(w) < VOTE_FLOOR ? [{ instance: inst, summary: `Solana testnet vote account balance ${voteBal(w).toFixed(2)} SOL, under the ${VOTE_FLOOR} SOL floor - ${who(w)}` }] : [] },
    { name: 'SolanaValidatorDelinquent', severity: 'critical', for: 300, check: w => delinquent(w) ? [{ instance: inst, summary: `Solana testnet validator DELINQUENT - ${who(w)}` }] : [] },
    { name: 'SolanaVoteInactive', severity: 'critical', for: 600, check: w => delinquent(w) ? [{ instance: inst, summary: `Solana testnet validator NOT IN CURRENT VOTERS - ${who(w)}` }] : [] },
    { name: 'SolanaSlotsSeverelyBehind', severity: 'critical', for: 120, check: w => behind(w) > 1500 ? [{ instance: inst, summary: `Solana testnet validator SEVERELY BEHIND >1500 slots - ${who(w)}` }] : [] },
    { name: 'SolanaSkipRateHigh', severity: 'warning', for: 900, check: w => skipRate(w) > 20 && w.chain.leaderSlots > 20 ? [{ instance: inst, summary: `Solana TESTNET validator skip rate >20% (${skipRate(w).toFixed(0)}% of ${w.chain.leaderSlots} leader slots this epoch)` }] : [] },
  ].map(r => Object.assign({}, r, { check: w => (quiet(w) ? [] : r.check(w)) })); // a validator being built has nothing to alert on yet

  /* ---------- mechanism panel ---------- */
  const CERT_COL = { fast: '#b6f23a', slow: '#f5a623', skip: '#ff6b57' };
  const panel = {
    mount(el) {
      el.innerHTML = `<div class="mech-head"></div><div class="sol-wrap"></div><p class="mech-note">${S.L(`slot 为 200 ms，一个 epoch 约一天。投票是验证者之间直接发送的消息，不是交易。80% 的质押在第一轮投票，slot 即快速终结；60% 走两轮的慢路径；60% 投 skip 则生成 skip 证书。每到 epoch 边界，vote account 支付 ${TICKET} SOL 准入费，换取下一个 epoch 的席位。`, `A slot is 200 ms, and an epoch is about a day. Votes are messages sent directly between validators, not transactions. With 80% of stake in the first round a slot finalises at once; 60% takes the two-round slow path; 60% voting skip forms a skip certificate. At each epoch boundary the vote account pays a ${TICKET} SOL admission ticket for a place in the following epoch.`)}</p>`;
    },
    update(el, w) {
      const ch = w.chain, L = S.L, e = epoch(w), q = quiet(w);
      const vb = voteBal(w), ib = ch.identity ? bal(w, ch.identity) : 0, bh = q ? 0 : behind(w);
      el.querySelector('.mech-head').innerHTML = `<span class="mh-k">testnet · epoch ${e}</span><span class="mh-v">${(slotIndex(w) / EPOCH * 100).toFixed(1)}%</span><span class="mh-s">slot ${slot(w).toLocaleString()} · 200 ms · ${L('距边界', 'boundary in')} ${S.fmtDur(toBoundary(w))}</span>`;
      // Votor: the last 40 slots of the cluster, by certificate
      const s0 = slot(w) - 40, certs = Array.from({ length: 40 }, (_, i) => certOf(w, s0 + i));
      const cnt = k => certs.filter(c => c === k).length;
      const strip = `<svg viewBox="0 0 200 10" style="width:100%;height:12px;margin-top:.35rem" role="img" aria-label="certificates">${certs.map((c, i) => `<rect x="${i * 5}" y="0" width="4.2" height="10" rx="1" fill="${CERT_COL[c]}" opacity="${c === 'fast' ? 0.75 : 1}"/>`).join('')}</svg>`;
      const lw = ch.lastWindow;
      const SM = 'style="font-size:.8rem;font-family:var(--f-mono)"';
      const admitRow = k => { const v = ch.admitted[k]; return v === true ? `<b class="okc" ${SM}>${L('在集合中', 'in the set')}</b>` : v === false ? `<b class="badc" ${SM}>${L('被排除', 'left out')}</b>` : `<b ${SM}>—</b>`; };
      const why = admitReason(w), short = Math.max(0, ADMIT - vb);
      const nextTxt = !ch.vote ? L('还没有 vote account', 'no vote account yet') : !why ? L('满足条件', 'on track') : why === 'no BLS pubkey' ? L('缺 BLS 公钥', 'no BLS key') : L(`还差 ◎${short.toFixed(3)}`, `short by ◎${short.toFixed(3)}`);
      const nodes = Object.values(w.nodes).map(n => {
        const s = svc(n), v = isVoting(w, n);
        const x = n.sol, cu = Math.round(x.catchup).toLocaleString();
        const st = n.powered === false ? L('已断电', 'powered off') : s.state === 'failed' ? L('启动失败', 'failed') : s.state !== 'active' ? (n.freshHost && !ch.everVoted ? L('未启动', 'not started') : L('已停止', 'stopped')) : x.phase === 'download' ? L('下载快照中', 'downloading a snapshot') : x.phase === 'load' ? L('加载快照中', 'loading the snapshot') : x.catchup > 0 && x.gain < 0 ? L(`落后 ${cu} slots，差距还在扩大`, `${cu} slots behind and losing ground`) : x.catchup > 0 ? L(`追赶中，落后 ${cu} slots`, `catching up, ${cu} slots behind`) : v ? L('投票中', 'voting') : x.identity === ch.identity && ch.identity && !inSet(w) ? L('已同步，不在验证者集合中', 'in sync, not in the validator set') : L('运行中，未投票', 'running, not voting');
        const cls = s.state !== 'active' ? (n.role === 'backup' || (n.freshHost && s.state !== 'failed' && !ch.everVoted) ? '' : 'bad') : v ? 'ok' : x.gain < 0 ? 'bad' : 'warn';
        return `<div class="sol-node ${cls}"><div class="an-top"><b>${n.id}</b><span class="an-reg">${n.freshHost ? L('新主机', 'new host') : n.role === 'primary' ? L('主节点', 'primary') : L('备用机', 'standby')}</span><span class="pill ${cls}">${st}</span></div><div class="an-row"><span>identity</span><b class="mono">${s.state !== 'active' ? '—' : ch.fresh ? (x.identity ? x.identity.slice(0, 8) + '…' : '—') : n.sol.identity === ch.identity ? L('质押', 'staked') : L('非质押', 'unstaked')}</b></div></div>`;
      }).join('');
      const vMax = 8, iMax = 15;
      el.querySelector('.sol-wrap').innerHTML = `
        <div class="sol-gauges">
          <div class="g"><span class="k">${L('Votor · 最近 40 个 slot', 'Votor · last 40 slots')}</span><b>${L('终结约 0.1–0.15 秒', 'finality ≈ 0.1–0.15 s')}</b>${strip}<span class="s">${L('快速', 'fast')} ${cnt('fast')} · ${L('慢路径', 'slow')} ${cnt('slow')} · skip ${cnt('skip')}${lw ? ` · ${L('本验证者上一个 leader 窗口', 'our last leader window')} ${lw.slot}: ${lw.skipped ? L('skip 证书', 'skip certificates') : L('已出块', 'produced')}` : ''}</span></div>
          <div class="g"><span class="k">${L('准入（Validator Admission Ticket）', 'admission (Validator Admission Ticket)')}</span><div class="an-row" style="grid-template-columns:auto auto"><span>epoch ${e}</span>${admitRow(e)}<span>epoch ${e + 1}</span>${admitRow(e + 1)}<span>epoch ${e + 2}</span><b ${SM} class="${!ch.vote ? '' : why ? 'badc' : 'okc'}">${L('边界时决定', 'decided at the boundary')} · ${nextTxt}</b><span>BLS</span><b ${SM} class="${!ch.vote ? '' : ch.bls ? 'okc' : 'badc'}">${!ch.vote ? '—' : ch.bls ? L('已登记', 'registered') : L('未登记', 'not registered')}</b></div></div>
          <div class="g"><span class="k">${L('vote account 余额', 'vote account balance')}</span><b class="${!ch.vote ? '' : vb < ADMIT ? 'badc' : vb < VOTE_FLOOR ? 'warnc' : ''}">${ch.vote ? '◎ ' + vb.toFixed(3) : '—'}</b><span class="s">${L(`准入费 ${TICKET} + 免租 ${RENT_VOTE.toFixed(3)} = ${ADMIT.toFixed(3)} SOL/边界 · 告警线 ${VOTE_FLOOR} SOL`, `ticket ${TICKET} + rent ${RENT_VOTE.toFixed(3)} = ${ADMIT.toFixed(3)} SOL per boundary · alert at ${VOTE_FLOOR} SOL`)}</span><div class="bar"><i class="${vb < ADMIT ? 'b' : vb < VOTE_FLOOR ? 'w' : ''}" style="width:${Math.min(100, vb / vMax * 100)}%"></i><em style="left:${VOTE_FLOOR / vMax * 100}%"></em><em class="r" style="left:${ADMIT / vMax * 100}%"></em></div></div>
          <div class="g"><span class="k">${L('identity 余额', 'identity balance')}</span><b class="${!ch.identity ? '' : ib < ID_FLOOR ? 'badc' : ''}">${ch.identity ? '◎ ' + ib.toFixed(3) : '—'}</b><span class="s">${L(`签名、收出块收入、付普通交易费；不再付投票费 · 告警线 ${ID_FLOOR} SOL`, `signs, receives block revenue, pays ordinary fees; no vote fees · alert at ${ID_FLOOR} SOL`)}</span><div class="bar"><i class="${ib < ID_FLOOR ? 'b' : ''}" style="width:${Math.min(100, ib / iMax * 100)}%"></i><em class="r" style="left:${ID_FLOOR / iMax * 100}%"></em></div></div>
          <div class="g"><span class="k">${L('最后一票落后', 'last vote behind tip')}</span><b class="${bh > DELINQ ? 'badc' : ''}">${bh.toLocaleString()} slots</b><span class="s">${bh > DELINQ ? L('delinquent（超过 128，约 26 秒）', 'delinquent (over 128, about 26 s)') : L('正常（不超过 128）', 'normal (128 or less)')} · skip rate ${skipRate(w).toFixed(1)}% (${ch.skippedSlots || 0}/${ch.leaderSlots || 0})</span><div class="bar"><i class="${bh > DELINQ ? 'b' : ''}" style="width:${Math.min(100, bh / 256 * 100)}%"></i><em class="r" style="left:50%"></em></div></div>
          <div class="g"><span class="k">${L('本 epoch credits 与集群中位数之比', 'epoch credits vs cluster median')}</span><b>${ratio(w).toFixed(2)}×</b><span class="s">${L('迁移后 credits 字段记录的是奖励 lamports；只看与中位数之比', 'since the migration the credits field counts reward lamports; read it against the median')}</span></div>
        </div>
        <div class="sol-nodes">${nodes}</div>`;
    },
  };

  const LOGO = id => `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" x1="360.9" y1="-37.5" x2="141.2" y2="383.3" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="#0b0d12"/><g transform="translate(7 8.95) scale(.0453)" fill="url(#${id})"><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></g></svg>`;

  // leader windows already past in this epoch at t=0; those after downAt were skipped
  function initLeaders(w, downAt) {
    const ch = w.chain, start = -slotIndex(w) / SLOTS_PER_SEC;
    ch.leaderSlots = 0; ch.skippedSlots = 0;
    for (let k = Math.ceil((start - WIN0) / WINP); WIN0 + k * WINP < 0; k++) {
      const t = WIN0 + k * WINP, skipped = downAt != null && t >= downAt;
      ch.leaderSlots += 4; if (skipped) ch.skippedSlots += 4;
      ch.lastWindow = { slot: winSlot(w, t), skipped };
    }
  }

  S.registerNetwork({
    id: 'solana', name: 'Solana', color: '#b6f23a', logo: LOGO,
    desc: S.LL('Agave 验证者，Alpenglow 集群：200 ms 的 slot、Votor 证书、准入费与 epoch 边界、BLS 公钥、vote history 与主备切换。', 'Agave validators on an Alpenglow cluster: 200 ms slots, Votor certificates, the admission ticket and the epoch boundary, BLS keys, vote history and failover.'),
    /* cfg: balance (identity SOL), voteBalance, epoch, toBoundary (s until the next boundary), bls (default true),
       admittedNext (default true), credits, snapshots, setIdentity, maintenance, standby, staleRestart, mainnetWallet */
    init(w, cfg) {
      if (cfg.fresh) return initFresh(w, cfg);
      const identity = '7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv', vote = 'Gv4kQpS2mT8xWc6RbN3hJd9Fy7Ze5Ua1LrK2nHsXqPtM', fund = 'FuNd8m3XtTq6vLZkqk3vW8a2QVeG5r7cUTh2JbVyN1Ks', unstaked = 'Un5tkd9Yc2pQ4vTLm8rJx1DsoW7nHqA3eBfK6gZRyM2p', unstakedP = 'Un1qPw7Zk4rT9mVb2XyLc8HdJ3sFa6EgN5oKu1RtWe4B';
      const e0 = cfg.epoch ?? 1124, slot0 = slotAt(e0, cfg.toBoundary ?? 14 * 3600);
      w.chain = {
        identity, vote, fund, slot0, lastVote: slot0 - 1, lastEpoch: e0, bls: cfg.bls === false ? null : blsOf(identity),
        admitted: { [e0]: true, [e0 + 1]: cfg.admittedNext ?? true }, commission: 0,
        bal: { [identity]: cfg.balance ?? 14, [vote]: cfg.voteBalance ?? 7.2, [fund]: 412.5 }, mainnetBal: cfg.mainnetWallet ? { [OPS_WALLET]: 48.6 } : {},
        credits: cfg.credits ?? 16 * 0.985 * (slot0 % EPOCH), airdrops: 0, keyfiles: {}, snapshots: !!cfg.snapshots, setIdentity: !!cfg.setIdentity,
        maintenance: cfg.maintenance ? Object.assign({}, cfg.maintenance) : null, noVoteSec: 0, votes: {},
      };
      [identity, fund, unstaked, unstakedP, OPS_WALLET].forEach(pk => { w.chain.keyfiles[keyContent(pk)] = pk; });
      const hot = cfg.standby === 'unstaked';
      w.nodes['sol-1'] = makeNode(w, { id: 'sol-1', hostname: 'validator-sol-testnet-1', instanceId: 'mi-0a3e9c7b5d1f24680', region: 'us-west-1', ip: '198.51.100.21', role: 'primary', identityPath: '/home/sol/validator-keypair.json', unstaked: hot ? unstakedP : undefined, running: !cfg.staleRestart, noFetch: !!cfg.staleRestart });
      w.nodes['sol-backup'] = makeNode(w, { id: 'sol-backup', hostname: 'validator-sol-testnet-backup', instanceId: 'mi-0b4f8d6c2e0a13579', region: 'us-west-1', ip: '198.51.100.22', role: 'backup', identityPath: hot ? '/home/sol/unstaked-identity.json' : '/home/sol/validator-keypair.json', unstaked, running: hot, stakedHistory: !hot, unstakedHistory: hot });
      const downAt = cfg.staleRestart ? staleRestart(w, w.nodes['sol-1'], cfg.staleRestart) : null;
      initLeaders(w, downAt);
      S.fsWrite(w.laptop, '/home/ops/funding-testnet.json', keyContent(fund), { mode: '600', owner: 'ops' });
      if (cfg.mainnetWallet) S.fsWrite(w.laptop, '/home/ops/.config/solana/id.json', keyContent(OPS_WALLET), { mode: '600', owner: 'ops' });
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(`# testnet 验证者\n- identity: ${identity}\n- vote account: ${vote}\n- 资金钥匙（testnet）: ~/funding-testnet.json\n- withdrawer 离线保存，不在这台电脑上\n- 备用机 sol-backup 平时保持停止，切换步骤见运维手册\n`, `# testnet validator\n- identity: ${identity}\n- vote account: ${vote}\n- funding key (testnet): ~/funding-testnet.json\n- the withdrawer is kept offline, not on this workstation\n- standby sol-backup stays stopped; see the runbook for failover\n`));
    },
    tick, rules, panel, nodeCommands, laptopCommands,
    serviceAction(w, h, s, action) {
      if (s.name !== 'agave-validator') { s.state = action === 'stop' ? 'inactive' : 'active'; return; }
      if (action === 'stop') stop(w, h);
      else if (action === 'start') { if (s.state !== 'active') start(w, h); }
      else { stop(w, h); start(w, h); }
    },
    onRemoved(w, h, p) {
      if (!h.sol) return;
      const core = [`${LEDGER}/rocksdb`, `${LEDGER}/accounts`];
      if (p === LEDGER || core.some(d => p === d || p.startsWith(d + '/')) || /^\/mnt\/ledger\/vote_history-\w+\.bin$/.test(p)) S.flag(w, 'wipe_ledger');
    },
    helpers: {
      bal: w => bal(w, w.chain.identity), voteBal, delinquent, behind, isVoting, runningIdentity, unitIdentity, vhPath, inSet, epoch, toBoundary, admitReason,
      TICKET, RENT_VOTE, ADMIT, VOTE_FLOOR, ID_FLOOR, EPOCH_SEC,
      // fresh install
      pubkeyOf, netOk, portsOpen, execBit, binAt, testnetBal: (w, pk) => w.chain.bal[pk] ?? 0, TESTNET_GENESIS,
    },
  });
})(SIM);
