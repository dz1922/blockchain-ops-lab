/* ============================================================
   Labs. Each one is data plus small predicates over the world.
   Text fields are bilingual: S.LL(zh, en).
   Adding a lab never touches the engine or the network plugin.
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL;
  const A = () => S.networks.avalanche.helpers;
  const nodes = w => Object.values(w.nodes);
  const avxOffline = w => nodes(w).reduce((s, n) => s + (n.av ? n.av.offline : 0), 0);
  const avxScore = w => [
    [LL('验证者离线时间（合计）', 'Validator downtime (total)'), S.fmtDur(avxOffline(w)), avxOffline(w) < 300 ? 'good' : avxOffline(w) < 1800 ? 'mid' : 'bad'],
    ...nodes(w).map(n => [LL(`${n.moniker} 期末在线率（之后不再离线）`, `${n.moniker} end-of-period uptime (if no further downtime)`), A().projected(n).toFixed(3) + '%', A().projected(n) >= 95 ? 'good' : A().projected(n) >= 90 ? 'mid' : 'bad']),
  ];

  const FLEET = [
    { moniker: 'avax-01', region: 'us-east-1', instanceId: 'i-0a1f3c5e7b9d24681', type: 'c6in.2xlarge', memGB: 16, ip: '198.51.100.11', nodeID: 'NodeID-7Xhw2mDxuDS44j42TCB6U5579esbSt3Lg', elapsedDays: 240, periodDays: 365, downHours: 41, reward: 22726, weight: 500000 },
    { moniker: 'avax-02', region: 'us-west-2', instanceId: 'i-0b2e4d6f8a1c35792', type: 't3.2xlarge', memGB: 32, ip: '198.51.100.12', nodeID: 'NodeID-MFrZFVCXPv5iCn6M9K6XduxGTYp891xXZ', elapsedDays: 45, periodDays: 56, downHours: 9, reward: 7649, weight: 1556894 },
    { moniker: 'avax-03', region: 'us-west-1', instanceId: 'i-0c3d5f7a9b2e46803', type: 'm6a.2xlarge', memGB: 32, ip: '198.51.100.13', nodeID: 'NodeID-NFBbbJ4qCmNaCzeW7sxErhvWqvEQMnYcN', elapsedDays: 140, periodDays: 200, downHours: 8, reward: 60336, weight: 1499998 },
  ];
  const fleet = over => FLEET.map(f => Object.assign({}, f, over(f) || {}));
  const allUpgradedHealthy = [
    { text: LL('三台节点都运行 avalanchego 1.15.0 或更高版本', 'All three nodes run avalanchego 1.15.0 or later'), check: w => nodes(w).every(n => n.av.running && S.semverCmp(n.av.running, '1.15.0') >= 0) },
    { text: LL('三台节点的 /ext/health 都报告 healthy', 'All three nodes report healthy on /ext/health'), check: w => nodes(w).every(n => A().healthy(w, n)) },
  ];
  const avxForbidden = [
    { flag: 'rollback', text: LL('在数据库迁移之后把二进制换回旧版本', 'Putting an older binary back after the database has migrated') },
    { flag: 'wipe_db', text: LL('删除链数据库', 'Deleting the chain database') },
    { flag: 'lost_identity', text: LL('删除或移走 staking 身份文件', 'Deleting or moving the staking identity files') },
  ];
  const AVX = LL('Avalanche 验证者运维', 'Avalanche validator operations');
  const SOL = LL('Solana 验证者运维', 'Solana validator operations');

  S.registerScenario({
    id: 'avax-helicon', network: 'avalanche', module: AVX, lab: 'A1', difficulty: 2, minutes: 15,
    title: LL('网络升级截止前', 'Before the network upgrade'),
    tagline: LL('Helicon 将在 45 分钟后激活，三台验证者仍在运行 1.14.2。', 'Helicon activates in 45 minutes and three validators still run 1.14.2.'),
    learn: [
      LL('网络升级的激活时间如何决定你的操作窗口', 'How an upgrade activation time sets your working window'),
      LL('用合并 PR 的方式授权并执行滚动升级', 'Authorising and running a rolling upgrade by merging a PR'),
      LL('区分"正在重放区块"和"升级失败"', 'Telling a node that is replaying blocks from a failed upgrade'),
    ],
    brief: LL(
      `<p>2026 年 9 月 22 日，Avalanche 主网的 Helicon 升级将于 15:00 UTC 激活，最低版本为 <code>1.15.0</code>。你负责的三台验证者仍在运行 <code>1.14.2</code>。升级 PR 几天前已由机器人创建，但一直没有合并。</p><p>激活之后，低于最低版本的节点会被其他验证者断开，在 P-Chain 上被记为离线。在线率低于门槛时，整个质押期的奖励都会作废。</p><p>请在尽量少离线的前提下，让三台节点运行 1.15.0 并恢复健康。</p>`,
      `<p>On 22 September 2026 the Avalanche mainnet activates the Helicon upgrade at 15:00 UTC. The minimum version is <code>1.15.0</code>. Your three validators run <code>1.14.2</code>. A bot opened the upgrade pull request several days ago and nobody has merged it.</p><p>After activation, peers disconnect nodes below the minimum version and the P-Chain records them as offline. If uptime ends a staking period below the threshold, the whole period's reward is lost.</p><p>Get all three nodes onto 1.15.0 and healthy, with as little downtime as you can.</p>`),
    startAt: '2026-09-22T14:15:00Z',
    config: { activation: 2700, upgrade: 'Helicon', primitive: 'v2', showUpgradeAlert: true, pr: { n: 477, title: 'upgrade(avalanche): avalanchego 1.14.2 -> 1.15.0 (3 nodes)' }, nodes: fleet(() => ({ bin: '1.14.2', db: '1.14.2' })) },
    objectives: allUpgradedHealthy,
    forbidden: avxForbidden,
    hints: [
      LL('先了解现状：<code>gh pr list</code>，然后 <code>gh pr view 477</code>。注意截止时间。', 'Start with the situation: <code>gh pr list</code>, then <code>gh pr view 477</code>. Note the deadline.'),
      LL('合并 PR 就是批准升级：<code>gh pr merge 477</code> 会启动 upgrade-apply，每次升级两台。也可以逐台执行 <code>staking --region us-west-2 upgrade avalanche --env prod --moniker avax-02 --version 1.15.0</code>。', 'Merging the PR approves the upgrade: <code>gh pr merge 477</code> starts upgrade-apply, two nodes at a time. You can also upgrade one node with <code>staking --region us-west-2 upgrade avalanche --env prod --moniker avax-02 --version 1.15.0</code>.'),
      LL('升级后的节点要重放约 13,000 个区块，这段时间 health 会报告不健康。可以登录节点观察：<code>ssm avax-01</code>、<code>sudo -i</code>、<code>journalctl -u avalanchego -f</code>。把模拟时钟调到 60× 会快一些。', 'An upgraded node replays about 13,000 blocks, and health reports unhealthy meanwhile. Watch it on the node: <code>ssm avax-01</code>, <code>sudo -i</code>, <code>journalctl -u avalanchego -f</code>. Setting the clock to 60× helps.'),
      LL('不要把 <code>avalanchego.prev</code> 复制回去。数据库已经迁移，旧版本会以 unknown codec version 退出。', 'Do not copy <code>avalanchego.prev</code> back. The database has migrated and the old binary exits with unknown codec version.'),
    ],
    limit: 6 * 3600, holdFor: 60,
    score: avxScore,
    debrief: LL(
      '本练习参考了 Helicon 升级期间一家质押服务商的事故复盘。他们的升级 PR 开了将近两周，在激活七小时后才合并。随后一个旧版升级脚本在节点重放区块时等待超时，判定升级失败，把 1.14.2 装回到已经迁移的数据库上，所有节点因此陷入反复崩溃。两条结论：按激活时间倒推安排升级；节点在重放区块时属于正常的恢复过程，不能当作失败处理。',
      'This lab draws on a staking operator\'s post-incident review from the Helicon upgrade. Their upgrade pull request had been open for almost two weeks and was merged seven hours after activation. An older upgrade script then timed out while the nodes were replaying blocks, decided the upgrade had failed, and reinstalled 1.14.2 on top of the migrated database. Every node went into a crash loop. Two conclusions: schedule the upgrade backwards from the activation time, and treat a node that is replaying blocks as recovering, not failed.'),
  });

  S.registerScenario({
    id: 'avax-2210', network: 'avalanche', module: AVX, lab: 'A2', difficulty: 3, minutes: 12,
    title: LL('回滚之后的恢复', 'Recovering from a bad rollback'),
    tagline: LL('一次自动回滚让三台节点反复崩溃，它们已经离线七个小时。', 'An automatic rollback left three nodes in a crash loop. They have been offline for seven hours.'),
    learn: [
      LL('从 systemd 和日志中找到崩溃原因', 'Finding the cause of a crash loop from systemd and the logs'),
      LL('理解数据库版本与二进制版本的关系', 'How the database version and the binary version relate'),
      LL('用最小的改动恢复节点，不删除数据', 'Recovering a node with the smallest change, without deleting data'),
    ],
    brief: LL(
      `<p>现在是 22:16 UTC。Helicon 已于七个多小时前激活。PR 在 22:03 合并后，自动升级脚本给节点装上了 1.15.0。脚本只等待了五分钟健康检查，而节点当时还在重放区块，于是脚本判定升级失败，又把 1.14.2 装了回去。</p><p>现在三台节点都在被 systemd 反复重启，critical 告警已经持续了一整晚。</p><p>请让三台节点恢复验证，并且不要让情况变得更糟。</p>`,
      `<p>It is 22:16 UTC. Helicon activated more than seven hours ago. After the PR was merged at 22:03, the upgrade script installed 1.15.0. It waited only five minutes for a health check, the nodes were still replaying blocks, so it decided the upgrade had failed and put 1.14.2 back.</p><p>All three nodes are now being restarted by systemd over and over, and the critical alerts have been firing all evening.</p><p>Get the nodes validating again without making things worse.</p>`),
    startAt: '2026-09-22T22:16:00Z', alertAge: 7 * 3600,
    config: { activation: -26160, upgrade: 'Helicon', primitive: 'v1', pr: { n: 477, title: 'upgrade(avalanche): avalanchego 1.14.2 -> 1.15.0 (3 nodes)', merged: true }, nodes: fleet(f => ({ bin: '1.14.2', db: '1.15.0', prevBin: '1.14.2', downHours: f.downHours + 7.2, stoppedAt: -6.9 * 3600 })) },
    objectives: allUpgradedHealthy,
    forbidden: avxForbidden,
    hints: [
      LL('登录任意一台：<code>ssm avax-02</code>、<code>sudo -i</code>、<code>systemctl status avalanchego</code>，再看 <code>journalctl -u avalanchego -n 30 --no-pager</code> 中的 FATAL。', 'Log in to any node: <code>ssm avax-02</code>, <code>sudo -i</code>, <code>systemctl status avalanchego</code>, then look for FATAL in <code>journalctl -u avalanchego -n 30 --no-pager</code>.'),
      LL('<code>unknown codec version</code> 表示二进制比数据库旧。用 <code>avalanchego --version</code> 确认当前版本。', '<code>unknown codec version</code> means the binary is older than the database. Check with <code>avalanchego --version</code>.'),
      LL('重新安装 1.15.0：在工作电脑上执行 <code>staking --region us-west-2 upgrade avalanche --env prod --moniker avax-02 --version 1.15.0</code>，或者在节点上下载发布包，用 <code>tar xzf</code> 解压后 <code>install</code> 到 /usr/local/bin/avalanchego。', 'Install 1.15.0 again: from the workstation run <code>staking --region us-west-2 upgrade avalanche --env prod --moniker avax-02 --version 1.15.0</code>, or on the node download the release, unpack it with <code>tar xzf</code> and <code>install</code> it to /usr/local/bin/avalanchego.'),
      LL('不需要删除数据库。换上 1.15.0 之后，systemd 的下一次自动重启就会用现有数据恢复。三台节点分别在 us-west-2、us-east-1 和 us-west-1。', 'There is no need to delete the database. With 1.15.0 in place, the next automatic restart recovers from the existing data. The nodes are in us-west-2, us-east-1 and us-west-1.'),
    ],
    limit: 6 * 3600, holdFor: 60,
    score: avxScore,
    debrief: LL(
      '在原始事故中，有一台节点在当晚反复崩溃了 44 次。最终的处理方式是重新安装 1.15.0，所有节点都从现有数据恢复，大约 16 分钟追平，没有重新同步。之后升级脚本加了一条规则：新版本一旦启动过，就不再回滚。',
      'In the original incident one node crash-looped 44 times that evening. The fix was to reinstall 1.15.0. Every node recovered from its existing data and caught up in about 16 minutes, with no resync. Afterwards the upgrade script gained one rule: once a new binary has started, it is never rolled back.'),
  });

  S.registerScenario({
    id: 'avax-ip', network: 'avalanche', module: AVX, lab: 'A3', difficulty: 2, minutes: 10,
    title: LL('更换机型之后无法连接', 'Unreachable after an instance change'),
    tagline: LL('换完机型后，网络中的其他验证者连不上 avax-02。', 'After a change of instance type, other validators cannot reach avax-02.'),
    learn: [
      LL('外部可达性如何影响 P-Chain 在线率', 'How reachability from outside affects P-Chain uptime'),
      LL('用 health 检查和 IP 对比定位问题', 'Locating the fault with the health checks and an IP comparison'),
      LL('完整修复：节点配置和监控配置都要更新', 'A complete fix covers both the node and the monitoring'),
    ],
    brief: LL(
      `<p>昨天，为了解决内存不足，同事给 <b>avax-02</b> 更换了机型：先停止实例，修改实例类型，再重新启动。进程看起来一切正常，但 api.avax.network 显示它 <code>connected: false</code>，外部探测也持续失败。</p><p>在线率正在下降。请找到原因并完成修复，包括监控。</p>`,
      `<p>Yesterday a colleague changed the instance type of <b>avax-02</b> to get more memory: stop the instance, change the type, start it again. The process looks fine, but api.avax.network reports <code>connected: false</code> and the external probes keep failing.</p><p>Uptime is dropping. Find the cause and fix it completely, monitoring included.</p>`),
    startAt: '2026-09-29T09:40:00Z',
    config: { activation: null, nodes: [Object.assign({}, FLEET[1], { bin: '1.15.0', db: '1.15.0', ip: '198.51.100.47', cfgIp: '198.51.100.12', probeIp: '198.51.100.12', since: -180, replay: 0, downHours: 9 })] },
    setup(w) {
      const T = '/home/ops/monitoring/ext-uptime/prometheus/prometheus.yml.tmpl';
      S.fsWrite(w.laptop, T, `# probe catalogue, rendered per region by scripts/deploy-ext-uptime.sh\nscrape_configs:\n  - job_name: blackbox_tcp_connect\n    metrics_path: /probe\n    params: { module: [tcp_connect] }\n    static_configs:\n      - targets: ['198.51.100.11:9651']\n        labels: { validator: validator-avax-01, protocol: avalanche }\n      - targets: ['198.51.100.12:9651']\n        labels: { validator: validator-avax-02, protocol: avalanche }\n      - targets: ['198.51.100.13:9651']\n        labels: { validator: validator-avax-03, protocol: avalanche }\n`);
      S.fsWrite(w.laptop, '/home/ops/monitoring/scripts/deploy-ext-uptime.sh', '#!/bin/bash\n# pushes the probe config to the three probers, then restarts their prometheus\n', { mode: '755', owner: 'ops' });
      w.laptop.dirs.add('/home/ops/monitoring/scripts');
    },
    laptopCommands: {
      'deploy-ext-uptime.sh': async ctx => {
        const c = S.fsRead(ctx.w, ctx.host, '/home/ops/monitoring/ext-uptime/prometheus/prometheus.yml.tmpl') || '';
        const m = /targets: \['([\d.]+):9651'\]\n\s+labels: \{ validator: validator-avax-02/.exec(c);
        for (const r of ['us-east-1', 'eu-west-1', 'ap-southeast-1']) { ctx.write(`[${r}] prober-${r}: render prometheus.yml, restart prometheus ... `); await ctx.sleep(3); ctx.write('ok\n'); }
        if (m) ctx.w.nodes['avax-02'].probeIp = m[1];
        return `done. avax-02 probe target: ${m ? m[1] : '?'}:9651\n${S.C.gray(S.L('（实际工作中，这个改动应当通过 PR 合并进监控仓库）', '(in practice this change goes through a pull request to the monitoring repo)'))}\n`;
      },
    },
    objectives: [
      { text: LL('avax-02 重新被网络连接（connected），且 /ext/health 报告 healthy', 'avax-02 is connected again and /ext/health reports healthy'), check: w => A().healthy(w, w.nodes['avax-02']) },
      { text: LL('配置中的 public-ip 与实例当前的公网 IP 一致', 'The configured public-ip matches the instance\'s current public IP'), check: w => A().ipOk(w, w.nodes['avax-02']) },
      { text: LL('外部探测恢复（探测配置已更新并部署）', 'External probes recover (probe config updated and deployed)'), check: w => w.nodes['avax-02'].probeIp === w.nodes['avax-02'].ip },
    ],
    forbidden: avxForbidden,
    hints: [
      LL('<code>ssm avax-02</code>、<code>sudo -i</code>、<code>curl -s localhost:9650/ext/health | jq .checks.network</code>', '<code>ssm avax-02</code>, <code>sudo -i</code>, <code>curl -s localhost:9650/ext/health | jq .checks.network</code>'),
      LL('"no inbound connections" 说明别人连不上这台节点。比较 <code>curl -s checkip.amazonaws.com</code> 和 <code>jq -r \'."public-ip"\' /etc/avalanche/config.json</code> 的结果。', '"no inbound connections" means peers cannot reach the node. Compare <code>curl -s checkip.amazonaws.com</code> with <code>jq -r \'."public-ip"\' /etc/avalanche/config.json</code>.'),
      LL('修改配置：<code>sed -i \'s/198.51.100.12/新IP/\' /etc/avalanche/config.json</code>，然后 <code>systemctl restart avalanchego</code>。', 'Fix the config: <code>sed -i \'s/198.51.100.12/NEW_IP/\' /etc/avalanche/config.json</code>, then <code>systemctl restart avalanchego</code>.'),
      LL('外部探测仍然指向旧 IP。<code>exit</code> 回到工作电脑，修改 <code>~/monitoring/ext-uptime/prometheus/prometheus.yml.tmpl</code>，再运行 <code>~/monitoring/scripts/deploy-ext-uptime.sh</code>。', 'The external probes still target the old IP. <code>exit</code> to the workstation, edit <code>~/monitoring/ext-uptime/prometheus/prometheus.yml.tmpl</code>, then run <code>~/monitoring/scripts/deploy-ext-uptime.sh</code>.'),
    ],
    limit: 4 * 3600, holdFor: 60,
    score: w => [avxScore(w)[0], [LL('avax-02 期末在线率', 'avax-02 end-of-period uptime'), A().projected(w.nodes['avax-02']).toFixed(3) + '%', A().projected(w.nodes['avax-02']) >= 95 ? 'good' : 'mid']],
    debrief: LL(
      '没有绑定弹性 IP 的实例，在停止再启动之后会获得新的公网 IP。avalanchego 的 <code>public-ip</code> 写在配置文件里，不会自动更新，节点会一直向网络通告一个已经不存在的地址。长期的做法是给实例绑定弹性 IP，或者使用 <code>public-ip-resolution-service</code>。如果只修了节点、没有更新探测配置，外部探测的告警会一直持续。',
      'An instance without an Elastic IP gets a new public IP after a stop and start. avalanchego\'s <code>public-ip</code> lives in its config file and is not refreshed, so the node keeps advertising an address that no longer exists. The lasting fix is an Elastic IP, or <code>public-ip-resolution-service</code>. Fixing the node without updating the probe config leaves the external-probe alert firing.'),
  });

  S.registerScenario({
    id: 'sol-balance', network: 'solana', module: SOL, lab: 'S1', difficulty: 1, minutes: 8,
    title: LL('identity 余额告警', 'Identity balance alert'),
    tagline: LL('testnet 验证者的 identity 余额在持续下降。', 'The identity balance of a testnet validator keeps falling.'),
    learn: [
      LL('投票交易的手续费由谁支付，余额耗尽会发生什么', 'Who pays for vote transactions, and what happens when the balance runs out'),
      LL('分清 testnet 与 mainnet，正确地给 identity 补充余额', 'Keeping testnet and mainnet apart while funding an identity'),
      LL('为什么同一个 identity 不能同时在两台机器上运行', 'Why one identity must never run on two machines at once'),
    ],
    brief: LL(
      `<p>周三晚上 8 点，Solana testnet 验证者的 identity 余额告警响了。验证者每投一票都要支付一笔交易手续费，由 identity 账户承担，这台机器每天大约消耗 <b>2.1 SOL</b>。</p><p>如果余额耗尽，投票会停止，几十秒后验证者就会被标记为 delinquent。告警响起时通常还有几天时间，但如果没人处理，它往往会在深夜用完。</p><p>请在验证者停止投票之前解决问题，并用链上数据确认结果。</p>`,
      `<p>At 8 pm on a Wednesday the identity balance alert fires for a Solana testnet validator. Every vote is a transaction whose fee the identity account pays, and this machine spends about <b>2.1 SOL</b> a day.</p><p>If the balance runs out, voting stops and the validator is marked delinquent within a minute. The alert usually leaves a few days of runway, but left alone the balance tends to run out in the middle of the night.</p><p>Fix it before the validator stops voting, and confirm the result from on-chain data.</p>`),
    startAt: '2026-08-26T20:00:00Z',
    config: { balance: 9.4, burnPerDay: 2.1 },
    objectives: [
      { text: LL('identity 余额不低于 10 SOL（testnet）', 'Identity balance is at least 10 SOL (testnet)'), check: w => S.networks.solana.helpers.bal(w) >= 10 },
      { text: LL('验证者正在投票，没有被标记为 delinquent', 'The validator is voting and not delinquent'), check: w => !S.networks.solana.helpers.delinquent(w) && S.networks.solana.helpers.isVoting(w, w.nodes['sol-1']) },
      { text: LL('补充余额后，用链上数据确认一次（solana validators、vote-account 或 catchup）', 'After funding, confirm once from on-chain data (solana validators, vote-account or catchup)'), check: w => w.flags.verified !== undefined },
    ],
    forbidden: [{ flag: 'double_sign', text: LL('让两台机器同时使用质押 identity（备用机 sol-backup 配置的是同一个 identity）', 'Running the staked identity on two machines at once (the standby sol-backup is configured with the same identity)') }],
    hints: [
      LL('先看笔记：<code>cat ~/NOTES.md</code>。再查余额：<code>solana balance &lt;identity&gt; -ut</code>。工作电脑上的 CLI 默认连接 mainnet，所以要加 <code>-ut</code>。', 'Read the notes first: <code>cat ~/NOTES.md</code>. Then check the balance: <code>solana balance &lt;identity&gt; -ut</code>. The CLI on the workstation defaults to mainnet, hence <code>-ut</code>.'),
      LL('用资金账户转账：<code>solana transfer &lt;identity&gt; 10 --from ~/funding-testnet.json -ut</code>。水龙头 airdrop 每次只能领 1 SOL，而且有频率限制。', 'Transfer from the funding account: <code>solana transfer &lt;identity&gt; 10 --from ~/funding-testnet.json -ut</code>. The faucet airdrop gives 1 SOL at a time and is rate limited.'),
      LL('转账后确认：<code>solana validators -ut</code>，或者 <code>ssm sol-1</code> 后执行 <code>solana catchup --our-localhost</code>。', 'Confirm afterwards: <code>solana validators -ut</code>, or <code>ssm sol-1</code> and <code>solana catchup --our-localhost</code>.'),
      LL('不要启动 sol-backup。它的 unit 文件配置的是同一个质押 identity，可以用 <code>systemctl cat agave-validator</code> 查看。', 'Do not start sol-backup. Its unit file points at the same staked identity; see <code>systemctl cat agave-validator</code>.'),
    ],
    limit: 6 * 86400, holdFor: 60,
    score: w => {
      const ch = w.chain;
      return [
        [LL('期间最低余额', 'Lowest balance'), `◎ ${(ch.minBal ?? 0).toFixed(3)}`, ch.minBal >= 5 ? 'good' : ch.minBal > 0.01 ? 'mid' : 'bad'],
        [LL('delinquent 时长', 'Time delinquent'), S.fmtDur(ch.delinquentSec || 0), (ch.delinquentSec || 0) === 0 ? 'good' : 'bad'],
      ];
    },
    debrief: LL(
      '本练习参考了一次真实的 testnet 事故：identity 余额在晚上 19:00 只剩 0.0008 SOL，14 分钟后验证者变为 delinquent。当时的告警阈值是 0.1 SOL，只提前了 70 分钟，而且是在半夜。事后阈值改为按剩余天数设置（低于 8 SOL 预警，低于 5 SOL 严重），告警标题中也写明了网络和 identity。',
      'This lab is based on a real testnet incident. The identity balance was down to 0.0008 SOL at 19:00 and the validator became delinquent 14 minutes later. The alert threshold at the time was 0.1 SOL, which gave 70 minutes of warning, at night. Afterwards the thresholds were set by days of runway (warning below 8 SOL, critical below 5 SOL), and the alert title was changed to name the network and the identity.'),
  });
})(SIM);
