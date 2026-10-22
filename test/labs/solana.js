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
  {
    name: 'run', // R1: follow every step of the guided build by running the commands its instructions give
    scenario: 'sol-run',
    steps: `(async () => {
    const sc = VSIM.S.scenarios.find(s => s.id === 'sol-run');
    const codes = st => { const d = document.createElement('div'); d.innerHTML = VSIM.S.tr(st.how); return [...d.querySelectorAll('code')].map(c => c.textContent); };
    const o = [], stuck = [];
    for (let i = 0; i < sc.steps.length; i++) {
      for (const c of codes(sc.steps[i])) {
        if (/ monitor$|^journalctl|^has caught up$/.test(c)) continue; // interactive or not a command
        o.push('$ ' + c.slice(0, 100)); o.push(await T.cmd(c));
      }
      for (let k = 0; k < 40 && (VSIM.w.stepIdx || 0) <= i && !VSIM.w.done; k++) {
        await T.adv(30);
        if (/catchup/.test(codes(sc.steps[i]).join(' '))) o.push(await T.cmd('solana catchup --our-localhost'));
      }
      if ((VSIM.w.stepIdx || 0) <= i) { stuck.push(i + 1); break; }
    }
    return { out: o.join('\\n'), stuck, step: VSIM.w.stepIdx, done: VSIM.w.done, result: VSIM.w.result, viol: VSIM.w.violations, journal: (VSIM.w.nodes['sol-new'].journal['agave-validator'] || []).slice(-6).map(e => e.msg) };
  })()`,
    expect: r => r.result && r.result.success ? [] : [`lab not completed (stuck at step ${(r.stuck || [])[0]})`],
  },
  {
    name: 'runWithdrawer', // R1 trap: the authorized withdrawer is generated on the validator host
    scenario: 'sol-run',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-new')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('solana-keygen new -o /home/sol/authorized-withdrawer-keypair.json'));
    o.push(await T.cmd('git clone --branch v4.3.0 --depth 1 https://github.com/anza-xyz/agave.git /opt/agave'));
    o.push(await T.cmd('/opt/agave/scripts/cargo-install-all.sh /usr/local'));
    o.push(await T.cmd('solana-keygen new --no-bip39-passphrase -o /home/sol/authorized-withdrawer-keypair.json'));
    await T.adv(30);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.withdrawer_hot !== undefined ? [] : ['withdrawer_hot not flagged'],
  },
  {
    name: 'runMainnet', // R1 trap: funding without -ut and --from spends mainnet SOL from the default keypair
    scenario: 'sol-run',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('cat ~/NOTES.md'));
    o.push(await T.cmd('solana transfer 8vRtQm4KcZ7wLx2NbYp9HsJd3Fa6Ue5GkT1nWq7XzMpA 20'));
    o.push(await T.cmd('solana transfer 8vRtQm4KcZ7wLx2NbYp9HsJd3Fa6Ue5GkT1nWq7XzMpA 20 --allow-unfunded-recipient'));
    await T.adv(30);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.mainnet_spend !== undefined ? [] : ['mainnet_spend not flagged'],
  },
];
