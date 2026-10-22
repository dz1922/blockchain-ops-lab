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
  // English is the default even for a Chinese browser with no saved choice.
  {
    const ctx = await browser.newContext({ locale: 'zh-CN' });
    const p0 = await ctx.newPage();
    await p0.goto('file://' + path.resolve(__dirname, '../dist/index.html'));
    await p0.waitForTimeout(200);
    const r0 = await p0.evaluate(`({ lang: VSIM.S.lang, first: document.querySelector('#lang-home button').textContent, html: document.documentElement.lang })`);
    await ctx.close();
    if (r0.lang !== 'en' || r0.first !== 'EN' || r0.html !== 'en') { console.error('FAILED: default language is not English first', r0); process.exit(1); }
    console.log('default language: English ok');
  }
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
  // Step 1: open every chapter of every lesson, check the widget mounts, answer each quiz correctly.
  const lessons = await page.evaluate(`VSIM.S.lessons.filter(l => !${JSON.stringify(process.env.ONLY || '')} || ${JSON.stringify(process.env.ONLY || '')}.split(',').includes(l.network)).map(l => ({ id: l.id, chapters: l.chapters.map(c => ({ widget: !!c.widget, answers: (c.quiz || []).map(q => q.answer) })) }))`);
  for (const l of lessons) {
    const bad = [];
    for (let i = 0; i < l.chapters.length; i++) {
      const before = errs.length;
      await page.evaluate(`location.hash='l=${l.id}/${i}'`); await page.waitForTimeout(120);
      const info = await page.evaluate(`({ h2: (document.querySelector('#l-main h2') || {}).textContent || '', wg: document.getElementById('l-wg') ? document.getElementById('l-wg').children.length : -1, body: (document.querySelector('#l-main .lv-body') || {}).textContent || '' })`);
      if (!info.h2.trim() || info.body.trim().length < 80) bad.push(`chapter ${i + 1}: empty title or body`);
      if (l.chapters[i].widget && info.wg < 1) bad.push(`chapter ${i + 1}: widget did not render`);
      await page.waitForTimeout(400); // let widget animations run
      for (let q = 0; q < l.chapters[i].answers.length; q++) {
        await page.click(`#l-main .q[data-q="${q}"] [data-o="${l.chapters[i].answers[q]}"]`);
      }
      if (errs.length > before) bad.push(`chapter ${i + 1}: page error`);
    }
    const n = await page.evaluate(`Object.keys(((JSON.parse(localStorage.getItem('vsim.v1') || '{}').learn || {})['${l.id}'] || {}).c || {}).length`);
    if (n !== l.chapters.length) bad.push(`only ${n}/${l.chapters.length} chapters marked done`);
    console.log(`\n========== lesson ${l.id}: ${l.chapters.length} chapters, ${l.chapters.reduce((a, c) => a + c.answers.length, 0)} questions ${bad.length ? 'FAIL' : 'ok'} ==========`);
    bad.forEach(x => fails.push(`lesson ${l.id}: ${x}`));
  }
  await page.evaluate(`location.hash=''`);
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
  // Every lab must be completable by doing exactly what its hints (or guided steps) say:
  // run each listed command in order, let the clock run for the stated wait, nothing else.
  const scns = await page.evaluate(`VSIM.S.scenarios.filter(s => !${JSON.stringify(process.env.ONLY || '')} || ${JSON.stringify(process.env.ONLY || '')}.split(',').includes(s.network)).map(s => s.id)`);
  for (const id of scns) {
    await page.evaluate(`location.hash=''`); await page.waitForTimeout(50); await page.evaluate(`location.hash='s=${id}'`); await page.waitForTimeout(200);
    await page.evaluate(helpers); await page.evaluate('VSIM.begin()');
    const t0 = Date.now();
    let r;
    try {
      r = await page.evaluate(`(async () => {
        const scn = VSIM.w.scn, out = [], bad = [];
        const tick = () => new Promise(res => setTimeout(res, 1));
        const play = async (cmds, wait) => { for (const c of cmds) out.push('$ ' + c + '\\n' + await T.cmd(c)); await T.adv(wait || 30, 10); };
        if (scn.steps) {
          for (let guard = 0; guard < scn.steps.length * 2 && !VSIM.w.done; guard++) {
            const i = VSIM.w.stepIdx || 0, st = scn.steps[i];
            if (!st) break;
            if (!st.cmds) bad.push('step ' + (i + 1) + ' has no cmds');
            await play(st.cmds || [], st.wait);
            for (let t = 0; (VSIM.w.stepIdx || 0) === i && !VSIM.w.done && t < Math.max(st.wait || 0, 600) * 3; t += 30) { VSIM.advance(30); await tick(); }
            if ((VSIM.w.stepIdx || 0) === i && !VSIM.w.done) { bad.push('stuck at step ' + (i + 1)); break; }
          }
        } else {
          (scn.hints || []).forEach((h, i) => { if (!(h && h.cmds)) bad.push('hint ' + (i + 1) + ' has no cmds'); });
          for (const h of scn.hints || []) { const p = VSIM.S.hintParts(h); await play(p.cmds, p.wait); if (VSIM.w.done) break; }
        }
        for (let t = 0; !VSIM.w.done && t < (scn.limit || 6 * 3600); t += 60) { VSIM.advance(60); await tick(); }
        const nf = out.filter(o => /command not found|No such file or directory|Usage:|usage:/.test(o)).map(o => o.split('\\n').slice(0, 3).join(' | '));
        return { result: VSIM.w.result, viol: Object.keys(VSIM.w.violations), bad, nf, out: out.join('\\n') };
      })()`);
    } catch (e) { r = { error: e.message }; }
    const f = [];
    if (r.error) f.push('threw: ' + r.error);
    else {
      if (!(r.result && r.result.success)) f.push('not completed by following the hints' + (r.result ? ` (reachedGoal=${r.result.reachedGoal})` : ' (time ran out)'));
      if (r.viol.length) f.push('violations: ' + r.viol.join(', '));
      r.bad.forEach(x => f.push(x));
      r.nf.forEach(x => f.push('error output: ' + x.slice(0, 200)));
    }
    console.log(`\n========== hints-only ${id} (${Date.now() - t0} ms) ${f.length ? 'FAIL' : 'ok'} ==========`);
    if (f.length && process.env.VERBOSE) console.log(r.out);
    f.forEach(x => fails.push(`hints-only ${id}: ${x}`));
  }
  console.log('\nERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  if (errs.length) fails.push('page errors');
  if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
  console.log('ALL CHECKS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
