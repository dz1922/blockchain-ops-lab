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
];
