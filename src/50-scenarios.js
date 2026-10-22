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
      {
        text: LL('先读升级 PR，记下离激活还有多久。', 'Read the upgrade pull request and note how long is left before activation.'),
        cmds: ['gh pr list', 'gh pr view 477'],
      },
      {
        text: LL('登录一台节点，确认它现在的版本。日志里已经有即将升级的警告。', 'Log in to one node and confirm what it runs now. The log already warns about the coming upgrade.'),
        cmds: ['ssm avax-01', 'sudo -i', 'avalanchego --version', 'journalctl -u avalanchego -n 20 --no-pager', 'exit', 'exit'],
      },
      {
        text: LL('合并 PR 就是批准升级。upgrade-apply 随即开始，每次升级两台，进度显示在右侧的事件记录里。', 'Merging the pull request approves the upgrade. upgrade-apply starts at once, two nodes at a time, and reports progress in the event log.'),
        cmds: ['gh pr merge 477'],
        wait: 300,
      },
      {
        text: LL('升级后的节点要重放约 13,000 个区块，这段时间 health 报告不健康。这是正常的恢复过程，不是失败。不要把 <code>avalanchego.prev</code> 放回去：数据库已经迁移，旧版本会以 unknown codec version 退出。', 'An upgraded node replays about 13,000 blocks, and health reports unhealthy until it finishes. That is recovery, not failure. Do not put <code>avalanchego.prev</code> back: the database has migrated, and the old binary exits with unknown codec version.'),
        cmds: ['ssm avax-01', 'sudo -i', 'avalanchego --version', 'systemctl status avalanchego', 'journalctl -u avalanchego -n 20 --no-pager', 'curl -s localhost:9650/ext/health | jq .healthy', 'exit', 'exit'],
        wait: 1500,
      },
      {
        text: LL('从独立视角确认三台验证者都重新连上了网络。', 'Confirm from an independent view that all three validators are connected again.'),
        cmds: ['curl -s -X POST --data \'{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators","params":{}}\' https://api.avax.network/ext/bc/P | jq \'.result.validators[] | {nodeID, connected, uptime}\''],
      },
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
      {
        text: LL('先确认告警，让电话停下来。然后登录一台节点，在日志里找服务反复退出的原因（FATAL 那一行）。', 'Acknowledge the alerts so the paging stops. Then log in to one node and find in the log why the service keeps exiting (the FATAL line).'),
        cmds: ['ack AvalancheNodeUnhealthy', 'ack NodeDown', 'ack AvalancheValidatorNotConnected', 'ack ExternalProbeFailure', 'ssm avax-02', 'sudo -i', 'systemctl status avalanchego', 'journalctl -u avalanchego -n 30 --no-pager'],
      },
      {
        text: LL('<code>unknown codec version</code> 表示二进制比数据库旧：数据库已经被 1.15.0 迁移，回滚又装回了 1.14.2。数据库不用删，换回新版本就行。', '<code>unknown codec version</code> means the binary is older than the database: 1.15.0 migrated the database, and the rollback put 1.14.2 back. The database does not need deleting; the binary needs to be new again.'),
        cmds: ['avalanchego --version', 'ls -l /usr/local/bin'],
      },
      {
        text: LL('你已经在 avax-02 上，直接在这里装回 1.15.0。不需要手动重启：systemd 的下一次自动重启就会用新版本和现有数据启动。', 'You are already on avax-02, so install 1.15.0 here. No manual restart is needed: the next automatic restart starts the new binary on the existing data.'),
        cmds: ['cd /tmp', 'curl -fsSL -o avalanchego-linux-amd64-v1.15.0.tar.gz https://github.com/ava-labs/avalanchego/releases/download/v1.15.0/avalanchego-linux-amd64-v1.15.0.tar.gz', 'tar xzf avalanchego-linux-amd64-v1.15.0.tar.gz -C /tmp', 'install -m 0755 -o root -g root /tmp/avalanchego-v1.15.0/avalanchego /usr/local/bin/avalanchego', 'avalanchego --version'],
        wait: 60,
      },
      {
        text: LL('确认 avax-02 已经在运行并开始重放区块。另外两台用 staking 工具从工作电脑升级，各在自己的区域：avax-01 在 us-east-1，avax-03 在 us-west-1。这个工具会等节点重放完成，每台要十几分钟。最后从独立视角确认三台都已 connected。', 'Check that avax-02 is running and replaying blocks. Upgrade the other two from the workstation with the staking tool, each in its own region: avax-01 in us-east-1, avax-03 in us-west-1. The tool waits for each node to finish replaying, which takes about a quarter of an hour. Then confirm from an independent view that all three are connected.'),
        cmds: ['systemctl status avalanchego', 'journalctl -u avalanchego -n 20 --no-pager', 'exit', 'exit', 'staking --region us-east-1 upgrade avalanche --env prod --moniker avax-01 --version 1.15.0', 'staking --region us-west-1 upgrade avalanche --env prod --moniker avax-03 --version 1.15.0', 'curl -s -X POST --data \'{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators","params":{}}\' https://api.avax.network/ext/bc/P | jq \'.result.validators[] | {nodeID, connected, uptime}\''],
      },
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
      {
        text: LL('登录 avax-02，问节点自己哪一项健康检查失败。', 'Log in to avax-02 and ask the node which health check fails.'),
        cmds: ['ssm avax-02', 'sudo -i', 'systemctl status avalanchego', 'curl -s localhost:9650/ext/health | jq .checks.network'],
      },
      {
        text: LL('"no inbound connections" 说明对等节点连不上它通告的地址。比较实例当前的公网 IP 和配置里的 <code>public-ip</code>。', '"no inbound connections" means peers cannot reach the address the node advertises. Compare the instance\'s current public IP with <code>public-ip</code> in the config.'),
        cmds: ['curl -s checkip.amazonaws.com', 'jq -r \'."public-ip"\' /etc/avalanche/config.json'],
      },
      {
        text: LL('把当前 IP 写进配置，然后重启节点，让它通告新地址。', 'Write the current IP into the config and restart the node so it advertises the new address.'),
        cmds: ['NEW=$(curl -s checkip.amazonaws.com)', 'sed -i "s/198.51.100.12/$NEW/" /etc/avalanche/config.json', 'jq -r \'."public-ip"\' /etc/avalanche/config.json', 'systemctl restart avalanchego'],
        wait: 120,
      },
      {
        text: LL('确认节点恢复健康，再回到工作电脑，从外部测试新地址的 9651 端口。', 'Check that the node is healthy again, then go back to the workstation and test port 9651 on the new address from outside.'),
        cmds: ['curl -s localhost:9650/ext/health | jq .healthy', 'journalctl -u avalanchego -n 20 --no-pager', 'exit', 'exit', 'nc -zv 198.51.100.47 9651'],
      },
      {
        text: LL('外部探测仍然指向旧 IP。在监控仓库里改好探测目录，再部署到各个探测点。', 'The external probes still target the old IP. Update the probe catalogue in the monitoring repo, then deploy it to the probers.'),
        cmds: ['cd ~/monitoring', 'grep -n 9651 ext-uptime/prometheus/prometheus.yml.tmpl', 'sed -i "s/198.51.100.12/198.51.100.47/" ext-uptime/prometheus/prometheus.yml.tmpl', 'grep -n 9651 ext-uptime/prometheus/prometheus.yml.tmpl', './scripts/deploy-ext-uptime.sh'],
        wait: 300,
      },
    ],
    limit: 4 * 3600, holdFor: 60,
    score: w => [avxScore(w)[0], [LL('avax-02 期末在线率', 'avax-02 end-of-period uptime'), A().projected(w.nodes['avax-02']).toFixed(3) + '%', A().projected(w.nodes['avax-02']) >= 95 ? 'good' : 'mid']],
    debrief: LL(
      '没有绑定弹性 IP 的实例，在停止再启动之后会获得新的公网 IP。avalanchego 的 <code>public-ip</code> 写在配置文件里，不会自动更新，节点会一直向网络通告一个已经不存在的地址。长期的做法是给实例绑定弹性 IP，或者使用 <code>public-ip-resolution-service</code>。如果只修了节点、没有更新探测配置，外部探测的告警会一直持续。',
      'An instance without an Elastic IP gets a new public IP after a stop and start. avalanchego\'s <code>public-ip</code> lives in its config file and is not refreshed, so the node keeps advertising an address that no longer exists. The lasting fix is an Elastic IP, or <code>public-ip-resolution-service</code>. Fixing the node without updating the probe config leaves the external-probe alert firing.'),
  });

  S.registerScenario({
    id: 'avax-disk', network: 'avalanche', module: AVX, lab: 'A4', difficulty: 2, minutes: 12,
    title: LL('根盘写满', 'The root disk is full'),
    tagline: LL('一次没做容量检查的恢复演练写满了 avax-01 的根盘，节点自己停了。', 'A restore drill filled avax-01\'s root disk without a space check, and the node shut itself down.'),
    learn: [
      LL('avalanchego 在磁盘将满时如何保护自己', 'How avalanchego protects itself when the disk is nearly full'),
      LL('找出占用空间的东西，只清理可以安全删除的部分', 'Finding what uses the space and removing only what is safe to remove'),
      LL('不停机在线扩容 EBS 根卷：modify-volume、growpart、resize2fs', 'Growing an EBS root volume online: modify-volume, growpart, resize2fs'),
    ],
    brief: LL(
      `<p>现在是 07:40 UTC。avax-01 停止验证已经半个多小时，<code>DiskSpaceCritical</code>、<code>NodeDown</code> 和 <code>AvalancheNodeUnhealthy</code> 都在响。</p><p>昨晚一位同事在 avax-01 上做恢复演练：把 S3 上的链数据种子包拷到本机，用来测一次重建要多久。拷之前没有检查可用空间。链数据库会持续增长，这台节点的根盘本来就已经不太宽裕。</p><p>请让 avax-01 恢复验证，并给根盘留出足够余量，让 <code>DiskSpaceLow</code> 也恢复。</p>`,
      `<p>It is 07:40 UTC. avax-01 stopped validating more than half an hour ago, and <code>DiskSpaceCritical</code>, <code>NodeDown</code> and <code>AvalancheNodeUnhealthy</code> are firing.</p><p>Last night a colleague ran a restore drill on avax-01: copy the chain-data seed archive from S3 to the node and time a rebuild. Nobody checked the free space first. The chain database grows every day, and this root disk was already short of headroom.</p><p>Bring avax-01 back, and leave its root disk with enough headroom that <code>DiskSpaceLow</code> clears as well.</p>`),
    startAt: '2026-10-15T07:40:00Z', alertAge: 1800,
    config: { activation: null, nodes: [Object.assign({}, FLEET[0], { bin: '1.15.0', db: '1.15.0', disk: { size: 1664, base: 14, dbGB: 1408, journalGB: 6.2 }, files: [{ path: '/home/ubuntu/seed/mainnet-latest.tar.zst', c: '(zstd compressed data, incomplete)', owner: 'root', fill: true, leaveGB: 0.2 }], since: -2280, stoppedAt: -2280, restarts: 452 })] },
    setup(w) {
      S.fsWrite(w.nodes['avax-01'], '/root/.bash_history', 'cd /home/ubuntu\nmkdir -p seed\naws s3 ls s3://example-chaindata/avalanche/ --region us-east-1\naws s3 cp s3://example-chaindata/avalanche/mainnet-latest.tar.zst /home/ubuntu/seed/ --region us-east-1\n', { mode: '600' });
    },
    objectives: [
      { text: LL('avax-01 的 avalanchego 在运行，/ext/health 报告 healthy', 'avalanchego runs on avax-01 and /ext/health reports healthy'), check: w => A().healthy(w, w.nodes['avax-01']) },
      { text: LL('根文件系统可用空间超过 15%（DiskSpaceLow 和 DiskSpaceCritical 都已恢复）', 'More than 15% of the root filesystem is free (DiskSpaceLow and DiskSpaceCritical have both cleared)'), check: w => A().availPct(w.nodes['avax-01']) >= 15 },
    ],
    forbidden: [
      { flag: 'db_files', text: LL('删除链数据库目录里的文件', 'Deleting files inside the chain database directory') },
      ...avxForbidden.filter(f => f.flag !== 'rollback'),
    ],
    hints: [
      {
        text: LL('先确认告警，让电话停下来。然后登录 avax-01，看根盘还剩多少，并在日志里找 FATAL 那一行。', 'Acknowledge the alerts so the paging stops. Then log in to avax-01, see how full the root disk is, and find the FATAL line in the log.'),
        cmds: ['ack DiskSpaceCritical', 'ack NodeDown', 'ack AvalancheNodeUnhealthy', 'ack AvalancheValidatorNotConnected', 'ack ExternalProbeFailure', 'ssm avax-01', 'sudo -i', 'df -h /', 'journalctl -u avalanchego -n 20 --no-pager'],
      },
      {
        text: LL('找出空间去了哪里，再看同事昨晚执行过什么。', 'Find where the space went, then look at what the colleague ran last night.'),
        cmds: ['du -h --max-depth=1 /home/ubuntu', 'du -sh /home/ubuntu/.avalanchego/db /var/log/journal', 'cat /root/.bash_history'],
      },
      {
        text: LL('可以安全删除的只有没拷完的种子包和归档日志。数据库目录 <code>/home/ubuntu/.avalanchego/db</code> 里的任何文件都不能删。腾出空间后，systemd 的下一次自动重启就会把节点拉起来。', 'Only the half-copied seed archive and the archived journals are safe to remove. Nothing under <code>/home/ubuntu/.avalanchego/db</code> may be deleted. Once there is space, the next automatic restart brings the node back.'),
        cmds: ['rm /home/ubuntu/seed/mainnet-latest.tar.zst', 'journalctl --vacuum-size=500M', 'df -h /'],
        wait: 120,
      },
      {
        text: LL('确认节点已恢复。只清理还不够让 DiskSpaceLow 恢复，需要在线扩容根卷。EBS 操作在工作电脑上做，节点的实例角色没有这个权限。', 'Confirm the node is back. Cleaning up alone does not clear DiskSpaceLow, so grow the root volume online. EBS changes are made from the workstation, because the instance role on the node cannot make them.'),
        cmds: ['systemctl status avalanchego', 'curl -s localhost:9650/ext/health | jq .healthy', 'exit', 'exit', 'aws ec2 describe-volumes --region us-east-1 --filters Name=attachment.instance-id,Values=i-0a1f3c5e7b9d24681 --output table', 'aws ec2 modify-volume --region us-east-1 --volume-id vol-018642d9b7e5c3f1a --size 2000'],
        wait: 120,
      },
      {
        text: LL('卷进入 optimizing 状态后，节点上就能看到新容量。在节点上扩展分区和文件系统，再确认可用空间。', 'Once the volume is optimizing, the node sees the new size. Grow the partition and the filesystem on the node, then check the free space.'),
        cmds: ['aws ec2 describe-volumes-modifications --region us-east-1 --volume-ids vol-018642d9b7e5c3f1a', 'ssm avax-01', 'sudo -i', 'lsblk', 'growpart /dev/nvme0n1 1', 'resize2fs /dev/nvme0n1p1', 'df -h /'],
      },
    ],
    limit: 4 * 3600, holdFor: 60,
    score: w => {
      const n = w.nodes['avax-01'], off = n.av.offline, use = 100 - A().availPct(n);
      return [
        [LL('本次离线时间（练习开始后）', 'Downtime during the lab'), S.fmtDur(off), off < 900 ? 'good' : off < 3600 ? 'mid' : 'bad'],
        [LL('结束时根盘使用率', 'Root disk use at the end'), use.toFixed(1) + '%', use < 75 ? 'good' : use < 85 ? 'mid' : 'bad'],
        [LL('根卷大小', 'Root volume size'), `${n.vol.size} GiB`, n.vol.size > 1664 ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      '这是运维中常见的一类事故。链数据库每天都在增长，根盘往往在没人注意的时候逼近上限。如果唯一的磁盘告警是一条很晚才触发的 critical，等它响起时节点通常已经停了，所以磁盘规则需要一个提前的预警档，留出在工作时间扩容的余地。从种子包恢复数据有一个前提：磁盘要同时放得下压缩包和解压后的数据。这里的演练跳过了这一步。可用空间低于 512 MiB 时，avalanchego 会自行退出来保护数据库，systemd 随后不断重启它。正确的顺序是：先删除不属于链数据的东西，让 systemd 把节点拉起来，再在线扩容根卷（modify-volume、growpart、resize2fs），整个过程不需要停机。删除数据库文件会把一小时的故障变成一次长达约一天的重新同步。扩容之后，创建新节点所用的模板或配置里的根卷大小也要一起调高，否则下次新建的节点还会是旧的容量。',
      'This is a common class of incident. The chain database grows every day, and root disks tend to approach their limit without anyone noticing. If the only disk alert is a late critical threshold, the node has usually stopped by the time it fires, so disk rules need an early warning tier that leaves time to grow the volume during working hours. Restoring from a seed archive has a prerequisite: the disk must hold both the archive and the extracted data. The drill here skipped that check. Below 512 MiB free, avalanchego shuts itself down to protect its database, and systemd keeps restarting it. The safe order is to remove what is not chain data, let systemd bring the node back, and then grow the root volume online with modify-volume, growpart and resize2fs, with no downtime. Deleting database files turns a one-hour outage into a resync of about a day. After growing a volume, also raise the root volume size in whatever builds new nodes, or the next node will start with the old size.'),
  });

  S.registerScenario({
    id: 'avax-period', network: 'avalanche', module: AVX, lab: 'A5', difficulty: 2, minutes: 12,
    title: LL('质押期结束前的变更', 'A change before the period ends'),
    tagline: LL('avax-02 的在线率低于 90%，质押期还剩四天。今天的变更窗口里有两台机器要换机型。', 'avax-02 is below 90% with four days left in its staking period, and today\'s change window holds two instance changes.'),
    learn: [
      LL('从独立视角读取在线率和质押期结束时间', 'Reading uptime and the period end time from the independent view'),
      LL('计算期末在线率，以及还能承受多少离线时间', 'Working out end-of-period uptime and how much downtime is still affordable'),
      LL('按余量安排计划内的停机', 'Scheduling planned downtime by the margin each node has'),
    ],
    brief: LL(
      `<p>10 月 16 日（周五）09:00 UTC。今天的变更窗口里有两个已经批准的 PR：<b>#521</b> 给 avax-01 换机型，<b>#522</b> 给 avax-02 换机型。两者都要停止实例，验证者会离线约 25 分钟。</p><p>从昨天起，avax-02 的 <code>AvalancheRewardingStakeCritical</code> 和 <code>AvalancheRewardAtRiskAtPeriodEnd</code> 一直在响。它的质押期四天后结束。奖励是全有或全无：期末在线率低于 90%，整期的奖励全部作废。</p><p>请判断今天哪个变更可以执行，执行它，并确保另一个不会被执行。</p>`,
      `<p>Friday 16 October, 09:00 UTC. Today's change window holds two approved pull requests: <b>#521</b> changes the instance type of avax-01 and <b>#522</b> that of avax-02. Both stop the instance, so each validator is offline for about 25 minutes.</p><p>Since yesterday, <code>AvalancheRewardingStakeCritical</code> and <code>AvalancheRewardAtRiskAtPeriodEnd</code> have been firing for avax-02. Its staking period ends in four days. The reward is all or nothing: if the period ends below 90% uptime, the whole period's reward is lost.</p><p>Decide which change can run today, run it, and make sure the other one does not.</p>`),
    startAt: '2026-10-16T09:00:00Z', alertAge: 64800,
    config: {
      activation: null,
      nodes: fleet(f => Object.assign({ bin: '1.15.0', db: '1.15.0' }, f.moniker === 'avax-02' ? { elapsedDays: 52, periodDays: 56, downHours: 134.15 } : {})),
      prs: [
        { n: 521, kind: 'resize', moniker: 'avax-01', to: 'c6in.4xlarge', memGB: 32, downMin: 25, author: 'ops-capacity', branch: 'resize/avax-01', title: 'infra(avalanche): avax-01 c6in.2xlarge -> c6in.4xlarge (16 GB -> 32 GB)',
          body: '  avax-01 (NodeID-7Xhw2mDxuDS44j42TCB6U5579esbSt3Lg), us-east-1\n  Reason: two OOM kills in the last month. 16 GB is not enough while the node replays.\n\n  On merge, instance-resize.yml will:\n    1. systemctl stop avalanchego\n    2. stop the instance, set --instance-type c6in.4xlarge, start it\n    3. avalanchego starts on boot and replays\n  Expected validator downtime: about 25 minutes.\n  The Elastic IP stays attached, so public-ip does not change.\n  Window: Friday 16 October, 09:00-12:00 UTC.' },
        { n: 522, kind: 'resize', moniker: 'avax-02', to: 'm6a.2xlarge', memGB: 32, downMin: 25, author: 'ops-capacity', branch: 'resize/avax-02', title: 'infra(avalanche): avax-02 t3.2xlarge -> m6a.2xlarge',
          body: '  avax-02 (NodeID-MFrZFVCXPv5iCn6M9K6XduxGTYp891xXZ), us-west-2\n  Reason: the t3 runs out of CPU credits while replaying; consensus falls behind.\n\n  On merge, instance-resize.yml will:\n    1. systemctl stop avalanchego\n    2. stop the instance, set --instance-type m6a.2xlarge, start it\n    3. avalanchego starts on boot and replays\n  Expected validator downtime: about 25 minutes.\n  The Elastic IP stays attached, so public-ip does not change.\n  Window: Friday 16 October, 09:00-12:00 UTC.' },
      ],
    },
    setup(w) { w.chain.prs = w.scn.config.prs.map(p => Object.assign({ labels: [], comments: [] }, p)); },
    tick(w) { if (A().projected(w.nodes['avax-02']) < 90) S.flag(w, 'forfeit'); },
    objectives: [
      { text: LL('从独立视角（api.avax.network）读取 avax-02 的在线率和结束时间', 'Read avax-02\'s uptime and end time from the independent view (api.avax.network)'), check: w => !!(w.chain.seen && w.chain.seen['avax-02']) },
      { text: LL('#521 已合并，avax-01 在新机型上恢复健康', '#521 is merged and avax-01 is healthy on its new instance type'), check: w => w.nodes['avax-01'].instanceType === 'c6in.4xlarge' && A().healthy(w, w.nodes['avax-01']) },
      { text: LL('#522 被挡到 avax-02 的质押期结束之后（关闭 PR，或加上 do-not-merge 标签）', '#522 is held until avax-02\'s period has ended (closed, or labelled do-not-merge)'), check: w => { const p = w.chain.prs.find(x => x.n === 522); return !p.merged && (p.closed || p.labels.some(l => /do-not-merge|hold/i.test(l))); } },
      { text: LL('avax-02 保持在线（connected）', 'avax-02 stays connected'), check: w => A().connected(w, w.nodes['avax-02']) },
    ],
    forbidden: [
      { flag: 'forfeit', text: LL('让 avax-02 的期末在线率跌破 90%（计划内停机用掉了全部余量）', 'Pushing avax-02\'s end-of-period uptime below 90% (planned downtime used up the whole margin)') },
      ...avxForbidden,
    ],
    hints: [
      {
        text: LL('先确认两条 critical 告警，让电话停下来。然后读两个 PR：它们都要停实例约 25 分钟，PR 里写了对应节点的 NodeID。', 'Acknowledge the two critical alerts so the paging stops. Then read both pull requests: each stops an instance for about 25 minutes and names its node\'s NodeID.'),
        cmds: ['ack AvalancheRewardingStakeCritical', 'ack AvalancheRewardAtRiskAtPeriodEnd', 'gh pr list', 'gh pr view 521', 'gh pr view 522'],
      },
      {
        text: LL('奖励依据的是 P-Chain 上的记录。向独立节点 api.avax.network 读取每台验证者的在线率和结束时间，再把 avax-02 的 endTime 换算成日期。', 'The reward is paid on the P-Chain record. Read each validator\'s uptime and end time from the independent node api.avax.network, then convert avax-02\'s endTime to a date.'),
        cmds: [
          'curl -s -X POST --data \'{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators","params":{}}\' https://api.avax.network/ext/bc/P | jq \'.result.validators[] | {nodeID, uptime, endTime}\'',
          'END=$(curl -s -X POST --data \'{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators","params":{"nodeIDs":["NodeID-MFrZFVCXPv5iCn6M9K6XduxGTYp891xXZ"]}}\' https://api.avax.network/ext/bc/P | jq -r \'.result.validators[0].endTime\'); date -u -d @$END',
        ],
      },
      {
        text: LL('算一算。期末在线率 = (当前在线率 × 已过天数 + 100 × 剩余天数) ÷ 整期天数。avax-02 已过 52 天、还剩 4 天：一直在线时期末约 90.02%；每离线一小时损失约 0.074 个百分点；再停 25 分钟就会跌破 90%。', 'Do the arithmetic. End-of-period uptime = (current uptime × days elapsed + 100 × days left) ÷ period length. avax-02 is 52 days in with 4 left: online throughout it ends at about 90.02%, each hour offline costs about 0.074 points, and a 25-minute outage takes it below 90%.'),
        cmds: ['echo "scale=4; (89.2508*52 + 100*4)/56" | bc', 'echo "scale=4; 100/56/24" | bc', 'echo "scale=4; (89.2508*52 + 100*4 - 100*25/60/24)/56" | bc'],
      },
      {
        text: LL('#522 要等 avax-02 的质押期结束之后再做。给它加上 do-not-merge 标签，并留言说明原因。', '#522 waits until avax-02\'s period has ended. Label it do-not-merge and leave a comment with the reason.'),
        cmds: ['gh pr edit 522 --add-label do-not-merge', 'gh pr comment 522 --body "Hold until avax-02\'s staking period ends on 20 October: 25 minutes offline now would take it below 90% and forfeit the reward."', 'gh pr view 522'],
      },
      {
        text: LL('avax-01 在线率约 99.3%，质押期还有几个月，25 分钟的停机影响很小。合并 #521，然后在事件记录里等 avax-01 在新机型上恢复健康。', 'avax-01 is at about 99.3% with months left in its period, so 25 minutes offline barely moves it. Merge #521, then watch the event log until avax-01 is healthy on its new instance type.'),
        cmds: ['gh pr merge 521', 'gh pr list'],
        wait: 1800,
      },
    ],
    limit: 4 * 3600, holdFor: 60,
    score: w => {
      const p2 = A().projected(w.nodes['avax-02']), done = w.nodes['avax-01'].instanceType === 'c6in.4xlarge';
      return [
        [LL('avax-02 期末在线率（之后不再离线）', 'avax-02 end-of-period uptime (if no further downtime)'), p2.toFixed(3) + '%', p2 >= 90 ? 'good' : 'bad'],
        [LL('avax-01 换机型', 'avax-01 instance change'), done ? LL('已完成', 'done') : LL('未完成', 'not done'), done ? 'good' : 'mid'],
        [LL('avax-01 期末在线率（之后不再离线）', 'avax-01 end-of-period uptime (if no further downtime)'), A().projected(w.nodes['avax-01']).toFixed(3) + '%', A().projected(w.nodes['avax-01']) >= 95 ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      'info.uptime 的 rewardingStakePercentage 是一个常见的误读来源。它表示本节点能看到全网多少质押在线，描述的是网络，而不是这台节点。在线率相差好几个百分点的两台节点，读数可以几乎完全相同；用它做告警，会在其他验证者掉线时让所有节点一起告警，而真正接近门槛的那一台反而分辨不出来。判断奖励，要读取 P-Chain 上这台验证者自己的记录，并且向独立节点（例如 api.avax.network）查询，不要问节点自己。RewardAtRiskAtPeriodEnd 这类告警说奖励即将作废，但结论要靠计算。在线率是累计值，剩下的每一天在线都会把它往上拉。在线率 89.25%、还剩四天的节点，只要不再出问题，期末仍有 90.02%，余量约 15 分钟，任何计划内的停机都会用掉它。需要停实例的变更，应该安排在余量充足的时候。另外，质押期结束时通常没有任何告警：验证者不再出现在当前验证者列表中，在线率类告警随之静默。用同一个 NodeID 重新注册（绝不重新生成 signer.key）需要提前排进计划。',
      'info.uptime\'s rewardingStakePercentage is a common source of misreadings. It is how much of the network\'s stake this node can see online, so it describes the network, not the node. Two nodes whose real uptimes differ by several points can read almost the same value. An alert built on it pages every node whenever other validators drop off, and the one node genuinely near the floor cannot be told apart. To judge the reward, read this validator\'s own record on the P-Chain from an independent node such as api.avax.network, never from the node itself. An alert such as RewardAtRiskAtPeriodEnd says the reward is about to be lost; the arithmetic decides. Uptime is cumulative, so every remaining day online pulls it up. A node at 89.25% with four days left still ends the period at 90.02% if nothing else goes wrong. That is a margin of about 15 minutes, and any planned downtime uses it up. Changes that stop an instance belong in periods with ample margin. Also note that the end of a period usually raises no alert at all: the validator drops out of the current validator set and the uptime alerts go quiet. Re-registering with the same NodeID, never with a new signer.key, has to be planned ahead.'),
  });
})(SIM);
