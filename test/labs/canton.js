// Canton lab runs. Each case plays a scenario through the UI hooks; expect() returns failure messages.
// Commands are passed as JSON so shell quoting survives unchanged.
const DIR = '/opt/splice-node/docker-compose/validator';
const play = (scenario, parts, settle) => `(async () => {
  const o = [];
  const run = async c => { o.push('$ ' + c + '\\n' + await T.cmd(c)); };
  const parts = ${JSON.stringify(parts)};
  for (const p of parts) {
    if (p.js) { eval(p.js); continue; }
    if (p.adv) { await T.adv(p.adv); continue; }
    await run(p);
  }
  await T.adv(${settle});
  const n = VSIM.w.nodes['canton-01'], cn = n.cn;
  return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations,
    state: { remainder: Math.round(cn.remainder), ourRound: cn.ourRound, lag: Math.round(cn.lag), missed: cn.missed, disk: n.disk.used, party: cn.party.slice(0, 20),
      ctrs: Object.values(cn.ctrs).map(r => [r.svc, r.image.split(':').pop(), r.state, r.health]) },
    alerts: Object.values(VSIM.w.alerts).map(a => a.name + ':' + a.state),
    events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g, '')).slice(-12) };
})()`;
const solved = r => r.result && r.result.success ? [] : ['lab not completed'];
const flagged = f => r => r.viol && r.viol[f] !== undefined ? [] : [`${f} not flagged`];

const BUY = String.raw`curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"receiving_validator_party_id\":\"$PARTY\",\"domain_id\":\"$DOMAIN\",\"traffic_amount\":400000,\"tracking_id\":\"manual-topup-1\"}" http://wallet.localhost/api/validator/v0/wallet/buy-traffic-requests`;
const BUY_SPONSOR = String.raw`curl -s -X POST -H "Authorization: Bearer $TOKEN" -d "{\"receiving_validator_party_id\":\"$SP\",\"domain_id\":\"$DOMAIN\",\"traffic_amount\":400000,\"tracking_id\":\"oops-1\"}" http://wallet.localhost/api/validator/v0/wallet/buy-traffic-requests`;

