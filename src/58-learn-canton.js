/* ============================================================
   Canton, steps 1 and 2: the fundamentals lesson and the guided
   lab that builds a Splice validator node on a fresh host.
   The mechanics live in 44-net-canton.js (cfg.fresh).
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL;
  const MOD = LL('Canton 验证者运维', 'Canton validator operations');

  /* ==================== step 1: fundamentals ==================== */
  const W = S.wg, E = (t, c, h) => S.wg.el(t, c, h);
  const C = { lime: '#b6f23a', amber: '#f5a623', red: '#ff6b57', blue: '#7cc4ff', teal: '#3fd0c9', ink: '#e8f0e4', ink2: '#b9c7b4', ink3: '#7f9180', line: '#26312b', line2: '#34413a', panel: '#111714', panel3: '#1d2722', okBg: '#16302a', badBg: '#2a1512' };
  const title = el => el.appendChild(E('div', 'wg-title', S.L('动手试试', 'Try it')));
  const cap = (el, zh, en) => { const c = E('div', 'wg-cap', S.L(zh, en)); el.appendChild(c); return c; };
  const randHex = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const mono = 'font-family:var(--f-mono);font-size:.82rem;';

  // chapter 1: which parts of a multi-party transaction each viewer receives
  function wPrivacy(el) {
    const L = S.L;
    title(el);
    cap(el, '一笔券款对付（DvP）交易：Alice 用现金向 Bob 买债券。银行发行现金，登记机构登记债券。选一个视角，看它收到交易的哪些部分。', 'A delivery-versus-payment (DvP) transaction: Alice buys a bond from Bob for cash. A bank issues the cash and a registrar records the bond. Pick a viewpoint and see which parts of the transaction reach it.');
    const V = [
      { x: 190, y: 12, t: L('DvP 结算', 'DvP settlement'), d: L('Alice 与 Bob 交换现金和债券', 'Alice and Bob swap cash for a bond'), who: ['Alice', 'Bob'] },
      { x: 20, y: 150, t: L('现金转账', 'Cash transfer'), d: 'Alice → Bob · 1,000,000 USD', who: ['Alice', 'Bob', 'Bank'], parent: 0 },
      { x: 360, y: 150, t: L('债券转让', 'Bond transfer'), d: 'Bob → Alice · 1,000 BOND', who: ['Bob', 'Alice', 'Registrar'], parent: 0 },
    ];
    const NOTE = {
      Alice: L('Alice 是整笔交易的参与方，收到全部三个视图，并校验它们。', 'Alice is a party to the whole transaction. She receives all three views and validates them.'),
      Bob: L('Bob 同样参与整笔交易，收到全部视图。', 'Bob is also a party to the whole transaction and receives every view.'),
      Bank: L('银行只参与现金那一腿。它看不到债券转让，也看不到这是一笔 DvP。', 'The bank takes part only in the cash leg. It sees neither the bond transfer nor that this is a DvP.'),
      Registrar: L('登记机构只看到债券转让。现金那一腿对它不可见。', 'The registrar sees only the bond transfer. The cash leg is hidden from it.'),
      seq: L('sequencer 给加密消息排序并投递。它知道发给谁、何时、多大，但看不到内容。', 'The sequencer orders and delivers encrypted messages. It knows who receives what, when and how large, but not the contents.'),
      med: L('mediator 看到交易的结构和谁需要确认，内容是盲化的。它汇总确认结果，宣布提交或拒绝。', 'The mediator sees the shape of the transaction and who must confirm, with the contents blinded. It collects the confirmations and announces commit or reject.'),
      pub: L('在公链上，每个验证者都收到全部内容，重新执行一遍，并保存完整的状态。', 'On a public chain every validator receives everything, re-executes it, and keeps the full state.'),
    };
    let svg, stats, note;
    function draw(name, mode) {
      const vis = [];
      V.forEach((v, i) => { vis[i] = mode === 'pub' || (mode === 'party' && (v.who.includes(name) || (v.parent != null && vis[v.parent]))); });
      const BW = 260, BH = 96;
      let s = '<svg viewBox="0 0 640 258" role="img">';
      V.forEach(v => { if (v.parent != null) { const p = V[v.parent]; s += `<line x1="${p.x + BW / 2}" y1="${p.y + BH}" x2="${v.x + BW / 2}" y2="${v.y}" stroke="${C.line2}" stroke-width="2"/>`; } });
      V.forEach((v, i) => {
        const on = vis[i];
        let l1 = v.t, l2 = v.d, l3 = v.who.join(' · ');
        if (!on && mode === 'seq') { l1 = L('密文', 'ciphertext'); l2 = `${v.who.length} ${L('个接收方', 'recipients')} · ${(0.9 + i * 0.4).toFixed(1)} kB`; l3 = L('内容不可见', 'contents hidden'); }
        else if (!on && mode === 'med') { l1 = L('已盲化', 'blinded'); l2 = L('需确认：', 'to confirm: ') + v.who.join(', '); l3 = L('内容不可见', 'contents hidden'); }
        else if (!on) { l1 = L('未送达', 'not delivered'); l2 = '■■■■■■ ■■■■ ■■'; l3 = ''; }
        s += `<rect x="${v.x}" y="${v.y}" width="${BW}" height="${BH}" rx="10" fill="${on ? C.okBg : C.panel}" stroke="${on ? C.teal : C.line2}" stroke-width="${on ? 2 : 1.5}"${on ? '' : ' stroke-dasharray="5 4"'}/>`;
        s += `<text x="${v.x + 14}" y="${v.y + 28}" font-size="15" style="fill:${on ? C.ink : C.ink3}">${l1}</text>`;
        s += `<text x="${v.x + 14}" y="${v.y + 54}" font-size="13">${l2}</text>`;
        s += `<text x="${v.x + 14}" y="${v.y + 78}" font-size="11" style="fill:${C.ink3}">${l3}</text>`;
      });
      svg.innerHTML = s + '</svg>';
      const n = vis.filter(Boolean).length;
      stats.set([
        [L('收到的视图（明文）', 'Views received in clear'), `${n} / ${V.length}`, n === V.length ? 'mid' : n ? 'good' : ''],
        [L('需要执行的部分', 'Work it re-executes'), mode === 'pub' ? L('全部', 'everything') : mode === 'party' ? L('只有自己的视图', 'only its own views') : L('无', 'nothing'), mode === 'pub' ? 'mid' : ''],
      ]);
      note.textContent = NOTE[mode === 'party' ? name : mode];
    }
    W.buttons(el, [['Alice', 'party'], ['Bob', 'party'], ['Bank', 'party'], ['Registrar', 'party'], ['Sequencer', 'seq'], ['Mediator', 'med'], [L('公链验证者', 'Public-chain validator'), 'pub']].map(([n, m]) => [n, () => draw(n, m)]), { toggle: true });
    svg = E('div'); el.appendChild(svg);
    stats = W.stats(el);
    note = E('div', 'wg-cap'); el.appendChild(note);
    draw('Alice', 'party');
  }

  // chapter 2: BFT ordering and the governance threshold with 13 SVs
  function wSVs(el) {
    const L = S.L, N = 13, F = Math.floor((N - 1) / 3), NEED = Math.ceil(N * 2 / 3);
    title(el);
    cap(el, '点击一个 SV 让它离线或恢复，也可以拖动滑块。看排序和治理投票各自在什么时候停下来。', 'Click an SV to take it offline or bring it back, or use the slider. Watch when ordering stops, and when a governance vote can no longer pass.');
    const off = new Array(N).fill(false);
    let sl;
    const box = E('div');
    const stats = W.stats(el);
    function draw() {
      const k = off.filter(Boolean).length, online = N - k, ordering = k <= F;
      let s = '<svg viewBox="0 0 640 300" role="img">';
      const cx = 190, cy = 150, R = 112;
      s += `<line x1="${cx + R + 24}" y1="${cy}" x2="470" y2="${cy}" stroke="${ordering ? C.teal : C.red}" stroke-width="2" stroke-dasharray="${ordering ? '0' : '6 5'}"/>`;
      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / N, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
        s += `<g data-i="${i}" style="cursor:pointer"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="19" fill="${off[i] ? C.badBg : C.okBg}" stroke="${off[i] ? C.red : C.teal}" stroke-width="2"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="10" text-anchor="middle" style="fill:${off[i] ? C.red : C.ink}">sv-${i + 1}</text></g>`;
      }
      s += `<text x="${cx}" y="${cy - 6}" font-size="13" text-anchor="middle" style="fill:${C.ink}">Global Synchronizer</text>`;
      s += `<text x="${cx}" y="${cy + 14}" font-size="12" text-anchor="middle" style="fill:${ordering ? C.lime : C.red}">${ordering ? L('排序正常', 'ordering') : L('排序停止', 'ordering stopped')}</text>`;
      s += `<rect x="470" y="${cy - 34}" width="160" height="68" rx="10" fill="${C.panel}" stroke="${C.line2}"/>`;
      s += `<text x="484" y="${cy - 10}" font-size="12" style="fill:${C.ink}">${L('你的验证者', 'your validator')}</text>`;
      s += `<text x="484" y="${cy + 12}" font-size="11" style="fill:${ordering ? C.ink2 : C.red}">${ordering ? L('交易照常提交', 'submitting as usual') : L('提交卡住', 'submissions stuck')}</text>`;
      box.innerHTML = s + '</svg>';
      box.querySelectorAll('[data-i]').forEach(g => g.addEventListener('click', () => { off[+g.dataset.i] = !off[+g.dataset.i]; const c = off.filter(Boolean).length; sl.input.value = c; sl.row.querySelector('.wg-v').textContent = c; draw(); }));
      stats.set([
        [L('在线的 SV', 'SVs online'), `${online} / ${N}`, ''],
        [L('排序（最多容忍 4 个故障）', `Ordering (tolerates ${F} faulty)`), ordering ? L('正常', 'running') : L('停止', 'stopped'), ordering ? 'good' : 'bad'],
        [L(`治理投票（需 ${NEED} 票赞成）`, `Governance vote (needs ${NEED} in favour)`), online >= NEED ? L('可以通过', 'can pass') : L('无法通过', 'cannot pass'), online >= NEED ? 'good' : 'bad'],
      ]);
    }
    sl = W.slider(el, { label: L('离线的 SV', 'SVs offline'), min: 0, max: N, value: 0 }, v => { off.fill(false); for (let i = 0; i < v; i++) off[(i * 5) % N] = true; draw(); });
    el.appendChild(box); el.appendChild(stats.el);
    draw();
  }

  // chapter 3: the party ID is hint + key fingerprint; a new database means a new key
  function wIdentity(el) {
    const L = S.L;
    title(el);
    cap(el, '改动 party hint，或者让节点换一个空数据库启动。观察 party ID 的哪一部分会变。', 'Edit the party hint, or start the node on an empty database. Watch which half of the party ID changes.');
    const row = E('label', 'wg-ctl', `<span class="wg-l">party hint</span>`);
    const inp = E('input'); inp.value = 'acme-validator-1'; inp.spellcheck = false;
    inp.style.cssText = `${mono}background:var(--bg);border:1px solid var(--line-2);border-radius:6px;color:var(--ink);padding:.3rem .5rem;width:100%`;
    const ok = E('b', 'wg-v'); row.appendChild(inp); row.appendChild(ok); el.appendChild(row);
    const keys = [{ fp: randHex(64), hint: inp.value }];
    let cur = 0;
    const out = E('div'); out.style.cssText = `${mono}background:#070a08;border:1px solid var(--line);border-radius:10px;padding:.8rem 1rem;word-break:break-all;line-height:1.7`;
    const stats = W.stats(el);
    function draw() {
      const h = inp.value.trim() || 'participant', k = keys[cur];
      const good = /^[A-Za-z0-9]+-[A-Za-z0-9]+-\d+$/.test(h);
      ok.textContent = good ? '✔' : '≠'; ok.style.color = good ? C.lime : C.amber;
      k.hint = h;
      const pid = (hh, fp) => `<span style="color:${C.lime}">${S.esc(hh)}</span>::<span style="color:${C.blue}">1220</span><span style="color:${C.amber}">${fp}</span>`;
      const lost = keys.filter((x, i) => i !== cur);
      out.innerHTML = `<div style="color:${C.ink3}">${L('验证者 party', 'validator party')}</div>${pid(h, k.fp)}`
        + `<div style="color:${C.ink3};margin-top:.5rem">${L('participant ID（同一把密钥）', 'participant ID (the same key)')}</div>PAR::${pid(h, k.fp)}`
        + (lost.length ? `<div style="color:${C.ink3};margin-top:.5rem">${L('这台节点已无法控制的身份', 'identities this node no longer controls')}</div>` + lost.map(x => `<div style="color:${C.red}">${S.esc(x.hint)}::1220${x.fp.slice(0, 20)}…${keys.indexOf(x) === 0 ? L('（有备份，可恢复）', ' (backed up, recoverable)') : ''}</div>`).join('') : '');
      stats.set([
        [L('hint 格式', 'Hint format'), good ? L('符合惯例', 'conventional') : L('不符合 组织-用途-序号', 'not org-function-number'), good ? 'good' : 'mid'],
        [L('生成过的命名空间密钥', 'Namespace keys generated'), String(keys.length), keys.length > 1 ? 'mid' : ''],
        [L('当前身份', 'Current identity'), cur === 0 ? L('最初的那个', 'the original') : L('新身份', 'a new one'), cur === 0 ? 'good' : 'bad'],
      ]);
    }
    inp.addEventListener('input', draw);
    W.buttons(el, [
      [L('换一个空数据库启动（删卷）', 'Start on an empty database (wipe)'), () => { keys.push({ fp: randHex(64), hint: inp.value.trim() }); cur = keys.length - 1; draw(); }],
      [L('从备份恢复数据库', 'Restore the database from backup'), () => { cur = 0; draw(); }],
    ]);
    el.appendChild(out); el.appendChild(stats.el);
    draw();
  }

  // chapter 4: rounds open every 10 minutes; a round without a record is lost
  function wRounds(el) {
    const L = S.L, R = 18, ROUND = 600, SPEED = 240, BOOT = 150;
    title(el);
    cap(el, '时间轴每格是一轮（约 10 分钟）。节点就绪时，每一轮记录一次活动。停掉节点，或者在不同的时刻重启，看哪些轮次会错过。', 'Each cell is one round, about 10 minutes. While the node is ready it records activity once per round. Stop the node, or restart it at different moments, and see which rounds are missed.');
    let t, up, readyAt, downUntil, rec;
    const reset = () => { t = 0; up = true; readyAt = 0; downUntil = null; rec = new Array(R).fill(null); };
    reset();
    const bs = W.buttons(el, [
      [L('停止节点', 'Stop node'), b => { if (up && downUntil == null) { up = false; b.textContent = L('启动节点', 'Start node'); } else { up = true; downUntil = null; readyAt = t + BOOT; b.textContent = L('停止节点', 'Stop node'); } }],
      [L('重启（停 3 分钟）', 'Restart (3 min down)'), () => { if (t >= R * ROUND) return; up = false; downUntil = t + 180; bs[0].textContent = L('停止节点', 'Stop node'); }],
      [L('重新开始', 'Start over'), () => { reset(); bs[0].textContent = L('停止节点', 'Stop node'); }],
    ]);
    const box = E('div'); el.appendChild(box);
    const stats = W.stats(el);
    const hm = s => { const m = Math.floor(s / 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    function draw() {
      const r = Math.min(R - 1, Math.floor(t / ROUND)), end = t >= R * ROUND;
      const state = !up ? (downUntil != null ? L('重启中', 'restarting') : L('已停止', 'stopped')) : t < readyAt ? L('启动中', 'starting') : L('就绪', 'ready');
      let s = '<svg viewBox="0 0 640 118" role="img">';
      for (let i = 0; i < R; i++) {
        const x = 8 + i * 35, v = rec[i];
        const fill = v === true ? C.lime : v === false ? C.red : C.panel3;
        s += `<rect x="${x}" y="22" width="31" height="40" rx="5" fill="${fill}" fill-opacity="${v == null ? 1 : 0.85}" stroke="${i === r && !end ? C.amber : C.line2}" stroke-width="${i === r && !end ? 2 : 1}"/>`;
        s += `<text x="${x + 15.5}" y="14" font-size="9" text-anchor="middle">${i + 1}</text>`;
      }
      const cx = 8 + Math.min(t, R * ROUND) / ROUND * 35;
      s += `<line x1="${cx.toFixed(1)}" y1="18" x2="${cx.toFixed(1)}" y2="70" stroke="${C.ink}" stroke-width="1.5"/>`;
      s += `<rect x="8" y="80" width="${R * 35 - 4}" height="10" rx="3" fill="${C.panel3}"/>`;
      s += `<text x="8" y="110" font-size="11">${hm(Math.min(t, R * ROUND))} · ${L('节点', 'node')}: ${state}</text>`;
      s += `<text x="632" y="110" font-size="11" text-anchor="end">${end ? L('三小时结束', 'three hours done') : L('1 秒 ≈ 4 分钟', '1 s ≈ 4 min')}</text>`;
      (draw.seg || []).forEach(([a, b2, c]) => { s += `<rect x="${(8 + a / ROUND * 35).toFixed(1)}" y="80" width="${Math.max(0.5, (b2 - a) / ROUND * 35).toFixed(1)}" height="10" fill="${c}"/>`; });
      box.innerHTML = s + '</svg>';
      const nr = rec.filter(x => x === true).length, nm = rec.filter(x => x === false).length;
      stats.set([[L('记录了活动的轮次', 'Rounds recorded'), String(nr), 'good'], [L('错过的轮次', 'Rounds missed'), String(nm), nm ? 'bad' : ''], [L('节点状态', 'Node'), state, up && t >= readyAt ? 'good' : 'mid']]);
    }
    draw.seg = [];
    W.loop(dt => {
      if (t >= R * ROUND) { if (draw.last !== 'end') { draw.last = 'end'; draw(); } return; }
      draw.last = '';
      const t0 = t; t = Math.min(R * ROUND, t + dt * SPEED);
      if (t0 === 0) draw.seg = [];
      if (downUntil != null && t >= downUntil) { up = true; readyAt = downUntil + BOOT; downUntil = null; }
      const ready = up && t >= readyAt;
      const segc = !up ? C.red : !ready ? C.amber : C.lime;
      const last = draw.seg[draw.seg.length - 1];
      if (last && last[2] === segc && Math.abs(last[1] - t0) < 1e-6) last[1] = t; else draw.seg.push([t0, t, segc]);
      const r = Math.floor(t / ROUND);
      for (let k = 0; k < Math.min(r, R); k++) if (rec[k] === null) rec[k] = false;
      if (r < R && ready && rec[r] === null) rec[r] = true;
      draw();
    });
    draw();
  }

  // chapter 5: base rate, extra traffic and automated top-ups over three hours
  function wTraffic(el) {
    const L = S.L, BURST = 400000, WINDOW = 1200, MIN = 200000, CC_PER_MB = 375, START = 300000, HOURS = 3;
    title(el);
    cap(el, '模拟三小时的 traffic。蓝线是免费基础额度，绿线是 extra traffic，红色区间是提交被拒绝的时间。本组件假设：基础额度 400,000 字节、20 分钟补满；最小充值 200,000 字节；1 MB 售价 375 CC。这些数字只用于演示，真实值由 SV 设定。', 'Three hours of traffic. The blue line is the free base rate, the green line is extra traffic, and red marks the time when submissions are rejected. The widget assumes a base rate of 400,000 bytes refilled over 20 minutes, a minimum purchase of 200,000 bytes, and a price of 375 CC per MB. These numbers are for illustration; the SVs set the real ones.');
    const p = {};
    const box = E('div');
    let stats = null, ready = false;
    function run() {
      if (!ready) return;
      let base = BURST, extra = START, wallet = p.wallet, spent = 0, buys = [], firstOut = null, rejected = 0, demand = 0, nextTop = 0;
      const pts = [], outs = [];
      const dt = 10, T = HOURS * 3600, iv = p.iv * 60, amt = Math.max(MIN, p.target * iv), cost = amt / 1e6 * CC_PER_MB;
      for (let t = 0; t <= T; t += dt) {
        if (p.target > 0 && t >= nextTop) { nextTop = t + iv; if (extra < amt && wallet >= cost) { extra += amt; wallet -= cost; spent += cost; buys.push(t); } }
        base = Math.min(BURST, base + BURST / WINDOW * dt);
        let need = p.rate * dt; demand += need;
        const a = Math.min(base, need); base -= a; need -= a;
        const b = Math.min(extra, need); extra -= b; need -= b;
        if (need > 0.5) { rejected += need; outs.push(t); if (firstOut === null) firstOut = t; }
        if (t % 60 === 0) pts.push([t, base, extra]);
      }
      const maxY = Math.max(BURST, START, ...pts.map(x => x[2])) * 1.08;
      const X = t => 44 + t / T * 586, Y = v => 190 - v / maxY * 175;
      let s = '<svg viewBox="0 0 640 214" role="img">';
      [0, 0.5, 1].forEach(f => { const v = maxY / 1.08 * f; s += `<line x1="44" x2="630" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${C.line}"/><text x="40" y="${(Y(v) + 4).toFixed(1)}" font-size="10" text-anchor="end">${v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k'}</text>`; });
      const spans = [];
      outs.forEach(t => { const l = spans[spans.length - 1]; if (l && t - l[1] <= dt) l[1] = t; else spans.push([t, t]); });
      spans.forEach(([a, b2]) => { s += `<rect x="${X(a).toFixed(1)}" y="12" width="${Math.max(1, X(b2 + dt) - X(a)).toFixed(1)}" height="178" fill="${C.red}" fill-opacity="0.18"/>`; });
      s += `<polyline fill="none" stroke="${C.blue}" stroke-width="2" points="${pts.map(x => `${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(' ')}"/>`;
      s += `<polyline fill="none" stroke="${C.lime}" stroke-width="2" points="${pts.map(x => `${X(x[0]).toFixed(1)},${Y(x[2]).toFixed(1)}`).join(' ')}"/>`;
      buys.forEach(t => { s += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="190" y2="198" stroke="${C.amber}" stroke-width="2"/>`; });
      for (let h = 0; h <= HOURS; h++) s += `<text x="${X(h * 3600).toFixed(1)}" y="210" font-size="10" text-anchor="middle">${h}h</text>`;
      box.innerHTML = s + '</svg>';
      const hm = t => `${Math.floor(t / 3600)}h ${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}m`;
      stats.set([
        [L('第一次被拒绝', 'First rejection'), firstOut === null ? L('三小时内没有', 'none in 3 h') : hm(firstOut), firstOut === null ? 'good' : 'bad'],
        [L('自动充值次数', 'Automated top-ups'), String(buys.length), ''],
        [L('花费的 CC', 'CC spent'), spent.toFixed(0), ''],
        [L('被拒绝的需求', 'Demand rejected'), `${(rejected / Math.max(1, demand) * 100).toFixed(0)}%`, rejected ? 'bad' : 'good'],
      ]);
    }
    W.slider(el, { label: L('提交速率（B/s）', 'Submission rate (B/s)'), min: 0, max: 1500, step: 50, value: 600 }, v => { p.rate = v; run(); });
    W.slider(el, { label: L('目标吞吐量（B/s）', 'Target throughput (B/s)'), min: 0, max: 3000, step: 100, value: 0, fmt: v => v ? String(v) : L('关', 'off') }, v => { p.target = v; run(); });
    W.slider(el, { label: L('最短充值间隔', 'Min top-up interval'), min: 1, max: 30, step: 1, value: 10, fmt: v => `${v} min` }, v => { p.iv = v; run(); });
    W.slider(el, { label: L('钱包余额', 'Wallet'), min: 0, max: 1000, step: 25, value: 300, fmt: v => `${v} CC` }, v => { p.wallet = v; run(); });
    el.appendChild(box);
    stats = W.stats(el);
    p.rate = 600; p.target = 0; p.iv = 10; p.wallet = 300; ready = true;
    run();
  }

  // chapter 6: the quorum version is the highest one at least 2/3 of the SVs have reached
  function wQuorum(el) {
    const L = S.L, N = 13, NEED = Math.ceil(N * 2 / 3), VERS = ['0.8.2', '0.8.3', '0.8.4'];
    title(el);
    cap(el, '点击一个 SV 切换它运行的版本，或选一个预设。GitHub 上最新的发布是 0.8.4。再选你的节点运行的版本，看结论。', 'Click an SV to change the version it runs, or pick a preset. The newest release on GitHub is 0.8.4. Then choose what your node runs and read the verdict.');
    const PRE = {
      a: [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      b: [2, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1],
      c: [2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 1, 2, 2],
    };
    let sv = PRE.b.slice(), mine = 1;
    W.buttons(el, [
      [L('刚开始升级', 'Rollout begins'), () => { sv = PRE.a.slice(); draw(); }],
      [L('达到法定多数', 'Quorum reached'), () => { sv = PRE.b.slice(); draw(); }],
      [L('几乎全部升级', 'Nearly all upgraded'), () => { sv = PRE.c.slice(); draw(); }],
    ]);
    const box = E('div'); el.appendChild(box);
    W.buttons(el, VERS.map((v, i) => [L(`本节点：${v}`, `this node: ${v}`), () => { mine = i; draw(); }]), { toggle: true, selected: 1 });
    const stats = W.stats(el);
    function draw() {
      const atLeast = i => sv.filter(x => x >= i).length;
      let q = 0; for (let i = VERS.length - 1; i >= 0; i--) if (atLeast(i) >= NEED) { q = i; break; }
      let s = '<svg viewBox="0 0 640 196" role="img">';
      for (let i = 0; i < N; i++) {
        const x = 26 + i * 48;
        s += `<g data-i="${i}" style="cursor:pointer"><circle cx="${x}" cy="30" r="17" fill="${[C.panel3, C.okBg, '#24301a'][sv[i]]}" stroke="${[C.ink3, C.teal, C.lime][sv[i]]}" stroke-width="2"/><text x="${x}" y="34" font-size="9" text-anchor="middle" style="fill:${C.ink}">${VERS[sv[i]].slice(2)}</text><text x="${x}" y="62" font-size="9" text-anchor="middle">sv-${i + 1}</text></g>`;
      }
      VERS.forEach((v, i) => {
        const y = 86 + i * 34, n = atLeast(i), wdt = n / N * 400;
        s += `<text x="10" y="${y + 15}" font-size="11">≥ ${v}</text><rect x="70" y="${y}" width="400" height="20" rx="4" fill="${C.panel3}"/><rect x="70" y="${y}" width="${wdt.toFixed(1)}" height="20" rx="4" fill="${i === q ? C.lime : C.teal}" fill-opacity="${i === q ? 0.9 : 0.45}"/><text x="480" y="${y + 15}" font-size="11">${n} / ${N}${i === q ? L(' ← 法定多数', ' ← quorum') : ''}</text>`;
      });
      const lx = 70 + NEED / N * 400;
      s += `<line x1="${lx.toFixed(1)}" x2="${lx.toFixed(1)}" y1="80" y2="190" stroke="${C.amber}" stroke-dasharray="4 3"/><text x="${(lx + 4).toFixed(1)}" y="192" font-size="9" style="fill:${C.amber}">${NEED}/${N}</text>`;
      box.innerHTML = s + '</svg>';
      box.querySelectorAll('[data-i]').forEach(g => g.addEventListener('click', () => { const i = +g.dataset.i; sv[i] = (sv[i] + 1) % VERS.length; draw(); }));
      const verdict = mine < q ? [L(`落后：升级到 ${VERS[q]}`, `behind: upgrade to ${VERS[q]}`), 'bad'] : mine > q ? [L('超前：等法定多数跟上', 'ahead: wait for the quorum'), 'mid'] : [L('与法定多数一致', 'on the quorum version'), 'good'];
      stats.set([[L('法定多数版本', 'Quorum version'), VERS[q], ''], [L('GitHub 最新', 'GitHub latest'), '0.8.4', ''], [L('本节点', 'This node'), VERS[mine], ''], [L('结论', 'Verdict'), verdict[0], verdict[1]]]);
    }
    draw();
  }

  // chapter 7: what each common command keeps, recreates or destroys
  function wCommands(el) {
    const L = S.L;
    title(el);
    cap(el, '选一条命令，看它对节点的各个部分做了什么。', 'Pick a command and see what it does to each part of the node.');
    const K = L('保留', 'kept'), G = 'good', M = 'mid', B = 'bad';
    const RES = [L('容器', 'Containers'), L('.env 中的新设置', 'New settings in .env'), L('postgres 卷：密钥、party、账本', 'Postgres volume: keys, parties, ledger'), L('镜像', 'Images'), L('容器日志', 'Container logs')];
    const CMDS = [
      ['docker compose restart', [[L('原样重启', 'restarted as created'), M], [L('不生效', 'not applied'), M], [K, G], [K, G], [K, G]], L('只重启已有的容器。改过的 .env 不会被读取。', 'Restarts the existing containers. An edited .env is not read.')],
      ['docker compose up -d', [[L('按需重建', 'recreated where changed'), G], [L('生效', 'applied'), G], [K, G], [L('缺的会拉取', 'pulled if missing'), G], [L('重建的容器换新日志', 'new log for recreated ones'), G]], L('比较配置，只重建有变化的容器。改了 .env 之后应该用它。', 'Compares the configuration and recreates only what changed. Use it after editing .env.')],
      ['docker compose down && docker compose up -d', [[L('删除后重新创建', 'removed, then created'), G], [L('生效', 'applied'), G], [K, G], [K, G], [L('旧日志随容器删除', 'old logs go with the containers'), M]], L('容器全部重建，但命名卷保留，身份不受影响。', 'Every container is recreated, but the named volume stays, and the identity with it.')],
      ['docker compose down -v', [[L('删除', 'removed'), M], ['—', ''], [L('删除', 'DELETED'), B], [K, G], [L('删除', 'deleted'), M]], L('-v 连同命名卷一起删除。节点的密钥和 party 随之消失。', '-v deletes the named volume too. The node\'s keys and parties go with it.')],
      ['./stop.sh -D', [[L('删除', 'removed'), M], ['—', ''], [L('删除', 'DELETED'), B], [K, G], [L('删除', 'deleted'), M]], L('-D 的意思就是 down -v。', '-D means down -v.')],
      ['docker volume prune -a -f', [[L('不变', 'unchanged'), ''], ['—', ''], [L('栈停止时删除', 'DELETED if the stack is stopped'), B], [K, G], [K, G]], L('删除所有没有容器在用的卷。栈停着的时候，postgres 卷就在其中。', 'Deletes every volume no container uses. With the stack stopped, the postgres volume is one of them.')],
      ['docker image prune -a -f', [[L('不变', 'unchanged'), ''], ['—', ''], [K, G], [L('删除未使用的', 'unused ones deleted'), G], [K, G]], L('只删除没有容器使用的镜像，可以安全地释放空间。', 'Deletes only images no container uses. A safe way to free space.')],
      ['truncate -s 0 <container log>', [[L('不变', 'unchanged'), ''], ['—', ''], [K, G], [K, G], [L('清空，空间释放', 'emptied, space freed'), G]], L('清空正在写入的日志文件，空间立即释放。不要用 rm 删除它。', 'Empties a log that is being written and frees the space at once. Do not rm it.')],
    ];
    const box = E('div');
    const stats = W.stats(el);
    function show(i) {
      const [cmd, rows, why] = CMDS[i];
      const color = c => c === B ? C.red : c === M ? C.amber : c === G ? C.lime : C.ink2;
      box.innerHTML = `<div style="${mono}color:var(--ink);margin-bottom:.6rem">$ ${S.esc(cmd)}</div><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.35rem 1rem;font-size:.88rem">${rows.map(([v, c], k) => `<span style="color:var(--ink-2)">${RES[k]}</span><b style="${mono}color:${color(c)};text-align:right">${v}</b>`).join('')}</div><div class="wg-cap" style="margin-top:.6rem">${why}</div>`;
      const bad = rows.some(r => r[1] === B);
      stats.set([[L('节点身份', 'Node identity'), bad ? L('被删除', 'destroyed') : L('保留', 'kept'), bad ? 'bad' : 'good']]);
    }
    W.buttons(el, CMDS.map((c, i) => [S.esc(c[0]), () => show(i)]), { toggle: true });
    el.appendChild(box); el.appendChild(stats.el);
    show(0);
  }

  S.registerLesson({
    id: 'canton-basics', network: 'canton', minutes: 35,
    title: LL('Canton 验证者运维基础', 'Canton fundamentals for validator operators'),
    tagline: LL('Global Synchronizer、SV 与验证者、party 与身份、轮次与奖励、traffic、升级，以及节点的日常运维。', 'The Global Synchronizer, SVs and validators, parties and identity, rounds and rewards, traffic, upgrades, and running the node day to day.'),
    chapters: [
      {
        title: LL('Canton Network 与 Global Synchronizer', 'The Canton Network and the Global Synchronizer'),
        body: LL(
          `<p>Canton 网络由运行 Daml 合约的 <b>participant 节点</b>组成。participant 托管 party，只保存这些 party 作为利益相关方的合约。participant 之间不直接通信，消息都经过 <b>synchronizer</b> 传递。</p>
<p>synchronizer 提供两类服务。<b>sequencer</b> 给消息排定统一的顺序，并投递给接收方。<b>mediator</b> 收集每笔交易的确认，宣布结果：提交或拒绝。<b>Global Synchronizer</b> 是 Canton Network 的公共 synchronizer，它的 sequencer 和 mediator 由一组 Super Validator 运行。</p>
<p>一笔交易会按子操作拆成若干<b>视图</b>。每个 participant 只收到和它托管的 party 有关的视图，并且是为它加密的。需要确认某个视图的 party 所在的 participant 校验这个视图，再把结论发出去。没有哪个节点重新执行整笔交易。</p>
<div class="note">在公链上，每个验证者都收到每一笔交易，重新执行一遍，并保存完整的状态。Canton 按 party 划分工作和数据：节点只校验和保存与自己的 party 有关的部分。</div>`,
          `<p>Canton is a network of <b>participant nodes</b> that run Daml contracts. A participant hosts parties and stores only the contracts those parties are stakeholders in. Participants do not talk to each other directly; their messages pass through a <b>synchronizer</b>.</p>
<p>A synchronizer provides two services. <b>Sequencers</b> put messages into a single order and deliver them to the recipients. <b>Mediators</b> collect the confirmations for each transaction and announce the result: commit or reject. The <b>Global Synchronizer</b> is the public synchronizer of the Canton Network, and a set of Super Validators runs its sequencers and mediators.</p>
<p>A transaction is split into <b>views</b>, one per sub-action. Each participant receives only the views that involve the parties it hosts, encrypted for it. The participants hosting the parties that must confirm a view check that view and send their verdict. No node re-executes the whole transaction.</p>
<div class="note">On a public chain every validator receives every transaction, re-executes it and keeps the full state. Canton splits the work and the data by party: a node validates and stores only what concerns its own parties.</div>`),
        widget: wPrivacy,
        after: LL('<p>sequencer 和 mediator 都看不到交易内容。正因为如此，Global Synchronizer 可以由多家机构共同运行，而不需要让它们看到用户的数据。</p>', '<p>Neither the sequencer nor the mediator sees the contents of a transaction. That is what lets several independent organisations run the Global Synchronizer together without seeing their users\' data.</p>'),
        quiz: [
          { q: LL('在这笔 DvP 里，银行的 participant 收到什么？', 'In this DvP, what does the bank\'s participant receive?'), options: [LL('整笔交易', 'The whole transaction'), LL('只有现金转账这个视图', 'Only the cash transfer view'), LL('什么都收不到，只有一个哈希', 'Nothing but a hash'), LL('只有债券转让这个视图', 'Only the bond transfer view')], answer: 1, why: LL('银行只是现金那一腿的参与方，所以只收到那个视图。', 'The bank is a party only to the cash leg, so it receives only that view.') },
          { q: LL('Global Synchronizer 的 sequencer 对一笔交易知道些什么？', 'What does a sequencer of the Global Synchronizer learn about a transaction?'), options: [LL('全部内容，并重新执行一遍', 'All of it, and it re-executes it'), LL('什么都不知道，连接收方也不知道', 'Nothing, not even the recipients'), LL('只知道执行结果', 'Only the outcome'), LL('加密的消息，以及接收方、时间和大小', 'The encrypted messages, their recipients, timing and size')], answer: 3, why: LL('sequencer 负责排序和投递密文，它需要知道发给谁，但读不到内容。', 'The sequencer orders and delivers ciphertext. It must know the recipients but cannot read the contents.') },
        ],
      },
      {
        title: LL('Super Validator 与验证者', 'Super Validators and validators'),
        body: LL(
          `<p><b>Super Validator</b>（SV）运营 Global Synchronizer。每个 SV 运行一个 sequencer、一个 mediator、一个公布网络数据的 scan 服务，以及 SV 应用。SV 们以一个共同的 party（DSO party）行事，并通过投票决定网络事务，例如费用与 traffic 价格、使用哪些 Daml 包版本、SV 成员的增减。投票需要全体 SV 的三分之二赞成。</p>
<p>Canton 里的<b>验证者</b>是托管 party 的节点：托管它自己的验证者 party，以及它的用户的 party。它运行一个 participant 和验证者应用，通过 SV 的 sequencer 连接 Global Synchronizer，校验它的 party 参与的交易。它不给交易排序，也不参与与它无关的交易的共识，不需要质押。验证者因每一轮在线，以及给网络带来的活动而获得 Canton Coin。</p>
<p>验证者加入网络需要一个担保 SV。担保 SV 把验证者的出口 IP 加进白名单，并签发一个一次性的上线密钥。</p>
<table><tr><th>角色</th><th>运行什么</th><th>校验什么</th><th>收入来源</th></tr>
<tr><td>公链 PoS 验证者</td><td>全节点，加上质押</td><td>每一个区块</td><td>按质押比例分配的出块奖励和手续费</td></tr>
<tr><td>Canton 验证者</td><td>participant 与验证者应用</td><td>自己的 party 参与的交易</td><td>在线奖励与活动奖励</td></tr>
<tr><td>Super Validator</td><td>sequencer、mediator、scan、SV 应用</td><td>为所有消息排序；以 DSO 身份确认网络自身的交易</td><td>SV 奖励</td></tr></table>
<div class="note">"验证者"在不同的链上含义不同。在 PoS 公链上，它是给每个区块排序和校验的节点。在 Canton 上，排序由 SV 完成，验证者更接近于只校验和记录自己 party 相关交易的节点。</div>`,
          `<p><b>Super Validators</b> (SVs) operate the Global Synchronizer. Each SV runs a sequencer, a mediator, a scan service that publishes network data, and an SV app. Together the SVs act as one shared party, the DSO party, and decide network matters by vote: fees and traffic prices, which Daml package versions are in use, and who joins or leaves the SV set. A vote passes with two thirds of all SVs in favour.</p>
<p>A <b>validator</b> in Canton is a node that hosts parties: its own validator party and the parties of its users. It runs a participant and the validator app, connects to the Global Synchronizer through the SVs' sequencers, and validates the transactions its parties take part in. It does not order transactions, takes no part in consensus on other parties' transactions, and locks no stake. A validator earns Canton Coin for being live in each round and for the activity it brings to the network.</p>
<p>To join, a validator needs a sponsoring SV. The sponsor allowlists the validator's egress IP and issues a one-time onboarding secret.</p>
<table><tr><th>Role</th><th>Runs</th><th>Validates</th><th>Earns from</th></tr>
<tr><td>PoS validator on a public chain</td><td>a full node, plus stake</td><td>every block</td><td>block rewards and fees, in proportion to stake</td></tr>
<tr><td>Canton validator</td><td>participant and validator app</td><td>transactions its own parties take part in</td><td>liveness and activity rewards</td></tr>
<tr><td>Super Validator</td><td>sequencer, mediator, scan, SV app</td><td>orders all messages; confirms the network's own transactions as the DSO</td><td>SV rewards</td></tr></table>
<div class="note">"Validator" means different things on different chains. On a proof-of-stake chain it is the node that orders and checks every block. On Canton the SVs do the ordering, and a validator is closer to a node that checks and records only what involves its own parties.</div>`),
        widget: wSVs,
        after: LL('<p>排序是拜占庭容错的。13 个 SV 时，最多 4 个宕机或作恶，synchronizer 仍能继续排序；第 5 个出问题，排序就会停止。治理投票看的是全体 SV 的三分之二，所以无论有多少在线，一项投票都需要 13 票里的 9 票赞成。</p>', '<p>Ordering is Byzantine fault tolerant. With 13 SVs the synchronizer keeps ordering while up to 4 are down or faulty; a fifth failure stops it. Governance counts two thirds of all SVs, so a vote needs 9 of 13 in favour no matter how many are online.</p>'),
        quiz: [
          { q: LL('一台 Canton 验证者加入 Global Synchronizer 之前需要什么？', 'What does a Canton validator need before it can join the Global Synchronizer?'), options: [LL('质押一笔 CC', 'A stake of CC'), LL('工作量证明', 'Proof of work'), LL('一个担保 SV：把它的 IP 加进白名单，并签发上线密钥', 'A sponsoring SV that allowlists its IP and issues an onboarding secret'), LL('什么都不需要，任何人都可以直接加入', 'Nothing; anyone can join directly')], answer: 2, why: LL('验证者不质押；加入网络靠担保 SV 的白名单和一次性密钥。', 'Validators stake nothing; they join through a sponsor\'s allowlist and a one-time secret.') },
          { q: LL('13 个 SV 时，最多可以有几个离线，排序仍然继续？', 'With 13 SVs, how many can be offline while ordering continues?'), options: [LL('1 个', '1'), LL('4 个', '4'), LL('6 个', '6'), LL('12 个', '12')], answer: 1, why: LL('拜占庭容错要求 n ≥ 3f + 1，13 个节点最多容忍 4 个故障。', 'BFT needs n ≥ 3f + 1, so 13 nodes tolerate at most 4 faults.') },
        ],
      },
      {
        title: LL('party、participant 与验证者应用', 'Parties, the participant and the validator app'),
        body: LL(
          `<p>party ID 由 <code>::</code> 分成两半，例如 <code>acme-validator-1::1220a1b2…</code>。前一半是运维方选定的 <b>hint</b>；后一半是一把命名空间密钥的<b>指纹</b>，也就是拥有这个命名空间的公钥的哈希。开头的 <code>1220</code> 是 multihash 编码中表示 SHA-256 的前缀。</p>
<p>这把命名空间密钥由 participant 持有。participant 用它签署拓扑交易，把 party 绑定到自己身上；participant ID 也使用同一个指纹，形如 <code>PAR::&lt;名称&gt;::1220a1b2…</code>。hint 只是一个标签：两台节点选了同一个 hint，party ID 也不同，因为它们的密钥不同。</p>
<h3>验证者节点上运行的组件</h3>
<table><tr><th>组件</th><th>作用</th></tr>
<tr><td>participant</td><td>Canton 节点本身：密钥、party、合约，以及与 synchronizer 的通信</td></tr>
<tr><td>验证者应用</td><td>运行在 participant 之上的 Splice 应用：完成上线，持有验证者 party，提供钱包后端，并自动处理每轮的活动记录、traffic 充值等事务</td></tr>
<tr><td>postgres</td><td>两者的数据库：participant 的状态和验证者应用的状态</td></tr>
<tr><td>钱包与名称服务的网页界面、nginx</td><td>浏览器前端，以及前面的反向代理</td></tr></table>
<div class="note warn">默认情况下，participant 把私钥（包括命名空间密钥）保存在它的 postgres 数据库里，除非运维方另外配置了外部密钥管理服务。所以数据库就是节点的身份。数据库丢了又没有备份，这个 party、它的币和尚未领取的奖励就都无法再动用。</div>`,
          `<p>A party ID has two halves joined by <code>::</code>, for example <code>acme-validator-1::1220a1b2…</code>. The first half is a <b>hint</b> the operator chooses. The second half is the <b>fingerprint</b> of a namespace key: a hash of the public key that owns the namespace. The leading <code>1220</code> is the multihash prefix for a SHA-256 hash.</p>
<p>The participant holds that namespace key. It uses the key to sign the topology transactions that bind parties to it, and the participant ID carries the same fingerprint: <code>PAR::&lt;name&gt;::1220a1b2…</code>. The hint is only a label. Two nodes can choose the same hint and still get different party IDs, because their keys differ.</p>
<h3>What runs on a validator node</h3>
<table><tr><th>Component</th><th>Role</th></tr>
<tr><td>participant</td><td>The Canton node itself: keys, parties, contracts, and the connection to the synchronizer</td></tr>
<tr><td>validator app</td><td>The Splice application on top: onboarding, the validator party, the wallet backend, and automation such as per-round activity records and traffic top-ups</td></tr>
<tr><td>postgres</td><td>The databases for both: the participant's state and the validator app's state</td></tr>
<tr><td>wallet and name-service web UIs, nginx</td><td>Browser front ends and the reverse proxy in front of them</td></tr></table>
<div class="note warn">By default the participant keeps its private keys, the namespace key included, in its postgres database, unless the operator configures an external key management service. The database therefore is the node's identity. Lose it without a backup, and the party, its coin and its unclaimed rewards are out of reach.</div>`),
        widget: wIdentity,
        after: LL('<p>新的空数据库意味着新的命名空间密钥，也就是一个全新的身份，即使 hint 一字不差。旧的身份只能从数据库备份或身份备份里找回。</p>', '<p>An empty database means a new namespace key, and so a brand-new identity, even with the same hint. The old identity can only come back from a database or identity backup.</p>'),
        quiz: [
          { q: LL('两台节点都用 party hint acme-validator-1，它们的 party ID 相同吗？', 'Two nodes both use the party hint acme-validator-1. Are their party IDs the same?'), options: [LL('相同', 'Yes'), LL('不同：命名空间密钥不同，指纹也就不同', 'No: their namespace keys differ, and so do the fingerprints'), LL('只有担保 SV 相同时才相同', 'Only if they have the same sponsor'), LL('只有迁移 ID 相同时才相同', 'Only on the same migration ID')], answer: 1, why: LL('party ID 的后半段由密钥决定，hint 只是标签。', 'The second half of a party ID comes from the key; the hint is only a label.') },
          { q: LL('默认的 docker compose 部署把命名空间私钥放在哪里？', 'Where does a default docker compose deployment keep the namespace private key?'), options: [LL('postgres 数据库里', 'In the postgres database'), LL('担保 SV 那里', 'With the sponsoring SV'), LL('.env 文件里', 'In the .env file'), LL('docker 镜像里', 'In the docker image')], answer: 0, why: LL('没有配置外部密钥管理时，participant 把私钥存放在自己的数据库里。', 'Without an external key manager, the participant stores its private keys in its database.') },
        ],
      },
      {
        title: LL('Canton Coin、轮次与活动记录', 'Canton Coin, rounds and activity'),
        body: LL(
          `<p><b>Canton Coin</b>（CC）是 Global Synchronizer 的原生代币，在 Splice 代码里叫作 Amulet。新的 CC 按 <b>mining round</b> 发行：大约每 10 分钟开始一轮，每一轮的发行量分给几类奖励：SV、验证者和应用提供方。</p>
<p>验证者有两类收入。一是<b>在线奖励</b>：每一轮，验证者应用为验证者 party 写入一条活动记录，表明节点在线且已同步。二是与<b>活动</b>挂钩的奖励：验证者和应用提供方还会因为给网络带来的活动获得奖励，具体规则由 Splice 代码和网络配置决定。</p>
<p>发行曲线和各方的分配比例写在 Canton Coin 白皮书和网络配置里。按公布的安排，总发行量逐年下降，分给验证者和应用的比例逐步上升，SV 的比例随之下降。</p>
<div class="note">奖励以轮为单位。一轮结束时，如果验证者处于宕机、未同步或没有 traffic 的状态，这一轮就没有记录，这一轮的在线奖励也就没有了。错过的轮次不会事后补发。</div>`,
          `<p><b>Canton Coin</b> (CC) is the native token of the Global Synchronizer; the Splice code calls it Amulet. New CC is issued in <b>mining rounds</b>. A round opens about every 10 minutes, and each round's issuance is shared among several kinds of reward: SVs, validators and application providers.</p>
<p>A validator earns in two ways. The first is the <b>liveness reward</b>: in each round the validator app writes an activity record for the validator party, showing that the node is up and in sync. The second is tied to <b>activity</b>: validators and application providers also earn for the activity they bring to the network, under rules set by the Splice code and the network configuration.</p>
<p>The Canton Coin whitepaper and the network configuration set out the issuance curve and the split. Under the published schedule, total issuance falls year by year, and the share going to validators and applications grows while the SV share shrinks.</p>
<div class="note">The round is the unit of reward. If a validator is down, out of sync or out of traffic when a round closes, that round has no record, and its liveness reward is gone. Missed rounds are not paid later.</div>`),
        widget: wRounds,
        after: LL('<p>如果当前这一轮已经有了记录，并且节点在下一轮需要记录之前恢复，一次短暂的重启不会有任何损失。跨过轮次边界的停机，就会丢掉那一轮。这就是同步监控要比较轮次，而不是只看容器在线时间的原因。</p>', '<p>A short restart costs nothing if the current round already has its record and the node is back before the next round needs one. An outage that spans a round boundary costs that round. This is why a sync monitor compares rounds rather than container uptime.</p>'),
        quiz: [
          { q: LL('验证者宕机 25 分钟后恢复并追上了网络。错过的那几轮怎么办？', 'A validator was down for 25 minutes and is back in sync. What happens to the rounds it missed?'), options: [LL('追上之后补发', 'They are paid once it catches up'), LL('奖励没有了', 'Their rewards are lost'), LL('接下来的几轮双倍发放', 'The next rounds pay double'), LL('由担保 SV 代为补偿', 'The sponsoring SV makes them good')], answer: 1, why: LL('每一轮的记录只能在那一轮里写入，过后无法补写。', 'A round\'s record can only be written during that round.') },
          { q: LL('即使没有任何用户流量，什么也能让验证者获得 CC？', 'What earns a validator CC even with no user traffic at all?'), options: [LL('质押', 'Staking'), LL('运行一个 sequencer', 'Running a sequencer'), LL('持有 CC', 'Holding CC'), LL('每一轮写入的在线活动记录', 'The liveness activity record it writes each round')], answer: 3, why: LL('在线奖励只要求节点每一轮都在线、已同步，并成功提交记录。', 'The liveness reward only requires the node to be up, in sync, and to submit its record each round.') },
        ],
      },
      {
        title: LL('Traffic', 'Traffic'),
        body: LL(
          `<p>participant 向 Global Synchronizer 提交的每一条消息都要消耗 <b>traffic</b>，以字节计。消息越大，消耗越多；接收方越多，消耗也会相应增加，由发送方支付。</p>
<p>traffic 有两个来源。<b>基础额度</b>是免费的：每个成员有一小份额度，在几分钟到几十分钟的时间窗口里逐渐补满。额度的大小由 SV 在网络配置里设定，用于少量的日常活动。超出部分是 <b>extra traffic</b>，需要燃烧 CC 购买。价格由 SV 以每 MB 多少美元设定，按当时的 CC/美元汇率用 CC 支付，并且有最小购买量。</p>
<p>验证者应用可以自动购买 extra traffic，由两个设置控制：<b>目标吞吐量</b>（每秒字节数）和<b>最短充值间隔</b>。每到一个间隔，如果剩余的 extra traffic 不够按目标吞吐量用满一个间隔，应用就买进这个数量（不少于最小购买量），用自己钱包里的 CC 支付。目标吞吐量设为 0 就关闭了自动充值。</p>
<div class="note warn">基础额度和 extra traffic 都用完以后，sequencer 会拒绝这个节点的提交。读取照常进行，所以节点看起来是健康的，但活动记录写不进去，每一轮的奖励都会错过。任何人都可以替任何成员购买 traffic，CC 无论如何都会被燃烧。</div>`,
          `<p>Every message a participant submits to the Global Synchronizer consumes <b>traffic</b>, counted in bytes. Larger messages cost more, and more recipients add to the cost; the sender pays.</p>
<p>Traffic comes from two sources. The <b>base rate</b> is free: each member has a small allowance that refills over a window of minutes. The SVs set its size in the network configuration, and it is meant for light background activity. Anything beyond that is <b>extra traffic</b>, bought by burning CC. The SVs set the price in US dollars per megabyte; it is paid in CC at the current CC/USD rate, and there is a minimum purchase size.</p>
<p>The validator app can buy extra traffic on its own. Two settings drive it: the <b>target throughput</b> in bytes per second, and the <b>minimum top-up interval</b>. At each interval, if the extra traffic left would not last one interval at the target throughput, the app buys that amount, at least the minimum, and pays from its wallet. A target of 0 turns automated top-ups off.</p>
<div class="note warn">Once both the base rate and the extra traffic are used up, the sequencers reject the node's submissions. Reads keep working, so the node looks healthy, but its activity records fail and it misses the reward in every round. Anyone can buy traffic for any member; the CC is burned either way.</div>`),
        widget: wTraffic,
        after: LL('<p>提交速率低于基础额度的补充速度时，extra traffic 不会被动用。超过之后，extra traffic 开始消耗，自动充值至少要补上这个差额。目标吞吐量定得太低，或者充值间隔太长，只会推迟用完的时间；钱包空了，自动充值就完全停止。</p>', '<p>Below the base-rate refill speed, extra traffic is never touched. Above it, extra traffic drains, and the top-ups have to cover at least the difference. A target throughput that is too low, or an interval that is too long, only delays the moment it runs out, and an empty wallet stops the top-ups altogether.</p>'),
        quiz: [
          { q: LL('TARGET_TRAFFIC_THROUGHPUT 为 0，extra traffic 降到了零。会发生什么？', 'TARGET_TRAFFIC_THROUGHPUT is 0 and extra traffic has reached zero. What happens?'), options: [LL('验证者应用照样自动购买', 'The validator app buys more anyway'), LL('节点停止读取账本', 'The node stops reading the ledger'), LL('超出基础额度的提交被拒绝，活动记录开始失败', 'Submissions beyond the base rate are rejected, and activity records start to fail'), LL('担保 SV 自动替它充值', 'The sponsoring SV tops it up')], answer: 2, why: LL('目标为 0 时没有任何东西替它购买，只剩免费的基础额度。', 'With a target of 0 nothing buys traffic for it; only the free base rate remains.') },
          { q: LL('extra traffic 用什么支付？', 'What pays for extra traffic?'), options: [LL('从购买方钱包里燃烧的 CC', 'CC burned from the buyer\'s wallet'), LL('担保 SV 每月开出的账单', 'A monthly invoice from the sponsoring SV'), LL('之后会退还的质押 CC', 'Staked CC that is returned later'), LL('交易对手支付的 gas', 'Gas paid by the counterparties')], answer: 0, why: LL('购买 traffic 时，CC 被燃烧，traffic 记到接收方名下。', 'Buying traffic burns CC and credits the traffic to the receiving member.') },
        ],
      },
      {
        title: LL('升级与 SV 法定多数', 'Upgrades and the SV quorum'),
        body: LL(
          `<p>Splice 在 GitHub 上发布。SV 先把新版本部署到 DevNet 和 TestNet 上，再部署到 MainNet。当 SV 们实际运行了某个版本，它才算可以上主网。运维中一个实用的判断方法是：取至少三分之二的 SV scan 在 <code>/api/scan/version</code> 上报告的最高版本。</p>
<p>验证者在两个方向上都要跟着 SV 法定多数走。太旧不行：Amulet 等 Splice 应用的新 Daml 包版本，会在 SV 投票确定的日期生效。过了那个日期，旧版本的节点处理不了新的合约，写不进活动记录，也拿不到奖励，而它的容器仍然显示健康。太新也不行：领先于法定多数的版本，可能依赖网络还没有采纳的改动。</p>
<h3>小版本升级与大版本升级</h3>
<p>小版本升级只替换镜像，保留数据库：改 <code>IMAGE_TAG</code>，拉取镜像，执行 <code>docker compose up -d</code>。participant 启动时会迁移数据库结构，所以新版本一旦运行过，就不能再退回旧版本。</p>
<p>大版本升级会把网络迁移到一个新的 synchronizer 实例，<b>迁移 ID</b> 随之加一。验证者按照公布的流程把身份和状态带过去，再用新的迁移 ID 重新连接。这类升级很少发生，并且会提前很久公布。</p>`,
          `<p>Splice is released on GitHub. The SVs deploy a new release to DevNet and TestNet first, then to MainNet. A release is ready for MainNet once the SVs actually run it. A practical test operators use: take the highest version that at least two thirds of the SV scans report on <code>/api/scan/version</code>.</p>
<p>A validator has to follow the SV quorum in both directions. Too old fails: new Daml package versions for Amulet and the other Splice apps take effect on a date the SVs vote on. After that date a node on an older release cannot process the new contracts, writes no activity records and earns nothing, while its containers still look healthy. Too new fails as well: a release ahead of the quorum may depend on changes the network has not adopted yet.</p>
<h3>Minor and major upgrades</h3>
<p>A minor upgrade replaces the images and keeps the database: change <code>IMAGE_TAG</code>, pull, and run <code>docker compose up -d</code>. On start the participant migrates its database schema, so once a new release has run there is no way back to the old one.</p>
<p>A major upgrade moves the network to a new synchronizer instance and increments the <b>migration ID</b>. Validators follow a published procedure to carry their identity and state across, then reconnect with the new ID. Such upgrades are rare and announced well in advance.</p>`),
        widget: wQuorum,
        after: LL('<p>法定多数版本在升级过程中会移动。把它交给一个定时任务去计算，并在本机版本落后时告警，比靠人记得去看要可靠。</p>', '<p>The quorum version moves during a rollout. A scheduled job that computes it and alerts when the local version falls behind is more reliable than remembering to check.</p>'),
        quiz: [
          { q: LL('GitHub 上最新的是 0.8.4。13 个 SV 中，3 个报告 0.8.4，8 个报告 0.8.3，2 个报告 0.8.2。验证者应该运行哪个版本？', 'GitHub shows 0.8.4 as the latest. Of 13 SV scans, 3 report 0.8.4, 8 report 0.8.3 and 2 report 0.8.2. Which version should a validator run?'), options: [LL('0.8.4', '0.8.4'), LL('0.8.3', '0.8.3'), LL('0.8.2', '0.8.2'), LL('担保 SV 运行的那个', 'Whatever the sponsor runs')], answer: 1, why: LL('达到 0.8.3 或更高的有 11 个，超过 9 个；达到 0.8.4 的只有 3 个。', '11 SVs are at 0.8.3 or later, above the 9 needed; only 3 are at 0.8.4.') },
          { q: LL('从 0.8.3 回退到 0.8.2，为什么不能只把 IMAGE_TAG 改回去？', 'Why can you not roll back from 0.8.3 to 0.8.2 by setting IMAGE_TAG back?'), options: [LL('旧镜像已被删除', 'The old images are deleted'), LL('SV 立即封禁旧版本', 'The SVs block old versions at once'), LL('数据库结构已被 0.8.3 迁移，旧版本拒绝使用它', 'The database schema was migrated by 0.8.3, and the older release refuses it'), LL('docker 不允许降级', 'Docker forbids downgrades')], answer: 2, why: LL('数据库迁移是单向的，旧版本读不了新结构。', 'Schema migrations go one way; the older release cannot use the newer schema.') },
        ],
      },
      {
        title: LL('节点的日常运维', 'Operating a node'),
        body: LL(
          `<pre class="term-snip">/opt/splice-node/docker-compose/validator/
├── compose.yaml   服务、健康检查、postgres 卷
├── .env           镜像版本、迁移 ID、担保 SV、party hint、充值设置
├── nginx.conf
├── start.sh       按 .env 执行 docker compose up -d
└── stop.sh        docker compose down（-D 会同时删除卷）</pre>
<p>发布包里的 start.sh 也可以通过命令行参数接收担保 SV、密钥、party hint 和迁移 ID；本课程的练习把它们都写在 .env 里。</p>
<p>compose 依靠健康检查按顺序启动服务：participant 等 postgres 健康，验证者应用等 participant 健康。健康检查只回答一个问题：进程是否在响应。它看不出节点是否跟上了网络。要判断这一点，需要比较两个数：SV scan 报告的当前轮次，和本验证者最后记录活动的轮次。participant 处理事件的进度落后墙上时钟多少，是第二个信号。</p>
<h3>配置变更与备份</h3>
<ul><li><code>docker compose restart</code> 用容器创建时的设置重启它们。改过 .env 之后要执行 <code>docker compose up -d</code>，它会重建有变化的容器。</li>
<li>用 <code>pg_dump</code> 定期备份两个数据库：<code>validator</code> 和 <code>participant-&lt;迁移 ID&gt;</code>，并存放到主机以外的地方。Splice 还提供通过验证者应用导出节点身份的方法，导出结果和数据库备份放在一起。</li>
<li>给容器日志设置上限（daemon.json 里的 <code>log-opts</code>）。磁盘写满时 postgres 无法写入，节点也就停止跟进网络。</li></ul>
<div class="note warn"><code>docker compose down -v</code>、<code>./stop.sh -D</code>，以及栈停止时的 <code>docker volume prune</code>，都会删除 postgres 卷，节点的密钥和 party 随之消失。它们都不是"从头再来"的办法。</div>`,
          `<pre class="term-snip">/opt/splice-node/docker-compose/validator/
├── compose.yaml   services, health checks, the postgres volume
├── .env           image tag, migration ID, sponsor, party hint, top-up settings
├── nginx.conf
├── start.sh       docker compose up -d with the settings in .env
└── stop.sh        docker compose down  (-D also deletes the volume)</pre>
<p>The release bundle's start.sh can also take the sponsor, secret, party hint and migration ID as command-line flags; the labs in this course keep them in .env.</p>
<p>Compose uses health checks to start the services in order: the participant waits for postgres, and the validator app waits for the participant. A health check answers one question: does the process respond? It cannot tell whether the node keeps up with the network. For that, compare two numbers: the current round the SV scans report, and the last round this validator recorded activity for. How far the participant's processing trails the wall clock is a second signal.</p>
<h3>Changes and backups</h3>
<ul><li><code>docker compose restart</code> restarts the containers with the settings they were created with. After editing .env, run <code>docker compose up -d</code>, which recreates what changed.</li>
<li>Back up both databases, <code>validator</code> and <code>participant-&lt;migration id&gt;</code>, with <code>pg_dump</code> on a schedule, and store the dumps off the host. Splice also documents an export of the node identities through the validator app; keep it with the database dumps.</li>
<li>Cap the container logs (<code>log-opts</code> in daemon.json). A full disk stops postgres from writing, and the node stops following the network.</li></ul>
<div class="note warn"><code>docker compose down -v</code>, <code>./stop.sh -D</code>, and <code>docker volume prune</code> with the stack stopped all delete the postgres volume, and the node's keys and parties with it. None of them is a way to "start clean".</div>`),
        widget: wCommands,
        quiz: [
          { q: LL('六个容器都显示 healthy，这能证明节点已经同步吗？', 'All six containers report healthy. Does that prove the node is in sync?'), options: [LL('不能：要比较网络轮次和验证者最后记录的轮次，以及 participant 的处理延迟', 'No: compare the network round with the last round the validator recorded, and check the participant\'s lag'), LL('能', 'Yes'), LL('只要 nginx 健康就能', 'Only if nginx is healthy'), LL('只要重启次数为 0 就能', 'Yes, if the restart count is 0')], answer: 0, why: LL('健康检查只说明进程在响应，不说明它跟上了网络。', 'A health check shows the process responds, not that it keeps up.') },
          { q: LL('第一次启动失败后，哪条命令删除容器但保留节点身份？', 'After a failed first start, which command removes the containers but keeps the node identity?'), options: [LL('docker compose down -v', 'docker compose down -v'), LL('docker compose down', 'docker compose down'), LL('./stop.sh -D', './stop.sh -D'), LL('docker volume prune -a -f', 'docker volume prune -a -f')], answer: 1, why: LL('不带 -v 的 down 只删除容器和网络，命名卷保留。', 'down without -v removes containers and the network and keeps the named volume.') },
        ],
      },
    ],
  });

  /* ==================== step 2: run a validator ==================== */
  const F = () => S.networks.canton.helpers.fresh;
  const Q = '0.8.3';
  const node = w => F().node(w), cn = w => node(w).cn;
  // the moment the current step became current: "look at X" steps want a look taken during that step
  S.on('step', w => { if (w.scn.id === 'canton-run') w.stepAt = w.t; });
  const since = w => w.stepAt || 0;
  const svc = (w, s) => F().bySvc(node(w), s);
  const secretOk = (w, e) => {
    const s = w.chain.secrets[e.ONBOARDING_SECRET || ''];
    const m = /^https:\/\/sv\.(sv-\d+)\.example\/?$/.exec(e.SPONSOR_SV_ADDRESS || '');
    return !!s && !!m && s.node === node(w).id && s.sv === m[1] && (!s.usedBy || s.usedBy === cn(w).participantId);
  };
  const dumps = w => Object.values(node(w).fs).map(f => f.c).filter(c => typeof c === 'string' && c.includes('-- PostgreSQL database dump complete'));

  S.registerScenario({
    id: 'canton-run', network: 'canton', module: MOD, lab: 'R1', minutes: 25,
    title: LL('从零搭建一个 Splice 验证者节点', 'Build a Splice validator node from scratch'),
    tagline: LL('一台只装了 docker 的新主机，一个担保 SV，一份发布包。', 'A new host with only docker on it, a sponsoring SV, and a release bundle.'),
    learn: [
      LL('按 SV 法定多数选版本，下载并校验发布包', 'Picking the version by the SV quorum, then downloading and verifying the bundle'),
      LL('上线密钥、迁移 ID、party hint 与自动充值的配置', 'Onboarding secret, migration ID, party hint and automated top-ups'),
      LL('确认节点在记录活动，看懂 traffic，并备份数据库', 'Confirming that the node records activity, reading its traffic, and backing up the database'),
    ],
    brief: LL(
      `<p>团队要上线一台新的 Canton 验证者 <b>canton-new</b>。主机是新装的 Ubuntu，只有 docker 和 compose 插件。担保 SV 是 <b>sv-3</b>，它已经把这台主机的出口 IP 加进了白名单。</p><p>任务是把它搭成一个正常工作的 Splice 验证者：选对版本，配置好 <code>.env</code>，完成上线，确认它每一轮都在记录活动，最后做一次数据库备份。</p><p>右侧的步骤会一步步给出命令，点击命令就能放进终端。工作电脑上的 <code>~/NOTES.md</code> 记着这台主机的约定。</p>`,
      `<p>The team is bringing up a new Canton validator, <b>canton-new</b>. The host is a fresh Ubuntu install with only docker and the compose plugin. The sponsoring SV is <b>sv-3</b>, and it has already allowlisted the host's egress IP.</p><p>Build it into a working Splice validator: pick the right version, configure <code>.env</code>, complete onboarding, confirm that it records activity every round, and finish with a database backup.</p><p>The steps on the right give the commands one at a time; click a command to put it in the terminal. <code>~/NOTES.md</code> on the workstation holds the agreed settings for this host.</p>`),
    startAt: '2026-09-15T08:30:00Z',
    config: {
      fresh: true,
      svs: ['0.8.4', '0.8.3', '0.8.3', '0.8.4', '0.8.3', '0.8.3', '0.8.3', '0.8.3', '0.8.4', '0.8.3', '0.8.3', '0.8.3', '0.8.3'],
      released: ['0.8.1', '0.8.2', '0.8.3', '0.8.4'], latest: '0.8.4',
    },
    steps: [
      {
        text: LL('检查新主机：docker、磁盘，以及到 SV 的出站访问', 'Check the new host: docker, disk, and outbound access to the SVs'),
        how: LL(
          '登录新主机并切换到 root，确认 docker、compose 插件和磁盘空间都没问题。然后从这台主机向一个 SV 的 scan 查询版本：SV 的 scan 只回应白名单里的验证者 IP。',
          'Log in to the new host as root and check docker, the compose plugin and the free disk. Then ask an SV scan for its version from this host: SV scans answer only allowlisted validator IPs.'),
        cmds: [
          'ssm canton-new',
          'sudo -i',
          'docker --version',
          'docker compose version',
          'df -h',
          'curl -s https://scan.sv-3.example/api/scan/version',
        ],
        after: LL(
          '主机能连到 SV。scan 和上线接口只接受 SV 白名单里的出口 IP，这里如果返回 403，说明担保 SV 还没有把这台主机加进去。参见基础课第 2 章：验证者要先有担保 SV 才能加入网络。',
          'The host can reach the SVs. Scans and onboarding endpoints accept only egress IPs the SVs have allowlisted, so a 403 here means the sponsor has not added this host yet. See fundamentals chapter 2: a validator needs a sponsor before it can join.'),
        check: w => cn(w).seen.scan != null,
      },
      {
        text: LL('下载 SV 法定多数所运行版本的发布包', 'Download the release bundle for the version the SV quorum runs'),
        how: LL(
          '每个 SV 的 scan 都报告自己运行的 Splice 版本。多问几个，列出全部 scan，再对照 GitHub 上最新的发布。应该运行的，是 13 个 SV 中至少 9 个达到的最高版本，即 0.8.3。下载它的发布包。',
          'Each SV scan reports the Splice version it runs. Ask several, list all the scans, and compare with the newest release on GitHub. The version to run is the highest one that at least 9 of the 13 SVs have reached: 0.8.3. Download its bundle.'),
        cmds: [
          'curl -s https://scan.sv-1.example/api/scan/version',
          'curl -s https://scan.sv-2.example/api/scan/version',
          'curl -s https://scan.sv-4.example/api/scan/version',
          'curl -s https://scan.sv-3.example/api/scan/v0/scans | jq -r \'.scans[0].scans[].publicUrl\'',
          'curl -s https://api.github.com/repos/canton-network/splice/releases/latest | jq -r .tag_name',
          'curl -sSL -o 0.8.3_splice-node.tar.gz https://github.com/canton-network/splice/releases/download/0.8.3/0.8.3_splice-node.tar.gz',
        ],
        after: LL(
          '13 个 SV 里已有 3 个运行 GitHub 上最新的 0.8.4，但至少 2/3 的 SV 运行的是 0.8.3，所以验证者应该跑 0.8.3。只问一个 scan，或者只看 GitHub 的 latest，都不足以做这个判断。参见基础课第 6 章。',
          'Three of the 13 SVs already run 0.8.4, the newest release on GitHub, but at least two thirds of them run 0.8.3, so 0.8.3 is what a validator should run. One scan, or the "latest" tag on GitHub, is not enough to decide. See fundamentals chapter 6.'),
        check: w => F().haveBundle(w, Q),
      },
      {
        text: LL('校验发布包，解压到 /opt', 'Verify the bundle and unpack it to /opt'),
        how: LL(
          'GitHub 为每个发布附件公布 SHA-256 摘要。计算下载文件的摘要并比对，一致再解压到 <code>/opt</code>，然后进入 compose 目录看看里面有什么。',
          'GitHub publishes a SHA-256 digest for each release asset. Compute the digest of the downloaded file and compare. If they match, unpack it to <code>/opt</code>, then look around the compose directory.'),
        cmds: [
          'curl -s https://api.github.com/repos/canton-network/splice/releases/tags/0.8.3 | jq -r \'.assets[0].digest\'',
          'sha256sum 0.8.3_splice-node.tar.gz',
          'tar xzf 0.8.3_splice-node.tar.gz -C /opt',
          'cd /opt/splice-node/docker-compose/validator',
          'ls -a',
        ],
        after: LL(
          '发布包里有 compose 文件、.env 模板、nginx.conf 和启停脚本。.env 里的 IMAGE_TAG 已经是发布包自己的版本，镜像和 compose 文件因此是配套的。比对摘要可以发现下载不完整或被篡改的文件。',
          'The bundle holds the compose file, a .env template, nginx.conf and the start and stop scripts. IMAGE_TAG in .env already names the bundle\'s own version, so the images match the compose file. Comparing the digest catches a truncated or tampered download.'),
        check: w => cn(w).seen.sha === Q && cn(w).seen.digest === Q && (F().env(w) || {}).IMAGE_TAG === Q,
      },
      {
        text: LL('向担保 SV 申请上线密钥', 'Request an onboarding secret from the sponsoring SV'),
        how: LL(
          '担保 SV 为每台新验证者签发一个一次性的上线密钥。DevNet 上有 SV 提供自助接口；MainNet 上由担保 SV 按自己的流程发放。本练习用 sv-3 上一个虚构的接口代替这一流程，从白名单内的主机调用，把密钥存进 <code>$SECRET</code>。不要复用发给其他节点的密钥。',
          'The sponsoring SV issues a one-time onboarding secret for each new validator. On DevNet some SVs offer a self-service endpoint for this; on MainNet the sponsor issues the secret through its own process. This lab stands in for that process with a fictional endpoint on sv-3, called from the allowlisted host, and keeps the secret in <code>$SECRET</code>. Do not reuse a secret issued for another node.'),
        cmds: [
          'SECRET=$(curl -s -X POST https://sv.sv-3.example/api/sv/v0/onboard/validator/prepare)',
          'echo $SECRET',
        ],
        after: LL(
          '上线密钥只能用一次，并且会过期。它不是需要长期保管的凭据：节点上线之后，密钥就用掉了，并和这个 participant 绑定。参见基础课第 2 章。',
          'The secret works once, and it expires. It is not a credential to keep: once the node has onboarded, the secret is spent and bound to this participant. See fundamentals chapter 2.'),
        check: w => Object.values(w.chain.secrets).some(s => s.node === node(w).id),
      },
      {
        text: LL('在 .env 里填写网络设置：担保 SV、scan、迁移 ID 和密钥', 'Point .env at the network: sponsor, scan, migration ID and secret'),
        how: LL(
          '从 scan 的 sequencer 列表查当前的迁移 ID（这里是 4），然后在 .env 里填上迁移 ID、担保 SV、scan 地址和上一步拿到的密钥，最后检查结果。',
          'Look up the current migration ID in the scan\'s sequencer list (4 here). Then fill in the migration ID, the sponsor, the scan address and the secret from the previous step in .env, and check the result.'),
        cmds: [
          'curl -s https://scan.sv-3.example/api/scan/v0/dso-sequencers | jq \'.domainSequencers[0].sequencers[0].migrationId\'',
          'sed -i \'s/MIGRATION_ID=.*/MIGRATION_ID=4/\' .env',
          'sed -i \'s|SPONSOR_SV_ADDRESS=.*|SPONSOR_SV_ADDRESS=https://sv.sv-3.example|\' .env',
          'sed -i \'s|SCAN_ADDRESS=.*|SCAN_ADDRESS=https://scan.sv-3.example|\' .env',
          'sed -i "s/ONBOARDING_SECRET=.*/ONBOARDING_SECRET=$SECRET/" .env',
          'grep -v \'^#\' .env',
        ],
        after: LL(
          '迁移 ID 标识 Global Synchronizer 当前的这一代实例，只在大版本升级时改变。participant 的数据库名带着它（participant-4）。填错了，节点就找不到 sequencer。参见基础课第 6 章。',
          'The migration ID names the current incarnation of the Global Synchronizer and changes only with a major upgrade. The participant\'s database name carries it (participant-4). With a wrong value the node cannot find the sequencers. See fundamentals chapter 6.'),
        check: w => {
          const e = F().env(w) || {};
          return String(e.MIGRATION_ID) === String(w.chain.migrationId) && /^https:\/\/scan\.sv-\d+\.example\/?$/.test(e.SCAN_ADDRESS || '') && secretOk(w, e);
        },
      },
      {
        text: LL('选定 party hint，打开自动充值', 'Set the party hint and turn on automated traffic top-ups'),
        how: LL(
          'party hint 会成为验证者 party ID 中可读的那一半，上线之后不能再改。使用约定好的 <code>acme-validator-1</code>，并把自动充值的目标吞吐量设为每秒 2000 字节。',
          'The party hint becomes the readable half of the validator party ID, and it cannot be changed after onboarding. Use the agreed hint, <code>acme-validator-1</code>, and set the top-up target throughput to 2000 bytes per second.'),
        cmds: [
          'sed -i \'s/PARTY_HINT=.*/PARTY_HINT=acme-validator-1/\' .env',
          'sed -i \'s/TARGET_TRAFFIC_THROUGHPUT=.*/TARGET_TRAFFIC_THROUGHPUT=2000/\' .env',
          'grep -E \'PARTY_HINT|TRAFFIC|TOPUP\' .env',
        ],
        after: LL(
          'party hint 的惯例格式是 &lt;组织&gt;-&lt;用途&gt;-&lt;序号&gt;。TARGET_TRAFFIC_THROUGHPUT 大于 0 时，验证者应用会自己购买 extra traffic，用钱包里的 CC 支付；设为 0 就没有任何东西替它补充。参见基础课第 3 章和第 5 章。',
          'The usual party hint format is &lt;organization&gt;-&lt;function&gt;-&lt;enumerator&gt;. With TARGET_TRAFFIC_THROUGHPUT above 0 the validator app buys extra traffic on its own and pays in CC from its wallet; at 0 nothing tops it up. See fundamentals chapters 3 and 5.'),
        check: w => { const e = F().env(w) || {}; return /^[A-Za-z0-9]+-[A-Za-z0-9]+-\d+$/.test(e.PARTY_HINT || '') && +e.TARGET_TRAFFIC_THROUGHPUT > 0; },
      },
      {
        text: LL('用 docker compose 启动节点，看着容器起来', 'Start the node with docker compose and watch the containers come up'),
        how: LL(
          'compose 会拉取镜像，按顺序启动六个容器：先是 postgres；postgres 健康之后启动 participant；participant 健康之后启动验证者应用。启动后查看进度。',
          'Compose pulls the images and starts the six containers in order: postgres first, the participant once postgres is healthy, and the validator app once the participant is healthy. Check the progress after starting.'),
        cmds: [
          'docker compose up -d',
          'docker compose ps',
        ],
        after: LL(
          'compose 创建了命名卷 splice-validator_postgres-splice。participant 第一次启动时发现数据库是空的，就在里面生成了自己的命名空间密钥。从这一刻起，这个卷保存着节点的身份。参见基础课第 3 章和第 7 章。',
          'Compose created the named volume splice-validator_postgres-splice. On its first start the participant found an empty database and generated its namespace key in it. From this moment the volume holds the node identity. See fundamentals chapters 3 and 7.'),
        check: w => F().allUp(w) && F().healthy(svc(w, 'postgres-splice')) && F().healthy(svc(w, 'participant')),
      },
      {
        text: LL('看验证者应用完成上线', 'Watch the validator app onboard the participant'),
        how: LL(
          '验证者应用带着密钥联系担保 SV，SV 在 synchronizer 上授权这个 participant，应用随后分配验证者 party。读两个容器的日志，等六个容器全部 healthy。上线失败时日志会写明原因：改好 .env 再执行 <code>docker compose up -d</code>，不要删除卷。',
          'The validator app contacts the sponsor with the secret, the SV authorizes the participant on the synchronizer, and the app allocates the validator party. Read both logs and wait until all six containers are healthy. If onboarding fails, the log says why: fix .env and run <code>docker compose up -d</code> again. Do not delete the volume.'),
        cmds: [
          'docker logs --tail 20 splice-validator-validator-1',
          'docker logs --tail 5 splice-validator-participant-1',
          'docker compose ps',
        ],
        wait: 180,
        after: LL(
          '每个身份只上线一次。担保 SV 已经在 Global Synchronizer 上授权了这个 participant，密钥随之用掉。验证者应用要等上线完成才报告 healthy。',
          'Onboarding happens once per identity. The sponsor has authorized this participant on the Global Synchronizer, and the secret is now spent. The validator app reports healthy only after onboarding has completed.'),
        check: w => cn(w).onboarded && F().allHealthy(w),
      },
      {
        text: LL('读出验证者的 party ID', 'Read the validator party ID'),
        how: LL(
          '从验证者应用的日志里取出分配的 party ID，存进 <code>$PARTY</code>。<code>::</code> 前面是 .env 里的 hint，后面是 participant 命名空间密钥的指纹。',
          'Take the allocated party ID from the validator app log and keep it in <code>$PARTY</code>. The part before <code>::</code> is the hint from .env; the part after it is the fingerprint of the participant\'s namespace key.'),
        cmds: [
          'PARTY=$(docker logs splice-validator-validator-1 | grep "Allocated validator" | sed \'s/.*party //\')',
          'echo $PARTY',
        ],
        after: LL(
          '两台节点即使用同一个 hint，party ID 也不同，因为它们的命名空间密钥不同。这把密钥存放在 postgres 数据库里，所以数据库就是节点的身份。参见基础课第 3 章。',
          'Two nodes with the same hint still get different party IDs, because their namespace keys differ. That key is stored in the postgres database, which is why the database is the node\'s identity. See fundamentals chapter 3.'),
        check: w => cn(w).onboarded && cn(w).seen.party >= since(w),
      },
      {
        text: LL('确认验证者在当前轮次记录了活动', 'Confirm that the validator records activity in the current round'),
        how: LL(
          '判断验证者是否跟上，要看两个数：scan 报告的网络当前轮次，和网络看到的本验证者最后记录活动的轮次（lastCollectedInRound）。列表为空说明还没有记录过任何一轮；新的一轮大约每 10 分钟开始一次，等一轮再查。',
          'Whether a validator keeps up comes down to two numbers: the round the network is in, from a scan, and the last round the network saw this validator record activity for (lastCollectedInRound). An empty list means no round has been recorded yet; a new round opens about every 10 minutes, so wait for one and query again.'),
        cmds: [
          'curl -s https://scan.sv-3.example/api/scan/v0/round-of-latest-data',
          'curl -s "https://scan.sv-3.example/api/scan/v0/validators/validator-faucets?validator_ids=$PARTY" | jq',
        ],
        wait: 600,
        after: LL(
          '同步监控做的就是这个比较：SV scan 报告的网络轮次，对比验证者最后记录的轮次。容器健康检查看不出这一点。每记录一轮就有一份活跃奖励；节点停机期间错过的轮次无法补回。参见基础课第 4 章和第 7 章。',
          'This is the comparison a sync monitor makes: the network round from the SV scans against the round the validator last recorded. Container health checks cannot show it. Each recorded round earns a liveness reward, and a round missed while the node is down cannot be made up. See fundamentals chapters 4 and 7.'),
        check: w => cn(w).recorded >= 1 && F().synced(w, node(w)) && cn(w).seen.faucet >= since(w),
      },
      {
        text: LL('查看 traffic：基础额度、extra traffic 和自动充值', 'Check traffic: the base rate, extra traffic and the top-up setting'),
        how: LL(
          '验证者应用的日志里，第一条 traffic 行是它实际使用的充值设置；TopupMemberTrafficTrigger 的几行给出剩余的 extra traffic、免费的基础额度，以及为什么还没有购买。再确认运行中的容器拿到了这个设置。',
          'In the validator app log, the first traffic line shows the top-up settings the app runs with. The TopupMemberTrafficTrigger lines show the extra traffic left, the free base-rate allowance, and why nothing has been bought yet. Then confirm the running container has the setting.'),
        cmds: [
          'docker logs splice-validator-validator-1 | grep -i traffic',
          'docker inspect splice-validator-validator-1 | grep TARGET',
        ],
        after: LL(
          '新验证者的钱包是空的，也没有 extra traffic。在这个练习里，它最初的提交，包括每一轮的活动记录，都在免费的基础额度之内。活跃奖励逐渐充实钱包，够买一次的时候，应用就按目标吞吐量购买 extra traffic。参见基础课第 5 章。',
          'A new validator starts with an empty wallet and no extra traffic. In this lab its first submissions, including the per-round activity records, fit within the free base rate. Liveness rewards fill the wallet, and once it holds enough CC for one purchase the app buys extra traffic at the target throughput. See fundamentals chapter 5.'),
        check: w => F().running(svc(w, 'validator')) && F().topupTarget(svc(w, 'validator')) > 0 && cn(w).seen.traffic >= since(w),
      },
      {
        text: LL('备份数据库并检查备份', 'Back up the databases and check the backup'),
        how: LL(
          'postgres 容器里有两个数据库：validator，以及按迁移 ID 命名的 participant-4。把两个都导出到主机上的 <code>/root/backups</code>，然后检查文件大小和导出的表。',
          'The postgres container holds two databases: validator, and participant-4, named after the migration ID. Dump both to <code>/root/backups</code> on the host, then check the file sizes and the tables in the dump.'),
        cmds: [
          'mkdir -p /root/backups',
          'docker exec splice-validator-postgres-splice-1 pg_dump -U cnadmin validator > /root/backups/validator.sql',
          'docker exec splice-validator-postgres-splice-1 pg_dump -U cnadmin participant-4 > /root/backups/participant-4.sql',
          'ls -l /root/backups',
          'grep COPY /root/backups/participant-4.sql',
        ],
        after: LL(
          '和节点放在同一块磁盘上的备份，扛不住整台主机的损失。要定期把导出文件复制到别处，并像保管密钥一样保管它们：participant 的导出里包含节点的私钥。Splice 还提供通过验证者应用导出节点身份的方法，导出结果应和数据库备份放在一起。参见基础课第 7 章。',
          'A backup on the node\'s own disk does not survive the loss of the host. Copy the dumps elsewhere on a schedule and guard them like keys: the participant dump contains the node\'s private keys. Splice also documents an export of the node identities through the validator app; keep it with the database backups. See fundamentals chapter 7.'),
        check: w => {
          const c = cn(w), d = dumps(w);
          return c.onboarded && d.some(x => x.includes('COPY public.store_descriptors') && x.includes(c.party)) && d.some(x => x.includes('COPY public.common_node_id') && x.includes(c.ns));
        },
      },
    ],
    forbidden: [
      { flag: 'ahead_of_quorum', text: LL('用 SV 法定多数尚未采纳的 Splice 版本启动节点', 'Starting the node on a Splice release the SV quorum has not adopted') },
      { flag: 'wipe_db', text: LL('participant 生成身份之后删除 postgres 卷（docker compose down -v、./stop.sh -D、docker volume rm/prune、rm）', 'Deleting the postgres volume after the participant has generated its identity (docker compose down -v, ./stop.sh -D, docker volume rm/prune, rm)') },
    ],
    limit: 8 * 3600,
    score: w => {
      const c = cn(w);
      return [
        [LL('记录了活动的轮次', 'Rounds with an activity record'), String(c.recorded), c.recorded > 0 ? 'good' : 'bad'],
        [LL('上线后错过的轮次', 'Rounds missed after onboarding'), String(c.missed), c.missed === 0 ? 'good' : c.missed <= 2 ? 'mid' : 'bad'],
        [LL('节点身份', 'Node identity'), c.identityLost || w.flags.wipe_db !== undefined ? LL('曾被删除', 'deleted once') : LL('完好', 'intact'), c.identityLost || w.flags.wipe_db !== undefined ? 'bad' : 'good'],
      ];
    },
    debrief: LL(
      '这台节点从一个空主机走到了正常记录活动，中间的每个决定都对应基础课里的一个概念。版本由 SV 法定多数决定：GitHub 上最新的发布，可能还没有被足够多的 SV 采纳。上线需要担保 SV 的白名单和一次性密钥。party ID 的后半段是命名空间密钥的指纹，而这把密钥在 participant 第一次启动时就写进了 postgres 卷。</p><p>两个常见的错误都发生在第一次启动前后。一是直接用最新的发布启动，跑在 SV 法定多数前面。二是第一次启动失败后用 <code>docker compose down -v</code> "从头再来"：失败的原因通常在 .env 里，删卷解决不了它，只会把 participant 已经生成的身份一起删掉；如果节点已经上线，原来的 party、它的 CC 和奖励都会失去控制，用过的密钥也不能再用。正确的做法是读日志，改 .env，再执行 <code>docker compose up -d</code>。</p><p>节点运行起来以后，要持续确认三件事：每一轮都有活动记录，traffic 有来源，数据库备份在主机之外。',
      'This node went from an empty host to recording activity, and each decision on the way maps to a concept from the fundamentals. The SV quorum decides the version: the newest release on GitHub may not yet be adopted by enough SVs. Onboarding needs the sponsor\'s allowlist and a one-time secret. The second half of the party ID is the fingerprint of the namespace key, and the participant wrote that key into the postgres volume on its first start.</p><p>Two common mistakes happen around the first start. One is starting on the newest release and running ahead of the SV quorum. The other is answering a failed first start with <code>docker compose down -v</code> to "start clean". The cause of the failure is usually in .env, and deleting the volume does not fix it; it only deletes the identity the participant has already generated. If the node had already onboarded, the old party, its CC and its rewards are out of reach, and the spent secret cannot be used again. Read the log, fix .env, and run <code>docker compose up -d</code> again.</p><p>Once the node runs, keep confirming three things: every round has an activity record, traffic has a source, and the database backups live off the host.'),
  });
})(SIM);
