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
      LL('<code>ssm avax-01</code>、<code>sudo -i</code>、<code>df -h /</code>，再看 <code>journalctl -u avalanchego -n 20 --no-pager</code> 里的 FATAL。', '<code>ssm avax-01</code>, <code>sudo -i</code>, <code>df -h /</code>, then look for FATAL in <code>journalctl -u avalanchego -n 20 --no-pager</code>.'),
      LL('找出空间去了哪里：<code>du -h --max-depth=1 /home/ubuntu</code>、<code>du -sh /home/ubuntu/.avalanchego/db /var/log/journal</code>。同事做过什么，可以看 <code>cat /root/.bash_history</code>。', 'Find where the space went: <code>du -h --max-depth=1 /home/ubuntu</code>, <code>du -sh /home/ubuntu/.avalanchego/db /var/log/journal</code>. To see what the colleague ran: <code>cat /root/.bash_history</code>.'),
      LL('可以安全删除的是没拷完的种子包 <code>/home/ubuntu/seed/mainnet-latest.tar.zst</code> 和归档日志（<code>journalctl --vacuum-size=500M</code>）。数据库目录 <code>/home/ubuntu/.avalanchego/db</code> 里的任何文件都不能删。腾出空间后，systemd 的下一次自动重启就会恢复节点。', 'Safe to remove: the half-copied seed archive <code>/home/ubuntu/seed/mainnet-latest.tar.zst</code> and the archived journals (<code>journalctl --vacuum-size=500M</code>). Nothing under <code>/home/ubuntu/.avalanchego/db</code> may be deleted. Once there is space, the next automatic restart brings the node back.'),
      LL('只清理还不够让 DiskSpaceLow 恢复，需要在线扩容。回到工作电脑：<code>aws ec2 describe-volumes --region us-east-1 --filters Name=attachment.instance-id,Values=i-0a1f3c5e7b9d24681 --output table</code>，再 <code>aws ec2 modify-volume --region us-east-1 --volume-id &lt;卷 ID&gt; --size 2000</code>。', 'Cleaning up alone does not clear DiskSpaceLow; grow the volume online. From the workstation: <code>aws ec2 describe-volumes --region us-east-1 --filters Name=attachment.instance-id,Values=i-0a1f3c5e7b9d24681 --output table</code>, then <code>aws ec2 modify-volume --region us-east-1 --volume-id &lt;volume-id&gt; --size 2000</code>.'),
      LL('约一分钟后卷进入 optimizing 状态，<code>lsblk</code> 能看到新容量。然后在节点上以 root 执行 <code>growpart /dev/nvme0n1 1</code> 和 <code>resize2fs /dev/nvme0n1p1</code>，用 <code>df -h /</code> 确认。', 'After about a minute the volume enters the optimizing state and <code>lsblk</code> shows the new size. Then, as root on the node, run <code>growpart /dev/nvme0n1 1</code> and <code>resize2fs /dev/nvme0n1p1</code>, and confirm with <code>df -h /</code>.'),
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
      LL('先看奖励实际依据的记录：<code>curl -s -X POST --data \'{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators","params":{}}\' https://api.avax.network/ext/bc/P | jq \'.result.validators[] | {nodeID, uptime, endTime}\'</code>。每个 PR 里写了对应节点的 NodeID（<code>gh pr view 522</code>）。', 'Start with the record the reward is paid on: <code>curl -s -X POST --data \'{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators","params":{}}\' https://api.avax.network/ext/bc/P | jq \'.result.validators[] | {nodeID, uptime, endTime}\'</code>. Each PR names its node\'s NodeID (<code>gh pr view 522</code>).'),
      LL('<code>date -u -d @&lt;endTime&gt;</code> 换算结束时间。期末在线率 = (当前在线率 × 已过天数 + 100 × 剩余天数) ÷ 整期天数，例如 <code>echo "scale=4; (89.2508*52 + 100*4)/56" | bc</code>。avax-02 的整期是 56 天，每离线一小时约损失 0.074 个百分点。', 'Convert the end time with <code>date -u -d @&lt;endTime&gt;</code>. End-of-period uptime = (current uptime × days elapsed + 100 × days left) ÷ period length, for example <code>echo "scale=4; (89.2508*52 + 100*4)/56" | bc</code>. avax-02\'s period is 56 days, so each hour offline costs about 0.074 percentage points.'),
      LL('avax-02 如果一直在线，期末约 90.02%，余量只有约 15 分钟。25 分钟的变更会让整期奖励作废，所以 #522 要等期末之后再做：<code>gh pr edit 522 --add-label do-not-merge</code>，或者 <code>gh pr close 522 --comment "等 avax-02 质押期结束后再做"</code>。', 'If avax-02 stays online it ends the period at about 90.02%, a margin of about 15 minutes. A 25-minute change would forfeit the whole reward, so #522 waits until after the period ends: <code>gh pr edit 522 --add-label do-not-merge</code>, or <code>gh pr close 522 --comment "after avax-02\'s period ends"</code>.'),
      LL('avax-01 在线率约 99.3%，质押期还有几个月，25 分钟的停机影响很小：<code>gh pr merge 521</code>，然后在事件记录里等它恢复健康。', 'avax-01 is at about 99.3% with months left in its period, so 25 minutes offline barely moves it: <code>gh pr merge 521</code>, then watch the event log until it is healthy.'),
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
  const SH = () => S.networks.solana.helpers;
  const STAKED = '7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv';
  S.registerScenario({
    id: 'sol-failover', network: 'solana', module: SOL, lab: 'S2', difficulty: 3, minutes: 15,
    title: LL('计划内的主备切换', 'A planned switch to the standby'),
    tagline: LL('sol-1 所在的机柜 15:00 断电维护。把投票交给热备机，而且不能双签。', 'The rack holding sol-1 loses power at 15:00 for maintenance. Hand voting to the hot standby without ever double signing.'),
    learn: [
      LL('身份切换的顺序：主节点先放手，备用机再接手', 'The order of an identity switch: the primary lets go before the standby takes over'),
      LL('tower 文件的作用，以及 set-identity --require-tower', 'What the tower file is for, and set-identity --require-tower'),
      LL('防止旧主节点重新上线时带着质押 identity 启动', 'Keeping the old primary from coming back with the staked identity'),
    ],
    brief: LL(
      `<p>现在是 14:20 UTC。机房通知：sol-1 所在的机柜将在 <b>15:00</b> 断电维护，大约 45 分钟。</p><p>sol-backup 是热备机：它已经追上链头，用自己的非质押 identity 运行，机器上也存有一份质押 keypair。请在 15:00 之前把投票交给 sol-backup。</p><p>要求：任何时刻都不能有两台机器同时使用质押 identity；备用机要带着主节点的 tower 接手；sol-1 维护结束重新通电后，不能变成第二个用质押 identity 运行的验证者。</p>`,
      `<p>It is 14:20 UTC. The data centre has announced that the rack holding sol-1 will be powered off at <b>15:00</b> for about 45 minutes of maintenance.</p><p>sol-backup is a hot standby: it is caught up, runs its own unstaked identity, and holds a copy of the staked keypair. Move voting to sol-backup before 15:00.</p><p>The rules: at no moment may two machines run the staked identity; the standby must take over with the primary's tower; and when sol-1 powers back on after maintenance, it must not become a second validator running the staked identity.</p>`),
    startAt: '2026-10-07T14:20:00Z',
    config: { balance: 14, burnPerDay: 2.1, standby: 'unstaked', setIdentity: true, maintenance: { host: 'sol-1', off: 2400, on: 5100 } },
    setup(w) {
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(
        `# testnet 验证者\n- 质押 identity: ${STAKED}\n- vote account: ${w.chain.vote}\n- sol-1（主，198.51.100.21）：非质押 keypair 在 /home/sol/unstaked-identity.json\n- sol-backup（热备，198.51.100.22）：平时用自己的非质押 identity 运行；质押 keypair 在 /home/sol/validator-keypair.json\n- 两台的 ledger 和 tower 文件都在 /mnt/ledger；sol 和 root 用户可以互相 scp\n- 2026-10-07 15:00–15:45 UTC：机柜维护，sol-1 断电\n`,
        `# testnet validator\n- staked identity: ${STAKED}\n- vote account: ${w.chain.vote}\n- sol-1 (primary, 198.51.100.21): unstaked keypair at /home/sol/unstaked-identity.json\n- sol-backup (hot standby, 198.51.100.22): runs its own unstaked identity; staked keypair at /home/sol/validator-keypair.json\n- ledger and tower files are in /mnt/ledger on both; the sol and root users can scp between them\n- 2026-10-07 15:00-15:45 UTC: rack maintenance, sol-1 powered off\n`));
    },
    objectives: [
      { text: LL('sol-backup 用质押 identity 投票，验证者没有 delinquent', 'sol-backup votes with the staked identity and the validator is not delinquent'), check: w => SH().isVoting(w, w.nodes['sol-backup']) && !SH().delinquent(w) },
      { text: LL('sol-1 不再使用质押 identity（已停止、已断电，或已切到非质押 identity）', 'sol-1 no longer runs the staked identity (stopped, powered off, or switched to an unstaked identity)'), check: w => SH().runningIdentity(w, w.nodes['sol-1']) !== w.chain.identity },
      { text: LL('sol-1 重新通电后不会用质押 identity 启动（服务已 disable，或 unit 指向非质押 keypair）', 'sol-1 cannot start with the staked identity when it powers back on (service disabled, or its unit points at the unstaked keypair)'), check: w => { const n = w.nodes['sol-1']; return n.services['agave-validator'].enabled === false || SH().unitIdentity(w, n) !== w.chain.identity; } },
    ],
    forbidden: [
      { flag: 'double_sign', text: LL('让两台机器同时使用质押 identity', 'Running the staked identity on two machines at once') },
      { flag: 'no_tower', text: LL('备用机在没有主节点 tower 文件的情况下接管质押 identity', 'Taking over the staked identity on the standby without the primary\'s tower file') },
    ],
    hints: [
      LL('先确认备用机已经追上：<code>ssm sol-backup</code>、<code>solana catchup --our-localhost</code>、<code>agave-validator -l /mnt/ledger monitor</code>（Ctrl+C 退出），然后 <code>exit</code>。笔记在工作电脑的 <code>~/NOTES.md</code>。', 'First confirm the standby is caught up: <code>ssm sol-backup</code>, <code>solana catchup --our-localhost</code>, <code>agave-validator -l /mnt/ledger monitor</code> (Ctrl+C to stop), then <code>exit</code>. Notes are in <code>~/NOTES.md</code> on the workstation.'),
      LL('在 sol-1 上以 root：<code>agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check</code>，然后 <code>agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json</code>。从这一刻起 sol-1 不再用质押 identity 签名。', 'On sol-1 as root: <code>agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check</code>, then <code>agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json</code>. From then on sol-1 no longer signs with the staked identity.'),
      LL(`把 tower 拷到备用机：<code>scp /mnt/ledger/tower-1_9-${STAKED}.bin sol-backup:/mnt/ledger/</code>`, `Copy the tower to the standby: <code>scp /mnt/ledger/tower-1_9-${STAKED}.bin sol-backup:/mnt/ledger/</code>`),
      LL(`在 sol-backup 上以 root：<code>agave-validator -l /mnt/ledger set-identity --require-tower /home/sol/validator-keypair.json</code>。确认：<code>solana gossip | grep ${STAKED}</code> 显示 198.51.100.22。`, `On sol-backup as root: <code>agave-validator -l /mnt/ledger set-identity --require-tower /home/sol/validator-keypair.json</code>. Confirm with <code>solana gossip | grep ${STAKED}</code>, which should show 198.51.100.22.`),
      LL('15:45 sol-1 会重新通电，systemd 按 unit 文件启动它。在 sol-1 上执行 <code>systemctl disable agave-validator</code>，或者 <code>sed -i \'s/validator-keypair.json/unstaked-identity.json/\' /etc/systemd/system/agave-validator.service</code>。', 'sol-1 powers back on at 15:45 and systemd starts it from its unit file. On sol-1, run <code>systemctl disable agave-validator</code>, or <code>sed -i \'s/validator-keypair.json/unstaked-identity.json/\' /etc/systemd/system/agave-validator.service</code>.'),
    ],
    limit: 3 * 3600, holdFor: 60,
    score: w => {
      const gap = w.chain.noVoteSec || 0;
      return [
        [LL('没有投票的时间（合计）', 'Time without voting (total)'), S.fmtDur(gap), gap < 60 ? 'good' : gap < 300 ? 'mid' : 'bad'],
        [LL('delinquent 时长', 'Time delinquent'), S.fmtDur(w.chain.delinquentSec || 0), (w.chain.delinquentSec || 0) === 0 ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      '本练习按通用的身份热切换步骤编写。迁移验证者或切换主备时，质押 identity 往往不止存在于一处：新旧主机、密钥备份，以及已经退役的机器上都可能留有副本。由此得出一条规则：任何时候都不能用这把密钥启动第二个验证者进程，退役的机器即使重新上线也不行。切换的顺序就是保护：主节点先用 set-identity 放手，tower 跟着 identity 走，备用机再用 --require-tower 接手。只删除密钥文件不能阻止正在运行的进程继续用内存中的密钥签名。实际操作中这几步会写成脚本，投票空档只有几秒；手工操作时间更长，超过约 51 秒验证者就会被标记为 delinquent。',
      'This lab follows the general identity hot-swap procedure. When a validator is migrated or switched to a standby, the staked identity usually exists in more than one place: the old and new hosts, key backups, and machines that have been retired may all hold a copy. That gives one rule: no second validator process may ever start with the key, and a retired machine that comes back online is no exception. The switch order is the safeguard. The primary lets go with set-identity, the tower travels with the identity, and only then does the standby take over with --require-tower. Deleting a key file does not stop a running process from signing with the key it holds in memory. In practice these steps are scripted and the voting gap is a few seconds. Done by hand it takes longer, and a gap over about 51 seconds marks the validator delinquent.'),
  });

  S.registerScenario({
    id: 'sol-stale-snapshot', network: 'solana', module: SOL, lab: 'S3', difficulty: 2, minutes: 12,
    title: LL('重启之后仍然 delinquent', 'Still delinquent after a restart'),
    tagline: LL('sol-1 停机两天后重新启动，服务显示 active，但它离链头越来越远。', 'sol-1 was restarted after two days offline. The service is active, but it keeps falling further behind.'),
    learn: [
      LL('用 solana catchup 判断节点在追赶还是在落后', 'Using solana catchup to tell catching up from falling behind'),
      LL('长时间停机后为什么要用新快照启动', 'Why a node needs a fresh snapshot after a long outage'),
      LL('哪些 ledger 文件可以动，哪些不能动', 'Which ledger files may be touched and which may not'),
    ],
    brief: LL(
      `<p>sol-1 停机两天，机房更换了一根故障内存条。同事在 08:05 UTC 重新启动了 agave-validator，然后去开会了。</p><p>现在是 08:30，验证者仍然 delinquent：<code>SolanaValidatorDelinquent</code>、<code>SolanaVoteInactive</code> 和 <code>SolanaSlotsSeverelyBehind</code> 都在响，但 systemd 显示服务是 active。同事留言："它在追块，给它点时间。如果一会儿还是红的，就把 sol-backup 启动起来。"</p><p>请让 sol-1 恢复投票。</p>`,
      `<p>sol-1 was offline for two days while the data centre replaced a faulty memory module. A colleague started agave-validator again at 08:05 UTC and went into a meeting.</p><p>It is now 08:30 and the validator is still delinquent: <code>SolanaValidatorDelinquent</code>, <code>SolanaVoteInactive</code> and <code>SolanaSlotsSeverelyBehind</code> are firing, while systemd reports the service as active. The colleague left a message: "It's catching up, give it time. If it's still red later, start sol-backup."</p><p>Get sol-1 voting again.</p>`),
    startAt: '2026-11-03T08:30:00Z', alertAge: 1200,
    config: { balance: 14, burnPerDay: 2.1, snapshots: true, credits: 0, staleRestart: { downFor: 2 * 86400 + 1800, restartedAgo: 1500 } },
    objectives: [
      { text: LL('sol-1 在投票，验证者没有 delinquent', 'sol-1 is voting and the validator is not delinquent'), check: w => SH().isVoting(w, w.nodes['sol-1']) && !SH().delinquent(w) },
      { text: LL('恢复后用链上数据确认一次（solana catchup、validators 或 vote-account）', 'Once it recovers, confirm from on-chain data (solana catchup, validators or vote-account)'), check: w => w.flags.verified !== undefined },
    ],
    forbidden: [
      { flag: 'double_sign', text: LL('让两台机器同时使用质押 identity（sol-backup 的 unit 配置的是同一个质押 identity）', 'Running the staked identity on two machines at once (sol-backup\'s unit is configured with the same staked identity)') },
      { flag: 'wipe_ledger', text: LL('删除 ledger 中的 rocksdb、accounts 或 tower 文件', 'Deleting rocksdb, accounts or tower files from the ledger') },
    ],
    hints: [
      LL('<code>ssm sol-1</code>、<code>sudo -i</code>、<code>solana catchup --our-localhost</code>。看清楚它是在追赶（gaining），还是在落后（falling behind）。', '<code>ssm sol-1</code>, <code>sudo -i</code>, <code>solana catchup --our-localhost</code>. Note whether it is gaining or falling behind.'),
      LL('<code>journalctl -u agave-validator -n 30 --no-pager</code> 和 <code>systemctl cat agave-validator</code>。注意它加载的快照来自哪个 slot，以及是哪个参数让它没有去找更新的快照。', '<code>journalctl -u agave-validator -n 30 --no-pager</code> and <code>systemctl cat agave-validator</code>. Note the slot of the snapshot it loaded, and the flag that kept it from looking for a newer one.'),
      LL('停机两天的节点，没法靠从其他节点修复（repair）缺失的 slot 追上来，需要一个新的快照。去掉 <code>--no-snapshot-fetch</code>：<code>sed -i \'s/ --no-snapshot-fetch//\' /etc/systemd/system/agave-validator.service</code>，<code>systemctl daemon-reload</code>，<code>systemctl restart agave-validator</code>。', 'A node that was down for two days cannot catch up by repairing the missing slots from peers. It needs a fresh snapshot. Remove <code>--no-snapshot-fetch</code>: <code>sed -i \'s/ --no-snapshot-fetch//\' /etc/systemd/system/agave-validator.service</code>, <code>systemctl daemon-reload</code>, <code>systemctl restart agave-validator</code>.'),
      LL('节点会从 known validator 下载快照、加载，然后在几分钟内追上。用 <code>agave-validator -l /mnt/ledger monitor</code> 观察，最后用 <code>solana catchup --our-localhost</code> 确认。不要动 rocksdb、accounts 和 tower 文件，也不要启动 sol-backup。', 'The node downloads a snapshot from a known validator, loads it, and catches up within a few minutes. Watch with <code>agave-validator -l /mnt/ledger monitor</code>, then confirm with <code>solana catchup --our-localhost</code>. Leave rocksdb, accounts and the tower file alone, and do not start sol-backup.'),
    ],
    limit: 3 * 3600, holdFor: 60,
    score: w => {
      const d = w.chain.delinquentSec || 0;
      return [
        [LL('练习中 delinquent 的时长', 'Time delinquent during the lab'), S.fmtDur(d), d < 1200 ? 'good' : d < 3600 ? 'mid' : 'bad'],
      ];
    },
    debrief: LL(
      '长时间停机后，带着 <code>--no-snapshot-fetch</code> 重启的验证者，会加载自己最后一个本地快照。从那以后的每个 slot 都要重放，而 blockstore 里没有的 slot 只能从其他节点修复（repair）。修复的速度比集群出块慢，所以差距越拉越大，systemd 却一直显示 active。解决办法是从 known validator 下载一个新快照。<code>--no-snapshot-fetch</code> 适合短暂的重启；停机很久之后，它会把节点困在过去。按同事的建议启动备用机也解决不了问题：sol-1 一旦追上，两台机器就会用同一把密钥投票。这里的告警时间线与常见的生产规则一致：停投约 51 秒后链上标记 delinquent，SolanaValidatorDelinquent 在 5 分钟后触发，落后超过 1,500 个 slot 后 SolanaSlotsSeverelyBehind 触发。如果监控只检查进程是否在运行，一个停投的验证者可能连续几个 epoch 拿不到奖励而无人察觉。这就是奖励流告警存在的原因：它们比较本 epoch 的 credits 与集群中位数，并检查上一个 epoch 的奖励是否到账。',
      'A validator restarted after a long outage with <code>--no-snapshot-fetch</code> loads its last local snapshot. Every slot since then has to be replayed, and slots the blockstore never received must be repaired from peers. Repair is slower than the cluster produces slots, so the gap keeps growing while systemd shows the service as active. The fix is a fresh snapshot from a known validator. <code>--no-snapshot-fetch</code> suits short restarts; after a long outage it keeps the node stuck in the past. Starting the standby, as the colleague suggested, would not have helped: as soon as sol-1 caught up, two machines would vote with one key. The alert timeline here matches common production rules: the chain marks a validator delinquent about 51 seconds after it stops voting, SolanaValidatorDelinquent fires 5 minutes later, and SolanaSlotsSeverelyBehind fires once the gap passes 1,500 slots. If monitoring only checks that the process is running, a stalled validator can lose rewards for several epochs before anyone notices. That is why rewards-flow alerts exist: they compare this epoch\'s credits with the cluster median, and check that the last epoch\'s rewards arrived.'),
  });
})(SIM);