module.exports = [
  {
    name: 'traffic', // C1: read the log, buy traffic for the validator's own party, re-enable top-ups with compose up -d
    scenario: 'canton-traffic',
    steps: play('canton-traffic', [
      'cat ~/NOTES.md | head -3',
      'ssm canton-01', 'docker ps', 'sudo -i',
      'docker logs --tail 8 splice-validator-validator-1',
      `cd ${DIR}`, 'grep TRAFFIC .env',
      'TOKEN=$(cat /root/operator.jwt)',
      'curl -s http://wallet.localhost/api/validator/v0/validator-user',
      'PARTY=$(curl -s -H "Authorization: Bearer $TOKEN" http://wallet.localhost/api/validator/v0/validator-user | jq -r .party_id)',
      'DOMAIN=$(curl -s https://scan.sv-1.example/api/scan/v0/dso-sequencers | jq -r .domainSequencers[0].domainId)',
      'echo $PARTY $DOMAIN',
      BUY.replace('400000', '50000'),
      BUY,
      'curl -s -X POST -H "Authorization: Bearer $TOKEN" http://wallet.localhost/api/validator/v0/wallet/buy-traffic-requests/manual-topup-1/status',
      { adv: 90 },
      'curl -s -X POST -H "Authorization: Bearer $TOKEN" http://wallet.localhost/api/validator/v0/wallet/buy-traffic-requests/manual-topup-1/status',
      "sed -i 's/TARGET_TRAFFIC_THROUGHPUT=0/TARGET_TRAFFIC_THROUGHPUT=2000/' .env",
      'docker compose restart validator',
      'docker inspect splice-validator-validator-1 | grep TARGET',
      'docker compose up -d',
      'docker inspect --format \'{{json .Config.Env}}\' splice-validator-validator-1',
      'docker compose ps',
    ], 900),
    expect: solved,
  },
  {
    name: 'trafficWrongParty', // C1 trap: traffic bought for the sponsor SV's party
    scenario: 'canton-traffic',
    steps: play('canton-traffic', [
      'ssm canton-01', 'sudo -i', 'TOKEN=$(cat /root/operator.jwt)',
      'DOMAIN=$(curl -s https://scan.sv-1.example/api/scan/v0/dso-sequencers | jq -r .domainSequencers[0].domainId)',
      { js: 'VSIM.sh.sess.env.SP = VSIM.S.networks.canton.helpers.SPONSOR' },
      BUY_SPONSOR,
    ], 120),
    expect: flagged('wrong_party'),
  },
  {
    name: 'trafficWipe', // C1 trap: "clean restart" with down -v
    scenario: 'canton-traffic',
    steps: play('canton-traffic', ['ssm canton-01', 'sudo -i', `cd ${DIR}`, 'docker compose down -v', 'docker compose up -d'], 600),
    expect: r => flagged('wipe_db')(r).concat(r.state && r.state.party.startsWith('validator-01::1220') ? [] : ['party missing']),
  },
  {
    name: 'stall', // C2: find the full disk, truncate the log, add log rotation and recreate, wait for catch-up
    scenario: 'canton-stall',
    steps: play('canton-stall', [
      'ssm canton-01', 'sudo -i', 'docker ps',
      'curl -s 127.0.0.1:8100/api/sync | jq',
      'curl -s 127.0.0.1:8090/status | jq .cursor_lag_seconds',
      'docker logs --tail 4 splice-validator-participant-1',
      'df -h', 'docker system df',
      'du -sh /var/lib/docker/*',
      'du -sh /var/lib/docker/containers/*',
      'docker image prune -a -f',
      'df -h',
      'rm $(docker inspect --format \'{{.LogPath}}\' splice-validator-participant-1)',
      'df -h',
      'docker volume rm splice-validator_postgres-splice',
      'docker restart splice-validator-participant-1',
      { adv: 120 },
      'df -h',
      'truncate -s 0 $(docker inspect --format \'{{.LogPath}}\' splice-validator-participant-1)',
      `echo '{"log-driver":"json-file","log-opts":{"max-size":"100m","max-file":"3"}}' > /etc/docker/daemon.json`,
      'systemctl restart docker',
      'docker inspect --format \'{{json .HostConfig.LogConfig}}\' splice-validator-participant-1',
      `cd ${DIR}`, 'docker compose up -d --force-recreate',
      'docker inspect --format \'{{json .HostConfig.LogConfig}}\' splice-validator-participant-1',
      { adv: 1500 },
      'curl -s 127.0.0.1:8100/api/sync | jq',
    ], 900),
    expect: solved,
  },
  {
    name: 'stallWipe', // C2 trap: stop the stack, then prune the "unused" volume
    scenario: 'canton-stall',
    steps: play('canton-stall', ['ssm canton-01', 'sudo -i', `cd ${DIR}`, 'docker compose down', 'docker volume prune -a -f'], 60),
    expect: flagged('wipe_db'),
  },
  {
    name: 'upgrade', // C3: confirm the quorum, restart (no effect), then pull + up -d to 0.8.3
    scenario: 'canton-upgrade',
    steps: play('canton-upgrade', [
      'ssm canton-01', 'sudo -i',
      'tail -2 /var/log/splice-version-watcher.log',
      'cat /var/lib/node_exporter/textfile_collector/splice_version.prom',
      'curl -s https://scan.sv-4.example/api/scan/version',
      'curl -s https://api.github.com/repos/canton-network/splice/releases/latest | jq -r .tag_name',
      'docker compose pull',
      `cd ${DIR}`,
      "sed -i 's/IMAGE_TAG=0.8.2/IMAGE_TAG=0.8.3/' .env",
      'docker compose restart',
      'docker compose ps',
      'docker compose pull',
      'docker compose up -d',
      'docker compose ps',
      'systemctl start splice-version-watcher',
      'tail -1 /var/log/splice-version-watcher.log',
      'docker logs --tail 5 splice-validator-validator-1',
    ], 1500),
    expect: r => solved(r).concat(r.alerts && r.alerts.some(a => a.startsWith('CantonSpliceVersionDrift')) ? ['drift alert still firing'] : []),
  },
  {
    name: 'upgradeAhead', // C3 trap: jump to the latest GitHub release instead of the quorum version
    scenario: 'canton-upgrade',
    steps: play('canton-upgrade', ['ssm canton-01', 'sudo -i', `cd ${DIR}`, "sed -i 's/IMAGE_TAG=0.8.2/IMAGE_TAG=0.8.4/' .env", 'docker compose up -d'], 300),
    expect: flagged('ahead_of_quorum'),
  },
  {
    name: 'upgradeWipe', // C3 trap: stop.sh -D before the upgrade
    scenario: 'canton-upgrade',
    steps: play('canton-upgrade', ['ssm canton-01', 'sudo -i', `cd ${DIR}`, './stop.sh -D', "sed -i 's/IMAGE_TAG=0.8.2/IMAGE_TAG=0.8.3/' .env", './start.sh'], 900),
    expect: r => flagged('wipe_db')(r).concat(r.result && r.result.success ? ['lab should not succeed after a wipe'] : []),
  },
];
