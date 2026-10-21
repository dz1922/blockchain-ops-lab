// Plays every lab end-to-end through the real UI hooks and asserts outcomes.
// Cases live in test/labs/<network>.js: [{ name, scenario, steps, expect(r) → [failure, …] }].
// `steps` is a string evaluated in the page; window.T offers cmd(line) and adv(seconds).
// Run one network with ONLY=ethereum.
const fs = require('fs');
const path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('playwright-core'); } })();
const LAUNCH = { args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) };
const dir = path.join(__dirname, 'labs');
const nets = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).filter(n => !process.env.ONLY || process.env.ONLY.split(',').includes(n)).sort();
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
  const ids = await page.evaluate('VSIM.S.scenarios.map(s => s.id)');
  const fails = [];
  const covered = new Set();
  for (const net of nets) {
    for (const c of require(path.join(dir, net + '.js'))) {
      covered.add(c.scenario);
      await page.evaluate(`location.hash=''`); await page.waitForTimeout(50); await page.evaluate(`location.hash='s=${c.scenario}'`); await page.waitForTimeout(200);
      await page.evaluate(helpers); await page.evaluate('VSIM.begin()');
      const t0 = Date.now();
      let r;
      try { r = await page.evaluate(c.steps); } catch (e) { r = { error: e.message }; }
      console.log(`\n========== ${net}/${c.name} · ${c.scenario} (${Date.now() - t0} ms) ==========`);
      console.log(JSON.stringify(Object.assign({}, r, { out: undefined }), null, 1)); if (r && r.out) console.log(r.out);
      const f = r && r.error ? ['threw: ' + r.error] : c.expect(r || {});
      f.forEach(x => fails.push(`${net}/${c.name}: ${x}`));
    }
  }
  if (!process.env.ONLY) ids.filter(id => !covered.has(id)).forEach(id => fails.push(`${id}: no test case plays this lab`));
  console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  if (errs.length) fails.push('page errors');
  if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
  console.log('ALL CHECKS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
