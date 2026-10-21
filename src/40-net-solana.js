/* ============================================================
   Network plugin: Solana (Agave validator)
   Mechanisms modelled:
   - slots (400 ms) and epochs (432,000 slots); leader-independent voting
   - every vote is a transaction paid by the identity → balance burns
   - lastVote vs tip; delinquent when more than 128 slots behind
   - TVC vote credits vs cluster median
   - one identity, one voter: a second machine with the staked key = double voting
   ============================================================ */
(function (S) {
  'use strict';
  const C = S.C;
  const SLOTS_PER_SEC = 2.5, EPOCH = 432000, VOTE_FEE = 0.000005;
  const LEDGER = '/mnt/ledger';

  function keyContent(pk) {
    let h = 0; for (const ch of pk) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const r = S.rng(h); return '[' + Array.from({ length: 64 }, () => Math.floor(r() * 256)).join(',') + ']';
  }
  const pubkeyOf = (w, content) => w.chain.keyfiles[String(content || '').trim()] || null;
  const slot = w => Math.floor(w.chain.slot0 + w.t * SLOTS_PER_SEC);
  const epoch = w => Math.floor(slot(w) / EPOCH);
  const slotIndex = w => slot(w) % EPOCH;
  const bal = (w, pk, cluster = 'testnet') => cluster === 'testnet' ? (w.chain.bal[pk] ?? 0) : (w.chain.mainnetBal[pk] ?? 0);
  const sv = n => n.sol;
  const svc = n => n.services['agave-validator'];
  const runningIdentity = (w, n) => svc(n).state === 'active' ? sv(n).identity : null;
  const isVoting = (w, n) => svc(n).state === 'active' && sv(n).catchup <= 0 && sv(n).identity === w.chain.identity && bal(w, w.chain.identity) >= VOTE_FEE && !w.chain.lockout;
  const behind = w => Math.max(0, slot(w) - w.chain.lastVote);
  const delinquent = w => behind(w) > 128;
  const median = w => 16 * 0.97 * slotIndexSince(w);
  const slotIndexSince = w => Math.max(1, slotIndex(w));
  const ratio = w => w.chain.credits / Math.max(1, median(w));

  function log(w, n, lvl, msg) { S.log(w, n, 'agave-validator', lvl, `[${S.isoTime(w.now())} ${lvl.padEnd(5)} solana_core::${msg}`); }
  function start(w, n) {
    const s = svc(n), x = sv(n);
    const unit = S.fsRead(w, n, '/etc/systemd/system/agave-validator.service') || '';
    const m = /--identity\s+(\S+)/.exec(unit);
    const kp = m ? S.fsRead(w, n, m[1]) : null;
    const pk = pubkeyOf(w, kp);
    s.pid = 2000 + Math.floor(w.rand() * 30000); s.since = w.t;
    if (!pk) { log(w, n, 'ERROR', `validator] Failed to read identity keypair ${m ? m[1] : '(none)'}`); s.state = 'failed'; return; }
    x.identity = pk; s.state = 'active';
    const down = x.stoppedAt != null ? w.t - x.stoppedAt : 0;
    x.catchup = 600 + down * SLOTS_PER_SEC;
    log(w, n, 'INFO', `validator] Starting validator with: identity ${pk}, vote account ${w.chain.vote}`);
    log(w, n, 'INFO', `validator] loading snapshot; then catching up ${Math.round(x.catchup)} slots`);
  }
  function stop(w, n) { const s = svc(n); if (s.state === 'active') log(w, n, 'INFO', 'validator] exit requested — shutting down'); s.state = 'inactive'; s.since = w.t; sv(n).stoppedAt = w.t; }

  function makeNode(w, sp) {
    const n = S.makeHost({ id: sp.id, moniker: sp.id, hostname: sp.hostname, instanceId: sp.instanceId, region: sp.region, ip: sp.ip, kind: 'node', homeUser: 'sol', role: sp.role, mem: { total: 512 * 1024, used: 301 * 1024 }, disk: { size: 3800, used: 1610, dev: '/dev/md1p1' }, cpus: 48, load: [21.4, 20.9, 20.1], upBase: 86400 * 9, bootAt: 0 });
    n.sol = { identity: null, catchup: 0, stoppedAt: null };
    S.fsWrite(n, '/home/sol/validator-keypair.json', keyContent(w.chain.identity), { mode: '600', owner: 'sol' });
    if (sp.unstaked) S.fsWrite(n, '/home/sol/unstaked-identity.json', keyContent(sp.unstaked), { mode: '600', owner: 'sol' });
    S.fsWrite(n, '/etc/systemd/system/agave-validator.service', `[Unit]\nDescription=Agave Validator (testnet)\nAfter=network-online.target\n\n[Service]\nUser=sol\nLimitNOFILE=1000000\nExecStart=/home/sol/.local/share/solana/install/active_release/bin/agave-validator \\\n  --identity ${sp.identityPath} \\\n  --vote-account ${w.chain.vote} \\\n  --ledger ${LEDGER} --rpc-port 8899 --dynamic-port-range 8000-8020 \\\n  --entrypoint entrypoint.testnet.solana.com:8001 --expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\\n  --limit-ledger-size --log -\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n`);
    S.fsWrite(n, '/home/sol/.config/solana/cli/config.yml', '---\njson_rpc_url: http://localhost:8899\nkeypair_path: /home/sol/validator-keypair.json\ncommitment: confirmed\n', { owner: 'sol' });
    S.fsWrite(n, `${LEDGER}/tower-1_9-${w.chain.identity}.bin`, '(tower)', { owner: 'sol' });
    n.dirs.add('/tmp'); n.dirs.add('/root'); n.dirs.add('/home/ssm-user');
    n.services['agave-validator'] = { name: 'agave-validator', desc: 'Agave Validator (testnet)', unitPath: '/etc/systemd/system/agave-validator.service', state: 'inactive', since: -86400 * 9, pid: 2231, exec: '/home/sol/.local/share/solana/install/active_release/bin/agave-validator --identity … --ledger /mnt/ledger', memStr: () => '301.2G', tasks: 412 };
    n.services['amazon-ssm-agent'] = { name: 'amazon-ssm-agent', desc: 'amazon-ssm-agent', unitPath: '/etc/systemd/system/amazon-ssm-agent.service', state: 'active', since: -86400 * 9, pid: 812, exec: '/usr/bin/amazon-ssm-agent' };
    n.procs = () => svc(n).state === 'active' ? [{ user: 'sol', pid: svc(n).pid, cpu: '1840', mem: '58.8', cmd: 'agave-validator --identity ' + sp.identityPath + ' --ledger /mnt/ledger' }] : [];
    n.listening = () => svc(n).state === 'active' ? [{ addr: '127.0.0.1:8899', proc: 'agave-validator', pid: svc(n).pid }, { addr: '*:8001', proc: 'agave-validator', pid: svc(n).pid }] : [];
    if (sp.running) { start(w, n); n.sol.catchup = 0; svc(n).since = -86400 * 9; (n.journal['agave-validator'] || []).forEach(e => { e.t = -86400 * 9; }); }
    return n;
  }

  function tick(w, dt) {
    const ch = w.chain;
    const voters = Object.values(w.nodes).filter(n => isVoting(w, n));
    
    Object.values(w.nodes).forEach(n => {
      const x = sv(n), s = svc(n);
      if (s.state === 'active' && x.catchup > 0) {
        x.catchup = Math.max(0, x.catchup - 25 * dt);
        if (Math.floor(w.t) % 30 < dt) log(w, n, 'INFO', `replay_stage] catching up: ${Math.round(x.catchup)} slots behind`);
      }
    });
    const stakedActive = Object.values(w.nodes).filter(n => svc(n).state === 'active' && sv(n).identity === ch.identity);
    if (stakedActive.length > 1 && !ch.lockout) {
      S.flag(w, 'double_sign');
      S.lesson(w, 'double', S.LL('一个 identity 只能在一台机器上投票', 'One identity, one voting machine'), S.LL('两台机器同时用质押 identity 运行，会签出相互矛盾的投票，tower 进入锁定，投票中断，并且这种行为可能被罚没。备用机平时应使用非质押 identity；切换时先让主节点用 set-identity 换成非质押 identity，再让备用机接管。', 'Two machines running the staked identity sign conflicting votes. The tower locks out, voting stops, and the behaviour can be slashed. A standby should run an unstaked identity; to fail over, first switch the primary to an unstaked identity with set-identity, then let the standby take over.'));
    }
    if (stakedActive.length > 1) ch.lockoutUntil = w.t + 1200;
    ch.lockout = w.t < (ch.lockoutUntil || -1);
    if (ch.lockout) {
      if (Math.floor(w.t) % 30 < dt) Object.values(w.nodes).forEach(n => { if (svc(n).state === 'active') log(w, n, 'ERROR', 'consensus] Tower lockout violation: duplicate vote detected for this identity on another node — refusing to vote'); });
    }
    if (voters.length >= 1 && !ch.lockout) {
      ch.lastVote = slot(w) - 1;
      ch.bal[ch.identity] = Math.max(0, ch.bal[ch.identity] - ch.burnPerDay / 86400 * dt);
      ch.credits += 16 * 0.985 * SLOTS_PER_SEC * dt;
      if (Math.floor(w.t) % 60 < dt) log(w, voters[0], 'INFO', `vote] voted slot ${slot(w) - 1} (latency 1)`);
    } else {
      const p = Object.values(w.nodes).find(n => n.role === 'primary');
      if (p && svc(p).state === 'active' && bal(w, ch.identity) < VOTE_FEE && Math.floor(w.t) % 30 < dt) log(w, p, 'ERROR', `vote] Failed to send vote transaction: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit. (identity ${ch.identity} balance 0)`);
    }
    if (ch.bal[ch.identity] < 0.5 && !ch.warnedEmpty) { ch.warnedEmpty = true; S.lesson(w, 'empty', S.LL('投票需要手续费', 'Votes cost fees'), S.LL('每一票都是一笔链上交易，手续费约 5000 lamports，由 identity 账户支付。余额用完后，投票交易无法提交。节点进程仍在运行，但在链上已经停止投票。', 'Every vote is an on-chain transaction with a fee of about 5000 lamports, paid by the identity account. When the balance runs out, vote transactions can no longer land. The process keeps running, but on chain the validator has stopped voting.')); }
    if (delinquent(w)) { ch.delinquentSec = (ch.delinquentSec || 0) + dt; if (!ch.saidDelinquent) { ch.saidDelinquent = true; S.lesson(w, 'delinq', S.LL('什么是 delinquent', 'What delinquent means'), S.LL('最后一票落后链头超过 128 个 slot（约 51 秒）后，整个网络会把这个验证者标记为 delinquent。此时它不再获得 vote credits，质押池也可能撤回委托。', 'When the last vote falls more than 128 slots (about 51 seconds) behind the tip, the network marks the validator delinquent. It earns no vote credits, and stake pools may withdraw their delegation.')); } }
    const e = epoch(w);
    if (e !== ch.lastEpoch) { if (ch.lastEpoch !== undefined) { S.event(w, 'sys', S.LL(`epoch ${e} 开始。上个 epoch 的 credits 比值为 ${ratio(w).toFixed(2)}。`, `Epoch ${e} started. Credits ratio for the previous epoch: ${ratio(w).toFixed(2)}.`)); ch.credits = 0; } ch.lastEpoch = e; }
    ch.minBal = Math.min(ch.minBal ?? 1e9, ch.bal[ch.identity]);
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
    await ctx.sleep(0.5);
    switch (sub) {
      case 'config': return `Config File: ${ctx.host.kind === 'laptop' ? '/home/ops/.config/solana/cli/config.yml' : '/home/sol/.config/solana/cli/config.yml'}\nRPC URL: ${ctx.host.kind === 'laptop' ? 'https://api.mainnet-beta.solana.com' : 'http://localhost:8899'}\nKeypair Path: ${ctx.host.kind === 'laptop' ? '/home/ops/.config/solana/id.json' : defaultKp}\nCommitment: confirmed\n${ctx.host.kind === 'laptop' ? C.gray(S.L('（默认连接 mainnet。查询 testnet 请加 -ut）', '(the default cluster is mainnet; add -ut for testnet)')) + '\n' : ''}`;
      case 'slot': return slot(w) + '\n';
      case 'epoch-info': return `Block height: ${slot(w) - 31337}\nSlot: ${slot(w)}\nEpoch: ${epoch(w)}\nTransaction Count: 39184623311\nEpoch Slot Range: [${epoch(w) * EPOCH}..${(epoch(w) + 1) * EPOCH})\nEpoch Completed Percent: ${(slotIndex(w) / EPOCH * 100).toFixed(3)}%\nEpoch Completed Slots: ${slotIndex(w)}/${EPOCH} (${EPOCH - slotIndex(w)} remaining)\nEpoch Completed Time: ${S.fmtDur(slotIndex(w) / SLOTS_PER_SEC)}/2days (${S.fmtDur((EPOCH - slotIndex(w)) / SLOTS_PER_SEC)} remaining)\n`;
      case 'address': return defaultKp ? pubkeyOf(w, S.fsRead(w, ctx.host, defaultKp)) + '\n' : 'Error: No such file or directory (os error 2)\n';
      case 'balance': {
        let pk = args[1];
        if (!pk && defaultKp) pk = pubkeyOf(w, S.fsRead(w, ctx.host, defaultKp));
        if (!pk) return { code: 1, out: 'Error: No such file or directory (os error 2)\n' };
        if (pk.endsWith('.json')) pk = pubkeyOf(w, ctx.read(pk));
        const b = bal(w, pk, cl);
        if (cl === 'testnet' && pk === ch.identity && b >= 10) markVerified(w);
        return `${b.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')} SOL\n${cl === 'mainnet' && pk === ch.identity ? C.gray(S.L('（这是 mainnet 上的余额。这台验证者在 testnet，请加 -ut）', '(this is the mainnet balance; the validator is on testnet, add -ut)')) + '\n' : ''}`;
      }
      case 'validators': {
        if (cl !== 'testnet') return `${C.gray(S.L('（这台验证者在 testnet，mainnet 列表里没有它。请加 -ut）', '(this validator is on testnet and not in the mainnet list; add -ut)'))}\n`;
        const ours = [delinquent(w) ? C.red('⚠') : ' ', ch.identity, ch.vote, '0%', String(w.chain.lastVote), String(w.chain.lastVote - 32), '0.00%', String(Math.round(w.chain.credits)), '4.3.0', '12.5 SOL (0.01%)'];
        if (bal(w, ch.identity) >= 10 && !delinquent(w)) markVerified(w);
        const rows = [ours, [' ', '5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on', 'GBU4potq4TjsmXtXv1X2N3tP8Kpt2k5sGxkPbDJmw6aS', '10%', String(slot(w) - 1), String(slot(w) - 33), '1.20%', String(Math.round(median(w))), '4.3.0', '1.2M SOL (0.77%)'], [' ', 'dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92', 'B6S9wMXqo7Vgm7RAA4oqpn6U6aCgeqoyD5ZvtPYa7b4s', '5%', String(slot(w) - 2), String(slot(w) - 34), '0.84%', String(Math.round(median(w) * 0.99)), '4.3.0', '980K SOL (0.63%)']];
        return S.table(rows, ['', 'Identity', 'Vote Account', 'Commission', 'Last Vote', 'Root Slot', 'Skip Rate', 'Credits', 'Version', 'Active Stake']) + `\n${delinquent(w) ? C.red(S.L(`Delinquent Stake: 12.5 SOL。本验证者在 delinquent 列表中，最后一票落后 ${behind(w)} slots`, `Delinquent Stake: 12.5 SOL. This validator is delinquent; its last vote is ${behind(w)} slots behind`)) : ''}\n`;
      }
      case 'vote-account': {
        if (args[1] !== ch.vote) return { code: 1, out: `Error: account ${args[1] || ''} not found or is not a vote account\n` };
        if (cl !== 'testnet') return { code: 1, out: `Error: account ${args[1]} not found ${C.gray(S.L('（这是 testnet 的 vote account，请加 -ut）', '(this is a testnet vote account; add -ut)'))}\n` };
        if (bal(w, ch.identity) >= 10 && !delinquent(w)) markVerified(w);
        return `Account Balance: 0.02685864 SOL\nValidator Identity: ${ch.identity}\nVote Authority: {${epoch(w)}: "${ch.identity}"}\nWithdraw Authority: 9pLq… (cold key, not on any node)\nCredits: ${Math.round(ch.credits)}\nCommission: 0%\nRoot Slot: ${ch.lastVote - 32}\nRecent Timestamp: ${S.isoTime(new Date(w.base + (w.t - behind(w) / SLOTS_PER_SEC) * 1000))} from slot ${ch.lastVote}\nEpoch Rewards:\n  epoch ${epoch(w) - 1}: credits ratio ${ratio(w).toFixed(3)} vs cluster median\n`;
      }
      case 'catchup': {
        if (!args.includes('--our-localhost') && ctx.host.kind === 'laptop') return { code: 1, out: S.L('Error: --our-localhost 只能在验证者机器上使用。在工作电脑上请用 solana validators -ut\n', 'Error: --our-localhost only works on the validator host. From the workstation use solana validators -ut\n') };
        const x = ctx.host.sol;
        if (!x || svc(ctx.host).state !== 'active') return { code: 1, out: 'Error: error sending request for url (http://localhost:8899/): Connection refused\n' };
        if (x.catchup > 0) return `${x.identity} has ${Math.round(x.catchup)} slot(s) behind (us:${slot(w) - Math.round(x.catchup)} them:${slot(w)}), our node is gaining at 25.0 slots/second (average 24.9 slots/second, ETA: ${S.fmtDur(x.catchup / 25)})\n`;
        if (bal(w, ch.identity) >= 10 && !delinquent(w)) markVerified(w);
        return `${x.identity} has caught up (us:${slot(w)} them:${slot(w)})\n`;
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
        const from = S.opt(ctx.args, ['--from', '-k']);
        if (!to || !(amt > 0)) return { code: 1, out: 'usage: solana transfer <RECIPIENT> <AMOUNT> --from <KEYPAIR> [--fee-payer <KEYPAIR>]\n' };
        if (!from) return { code: 1, out: `Error: Dynamic program error: No default signer found, run "solana-keygen new -o ${ctx.host.kind === 'laptop' ? '/home/ops' : '/home/sol'}/.config/solana/id.json" to create a new one ${C.gray(S.L('（用 --from 指定付款的 keypair 文件）', '(pass the paying keypair with --from)'))}\n` };
        const fromPk = pubkeyOf(w, ctx.read(from));
        if (!fromPk) return { code: 1, out: `Error: could not read keypair file "${from}"\n` };
        const book = cl === 'testnet' ? ch.bal : ch.mainnetBal;
        if ((book[fromPk] || 0) < amt + 0.000005) return { code: 1, out: `Error: Account ${fromPk} has insufficient funds for spend (${amt} SOL) + fee (0.000005 SOL)${cl === 'mainnet' ? C.gray(S.L('  （当前操作的是 mainnet。这台验证者在 testnet，请加 -ut）', '  (this ran against mainnet; the validator is on testnet, add -ut)')) : ''}\n` };
        await ctx.sleep(1.5);
        book[fromPk] -= amt + 0.000005; book[to] = (book[to] || 0) + amt;
        if (cl === 'testnet' && to === ch.identity) S.event(w, 'ok', S.LL(`向 identity 转入 ${amt} SOL（testnet），当前余额 ${bal(w, to).toFixed(3)} SOL。`, `Transferred ${amt} SOL to the identity (testnet). Balance is now ${bal(w, to).toFixed(3)} SOL.`));
        return `\nSignature: 3vZ8kq${Math.floor(w.rand() * 1e9).toString(36)}…\n\n`;
      }
      default:
        return { code: 1, out: `${C.gray(S.L('本练习支持：', 'Available in this lab: ') + 'solana config get · slot · epoch-info · balance [PK] · validators · vote-account VOTE · catchup --our-localhost · transfer TO AMT --from KP · airdrop AMT PK（集群用 -ut / -um / --url）')}\n` };
    }
  };
  function markVerified(w) { if (!w.flags.verified) { S.flag(w, 'verified'); S.event(w, 'ok', S.LL('已通过链上数据确认验证者状态。', 'Validator status confirmed from on-chain data.')); } }
  const solanaKeygen = ctx => {
    const [sub, file] = ctx.args;
    if (sub !== 'pubkey' || !file) return { code: 1, out: 'usage: solana-keygen pubkey <KEYPAIR_FILE>\n' };
    const c = ctx.read(file);
    if (c === null) return { code: 1, out: `Error: No such file or directory (os error 2)\n` };
    if (!ctx.sh.canRead(ctx.resolve(file))) return { code: 1, out: 'Error: Permission denied (os error 13)\n' };
    return (pubkeyOf(ctx.w, c) || 'Error: invalid keypair') + '\n';
  };
  const agave = async ctx => {
    const w = ctx.w, n = ctx.host;
    if (ctx.args.includes('--version')) return 'agave-validator 4.3.0 (src:3f0e2a1b; feat:1438204551, client:Agave)\n';
    const sub = ctx.args.find(a => ['monitor', 'exit', 'set-identity', 'contact-info'].includes(a));
    if (!n.sol || svc(n).state !== 'active') return { code: 1, out: `Error: Unable to connect to validator admin RPC at ${LEDGER}/admin.rpc (is the validator running?)\n` };
    if (sub === 'exit') { if (!ctx.isRoot && ctx.sess.user !== 'sol') return { code: 1, out: 'Error: Permission denied (admin.rpc)\n' }; stop(w, n); S.log(w, n, 'agave-validator', 'SYS', 'agave-validator.service: Scheduled restart job (Restart=on-failure not triggered by clean exit)'); return 'Exit request sent\n'; }
    if (sub === 'contact-info') return `Identity: ${n.sol.identity}\nGossip: ${n.ip}:8001\nTPU: ${n.ip}:8003\nRPC: 127.0.0.1:8899\n`;
    if (sub === 'set-identity') return { code: 1, out: C.gray(S.L('本练习不需要用到 set-identity。\n', 'set-identity is not needed in this lab.\n')) };
    if (sub !== 'monitor') return { code: 1, out: 'usage: agave-validator --ledger /mnt/ledger monitor|exit|contact-info\n' };
    ctx.write(`Ledger location: ${LEDGER}\nIdentity: ${n.sol.identity}\nGenesis Hash: 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY\nVersion: 4.3.0\nShred Version: 64475\nGossip Address: ${n.ip}:8001\nTPU Address: ${n.ip}:8003\n${C.gray(S.L('（Ctrl+C 退出）', '(Ctrl+C to stop)'))}\n`);
    const t0 = w.t;
    while (!ctx.sig.aborted) {
      const x = n.sol, b = bal(w, w.chain.identity);
      const voting = isVoting(w, n);
      ctx.write(`${voting ? '⠋' : C.red('⚠')} ${S.fmtDur(w.t - t0).padStart(7)} | Processed Slot: ${slot(w) - Math.round(x.catchup)} | Confirmed Slot: ${slot(w) - Math.round(x.catchup) - 1} | Finalized Slot: ${slot(w) - 32} | Full Snapshot Slot: ${slot(w) - 21000} | ${voting ? 'Voting' : C.red('NOT voting')} | ${b < 5 ? C.red('◎' + b.toFixed(6)) : '◎' + b.toFixed(6)}\n`);
      await ctx.sleep(2);
    }
  };

  const nodeCommands = { solana, 'solana-keygen': solanaKeygen, 'agave-validator': agave };
  const laptopCommands = {
    solana, 'solana-keygen': solanaKeygen,
    ssm: ctx => {
      const n = Object.values(ctx.w.nodes).find(x => x.id === ctx.args[0] || x.instanceId === ctx.args[0]);
      if (!n) return { code: 1, out: `${S.L('用法：ssm <节点名>。可选节点：', 'usage: ssm <node>. Nodes: ')}${Object.keys(ctx.w.nodes).join(' ')}\n` };
      ctx.sh.push({ host: n, user: 'ssm-user', cwd: '/home/ssm-user', env: { HOME: '/home/ssm-user', USER: 'ssm-user' } });
      return `\nStarting session with SessionId: ops-${n.id}-7f3e\n${C.gray(S.L(`已登录 ${n.hostname}（${n.region}）。sudo -i 切换到 root，exit 退出。`, `Connected to ${n.hostname} (${n.region}). sudo -i for root, exit to leave.`))}\n`;
    },
    aws: ctx => {
      const f = ctx.flags;
      if (f._[0] === 'ssm' && f._[1] === 'start-session') return laptopCommands.ssm(Object.assign({}, ctx, { args: [f.target] }));
      return { code: 2, out: C.gray(S.L('这个练习里用 ssm <节点名> 登录即可。\n', 'In this lab, log in with ssm <node>.\n')) };
    },
  };

  /* ---------- alert rules (alerting/chain/solana-onchain.yaml) ---------- */
  const inst = '127.0.0.1:9201';
  const rules = [
    { name: 'SolanaIdentityBalanceLow', severity: 'warning', for: 900, check: w => bal(w, w.chain.identity) < 8 ? [{ instance: inst, summary: `Solana testnet identity balance LOW ${bal(w, w.chain.identity).toFixed(2)} SOL - validator-sol-testnet - identity ${w.chain.identity}` }] : [] },
    { name: 'SolanaIdentityBalanceCritical', severity: 'critical', for: 300, check: w => bal(w, w.chain.identity) < 5 ? [{ instance: inst, summary: `Solana testnet identity balance CRITICAL ${bal(w, w.chain.identity).toFixed(2)} SOL - validator-sol-testnet` }] : [] },
    { name: 'SolanaValidatorDelinquent', severity: 'critical', for: 300, check: w => delinquent(w) ? [{ instance: inst, summary: `Solana testnet validator DELINQUENT - validator-sol-testnet - identity ${w.chain.identity}` }] : [] },
    { name: 'SolanaVoteInactive', severity: 'critical', for: 600, check: w => delinquent(w) ? [{ instance: inst, summary: 'Solana testnet validator NOT IN CURRENT VOTERS - validator-sol-testnet' }] : [] },
  ];

  const panel = {
    mount(el) {
      el.innerHTML = `<div class="mech-head"></div><div class="sol-wrap"></div><p class="mech-note">${S.L('每个 slot 约 400 ms。验证者每个 slot 投一票，每票是一笔由 identity 支付手续费的交易。最后一票落后链头超过 128 个 slot，即被标记为 delinquent。', 'A slot is about 400 ms. The validator votes once per slot, and each vote is a transaction whose fee the identity pays. A validator whose last vote is more than 128 slots behind the tip is marked delinquent.')}</p>`;
    },
    update(el, w) {
      const ch = w.chain, b = bal(w, ch.identity), bh = behind(w), L = S.L;
      el.querySelector('.mech-head').innerHTML = `<span class="mh-k">testnet · epoch ${epoch(w)}</span><span class="mh-v">${(slotIndex(w) / EPOCH * 100).toFixed(1)}%</span><span class="mh-s">slot ${slot(w).toLocaleString()}</span>`;
      const runway = ch.burnPerDay > 0 ? b / ch.burnPerDay * 86400 : Infinity;
      const nodes = Object.values(w.nodes).map(n => {
        const s = svc(n), v = isVoting(w, n);
        const st = s.state !== 'active' ? L('已停止', 'stopped') : n.sol.catchup > 0 ? L(`追赶中，落后 ${Math.round(n.sol.catchup)} slots`, `catching up, ${Math.round(n.sol.catchup)} slots behind`) : v ? L('投票中', 'voting') : L('运行中，未投票', 'running, not voting');
        const cls = s.state !== 'active' ? (n.role === 'backup' ? '' : 'bad') : v ? 'ok' : 'warn';
        return `<div class="sol-node ${cls}"><div class="an-top"><b>${n.id}</b><span class="an-reg">${n.role === 'primary' ? L('主节点', 'primary') : L('备用机', 'standby')}</span><span class="pill ${cls}">${st}</span></div><div class="an-row"><span>identity</span><b class="mono">${s.state === 'active' ? (n.sol.identity === ch.identity ? L('质押', 'staked') : L('非质押', 'unstaked')) : '—'}</b></div></div>`;
      }).join('');
      el.querySelector('.sol-wrap').innerHTML = `
        <div class="sol-gauges">
          <div class="g"><span class="k">${L('identity 余额', 'identity balance')}</span><b class="${b < 5 ? 'badc' : b < 8 ? 'warnc' : ''}">◎ ${b.toFixed(3)}</b><span class="s">${ch.burnPerDay} SOL/${L('天', 'day')} · ${L('可用', 'lasts')} ${runway === Infinity ? '∞' : S.fmtDur(runway)}</span><div class="bar"><i class="${b < 5 ? 'b' : b < 8 ? 'w' : ''}" style="width:${Math.min(100, b / 12 * 100)}%"></i><em style="left:${8 / 12 * 100}%"></em><em class="r" style="left:${5 / 12 * 100}%"></em></div></div>
          <div class="g"><span class="k">${L('最后一票落后', 'last vote behind tip')}</span><b class="${bh > 128 ? 'badc' : ''}">${bh.toLocaleString()} slots</b><span class="s">${bh > 128 ? L('delinquent（超过 128）', 'delinquent (over 128)') : L('正常（不超过 128）', 'normal (128 or less)')}</span><div class="bar"><i class="${bh > 128 ? 'b' : ''}" style="width:${Math.min(100, bh / 256 * 100)}%"></i><em class="r" style="left:50%"></em></div></div>
          <div class="g"><span class="k">${L('本 epoch credits 与集群中位数之比', 'epoch credits vs cluster median')}</span><b>${ratio(w).toFixed(2)}×</b><span class="s">${L('按 TVC 计分：每票最多 16 分，落地越晚分数越低', 'Timely vote credits: up to 16 per vote, fewer the later it lands')}</span></div>
        </div>
        <div class="sol-nodes">${nodes}</div>`;
    },
  };

  const LOGO = id => `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" x1="360.9" y1="-37.5" x2="141.2" y2="383.3" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="#0b0d12"/><g transform="translate(7 8.95) scale(.0453)" fill="url(#${id})"><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/><path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"/><path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></g></svg>`;

  S.registerNetwork({
    id: 'solana', name: 'Solana', color: '#b6f23a', logo: LOGO,
    desc: S.LL('Agave 验证者：slot 与 epoch、投票交易与手续费、delinquent 的判定、identity 与备用机。', 'Agave validators: slots and epochs, vote transactions and their fees, delinquency, identities and standby machines.'),
    init(w, cfg) {
      const identity = '7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv', vote = 'Gv4kQpS2mT8xWc6RbN3hJd9Fy7Ze5Ua1LrK2nHsXqPtM', fund = 'FuNd8m3XtTq6vLZkqk3vW8a2QVeG5r7cUTh2JbVyN1Ks', unstaked = 'Un5tkd9Yc2pQ4vTLm8rJx1DsoW7nHqA3eBfK6gZRyM2p';
      w.chain = { identity, vote, fund, slot0: 312906864, lastVote: 312906863, bal: { [identity]: cfg.balance ?? 9.4, [fund]: 412.5 }, mainnetBal: {}, burnPerDay: cfg.burnPerDay ?? 2.1, credits: 16 * 0.985 * (312906864 % EPOCH), airdrops: 0, keyfiles: {} };
      [identity, fund, unstaked].forEach(pk => { w.chain.keyfiles[keyContent(pk)] = pk; });
      w.nodes['sol-1'] = makeNode(w, { id: 'sol-1', hostname: 'validator-sol-testnet-1', instanceId: 'mi-0a3e9c7b5d1f24680', region: 'us-west-1', ip: '198.51.100.21', role: 'primary', identityPath: '/home/sol/validator-keypair.json', running: true });
      w.nodes['sol-backup'] = makeNode(w, { id: 'sol-backup', hostname: 'validator-sol-testnet-backup', instanceId: 'mi-0b4f8d6c2e0a13579', region: 'us-west-1', ip: '198.51.100.22', role: 'backup', identityPath: '/home/sol/validator-keypair.json', unstaked, running: false });
      S.fsWrite(w.laptop, '/home/ops/funding-testnet.json', keyContent(fund), { mode: '600', owner: 'ops' });
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(`# testnet 验证者\n- identity: ${identity}\n- vote account: ${vote}\n- 资金钥匙（testnet）: ~/funding-testnet.json\n- 备用机 sol-backup 平时保持停止，切换步骤见运维手册\n`, `# testnet validator\n- identity: ${identity}\n- vote account: ${vote}\n- funding key (testnet): ~/funding-testnet.json\n- standby sol-backup stays stopped; see the runbook for failover\n`));
    },
    tick, rules, panel, nodeCommands, laptopCommands,
    serviceAction(w, h, s, action) {
      if (s.name !== 'agave-validator') { s.state = action === 'stop' ? 'inactive' : 'active'; return; }
      if (action === 'stop') stop(w, h);
      else if (action === 'start') { if (s.state !== 'active') start(w, h); }
      else { stop(w, h); start(w, h); }
    },
    helpers: { bal: (w) => bal(w, w.chain.identity), delinquent, behind, isVoting },
  });
})(SIM);
