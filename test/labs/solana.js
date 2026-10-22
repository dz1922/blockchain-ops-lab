// Solana lab runs (Alpenglow cluster). Each case plays a scenario through the UI hooks; expect() returns failure messages.
const ID = '7nYTxq2Lw5RkV8dB3cM9pHf4Js6Ue1Zg2aNXyQrK5tPv', VOTE = 'Gv4kQpS2mT8xWc6RbN3hJd9Fy7Ze5Ua1LrK2nHsXqPtM';
const NEW_ID = '8vRtQm4KcZ7wLx2NbYp9HsJd3Fa6Ue5GkT1nWq7XzMpA', NEW_VOTE = 'Vt3kPq8WmZ2xRc6NbLd9Hf5Jy7Ts4Ua1GeK3nQrW8sMx', NEW_WD = 'Wd9pLq4XkT7mVz2NcR8bHs5Jy3Fa6GeU1oKt4Pw7Qn2Y';
const tail = `events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-8)`;
module.exports = [
  {
    name: 'voteFund', // S1: read the balances, fund the vote account on testnet before the boundary, cross it, confirm
    scenario: 'sol-balance',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('cat ~/NOTES.md'));
    o.push(await T.cmd('solana balance ${VOTE}'));
    o.push(await T.cmd('solana balance ${VOTE} -ut'));
    o.push(await T.cmd('solana balance ${ID} -ut'));
    o.push(await T.cmd('solana epoch-info -ut'));
    o.push(await T.cmd('solana transfer ${VOTE} 6 --from ~/funding-testnet.json'));
    o.push(await T.cmd('solana transfer ${VOTE} 6 --from ~/funding-testnet.json -ut'));
    o.push(await T.cmd('solana vote-account ${VOTE} -ut'));
    await T.adv(10200, 60);
    o.push(await T.cmd('solana vote-account ${VOTE} -ut'));
    await T.adv(300);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations, ${tail} };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'voteFundIdentity', // S1 failure: fund the identity instead and let the clock run out; the boundary leaves the validator out of N+2
    scenario: 'sol-balance',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('solana transfer ${ID} 10 --from ~/funding-testnet.json -ut'));
    o.push(await T.cmd('solana balance ${ID} -ut'));
    await T.adv(10200, 60);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, ${tail} };
  })()`,
    expect: r => r.done && r.result && !r.result.success && !r.result.reachedGoal ? [] : ['funding the identity did not fail the lab at the boundary'],
  },
  {
    name: 'voteFundMainnet', // S1 trap: no -ut and no --from; the default keypair spends mainnet SOL
    scenario: 'sol-balance',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('solana transfer ${VOTE} 6'));
    o.push(await T.cmd('solana transfer ${VOTE} 6 --allow-unfunded-recipient'));
    await T.adv(30);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.mainnet_spend !== undefined ? [] : ['mainnet_spend not flagged'],
  },
  {
    name: 'voteFundBackup', // S1 trap: start the standby, which is configured with the same staked identity
    scenario: 'sol-balance',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo systemctl start agave-validator'));
    await T.adv(600);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, ${tail} };
  })()`,
    expect: r => r.viol && r.viol.double_sign !== undefined ? [] : ['double_sign not flagged'],
  },
  {
    name: 'failover', // S2: primary lets go, vote history moves, standby takes over with the default set-identity, primary cannot come back staked
    scenario: 'sol-failover',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('cat ~/NOTES.md'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('solana catchup --our-localhost')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl disable agave-validator'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json'));
    o.push(await T.cmd('scp /mnt/ledger/vote_history-${ID}.bin sol-backup:/mnt/ledger/'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/validator-keypair.json'));
    o.push(await T.cmd('solana gossip | grep ${ID}'));
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
    o.push(await T.cmd('scp /mnt/ledger/vote_history-${ID}.bin sol-backup:/mnt/ledger/'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/validator-keypair.json'));
    await T.adv(5400, 60);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, ${tail} };
  })()`,
    expect: r => r.viol && r.viol.double_sign !== undefined ? [] : ['double_sign not flagged'],
  },
  {
    name: 'failoverOverride', // S2 trap: set-identity refuses without the vote history; forcing it while sol-1 is reachable is flagged
    scenario: 'sol-failover',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-1')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/unstaked-identity.json'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/validator-keypair.json'));
    o.push(await T.cmd('agave-validator -l /mnt/ledger set-identity /home/sol/validator-keypair.json --do-not-require-vote-history'));
    await T.adv(60);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, refused: /Unable to load vote history/.test(T.out()) };
  })()`,
    expect: r => r.refused && r.viol && r.viol.vh_override !== undefined && r.viol.double_sign === undefined ? [] : ['default set-identity did not refuse, or vh_override not flagged (or double_sign flagged)'],
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
    name: 'staleBackup', // S3 trap: follow the colleague's advice and start sol-backup
    scenario: 'sol-stale-snapshot',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo systemctl start agave-validator'));
    await T.adv(600);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.double_sign !== undefined ? [] : ['double_sign not flagged'],
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
      // admission waits for epoch boundaries, which are a day apart
      for (let k = 0; k < 60 && (VSIM.w.stepIdx || 0) <= i && !VSIM.w.done; k++) {
        await T.adv(1800, 300);
        for (const c of codes(sc.steps[i]).filter(x => /^solana (validators|vote-account|epoch-info)/.test(x))) await T.cmd(c);
      }
      if ((VSIM.w.stepIdx || 0) <= i) { stuck.push(i + 1); break; }
    }
    return { out: o.join('\\n').slice(-6000), stuck, step: VSIM.w.stepIdx, done: VSIM.w.done, result: VSIM.w.result, viol: VSIM.w.violations, journal: (VSIM.w.nodes['sol-new'].journal['agave-validator'] || []).slice(-6).map(e => e.msg), ${tail} };
  })()`,
    expect: r => r.result && r.result.success && r.result.extra && /good/.test(r.result.extra[0][2]) ? [] : [`lab not completed or not admitted at the first possible epoch (stuck at step ${(r.stuck || [])[0]})`],
  },
  {
    name: 'runNoBls', // R1 failure: fund the vote account but skip BLS registration; the boundary leaves it out
    scenario: 'sol-run',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-new')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('git clone --branch v4.3.2 --depth 1 https://github.com/anza-xyz/agave.git /opt/agave'));
    o.push(await T.cmd('/opt/agave/scripts/cargo-install-all.sh /usr/local'));
    o.push(await T.cmd('solana-keygen new --no-bip39-passphrase -o /home/sol/validator-keypair.json'));
    o.push(await T.cmd('solana-keygen new --no-bip39-passphrase -o /home/sol/vote-account-keypair.json'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('solana-keygen new -o ~/authorized-withdrawer-keypair.json'));
    o.push(await T.cmd('solana transfer ${NEW_ID} 20 --from ~/funding-testnet.json --allow-unfunded-recipient -ut'));
    o.push(await T.cmd('ssm sol-new')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('solana create-vote-account -ut --fee-payer /home/sol/validator-keypair.json --commission 10 /home/sol/vote-account-keypair.json /home/sol/validator-keypair.json ${NEW_WD}'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('solana transfer ${NEW_VOTE} 8 --from ~/funding-testnet.json -ut'));
    o.push(await T.cmd('solana vote-account ${NEW_VOTE} -ut | grep "BLS Public Key"'));
    await T.adv(8 * 3600 + 600, 300);
    const ch = VSIM.w.chain;
    return { out: o.join('\\n----\\n'), why: ch.excludedWhy, admittedNext: ch.admitted[ch.startEpoch + 2], ${tail} };
  })()`,
    expect: r => r.why === 'no BLS pubkey' && r.admittedNext === false ? [] : ['missing BLS key did not exclude the validator at the boundary'],
  },
  {
    name: 'runWithdrawer', // R1 trap: the authorized withdrawer is generated on the validator host
    scenario: 'sol-run',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm sol-new')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('solana-keygen new -o /home/sol/authorized-withdrawer-keypair.json'));
    o.push(await T.cmd('git clone --branch v4.3.2 --depth 1 https://github.com/anza-xyz/agave.git /opt/agave'));
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
    o.push(await T.cmd('solana transfer ${NEW_ID} 20'));
    o.push(await T.cmd('solana transfer ${NEW_ID} 20 --allow-unfunded-recipient'));
    await T.adv(30);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.mainnet_spend !== undefined ? [] : ['mainnet_spend not flagged'],
  },
];
