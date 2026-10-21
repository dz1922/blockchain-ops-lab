// Ethereum lab runs. Each case plays a scenario through the UI hooks; expect() returns failure messages.
const PK = '0x8a1f3c5e7b9d2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e6b8d0f1a3c5e7b9d2f4a6c8e0b1d';
const BEACON = '9b2e7d41-5a3c-4f8e-b6d2-1c0a9e8f7d23';
const VC = 'c4a81f2e-6b9d-4e3a-8f7c-5d2b1a0e9c36';
const BEARER = `/mnt/ethereum-data/stereum/teku-${VC}/data/validator/key-manager/validator-api-bearer`;
const KS = 'keystore-m_12381_3600_0_0_0-1739518246';
const tail = `return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations, flags: VSIM.w.flags,
      alerts: Object.values(VSIM.w.alerts).map(a => [a.name, a.state, a.instance]), events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g, '')).slice(-12) };`;
const ok = r => r.result && r.result.success ? [] : ['lab not completed'];
const flagged = f => r => r.viol && r.viol[f] !== undefined ? [] : [`${f} not flagged`];

module.exports = [
  {
    name: 'hung', // E1: hung beacon; find it, restart the beacon, start the watchdog
    scenario: 'eth-hung-beacon',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-02')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl status besu teku-beacon teku-vc | grep Active'));
    o.push(await T.cmd('curl -s -X POST -H "Content-Type: application/json" -d \\'{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}\\' localhost:8545'));
    o.push(await T.cmd('curl -s -X POST -d \\'{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}\\' localhost:8545 | jq .result'));
    o.push(await T.cmd('journalctl -u besu -n 3 --no-pager'));
    o.push(await T.cmd('journalctl -u teku-beacon -n 2 --no-pager'));
    o.push(await T.cmd('curl -sS localhost:5051/eth/v1/node/syncing'));
    o.push(await T.cmd('systemctl status eth-engine-watchdog.timer'));
    o.push(await T.cmd('systemctl restart teku-beacon'));
    o.push(await T.cmd('systemctl enable --now eth-engine-watchdog.timer'));
    o.push(await T.cmd('systemctl list-timers'));
    await T.adv(90);
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/node/syncing | jq .data'));
    await T.adv(2400);
    o.push(await T.cmd('journalctl -u teku-vc -n 3 --no-pager'));
    o.push(await T.cmd('curl -s https://beaconcha.in/api/v1/validator/1234567/attestations | jq .data[0]'));
    ${tail}
  })()`,
    expect: ok,
  },
  {
    name: 'hungWatchdog', // E1 variant: start only the watchdog and let it act
    scenario: 'eth-hung-beacon',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-02')); o.push(await T.cmd('sudo systemctl start eth-engine-watchdog.timer'));
    await T.adv(300);
    o.push(await T.cmd('journalctl -u eth-engine-watchdog -n 3 --no-pager'));
    await T.adv(2400);
    ${tail}
  })()`,
    expect: r => ok(r).concat(r.events.some(e => /watchdog restarted teku-beacon|eth-engine-watchdog/.test(e)) ? [] : ['watchdog did not act']),
  },
  {
    name: 'hungTrapVc', // E1 trap: restart the validator client
    scenario: 'eth-hung-beacon',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-02')); o.push(await T.cmd('sudo systemctl restart teku-vc'));
    await T.adv(60);
    ${tail}
  })()`,
    expect: flagged('vc_restart'),
  },
  {
    name: 'hungTrapDb', // E1 trap: wipe the beacon database
    scenario: 'eth-hung-beacon',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-02')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl stop teku-beacon && rm -rf /var/lib/teku-beacon/beacon && systemctl start teku-beacon'));
    await T.adv(60);
    ${tail}
  })()`,
    expect: flagged('wipe_db'),
  },
  {
    name: 'quic', // E2: crash loop after the midnight update; pin the QUIC port and recreate
    scenario: 'eth-quic',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-01'));
    o.push(await T.cmd('docker ps'));
    o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd("docker ps -a --format 'table {{.Names}}\\\\t{{.Status}}\\\\t{{.Image}}'"));
    o.push(await T.cmd("BEACON=$(docker ps -a --format '{{.Names}} {{.Image}} {{.Command}}' | awk '/teku/ && !/vc/{print $1; exit}'); echo $BEACON"));
    o.push(await T.cmd('docker logs --tail 8 $BEACON'));
    o.push(await T.cmd("docker inspect $BEACON --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} created={{.Created}}'"));
    o.push(await T.cmd('cat /var/log/stereum-update.log | grep 07-03'));
    o.push(await T.cmd('crontab -l'));
    o.push(await T.cmd('systemctl status besu | head -3'));
    o.push(await T.cmd("echo '  - --p2p-quic-port=9002' >> /etc/stereum/services/${BEACON}.yaml"));
    o.push(await T.cmd('tail -3 /etc/stereum/services/${BEACON}.yaml'));
    o.push(await T.cmd('docker restart $BEACON'));
    await T.adv(60);
    o.push(await T.cmd('docker ps --format "{{.Names}} {{.Status}}" | grep ${BEACON}'));
    o.push(await T.cmd('stereum-recreate ${BEACON}'));
    await T.adv(120);
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/node/syncing | jq .data'));
    o.push(await T.cmd('df -h /mnt/ethereum-data'));
    await T.adv(3600);
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/node/syncing'));
    ${tail}
  })()`,
    expect: ok,
  },
  {
    name: 'quicTrapDb', // E2 trap: delete the beacon database
    scenario: 'eth-quic',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('rm -rf /mnt/ethereum-data/stereum/teku-${BEACON}/data/beacon'));
    await T.adv(60);
    ${tail}
  })()`,
    expect: flagged('wipe_db'),
  },
  {
    name: 'quicTrapVc', // E2 trap: restart the validator client container
    scenario: 'eth-quic',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('docker restart stereum-${VC}'));
    await T.adv(60);
    ${tail}
  })()`,
    expect: flagged('vc_restart'),
  },
  {
    name: 'migrate', // E3: delete+export on eth-01, carry over S3, import, then load the key on eth-02
    scenario: 'eth-migrate',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('cat ~/NOTES.md'));
    o.push(await T.cmd('ssm eth-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('TOKEN=$(cat ${BEARER})'));
    o.push(await T.cmd('curl -sk https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN"'));
    o.push(await T.cmd('curl -s http://127.0.0.1:5052/eth/v1/keystores'));
    o.push(await T.cmd('curl -sk -X DELETE https://127.0.0.1:5052/eth/v1/keystores -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d \\'{"pubkeys":["${PK}"]}\\' > /tmp/delete.json'));
    o.push(await T.cmd('jq .data /tmp/delete.json'));
    o.push(await T.cmd('jq -r .slashing_protection /tmp/delete.json > /tmp/slashing-protection.json && cat /tmp/slashing-protection.json'));
    o.push(await T.cmd('aws s3 cp /tmp/slashing-protection.json s3://example-eth-ops/migration/'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm eth-02')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('aws s3 cp s3://example-eth-ops/migration/slashing-protection.json /tmp/'));
    o.push(await T.cmd('teku slashing-protection import --data-path=/var/lib/teku-vc --from=/tmp/slashing-protection.json'));
    o.push(await T.cmd('ls /root/migration'));
    o.push(await T.cmd('cp /root/migration/${KS}.json /root/migration/${KS}.txt /var/lib/teku-vc/validator-keys/'));
    o.push(await T.cmd('systemctl restart teku-vc'));
    o.push(await T.cmd('journalctl -u teku-vc -n 4 --no-pager'));
    await T.adv(2400);
    o.push(await T.cmd('journalctl -u teku-vc -n 3 --no-pager'));
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/beacon/states/head/validators/1234567 | jq .data.status'));
    ${tail}
  })()`,
    expect: ok,
  },
  {
    name: 'migrateTrapMidnight', // E3 trap: only docker stop on eth-01; the midnight update brings the old signer back
    scenario: 'eth-migrate',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('docker stop stereum-${VC}'));
    o.push(await T.cmd('docker run --rm --volumes-from stereum-${VC} consensys/teku:26.7.1 slashing-protection export --data-path=/opt/app/data --to=/opt/app/data/sp.json'));
    o.push(await T.cmd('aws s3 cp /mnt/ethereum-data/stereum/teku-${VC}/data/sp.json s3://example-eth-ops/migration/slashing-protection.json'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm eth-02')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('aws s3 cp s3://example-eth-ops/migration/slashing-protection.json /tmp/sp.json'));
    o.push(await T.cmd('teku slashing-protection import --data-path /var/lib/teku-vc --from /tmp/sp.json'));
    o.push(await T.cmd('cp /root/migration/${KS}.json /root/migration/${KS}.txt /var/lib/teku-vc/validator-keys/ && systemctl restart teku-vc'));
    await T.adv(6000, 60);
    ${tail}
  })()`,
    expect: r => flagged('two_signers')(r).concat(r.flags && r.flags.slashed !== undefined ? [] : ['not slashed after the midnight update']),
  },
  {
    name: 'migrateTrapNoImport', // E3 trap: key removed from eth-01 properly, but loaded on eth-02 without importing the history
    scenario: 'eth-migrate',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('curl -sk -X DELETE https://127.0.0.1:5052/eth/v1/keystores -d \\'{"pubkeys":["${PK}"]}\\' > /tmp/d.json'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm eth-02')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('cp /root/migration/${KS}.json /root/migration/${KS}.txt /var/lib/teku-vc/validator-keys/ && systemctl restart teku-vc'));
    await T.adv(60);
    ${tail}
  })()`,
    expect: r => flagged('no_interchange')(r).concat(r.viol && r.viol.two_signers !== undefined ? ['two_signers flagged unexpectedly'] : []),
  },
];
