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
  const SVC = `/etc/stereum/services/${BEACON_ID}.yaml`;
  const EL_ID = '3f6c2a10-8d4e-4b7a-9c1d-2e5f7a9b0c14';
  const KSF = 'keystore-m_12381_3600_0_0_0-1739518246';
  const BLOCKNUM = `curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' localhost:8545`;
  const KEYS = 'curl -sk https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN"';

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
      {
        text: LL('登录 eth-02，确认告警，让值班电话停下来。先看三个服务是否都在运行，再问 Besu 当前的区块高度。',
          'Log in to eth-02 and acknowledge the page so the phones stop. Check that the three services are running, then ask Besu for its block number.'),
        cmds: ['ssm eth-02', 'sudo -i', 'ack EthExecutionStalled', 'systemctl status besu teku-beacon teku-vc', BLOCKNUM],
        wait: 60,
      },
      {
        text: LL('一分钟后再问一次，高度没有变。Besu 的日志说明了原因：<code>Execution engine not called in 120 seconds</code> 表示 beacon 节点不再通过 Engine API 调用它。',
          'Ask again a minute later: the block number has not moved. Besu\'s log says why: <code>Execution engine not called in 120 seconds</code> means the beacon node has stopped calling it over the Engine API.'),
        cmds: [BLOCKNUM, 'journalctl -u besu -n 20 --no-pager'],
      },
      {
        text: LL('去问 beacon 节点。它不应答，最后一行日志停在 50 分钟前，systemd 却仍然显示 active：进程没有退出，而是挂起了。',
          'Ask the beacon node. It does not answer, and its last log line is 50 minutes old, yet systemd still reports it active: the process has not exited, it is hung.'),
        cmds: ['curl -sS localhost:5051/eth/v1/node/syncing', 'journalctl -u teku-beacon -n 5 --no-pager', 'systemctl status teku-beacon'],
      },
      {
        text: LL('只重启 beacon 节点，这不会导致罚没。不要动 teku-vc：故障不在它那里，而且开启 doppelganger 检测时，每次重启它都会损失两个 epoch 的任务。',
          'Restart the beacon node only; that is slashing-safe. Leave teku-vc alone: the fault is not there, and with doppelganger detection every restart of it costs two epochs of duties.'),
        cmds: ['systemctl restart teku-beacon', 'systemctl status teku-beacon'],
        wait: 60,
      },
      {
        text: LL('重新打开引擎看门狗。它在 10-03 维护时被停掉，之后一直没有运行，所以这次挂起没有被自动恢复。',
          'Turn the engine watchdog back on. It was stopped for the 10-03 maintenance and never restarted, which is why nothing recovered this hang automatically.'),
        cmds: ['systemctl status eth-engine-watchdog.timer', 'systemctl enable --now eth-engine-watchdog.timer', 'systemctl list-timers'],
      },
      {
        text: LL('观察追赶。beacon 节点落后约 250 个 slot，需要几分钟；它一开始把区块交给 Besu，Besu 就重新导入。',
          'Follow the catch-up. The beacon node is about 250 slots behind and needs a few minutes; Besu imports again as soon as the beacon hands it blocks.'),
        cmds: ['curl -s localhost:5051/eth/v1/node/syncing | jq .data', 'journalctl -u besu -n 5 --no-pager'],
        wait: 120,
      },
      {
        text: LL('确认恢复：beacon 节点已同步，Besu 的高度在增长，验证者的证明重新被打包。',
          'Confirm the recovery: the beacon node is in sync, Besu\'s block number advances, and the validator\'s attestations are included again.'),
        cmds: ['curl -s localhost:5051/eth/v1/node/syncing | jq .data', BLOCKNUM, 'journalctl -u teku-vc -n 5 --no-pager', 'curl -s https://beaconcha.in/api/v1/validator/1234567/attestations | jq .data[0]'],
        wait: 300,
      },
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
      {
        text: LL('登录 eth-01，确认正在告警的三个 critical 告警。然后按运维手册看容器：运行时间很短或显示 Restarting，就是在反复重启。',
          'Log in to eth-01 and acknowledge the three critical alerts that are firing. Then follow the runbook and list the containers: a very short uptime or "Restarting" means a restart loop.'),
        cmds: ['ssm eth-01', 'sudo -i', 'ack EthHeadSlotStalled', 'ack EthExecutionStalled', 'ack EthValidatorEfficiencyLow', "docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}'"],
      },
      {
        text: LL('找出 beacon 容器，读它退出前的日志，再看它是什么时候、用哪个镜像创建的，以及午夜的自动更新改了什么。',
          'Find the beacon container and read its log up to the exit. Then see when and from which image it was created, and what the midnight update changed.'),
        cmds: [
          "BEACON=$(docker ps -a --format '{{.Names}} {{.Image}} {{.Command}}' | awk '/teku/ && !/vc/{print $1; exit}'); echo $BEACON",
          'docker logs --tail 20 $BEACON',
          "docker inspect $BEACON --format 'created={{.Created}} restarts={{.RestartCount}} image={{.Config.Image}}'",
          'cat /var/log/stereum-update.log',
        ],
      },
      {
        text: LL('Teku 26.7.0 默认在 UDP 9001 上启用 QUIC，而这台节点用 <code>--p2p-port=9001</code>，discovery 因此绑定失败。在服务定义里给 QUIC 另一个端口，自动更新按这个文件重建容器，修复才能保留下来。command 列表是文件的最后一段。',
          'Teku 26.7.0 enables QUIC on UDP 9001 by default, and this node runs <code>--p2p-port=9001</code>, so discovery fails to bind. Give QUIC another port in the service definition: the updater recreates the container from this file, so the fix survives. The command list is the last block of the file.'),
        cmds: [`grep -n p2p ${SVC}`, `echo '  - --p2p-quic-port=9002' >> ${SVC}`, `tail -5 ${SVC}`],
      },
      {
        text: LL('<code>docker restart</code> 仍然使用旧参数。按服务定义重建 beacon 容器，然后看它的启动日志里 QUIC 用的是哪个端口。',
          '<code>docker restart</code> keeps the old arguments. Recreate the beacon container from its service definition, then check in its startup log which port QUIC uses.'),
        cmds: [`stereum-recreate ${BEACON_ID}`, `docker logs --tail 5 stereum-${BEACON_ID}`],
        wait: 480,
      },
      {
        text: LL('确认 beacon 容器这几分钟一直在运行，没有再重启。它落后约 8 小时，追赶需要 20 分钟左右。这段时间里落后告警会出现，确认它们即可，不要重启任何东西。',
          'Check that the beacon container has stayed up for the last few minutes without restarting. It is about 8 hours behind and needs around 20 minutes to catch up. Lag alerts fire meanwhile; acknowledge them and do not restart anything.'),
        cmds: ["docker ps --format 'table {{.Names}}\\t{{.Status}}'", 'curl -s localhost:5051/eth/v1/node/syncing | jq .data', 'ack EthBeaconSlotsSignificantlyBehind'],
        wait: 900,
      },
      {
        text: LL('确认恢复：beacon 节点已同步，Besu 在导入区块，验证者的证明重新被打包。',
          'Confirm the recovery: the beacon node is in sync, Besu imports blocks, and the validator\'s attestations are included again.'),
        cmds: ['curl -s localhost:5051/eth/v1/node/syncing | jq .data', `docker logs --tail 5 stereum-${EL_ID}`, 'curl -s https://beaconcha.in/api/v1/validator/1234567/attestations | jq .data[0]'],
        wait: 300,
      },
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
      const n = w.nodes['eth-02'], v = H().val(w), f = KSF;
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
      {
        text: LL('先读迁移笔记。然后登录 eth-01，用 Keymanager API 列出它的验证者客户端持有的钥匙。',
          'Read the migration notes first. Then log in to eth-01 and list the keys its validator client holds through the Keymanager API.'),
        cmds: ['cat ~/NOTES.md', 'ssm eth-01', 'sudo -i', `TOKEN=$(cat ${BEARER})`, KEYS],
      },
      {
        text: LL('用 Keymanager API 删除这把钥匙。这一个调用既停止签名、删掉磁盘上的 keystore，又返回 slashing 保护记录。把记录存下来，通过 S3 传给 eth-02。',
          'Delete the key through the Keymanager API. This one call stops signing, removes the keystore from disk, and returns the slashing protection history. Save the history and send it to eth-02 through S3.'),
        cmds: [
          `TOKEN=$(cat ${BEARER})`,
          `curl -sk -X DELETE https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"pubkeys":["${PK}"]}' > /tmp/delete.json`,
          'jq .data /tmp/delete.json',
          'jq -r .slashing_protection /tmp/delete.json > /tmp/slashing-protection.json',
          'aws s3 cp /tmp/slashing-protection.json s3://example-eth-ops/migration/',
        ],
      },
      {
        text: LL('确认 eth-01 不再持有这把钥匙：API 的列表里没有它，磁盘上也没有。只停容器不够，午夜的自动更新会按服务定义重建容器，带着钥匙重新签名。',
          'Confirm that eth-01 no longer holds the key, neither in the API\'s list nor on disk. Stopping the container is not enough: the midnight update recreates it from its service definition, and it signs again with the key.'),
        cmds: [`TOKEN=$(cat ${BEARER})`, KEYS, `ls /mnt/ethereum-data/stereum/teku-${VC_ID}/data/validator/key-manager/local/`, 'exit', 'exit'],
      },
      {
        text: LL('在 eth-02 上，先把 eth-01 的签名记录导入 teku-vc 的 slashing 保护数据库，再碰钥匙。',
          'On eth-02, import eth-01\'s signing history into teku-vc\'s slashing protection database before touching the key.'),
        cmds: ['ssm eth-02', 'sudo -i', 'aws s3 cp s3://example-eth-ops/migration/slashing-protection.json /tmp/', 'teku slashing-protection import --data-path=/var/lib/teku-vc --from=/tmp/slashing-protection.json'],
      },
      {
        text: LL('导入之后才放钥匙：把 keystore 和密码文件复制到钥匙目录，重启 teku-vc。doppelganger 检测会先观察两到三个 epoch，确认网络上没有别人在用这把钥匙签名。',
          'Only after the import, load the key: copy the keystore and its password file into the key directory and restart teku-vc. Doppelganger detection first watches for two to three epochs to make sure nobody else on the network signs with this key.'),
        cmds: ['ls /root/migration', `cp /root/migration/${KSF}.json /root/migration/${KSF}.txt /var/lib/teku-vc/validator-keys/`, 'systemctl restart teku-vc', 'journalctl -u teku-vc -n 10 --no-pager'],
        wait: 1080,
      },
      {
        text: LL('确认验证者从 eth-02 出证明，并且证明被按时打包。',
          'Confirm that the validator attests from eth-02 and that its attestations are included on time.'),
        cmds: ['journalctl -u teku-vc -n 5 --no-pager', 'curl -s localhost:5051/eth/v1/beacon/states/head/validators/1234567 | jq .data.status', 'curl -s https://beaconcha.in/api/v1/validator/1234567/attestations | jq .data[0]'],
        wait: 600,
      },
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
