// Plays every scenario end-to-end through the real UI hooks and asserts outcomes.
const path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('playwright-core'); } })();
const LAUNCH = { args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) };
(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../dist/index.html') + '?lang=' + (process.env.LANGX || 'en'));
  await page.waitForTimeout(300);
  const helpers = `
    window.T = {
      out: () => document.getElementById('term-out').innerText,
      async cmd(line, maxSim = 7200, step = 10) {
        const before = document.getElementById('term-out').innerText.length;
        let done = false; const p = VSIM.run(line).then(() => { done = true; });
        let t = 0; while (!done && t < maxSim) { await new Promise(r => setTimeout(r, 2)); if (!done) { VSIM.advance(step); t += step; } }
        await p; return document.getElementById('term-out').innerText.slice(before);
      },
      async adv(sec, step = 30) { for (let t = 0; t < sec && !VSIM.w.done; t += step) { VSIM.advance(step); await new Promise(r => setTimeout(r, 1)); } },
    };`;
  async function scenario(id, steps) {
    await page.evaluate(`location.hash=''`); await page.waitForTimeout(50); await page.evaluate(`location.hash='s=${id}'`); await page.waitForTimeout(200);
    await page.evaluate(helpers); await page.evaluate('VSIM.begin()');
    const t0 = Date.now(); const r = await page.evaluate(steps);
    console.log(`\n========== ${id} (${Date.now() - t0} ms) ==========`); console.log(JSON.stringify(Object.assign({}, r, { out: undefined }), null, 1)); console.log(r.out); return r;
  }
  const results = {};
  // 1. Helicon deadline, merge the PR
  results.helicon = await scenario('avax-helicon', `(async () => {
    const o = [];
    o.push(await T.cmd('gh pr view 477'));
    o.push(await T.cmd('ssm avax-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl status avalanchego | head -4'));
    o.push(await T.cmd('curl -s localhost:9650/ext/health | jq .healthy'));
    o.push(await T.cmd('journalctl -u avalanchego -n 3 --no-pager'));
    o.push(await T.cmd('NODE=$(curl -s -X POST --data \\'{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}\\' localhost:9650/ext/info | jq -r .result.nodeID); echo $NODE'));
    o.push(await T.cmd('curl -s -X POST --data "{\\\\"jsonrpc\\\\":\\\\"2.0\\\\",\\\\"id\\\\":1,\\\\"method\\\\":\\\\"platform.getCurrentValidators\\\\",\\\\"params\\\\":{\\\\"nodeIDs\\\\":[\\\\"$NODE\\\\"]}}" https://api.avax.network/ext/bc/P | jq ".result.validators[0] | {uptime, connected}"'));
    o.push(await T.cmd('cp /usr/local/bin/avalanchego /tmp/x && echo copied-to-tmp'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('staking upgrade avalanche --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('gh pr merge 477'));
    await T.adv(5400);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, nodes: Object.values(VSIM.w.nodes).map(n => [n.moniker, n.av.running, n.av.offline]), events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-14) };
  })()`);
  // 2. Helicon 22:10 — staking upgrade per node (region trap first)
  results.r2210 = await scenario('avax-2210', `(async () => {
    const o = [];
    o.push(await T.cmd('ssm avax-02')); o.push(await T.cmd('sudo -i')); o.push(await T.cmd('systemctl status avalanchego | head -5'));
    o.push(await T.cmd('journalctl -u avalanchego -n 4 --no-pager | grep -i fatal'));
    o.push(await T.cmd('avalanchego --version'));
    o.push(await T.cmd('cd /tmp && curl -fsSL -o a.tar.gz https://github.com/ava-labs/avalanchego/releases/download/v1.15.0/avalanchego-linux-amd64-v1.15.0.tar.gz && tar xzf a.tar.gz -C /tmp/ && install -m 0755 -o root -g root /tmp/avalanchego-v1.15.0/avalanchego /usr/local/bin/avalanchego && echo installed'));
    await T.adv(60);
    o.push(await T.cmd('systemctl is-active avalanchego'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('staking upgrade avalanche --env prod --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('staking --region us-east-1 upgrade avalanche --env prod --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('staking --region us-west-1 upgrade avalanche --env prod --moniker avax-03 --version 1.15.0'));
    await T.adv(3000);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations, nodes: Object.values(VSIM.w.nodes).map(n => [n.moniker, n.av.running, n.services.avalanchego.state, n.services.avalanchego.restarts]) };
  })()`);
  // 3. avax-02 IP
  results.ip = await scenario('avax-ip', `(async () => {
    const o = [];
    o.push(await T.cmd('aws ssm start-session --target i-0b2e4d6f8a1c35792'));
    o.push(await T.cmd('aws ssm start-session --region us-west-2 --target i-0b2e4d6f8a1c35792'));
    o.push(await T.cmd('systemctl restart avalanchego'));
    o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('curl -s localhost:9650/ext/health | jq .checks.network.error'));
    o.push(await T.cmd('NEW=$(curl -s checkip.amazonaws.com); jq -r \\'."public-ip"\\' /etc/avalanche/config.json; echo $NEW'));
    o.push(await T.cmd('sed -i "s/198.51.100.12/$NEW/" /etc/avalanche/config.json && systemctl restart avalanchego'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('nc -zv 198.51.100.47 9651'));
    o.push(await T.cmd('cd ~/monitoring && sed -i "s/198.51.100.12/198.51.100.47/" ext-uptime/prometheus/prometheus.yml.tmpl && ./scripts/deploy-ext-uptime.sh'));
    await T.adv(1200);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState };
  })()`);
  // 4. Solana balance — mainnet mistake, then fix
  results.sol = await scenario('sol-balance', `(async () => {
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
  })()`);
  // 5. Solana trap: do nothing for 5 days, then start the backup
  results.solTrap = await scenario('sol-balance', `(async () => {
    await T.adv(4.6 * 86400, 600);
    const delinq = S => S;
    const o = [];
    o.push(await T.cmd('ssm sol-backup')); o.push(await T.cmd('sudo systemctl start agave-validator'));
    await T.adv(600);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, calls: VSIM.w.stats.calls, groups: Object.values(VSIM.w.groups).map(g => [g.name, g.calls, g.resolved]) , events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-8)};
  })()`);
  // 6. Helicon rollback trap: upgrade one node by hand then roll back
  results.trap = await scenario('avax-helicon', `(async () => {
    const o = [];
    o.push(await T.cmd('staking --region us-east-1 upgrade avalanche --env prod --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('ssm avax-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('cp /usr/local/bin/avalanchego.prev /usr/local/bin/avalanchego'));
    o.push(await T.cmd('install -m 0755 /usr/local/bin/avalanchego.prev /usr/local/bin/avalanchego && systemctl restart avalanchego'));
    await T.adv(60);
    o.push(await T.cmd('journalctl -u avalanchego -n 6 --no-pager'));
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, state: VSIM.w.nodes['avax-01'].services.avalanchego.state };
  })()`);
  console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  const fails = [];
  for (const k of ['helicon', 'r2210', 'ip', 'sol']) if (!(results[k] && results[k].result && results[k].result.success)) fails.push(`${k}: lab not completed`);
  if (!(results.solTrap && results.solTrap.viol && results.solTrap.viol.double_sign !== undefined)) fails.push('solTrap: double_sign not flagged');
  if (!(results.trap && results.trap.viol && results.trap.viol.rollback !== undefined)) fails.push('trap: rollback not flagged');
  if (errs.length) fails.push('page errors');
  if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
  console.log('ALL CHECKS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
