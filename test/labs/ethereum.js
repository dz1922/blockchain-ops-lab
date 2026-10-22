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
    o.push(await T.cmd('cat /var/log/stereum-update.log | grep 06-17'));
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

// R1: the guided Hoodi install. Paths and names match the lab's step text.
const KIT = '/home/ubuntu/hoodi-kit';
const RKS = 'keystore-m_12381_3600_0_0_0-1792657380';
const RDD = 'deposit_data-1792657380.json';
const WALLET = '0x3c1e5a7b9d0f2a4c6e8b1d3f5a7c9e0b2d4f6a81';
const BESU_URL = 'https://github.com/hyperledger/besu/releases/download/26.9.0/besu-26.9.0.tar.gz';
const TEKU_URL = 'https://artifacts.consensys.net/public/teku/raw/names/teku.tar.gz/versions/26.9.0/teku-26.9.0.tar.gz';
const installBesu = `
    o.push(await T.cmd('mkdir -p /etc/ethereum')); o.push(await T.cmd('openssl rand -hex 32 > /etc/ethereum/jwt.hex'));
    o.push(await T.cmd('curl -fsSL -o /tmp/besu.tar.gz ${BESU_URL}'));
    o.push(await T.cmd('mkdir -p /opt/besu')); o.push(await T.cmd('tar xzf /tmp/besu.tar.gz -C /opt/besu --strip-components=1'));
    o.push(await T.cmd('cp ${KIT}/besu.service /etc/systemd/system/')); o.push(await T.cmd('systemctl enable --now besu'));`;
const installTeku = `
    o.push(await T.cmd('curl -fsSL -o /tmp/teku.tar.gz ${TEKU_URL}'));
    o.push(await T.cmd('mkdir -p /opt/teku')); o.push(await T.cmd('tar xzf /tmp/teku.tar.gz -C /opt/teku --strip-components=1'));
    o.push(await T.cmd('cp ${KIT}/teku-beacon.service /etc/systemd/system/')); o.push(await T.cmd('systemctl enable --now teku-beacon'));`;
const keygen = `deposit --non_interactive new-mnemonic --num_validators 1 --chain hoodi --withdrawal_address ${WALLET} --keystore_password hoodi-lab-passphrase`;
module.exports.push(
  {
    name: 'run', // R1: build a Hoodi validator from scratch by following the steps
    scenario: 'eth-run',
    steps: `(async () => {
    const o = [];
    const PK = VSIM.S.networks.ethereum.helpers.keyFor('laptop', 'hoodi');
    o.push(await T.cmd('ssm eth-new')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('df -h /var/lib')); o.push(await T.cmd('timedatectl')); o.push(await T.cmd('ufw status'));
    o.push(await T.cmd('ufw allow 30303')); o.push(await T.cmd('ufw allow 9000')); o.push(await T.cmd('ufw allow 9001/udp')); o.push(await T.cmd('ufw status'));
    o.push(await T.cmd('systemctl start besu'));
    ${installBesu}
    o.push(await T.cmd('chmod 644 /etc/ethereum/jwt.hex')); o.push(await T.cmd('cat /etc/ethereum/jwt.hex'));
    o.push(await T.cmd('cat ${KIT}/besu.service'));
    await T.adv(150);
    o.push(await T.cmd('journalctl -u besu -n 6 --no-pager'));
    o.push(await T.cmd("curl -s -X POST -H 'Content-Type: application/json' -d '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"eth_syncing\\",\\"params\\":[]}' localhost:8545 | jq .result"));
    ${installTeku}
    await T.adv(60);
    o.push(await T.cmd('journalctl -u teku-beacon -n 6 --no-pager'));
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/node/syncing | jq .data'));
    o.push(await T.cmd("curl -s -X POST -H 'Content-Type: application/json' -d '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"eth_syncing\\",\\"params\\":[]}' localhost:8545 | jq .result"));
    o.push(await T.cmd('systemctl status besu teku-beacon'));
    await T.adv(1500);
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/node/syncing | jq .data'));
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/beacon/headers/finalized | jq .data.root'));
    o.push(await T.cmd('curl -s https://checkpoint-sync.hoodi.ethpandaops.io/eth/v1/beacon/headers/finalized | jq .data.root'));
    o.push(await T.cmd('df -h /var/lib')); o.push(await T.cmd('ss -tulpn'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('${keygen}'));
    o.push(await T.cmd('ls ~/validator_keys'));
    o.push(await T.cmd("jq '.[0] | {pubkey, withdrawal_credentials, network_name, fork_version}' ~/validator_keys/${RDD}"));
    o.push(await T.cmd('launchpad deposit --network hoodi --deposit-data ~/validator_keys/${RDD}'));
    o.push(await T.cmd('aws s3 cp ~/validator_keys/${RKS}.json s3://example-eth-ops/hoodi/'));
    o.push(await T.cmd('ssm eth-new')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/beacon/states/head/validators/' + PK));
    o.push(await T.cmd('aws s3 cp s3://example-eth-ops/hoodi/${RKS}.json /var/lib/teku-vc/validator-keys/'));
    o.push(await T.cmd("echo 'hoodi-lab-passphrase' > /var/lib/teku-vc/validator-keys/${RKS}.txt"));
    o.push(await T.cmd('ls /var/lib/teku-vc/validator/slashprotection'));
    o.push(await T.cmd('cp ${KIT}/teku-vc.service /etc/systemd/system/')); o.push(await T.cmd('systemctl enable --now teku-vc'));
    await T.adv(60);
    o.push(await T.cmd('journalctl -u teku-vc -n 6 --no-pager'));
    await T.adv(2400);
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/beacon/states/head/validators/' + PK + ' | jq .data'));
    await T.adv(3000);
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/beacon/states/head/validators/' + PK + ' | jq .data.status'));
    await T.adv(1800);
    o.push(await T.cmd('journalctl -u teku-vc -n 8 --no-pager'));
    o.push(await T.cmd('curl -s https://hoodi.beaconcha.in/api/v1/validator/' + PK + '/attestations | jq .data[0]'));
    o.push(await T.cmd('objectives'));
    ${tail}
  })()`,
    expect: r => ok(r).concat(r.viol && Object.keys(r.viol).length ? ['unexpected violation: ' + Object.keys(r.viol).join(',')] : []),
  },
  {
    name: 'runTrapServerKeys', // R1 trap: generate the mnemonic on the validator server
    scenario: 'eth-run',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-new'));
    o.push(await T.cmd('${keygen}'));
    await T.adv(30);
    ${tail}
  })()`,
    expect: flagged('keys_on_server'),
  },
  {
    name: 'runTrapJwt', // R1 trap: regenerate the JWT after Besu started, then start the beacon node
    scenario: 'eth-run',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm eth-new')); o.push(await T.cmd('sudo -i'));
    ${installBesu}
    await T.adv(30);
    o.push(await T.cmd('openssl rand -hex 32 > /etc/ethereum/jwt.hex'));
    ${installTeku}
    await T.adv(180);
    o.push(await T.cmd('journalctl -u teku-beacon -n 4 --no-pager'));
    o.push(await T.cmd('curl -s localhost:5051/eth/v1/node/syncing | jq .data'));
    ${tail}
  })()`,
    expect: r => flagged('jwt_mismatch')(r).concat(r.viol && r.viol.keys_on_server !== undefined ? ['keys_on_server flagged unexpectedly'] : []),
  },
);
