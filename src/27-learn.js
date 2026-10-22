/* ============================================================
   Step 1 helpers: small interactive widgets inside a lesson chapter.
   A chapter's widget(el) builds its DOM inside el. Anything started
   with S.wg.loop or S.wg.every is stopped when the chapter closes.
   ============================================================ */
(function (S) {
  'use strict';
  let stops = [];
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  S.wg = {
    el,
    // range input with a live value label. onInput(value) runs on change and once after mount.
    slider(parent, { label, min, max, step = 1, value, fmt = v => String(v) }, onInput) {
      const row = el('label', 'wg-ctl', `<span class="wg-l">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><b class="wg-v"></b>`);
      const input = row.querySelector('input'), out = row.querySelector('.wg-v');
      const upd = () => { const v = +input.value; out.textContent = fmt(v); if (onInput) onInput(v); };
      input.addEventListener('input', upd);
      parent.appendChild(row);
      Promise.resolve().then(upd);
      return { row, input, get value() { return +input.value; }, set(v) { input.value = v; upd(); } };
    },
    // a row of buttons: [[label, onClick], …]. With {toggle: true} one button stays selected.
    buttons(parent, items, opt = {}) {
      const row = el('div', 'wg-btns');
      const bs = items.map(([label, fn], i) => {
        const b = el('button', 'wg-btn' + (opt.toggle && i === (opt.selected || 0) ? ' on' : ''), label);
        b.addEventListener('click', () => { if (opt.toggle) bs.forEach(x => x.classList.toggle('on', x === b)); fn(b); });
        row.appendChild(b); return b;
      });
      parent.appendChild(row);
      return bs;
    },
    // stat tiles. set([[label, value, 'good'|'mid'|'bad'|''], …]) redraws them.
    stats(parent) {
      const box = el('div', 'wg-stats'); parent.appendChild(box);
      return { el: box, set(rows) { box.innerHTML = rows.map(([k, v, c]) => `<div class="wg-stat ${c || ''}"><span>${k}</span><b>${v}</b></div>`).join(''); } };
    },
    // a horizontal meter, 0–100. marks: [[pct, label], …] draw thresholds.
    meter(pct, cls, marks = []) {
      return `<div class="wg-meter ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i>${marks.map(([p, l]) => `<em style="left:${p}%" title="${l || ''}"></em>`).join('')}</div>`;
    },
    // requestAnimationFrame loop; fn(dtSeconds, elapsedSeconds). Returns stop(). The first frame's timestamp can precede
    // performance.now() at setup, so dt is clamped at 0.
    loop(fn) {
      let on = true, last = performance.now(), t0 = last;
      const f = now => { if (!on) return; const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now; fn(dt, Math.max(0, (now - t0) / 1000)); requestAnimationFrame(f); };
      requestAnimationFrame(f);
      const stop = () => { on = false; };
      stops.push(stop);
      return stop;
    },
    every(ms, fn) { const h = setInterval(fn, ms); const stop = () => clearInterval(h); stops.push(stop); return stop; },
    // called by the UI when a chapter closes or the language changes
    cleanup() { stops.forEach(f => f()); stops = []; },
  };
})(SIM);
