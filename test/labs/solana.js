// Solana lab runs. Each case plays a scenario through the UI hooks; expect() returns failure messages.
module.exports = [
  {
    name: 'sol', // Solana balance — mainnet mistake, then fix
    scenario: 'sol-balance',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('cat ~/NOTES.md'));
    o.push(await T.cmd('solana balance 7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv'));
    o.push(await T.cmd('solana balance 7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv -ut'));
    o.push(await T.cmd('solana transfer 7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv 10 --from ~/funding-testnet.json'));
    o.push(await T.cmd('solana transfer 7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv 10 --from ~/funding-testnet.json -ut'));
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('solana catchup --our-localhost'));
    o.push(await T.cmd('exit'));
    o.push(await T.cmd('solana validators -ut | head -3'));
    await T.adv(300);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'solTrap', // Solana trap: do nothing for 5 days, then start the backup
    scenario: 'sol-balance',
    steps: `(async () => {
    await T.adv(4.6 * 86400, 600);
    const delinq = S => S;
    const o = [];
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo systemctl start agave-validator'));
    await T.adv(600);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, calls: VSIM.w.stats.calls, groups: Object.values(VSIM.w.groups).map(g => [g.name, g.calls, g.resolved]) , events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-8)};
  })()`,
    expect: r => r.viol && r.viol.double_sign !== undefined ? [] : ['double_sign not flagged'],
  },
  {
    name: 'failover', // S2: primary lets go, tower moves, standby takes over, primary cannot come back staked
    scenario: 'sol-failover',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('cat ~/NOTES.md'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('solana catchup --our-localhost')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl disable agave-validator'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json'));
    o.push(await T.cmd('scp /mnt/ledger/tower-1_9-7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv.bin sol-backup:/mnt/ledger/'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity --require-tower /home/sol/validator-keypair.json'));
    o.push(await T.cmd('solana gossip | grep 7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv'));
    await T.adv(300);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations, gap: VSIM.w.chain.noVoteSec };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'failoverReboot', // S2 trap: correct switch, but sol-1 still boots with the staked identity after maintenance
    scenario: 'sol-failover',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json'));
    o.push(await T.cmd('scp /mnt/ledger/tower-1_9-7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv.bin sol-backup:/mnt/ledger/'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity --require-tower /home/sol/validator-keypair.json'));
    await T.adv(5400, 60);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-8) };
  })()`,
    expect: r => r.viol && r.viol.double_sign !== undefined ? [] : ['double_sign not flagged'],
  },
  {
    name: 'failoverTower', // S2 trap: take over without the tower file
    scenario: 'sol-failover',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity --require-tower /home/sol/validator-keypair.json'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/validator-keypair.json'));
    await T.adv(60);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.no_tower !== undefined && r.viol.double_sign === undefined ? [] : ['no_tower not flagged (or double_sign flagged)'],
  },
  {
    name: 'stale', // S3: restart without --no-snapshot-fetch so the node downloads a fresh snapshot
    scenario: 'sol-stale-snapshot',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl is-active agave-validator'));
    o.push(await T.cmd('solana catchup --our-localhost'));
    o.push(await T.cmd('journalctl -u agave-validator -n 8 --no-pager'));
    o.push(await T.cmd('systemctl cat agave-validator | grep snapshot'));
    o.push(await T.cmd('ls /mnt/ledger'));
    o.push(await T.cmd("sed -i 's/ --no-snapshot-fetch//' /etc/systemd/system/agave-validator.service"));
    o.push(await T.cmd('systemctl daemon-reload'));
    o.push(await T.cmd('systemctl restart agave-validator'));
    await T.adv(60);
    o.push(await T.cmd('solana catchup --our-localhost'));
    await T.adv(420);
    o.push(await T.cmd('journalctl -u agave-validator -n 6 --no-pager'));
    await T.adv(120);
    o.push(await T.cmd('solana catchup --our-localhost'));
    await T.adv(120);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'staleTrap', // S3 trap: wipe the ledger to "start fresh"
    scenario: 'sol-stale-snapshot',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl stop agave-validator'));
    o.push(await T.cmd('rm -rf /mnt/ledger/*'));
    await T.adv(60);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.wipe_ledger !== undefined ? [] : ['wipe_ledger not flagged'],
  },
];
