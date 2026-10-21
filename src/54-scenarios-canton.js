/* ============================================================
   Canton labs. Data plus predicates over the world; the mechanics
   live in 44-net-canton.js. Text fields are bilingual: S.LL(zh, en).
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL;
  const H = () => S.networks.canton.helpers;
  const MOD = LL('Canton 验证者运维', 'Canton validator operations');
  const cn = w => H().node(w).cn;
  const wipe = { flag: 'wipe_db', text: LL('删除 postgres 卷或其中的文件（docker compose down -v、./stop.sh -D、docker volume rm/prune、rm）', 'Deleting the postgres volume or files inside it (docker compose down -v, ./stop.sh -D, docker volume rm/prune, rm)') };
  const missedRow = w => [LL('本次错过的轮次', 'Rounds missed during the lab'), String(cn(w).missed), cn(w).missed === 0 ? 'good' : cn(w).missed <= 2 ? 'mid' : 'bad'];
  const recordedNow = { text: LL('验证者在当前轮次记录了活动', 'The validator has recorded activity in the current round'), check: w => H().current(w) && H().identityOk(w) };

  S.registerScenario({
    id: 'canton-traffic', network: 'canton', module: MOD, lab: 'C1', difficulty: 2, minutes: 12,
    title: LL('Traffic 快用完了', 'Traffic running out'),
    tagline: LL('看板上的 Traffic Remainder 变红了，而且还在下降。', 'Traffic Remainder on the dashboard has turned red and keeps falling.'),
    learn: [
      LL('traffic 是什么，用完之后哪些操作会失败', 'What traffic is, and what fails when it runs out'),
      LL('自动充值的配置，以及让 .env 改动生效的正确方式', 'How automated top-ups are configured, and how to make an .env change take effect'),
      LL('通过 wallet API 手动购买 traffic，并确认买给了正确的 party', 'Buying traffic by hand through the wallet API, for the right party'),
    ],
    brief: LL(
      `<p>周二晚上 19:40，Canton 验证者 <b>canton-01</b> 在节点总览看板上的 Traffic Remainder 一栏变红：低于 50,000 bytes，并且每分钟都在减少。</p><p>验证者向 Global Synchronizer 提交的每一笔交易都要消耗 traffic，包括每一轮的活动记录。traffic 用钱包里的 CC 购买，通常由验证者应用自动补充。traffic 用完之后，节点还能读取账本，但提交会被 sequencer 拒绝，每一轮的奖励都会错过。</p><p>请在 traffic 用完之前让它恢复，并找到它没有自动补充的原因。</p>`,
      `<p>At 19:40 on a Tuesday the Traffic Remainder column for the Canton validator <b>canton-01</b> turns red on the fleet dashboard: below 50,000 bytes and falling every minute.</p><p>Every transaction the validator submits to the Global Synchronizer consumes traffic, including its activity record in each round. Traffic is bought with CC from the validator wallet, and the validator app normally tops it up on its own. Once it runs out the node can still read the ledger, but the sequencers reject its submissions and it misses the reward in every round.</p><p>Restore the traffic before it runs out, and find out why it was not topped up automatically.</p>`),
    startAt: '2026-10-13T19:40:00Z',
    config: { tag: '0.8.2', remainder: 18500, consume: 15, target: 0, wallet: 2180, topupNote: '# Set to 0 on 2026-10-07 while CC spending was reviewed. The value before was 2000.' },
    objectives: [
      { text: LL('Traffic Remainder 不低于 50,000 bytes（看板上为绿色）', 'Traffic Remainder is at least 50,000 bytes (green on the dashboard)'), check: w => H().remainder(w) >= H().RED_LINE },
      { text: LL('运行中的验证者容器已开启自动充值（TARGET_TRAFFIC_THROUGHPUT 大于 0）', 'The running validator container has automated top-ups on (TARGET_TRAFFIC_THROUGHPUT above 0)'), check: w => H().topupOn(w) },
      recordedNow,
    ],
    forbidden: [
      { flag: 'wrong_party', text: LL('把 traffic 买给本验证者以外的 party', 'Buying traffic for a party other than this validator') },
      wipe,
    ],
    hints: [
      LL('<code>ssm canton-01</code>、<code>sudo -i</code>，然后看验证者应用的日志：<code>docker logs --tail 30 splice-validator-validator-1</code>。', '<code>ssm canton-01</code>, <code>sudo -i</code>, then read the validator app log: <code>docker logs --tail 30 splice-validator-validator-1</code>.'),
      LL('日志说自动充值是关着的。配置在 <code>/opt/splice-node/docker-compose/validator/.env</code>：<code>grep TRAFFIC .env</code>。改成 2000：<code>sed -i \'s/TARGET_TRAFFIC_THROUGHPUT=0/TARGET_TRAFFIC_THROUGHPUT=2000/\' .env</code>。', 'The log says automated top-ups are off. The setting is in <code>/opt/splice-node/docker-compose/validator/.env</code>: <code>grep TRAFFIC .env</code>. Set it to 2000: <code>sed -i \'s/TARGET_TRAFFIC_THROUGHPUT=0/TARGET_TRAFFIC_THROUGHPUT=2000/\' .env</code>.'),
      LL('在 compose 目录执行 <code>docker compose up -d</code>，compose 会按新的 .env 重建验证者容器。<code>docker compose restart</code> 不会重新读取 .env。用 <code>docker inspect splice-validator-validator-1 | grep TARGET</code> 确认。', 'In the compose directory run <code>docker compose up -d</code>; compose recreates the validator container with the new .env. <code>docker compose restart</code> does not read .env again. Confirm with <code>docker inspect splice-validator-validator-1 | grep TARGET</code>.'),
      LL('也可以先手动买一批：<code>TOKEN=$(cat /root/operator.jwt)</code>，用 <code>curl -s -H "Authorization: Bearer $TOKEN" http://wallet.localhost/api/validator/v0/validator-user</code> 查到本验证者的 party，再向 <code>/v0/wallet/buy-traffic-requests</code> POST receiving_validator_party_id、domain_id、traffic_amount（至少 200000）和 tracking_id。domain_id 在 <code>~/NOTES.md</code> 里（工作电脑上）。', 'You can also buy a batch by hand first: <code>TOKEN=$(cat /root/operator.jwt)</code>, look up this validator\'s party with <code>curl -s -H "Authorization: Bearer $TOKEN" http://wallet.localhost/api/validator/v0/validator-user</code>, then POST receiving_validator_party_id, domain_id, traffic_amount (at least 200000) and tracking_id to <code>/v0/wallet/buy-traffic-requests</code>. The domain_id is in <code>~/NOTES.md</code> on the workstation.'),
    ],
    limit: 4 * 3600, holdFor: 60,
    score: w => [
      missedRow(w),
      [LL('期间最低 Traffic Remainder', 'Lowest Traffic Remainder'), `${Math.round(cn(w).minRem).toLocaleString('en-US')} bytes`, cn(w).minRem > 0 ? 'good' : 'bad'],
      [LL('购买 traffic 花费', 'CC spent on traffic'), `${cn(w).spent.toFixed(1)} CC`, cn(w).spent < 400 ? 'good' : 'mid'],
    ],
    debrief: LL(
      '本练习参考了一次真实的看板问题。节点总览里 Traffic Remainder 一栏的颜色设置是反的：0 显示绿色，大于 1 显示黄色，大于 100 显示红色。余额越多越"危险"，快要用完的节点反而显示正常。修正后改为低于 50,000 显示红色、50,000 及以上显示绿色，只在 participant 接近用完 traffic 时变红。两点结论：traffic 由验证者应用按 target-throughput 自动购买，target-throughput 为 0 时没有任何东西会替你补充；监控阈值要用一个"用完了会怎样"的场景实际验证一遍。',
      'This lab draws on a real dashboard fault. The colour scale of the Traffic Remainder column on the fleet overview was inverted: green at 0, yellow from 1, red from 100. More traffic looked worse, and a node about to run out looked fine. The fix made it red below 50,000 and green at 50,000 and above, so the column only turns red when a participant is close to exhausting its traffic. Two conclusions: the validator app buys traffic at its target throughput, and with target-throughput at 0 nothing tops it up for you; and a threshold should be checked against the case it is meant to catch.'),
  });

  S.registerScenario({
    id: 'canton-stall', network: 'canton', module: MOD, lab: 'C2', difficulty: 3, minutes: 18,
    title: LL('全部 healthy，却停在两天前', 'All healthy, two days behind'),
    tagline: LL('新的同步告警一上线就响了，可 docker ps 里每个容器都是 healthy。', 'The new sync alerts fire as soon as they go live, yet every container in docker ps is healthy.'),
    learn: [
      LL('为什么容器健康检查看不出节点落后', 'Why container health checks miss a node that has fallen behind'),
      LL('用 /api/sync 和 /status 判断同步状态', 'Judging sync from /api/sync and /status'),
      LL('安全地释放 docker 主机的磁盘空间，并防止再次写满', 'Freeing disk on a docker host safely, and keeping it from filling again'),
    ],
    brief: LL(
      `<p>今天上午，采集器新增了链上同步指标，告警规则也随之上线。<b>CantonBehindChainTip</b> 和 <b>CantonSyncStalled</b> 立刻对 <b>canton-01</b> 触发。可是看板上这台节点一直是"up · 6 healthy"，已经很多天没有任何告警了。</p><p>落后的每一轮都没有活动记录，那一轮的奖励就没有了。</p><p>请找到原因并修复，让节点追上网络，同时确保同样的问题不会再次发生。</p>`,
      `<p>This morning the collector gained chain-tip sync metrics, and their alert rules went live with it. <b>CantonBehindChainTip</b> and <b>CantonSyncStalled</b> fired for <b>canton-01</b> straight away. Yet the dashboard has shown this node as "up · 6 healthy" for days, with no alerts at all.</p><p>Every round it falls behind has no activity record, and that round's reward is gone.</p><p>Find the cause, fix it, get the node caught up, and make sure the same thing cannot happen again.</p>`),
    startAt: '2026-07-08T09:10:00Z', alertAge: 600,
    config: { tag: '0.8.2', fillDisk: true, daemonJson: '{\n  "log-driver": "json-file"\n}\n', pgGB: 96.4, oldTags: ['0.7.9', '0.8.0', '0.8.1'], released: ['0.7.9', '0.8.0', '0.8.1', '0.8.2'], stalledFor: 216000, lag: 216000, behindRounds: 360, upFor: 86400 * 160, target: 2000, remainder: 268000 },
    objectives: [
      { text: LL('根分区使用率低于 85%', 'The root filesystem is below 85% used'), check: w => H().diskPct(H().node(w)) < 85 },
      { text: LL('/api/sync 报告 synced（落后不超过 5 轮），participant 处理的是实时事件', '/api/sync reports synced (5 rounds behind or less) and the participant is processing live events'), check: w => H().synced(w, H().node(w)) && H().identityOk(w) },
      { text: LL('participant 容器的日志有大小上限（log-opts max-size）', 'The participant container\'s log has a size limit (log-opts max-size)'), check: w => H().logLimited(w) },
    ],
    forbidden: [wipe],
    hints: [
      LL('<code>ssm canton-01</code>、<code>sudo -i</code>、<code>docker ps</code>，然后 <code>curl -s 127.0.0.1:8100/api/sync | jq</code> 和 <code>curl -s 127.0.0.1:8090/status | jq</code>。', '<code>ssm canton-01</code>, <code>sudo -i</code>, <code>docker ps</code>, then <code>curl -s 127.0.0.1:8100/api/sync | jq</code> and <code>curl -s 127.0.0.1:8090/status | jq</code>.'),
      LL('看 participant 自己怎么说：<code>docker logs --tail 20 splice-validator-participant-1</code>，再看 <code>df -h</code>。', 'See what the participant says: <code>docker logs --tail 20 splice-validator-participant-1</code>, then <code>df -h</code>.'),
      LL('找出占用空间的地方：<code>du -sh /var/lib/docker/*</code>，再 <code>du -sh /var/lib/docker/containers/*</code>。<code>docker system df</code> 不统计容器日志。', 'Find what uses the space: <code>du -sh /var/lib/docker/*</code>, then <code>du -sh /var/lib/docker/containers/*</code>. <code>docker system df</code> does not count container logs.'),
      LL('清空正在写入的日志：<code>truncate -s 0 $(docker inspect --format \'{{.LogPath}}\' splice-validator-participant-1)</code>。不要 rm 这个文件，也不要动 postgres 卷。', 'Empty the log that is being written: <code>truncate -s 0 $(docker inspect --format \'{{.LogPath}}\' splice-validator-participant-1)</code>. Do not rm the file, and leave the postgres volume alone.'),
      LL('防止复发：<code>echo \'{"log-driver":"json-file","log-opts":{"max-size":"100m","max-file":"3"}}\' &gt; /etc/docker/daemon.json</code>，<code>systemctl restart docker</code>，再到 compose 目录执行 <code>docker compose up -d --force-recreate</code>。已有的容器要重建才会用上新设置。', 'Prevent a repeat: <code>echo \'{"log-driver":"json-file","log-opts":{"max-size":"100m","max-file":"3"}}\' &gt; /etc/docker/daemon.json</code>, <code>systemctl restart docker</code>, then <code>docker compose up -d --force-recreate</code> in the compose directory. Existing containers only pick up the new setting when recreated.'),
    ],
    limit: 6 * 3600, holdFor: 60,
    score: w => [
      missedRow(w),
      [LL('postgres 数据', 'Postgres data'), H().identityOk(w) ? LL('完好', 'intact') : LL('已损坏', 'destroyed'), H().identityOk(w) ? 'good' : 'bad'],
    ],
    debrief: LL(
      '本练习参考了一次真实的事故：一台 Canton 验证者的 participant 落后于 sequencer，停在原地好几天，监控却一直显示"up · 6 healthy"。当时的采集器只导出容器存活指标，容器全部正常，节点却没有在跟进账本。之后采集器增加了两类同步信号：/api/sync 给出 SV scan 报告的网络轮次和本验证者记录过的最高轮次之差，落后 100 轮告警，1000 轮严重告警；/status 的 cursor_lag_seconds 落后超过 15 分钟就触发 CantonSyncStalled，因为 100 轮要很多个小时才能攒够。中间还有一版拿了"按序号最新的那一轮"做比较，节点同步时也显示落后约 44 轮。另一次，/api/* 前面加了认证，不带凭据的采集请求开始得到 401，CantonChainDataSourceDown 触发，而告警说明把人引向了另一个服务。本练习用"日志写满磁盘"作为停滞的原因，这是 docker 主机上很常见的一种。',
      'This lab draws on a real incident. A Canton validator\'s participant fell behind the sequencers and sat still for days while monitoring showed "up · 6 healthy". The collector at the time exported only container liveness, so every container looked fine while the node was not following the ledger. The collector then gained two sync signals: /api/sync gives the gap between the round the SV scans report and the highest round this validator recorded, with a warning at 100 rounds and a critical alert at 1000; cursor_lag_seconds from /status fires CantonSyncStalled after 15 minutes behind, because 100 rounds take many hours to accumulate. An interim version compared against the newest round by sequence number and showed about 44 rounds behind on a node that was in sync. Another time an auth gate was put in front of /api/*, the credential-free probe started getting 401, CantonChainDataSourceDown fired, and the alert text pointed responders at the wrong service. This lab uses a disk filled by a container log as the cause of the stall, one of the most common on docker hosts.'),
  });

  S.registerScenario({
    id: 'canton-upgrade', network: 'canton', module: MOD, lab: 'C3', difficulty: 2, minutes: 15,
    title: LL('SV 法定多数已经升级', 'The SV quorum has moved'),
    tagline: LL('13 个 SV 中已有 9 个报告 Splice 0.8.3 或更高，canton-01 还停在 0.8.2。', 'Nine of 13 SVs report Splice 0.8.3 or later; canton-01 is still on 0.8.2.'),
    learn: [
      LL('Splice 的"可以上主网"版本如何由 SV 法定多数决定', 'How the SV quorum decides which Splice release is MainNet-ready'),
      LL('用 docker compose 原地升级镜像，保留数据库', 'Upgrading images in place with docker compose while keeping the database'),
      LL('哪些"清理一下再启动"的捷径会毁掉节点身份', 'Which "clean restart" shortcuts destroy the node identity'),
    ],
    brief: LL(
      `<p><b>CantonSpliceVersionDrift</b> 刚刚触发：<code>canton-01 (0.8.2 -&gt; 0.8.3)</code>。版本监视脚本每 15 分钟查询全部 13 个 SV 的 scan，已有 2/3 的 SV 报告 0.8.3 或更高，0.8.3 因此成为可以上主网的版本。</p><p>SV 已经投票，新版 Amulet 包将在 50 分钟后生效。到那时还停在 0.8.2 的验证者读不懂新的规则合约，每一轮都记录不了活动。</p><p>请把 canton-01 升级到 SV 法定多数的版本，并保留它的数据和身份。</p>`,
      `<p><b>CantonSpliceVersionDrift</b> has just fired: <code>canton-01 (0.8.2 -&gt; 0.8.3)</code>. The version watcher polls all 13 SV scans every 15 minutes. Two thirds of them now report 0.8.3 or later, which makes 0.8.3 the MainNet-ready release.</p><p>The SVs have voted, and the new Amulet packages take effect in 50 minutes. A validator still on 0.8.2 at that point cannot read the new rules contracts and records no activity in any round.</p><p>Upgrade canton-01 to the SV quorum version, and keep its data and identity.</p>`),
    startAt: '2026-08-05T13:30:00Z',
    config: {
      tag: '0.8.2', target: 2000, remainder: 268000,
      svs: ['0.8.3', '0.8.3', '0.8.3', '0.8.4', '0.8.3', '0.8.2', '0.8.3', '0.8.3', '0.8.4', '0.8.2', '0.8.3', '0.8.2', '0.8.2'],
      svPlan: [[1200, 5, '0.8.3'], [2400, 9, '0.8.3'], [4200, 11, '0.8.3']],
      switchAt: 3000, required: '0.8.3', released: ['0.8.0', '0.8.1', '0.8.2', '0.8.3', '0.8.4'], latest: '0.8.4',
    },
    objectives: [
      { text: LL('participant 和验证者应用都运行 Splice 0.8.3', 'The participant and the validator app both run Splice 0.8.3'), check: w => H().runs(w, '0.8.3') },
      { text: LL('compose 项目的 6 个容器全部 healthy', 'All six containers of the compose project are healthy'), check: w => H().allHealthy(w) },
      recordedNow,
    ],
    forbidden: [
      wipe,
      { flag: 'ahead_of_quorum', text: LL('运行 SV 法定多数尚未采纳的 Splice 版本', 'Running a Splice release the SV quorum has not adopted') },
    ],
    hints: [
      LL('<code>ssm canton-01</code>、<code>sudo -i</code>，看版本监视的结果：<code>tail -3 /var/log/splice-version-watcher.log</code>。单个 SV 也可以查：<code>curl -s https://scan.sv-1.example/api/scan/version</code>。', '<code>ssm canton-01</code>, <code>sudo -i</code>, and read the watcher\'s result: <code>tail -3 /var/log/splice-version-watcher.log</code>. Single SVs answer too: <code>curl -s https://scan.sv-1.example/api/scan/version</code>.'),
      LL('GitHub 上最新的是 0.8.4，但只有 2 个 SV 在运行它。目标是 0.8.3。', 'The latest release on GitHub is 0.8.4, but only 2 SVs run it. The target is 0.8.3.'),
      LL('<code>cd /opt/splice-node/docker-compose/validator</code>，<code>sed -i \'s/IMAGE_TAG=0.8.2/IMAGE_TAG=0.8.3/\' .env</code>，<code>docker compose pull</code>，<code>docker compose up -d</code>。', '<code>cd /opt/splice-node/docker-compose/validator</code>, <code>sed -i \'s/IMAGE_TAG=0.8.2/IMAGE_TAG=0.8.3/\' .env</code>, <code>docker compose pull</code>, <code>docker compose up -d</code>.'),
      LL('不要用 <code>docker compose down -v</code> 或 <code>./stop.sh -D</code>：它们会删除 postgres 卷，节点身份随之丢失。升级后 participant 要先迁移数据库，等它变成 healthy；<code>systemctl start splice-version-watcher</code> 可以立即重跑一次版本检查。', 'Do not use <code>docker compose down -v</code> or <code>./stop.sh -D</code>: they delete the postgres volume, and the node identity with it. After the upgrade the participant migrates its database first; wait for healthy. <code>systemctl start splice-version-watcher</code> reruns the version check at once.'),
    ],
    limit: 6 * 3600, holdFor: 60,
    score: w => [
      missedRow(w),
      [LL('验证者应用不可用的时间', 'Validator app unavailable'), S.fmtDur(cn(w).vDown), cn(w).vDown < 600 ? 'good' : cn(w).vDown < 1800 ? 'mid' : 'bad'],
    ],
    debrief: LL(
      '本练习参考了真实的版本监视做法。一个 systemd 定时器每 15 分钟在验证者主机上运行一次脚本：先从 scan 列出全部 SV，再逐个查询 /api/scan/version，取至少 2/3 的 SV 报告的最高版本作为法定多数版本，这和网络升级公告使用的标准相同。本机版本取自正在运行的验证者应用容器的镜像标签，而不是某个版本文件，因为文件可能和机器上实际运行的不一致。脚本必须在验证者主机上运行：SV 的 scan 只允许验证者的 IP 访问，其他机器会得到 403。这条告警最初叫"有可用升级"，后来改名为版本漂移，触发后立即通知，直到版本一致才停止。升级本身只需要改 IMAGE_TAG、拉取镜像、执行 up -d；数据库卷要原样保留。',
      'This lab follows a real version-watch setup. A systemd timer runs a script on the validator host every 15 minutes. It lists every SV from a scan, queries /api/scan/version on each, and takes the highest version reported by at least 2/3 of them as the quorum version, the same criterion the network\'s upgrade announcements use. The local version comes from the image tag of the running validator-app container rather than a versions file, because a file can disagree with what the machine actually runs. The script has to run on the validator host: SV scans only accept validator IPs, and other machines get 403. The alert started out as "upgrade available" and was later renamed to version drift; it notifies at once and repeats until the versions match. The upgrade itself is a change of IMAGE_TAG, a pull and up -d, with the database volume left exactly as it is.'),
  });
})(SIM);
