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
// the guided lab (R1) builds canton-new from scratch
const playNew = (parts, settle) => `(async () => {
  const o = [];
  const run = async c => { o.push('$ ' + c + '\\n' + await T.cmd(c)); };
  const parts = ${JSON.stringify(parts)};
  for (const p of parts) {
    if (p.js) { eval(p.js); continue; }
    if (p.adv) { await T.adv(p.adv); continue; }
    await run(p);
  }
  await T.adv(${settle});
  const n = VSIM.w.nodes['canton-new'], cn = n.cn;
  return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, step: VSIM.w.stepIdx, viol: VSIM.w.violations,
    state: { party: cn.party, onboarded: cn.onboarded, recorded: cn.recorded, missed: cn.missed, base: Math.round(cn.base), wallet: cn.wallet, identityLost: cn.identityLost,
      ctrs: Object.values(cn.ctrs).map(r => [r.svc, r.image.split(':').pop(), r.state, r.health]) },
    events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g, '')).slice(-14) };
})()`;
const solved = r => r.result && r.result.success ? [] : ['lab not completed'];
const flagged = f => r => r.viol && r.viol[f] !== undefined ? [] : [`${f} not flagged`];

const BUY = String.raw`curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"receiving_validator_party_id\":\"$PARTY\",\"domain_id\":\"$DOMAIN\",\"traffic_amount\":400000,\"tracking_id\":\"manual-topup-1\"}" http://wallet.localhost/api/validator/v0/wallet/buy-traffic-requests`;
const BUY_SPONSOR = String.raw`curl -s -X POST -H "Authorization: Bearer $TOKEN" -d "{\"receiving_validator_party_id\":\"$SP\",\"domain_id\":\"$DOMAIN\",\"traffic_amount\":400000,\"tracking_id\":\"oops-1\"}" http://wallet.localhost/api/validator/v0/wallet/buy-traffic-requests`;

const BUNDLE = v => `curl -sSL -o ${v}_splice-node.tar.gz https://github.com/canton-network/splice/releases/download/${v}/${v}_splice-node.tar.gz`;
const SECRET = 'SECRET=$(curl -s -X POST https://sv.sv-3.example/api/sv/v0/onboard/validator/prepare)';
const OLD_SECRET = { js: 'VSIM.sh.sess.env.SECRET = Object.keys(VSIM.w.chain.secrets).find(k => VSIM.w.chain.secrets[k].node === "canton-01")' };
const CONFIGURE = [
  "sed -i 's/MIGRATION_ID=.*/MIGRATION_ID=4/' .env",
  "sed -i 's|SPONSOR_SV_ADDRESS=.*|SPONSOR_SV_ADDRESS=https://sv.sv-3.example|' .env",
  "sed -i 's|SCAN_ADDRESS=.*|SCAN_ADDRESS=https://scan.sv-3.example|' .env",
  'sed -i "s/ONBOARDING_SECRET=.*/ONBOARDING_SECRET=$SECRET/" .env',
  "sed -i 's/PARTY_HINT=.*/PARTY_HINT=acme-validator-1/' .env",
  "sed -i 's/TARGET_TRAFFIC_THROUGHPUT=.*/TARGET_TRAFFIC_THROUGHPUT=2000/' .env",
];

module.exports = [
  {
    name: 'run', // R1: every step of the guided lab, in order, with the commands its how text gives
    scenario: 'canton-run',
    steps: playNew([
      'cat ~/NOTES.md',
      'ssm canton-new', 'sudo -i',
      'docker --version', 'docker compose version', 'df -h', 'docker ps',
      'curl -s https://scan.sv-3.example/api/scan/version',
      'curl -s https://scan.sv-1.example/api/scan/version',
      'curl -s https://scan.sv-2.example/api/scan/version',
      'curl -s https://scan.sv-4.example/api/scan/version',
      "curl -s https://scan.sv-3.example/api/scan/v0/scans | jq -r '.scans[0].scans[].publicUrl'",
      'curl -s https://api.github.com/repos/canton-network/splice/releases/latest | jq -r .tag_name',
      BUNDLE('0.8.3'),
      "curl -s https://api.github.com/repos/canton-network/splice/releases/tags/0.8.3 | jq -r '.assets[0].digest'",
      'sha256sum 0.8.3_splice-node.tar.gz',
      'tar xzf 0.8.3_splice-node.tar.gz -C /opt',
      `cd ${DIR}`, 'ls -a',
      SECRET, 'echo $SECRET',
      "curl -s https://scan.sv-3.example/api/scan/v0/dso-sequencers | jq '.domainSequencers[0].sequencers[0].migrationId'",
      ...CONFIGURE.slice(0, 4), "grep -v '^#' .env",
      ...CONFIGURE.slice(4), "grep -E 'PARTY_HINT|TRAFFIC|TOPUP' .env",
      'docker compose up -d', 'docker compose ps',
      { adv: 180 },
      'docker logs --tail 20 splice-validator-validator-1', 'docker logs --tail 5 splice-validator-participant-1', 'docker compose ps',
      { adv: 30 },
      'PARTY=$(docker logs splice-validator-validator-1 | grep "Allocated validator" | sed \'s/.*party //\')', 'echo $PARTY',
      { adv: 30 },
      'curl -s https://scan.sv-3.example/api/scan/v0/round-of-latest-data',
      'curl -s "https://scan.sv-3.example/api/scan/v0/validators/validator-faucets?validator_ids=$PARTY" | jq',
      { adv: 30 },
      'docker logs splice-validator-validator-1 | grep -i traffic', 'docker inspect splice-validator-validator-1 | grep TARGET',
      { adv: 30 },
      'mkdir -p /root/backups',
      'docker exec splice-validator-postgres-splice-1 pg_dump -U cnadmin validator > /root/backups/validator.sql',
      'docker exec splice-validator-postgres-splice-1 pg_dump -U cnadmin participant-4 > /root/backups/participant-4.sql',
      'ls -l /root/backups', 'grep COPY /root/backups/participant-4.sql', 'docker exec splice-validator-postgres-splice-1 pg_dump -U cnadmin participant-3',
    ], 60),
    expect: r => solved(r).concat(r.viol && Object.keys(r.viol).length ? ['unexpected violation'] : []),
  },
  {
    name: 'runAhead', // R1 trap: start on the newest GitHub release, ahead of the SV quorum
    scenario: 'canton-run',
    steps: playNew([
      'ssm canton-new', 'sudo -i',
      'curl -s https://api.github.com/repos/canton-network/splice/releases/latest | jq -r .tag_name',
      BUNDLE('0.8.4'), 'tar xzf 0.8.4_splice-node.tar.gz -C /opt', `cd ${DIR}`,
      SECRET, ...CONFIGURE, 'docker compose up -d',
    ], 300),
    expect: flagged('ahead_of_quorum'),
  },
  {
    name: 'runWipe', // R1 trap: reuse canton-01's secret, onboarding fails, then down -v to "start clean"
    scenario: 'canton-run',
    steps: playNew([
      'ssm canton-new', 'sudo -i',
      BUNDLE('0.8.3'), 'tar xzf 0.8.3_splice-node.tar.gz -C /opt', `cd ${DIR}`,
      OLD_SECRET, ...CONFIGURE, 'docker compose up -d',
      { adv: 300 },
      'docker logs --tail 6 splice-validator-validator-1', 'docker compose ps',
      'docker compose down -v', 'docker compose up -d',
    ], 300),
    expect: r => flagged('wipe_db')(r).concat(r.result && r.result.success ? ['lab should not succeed after a wipe'] : []),
  },
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
