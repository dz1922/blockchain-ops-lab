/* ============================================================
   Solana production labs S1–S3 (Alpenglow cluster).
   Text fields are bilingual: S.LL(zh, en).
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL;
  const nodes = w => Object.values(w.nodes);
  const SOL = LL('Solana 验证者运维', 'Solana validator operations');

  /* ---------- Solana labs S1–S3 (Alpenglow cluster) ---------- */
  const SH = () => S.networks.solana.helpers;
  const STAKED = '7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv', VOTEACC = 'Gv4kQpS2mT8xWc6RbN3hJd9Fy7Ze5Ua1LrK2nHsXqPtM';
  const S1_TO_BOUNDARY = 9600; // 2 h 40 min to the boundary into epoch N+1, which decides N+2

  S.registerScenario({
    id: 'sol-balance', network: 'solana', module: SOL, lab: 'S1', difficulty: 2, minutes: 10,
    title: LL('vote account 余额告警', 'Vote account balance alert'),
    tagline: LL('vote account 余额告警已经确认了好几天，下一个 epoch 边界还有不到三小时。', 'The vote account alert has sat acknowledged for days, and the next epoch boundary is less than three hours away.'),
    learn: [
      LL('准入费从哪个账户扣、什么时候扣，以及 N+1 与 N+2 的时间关系', 'Which account pays the admission ticket, when it is debited, and how N+1 and N+2 are decided'),
      LL('给 vote account 充值，而不是给 identity；两个账户各有自己的下限', 'Funding the vote account rather than the identity, and keeping both accounts above their floors'),
      LL('分清 testnet 与 mainnet；确认告警不等于处理了告警', 'Keeping testnet and mainnet apart, and why acknowledging a page is not fixing it'),
    ],
    brief: LL(
      `<p>周二 09:20 UTC。Solana testnet 验证者的 <code>SolanaVoteAccountBalanceLow</code> 从上周四起一直处于触发状态。当时有人在值班频道里确认了它，跟进的事却没人接手；确认过的告警不会再打电话。交接记录只写了一句："vote account 告警已确认，identity 余额正常，下周再看。"</p><p>在 Alpenglow 集群上，vote account 在每个 epoch 边界支付准入费，换取下一个 epoch 的席位。<code>solana epoch-info -ut</code> 显示当前 epoch 还剩不到三小时。</p><p>弄清这个告警对即将到来的边界意味着什么，处理它，并用链上数据确认验证者保住了席位。告警阈值：vote account 低于 5 SOL，identity 低于 9 SOL，持续 15 分钟即为 critical。</p>`,
      `<p>Tuesday, 09:20 UTC. <code>SolanaVoteAccountBalanceLow</code> has been firing for a Solana testnet validator since last Thursday. Someone acknowledged it in the on-call channel, and the follow-up was never picked up; an acknowledged alert does not page again. The handover note reads: "vote account alert acked, identity balance is fine, will look next week."</p><p>On an Alpenglow cluster the vote account pays an admission ticket at every epoch boundary for a place in the following epoch. <code>solana epoch-info -ut</code> shows less than three hours left in the current epoch.</p><p>Work out what the alert means for the coming boundary, fix it, and confirm from on-chain data that the validator keeps its place. Alert thresholds: vote account below 5 SOL and identity below 9 SOL, each critical after 15 minutes.</p>`),
    startAt: '2026-11-10T09:20:00Z', alertAge: 5 * 86400,
    config: { balance: 9.6, voteBalance: 0.81, epoch: 1127, toBoundary: S1_TO_BOUNDARY, mainnetWallet: true },
    setup(w) { w.chain.s1Epoch = SH().epoch(w); },
    objectives: [
      { text: LL('vote account 余额不低于 5 SOL（testnet）', 'The vote account holds at least 5 SOL (testnet)'), check: w => SH().voteBal(w) >= 5 },
      { text: LL('identity 余额不低于 9 SOL（testnet）', 'The identity holds at least 9 SOL (testnet)'), check: w => SH().bal(w) >= 9 },
      { text: LL('epoch 边界已过，验证者被选入再下一个 epoch（N+2）', 'The epoch boundary has passed and the validator is admitted to the epoch after next (N+2)'), check: w => w.chain.admitted[w.chain.s1Epoch + 2] === true },
      { text: LL('验证者正在投票，没有 delinquent', 'The validator is voting and not delinquent'), check: w => !SH().delinquent(w) && SH().isVoting(w, w.nodes['sol-1']) },
      { text: LL('充值后用链上数据确认一次（solana vote-account、balance 或 validators）', 'After funding, confirm once from on-chain data (solana vote-account, balance or validators)'), check: w => w.flags.verified !== undefined },
    ],
    forbidden: [
      { flag: 'mainnet_spend', text: LL('处理 testnet 验证者时花掉了 mainnet 的 SOL', 'Spending mainnet SOL while working on a testnet validator') },
      { flag: 'double_sign', text: LL('让两台机器同时使用质押 identity（备用机 sol-backup 配置的是同一个 identity）', 'Running the staked identity on two machines at once (the standby sol-backup is configured with the same identity)') },
    ],
    hints: [
      { text: LL('先读交接笔记，再查两个账户在 testnet 上的余额。工作电脑上的 CLI 默认连接 mainnet，所以每条命令都要加 <code>-ut</code>。', 'Read the handover notes, then check both balances on testnet. The CLI on this workstation defaults to mainnet, so every command needs <code>-ut</code>.'),
        cmds: ['cat ~/NOTES.md', `solana balance ${VOTEACC} -ut`, `solana balance ${STAKED} -ut`] },
      { text: LL('看离边界还有多久，以及 vote account 的详情。边界时 vote account 至少要有 0.8 SOL 准入费加免租金额，合计约 0.827 SOL，否则验证者缺席再下一个 epoch（N+2）。0.81 SOL 不够，而且边界之后再充值就赶不上了。', 'Check how long remains before the boundary, and read the vote account. At the boundary it must hold the 0.8 SOL ticket plus its rent-exempt minimum, about 0.827 SOL, or the validator sits out the epoch after next (N+2). 0.81 SOL is short, and a top-up after the boundary is too late.'),
        cmds: ['solana epoch-info -ut', `solana vote-account ${VOTEACC} -ut`] },
      { text: LL('用 testnet 资金钥匙给 vote account 充值，充到 5 SOL 告警线以上。任何人都能往 vote account 转账。给 identity 充值没有用，因为准入费不从它扣；从 identity 转出则会让它跌破 9 SOL 的下限。', 'Fund the vote account from the testnet funding key, to well above the 5 SOL alert floor. Anyone can deposit to a vote account. Funding the identity does not help, because the ticket is not taken from it, and moving SOL out of the identity would put it under its 9 SOL floor.'),
        cmds: [`solana transfer ${VOTEACC} 6 --from ~/funding-testnet.json -ut`, `solana balance ${VOTEACC} -ut`, `solana balance ${STAKED} -ut`] },
      { text: LL('让时钟越过边界。事件日志会显示准入费被扣除、验证者被选入 N+2。sol-backup 保持停止：它配置的是同一个质押 identity。', 'Let the clock run past the boundary. The event log shows the ticket being debited and the validator admitted to N+2. Leave sol-backup stopped: it is configured with the same staked identity.'),
        cmds: ['solana epoch-info -ut'], wait: S1_TO_BOUNDARY + 300 },
    ],
    limit: 6 * 3600, holdFor: 60,
    tick(w) {
      const ch = w.chain;
      if (ch.fundedAt == null && SH().voteBal(w) >= SH().VOTE_FLOOR) ch.fundedAt = w.t;
      if (!w.done && ch.admitted[ch.s1Epoch + 2] === false) {
        S.event(w, 'bad', S.LL(`vote account 在边界时余额不足，验证者缺席 epoch ${ch.s1Epoch + 2}：这个 epoch 不能投票、不能出块、没有奖励。现在充值，最早也只能赶上 epoch ${ch.s1Epoch + 3}。`, `The vote account was short at the boundary, so the validator sits out epoch ${ch.s1Epoch + 2}: no voting, no blocks and no rewards. A top-up now counts from epoch ${ch.s1Epoch + 3} at the earliest.`));
        S.finish(w, false);
      }
    },
    score: w => {
      const ch = w.chain, spare = ch.fundedAt != null ? S1_TO_BOUNDARY - ch.fundedAt : null;
      return [
        [LL('充值时距边界还剩', 'Time left before the boundary when funded'), spare != null ? S.fmtDur(Math.max(0, spare)) : '—', spare != null && spare > 3600 ? 'good' : spare != null && spare > 0 ? 'mid' : 'bad'],
        [LL('期间 identity 最低余额', 'Lowest identity balance'), `◎ ${(ch.minBal ?? 0).toFixed(3)}`, ch.minBal >= 9 ? 'good' : 'bad'],
        [LL('delinquent 时长', 'Time delinquent'), S.fmtDur(ch.delinquentSec || 0), (ch.delinquentSec || 0) === 0 ? 'good' : 'bad'],
      ];
    },
    debrief: LL(
      '本练习按一种常见的模式编写：一台 testnet 验证者的 vote account 在 epoch 边界时低于准入费，于是缺席了整个下一个 epoch。验证者进程一直在运行，钱包里也有钱，只是钱放错了账户，或者充值晚了一个边界。要点有三条。第一，准入费从 vote account 扣，而不是从 identity 扣。identity 仍然签名、收出块收入、付普通交易费，但不再付投票费；给它充值救不了准入。第二，时间关系：bank 进入 epoch N 的那一刻，运行时选出 N+1 的验证者集合并扣费；此刻余额不足准入费加免租金额，就缺席 N+1，N 开始之后的充值最早赶上 N+2。所以充值要在边界之前完成。vote account 中待发给委托人的奖励不计入准入余额。第三，5 SOL 的告警线大约是六个边界的准入费，告警响起时还有几天时间。确认告警只是停止打电话，不会让余额回升。在告警的处理记录里写明负责人和截止的边界，或者用 <code>vote-update-commission-collector</code> 把出块收入转进 vote account，让它自己补充。admin RPC 的 <code>validatorAdmissionTicketStatus</code> 能提前两个 epoch 报告准入资格。',
      'This lab follows a common pattern: a testnet validator whose vote account fell below the ticket at an epoch boundary sat out the whole next epoch. The validator process kept running and there was money in the wallets; it was in the wrong account, or it arrived one boundary late. Three points. First, the ticket comes out of the vote account, not the identity. The identity still signs, receives block revenue and pays ordinary transaction fees, but it no longer pays for votes, and funding it does nothing for admission. Second, the timing: when the bank crosses into epoch N, the runtime picks the set for N+1 and debits the ticket. A vote account short of the ticket plus rent at that moment sits out N+1, and a top-up made after N has started counts from N+2 at the earliest. So fund before the boundary. Pending delegator rewards held in the vote account do not count towards the ticket. Third, the 5 SOL alert floor is about six boundaries of tickets, so the page leaves days to act. Acknowledging it stops the phone; it does not raise the balance. Record an owner and the deadline boundary on the alert, or point block revenue at the vote account with <code>vote-update-commission-collector</code> so that it refills itself. The admin RPC method <code>validatorAdmissionTicketStatus</code> reports eligibility two epochs ahead.'),
  });

  S.registerScenario({
    id: 'sol-failover', network: 'solana', module: SOL, lab: 'S2', difficulty: 3, minutes: 15,
    title: LL('计划内的主备切换', 'A planned switch to the standby'),
    tagline: LL('sol-1 所在的机柜 15:00 断电维护。把投票交给热备机，vote history 跟着走，而且不能双签。', 'The rack holding sol-1 loses power at 15:00 for maintenance. Hand voting to the hot standby with the vote history, and never double sign.'),
    learn: [
      LL('身份切换的顺序：主节点先放手，vote history 跟过去，备用机再接手', 'The order of an identity switch: the primary lets go, the vote history moves, then the standby takes over'),
      LL('vote_history 文件的作用，以及 set-identity 默认要求它', 'What the vote_history file is for, and why set-identity requires it by default'),
      LL('什么时候才能用 --do-not-require-vote-history，以及如何防止旧主节点带着质押 identity 重新上线', 'When --do-not-require-vote-history is allowed, and keeping the old primary from coming back with the staked identity'),
    ],
    brief: LL(
      `<p>现在是 14:20 UTC。机房通知：sol-1 所在的机柜将在 <b>15:00</b> 断电维护，大约 45 分钟。</p><p>sol-backup 是热备机：它已经追上链头，用自己的非质押 identity 运行，机器上也存有一份质押 keypair。请在 15:00 之前把投票交给 sol-backup。</p><p>要求：任何时刻都不能有两台机器同时使用质押 identity；备用机要带着主节点的 vote history 文件接手；sol-1 维护结束重新通电后，不能变成第二个用质押 identity 运行的验证者。</p>`,
      `<p>It is 14:20 UTC. The data centre has announced that the rack holding sol-1 will be powered off at <b>15:00</b> for about 45 minutes of maintenance.</p><p>sol-backup is a hot standby: it is caught up, runs its own unstaked identity, and holds a copy of the staked keypair. Move voting to sol-backup before 15:00.</p><p>The rules: at no moment may two machines run the staked identity; the standby must take over with the primary's vote history file; and when sol-1 powers back on after maintenance, it must not become a second validator running the staked identity.</p>`),
    startAt: '2026-11-18T14:20:00Z',
    config: { balance: 14, voteBalance: 7.2, epoch: 1135, toBoundary: 10 * 3600, standby: 'unstaked', setIdentity: true, maintenance: { host: 'sol-1', off: 2400, on: 5100 } },
    setup(w) {
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(
        `# testnet 验证者\n- 质押 identity: ${STAKED}\n- vote account: ${w.chain.vote}\n- sol-1（主，198.51.100.21）：非质押 keypair 在 /home/sol/unstaked-identity.json\n- sol-backup（热备，198.51.100.22）：平时用自己的非质押 identity 运行；质押 keypair 在 /home/sol/validator-keypair.json\n- 两台的 ledger 和 vote history 文件（vote_history-<IDENTITY>.bin）都在 /mnt/ledger；sol 和 root 用户可以互相 scp\n- 11-18 15:00–15:45 UTC：机柜维护，sol-1 断电\n`,
        `# testnet validator\n- staked identity: ${STAKED}\n- vote account: ${w.chain.vote}\n- sol-1 (primary, 198.51.100.21): unstaked keypair at /home/sol/unstaked-identity.json\n- sol-backup (hot standby, 198.51.100.22): runs its own unstaked identity; staked keypair at /home/sol/validator-keypair.json\n- ledger and vote history files (vote_history-<IDENTITY>.bin) are in /mnt/ledger on both; the sol and root users can scp between them\n- 11-18 15:00-15:45 UTC: rack maintenance, sol-1 powered off\n`));
    },
    objectives: [
      { text: LL('sol-backup 用质押 identity 投票，验证者没有 delinquent', 'sol-backup votes with the staked identity and the validator is not delinquent'), check: w => SH().isVoting(w, w.nodes['sol-backup']) && !SH().delinquent(w) },
      { text: LL('sol-1 不再使用质押 identity（已停止、已断电，或已切到非质押 identity）', 'sol-1 no longer runs the staked identity (stopped, powered off, or switched to an unstaked identity)'), check: w => SH().runningIdentity(w, w.nodes['sol-1']) !== w.chain.identity },
      { text: LL('sol-1 重新通电后不会用质押 identity 启动（服务已 disable，或 unit 指向非质押 keypair）', 'sol-1 cannot start with the staked identity when it powers back on (service disabled, or its unit points at the unstaked keypair)'), check: w => { const n = w.nodes['sol-1']; return n.services['agave-validator'].enabled === false || SH().unitIdentity(w, n) !== w.chain.identity; } },
    ],
    forbidden: [
      { flag: 'double_sign', text: LL('让两台机器同时使用质押 identity', 'Running the staked identity on two machines at once') },
      { flag: 'vh_override', text: LL('主节点还能访问时，用 --do-not-require-vote-history 让备用机不带 vote history 接管', 'Using --do-not-require-vote-history to take over without the vote history while the primary was still reachable') },
    ],
    hints: [
      { text: LL('先读笔记，再确认备用机已经追上链头，然后才把投票交给它。', 'Read the notes, then confirm the standby is caught up before handing it anything.'),
        cmds: ['cat ~/NOTES.md', 'ssm sol-backup', 'solana catchup --our-localhost', 'solana gossip', 'exit'] },
      { text: LL('主节点先放手。在 sol-1 上以 root 等一个没有 leader slot 的窗口，再切到非质押 identity。从这一刻起 sol-1 不再用质押 identity 签名。', 'The primary lets go first. On sol-1 as root, wait for a window without leader slots, then switch to the unstaked identity. From then on sol-1 no longer signs with the staked identity.'),
        cmds: ['ssm sol-1', 'sudo -i', 'agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check', 'agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json', 'agave-validator -l /mnt/ledger contact-info'] },
      { text: LL('离开 sol-1 之前做两件事：把质押 identity 的 vote history 拷到备用机；disable 服务，这样 15:45 重新通电时 systemd 不会用质押 identity 启动它。', 'Before leaving sol-1, do two things. Copy the staked identity\'s vote history to the standby. Then disable the service, so that systemd does not start it with the staked identity when it powers back on at 15:45.'),
        cmds: [`scp /mnt/ledger/vote_history-${STAKED}.bin sol-backup:/mnt/ledger/`, 'systemctl disable agave-validator', 'systemctl is-enabled agave-validator', 'exit', 'exit'] },
      { text: LL('备用机接手。set-identity 默认要求 vote history 文件，缺了就报错；不要用 <code>--do-not-require-vote-history</code> 绕过。gossip 里的质押 identity 应该出现在 198.51.100.22。', 'The standby takes over. set-identity requires the vote history file by default and fails without it; do not bypass that with <code>--do-not-require-vote-history</code>. Gossip should show the staked identity at 198.51.100.22.'),
        cmds: ['ssm sol-backup', 'sudo -i', `ls /mnt/ledger | grep vote_history`, 'agave-validator -l /mnt/ledger set-identity /home/sol/validator-keypair.json', `solana gossip | grep ${STAKED}`, 'solana catchup --our-localhost'] },
      { text: LL('回到工作电脑，从链上确认验证者在投票、没有 delinquent。', 'Back on the workstation, confirm from on-chain data that the validator votes and is not delinquent.'),
        cmds: ['exit', 'exit', 'solana validators -ut'] },
    ],
    limit: 3 * 3600, holdFor: 60,
    score: w => {
      const gap = w.chain.noVoteSec || 0;
      return [
        [LL('没有投票的时间（合计）', 'Time without voting (total)'), S.fmtDur(gap), gap < 30 ? 'good' : gap < 300 ? 'mid' : 'bad'],
        [LL('delinquent 时长', 'Time delinquent'), S.fmtDur(w.chain.delinquentSec || 0), (w.chain.delinquentSec || 0) === 0 ? 'good' : 'mid'],
        [LL('跳过的 leader slot', 'Leader slots skipped'), String(w.chain.skippedSlots || 0), (w.chain.skippedSlots || 0) === 0 ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      '本练习按 Agave 文档中的节点切换步骤编写。迁移验证者或切换主备时，质押 identity 往往不止存在于一处：新旧主机、密钥备份，以及已经退役的机器上都可能留有副本。由此得出一条规则：任何时候都不能用这把密钥启动第二个验证者进程，退役的机器即使重新上线也不行。切换的顺序就是保护：主节点先用 set-identity 放手，vote history 文件跟着 identity 走，备用机再用 set-identity 接手。在 Alpenglow 下，共识状态保存在 <code>vote_history-&lt;IDENTITY&gt;.bin</code> 里，它取代了 TowerBFT 的 tower 文件；set-identity 默认要求这个文件，所以 <code>--require-tower</code> 已不再需要。<code>--do-not-require-vote-history</code> 只用于紧急情况：主节点无法访问或已损坏，而且备用机已经追过主节点的最后一票。只删除密钥文件，不能阻止正在运行的进程继续用内存中的密钥签名。实际操作中这几步会写成脚本，投票空档只有几秒。200 ms 的 slot 下，手工操作的空档稍长，约 26 秒验证者就会被标记为 delinquent，落在空档里的 leader 窗口会变成 skip 证书。',
      'This lab follows the node failover procedure in the Agave documentation. When a validator is migrated or switched to a standby, the staked identity usually exists in more than one place: the old and new hosts, key backups, and machines that have been retired may all hold a copy. That gives one rule: no second validator process may ever start with the key, and a retired machine that comes back online is no exception. The switch order is the safeguard. The primary lets go with set-identity, the vote history file travels with the identity, and only then does the standby take over with set-identity. Under Alpenglow the consensus state lives in <code>vote_history-&lt;IDENTITY&gt;.bin</code>, which replaces TowerBFT\'s tower file. set-identity requires that file by default, so <code>--require-tower</code> is no longer needed. <code>--do-not-require-vote-history</code> is for emergencies only: the primary is unreachable or corrupted, and the standby has caught up past the primary\'s last vote. Deleting a key file does not stop a running process from signing with the key it holds in memory. In practice these steps are scripted and the voting gap is a few seconds. With 200 ms slots, a manual gap of about 26 seconds already marks the validator delinquent, and a leader window that falls inside the gap becomes skip certificates.'),
  });

  S.registerScenario({
    id: 'sol-stale-snapshot', network: 'solana', module: SOL, lab: 'S3', difficulty: 2, minutes: 12,
    title: LL('重启之后仍然 delinquent', 'Still delinquent after a restart'),
    tagline: LL('sol-1 停机两天后重新启动，服务显示 active，但它离链头越来越远。', 'sol-1 was restarted after two days offline. The service is active, but it keeps falling further behind.'),
    learn: [
      LL('用 solana catchup 判断节点在追赶还是在落后', 'Using solana catchup to tell catching up from falling behind'),
      LL('200 ms 的 slot 下，停机两天意味着什么，以及为什么要用新快照启动', 'What two days offline means at 200 ms slots, and why the node needs a fresh snapshot'),
      LL('哪些 ledger 文件可以动，哪些不能动', 'Which ledger files may be touched and which may not'),
    ],
    brief: LL(
      `<p>sol-1 停机两天，机房更换了一根故障内存条。同事在 08:05 UTC 重新启动了 agave-validator，然后去开会了。</p><p>现在是 08:30，验证者仍然 delinquent：<code>SolanaValidatorDelinquent</code>、<code>SolanaVoteInactive</code> 和 <code>SolanaSlotsSeverelyBehind</code> 都在响，<code>SolanaSkipRateHigh</code> 也报了警告，但 systemd 显示服务是 active。vote account 余额充足，验证者仍在验证者集合中。同事留言："它在追块，给它点时间。如果一会儿还是红的，就把 sol-backup 启动起来。"</p><p>请让 sol-1 恢复投票。</p>`,
      `<p>sol-1 was offline for two days while the data centre replaced a faulty memory module. A colleague started agave-validator again at 08:05 UTC and went into a meeting.</p><p>It is now 08:30 and the validator is still delinquent: <code>SolanaValidatorDelinquent</code>, <code>SolanaVoteInactive</code> and <code>SolanaSlotsSeverelyBehind</code> are firing, and <code>SolanaSkipRateHigh</code> has raised a warning, while systemd reports the service as active. The vote account is well funded, so the validator is still in the validator set. The colleague left a message: "It's catching up, give it time. If it's still red later, start sol-backup."</p><p>Get sol-1 voting again.</p>`),
    startAt: '2026-11-24T08:30:00Z', alertAge: 1200,
    config: { balance: 14, voteBalance: 6.4, epoch: 1140, toBoundary: 0.6 * 86400, snapshots: true, credits: 0, staleRestart: { downFor: 2 * 86400 + 1800, restartedAgo: 1500 } },
    objectives: [
      { text: LL('sol-1 在投票，验证者没有 delinquent', 'sol-1 is voting and the validator is not delinquent'), check: w => SH().isVoting(w, w.nodes['sol-1']) && !SH().delinquent(w) },
      { text: LL('恢复后用链上数据确认一次（solana catchup、validators 或 vote-account）', 'Once it recovers, confirm from on-chain data (solana catchup, validators or vote-account)'), check: w => w.flags.verified !== undefined },
    ],
    forbidden: [
      { flag: 'double_sign', text: LL('让两台机器同时使用质押 identity（sol-backup 的 unit 配置的是同一个质押 identity）', 'Running the staked identity on two machines at once (sol-backup\'s unit is configured with the same staked identity)') },
      { flag: 'wipe_ledger', text: LL('删除 ledger 中的 rocksdb、accounts 或 vote history 文件', 'Deleting rocksdb, accounts or the vote history file from the ledger') },
    ],
    hints: [
      { text: LL('先确认这三个 critical 告警，让值班电话停下来。然后登录 sol-1，看节点是在追赶（gaining）还是在落后（falling behind）。', 'Acknowledge the three critical alerts so the on-call phones stop. Then log in to sol-1 and see whether the node is gaining or falling behind.'),
        cmds: ['ack SolanaValidatorDelinquent', 'ack SolanaVoteInactive', 'ack SolanaSlotsSeverelyBehind', 'ssm sol-1', 'sudo -i', 'systemctl is-active agave-validator', 'solana catchup --our-localhost'] },
      { text: LL('读日志和 unit 文件。最近的日志显示 repair 一直失败。注意它启动时加载的快照来自哪个 slot，以及是哪个参数让它没有去找更新的快照。', 'Read the log and the unit file. The latest lines show repair failing. Note the slot of the snapshot it loaded at startup, and the flag that kept it from looking for a newer one.'),
        cmds: ['journalctl -u agave-validator -n 6 --no-pager', 'journalctl -u agave-validator --no-pager | grep -i snapshot', 'systemctl cat agave-validator', 'ls /mnt/ledger'] },
      { text: LL('200 ms 的 slot 下，两天约 864,000 个 slot，整整两个 epoch。这么大的差距没法靠从其他节点修复（repair）缺失的 slot 补回来，需要一个新快照。去掉 <code>--no-snapshot-fetch</code> 再重启，节点会从 known validator 下载快照、加载，然后在几分钟内追上。', 'At 200 ms slots, two days is about 864,000 slots, two whole epochs. A gap that size cannot be closed by repairing the missing slots from peers; the node needs a fresh snapshot. Remove <code>--no-snapshot-fetch</code> and restart. The node downloads a snapshot from a known validator, loads it, and catches up within a few minutes.'),
        cmds: ["sed -i 's/ --no-snapshot-fetch//' /etc/systemd/system/agave-validator.service", 'systemctl daemon-reload', 'systemctl restart agave-validator', 'journalctl -u agave-validator -n 5 --no-pager'], wait: 600 },
      { text: LL('确认它追上了并在投票。不要动 rocksdb、accounts 和 vote history 文件，也不要启动 sol-backup。', 'Confirm that it has caught up and is voting. Leave rocksdb, accounts and the vote history file alone, and do not start sol-backup.'),
        cmds: ['journalctl -u agave-validator -n 8 --no-pager', 'solana catchup --our-localhost', 'exit', 'exit', 'solana validators -ut'] },
    ],
    limit: 3 * 3600, holdFor: 60,
    score: w => {
      const d = w.chain.delinquentSec || 0;
      return [
        [LL('练习中 delinquent 的时长', 'Time delinquent during the lab'), S.fmtDur(d), d < 1200 ? 'good' : d < 3600 ? 'mid' : 'bad'],
      ];
    },
    debrief: LL(
      '长时间停机后，带着 <code>--no-snapshot-fetch</code> 重启的验证者，会加载自己最后一个本地快照。从那以后的每个 slot 都要重放，而 blockstore 里没有的 slot 只能从其他节点修复（repair）。修复的速度比集群出块慢，所以差距越拉越大，systemd 却一直显示 active。slot 缩短到 200 ms 之后，同样的停机时间对应的 slot 数翻了一倍：两天约 864,000 个 slot，整整两个 epoch；<code>--maximum-local-snapshot-age</code> 默认的 2,500 个 slot 只相当于 8 分钟多一点。解决办法是从 known validator 下载一个新快照。<code>--no-snapshot-fetch</code> 适合短暂的重启；停机很久之后，它会把节点困在过去。按同事的建议启动备用机也解决不了问题：sol-1 一旦追上，两台机器就会用同一把密钥投票。这里的告警时间线与常见的生产规则一致：停投约 26 秒（128 个 slot）后链上标记 delinquent，SolanaValidatorDelinquent 在 5 分钟后触发，落后超过 1,500 个 slot（约 5 分钟）后 SolanaSlotsSeverelyBehind 触发。停机期间，这台验证者的每个 leader 窗口都很快变成了 skip 证书，链没有停，但本 epoch 的 skip rate 已经无法挽回。vote account 一直有钱，所以验证者没有失去席位，损失的是这两个 epoch 的投票和出块。如果监控只检查进程是否在运行，一个停投的验证者可能连续几个 epoch 拿不到奖励而无人察觉。这就是奖励流告警存在的原因：它们比较本 epoch 的 credits 与集群中位数，并检查上一个 epoch 的奖励是否到账。',
      'A validator restarted after a long outage with <code>--no-snapshot-fetch</code> loads its last local snapshot. Every slot since then has to be replayed, and slots the blockstore never received must be repaired from peers. Repair is slower than the cluster produces slots, so the gap keeps growing while systemd shows the service as active. With slots cut to 200 ms, the same outage spans twice as many slots: two days is about 864,000 slots, two whole epochs, and the default <code>--maximum-local-snapshot-age</code> of 2,500 slots is just over 8 minutes. The fix is a fresh snapshot from a known validator. <code>--no-snapshot-fetch</code> suits short restarts; after a long outage it keeps the node stuck in the past. Starting the standby, as the colleague suggested, would not have helped: as soon as sol-1 caught up, two machines would vote with one key. The alert timeline here matches common production rules: the chain marks a validator delinquent about 26 seconds (128 slots) after it stops voting, SolanaValidatorDelinquent fires 5 minutes later, and SolanaSlotsSeverelyBehind fires once the gap passes 1,500 slots, about 5 minutes. During the outage each of this validator\'s leader windows quickly became skip certificates. The chain did not stall, but the skip rate for this epoch cannot be recovered. The vote account stayed funded, so the validator kept its place in the set; the outage cost two epochs of votes and blocks. If monitoring only checks that the process is running, a stalled validator can lose rewards for several epochs before anyone notices. That is why rewards-flow alerts exist: they compare this epoch\'s credits with the cluster median, and check that the last epoch\'s rewards arrived.'),
  });
})(SIM);
