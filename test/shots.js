const path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('playwright-core'); } })();
const LAUNCH = { args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) };
(async () => {
  const browser = await chromium.launch(LAUNCH);
  const errs = [];
  const url = 'file://' + path.resolve(__dirname, '../dist/index.html');
  for (const [name, vp] of [['desk', { width: 1440, height: 900 }], ['mob', { width: 402, height: 860 }]]) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', e => errs.push(name + ': ' + e.message));
    await page.goto(url); await page.waitForTimeout(600);
    await page.screenshot({ path: `/tmp/vsim-${name}-home.png`, fullPage: true });
    await page.evaluate("location.hash='s=avax-helicon'"); await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/vsim-${name}-brief.png` });
    await page.evaluate('VSIM.begin()');
    for (const c of ['gh pr list', 'ssm avax-02', 'sudo -i', 'systemctl status avalanchego', 'journalctl -u avalanchego -n 4 --no-pager']) { await page.evaluate(c2 => VSIM.run(c2), c); }
    await page.evaluate(async () => { for (let i = 0; i < 100; i++) { VSIM.advance(30); await new Promise(r => setTimeout(r, 1)); } });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/vsim-${name}-play.png`, fullPage: name === 'mob' });
    await page.close();
  }
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await browser.close();
})();
