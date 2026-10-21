const path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('playwright-core'); } })();
const LAUNCH = { args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) };
(async () => {
  const browser = await chromium.launch(LAUNCH);
  const errs = [];
  for (const lang of ['en', 'zh']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => errs.push(lang + ': ' + e.message));
    await page.goto('file://' + path.resolve(__dirname, '../dist/index.html') + '?lang=' + lang); await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/v2-${lang}-home.png`, fullPage: true });
    await page.evaluate("location.hash='s=avax-2210'"); await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/v2-${lang}-brief.png` });
    await page.evaluate('VSIM.begin()');
    for (const c of ['ssm avax-02', 'sudo -i', 'systemctl status avalanchego | head -6', 'hint']) await page.evaluate(c2 => VSIM.run(c2), c);
    await page.evaluate(async () => { for (let i = 0; i < 30; i++) { VSIM.advance(30); await new Promise(r => setTimeout(r, 1)); } });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/v2-${lang}-play.png` });
    await page.close();
  }
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await browser.close();
})();
