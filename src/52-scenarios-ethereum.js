/* ============================================================
   Ethereum labs (E1–E3). Data plus small predicates over the world.
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL;
  const MOD = LL('以太坊验证者运维', 'Ethereum validator operations');
  const H = () => S.networks.ethereum.helpers;
  const BEACON_ID = '9b2e7d41-5a3c-4f8e-b6d2-1c0a9e8f7d23';
  const VC_ID = 'c4a81f2e-6b9d-4e3a-8f7c-5d2b1a0e9c36';
  const PK = '0x8a1f3c5e7b9d2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e6b8d0f1a3c5e7b9d2f4a6c8e0b1d';
  const BEARER = `/mnt/ethereum-data/stereum/teku-${VC_ID}/data/validator/key-manager/validator-api-bearer`;

  const elMoving = (w, n) => H().ready(w, n.eth.c.el) && w.t - n.eth.elLastAdv < 60;
  const inSync = (w, n) => { const V = H().view(w, n); return V.clUp && !V.syncing && !V.elOffline; };
  const score = w => {
    const v = H().val(w), d = (v.bal - v.bal0) / 1e9, ch = w.chain;
    return [
      [LL('本次错过的证明', 'Attestations missed during the lab'), String(ch.missLab), ch.missLab <= 3 ? 'good' : ch.missLab <= 8 ? 'mid' : 'bad'],
      [LL('验证者余额变化', 'Validator balance change'), `${d >= 0 ? '+' : ''}${d.toFixed(6)} ETH`, v.slashed != null ? 'bad' : d >= 0 ? 'good' : 'mid'],
      [LL('1 天 attester 效率', '1-day attester efficiency'), H().efficiency(v).toFixed(1) + '%', H().efficiency(v) >= 93 ? 'good' : 'mid'],
    ];
  };

  /* ---------------------------------------------------------- E1 */
  S.registerScenario({
    id: 'eth-hung-beacon', network: 'ethereum', module: MOD, lab: 'E1', difficulty: 2, minutes: 12,
    title: LL('进程都健康，链却停了', 'Healthy processes, frozen chain'),
    tagline: LL('eth-02 上的每个进程都在运行，Besu 却已经 50 分钟没有导入新区块。', 'Every process on eth-02 is running, yet Besu has imported no blocks for 50 minutes.'),
    learn: [
      LL('beacon 节点如何通过 Engine API 驱动执行客户端', 'How the beacon node drives the execution client over the Engine API'),
      LL('区分"挂起"和"存活"：是否应答、是否写日志、是否在前进', 'Telling a hung process from a live one: does it answer, does it log, does it advance'),
      LL('引擎看门狗做什么，以及为什么不碰验证者客户端', 'What the engine watchdog does, and why it leaves the validator client alone'),
    ],
    brief: LL(
      `<p>03:12 UTC，critical 告警 <b>EthExecutionStalled</b> 打来电话。<b>eth-02</b> 用 systemd 运行 Besu、Teku beacon 节点和 Teku 验证者客户端，验证者 1234567 的钥匙在这台机器上。</p><p><code>systemctl</code> 显示三个服务都是 active，Besu 有对等节点、RPC 也能应答。但从 02:20 左右开始，验证者的每一次证明都错过了。另有一个 warning 告警 <b>EthWatchdogStale</b> 已经挂了好几天。</p><p>请让 eth-02 上的链重新前进，让验证者恢复出证明，并把安全网重新打开。</p>`,
      `<p>At 03:12 UTC the critical alert <b>EthExecutionStalled</b> pages you. <b>eth-02</b> runs Besu, a Teku beacon node and a Teku validator client under systemd, and holds the key of validator 1234567.</p><p><code>systemctl</code> shows all three services active. Besu has peers and answers RPC. Yet since about 02:20 the validator has missed every attestation. A warning, <b>EthWatchdogStale</b>, has been open for several days.</p><p>Get the chain moving again on eth-02, get the validator attesting, and turn the safety net back on.</p>`),
    startAt: '2026-10-06T03:12:00Z', alertAge: 2400,
    config: {
      keyOn: 'eth-02', missedEpochs: 8, missReason: 'java.net.SocketTimeoutException: timeout',
      hosts: [{ id: 'eth-02', versions: { besu: '26.9.0', teku: '26.9.0', mev: '1.11.0' }, clBehind: 250, hung: true, watchdog: false }],
    },
    setup(w) {
      const h = H(), n = w.nodes['eth-02'], ns = h.netSlot(w), hung = -3000;
      for (let t = hung - 96; t <= hung; t += 12) {
        const s = ns + Math.round(t / 12), b = h.blockAt(s), r = h.hx('blk' + s), bh = h.hx('b' + b);
        h.preLog(w, n, 'besu', t - 1, 'INFO', h.besuLine(w, t - 1, 'INFO', 'AbstractEngineNewPayload', `Imported #${b.toLocaleString('en-US')} / ${140 + b % 160} tx / 16 ws / base fee 0.${41 + b % 50} gwei / ${(14e6 + (b % 997) * 9001).toLocaleString('en-US')} (${40 + b % 30}.0%) gas / (0x${bh.slice(0, 4)}...${bh.slice(-6)}) in 0.${120 + b % 200}s. Peers: 25`));
        h.preLog(w, n, 'teku-beacon', t, 'INFO', h.tekuLine(w, t, 'INFO', `Slot Event  *** Slot: ${s}, Block: ${r.slice(0, 6)}..${r.slice(-4)}, Justified: ${Math.floor(s / 32) - 1}, Finalized: ${Math.floor(s / 32) - 2}, Peers: 68`));
      }
      for (let t = hung + 120; t < 0; t += 120) h.preLog(w, n, 'besu', t, 'WARN', h.besuLine(w, t, 'WARN', 'EngineQosTimer', 'Execution engine not called in 120 seconds, consensus client may not be connected'));
      const off = -86400 * 3 + 7331;
      [off - 360, off - 240, off - 120].forEach(t => h.preLog(w, n, 'eth-engine-watchdog', t, 'SYS', `eth-engine-watchdog: ok: el_block=${h.blockAt(ns + Math.round(t / 12))} advancing, peers=24`));
      h.preLog(w, n, 'eth-engine-watchdog', off, 'SYS', 'Stopped eth-engine-watchdog.timer - Run eth-engine-watchdog every 2 minutes.');
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(
        '# eth-02\n- systemd 管理：besu、teku-beacon、teku-vc、mev-boost\n- 本地接口：Besu RPC 127.0.0.1:8545，beacon REST 127.0.0.1:5051，keymanager 127.0.0.1:5052\n- eth-engine-watchdog.timer：每 2 分钟检查一次执行层是否在前进\n- 10-03 维护时停过 watchdog\n',
        '# eth-02\n- systemd units: besu, teku-beacon, teku-vc, mev-boost\n- local APIs: Besu RPC 127.0.0.1:8545, beacon REST 127.0.0.1:5051, keymanager 127.0.0.1:5052\n- eth-engine-watchdog.timer: checks every 2 minutes that the execution layer advances\n- watchdog was stopped for the 10-03 maintenance\n'));
    },
    objectives: [
      { text: LL('teku-beacon 能应答，并且与网络同步', 'teku-beacon answers and is in sync with the network'), check: w => inSync(w, w.nodes['eth-02']) },
      { text: LL('Besu 重新开始导入区块', 'Besu imports blocks again'), check: w => elMoving(w, w.nodes['eth-02']) },
      { text: LL('验证者 1234567 在 eth-02 上恢复出证明（最近一次任务被打包）', 'Validator 1234567 attests from eth-02 again (its latest duty was included)'), check: w => H().attestingFrom(w, H().val(w), 'eth-02') },
      { text: LL('eth-engine-watchdog.timer 处于运行状态', 'eth-engine-watchdog.timer is active'), check: w => w.nodes['eth-02'].eth.timer.active },
    ],
    forbidden: [
      { flag: 'vc_restart', text: LL('重启或停止 teku-vc（故障在 beacon 节点；开启 doppelganger 检测后，重启会损失两个 epoch 的任务）', 'Restarting or stopping teku-vc (the fault is in the beacon node, and with doppelganger detection a restart costs two epochs of duties)') },
      { flag: 'wipe_db', text: LL('删除客户端数据库', 'Deleting a client database') },
    ],
    hints: [
      LL('<code>ssm eth-02</code>、<code>sudo -i</code>、<code>systemctl status besu teku-beacon teku-vc</code>。三个服务都是 active。再问 Besu 当前高度：<code>curl -s -X POST -H \'Content-Type: application/json\' -d \'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}\' localhost:8545</code>，隔一分钟再问一次。', '<code>ssm eth-02</code>, <code>sudo -i</code>, <code>systemctl status besu teku-beacon teku-vc</code>. All three are active. Ask Besu for its height: <code>curl -s -X POST -H \'Content-Type: application/json\' -d \'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}\' localhost:8545</code>, and again a minute later.'),
      LL('<code>journalctl -u besu -n 20 --no-pager</code> 里的 <code>Execution engine not called in 120 seconds</code> 表示 beacon 节点不再调用 Besu。去问 beacon：<code>curl -sS localhost:5051/eth/v1/node/syncing</code>，再看 <code>journalctl -u teku-beacon -n 5 --no-pager</code> 最后一行的时间。', '<code>Execution engine not called in 120 seconds</code> in <code>journalctl -u besu -n 20 --no-pager</code> means the beacon node has stopped calling Besu. Ask the beacon: <code>curl -sS localhost:5051/eth/v1/node/syncing</code>, and check the time of the last line in <code>journalctl -u teku-beacon -n 5 --no-pager</code>.'),
      LL('beacon 进程还在，却不应答，50 分钟没写一行日志：它挂起了。<code>systemctl restart teku-beacon</code>。重启 beacon 不会导致罚没。不要动 teku-vc。', 'The beacon process is alive, does not answer, and has not logged a line in 50 minutes: it is hung. <code>systemctl restart teku-beacon</code>. Restarting the beacon is slashing-safe. Leave teku-vc alone.'),
      LL('重新打开看门狗：<code>systemctl enable --now eth-engine-watchdog.timer</code>，用 <code>systemctl list-timers</code> 确认。追赶进度：<code>curl -s localhost:5051/eth/v1/node/syncing | jq .data</code>。', 'Turn the watchdog back on: <code>systemctl enable --now eth-engine-watchdog.timer</code>, and confirm with <code>systemctl list-timers</code>. Follow the catch-up with <code>curl -s localhost:5051/eth/v1/node/syncing | jq .data</code>.'),
    ],
    limit: 3 * 3600, holdFor: 60,
    score,
    debrief: LL(
      'beacon 节点可能挂起而不退出。进程级的检查，例如 systemd 状态、端口是否监听、执行客户端是否存活，都会一直显示正常，而验证者的每一次任务都在错过。执行客户端只在 beacon 通过 Engine API 交给它区块时才会导入，所以最可靠的信号是执行层的区块高度是否在前进：<code>EthExecutionStalled</code> 在 10 分钟没有导入区块时报警，<code>EthExecutionDown</code> 这类存活告警则看不到这种故障。自动恢复可以交给看门狗：Besu 健康且有对等节点时重启 teku-beacon，重启无济于事时升级给值班人员。看门狗不应重启验证者客户端，因为开启 doppelganger 检测时每次重启都要损失两个 epoch 的任务。停掉的看门狗什么也保护不了，这就是 <code>EthWatchdogStale</code> 存在的原因。',
      'A beacon node can hang without exiting. Process-level checks such as the systemd state, an open port or a live execution client all stay green while the validator misses every duty. The execution client only imports blocks that the beacon hands it over the Engine API, so the reliable signal is whether the execution layer\'s block number advances: <code>EthExecutionStalled</code> pages when no block is imported for 10 minutes, while a liveness alert such as <code>EthExecutionDown</code> cannot see this failure. Automatic recovery belongs to a watchdog that restarts teku-beacon when Besu is healthy and peered, and escalates to a human when a restart cannot help. The watchdog should never restart the validator client, because with doppelganger detection every restart costs two epochs of duties. A watchdog that is not running protects nothing, which is why <code>EthWatchdogStale</code> exists.'),
  });

  /* ---------------------------------------------------------- E2 */
  const E2_CRASH = -(8 * 3600 + 40 * 60 - 41);
  S.registerScenario({
    id: 'eth-quic', network: 'ethereum', module: MOD, lab: 'E2', difficulty: 3, minutes: 18,
    title: LL('午夜自动更新之后', 'After the midnight update'),
    tagline: LL('从 00:00 UTC 起，eth-01 的 beacon 节点每 45 秒重启一次。', 'Since 00:00 UTC the beacon node on eth-01 has restarted every 45 seconds.'),
    learn: [
      LL('用 docker ps、docker logs 和 docker inspect 读懂一个崩溃循环', 'Reading a crash loop with docker ps, docker logs and docker inspect'),
      LL('崩溃循环为什么能躲过存活告警，哪条规则能抓住它', 'Why a crash loop slips past liveness alerts, and which rule catches it'),
      LL('在 Stereum 服务定义里修正客户端参数，让修复经得住下一次更新', 'Fixing a client flag in the Stereum service definition so the fix survives the next update'),
    ],
    brief: LL(
      `<p><b>eth-01</b> 运行一套由 Stereum 管理的 docker：Besu、Teku beacon 节点、Teku 验证者客户端和 mev-boost，容器名为 <code>stereum-&lt;id&gt;</code>，配置在 <code>/etc/stereum/services/&lt;id&gt;.yaml</code>。root 的 cron 每天 00:00 UTC 运行 Stereum 的自动更新。</p><p>现在是 08:40 UTC。<b>EthHeadSlotStalled</b> 和 <b>EthExecutionStalled</b> 正在告警，验证者 1234567 从午夜后不久开始错过了所有任务。</p><p>请找到原因并修复，并且确保下一次自动更新不会把问题带回来。</p>`,
      `<p><b>eth-01</b> runs a Stereum-managed docker stack: Besu, a Teku beacon node, a Teku validator client and mev-boost, in containers named <code>stereum-&lt;id&gt;</code> and configured by <code>/etc/stereum/services/&lt;id&gt;.yaml</code>. A root cron job runs Stereum's unattended update every day at 00:00 UTC.</p><p>It is 08:40 UTC. <b>EthHeadSlotStalled</b> and <b>EthExecutionStalled</b> are firing, and validator 1234567 has missed every duty since shortly after midnight.</p><p>Find the cause and fix it, in a way that the next unattended update does not bring it back.</p>`),
    startAt: '2026-06-17T08:40:00Z', alertAge: 7 * 3600,
    config: {
      keyOn: 'eth-01', missedEpochs: 81, missReason: 'java.net.ConnectException: Connection refused',
      hosts: [{ id: 'eth-01', versions: { besu: '26.6.0', teku: '26.7.0', mev: '1.10.1' }, clBehind: Math.round(-E2_CRASH / 12), crashLoop: { restarts: 708, createdAt: E2_CRASH }, created: { cl: E2_CRASH, vc: E2_CRASH } }],
    },
    setup(w) {
      const h = H(), n = w.nodes['eth-01'], c = n.eth.c.cl, ns = h.netSlot(w);
      [-136, -92, -48].forEach(t0 => {
        const L = (t, lvl, msg) => h.preLog(w, n, c.name, t0 + t, lvl, lvl === 'RAW' ? msg : h.tekuLine(w, t0 + t, lvl, msg));
        L(0, 'INFO', 'Teku version: teku/v26.7.0/linux-x86_64/-eclipseadoptium-openjdk64bit-java-21');
        L(0, 'INFO', 'Configuration | Network: mainnet, Storage Mode: PRUNE, P2P port: 9001, QUIC port: 9001');
        L(9, 'INFO', `Loaded latest finalized state from database at epoch ${Math.floor((ns + E2_CRASH / 12) / 32) - 2}`);
        L(38, 'INFO', 'Starting libp2p network on tcp/9001, quic/udp/9001');
        L(38, 'ERROR', 'Failed to start discovery service on udp/9001');
        h.preLog(w, n, c.name, t0 + 38, 'ERROR', 'java.net.BindException: Address already in use\n\tat java.base/sun.nio.ch.Net.bind0(Native Method)\n\tat io.netty.channel.socket.nio.NioDatagramChannel.doBind(NioDatagramChannel.java:201)\n\tat org.ethereum.beacon.discovery.network.NettyDiscoveryServerImpl.start(NettyDiscoveryServerImpl.java:72)');
        L(38, 'FATAL', 'Exiting due to fatal error in discovery service');
      });
      const el = n.eth.c.el;
      for (let t = -1800; t < 0; t += 120) h.preLog(w, n, el.name, t, 'WARN', h.besuLine(w, t, 'WARN', 'EngineQosTimer', 'Execution engine not called in 120 seconds, consensus client may not be connected'));
      const day = '2026-06-17';
      S.fsWrite(n, '/var/log/stereum-update.log', [
        `2026-06-16 00:00:01 UTC unattended-update: checking images (lane: stable)`,
        `2026-06-16 00:00:07 UTC unattended-update: all images up to date`,
        `${day} 00:00:01 UTC unattended-update: checking images (lane: stable)`,
        `${day} 00:00:09 UTC unattended-update: hyperledger/besu 26.6.0 up to date`,
        `${day} 00:00:12 UTC unattended-update: consensys/teku 26.6.1 -> 26.7.0 (TekuBeaconService ${BEACON_ID}, TekuValidatorService ${VC_ID})`,
        `${day} 00:00:12 UTC unattended-update: updated image: in /etc/stereum/services/${BEACON_ID}.yaml, command: preserved`,
        `${day} 00:00:12 UTC unattended-update: updated image: in /etc/stereum/services/${VC_ID}.yaml, command: preserved`,
        `${day} 00:00:38 UTC unattended-update: recreated stereum-${BEACON_ID} (consensys/teku:26.7.0)`,
        `${day} 00:00:41 UTC unattended-update: recreated stereum-${VC_ID} (consensys/teku:26.7.0)`,
        `${day} 00:00:41 UTC unattended-update: done`,
      ].join('\n') + '\n');
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(
        `# eth-01（Stereum）\n- 容器：stereum-<id>，服务定义：/etc/stereum/services/<id>.yaml\n- beacon 服务 id：${BEACON_ID}\n- 修改服务定义后要重建容器：stereum-recreate <id>（docker restart 不会重读 yaml）\n- 自动更新：root cron，每天 00:00 UTC\n`,
        `# eth-01 (Stereum)\n- containers: stereum-<id>, service definitions: /etc/stereum/services/<id>.yaml\n- beacon service id: ${BEACON_ID}\n- after editing a service definition, recreate the container: stereum-recreate <id> (docker restart does not re-read the yaml)\n- unattended update: root cron, daily at 00:00 UTC\n`));
    },
    objectives: [
      { text: LL('beacon 容器连续运行至少 2 分钟，不再崩溃', 'The beacon container has stayed up for at least 2 minutes without crashing'), check: w => { const c = w.nodes['eth-01'].eth.c.cl; return H().running(c) && c.crashAt == null && w.t - c.startedAt >= 120; } },
      { text: LL('beacon 节点与网络同步，Besu 正在导入区块', 'The beacon node is in sync and Besu is importing blocks'), check: w => inSync(w, w.nodes['eth-01']) && elMoving(w, w.nodes['eth-01']) },
      { text: LL('验证者 1234567 恢复出证明（最近一次任务被打包）', 'Validator 1234567 attests again (its latest duty was included)'), check: w => H().attestingFrom(w, H().val(w), 'eth-01') },
      { text: LL('beacon 的服务定义中 P2P 端口与 QUIC 端口不冲突，下一次自动更新不会复发', 'The beacon\'s service definition sets P2P and QUIC ports that do not collide, so the next unattended update stays clean'), check: w => { const n = w.nodes['eth-01'], y = H().parseSvcYaml(S.fsRead(w, n, H().svcYamlPath(n.eth.c.cl))); return y.args.length > 5 && !H().portsOf(y.args, '26.7.0').collide; } },
    ],
    forbidden: [
      { flag: 'wipe_db', text: LL('删除 beacon 或执行客户端的数据库', 'Deleting the beacon or execution database') },
      { flag: 'vc_restart', text: LL('重启、停止或重建验证者客户端容器（钥匙在它那里，故障在 beacon 节点）', 'Restarting, stopping or recreating the validator client container (it holds the key, and the fault is in the beacon node)') },
    ],
    hints: [
      LL('<code>ssm eth-01</code>、<code>sudo -i</code>，然后按运维手册排查：<code>docker ps -a --format \'table {{.Names}}\\t{{.Status}}\\t{{.Image}}\'</code>。运行时间很短或显示 Restarting，就是在反复重启。找出 beacon 容器：<code>BEACON=$(docker ps -a --format \'{{.Names}} {{.Image}} {{.Command}}\' | awk \'/teku/ &amp;&amp; !/vc/{print $1; exit}\')</code>。', '<code>ssm eth-01</code>, <code>sudo -i</code>, then the runbook triage: <code>docker ps -a --format \'table {{.Names}}\\t{{.Status}}\\t{{.Image}}\'</code>. A very short uptime or "Restarting" means restarts. Find the beacon container: <code>BEACON=$(docker ps -a --format \'{{.Names}} {{.Image}} {{.Command}}\' | awk \'/teku/ &amp;&amp; !/vc/{print $1; exit}\')</code>.'),
      LL('<code>docker logs --tail 20 $BEACON</code> 说明了它为什么退出。<code>docker inspect $BEACON --format \'created={{.Created}} restarts={{.RestartCount}} image={{.Config.Image}}\'</code> 和 <code>cat /var/log/stereum-update.log</code> 说明了午夜改了什么。', '<code>docker logs --tail 20 $BEACON</code> shows why it exits. <code>docker inspect $BEACON --format \'created={{.Created}} restarts={{.RestartCount}} image={{.Config.Image}}\'</code> and <code>cat /var/log/stereum-update.log</code> show what changed at midnight.'),
      LL(`Teku 26.7.0 默认在 UDP 9001 上启用 QUIC，而这台节点用的是 <code>--p2p-port=9001</code>。在服务定义里给 QUIC 指定另一个端口：<code>echo '  - --p2p-quic-port=9002' &gt;&gt; /etc/stereum/services/${BEACON_ID}.yaml</code>（command 列表是文件的最后一段），再用 <code>tail -5</code> 检查。`, `Teku 26.7.0 enables QUIC on UDP 9001 by default, and this node runs <code>--p2p-port=9001</code>. Give QUIC another port in the service definition: <code>echo '  - --p2p-quic-port=9002' &gt;&gt; /etc/stereum/services/${BEACON_ID}.yaml</code> (the command list is the last block of the file), then check it with <code>tail -5</code>.`),
      LL(`<code>docker restart</code> 仍然使用旧参数。按服务定义重建容器：<code>stereum-recreate ${BEACON_ID}</code>。之后观察追赶：<code>curl -s localhost:5051/eth/v1/node/syncing | jq .data</code>。大约需要 20 分钟，期间各种落后告警会一起出现，确认（Ack）它们即可，不要重启任何东西。`, `<code>docker restart</code> keeps the old arguments. Recreate the container from the service definition: <code>stereum-recreate ${BEACON_ID}</code>. Then follow the catch-up: <code>curl -s localhost:5051/eth/v1/node/syncing | jq .data</code>. It takes about 20 minutes. The lag alerts fire together meanwhile; acknowledge them and do not restart anything.`),
    ],
    limit: 5 * 3600, holdFor: 60,
    score,
    debrief: LL(
      '无人值守的客户端更新可能改变默认值，例如在一个已经被占用的端口上启用 QUIC。这里的新版本默认在 UDP 9001 上启用 QUIC，而节点早先用 <code>--p2p-port</code> 把 P2P 端口设成了 9001。discovery 绑定失败，beacon 节点每隔几十秒退出一次。这样的崩溃循环可以长时间不触发任何告警：存活告警要求目标连续 2 分钟不可达，而反复重启会让所有"瞬时值加 for 窗口"的规则一次次清零。能抓住它的是 <code>EthHeadSlotStalled</code> 这类规则，它只问一件事：head slot 在 15 分钟内有没有前进。修复方法是在服务定义中固定 <code>--p2p-quic-port</code> 并重建容器，这样下一次自动更新也会保留它。如果故障恰好发生在 UTC 午夜，先查自动更新的日志。',
      'An unattended client update can change defaults, such as enabling QUIC on a port that is already in use. Here the new release enables QUIC by default on UDP 9001, the port the node had already been given with <code>--p2p-port</code>. Discovery fails to bind and the beacon node exits every few tens of seconds. A crash loop like this can run for a long time without any alert: a liveness rule needs the target down for two straight minutes, and the restarts keep resetting every rule built on an instant value with a for: window. What catches it is a rule like <code>EthHeadSlotStalled</code>, which asks one thing: did the head slot advance in 15 minutes. The fix is to pin <code>--p2p-quic-port</code> in the service definition and recreate the container, so the next unattended update keeps it. If something broke at exactly midnight UTC, check the updater\'s log first.'),
  });

  /* ---------------------------------------------------------- E3 */
  S.registerScenario({
    id: 'eth-migrate', network: 'ethereum', module: MOD, lab: 'E3', difficulty: 3, minutes: 20,
    title: LL('迁移验证者钥匙', 'Moving a validator key'),
    tagline: LL('把验证者 1234567 从旧的 Stereum 主机迁到新主机，全程不能有两处同时签名。', 'Move validator 1234567 from the old Stereum host to the new one, without the key ever signing in two places.'),
    learn: [
      LL('一把钥匙只能有一个签名方：迁移的顺序', 'One key, one signer: the order of a migration'),
      LL('用 Keymanager API 和 Teku CLI 导出、导入 slashing 保护记录（EIP-3076）', 'Exporting and importing slashing protection (EIP-3076) with the Keymanager API and the Teku CLI'),
      LL('在有夜间自动更新的主机上，为什么只停容器不够', 'Why stopping the old container is not enough on a host with nightly updates'),
    ],
    brief: LL(
      `<p>验证者 1234567 运行在 <b>eth-01</b> 上。这是一台即将退役的 Stereum docker 主机，每天 00:00 UTC 自动更新。接替它的 <b>eth-02</b> 用 systemd 运行 Besu 和 Teku，两边的客户端都已同步，eth-02 的 teku-vc 正在运行但没有任何钥匙。同事已经把 keystore 和密码文件放在 eth-02 的 <code>/root/migration</code>。迁移笔记在 <code>~/NOTES.md</code>。</p><p>现在是 22:35 UTC。请完成迁移：钥匙在 eth-02 上签名，eth-01 再也无法用它签名，eth-02 的 slashing 保护数据库掌握 eth-01 签过的全部记录。</p>`,
      `<p>Validator 1234567 runs on <b>eth-01</b>, a Stereum docker host that is being retired and updates itself every day at 00:00 UTC. Its replacement <b>eth-02</b> runs Besu and Teku under systemd. The clients on both hosts are in sync, and teku-vc on eth-02 is running with no keys. A colleague has staged the keystore and its password file in <code>/root/migration</code> on eth-02. The migration notes are in <code>~/NOTES.md</code>.</p><p>It is 22:35 UTC. Move the key so that it signs on eth-02, eth-01 can never sign with it again, and the slashing protection database on eth-02 knows everything eth-01 signed.</p>`),
    startAt: '2026-09-02T22:35:00Z',
    config: {
      keyOn: 'eth-01', missedEpochs: 0, scatter: true,
      hosts: [
        { id: 'eth-01', versions: { besu: '26.7.2', teku: '26.7.1', mev: '1.10.1' }, quicPinned: true },
        { id: 'eth-02', versions: { besu: '26.7.2', teku: '26.8.0', mev: '1.11.0' }, watchdog: true },
      ],
    },
    setup(w) {
      const n = w.nodes['eth-02'], v = H().val(w), f = 'keystore-m_12381_3600_0_0_0-1739518246';
      const ks = S.fsRead(w, w.nodes['eth-01'], `/mnt/ethereum-data/stereum/teku-${VC_ID}/data/validator/key-manager/local/${PK}.json`);
      S.fsWrite(n, `/root/migration/${f}.json`, ks, { mode: '600', owner: 'root' });
      S.fsWrite(n, `/root/migration/${f}.txt`, H().hx('pw' + v.pubkey, 40) + '\n', { mode: '600', owner: 'root' });
      S.fsWrite(w.laptop, '/home/ops/NOTES.md', S.L(
        `# 验证者 1234567 迁移：eth-01（Stereum）→ eth-02（systemd）\n- pubkey: ${PK}\n- eth-01 keymanager API: https://127.0.0.1:5052（自签名 TLS，curl 加 -k）\n  bearer token: ${BEARER}\n- eth-02 teku-vc: --data-path=/var/lib/teku-vc，钥匙目录 /var/lib/teku-vc/validator-keys，已开启 doppelganger 检测\n- keystore 和密码：eth-02:/root/migration/\n- 两台主机之间传文件用 S3：s3://example-eth-ops/migration/\n- 迁移完成后，eth-01 将于明天关机\n`,
        `# Validator 1234567 migration: eth-01 (Stereum) -> eth-02 (systemd)\n- pubkey: ${PK}\n- eth-01 keymanager API: https://127.0.0.1:5052 (self-signed TLS, use curl -k)\n  bearer token: ${BEARER}\n- eth-02 teku-vc: --data-path=/var/lib/teku-vc, keys in /var/lib/teku-vc/validator-keys, doppelganger detection on\n- keystore and password: eth-02:/root/migration/\n- move files between hosts through S3: s3://example-eth-ops/migration/\n- eth-01 is shut down tomorrow, after the migration\n`));
    },
    objectives: [
      { text: LL('eth-01 不再持有这把钥匙（已从它的验证者客户端中删除）', 'eth-01 no longer holds the key (it was deleted from its validator client)'), check: w => { const n = w.nodes['eth-01'], vc = n.eth.c.vc; return !H().keysOnDisk(w, n).keys.includes(PK) && !(H().running(vc) && (vc.keys || []).includes(PK)); } },
      { text: LL('eth-02 的 slashing 保护数据库包含 eth-01 的签名记录', 'eth-02\'s slashing protection database holds eth-01\'s signing history'), check: w => { const v = H().val(w), imp = (w.nodes['eth-02'].eth.imported || {})[PK]; return imp != null && imp >= ((v.lastBy || {})['eth-01'] ?? 0); } },
      { text: LL('验证者 1234567 从 eth-02 出证明（最近一次任务被打包）', 'Validator 1234567 attests from eth-02 (its latest duty was included)'), check: w => H().attestingFrom(w, H().val(w), 'eth-02') },
    ],
    forbidden: [
      { flag: 'two_signers', text: LL('让两台机器的验证者客户端同时载入这把钥匙', 'Having the key loaded in validator clients on both machines at the same time') },
      { flag: 'no_interchange', text: LL('在导入 eth-01 的 slashing 保护记录之前，就在 eth-02 上启用这把钥匙', 'Starting the key on eth-02 before importing eth-01\'s slashing protection history') },
    ],
    hints: [
      LL(`先读 <code>cat ~/NOTES.md</code>。在 eth-01 上（<code>ssm eth-01</code>、<code>sudo -i</code>）查看验证者客户端持有的钥匙：<code>TOKEN=$(cat ${BEARER})</code>，然后 <code>curl -sk https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN"</code>。`, `Read <code>cat ~/NOTES.md</code> first. On eth-01 (<code>ssm eth-01</code>, <code>sudo -i</code>) list the keys its validator client holds: <code>TOKEN=$(cat ${BEARER})</code>, then <code>curl -sk https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN"</code>.`),
      LL(`一步完成"停止签名"和"导出记录"：<code>curl -sk -X DELETE https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"pubkeys":["${PK}"]}' &gt; /tmp/delete.json</code>，然后 <code>jq -r .slashing_protection /tmp/delete.json &gt; /tmp/slashing-protection.json</code>，再 <code>aws s3 cp /tmp/slashing-protection.json s3://example-eth-ops/migration/</code>。`, `Stop signing and export the history in one step: <code>curl -sk -X DELETE https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"pubkeys":["${PK}"]}' &gt; /tmp/delete.json</code>, then <code>jq -r .slashing_protection /tmp/delete.json &gt; /tmp/slashing-protection.json</code>, then <code>aws s3 cp /tmp/slashing-protection.json s3://example-eth-ops/migration/</code>.`),
      LL('在 eth-02 上：<code>aws s3 cp s3://example-eth-ops/migration/slashing-protection.json /tmp/</code>，然后 <code>teku slashing-protection import --data-path=/var/lib/teku-vc --from=/tmp/slashing-protection.json</code>。', 'On eth-02: <code>aws s3 cp s3://example-eth-ops/migration/slashing-protection.json /tmp/</code>, then <code>teku slashing-protection import --data-path=/var/lib/teku-vc --from=/tmp/slashing-protection.json</code>.'),
      LL('导入之后才放钥匙：把 <code>ls /root/migration</code> 里的两个文件复制到 <code>/var/lib/teku-vc/validator-keys/</code>，然后 <code>systemctl restart teku-vc</code>。doppelganger 检测会先等两到三个 epoch，可以用 <code>journalctl -u teku-vc -f</code> 观察。', 'Only after the import, load the key: copy both files from <code>ls /root/migration</code> into <code>/var/lib/teku-vc/validator-keys/</code>, then <code>systemctl restart teku-vc</code>. Doppelganger detection waits two to three epochs first; watch it with <code>journalctl -u teku-vc -f</code>.'),
    ],
    limit: 4 * 3600, holdFor: 60,
    score: w => {
      const base = score(w), v = H().val(w);
      return [[LL('验证者状态', 'Validator status'), v.slashed != null ? 'slashed' : 'active_ongoing', v.slashed != null ? 'bad' : 'good'], ...base.slice(0, 2)];
    },
    debrief: LL(
      '当钥匙在机器之间迁移时，罚没的风险最高。以太坊主网上的罚没大多发生在这类变更中：钥匙被复制到新机器，或者搭了主备切换，而旧客户端仍然可能签名。安全的顺序是：先在源头停止签名，并确保它不能带着钥匙重新启动；导出 slashing 保护记录；在目标机器上导入；最后载入钥匙并启动，最好开启 doppelganger 检测。Keymanager API 的删除调用把前两步合成一步。在有夜间自动更新的 docker 主机上，只执行 <code>docker stop</code> 不够，因为更新会按服务定义重建每一个容器，旧的签名方会在午夜重新出现。',
      'When a key moves between machines, the risk of slashing is at its highest. Most slashings on Ethereum mainnet happen during exactly this kind of change: a key copied to a new machine, or a failover setup, while the old client could still sign. The safe order is: stop signing at the source and make sure it cannot start again with the key; export the slashing protection history; import it on the destination; only then load the key and start, preferably with doppelganger detection. The Keymanager API delete call does the first two steps in one. On a docker host with nightly unattended updates, <code>docker stop</code> alone is not enough, because the update recreates every container from its service definition and the old signer comes back at midnight.'),
  });
})(SIM);
