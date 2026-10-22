/* ============================================================
   Solana, steps 1 and 2, for the cluster as it runs today (Alpenglow).
   Step 1: "Solana fundamentals for validator operators", seven
   chapters with widgets and quizzes.
   Step 2: lab R1, a guided build of a testnet validator on a new
   Ubuntu host (the plugin's cfg.fresh mode), through BLS
   registration, the admission ticket and the first epoch in the set.
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL, L = S.L;
  const E = (tag, cls, html) => S.wg.el(tag, cls, html);
  const title = el => el.appendChild(E('div', 'wg-title', L('动手试试', 'Try it')));
  const cap = (el, zh, en) => el.appendChild(E('div', 'wg-cap', L(zh, en)));
  const fmt = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const dur = sec => (sec === Infinity ? '∞' : sec >= 86400 * 2 ? L(`${fmt(sec / 86400, 1)} 天`, `${fmt(sec / 86400, 1)} days`) : sec >= 3600 ? L(`${fmt(sec / 3600, 1)} 小时`, `${fmt(sec / 3600, 1)} h`) : sec >= 60 ? L(`${fmt(sec / 60, 1)} 分钟`, `${fmt(sec / 60, 1)} min`) : L(`${fmt(sec, 1)} 秒`, `${fmt(sec, 1)} s`));
  const EPOCH = 432000, TICKET = 0.8, RENT = 0.02685864, ADMIT = TICKET + RENT;
  const C = { lime: '#b6f23a', amber: '#f5a623', red: '#ff6b57', blue: '#7cc4ff', ink2: '#b9c7b4', ink3: '#7f9180', line: '#34413a', panel: '#161e1a', bg: '#0b0f0d' };

  /* ---------- chapter widgets ---------- */

  // 1. slot clock: leader schedule strip, epoch progress, adjustable speed and slot time
  function slotClock(el) {
    title(el);
    const NAMES = ['Kite', 'Orca', 'Lynx', 'Puma', 'Wren', 'Ibis', L('你', 'you')];
    const WEIGHT = [22, 18, 15, 13, 11, 9, 4], COL = ['#7cc4ff', '#f5a623', '#c792ea', '#ff8a7a', '#5fd3bc', '#e6db74', C.lime];
    const hash = (a, b) => { let h = (Math.imul(a, 2654435761) ^ Math.imul(b, 40503)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const leader = s => { const r = hash(Math.floor(s / 4), Math.floor(s / EPOCH) + 11); let acc = 0; for (let i = 0; i < 7; i++) { acc += WEIGHT[i] / 92; if (r < acc) return i; } return 6; };
    let slotMs = 200, speed = 1, s = 1124 * EPOCH + 429600, msg = '';
    S.wg.buttons(el, [[L('现在：200 ms', 'today: 200 ms'), () => { slotMs = 200; }], [L('2026 年之前：400 ms', 'before 2026: 400 ms'), () => { slotMs = 400; }]], { toggle: true });
    const SPEEDS = [1, 10, 100, 1000, 10000];
    S.wg.slider(el, { label: L('速度', 'Speed'), min: 0, max: 4, value: 0, fmt: v => `${SPEEDS[v]}×` }, v => { speed = SPEEDS[v]; });
    const svg = E('div'); el.appendChild(svg);
    const meter = E('div'); el.appendChild(meter);
    const st = S.wg.stats(el);
    const note = E('div', 'wg-cap'); el.appendChild(note);
    cap(el, '每种颜色代表一个 leader，每个 leader 连续拿到 4 个 slot。质押越多，轮到的次数越多。"你"的质押很少，所以很少轮到。', 'Each colour is one leader, and each leader gets four consecutive slots. More stake means more turns. "You" have little stake and lead rarely.');
    const draw = () => {
      const cur = Math.floor(s), w0 = Math.floor(cur / 4) * 4, frac = s - cur;
      let g = '';
      for (let i = 0; i < 24; i++) {
        const sl = w0 + i, li = leader(sl), x = 6 + i * 24.5, on = sl === cur, past = sl < cur;
        g += `<rect x="${x}" y="22" width="22" height="26" rx="3" fill="${COL[li]}" opacity="${past ? 0.25 : on ? 1 : 0.55}" ${on ? `stroke="#e8f0e4" stroke-width="2"` : ''}/>`;
        if (on) g += `<rect x="${x}" y="50" width="${22 * frac}" height="3" fill="#e8f0e4"/>`;
        if (sl % 4 === 0) g += `<text x="${x}" y="15" font-size="10" fill="${COL[li]}">${NAMES[li]}</text><text x="${x}" y="66" font-size="9">${String(sl % 100000).padStart(5, '0')}</text>`;
      }
      svg.innerHTML = `<svg viewBox="0 0 600 72" role="img" aria-label="leader schedule">${g}</svg>`;
      const idx = cur % EPOCH, left = (EPOCH - idx) * slotMs / 1000;
      meter.innerHTML = `<div class="wg-cap" style="margin-bottom:.3rem">${L(`epoch ${Math.floor(cur / EPOCH)} 进度`, `epoch ${Math.floor(cur / EPOCH)} progress`)} · ${fmt(idx / EPOCH * 100, 2)}%</div>${S.wg.meter(idx / EPOCH * 100)}`;
      st.set([
        ['slot', cur.toLocaleString('en-US'), ''],
        [L('epoch 内序号', 'slot in epoch'), `${idx.toLocaleString('en-US')} / 432,000`, ''],
        [L('epoch 剩余（真实时间）', 'epoch ends in (real time)'), dur(left), ''],
        [L('epoch 总长', 'epoch length'), dur(EPOCH * slotMs / 1000), slotMs === 200 ? 'good' : ''],
        [L('当前 leader', 'leader now'), NAMES[leader(cur)], leader(cur) === 6 ? 'good' : ''],
      ]);
      note.textContent = msg;
    };
    S.wg.loop(dt => {
      const before = Math.floor(s / EPOCH);
      s += dt * 1000 / slotMs * speed;
      if (Math.floor(s / EPOCH) !== before) msg = L(`epoch ${Math.floor(s / EPOCH)} 开始。它的 leader 表在上一个 epoch 就已按质押算好；质押变动在此刻生效，各 vote account 也在此刻支付准入费。`, `Epoch ${Math.floor(s / EPOCH)} began. Its leader schedule was computed from stake during the previous epoch. Stake changes take effect now, and each vote account pays its admission ticket now.`);
      draw();
    });
    draw();
  }

  // 2. keys: which key signs what, and what a stolen key costs
  function keyMap(el) {
    title(el);
    const BOX = {
      id: [24, 46, 172, 46, L('identity keypair', 'identity keypair'), L('签名；BLS 公钥由它派生', 'signs; BLS key derived')],
      vkp: [24, 130, 172, 46, L('vote account keypair', 'vote account keypair'), L('只在创建时用一次', 'used once, at creation')],
      vacct: [236, 46, 168, 46, L('vote account', 'vote account'), L('准入费、credits、佣金', 'ticket, credits, commission')],
      iacct: [236, 130, 168, 46, L('identity 账户', 'identity account'), L('出块收入、交易手续费', 'block revenue, tx fees')],
      wd: [444, 46, 172, 46, L('authorized withdrawer', 'authorized withdrawer'), L('离线保存', 'kept offline')],
    };
    const ACT = [
      [L('发出一票', 'Send a vote'), ['id'], ['vacct'], L('identity 默认就是 authorized voter。投票是直接发给其他验证者的消息，不是交易，不付手续费。许多验证者的票用 BLS 签名聚合成一张证书。', 'The identity is the default authorized voter. A vote is a message sent straight to other validators, not a transaction, and it pays no fee. Votes from many validators are aggregated into one certificate with BLS signatures.')],
      [L('登记 BLS 公钥', 'Register the BLS key'), ['id'], ['vacct'], L('vote-authorize-voter-checked 由 authorized voter 签名，把由它派生的 BLS 公钥写进 vote account，voter 本身不变。', 'vote-authorize-voter-checked, signed by the authorized voter, writes the BLS key derived from it into the vote account. The voter itself does not change.')],
      [L('支付准入费', 'Pay the admission ticket'), [], ['vacct'], L('没有人签名。每到 epoch 边界，运行时直接从 vote account 扣除准入费。', 'Nobody signs. At every epoch boundary the runtime debits the ticket from the vote account.')],
      [L('给 vote account 充值', 'Refill the vote account'), ['id'], ['vacct'], L('一笔普通转账，任何钥匙都可以付款。运维常从 identity 转。', 'A plain transfer, which any key can pay for. Operators often send from the identity.')],
      [L('出块', 'Produce a block'), ['id'], ['iacct'], L('轮到 leader 时用 identity 签名出块。出块收入默认进入 identity 账户，也可以改为进入 vote account。', 'As leader, the identity signs the block. Block revenue goes to the identity account by default, and can be redirected to the vote account.')],
      [L('修改佣金', 'Change commission'), ['wd'], ['vacct'], L('只有 withdrawer 能改佣金，而且只能在 epoch 的前半段改。', 'Only the withdrawer can change the commission, and only in the first half of an epoch.')],
      [L('从 vote account 取款', 'Withdraw from the vote account'), ['wd'], ['vacct'], L('只有 withdrawer 能把钱取出。取得太多，下一个边界就付不起准入费。', 'Only the withdrawer can take SOL out. Take too much, and the next boundary finds the ticket unpaid.')],
      [L('换一个 identity', 'Assign a new identity'), ['wd'], ['vacct'], L('vote-update-validator 需要 withdrawer（和新 identity）签名。identity 泄露后就靠它换掉。', 'vote-update-validator needs the withdrawer (and the new identity). This is how a leaked identity is replaced.')],
    ];
    const HIT = [
      [L('identity 被盗', 'Identity stolen'), ['id'], ['iacct'], L('攻击者能转走 identity 余额，还能在别处用你的 identity 运行验证者，造成双签。损失有限：用 withdrawer 给 vote account 换一个新 identity 即可。', 'The attacker can drain the identity balance and run your identity elsewhere, which means double voting. The damage is bounded: the withdrawer assigns a new identity to the vote account.')],
      [L('withdrawer 被盗', 'Withdrawer stolen'), ['wd'], ['vacct'], L('攻击者能取走 vote account 里的钱，把佣金改成 100%，再把 withdrawer 换成自己的。控制权从此丢失，无法恢复。', 'The attacker can empty the vote account, set the commission to 100% and replace the withdrawer with their own. Control is lost for good.')],
      [L('vote account keypair 被盗', 'Vote account keypair stolen'), ['vkp'], [], L('没有影响。账户创建之后，这把钥匙没有任何权限。', 'Nothing happens. Once the account exists, this keypair has no authority.')],
    ];
    let sel = { sign: ['id'], hit: ['vacct'], bad: false, text: ACT[0][3] };
    const svg = E('div'); el.appendChild(svg);
    const info = E('div', 'wg-cap'); info.style.minHeight = '2.8em'; info.style.color = 'var(--ink-2)';
    const draw = () => {
      const zone = (x, t) => `<rect x="${x}" y="8" width="${x === 216 ? 208 : 192}" height="190" rx="10" fill="none" stroke="${C.line}" stroke-dasharray="4 4"/><text x="${x + 10}" y="26" font-size="11" fill="${C.ink3}">${t}</text>`;
      const box = k => {
        const [x, y, w, h, t, sub] = BOX[k], on = sel.sign.includes(k), hit = sel.hit.includes(k);
        const stroke = on ? (sel.bad ? C.red : C.lime) : hit ? C.amber : C.line;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${hit ? 'rgba(245,166,35,.12)' : C.panel}" stroke="${stroke}" stroke-width="${on || hit ? 2.5 : 1}" ${k === 'vkp' ? 'stroke-dasharray="5 3"' : ''}/><text x="${x + 10}" y="${y + 20}" font-size="12" fill="#e8f0e4">${t}</text><text x="${x + 10}" y="${y + 36}" font-size="10" fill="${C.ink3}">${sub}</text>`;
      };
      const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.ink3}" stroke-width="1.2" marker-end="url(#ar)"/>`;
      svg.innerHTML = `<svg viewBox="0 0 640 206" role="img" aria-label="keys and accounts"><defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="${C.ink3}"/></marker></defs>
        ${zone(12, L('验证者主机', 'validator host'))}${zone(216, L('链上账户', 'on chain'))}${zone(436, L('离线', 'offline'))}
        ${line(196, 69, 234, 69)}${line(196, 80, 234, 146)}${line(444, 69, 406, 69)}${line(196, 153, 234, 86)}
        ${Object.keys(BOX).map(box).join('')}</svg>`;
      info.textContent = sel.text;
    };
    el.appendChild(E('div', 'wg-cap', L('谁来签名：', 'Who signs:')));
    S.wg.buttons(el, ACT.map(a => [a[0], () => { sel = { sign: a[1], hit: a[2], bad: false, text: a[3] }; draw(); }]));
    el.appendChild(E('div', 'wg-cap', L('如果钥匙泄露：', 'If a key leaks:')));
    S.wg.buttons(el, HIT.map(a => [a[0], () => { sel = { sign: a[1], hit: a[2], bad: true, text: a[3] }; draw(); }]));
    el.appendChild(info);
    draw();
  }

  // 3. Votor: stake that votes in time decides each slot: fast finalisation, the slow path, or a skip certificate
  function votor(el) {
    title(el);
    let yes = 92, off = 3, cur = 5000, hist = [], downLeft = 0, auto = null;
    const COL = { fast: C.lime, slow: C.amber, skip: C.red, wait: C.ink3 };
    const LBL = { fast: L('快速终结', 'fast final'), slow: L('慢路径终结', 'slow final'), skip: L('skip 证书', 'skip cert'), wait: L('无证书', 'no cert') };
    const outcome = (y, o, leaderDown) => {
      const online = 100 - o, notar = leaderDown ? 0 : Math.min(y, online), skip = online - notar;
      const r = notar >= 80 ? 'fast' : notar >= 60 ? (online >= 60 ? 'slow' : 'wait') : skip >= 60 ? 'skip' : 'wait';
      return { notar, skip, online, r };
    };
    const step = () => {
      const down = downLeft > 0;
      const o = outcome(yes, off, down);
      hist.push({ slot: cur, r: o.r, down }); if (hist.length > 16) hist.shift();
      cur++; if (down) downLeft--;
      draw();
    };
    S.wg.slider(el, { label: L('按时投票支持这个块的质押', 'Stake voting for the block in time'), min: 0, max: 100, value: yes, fmt: v => `${v}%` }, v => { yes = v; draw(); });
    S.wg.slider(el, { label: L('离线的质押', 'Stake offline'), min: 0, max: 40, value: off, fmt: v => `${v}%` }, v => { off = v; draw(); });
    S.wg.buttons(el, [
      [L('下一个 slot', 'Next slot'), () => step()],
      [L('自动', 'Auto'), b => { if (auto) { auto(); auto = null; b.classList.remove('on'); } else { auto = S.wg.every(500, step); b.classList.add('on'); } }],
      [L('leader 离线（4 个 slot）', 'Leader offline (4 slots)'), () => { downLeft = 4; draw(); }],
      [L('重来', 'Reset'), () => { hist = []; cur = 5000; downLeft = 0; draw(); }],
    ]);
    const svg = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(svg, st.el); el.appendChild(note);
    function draw() {
      if (!el.contains(svg)) return;
      const o = outcome(yes, off, downLeft > 0);
      const W = 600, bw = W / 16;
      let g = '';
      hist.forEach((h, i) => {
        g += `<rect x="${i * bw + 2}" y="20" width="${bw - 4}" height="30" rx="4" fill="${COL[h.r]}" opacity="${h.r === 'fast' ? 0.8 : 1}"/><text x="${i * bw + bw / 2}" y="40" font-size="10" text-anchor="middle" fill="${C.bg}">${h.r === 'fast' ? 'F' : h.r === 'slow' ? 'S' : h.r === 'skip' ? 'K' : '…'}</text><text x="${i * bw + bw / 2}" y="64" font-size="9" text-anchor="middle">${h.slot % 1000}</text>${h.down ? `<text x="${i * bw + bw / 2}" y="13" font-size="9" text-anchor="middle" fill="${C.red}">${L('离线', 'down')}</text>` : ''}`;
      });
      if (!hist.length) g += `<text x="8" y="40" font-size="11" fill="${C.ink3}">${L('还没有 slot。点"下一个 slot"或"自动"。', 'No slots yet. Press "Next slot" or "Auto".')}</text>`;
      // the vote bar for the next slot: notarize | skip | offline, with the 60% and 80% lines
      const X = p => 4 + p / 100 * (W - 8);
      g += `<rect x="${X(0)}" y="78" width="${X(o.notar) - X(0)}" height="14" fill="${C.lime}" opacity=".8"/><rect x="${X(o.notar)}" y="78" width="${X(o.notar + o.skip) - X(o.notar)}" height="14" fill="${C.red}" opacity=".7"/><rect x="${X(o.online)}" y="78" width="${X(100) - X(o.online)}" height="14" fill="${C.line}"/>`;
      [[60, '60%'], [80, '80%']].forEach(([p, t]) => { g += `<line x1="${X(p)}" x2="${X(p)}" y1="72" y2="98" stroke="#e8f0e4" stroke-width="1.5"/><text x="${X(p)}" y="110" font-size="10" text-anchor="middle">${t}</text>`; });
      g += `<text x="4" y="110" font-size="10" fill="${C.ink3}">${L('下一个 slot 的投票', 'votes for the next slot')}</text>`;
      svg.innerHTML = `<svg viewBox="0 0 ${W} 114" role="img" aria-label="Votor certificates">${g}</svg>`;
      st.set([
        [L('支持这个块', 'For the block'), `${o.notar}%`, o.notar >= 80 ? 'good' : o.notar >= 60 ? 'mid' : 'bad'],
        [L('投 skip', 'Skip votes'), `${o.skip}%`, o.skip >= 60 ? 'bad' : ''],
        [L('离线', 'Offline'), `${off}%`, off > 20 ? 'mid' : ''],
        [L('结果', 'Result'), LBL[o.r], o.r === 'fast' ? 'good' : o.r === 'slow' ? 'mid' : 'bad'],
        [L('终结用时（示意）', 'Time to finality (illustrative)'), o.r === 'fast' ? '≈ 0.1–0.15 s' : o.r === 'slow' ? L('多一轮投票', 'one more round') : '—', o.r === 'fast' ? 'good' : ''],
      ]);
      note.textContent = o.r === 'fast' ? L('第一轮就有至少 80% 的质押支持：一张快速终结证书，slot 立即终结。', 'At least 80% of stake in the first round: one fast-finalisation certificate, and the slot is final at once.')
        : o.r === 'slow' ? L('60% 到 80% 之间：先形成公证（notarization）证书，第二轮再有 60% 才终结。两条路径同时进行。', 'Between 60% and 80%: a notarisation certificate forms first, and a second round at 60% finalises the slot. Both paths run at once.')
        : o.r === 'skip' ? (downLeft > 0 || (hist.length && hist[hist.length - 1].down) ? L('leader 离线，块没有在本地超时之前送到。在线的验证者都投 skip，每个 slot 很快得到一张 skip 证书，4 个 slot 的窗口就这样过去，链不会停下来等它。', 'The leader is offline, so no block arrives before the local timeout. Online validators vote skip, each slot quickly gets a skip certificate, and the four-slot window passes without the chain waiting.') : L('块没有及时送到大多数验证者：60% 的质押投了 skip，形成 skip 证书。', 'The block did not reach most validators in time: 60% of stake voted skip, and a skip certificate formed.'))
          : L('支持和跳过都不到 60%，暂时形成不了证书。在线质押低于 60% 时就会这样。"20+20"模型：恶意质押不超过 20% 时安全，另外再有最多 20% 离线时仍能前进。', 'Neither side reaches 60%, so no certificate forms yet. This happens once online stake falls below 60%. The "20+20" model: safe with up to 20% adversarial stake, and still live with up to another 20% offline.');
    }
    draw();
  }

  // 4. the admission ticket and the epoch boundary: is the validator in the set for N+1 and N+2?
  function admission(el) {
    title(el);
    let balance = 0.6, rate = 0, hours = 6, topup = 'none', bls = true;
    S.wg.slider(el, { label: L('vote account 余额（SOL）', 'Vote account balance (SOL)'), min: 0, max: 8, step: 0.1, value: balance, fmt: v => `◎${fmt(v, 1)}` }, v => { balance = v; draw(); });
    S.wg.slider(el, { label: L('自动补充（出块收入，SOL/epoch）', 'Auto-fund (block revenue, SOL/epoch)'), min: 0, max: 1.5, step: 0.1, value: rate, fmt: v => `◎${fmt(v, 1)}` }, v => { rate = v; draw(); });
    S.wg.slider(el, { label: L('距边界（小时）', 'Time to the boundary (h)'), min: 0.5, max: 24, step: 0.5, value: hours, fmt: v => `${fmt(v, 1)} h` }, v => { hours = v; draw(); });
    S.wg.buttons(el, [[L('不充值', 'No top-up'), () => { topup = 'none'; draw(); }], [L('边界前充 5 SOL', 'Top up 5 SOL before the boundary'), () => { topup = 'before'; draw(); }], [L('边界后一小时充 5 SOL', 'Top up 5 SOL an hour after it'), () => { topup = 'after'; draw(); }]], { toggle: true });
    S.wg.buttons(el, [[L('已登记 BLS 公钥', 'BLS key registered'), () => { bls = true; draw(); }], [L('没有 BLS 公钥', 'No BLS key'), () => { bls = false; draw(); }]], { toggle: true });
    const svg = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(svg, st.el); el.appendChild(note);
    function draw() {
      if (!el.contains(svg)) return;
      // now: epoch N−1, `hours` before epoch N begins. Boundary 1 (into N) decides N+1; boundary 2 (into N+1) decides N+2.
      const b1 = balance + rate * hours / 24 + (topup === 'before' ? 5 : 0);
      const in1 = bls && b1 >= ADMIT, a1 = in1 ? b1 - TICKET : b1;
      const b2 = a1 + rate + (topup === 'after' ? 5 : 0);
      const in2 = bls && b2 >= ADMIT, a2 = in2 ? b2 - TICKET : b2;
      const W = 600, x0 = 10, ew = 146, X = (e, f) => x0 + e * ew + f * ew;
      const tag = ok => ok ? [C.lime, L('在集合中', 'in the set')] : [C.red, L('被排除', 'left out')];
      let g = '';
      [['N−1', [C.blue, L('现在', 'now')]], ['N', [C.lime, L('已决定', 'decided')]], ['N+1', tag(in1)], ['N+2', tag(in2)]].forEach(([t, [col, lab]], e) => {
        g += `<text x="${X(e, 0) + 4}" y="14" font-size="11">epoch ${t}</text><rect x="${X(e, 0)}" y="20" width="${ew - 6}" height="26" rx="4" fill="${col}" opacity="${e === 0 ? 0.25 : 0.7}"/><text x="${X(e, 0) + 6}" y="37" font-size="10" fill="${e === 0 ? '#e8f0e4' : C.bg}">${lab}</text>`;
      });
      [[1, b1, in1, L('边界 1：决定 N+1', 'boundary 1: decides N+1')], [2, b2, in2, L('边界 2：决定 N+2', 'boundary 2: decides N+2')]].forEach(([e, b, ok, t]) => {
        g += `<line x1="${X(e, 0) - 3}" x2="${X(e, 0) - 3}" y1="16" y2="70" stroke="${ok ? C.lime : C.red}" stroke-width="2"/><text x="${X(e, 0)}" y="62" font-size="10" fill="${ok ? C.lime : C.red}">${t}</text><text x="${X(e, 0)}" y="76" font-size="10">${L('余额', 'balance')} ◎${fmt(b, 3)} ${ok ? '− 0.8' : '< ' + fmt(ADMIT, 3)}</text>`;
      });
      g += `<line x1="${X(0, 1 - Math.min(1, hours / 24)) - 3}" x2="${X(0, 1 - Math.min(1, hours / 24)) - 3}" y1="18" y2="48" stroke="#e8f0e4" stroke-width="2"/>`;
      if (topup === 'after') g += `<path d="M${X(1, 0.04)} 50 l-5 9 h10z" fill="${C.amber}"/>`;
      if (topup === 'before') g += `<path d="M${X(0, 0.97)} 50 l-5 9 h10z" fill="${C.amber}"/>`;
      svg.innerHTML = `<svg viewBox="0 0 ${W} 82" role="img" aria-label="admission timeline">${g}</svg>`;
      st.set([
        [L('边界 1 时的余额', 'Balance at boundary 1'), `◎${fmt(b1, 3)}`, b1 >= ADMIT ? '' : 'bad'],
        ['epoch N+1', in1 ? L('在集合中', 'in the set') : L('被排除', 'left out'), in1 ? 'good' : 'bad'],
        [L('边界 2 时的余额', 'Balance at boundary 2'), `◎${fmt(b2, 3)}`, b2 >= ADMIT ? '' : 'bad'],
        ['epoch N+2', in2 ? L('在集合中', 'in the set') : L('被排除', 'left out'), in2 ? 'good' : 'bad'],
        [L('之后还够几个边界', 'Boundaries covered after that'), bls ? String(Math.max(0, Math.floor((a2 - RENT) / TICKET))) : '0', a2 - RENT >= 5 * TICKET ? 'good' : a2 - RENT >= TICKET ? 'mid' : 'bad'],
      ]);
      note.textContent = !bls ? L('没有 BLS 公钥，余额再多也进不了集合：准入失败的原因之一就是"no BLS pubkey"。', 'Without a BLS key no balance helps: "no BLS pubkey" is one of the reasons admission fails.')
        : topup === 'after' && !in1 ? L('边界 1 已经按当时的余额决定了 N+1。边界之后的充值只在边界 2 被计算，最早赶上 N+2，验证者整整缺席 N+1。', 'Boundary 1 already decided N+1 from the balance at that moment. A top-up after it is counted at boundary 2, so it helps from N+2 at the earliest, and the validator misses all of N+1.')
          : !in1 ? L('边界 1 时余额低于准入费加免租金额，验证者缺席 N+1。在边界之前充值，才能保住 N+1。', 'At boundary 1 the balance is below the ticket plus rent, so the validator misses N+1. Only a top-up before the boundary saves N+1.')
            : L(`每个边界扣 ${TICKET} SOL，免租金额 ${fmt(RENT, 3)} SOL 必须留在账户里。出块收入改为进入 vote account 后，余额可以自己补充；这个设置在两个 epoch 之后生效。`, `Each boundary takes ${TICKET} SOL, and the rent-exempt ${fmt(RENT, 3)} SOL must stay in the account. With block revenue directed to the vote account, the balance refills itself; that setting takes effect two epochs later.`);
    }
    draw();
  }

  // 5. delinquency and skip rate at 200 ms: stop voting and watch the 128-slot line; miss leader windows
  function delinquency(el) {
    title(el);
    let voting = true, tip = 0, last = 0, speed = 4, missed = 0, votedT = 0, allT = 0;
    S.wg.buttons(el, [[L('投票中', 'Voting'), () => { voting = true; }], [L('停止投票', 'Stop voting'), () => { voting = false; }]], { toggle: true });
    S.wg.buttons(el, [['1×', () => { speed = 1; }], ['4×', () => { speed = 4; }], ['16×', () => { speed = 16; }]], { toggle: true, selected: 1 });
    S.wg.slider(el, { label: L('10 个 leader 窗口中错过', 'Leader windows missed, of 10'), min: 0, max: 10, value: 0 }, v => { missed = v; });
    const meter = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(meter, st.el); el.appendChild(note);
    const draw = () => {
      const behind = Math.max(0, Math.floor(tip - last)), del = behind > 128;
      meter.innerHTML = `<div class="wg-cap" style="margin-bottom:.3rem">${L('最后一票落后链头', 'Last vote behind the tip')}: <b style="color:${del ? C.red : C.ink2}">${behind} slots · ${fmt(behind * 0.2, 1)} s</b> · ${L('128 处是 delinquent 线', 'the line at 128 is the delinquency threshold')}</div>${S.wg.meter(behind / 256 * 100, del ? 'bad' : behind > 64 ? 'mid' : '', [[50, '128']])}`;
      st.set([
        [L('状态', 'Status'), del ? 'DELINQUENT' : voting ? L('投票中', 'voting') : L('未投票', 'not voting'), del ? 'bad' : voting ? 'good' : 'mid'],
        [L('128 个 slot 等于', '128 slots equal'), '25.6 s', ''],
        ['skip rate', `${fmt(missed * 10, 0)}%`, missed === 0 ? 'good' : missed <= 2 ? 'mid' : 'bad'],
        [L('本 epoch 在投票的时间', 'Time voting this epoch'), `${fmt(allT ? votedT / allT * 100 : 100, 0)}%`, !allT || votedT / allT > 0.98 ? 'good' : votedT / allT > 0.9 ? 'mid' : 'bad'],
      ]);
      note.textContent = del
        ? L('落后超过 128 个 slot，约 26 秒：RPC 把它列为 delinquent，它挣不到投票奖励。恢复投票后，最后一票会立即回到链头附近。', 'More than 128 slots behind, about 26 seconds: RPC lists it as delinquent, and it earns no vote rewards. Once it votes again, its last vote jumps back near the tip.')
        : L('错过的 leader 窗口很快变成 skip 证书，计入 skip rate，损失的是出块收入。本 epoch 的投票奖励总额在 epoch 开始时就已确定，停投只会让这台验证者分到的份额变小。', 'A missed leader window quickly becomes skip certificates. It counts towards the skip rate and loses block revenue. The epoch\'s vote reward pool is fixed when the epoch starts; time not voting only shrinks this validator\'s share of it.');
    };
    S.wg.loop(dt => {
      tip += dt * 5 * speed; allT += dt * speed;
      if (voting) { last = tip - 1; votedT += dt * speed; }
      draw();
    });
    draw();
  }

  // 6. stake and rewards: epoch timeline for a new delegation, reward split by commission
  function rewards(el) {
    title(el);
    const STAKES = [1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000];
    let stake = 100000, comm = 5, apy = 6, perf = 100, at = 50;
    S.wg.slider(el, { label: L('委托质押（SOL）', 'Delegated stake (SOL)'), min: 0, max: STAKES.length - 1, value: 4, fmt: v => STAKES[v].toLocaleString('en-US') }, v => { stake = STAKES[v]; draw(); });
    S.wg.slider(el, { label: L('佣金', 'Commission'), min: 0, max: 100, value: 5, fmt: v => `${v}%` }, v => { comm = v; draw(); });
    S.wg.slider(el, { label: L('网络质押年化（假设）', 'Network staking yield (assumed)'), min: 3, max: 9, step: 0.5, value: 6, fmt: v => `${v}%` }, v => { apy = v; draw(); });
    S.wg.slider(el, { label: L('本 epoch 投票表现（相对中位数）', 'Voting this epoch (vs median)'), min: 70, max: 100, value: 100, fmt: v => `${v}%` }, v => { perf = v; draw(); });
    S.wg.slider(el, { label: L('在 epoch N 的何时委托', 'Delegate during epoch N at'), min: 0, max: 99, value: 50, fmt: v => `${v}%` }, v => { at = v; draw(); });
    const svg = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(svg, st.el); el.appendChild(note);
    function draw() {
      if (!el.contains(svg)) return;
      const perYear = 365.25 * 86400 / (EPOCH * 0.2), gross = stake * apy / 100 / perYear * perf / 100, cut = gross * comm / 100;
      const W = 600, x0 = 20, ew = 186, X = (e, f) => x0 + e * ew + f * ew;
      let g = '';
      ['N', 'N+1', 'N+2'].forEach((t, e) => { g += `<rect x="${X(e, 0)}" y="30" width="${ew - 4}" height="26" rx="4" fill="${C.panel}" stroke="${C.line}"/><text x="${X(e, 0) + 6}" y="22" font-size="11">epoch ${t}</text>`; });
      g += `<rect x="${X(0, at / 100)}" y="30" width="${X(1, 0) - X(0, at / 100) - 4}" height="26" rx="3" fill="${C.amber}" opacity=".55"/><text x="${X(0, at / 100) + 4}" y="47" font-size="10" fill="${C.bg}">${L('激活中', 'activating')}</text>`;
      g += `<rect x="${X(1, 0)}" y="30" width="${ew - 4}" height="26" rx="3" fill="${C.lime}" opacity=".7"/><text x="${X(1, 0) + 6}" y="47" font-size="10" fill="${C.bg}">${L('已生效，开始计奖励', 'active, earning')}</text>`;
      g += `<line x1="${X(2, 0)}" x2="${X(2, 0)}" y1="24" y2="70" stroke="${C.blue}" stroke-width="2"/><text x="${X(2, 0) + 6}" y="74" font-size="10" fill="${C.blue}">${L('epoch N+1 的奖励在此发放', 'rewards for N+1 paid here')}</text>`;
      g += `<path d="M${X(0, at / 100)} 62 l-5 10 h10z" fill="#e8f0e4"/><text x="${X(0, at / 100) - 4}" y="88" font-size="10" text-anchor="${at > 70 ? 'end' : 'start'}">${L('委托', 'delegate')}</text>`;
      svg.innerHTML = `<svg viewBox="0 0 ${W} 94" role="img" aria-label="stake activation timeline">${g}</svg>`;
      st.set([
        [L('每 epoch 通胀奖励', 'Inflation reward per epoch'), `◎${fmt(gross, 2)}`, ''],
        [L('验证者佣金（进 vote account）', 'Commission (to vote account)'), `◎${fmt(cut, 2)}`, ''],
        [L('委托人得到', 'Delegators receive'), `◎${fmt(gross - cut, 2)}`, comm > 10 ? 'mid' : 'good'],
        [L('一年合计（200 ms slot，约 365 个 epoch）', 'Per year (200 ms slots, about 365 epochs)'), `◎${fmt(gross * perYear, 0)}`, ''],
      ]);
      note.textContent = L('收益率是假设值，实际值随通胀计划和全网质押比例变化。一个 epoch 的奖励总额在 epoch 开始时就已确定；投票表现低于中位数，委托人和验证者一起少拿。', 'The yield is an assumption; the real figure follows the inflation schedule and the share of SOL staked. An epoch\'s reward pool is fixed when the epoch starts; voting below the median shrinks the share for delegators and validator alike.');
    }
    draw();
  }

  // 7. snapshots at 200 ms: downtime vs local snapshot vs download, and whether the node can catch up
  function snapshots(el) {
    title(el);
    const DOWN = [[60, L('1 分钟', '1 min')], [300, L('5 分钟', '5 min')], [900, L('15 分钟', '15 min')], [3600, L('1 小时', '1 h')], [6 * 3600, L('6 小时', '6 h')], [86400, L('1 天', '1 day')], [2 * 86400, L('2 天', '2 days')]];
    let down = 300, noFetch = false, mbps = 150, size = 60;
    S.wg.slider(el, { label: L('停机时长', 'Downtime'), min: 0, max: DOWN.length - 1, value: 1, fmt: v => DOWN[v][1] }, v => { down = DOWN[v][0]; draw(); });
    S.wg.slider(el, { label: L('下载带宽（MB/s）', 'Download speed (MB/s)'), min: 25, max: 500, step: 25, value: 150 }, v => { mbps = v; draw(); });
    S.wg.slider(el, { label: L('快照大小（GB，示意）', 'Snapshot size (GB, illustrative)'), min: 10, max: 150, step: 10, value: 60 }, v => { size = v; draw(); });
    S.wg.buttons(el, [[L('允许下载快照', 'Snapshot fetch allowed'), () => { noFetch = false; draw(); }], ['--no-snapshot-fetch', () => { noFetch = true; draw(); }]], { toggle: true });
    const svg = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(svg, st.el); el.appendChild(note);
    function draw() {
      if (!el.contains(svg)) return;
      const RATE = 5, LOAD = 240, GAIN = 25, gapDown = down * RATE;
      let path, prep, gap, gain;
      if (gapDown <= 2500 || noFetch) {
        path = L('使用本地快照', 'use local snapshot'); prep = LOAD; gap = gapDown + LOAD * RATE;
        gain = gap > 100000 ? -1.8 : GAIN;
      } else {
        const dl = size * 1024 / mbps;
        path = L('从 known validator 下载新快照', 'download a fresh snapshot from a known validator'); prep = dl + LOAD; gap = 760 + prep * RATE; gain = GAIN;
      }
      const catchT = gain > 0 ? gap / gain : Infinity, total = prep + catchT;
      const W = 600, maxT = Math.min(Math.max(total === Infinity ? prep * 2 : total, 120), 7200), X = t => 20 + Math.min(t, maxT) / maxT * (W - 40);
      const seg = (a, b, c, t) => (b > a ? `<rect x="${X(a)}" y="20" width="${Math.max(2, X(b) - X(a))}" height="24" rx="3" fill="${c}" opacity=".75"/><text x="${X(a) + 4}" y="36" font-size="10" fill="${C.bg}">${X(b) - X(a) > 60 ? t : ''}</text>` : '');
      let g = seg(0, prep - LOAD, C.blue, L('下载', 'download')) + seg(prep - LOAD, prep, C.amber, L('加载', 'load')) + (gain > 0 ? seg(prep, total, C.lime, L('追赶', 'catch up')) : seg(prep, maxT, C.red, L('越落越远', 'falling behind')));
      g += `<text x="20" y="62" font-size="10">0</text><text x="${W - 20}" y="62" font-size="10" text-anchor="end">${dur(maxT)}</text>`;
      svg.innerHTML = `<svg viewBox="0 0 ${W} 68" role="img" aria-label="restart timeline">${g}</svg>`;
      st.set([
        [L('停机期间错过的 slot', 'Slots missed while down'), Math.round(gapDown).toLocaleString('en-US'), gapDown > 2500 ? 'mid' : ''],
        [L('启动方式', 'Start path'), path, ''],
        [L('加载后落后', 'Behind after load'), `${Math.round(gap).toLocaleString('en-US')} slots`, gap > 100000 ? 'bad' : ''],
        [L('恢复投票还需', 'Voting again in'), gain > 0 ? dur(total) : L('追不上', 'never'), gain > 0 ? (total < 900 ? 'good' : 'mid') : 'bad'],
      ]);
      note.textContent = gain > 0
        ? L('模型是示意性的：加载约 4 分钟，追赶时每秒净追约 25 个 slot。200 ms 的 slot 下，2,500 个 slot 的本地快照年限只相当于 8 分钟多一点。真实数值取决于硬件、网络和集群负载。', 'The model is illustrative: about 4 minutes to load and a net catch-up of about 25 slots a second. At 200 ms, the 2,500-slot local snapshot age is just over 8 minutes. Real figures depend on hardware, network and cluster load.')
        : L('本地快照太旧。缺失的 slot 只能靠 repair 从其他节点要，速度比集群出块还慢，所以差距只会扩大。去掉 --no-snapshot-fetch 重启。', 'The local snapshot is too old. Missing slots can only be repaired from peers, more slowly than the cluster produces them, so the gap only grows. Restart without --no-snapshot-fetch.');
    }
    draw();
  }

  /* ---------- step 1: the lesson ---------- */
  S.registerLesson({
    id: 'solana-basics', network: 'solana', minutes: 40,
    title: LL('面向验证者运维的 Solana 基础', 'Solana fundamentals for validator operators'),
    tagline: LL('200 ms 的 slot 与 leader、钥匙与 BLS 公钥、Votor 证书、准入费与 epoch 边界、delinquent、奖励和快照。', 'Slots and leaders at 200 ms, keys and the BLS key, Votor certificates, the admission ticket and the epoch boundary, delinquency, rewards and snapshots.'),
    chapters: [
      {
        title: LL('slot、leader 与 epoch', 'Slots, leaders and epochs'),
        body: LL(
          `<p>Solana 把时间切成 <b>slot</b>。每个 slot 只有一个验证者有权出块，它就是这个 slot 的 <b>leader</b>。其他验证者收到这个块、重放它，再对它投票。</p>
<p><b>leader 表</b>按连续 4 个 slot 为一组分配，事先根据质押分布算好：质押越多，分到的 slot 越多。每个验证者都能算出同一张表，所以都知道接下来轮到谁。</p>
<p>目标 slot 时长由 SIMD-0525 分几步缩短：400、350、300、250，最后到 200 ms。200 ms 这一步于 2026 年 10 月在主网生效。每个 slot 的计算上限同步降低，所以每秒的计算量大致不变。</p>
<p>一个 <b>epoch</b> 仍是 432,000 个 slot，现在约一天。质押的生效与解除、奖励结算、新的 leader 表，以及验证者的准入费，都在 epoch 边界发生。</p>
<p>大多数验证者运行 Anza 维护的 Agave，本课程的练习也使用它。Agave v4.3.x 是 Alpenglow 的发布线。Firedancer 是另一套独立实现；Frankendancer 把 Firedancer 的网络层与 Agave 的运行时组合在一起。</p>`,
          `<p>Solana divides time into <b>slots</b>. In each slot exactly one validator may produce a block: the slot's <b>leader</b>. The other validators receive that block, replay it and vote on it.</p>
<p>The <b>leader schedule</b> assigns slots in runs of four consecutive slots per leader. It is computed in advance from the stake distribution: more stake means more slots. Every validator can compute the same schedule, so all of them know who leads next.</p>
<p>SIMD-0525 cut the target slot time in steps: 400, 350, 300, 250 and finally 200 ms. The 200 ms step took effect on mainnet in October 2026. The compute limit per slot was reduced with it, so compute per second stays about the same.</p>
<p>An <b>epoch</b> is still 432,000 slots, which is now about a day. Stake activation and deactivation, rewards, the next leader schedule and the validators' admission tickets all happen at epoch boundaries.</p>
<p>Most validators run Agave, the client maintained by Anza, and the labs in this course use it. Agave v4.3.x is the Alpenglow release line. Firedancer is an independent implementation; Frankendancer combines Firedancer's networking with Agave's runtime.</p>`),
        widget: slotClock,
        quiz: [
          { q: LL('一个 leader 每次连续分到几个 slot？', 'How many consecutive slots does a leader get at a time?'), options: [LL('1 个', '1'), LL('4 个', '4'), LL('32 个', '32'), LL('整个 epoch', 'A whole epoch')], answer: 1, why: LL('leader 表以 4 个连续 slot 为一组，leader 可以连续出块。', 'The schedule assigns four consecutive slots, so a leader can build blocks back to back.') },
          { q: LL('slot 为 200 ms 时，一个 epoch 大约多长？', 'With 200 ms slots, about how long is an epoch?'), options: [LL('约 3 小时', 'About 3 hours'), LL('约 1 天', 'About 1 day'), LL('约 2 天', 'About 2 days'), LL('约 1 周', 'About 1 week')], answer: 1, why: LL('432,000 × 0.2 秒 = 86,400 秒，正好一天。slot 为 400 ms 时是两天。', '432,000 × 0.2 s = 86,400 s, which is one day. At 400 ms it was two.') },
          { q: LL('slot 缩短到 200 ms 后，每个 slot 的计算上限怎样变化？', 'When slots were cut to 200 ms, what happened to the compute limit per slot?'), options: [LL('不变', 'It stayed the same'), LL('同步降低，每秒的计算量大致不变', 'It was reduced, so compute per second stays about the same'), LL('翻倍', 'It doubled'), LL('取消了上限', 'The limit was removed')], answer: 1, why: LL('slot 变短，每个 slot 能做的计算也相应减少。', 'Shorter slots each carry correspondingly less compute.') },
        ],
      },
      {
        title: LL('钥匙、账户与 BLS 公钥', 'Keys, accounts and the BLS key'),
        body: LL(
          `<p>一个验证者涉及三把钥匙和两个链上账户。</p>
<table><tr><th>钥匙</th><th>放在哪里</th><th>能做什么</th></tr>
<tr><td>identity</td><td>验证者主机</td><td>默认的 authorized voter：签投票消息、区块和 gossip 消息。它的账户收出块收入，并支付普通交易的手续费。</td></tr>
<tr><td>vote account keypair</td><td>只用一次</td><td>只在创建 vote account 时签名。账户建好之后，这把钥匙没有任何权限，账户地址才是长期使用的东西。</td></tr>
<tr><td>authorized withdrawer</td><td>离线</td><td>从 vote account 取款、修改佣金、更换 vote account 上的 identity 和 voter。它是控制权的根。</td></tr></table>
<p><b>identity 账户</b>不再为投票付费。在 Alpenglow 下投票不是交易，按票收取的手续费已经取消。它仍然签名、收取 leader 的出块收入、支付普通交易费。运维也常从它给 vote account 补钱。</p>
<p><b>vote account</b> 记录投票状态、credits 和佣金，现在还要存放<b>准入费</b>：每个 epoch 边界从这里扣一次（第 4 章）。任何人都可以向它转账，只有 withdrawer 能取出。</p>
<h3>BLS 公钥</h3>
<p>Alpenglow 用 BLS 签名把许多验证者的投票聚合成一张证书。每个 vote account 都要登记一个 BLS 公钥，它由 authorized voter keypair 派生。没有登记 BLS 公钥的验证者被排除在共识之外，停止投票。主网自 2026 年 7 月起要求这个公钥，登记需要 Solana CLI 4.1.0 或更高版本。</p>
<pre class="term-snip">$ solana-keygen bls_pubkey &lt;AUTHORIZED_VOTER_KEYPAIR&gt;
$ solana vote-authorize-voter-checked &lt;VOTE_ACCOUNT&gt; &lt;AUTHORIZED_VOTER_KEYPAIR&gt; &lt;AUTHORIZED_VOTER_KEYPAIR&gt;
$ solana vote-account &lt;VOTE_ACCOUNT&gt; | grep "BLS Public Key"</pre>
<p>第二条命令把同一个 keypair 传两次：它把 BLS 公钥写进 vote account，authorized voter 保持不变。</p>
<p>identity 要持续签名，所以必须放在服务器上。withdrawer 很少用到，应当离线保存，例如放在硬件钱包或一台不联网的机器上，助记词另外存放。</p>`,
          `<p>A validator involves three keys and two on-chain accounts.</p>
<table><tr><th>Key</th><th>Where it lives</th><th>What it can do</th></tr>
<tr><td>identity</td><td>validator host</td><td>The default authorized voter: signs vote messages, blocks and gossip messages. Its account receives block revenue and pays ordinary transaction fees.</td></tr>
<tr><td>vote account keypair</td><td>used once</td><td>Signs only the creation of the vote account. Afterwards it has no authority; the account address is what stays in use.</td></tr>
<tr><td>authorized withdrawer</td><td>offline</td><td>Withdraws from the vote account, changes the commission, and reassigns the identity and the voter on the vote account. It is the root of control.</td></tr></table>
<p>The <b>identity account</b> no longer pays for votes. Under Alpenglow a vote is not a transaction, and the per-vote fee is gone. The identity still signs, receives the leader's block revenue and pays ordinary transaction fees. Operators also often refill the vote account from it.</p>
<p>The <b>vote account</b> holds the vote state, credits and commission, and now also the <b>admission ticket</b> money: each epoch boundary takes the ticket from it (chapter 4). Anyone can deposit to it; only the withdrawer can take SOL out.</p>
<h3>The BLS key</h3>
<p>Alpenglow aggregates the votes of many validators into one certificate with BLS signatures. Every vote account must have a BLS public key registered, derived from the authorized voter keypair. A validator without a registered BLS key is excluded from consensus and stops voting. Mainnet has required the key since July 2026, and registering it needs Solana CLI 4.1.0 or later.</p>
<pre class="term-snip">$ solana-keygen bls_pubkey &lt;AUTHORIZED_VOTER_KEYPAIR&gt;
$ solana vote-authorize-voter-checked &lt;VOTE_ACCOUNT&gt; &lt;AUTHORIZED_VOTER_KEYPAIR&gt; &lt;AUTHORIZED_VOTER_KEYPAIR&gt;
$ solana vote-account &lt;VOTE_ACCOUNT&gt; | grep "BLS Public Key"</pre>
<p>The second command passes the same keypair twice: it writes the BLS key into the vote account and leaves the authorized voter unchanged.</p>
<p>The identity signs continuously, so it has to be on the server. The withdrawer is rarely needed and belongs offline, on a hardware wallet or a machine that is not on the network, with its seed phrase stored separately.</p>`),
        widget: keyMap,
        after: LL('<div class="note warn">identity 泄露，损失的是它的余额，还可能被人在别处冒用；用 withdrawer 换一个新 identity 就能止损。withdrawer 泄露，损失的是整个 vote account 和对它的控制权，没有补救办法。</div>', '<div class="note warn">A leaked identity costs its balance and can be used elsewhere; the withdrawer replaces it with a new identity. A leaked withdrawer costs the vote account and control over it, with no way back.</div>'),
        quiz: [
          { q: LL('哪把钥匙能修改 vote account 的佣金？', 'Which key can change the commission on the vote account?'), options: [LL('identity', 'The identity'), LL('vote account keypair', 'The vote account keypair'), LL('authorized withdrawer', 'The authorized withdrawer'), LL('任何一个委托人', 'Any delegator')], answer: 2, why: LL('改佣金需要 withdrawer 签名，所以它决定这台验证者的收入。', 'Commission changes need the withdrawer\'s signature, which is why that key controls the validator\'s income.') },
          { q: LL('为什么 withdrawer 不能放在验证者主机上？', 'Why must the authorized withdrawer not be stored on the validator host?'), options: [LL('会拖慢投票', 'It slows down voting'), LL('拿到主机权限的人就能取走 vote account 的钱并改掉授权', 'Anyone who takes over the host could drain the vote account and change its authorities'), LL('验证者发现它就拒绝启动', 'The validator refuses to start if it finds it'), LL('它一个 epoch 后就过期', 'It expires after one epoch')], answer: 1, why: LL('服务器暴露在网络上。withdrawer 和 identity 放在一起，一次入侵就会失去全部控制权。', 'The server faces the network. Keeping the withdrawer next to the identity means one intrusion loses all control.') },
          { q: LL('vote account 没有登记 BLS 公钥，会怎样？', 'What happens if the vote account has no BLS key registered?'), options: [LL('没有影响', 'Nothing'), LL('投票手续费翻倍', 'Vote fees double'), LL('验证者被排除在共识之外，停止投票', 'The validator is excluded from consensus and stops voting'), LL('只影响出块', 'Only block production is affected')], answer: 2, why: LL('证书靠 BLS 签名聚合。没有 BLS 公钥，准入失败，验证者不能投票。', 'Certificates are aggregated with BLS signatures. Without the key, admission fails and the validator cannot vote.') },
          { q: LL('谁可以往 vote account 里转 SOL？', 'Who can deposit SOL into a vote account?'), options: [LL('只有 withdrawer', 'Only the withdrawer'), LL('只有 identity', 'Only the identity'), LL('任何人，用一笔普通转账', 'Anyone, with a plain transfer'), LL('只有运行时', 'Only the runtime')], answer: 2, why: LL('存款不需要任何授权；取款才需要 withdrawer。', 'Deposits need no authority. Withdrawals need the withdrawer.') },
        ],
      },
      {
        title: LL('Votor：证书与终结', 'Votor: certificates and finality'),
        body: LL(
          `<p>Alpenglow 用 <b>Votor</b> 取代了 TowerBFT。Proof of History 仍然保留。负责传播区块、用来替代 Turbine 的 <b>Rotor</b> 计划在后续阶段上线，目前还没有启用。主网在 2026 年 10 月激活了 Alpenglow，testnet 和 devnet 更早。</p>
<p>投票不再是交易。验证者把轻量的投票消息直接发给一组按质押加权选出的节点，这些投票用 <b>BLS 签名</b>聚合成<b>证书</b>。每个 slot 的结果由证书决定：</p>
<ul><li><b>快速终结</b>：第一轮就有至少 80% 的质押支持这个块，slot 立即终结。</li>
<li><b>慢路径</b>：至少 60% 的质押支持，块先被公证（notarization）；第二轮再有至少 60%，slot 终结。</li>
<li><b>skip 证书</b>：至少 60% 的质押投票跳过这个 slot。</li></ul>
<p>两条路径同时进行。终结的目标时间约为 100–150 ms，而在 TowerBFT 下终结一个块约需 12.8 秒。</p>
<p>leader 的块在本地超时之前没有送到，验证者就投 skip 票。离线 leader 的 4 个 slot 因此很快变成 skip 证书，链不会停下来等它。</p>
<p>容错模型称为"20+20"：恶意质押不超过 20% 时安全性成立，另外再有至多 20% 的质押离线，活性仍然成立。</p>
<p>投票不再进入区块，所以把投票交易计入在内的 TPS 数字大幅下降，而用户的实际活动并没有变化。</p>
<h3>一个 identity，只能有一台机器投票</h3>
<p>两台机器运行同一个 identity，会为同一个 slot 签出相互矛盾的票。这就是双签（equivocation），任何时候都不能发生。验证者把共识状态保存在 ledger 目录下的 <code>vote_history-&lt;IDENTITY&gt;.bin</code> 中，它取代了 TowerBFT 的 tower 文件。<code>agave-validator set-identity</code> 默认要求这个文件存在，防止备用机带着空白的投票历史接管 identity。</p>`,
          `<p>Alpenglow replaced TowerBFT with <b>Votor</b>. Proof of History stays in the system. <b>Rotor</b>, which is to replace Turbine for block propagation, is planned for a later phase and is not live. Mainnet activated Alpenglow in October 2026, after testnet and devnet.</p>
<p>Votes are no longer transactions. Validators send lightweight vote messages directly to a stake-weighted set of peers, and the votes are aggregated with <b>BLS signatures</b> into <b>certificates</b>. Certificates decide each slot:</p>
<ul><li><b>Fast finalisation</b>: at least 80% of stake supports the block in the first round, and the slot is final at once.</li>
<li><b>Slow path</b>: at least 60% of stake supports it and the block is notarised; a second round at 60% or more finalises the slot.</li>
<li><b>Skip certificate</b>: at least 60% of stake votes to skip the slot.</li></ul>
<p>Both paths run concurrently. Finality targets about 100–150 ms, compared with about 12.8 s to finalise a block under TowerBFT.</p>
<p>When a leader's block does not arrive before a local timeout, validators send a skip vote. An offline leader's four slots therefore collapse quickly into skip certificates, and the chain does not wait for it.</p>
<p>The resilience model is called "20+20": safety holds with up to 20% adversarial stake, and liveness holds with up to another 20% offline.</p>
<p>Votes no longer go into blocks, so TPS figures that counted vote transactions dropped sharply even though user activity did not change.</p>
<h3>One identity, one voting machine</h3>
<p>Two machines running the same identity sign conflicting votes for the same slots. That is equivocation, and it must never happen. The validator keeps its consensus state in <code>vote_history-&lt;IDENTITY&gt;.bin</code> in the ledger directory, which replaces TowerBFT's tower file. <code>agave-validator set-identity</code> requires that file by default, so a standby cannot take over the identity with an empty vote history.</p>`),
        widget: votor,
        after: LL('<div class="note">组件是简化模型：它只区分按时投票的质押、投 skip 的质押和离线的质押，不包含 Votor 的全部规则。</div>', '<div class="note">The widget is a simplified model. It separates stake that votes in time, stake that votes skip and stake that is offline, and leaves out the rest of Votor\'s rules.</div>'),
        quiz: [
          { q: LL('第一轮有 85% 的质押投票支持一个块，结果是？', '85% of stake supports a block in the first round. What happens?'), options: [LL('快速终结', 'Fast finalisation'), LL('先公证，第二轮再终结', 'Notarised, then finalised in a second round'), LL('skip 证书', 'A skip certificate'), LL('等 32 个 slot', 'It waits 32 slots')], answer: 0, why: LL('第一轮达到 80% 即快速终结。', 'Reaching 80% in the first round finalises the slot at once.') },
          { q: LL('有 70% 的质押支持一个块，其余离线。结果是？', '70% of stake supports a block and the rest is offline. What happens?'), options: [LL('快速终结', 'Fast finalisation'), LL('慢路径：公证之后，第二轮 60% 终结', 'Slow path: notarised, then finalised by a second round at 60%'), LL('skip 证书', 'A skip certificate'), LL('链停止', 'The chain stops')], answer: 1, why: LL('60% 到 80% 之间走慢路径。', 'Between 60% and 80% the slow path applies.') },
          { q: LL('一个 leader 离线了，它的 4 个 slot 会怎样？', 'A leader is offline. What happens to its four slots?'), options: [LL('集群等它恢复', 'The cluster waits for it'), LL('很快变成 4 张 skip 证书，链继续前进', 'They quickly become four skip certificates and the chain moves on'), LL('由下一个 leader 补出这 4 个块', 'The next leader produces those blocks'), LL('这个 epoch 作废', 'The epoch is void')], answer: 1, why: LL('块在超时之前没有送到，验证者投 skip；达到 60% 就形成 skip 证书。', 'No block arrives before the timeout, validators vote skip, and 60% forms a skip certificate.') },
          { q: LL('在 Alpenglow 下，哪个文件取代了 tower 文件？', 'Under Alpenglow, which file replaces the tower file?'), options: [LL('vote_history-<IDENTITY>.bin', 'vote_history-<IDENTITY>.bin'), LL('admin.rpc', 'admin.rpc'), LL('genesis.bin', 'genesis.bin'), LL('不需要任何文件', 'No file is needed')], answer: 0, why: LL('set-identity 默认要求这个文件。', 'set-identity requires this file by default.') },
        ],
      },
      {
        title: LL('准入费与 epoch 边界', 'The admission ticket and the epoch boundary'),
        body: LL(
          `<p>按票收取的手续费取消之后，取而代之的是<b>验证者准入费</b>（Validator Admission Ticket，SIMD-0357，按 SIMD-0525 随 slot 时长调整）。每个入选的验证者每个 epoch 从 <b>vote account</b> 付一次，费用被销毁。200 ms 的 slot 下约为 <b>0.8 SOL</b>，vote account 还必须另外保留免租金额。</p>
<p>关键在时间。bank 进入 epoch N 的那一刻，运行时选出 epoch N+1 的验证者集合，并从每个入选的 vote account 扣除准入费。此刻余额低于准入费加免租金额的 vote account，被排除在 N+1 之外：整个 epoch 不能投票、不能出块、没有奖励。N 开始之后再充值，最早只能赶上 N+2。vote account 必须在边界<b>之前</b>充好。</p>
<p>几条细节：</p>
<ul><li>vote account 中待发给委托人的奖励不计入准入余额。</li>
<li>任何人都能向 vote account 存钱：<code>solana transfer &lt;VOTE_ACCOUNT&gt; &lt;AMOUNT&gt;</code>。只有 withdraw authority 能取出。</li>
<li>可以让出块收入直接进入 vote account：<code>solana vote-update-commission-collector &lt;VOTE_ACCOUNT&gt; block-revenue &lt;VOTE_ACCOUNT&gt; &lt;AUTHORIZED_WITHDRAWER_KEYPAIR&gt;</code>。出块收入的变更在 E+2 生效，通胀奖励的变更在 E+1 生效。</li>
<li>准入失败有三个原因：找不到 vote account、没有 BLS 公钥、余额不足。admin RPC 方法 <code>validatorAdmissionTicketStatus</code> 提前两个 epoch 报告准入资格。</li></ul>
<p>告警据此设置：vote account 低于 <b>5 SOL</b> 即为 critical。5 SOL 够付好几个边界的准入费，告警响起时还有几天时间。identity 另有自己的下限 <b>9 SOL</b>。</p>`,
          `<p>With the per-vote fee gone, its place is taken by the <b>Validator Admission Ticket</b> (SIMD-0357, scaled to the slot time by SIMD-0525). Every admitted validator pays it from its <b>vote account</b> once per epoch, and the fee is burned. At 200 ms slots it is about <b>0.8 SOL</b>, and the vote account must also keep its rent-exempt minimum.</p>
<p>The timing is what matters. When the bank crosses into epoch N, the runtime picks the validator set for epoch N+1 and debits the ticket from each admitted vote account. A vote account below the ticket plus rent at that moment is left out of N+1: no voting, no block production and no rewards for that whole epoch. A top-up made after N has started counts from N+2 at the earliest. The vote account has to be funded <b>before</b> the boundary.</p>
<p>Some details:</p>
<ul><li>Pending delegator rewards held in the vote account do not count towards the ticket.</li>
<li>Anyone can deposit to a vote account: <code>solana transfer &lt;VOTE_ACCOUNT&gt; &lt;AMOUNT&gt;</code>. Only the withdraw authority can take SOL out.</li>
<li>Block revenue can go straight to the vote account: <code>solana vote-update-commission-collector &lt;VOTE_ACCOUNT&gt; block-revenue &lt;VOTE_ACCOUNT&gt; &lt;AUTHORIZED_WITHDRAWER_KEYPAIR&gt;</code>. Block revenue changes take effect at E+2, inflation reward changes at E+1.</li>
<li>Admission fails for one of three reasons: vote account not found, no BLS pubkey, or insufficient funds. The admin RPC method <code>validatorAdmissionTicketStatus</code> reports eligibility two epochs ahead.</li></ul>
<p>Alerts follow from this: a vote account below <b>5 SOL</b> is critical. 5 SOL covers several boundaries, so the page leaves days to act. The identity has its own floor of <b>9 SOL</b>.</p>`),
        widget: admission,
        quiz: [
          { q: LL('准入费从哪个账户扣？', 'Which account pays the admission ticket?'), options: [LL('identity', 'The identity'), LL('vote account', 'The vote account'), LL('委托人的 stake account', 'The delegators\' stake accounts'), LL('当前 leader', 'The current leader')], answer: 1, why: LL('准入费每个 epoch 从 vote account 扣一次。给 identity 充值不影响准入。', 'The ticket comes out of the vote account once per epoch. Funding the identity does nothing for admission.') },
          { q: LL('bank 进入 epoch N 时 vote account 余额不足，一小时后补足。验证者最早在哪个 epoch 重新投票？', 'The vote account was short when the bank entered epoch N, and it was topped up an hour later. In which epoch can the validator vote again at the earliest?'), options: [LL('N', 'N'), LL('N+1', 'N+1'), LL('N+2', 'N+2'), LL('N+3', 'N+3')], answer: 2, why: LL('进入 N 时已决定缺席 N+1。N 期间的充值在进入 N+1 时被计算，赶上 N+2。', 'Entering N already left it out of N+1. A top-up during N is counted on entering N+1, which admits it to N+2.') },
          { q: LL('vote account 有 1.2 SOL，其中 0.5 SOL 是待发给委托人的奖励。下一个边界能入选吗？', 'A vote account holds 1.2 SOL, of which 0.5 SOL are pending delegator rewards. Is it admitted at the next boundary?'), options: [LL('能，1.2 SOL 足够', 'Yes, 1.2 SOL is enough'), LL('不能，只有 0.7 SOL 计入，低于准入费加免租金额', 'No: only 0.7 SOL counts, which is below the ticket plus rent'), LL('能，奖励会先发放', 'Yes, the rewards are paid first'), LL('要看 identity 余额', 'It depends on the identity balance')], answer: 1, why: LL('待发给委托人的奖励不计入。0.7 SOL 小于约 0.827 SOL。', 'Pending delegator rewards do not count. 0.7 SOL is less than about 0.827 SOL.') },
        ],
      },
      {
        title: LL('delinquent、skip rate 与 credits', 'Delinquency, skip rate and credits'),
        body: LL(
          `<p>集群通过投票来评价验证者。<code>getVoteAccounts</code> 仍把验证者分成 <code>current</code> 和 <code>delinquent</code> 两个列表。最后一票落后链头超过 128 个 slot 时，RPC 节点把它列入 delinquent；200 ms 的 slot 下这只有约 26 秒。delinquent 的验证者挣不到投票奖励，质押池也可能撤走委托。</p>
<p><b>skip rate</b> 是验证者自己的 leader slot 中没有出块的比例。在 Alpenglow 下，离线 leader 的窗口很快变成 skip 证书，集群不会停下来等。被跳过的 slot 损失的是出块收入。</p>
<p><b>vote credits</b> 的含义变了。迁移之后，vote account 的 epoch credits 字段记录的是奖励 lamports，不再是票数；运行时在迁移的那个 epoch 写入了一行标记记录。有些 delinquent 的 vote account 显示 u64::MAX 这个标记值，把它当成 int64 解析的旧工具因此出错。每个 epoch 的投票奖励总额在 epoch 开始时就已确定，验证者的表现只影响它分到的份额。</p>
<p>监控仍可以把本 epoch 的 credits 与集群中位数相比，判断自己是否在正常投票，但读数的单位已经不是票数。</p>`,
          `<p>The cluster judges a validator by its votes. <code>getVoteAccounts</code> still has a <code>current</code> list and a <code>delinquent</code> list. When a validator's last vote is more than 128 slots behind the tip, RPC nodes list it as delinquent; at 200 ms that is only about 26 seconds. A delinquent validator earns no vote rewards, and stake pools may withdraw their delegation.</p>
<p><b>Skip rate</b> is the share of the validator's own leader slots that produced no block. Under Alpenglow an offline leader's window quickly becomes skip certificates, and the cluster does not wait. Skipped slots lose their block revenue.</p>
<p><b>Vote credits</b> changed meaning. After the migration, a vote account's epoch credits field counts reward lamports rather than votes, and the runtime wrote a sentinel row at the migration epoch. Some delinquent vote accounts show a u64::MAX sentinel, and older tools that parsed it as an int64 broke. The vote reward pool for an epoch is fixed at the start of the epoch; a validator's performance only changes its share.</p>
<p>Monitoring can still compare this epoch's credits with the cluster median to tell whether the validator is voting normally, but the unit is no longer votes.</p>`),
        widget: delinquency,
        quiz: [
          { q: LL('一个验证者的最后一票落后链头 200 个 slot，RPC 会怎么报告？', 'A validator\'s last vote is 200 slots behind the tip. What does RPC report?'), options: [LL('正常', 'Healthy'), LL('delinquent', 'Delinquent'), LL('skipped', 'Skipped'), LL('rooted', 'Rooted')], answer: 1, why: LL('超过 128 个 slot 即为 delinquent。', 'More than 128 slots behind means delinquent.') },
          { q: LL('200 ms 的 slot 下，128 个 slot 大约是多久？', 'At 200 ms slots, about how long are 128 slots?'), options: [LL('约 13 秒', 'About 13 s'), LL('约 26 秒', 'About 26 s'), LL('约 51 秒', 'About 51 s'), LL('约 2 分钟', 'About 2 minutes')], answer: 1, why: LL('128 × 0.2 秒 = 25.6 秒。400 ms 时是 51 秒。', '128 × 0.2 s = 25.6 s. At 400 ms it was 51 s.') },
          { q: LL('迁移到 Alpenglow 之后，vote account 的 epoch credits 字段记录的是什么？', 'After the move to Alpenglow, what does a vote account\'s epoch credits field count?'), options: [LL('票数', 'Votes'), LL('奖励 lamports', 'Reward lamports'), LL('跳过的 slot', 'Skipped slots'), LL('质押数量', 'Stake')], answer: 1, why: LL('字段名没变，含义变了。按票数解读它的工具需要更新。', 'The field kept its name and changed its meaning. Tools that read it as votes need updating.') },
        ],
      },
      {
        title: LL('质押、佣金与奖励', 'Stake, commission and rewards'),
        body: LL(
          `<p>持币人通过 <b>stake account</b> 把 SOL 委托给验证者。每个 stake account 有自己的 stake authority 和 withdraw authority，由委托人掌握。验证者从头到尾都控制不了委托进来的 SOL。</p>
<p>质押变动在 epoch 边界生效，现在大约每天一次。新委托在下一个 epoch 开始前处于<b>激活中</b>；解除委托的质押在边界之前仍然有效，过了边界才能取回。网络限制每个 epoch 能激活或解除的质押总量，所以很大的变动可能要跨好几个 epoch。</p>
<p>每个 epoch 开始时，网络结算上一个 epoch 的奖励，发到各个 stake account。验证者的<b>佣金</b>是从委托人通胀奖励中抽取的比例，进入 vote account。佣金只能在 epoch 的前半段修改。</p>
<p>验证者当 leader 时还有出块收入，默认进入 identity 账户。用 <code>vote-update-commission-collector</code> 可以把它改为进入 vote account，让准入费自动得到补充。很多验证者运行 Jito-Solana，这是 Agave 的一个分支，可以接收搜索者附带小费的交易包（MEV）。小费按验证者另设的 MEV 佣金，在验证者和委托人之间分配。</p>`,
          `<p>Holders delegate SOL to a validator through <b>stake accounts</b>. Each stake account has its own stake authority and withdraw authority, held by the delegator. The validator never controls delegated SOL.</p>
<p>Stake changes take effect at epoch boundaries, now about once a day. A new delegation is <b>activating</b> until the next epoch begins. Deactivating stake stays active until the boundary and can be withdrawn after it. The network limits how much stake can activate or deactivate per epoch, so very large changes can take several epochs.</p>
<p>At the start of each epoch, the network settles the previous epoch's rewards and pays them to the stake accounts. The validator's <b>commission</b> is its share of its delegators' inflation rewards, and it goes to the vote account. Commission can only be changed in the first half of an epoch.</p>
<p>As leader, a validator also earns block revenue, paid to the identity account by default. <code>vote-update-commission-collector</code> can send it to the vote account instead, which keeps the admission ticket topped up. Many validators run Jito-Solana, a fork of Agave that accepts bundles with tips from searchers (MEV). Tips are split between the validator and its stakers according to a separate MEV commission.</p>`),
        widget: rewards,
        quiz: [
          { q: LL('在 epoch 700 的一半时委托质押，它什么时候开始挣奖励？', 'Stake is delegated halfway through epoch 700. When does it start earning?'), options: [LL('立刻', 'Immediately'), LL('从 epoch 701 起，第一笔奖励在 epoch 702 开始时发放', 'From epoch 701, with the first reward paid at the start of epoch 702'), LL('7 天之后', 'After 7 days'), LL('从 epoch 700 起追溯计算', 'From epoch 700, backdated')], answer: 1, why: LL('委托在下一个 epoch 生效，这个 epoch 的奖励在再下一个 epoch 开始时发放。', 'Delegation takes effect at the next epoch, and that epoch\'s reward is paid as the following one begins.') },
          { q: LL('10% 的佣金拿走的是什么？', 'What does a 10% commission take?'), options: [LL('委托质押本金的 10%', '10% of the delegated stake'), LL('委托人通胀奖励的 10%，打进 vote account', '10% of the delegators\' inflation rewards, paid to the vote account'), LL('区块交易费的 10%', '10% of block fees'), LL('每笔交易的 10%', '10% of every transaction')], answer: 1, why: LL('佣金只作用于通胀奖励，本金始终在委托人的 stake account 里。', 'Commission applies to inflation rewards. The principal stays in the delegator\'s stake account.') },
          { q: LL('运维在 epoch 进行到 70% 时想改佣金，会怎样？', 'An operator wants to change the commission when the epoch is 70% through. What happens?'), options: [LL('立即生效', 'It takes effect at once'), LL('被拒绝，佣金只能在 epoch 的前半段修改', 'It is refused; commission can only change in the first half of an epoch'), LL('需要委托人同意', 'Delegators must approve it'), LL('需要 identity 签名', 'The identity must sign it')], answer: 1, why: LL('等下一个 epoch 的前半段再改。', 'Wait for the first half of the next epoch.') },
        ],
      },
      {
        title: LL('快照与追块', 'Snapshots and catch-up'),
        body: LL(
          `<p>新启动或重启的验证者不会从创世块开始重放，而是加载一个<b>快照</b>：某个 slot 时刻的完整账户状态。<b>全量快照</b>包含全部状态，每隔数万个 slot 生成一次；<b>增量快照</b>只包含上一个全量快照之后的变化，生成得频繁得多。用全量快照加上一份较新的增量快照启动，需要重放的差距就很小。</p>
<p>启动时 Agave 先找本地快照。如果它比其他节点提供的最新快照落后超过 <code>--maximum-local-snapshot-age</code>（默认 2,500 个 slot，200 ms 下约 8 分钟），就下载新的。<code>--known-validator</code> 加上 <code>--only-known-rpc</code>，把下载来源限制在你信任的节点上：快照里的状态会被直接接受，节点不会自己重新推导一遍。</p>
<p><code>--no-snapshot-fetch</code> 强制使用本地快照。短暂重启时它省去一次下载；长时间停机之后，它会留下一大段差距，只能靠 repair 从其他节点补，而 repair 的速度可能还赶不上集群出块。slot 缩短到 200 ms 之后，同样的停机时间对应的 slot 数翻了一倍：停机一天就是整整一个 epoch。</p>
<p><code>solana catchup --our-localhost</code> 把本节点与集群对比，报告它是在追赶还是在落后：</p>
<pre class="term-snip">$ solana catchup --our-localhost
8vRtQm4K… has 2310 slot(s) behind (us:488390110 them:488392420), our node is gaining at 25.0 slots/second
8vRtQm4K… has caught up (us:488392530 them:488392530)</pre>`,
          `<p>A new or restarted validator does not replay the chain from genesis. It loads a <b>snapshot</b>: the full account state at one slot. A <b>full snapshot</b> holds everything and is produced every several tens of thousands of slots. An <b>incremental snapshot</b> holds only the changes since the last full one and is produced much more often. Starting from a full snapshot plus a recent incremental one leaves only a short gap to replay.</p>
<p>At startup Agave looks for a local snapshot. If it is further behind the newest snapshot that peers offer than <code>--maximum-local-snapshot-age</code> (2,500 slots by default, about 8 minutes at 200 ms), it downloads a new one. <code>--known-validator</code> with <code>--only-known-rpc</code> limits downloads to nodes you trust: the state in a snapshot is accepted as it is, not re-derived by the node.</p>
<p><code>--no-snapshot-fetch</code> forces the local snapshot. After a short restart it saves a download. After a long outage it leaves a large gap that can only be filled by repair from peers, which may be slower than the cluster produces slots. With 200 ms slots, the same outage spans twice as many slots as before: a day offline is a whole epoch.</p>
<p><code>solana catchup --our-localhost</code> compares the node with the cluster and reports whether it is gaining or falling behind:</p>
<pre class="term-snip">$ solana catchup --our-localhost
8vRtQm4K… has 2310 slot(s) behind (us:488390110 them:488392420), our node is gaining at 25.0 slots/second
8vRtQm4K… has caught up (us:488392530 them:488392530)</pre>`),
        widget: snapshots,
        quiz: [
          { q: LL('验证者停机两天后带着 --no-snapshot-fetch 重启，最可能的结果是？', 'A validator was offline for two days and restarts with --no-snapshot-fetch. What is the likely result?'), options: [LL('几秒钟就追上', 'It catches up in seconds'), LL('加载旧的本地快照，一边 repair 一边越落越远', 'It loads an old local snapshot and falls further behind while repairing'), LL('拒绝启动', 'It refuses to start'), LL('照样下载新快照', 'It downloads a fresh snapshot anyway')], answer: 1, why: LL('两天约 864,000 个 slot，只能靠 repair 补，速度跟不上集群。', 'Two days is about 864,000 slots. They can only come from repair, which cannot keep up with the cluster.') },
          { q: LL('为什么要把 --known-validator 和 --only-known-rpc 一起用？', 'Why use --known-validator together with --only-known-rpc?'), options: [LL('获得更多质押', 'To attract more stake'), LL('只从可信节点下载快照，因为节点会直接采信快照中的状态', 'To download snapshots only from trusted nodes, because the node accepts snapshot state as given'), LL('加快 gossip', 'To speed up gossip'), LL('决定 leader 顺序', 'To choose the leader order')], answer: 1, why: LL('快照决定了节点的起点状态，来源必须可信。', 'A snapshot sets the node\'s starting state, so its source must be trusted.') },
        ],
      },
    ],
  });

  /* ---------- step 2: build a testnet validator on a new host ---------- */
  const H = () => S.networks.solana.helpers;
  const ID = '8vRtQm4KcZ7wLx2NbYp9HsJd3Fa6Ue5GkT1nWq7XzMpA', VOTE = 'Vt3kPq8WmZ2xRc6NbLd9Hf5Jy7Ts4Ua1GeK3nQrW8sMx', WD = 'Wd9pLq4XkT7mVz2NcR8bHs5Jy3Fa6GeU1oKt4Pw7Qn2Y';
  const KP = '/home/sol/validator-keypair.json';
  const SYSCTL = String.raw`printf 'net.core.rmem_default = 134217728\nnet.core.rmem_max = 134217728\nnet.core.wmem_default = 134217728\nnet.core.wmem_max = 134217728\nvm.max_map_count = 1000000\nfs.nr_open = 1000000\n' > /etc/sysctl.d/21-agave-validator.conf`;
  const SCRIPT = String.raw`printf '#!/bin/bash\nexec agave-validator \\\n  --identity /home/sol/validator-keypair.json \\\n  --vote-account /home/sol/vote-account-keypair.json \\\n  --known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \\\n  --known-validator dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92 \\\n  --only-known-rpc \\\n  --entrypoint entrypoint.testnet.solana.com:8001 \\\n  --entrypoint entrypoint2.testnet.solana.com:8001 \\\n  --expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\\n  --ledger /mnt/ledger \\\n  --accounts /mnt/accounts \\\n  --limit-ledger-size \\\n  --dynamic-port-range 8000-8020 \\\n  --rpc-port 8899 \\\n  --private-rpc \\\n  --wal-recovery-mode skip_any_corrupted_record \\\n  --log -\n' > /home/sol/bin/validator.sh`;
  const UNIT = String.raw`printf '[Unit]\nDescription=Agave validator (testnet)\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=sol\nLimitNOFILE=1000000\nLimitMEMLOCK=2000000000\nRestart=on-failure\nRestartSec=5\nExecStart=/home/sol/bin/validator.sh\n\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/agave-validator.service`;
  const c = s => `<code>${S.esc(s)}</code>`;
  const node = w => w.nodes['sol-new'];
  const kpOn = (w, h, p) => { const f = S.fsGet(h, p); return f && typeof f.c === 'string' ? H().pubkeyOf(w, f.c) : null; };
  const serverId = w => kpOn(w, node(w), KP);
  const laptopKeys = w => Object.keys(w.laptop.fs).filter(p => !['/home/ops/funding-testnet.json', '/home/ops/.config/solana/id.json'].includes(p)).map(p => kpOn(w, w.laptop, p)).filter(Boolean);
  const scriptOk = w => {
    const n = node(w), f = S.fsGet(n, '/home/sol/bin/validator.sh');
    if (!f || !H().execBit(f.mode)) return false;
    const t = String(S.fsRead(w, n, '/home/sol/bin/validator.sh') || '').replace(/\\\n/g, ' ');
    return [/--identity\s+\S+/, /--vote-account\s+\S+/, /--known-validator\s+\S+/, new RegExp('--expected-genesis-hash\\s+' + H().TESTNET_GENESIS), /--entrypoint\s+\S*testnet\S*/, /--ledger\s+\/mnt\/ledger/, /--accounts\s+\/mnt\/accounts/, /--limit-ledger-size/, /--dynamic-port-range\s+8000-8020/, /--rpc-port\s+\d+/].every(re => re.test(t));
  };
  const svcOf = w => node(w).services['agave-validator'];

  S.registerScenario({
    id: 'sol-run', network: 'solana', module: LL('Solana 验证者运维', 'Solana validator operations'), lab: 'R1', difficulty: 1, minutes: 30,
    title: LL('从零搭建 testnet 验证者', 'Build a testnet validator from scratch'),
    tagline: LL('在一台全新的 Ubuntu 主机上搭起 Agave testnet 验证者，从内核调优、BLS 公钥和准入费，一直到进入验证者集合后的第一票。', 'Bring up an Agave testnet validator on a new Ubuntu host, from kernel tuning through the BLS key and the admission ticket to its first vote in the validator set.'),
    learn: [
      LL('验证者主机需要什么：网络缓冲区、文件句柄上限、开放端口', 'What a validator host needs: network buffers, file limits, open ports'),
      LL('哪些钥匙放在服务器上，哪些必须离线；登记 BLS 公钥', 'Which keys go on the server and which stay offline, and registering the BLS key'),
      LL('在边界之前给 vote account 充值，等它进入验证者集合，再确认第一票', 'Funding the vote account before the boundary, waiting for admission, and confirming the first vote'),
    ],
    brief: LL(
      `<p>us-west-2 有一台新装好的 Ubuntu 24.04 主机 <b>sol-new</b>：32 核、384 GiB 内存，系统盘之外还有两块 NVMe，分别挂载在 <code>/mnt/ledger</code> 和 <code>/mnt/accounts</code>。除此之外什么都没装。</p><p>在它上面搭一台 Solana <b>testnet</b> 验证者。testnet 和 mainnet 都运行 Alpenglow：slot 为 200 ms，一个 epoch 约一天；验证者要登记 BLS 公钥，并在 epoch 边界之前给 vote account 充好准入费，才会被选入验证者集合。</p><p>步骤：调好系统，从发布标签编译 Agave v4.3.x，生成钥匙、创建 vote account、登记 BLS 公钥并充值，写好启动脚本和 systemd unit，让节点追上集群，然后等它进入验证者集合并开始投票。当前 epoch 还剩约 8 小时。等待边界时把右上角的时钟调到 3600×。每一步完成后，都会解释它对应的基础知识。</p><p>工作电脑上的说明在 <code>~/NOTES.md</code>。那里的 CLI 默认连接 mainnet，默认 keypair 里是 mainnet 的 SOL。</p>`,
      `<p>A new Ubuntu 24.04 host, <b>sol-new</b>, is ready in us-west-2: 32 cores, 384 GiB of memory, and besides the system disk two NVMe drives mounted at <code>/mnt/ledger</code> and <code>/mnt/accounts</code>. Nothing else is installed.</p><p>Build a Solana <b>testnet</b> validator on it. Testnet and mainnet both run Alpenglow: 200 ms slots and epochs of about a day. A validator joins the validator set only once its vote account has a BLS key registered and holds the admission ticket before an epoch boundary.</p><p>The steps: tune the system, build Agave v4.3.x from a release tag, create the keys and the vote account, register the BLS key and fund the vote account, write the startup script and the systemd unit, let the node catch up, then wait for it to join the set and vote. The current epoch has about 8 hours left. While waiting for a boundary, set the clock at the top right to 3600×. After each step the lab explains the concept behind it.</p><p>The workstation notes are in <code>~/NOTES.md</code>. The CLI there defaults to mainnet, and its default keypair holds mainnet SOL.</p>`),
    startAt: '2026-11-05T09:00:00Z',
    config: { fresh: true, epoch: 1131, toBoundary: 8 * 3600 },
    // each how is one paragraph: the goals box lays out its direct children as a grid
    steps: [
      {
        text: LL('检查 sol-new 的硬件', 'Check the hardware of sol-new'),
        how: LL(`登录后看看 CPU、内存和磁盘：${c('ssm sol-new')}、${c('sudo -i')}、${c('nproc')}、${c('free -g')}、${c('lsblk')}、${c('df -h')}。`, `Log in and look at the CPU, memory and disks: ${c('ssm sol-new')}, ${c('sudo -i')}, ${c('nproc')}, ${c('free -g')}, ${c('lsblk')}, ${c('df -h')}.`),
        after: LL('ledger 和 accounts 数据库各占一块 NVMe。两者都在不停写入，放在同一块盘上会互相争抢 I/O，验证者就会落后。testnet 的要求比主网低；为主网采购机器之前，先查 Anza 当前的硬件建议。', 'The ledger and the accounts database each get their own NVMe drive. Both write constantly; on one drive they compete for I/O and the validator falls behind. Testnet needs less than mainnet. Before ordering a mainnet machine, check Anza\'s current hardware recommendations.'),
        check: w => w.flags.fresh_disks !== undefined,
      },
      {
        text: LL('调整内核参数，开放验证者端口', 'Tune the kernel and open the validator ports'),
        how: LL(`写入 Agave 需要的 sysctl 设置并加载：${c(SYSCTL)}，然后 ${c('sysctl -p /etc/sysctl.d/21-agave-validator.conf')}。开放端口段：${c('ufw allow 8000:8020/tcp')}、${c('ufw allow 8000:8020/udp')}，再用 ${c('ufw status')} 确认。`, `Write the sysctl settings Agave expects and load them: ${c(SYSCTL)}, then ${c('sysctl -p /etc/sysctl.d/21-agave-validator.conf')}. Open the port range: ${c('ufw allow 8000:8020/tcp')}, ${c('ufw allow 8000:8020/udp')}, and check with ${c('ufw status')}.`),
        after: LL('Agave 收发大量 UDP 流量，并把 accounts 数据库映射进内存。启动时它会检查 UDP 缓冲区大小，太小就直接退出。gossip、TPU、TVU、repair 和投票消息都从 <code>--dynamic-port-range</code> 中取端口；gossip 还需要 TCP，其他节点靠它确认本节点可达。文件句柄上限稍后在 systemd unit 里设置。', 'Agave moves a lot of UDP traffic and maps the accounts database into memory. At startup it checks the UDP buffer sizes and exits if they are too small. Gossip, TPU, TVU, repair and vote messages all take ports from <code>--dynamic-port-range</code>; gossip also needs TCP, which peers use to confirm the node is reachable. The file-descriptor limit is set later, in the systemd unit.'),
        check: w => { const n = node(w); return H().netOk(n) && n.sysctl['vm.max_map_count'] >= 1000000 && H().portsOpen(n, 8000, 8020); },
      },
      {
        text: LL('从发布标签编译 Agave v4.3.x', 'Build Agave v4.3.x from a release tag'),
        how: LL(`Anza 以源码形式发布版本，验证者程序由运维自己编译。v4.3.x 是 Alpenglow 的发布线。克隆发布标签，把程序装到 /usr/local/bin：${c('git clone --branch v4.3.2 --depth 1 https://github.com/anza-xyz/agave.git /opt/agave')}、${c('/opt/agave/scripts/cargo-install-all.sh /usr/local')}，然后 ${c('agave-validator --version')}。编译要几分钟模拟时间，可以先把时钟调快。`, `Anza releases source code, and operators build the validator themselves. v4.3.x is the Alpenglow release line. Clone the release tag and install the binaries into /usr/local/bin: ${c('git clone --branch v4.3.2 --depth 1 https://github.com/anza-xyz/agave.git /opt/agave')}, ${c('/opt/agave/scripts/cargo-install-all.sh /usr/local')}, then ${c('agave-validator --version')}. The build takes several simulated minutes; speed up the clock meanwhile.`),
        after: LL('只从发布标签编译，不要用 master。版本号是集群认识你的一部分：<code>solana gossip</code> 会显示它，功能激活依赖它。早于 4.3 的版本不能参与 Alpenglow 的共识；激活之前，testnet 上运行 Frankendancer 的节点也必须换成 Agave 4.3。同一次编译还装好了 <code>solana</code> 和 <code>solana-keygen</code>，登记 BLS 公钥需要 CLI 4.1.0 或更高版本。', 'Build from a release tag, never from master. The version is part of how the cluster sees you: <code>solana gossip</code> shows it, and feature activations depend on it. Versions before 4.3 cannot take part in Alpenglow consensus; before activation, testnet nodes on Frankendancer had to switch to Agave 4.3 as well. The same build installs <code>solana</code> and <code>solana-keygen</code>; registering the BLS key needs CLI 4.1.0 or later.'),
        check: w => /^4\.3\./.test(H().binAt(w, node(w), '/usr/local/bin/agave-validator') || '') && w.flags.agave_version !== undefined,
      },
      {
        text: LL('在服务器上生成 identity 和 vote account keypair', 'Generate the identity and vote account keypairs on the server'),
        how: LL(`${c('solana-keygen new --no-bip39-passphrase -o /home/sol/validator-keypair.json')}、${c('solana-keygen new --no-bip39-passphrase -o /home/sol/vote-account-keypair.json')}。服务将以 <code>sol</code> 用户运行，把两个文件交给它：${c('chown sol:sol /home/sol/validator-keypair.json /home/sol/vote-account-keypair.json')}。`, `${c('solana-keygen new --no-bip39-passphrase -o /home/sol/validator-keypair.json')}, ${c('solana-keygen new --no-bip39-passphrase -o /home/sol/vote-account-keypair.json')}. The service will run as <code>sol</code>, so hand both files to it: ${c('chown sol:sol /home/sol/validator-keypair.json /home/sol/vote-account-keypair.json')}.`),
        after: LL('identity 签每一票和每个块，也是默认的 authorized voter，BLS 公钥由它派生，所以必须在服务器上。vote account keypair 只在创建 vote account 时签一次名，之后没有任何权限（基础课第 2 章）。withdrawer 不在这里生成。', 'The identity signs every vote and every block. It is also the default authorized voter, and the BLS key is derived from it, so it has to live on the server. The vote account keypair signs only the creation of the vote account and has no authority afterwards (Fundamentals, chapter 2). The withdrawer is not generated here.'),
        check: w => { const n = node(w); return [KP, '/home/sol/vote-account-keypair.json'].every(p => { const f = S.fsGet(n, p); return f && f.owner === 'sol' && kpOn(w, n, p); }); },
      },
      {
        text: LL('在工作电脑上生成 authorized withdrawer', 'Generate the authorized withdrawer on the workstation'),
        how: LL(`回到工作电脑：${c('exit')}（退出 root），再 ${c('exit')}。在那里生成：${c('solana-keygen new -o ~/authorized-withdrawer-keypair.json')}。输出里有它的公钥，也可以用 ${c('solana-keygen pubkey ~/authorized-withdrawer-keypair.json')} 再看一次。`, `Return to the workstation: ${c('exit')} (leaves root), then ${c('exit')} again. Generate the key there: ${c('solana-keygen new -o ~/authorized-withdrawer-keypair.json')}. The output shows its pubkey; ${c('solana-keygen pubkey ~/authorized-withdrawer-keypair.json')} shows it again.`),
        after: LL('withdrawer 能取走 vote account 的钱、修改佣金、更换 identity。vote account 现在还存着准入费，取款的权限因此更要紧。如果它放在服务器上，任何拿到 root 的人都能夺走这台验证者的收入。生产环境里它放在硬件钱包或离线机器上，助记词另外保存。', 'The withdrawer can empty the vote account, change the commission and reassign the identity. The vote account now also holds the admission ticket money, which makes that power matter more. On the server, anyone who gained root would own the validator\'s income. In production it lives on a hardware wallet or an offline machine, with the seed phrase stored apart from it.'),
        check: w => laptopKeys(w).length > 0,
      },
      {
        text: LL('在 testnet 上给 identity 充值', 'Fund the identity on testnet'),
        how: LL(`新账户在收到 SOL 之前并不存在，所以 CLI 要求确认：${c(`solana transfer ${ID} 20 --from ~/funding-testnet.json --allow-unfunded-recipient -ut`)}。查看余额：${c(`solana balance ${ID} -ut`)}。`, `A new account does not exist until it holds SOL, so the CLI asks for confirmation: ${c(`solana transfer ${ID} 20 --from ~/funding-testnet.json --allow-unfunded-recipient -ut`)}. Check it: ${c(`solana balance ${ID} -ut`)}.`),
        after: LL('identity 付 vote account 的免租金额和登记 BLS 公钥的交易费，之后支付普通交易费、收出块收入。它不再为投票付费，但告警仍在低于 9 SOL 时响。每条命令都用 <code>-ut</code> 写明集群，用 <code>--from</code> 写明付款方。在这台电脑上漏掉其中任何一个，转出去的都是默认 keypair 里的 mainnet SOL。', 'The identity pays the vote account\'s rent and the fee for registering the BLS key; after that it pays ordinary transaction fees and receives block revenue. It no longer pays for votes, but its alert still fires below 9 SOL. Every command named the cluster with <code>-ut</code> and the payer with <code>--from</code>. Leave either out on this workstation and the transfer spends mainnet SOL from the default keypair.'),
        check: w => !!serverId(w) && H().testnetBal(w, serverId(w)) >= 10,
      },
      {
        text: LL('创建 vote account', 'Create the vote account'),
        how: LL(`回到服务器：${c('ssm sol-new')}、${c('sudo -i')}。在 testnet 上创建，由 identity 付费，withdrawer 只给公钥：${c(`solana create-vote-account -ut --fee-payer ${KP} --commission 10 /home/sol/vote-account-keypair.json ${KP} ${WD}`)}。查看结果：${c(`solana vote-account ${VOTE} -ut`)}。`, `Back on the server: ${c('ssm sol-new')}, ${c('sudo -i')}. Create it on testnet, with the identity paying and the withdrawer given only by its pubkey: ${c(`solana create-vote-account -ut --fee-payer ${KP} --commission 10 /home/sol/vote-account-keypair.json ${KP} ${WD}`)}. Inspect it: ${c(`solana vote-account ${VOTE} -ut`)}.`),
        after: LL('vote account 把 identity 和它的投票、credits 绑在一起。withdrawer 只以公钥出现，私钥从没碰过服务器。佣金要明确指定：CLI 的默认值是 100%，会拿走委托人的全部通胀奖励。新账户里只有免租金额，还付不起准入费；输出里的 <code>BLS Public Key</code> 一行也还是空的。', 'The vote account ties the identity to its votes and credits. The withdrawer appears only as a pubkey; its private key never touched the server. Set the commission explicitly: the CLI default is 100%, which keeps all of the delegators\' inflation rewards. The new account holds only its rent-exempt minimum, not the ticket, and the <code>BLS Public Key</code> line in the output is still empty.'),
        check: w => { const ch = w.chain; return !!ch.vote && ch.identity === serverId(w) && laptopKeys(w).includes(ch.withdrawer); },
      },
      {
        text: LL('登记 BLS 公钥并核对', 'Register the BLS key and verify it'),
        how: LL(`先看由 identity（authorized voter）派生的 BLS 公钥：${c(`solana-keygen bls_pubkey ${KP}`)}。把它写进 vote account，voter 保持不变：${c(`solana vote-authorize-voter-checked -ut --fee-payer ${KP} ${VOTE} ${KP} ${KP}`)}。核对：${c(`solana vote-account ${VOTE} -ut | grep "BLS Public Key"`)}。`, `First look at the BLS key derived from the identity, the authorized voter: ${c(`solana-keygen bls_pubkey ${KP}`)}. Write it into the vote account, keeping the voter unchanged: ${c(`solana vote-authorize-voter-checked -ut --fee-payer ${KP} ${VOTE} ${KP} ${KP}`)}. Verify: ${c(`solana vote-account ${VOTE} -ut | grep "BLS Public Key"`)}.`),
        after: LL('Votor 用 BLS 签名把许多验证者的票聚合成一张证书。没有登记 BLS 公钥的 vote account 在边界时准入失败，原因是 "no BLS pubkey"，验证者被排除在共识之外。不管 vote account 是用什么工具创建的，都要登记并用 grep 核对这一行（基础课第 2 章）。', 'Votor aggregates the votes of many validators into one certificate with BLS signatures. A vote account without a BLS key fails admission at the boundary with "no BLS pubkey", and the validator is excluded from consensus. Whatever tool created the vote account, register the key and check that line with grep (Fundamentals, chapter 2).'),
        check: w => !!w.chain.bls && w.flags.bls_seen !== undefined,
      },
      {
        text: LL('在边界之前给 vote account 充值', 'Fund the vote account before the boundary'),
        how: LL(`回到工作电脑（${c('exit')}、${c('exit')}），看还剩多少时间：${c('solana epoch-info -ut')}。转入准入费、免租金额和余量，余额要在 5 SOL 的告警线之上：${c(`solana transfer ${VOTE} 8 --from ~/funding-testnet.json -ut`)}。可选：让出块收入进入 vote account，withdrawer 在这台电脑上签名：${c(`solana vote-update-commission-collector ${VOTE} block-revenue ${VOTE} ~/authorized-withdrawer-keypair.json -ut`)}。`, `Back on the workstation (${c('exit')}, ${c('exit')}), check how much time is left: ${c('solana epoch-info -ut')}. Send the ticket, the rent and a margin, enough to stay above the 5 SOL alert floor: ${c(`solana transfer ${VOTE} 8 --from ~/funding-testnet.json -ut`)}. Optional: send block revenue to the vote account, signed by the withdrawer on this workstation: ${c(`solana vote-update-commission-collector ${VOTE} block-revenue ${VOTE} ~/authorized-withdrawer-keypair.json -ut`)}.`),
        after: LL('bank 进入下一个 epoch 的那一刻，会选出再下一个 epoch 的验证者集合，并从 vote account 扣 0.8 SOL。此刻余额不足准入费加免租金额，或者没有 BLS 公钥，就要再等一整个 epoch（基础课第 4 章）。8 SOL 够付好几个边界。出块收入的收款账户变更在两个 epoch 之后生效；这台验证者还没有质押，也就没有出块收入，这个设置是为以后准备的。', 'The moment the bank enters the next epoch, it picks the set for the epoch after and debits 0.8 SOL from the vote account. If the balance is short of the ticket plus rent then, or the BLS key is missing, the validator waits a whole extra epoch (Fundamentals, chapter 4). 8 SOL covers several boundaries. A block revenue collector change takes effect two epochs later; this validator has no stake and so no block revenue yet, so the setting is for later.'),
        check: w => H().voteBal(w) >= H().VOTE_FLOOR,
      },
      {
        text: LL('写启动脚本', 'Write the startup script'),
        how: LL(`回到服务器（${c('ssm sol-new')}、${c('sudo -i')}），${c('mkdir -p /home/sol/bin')}，然后写入脚本：${c(SCRIPT)}。加上执行权限并检查内容：${c('chmod 755 /home/sol/bin/validator.sh')}、${c('cat /home/sol/bin/validator.sh')}。`, `Back on the server (${c('ssm sol-new')}, ${c('sudo -i')}), ${c('mkdir -p /home/sol/bin')}, then write the script: ${c(SCRIPT)}. Make it executable and read it back: ${c('chmod 755 /home/sol/bin/validator.sh')}, ${c('cat /home/sol/bin/validator.sh')}.`),
        after: LL('每个参数都有用处。<code>--entrypoint</code> 和 <code>--expected-genesis-hash</code> 把节点固定在 testnet，genesis hash 不对时节点直接停下，不会加入别的集群。<code>--known-validator</code> 和 <code>--only-known-rpc</code> 只从可信节点下载快照（基础课第 7 章）。<code>--ledger</code> 和 <code>--accounts</code> 让两个数据库各用一块盘；vote history 文件也写在 ledger 目录里。<code>--limit-ledger-size</code> 防止 ledger 写满磁盘。<code>--private-rpc</code> 不对外公布 RPC 端口。', 'Each flag has a job. <code>--entrypoint</code> and <code>--expected-genesis-hash</code> pin the node to testnet; with a wrong genesis hash it stops instead of joining another cluster. <code>--known-validator</code> with <code>--only-known-rpc</code> takes snapshots only from trusted nodes (Fundamentals, chapter 7). <code>--ledger</code> and <code>--accounts</code> give each database its own drive, and the vote history file is written in the ledger directory. <code>--limit-ledger-size</code> keeps the ledger from filling the disk. <code>--private-rpc</code> does not advertise the RPC port.'),
        check: scriptOk,
      },
      {
        text: LL('安装 systemd unit 并启动验证者', 'Install the systemd unit and start the validator'),
        how: LL(`${c(UNIT)}、${c('systemctl daemon-reload')}、${c('systemctl enable --now agave-validator')}。用 ${c('agave-validator -l /mnt/ledger monitor')} 观察启动（Ctrl+C 退出），启动失败时看 ${c('journalctl -u agave-validator -n 20 --no-pager')}。启动检查全部通过、开始下载快照时，这一步完成。`, `${c(UNIT)}, ${c('systemctl daemon-reload')}, ${c('systemctl enable --now agave-validator')}. Watch startup with ${c('agave-validator -l /mnt/ledger monitor')} (Ctrl+C to stop); if it fails, read ${c('journalctl -u agave-validator -n 20 --no-pager')}. The step completes when the startup checks pass and the snapshot download begins.`),
        after: LL('下载任何东西之前，Agave 先检查了 UDP 缓冲区、读取 identity、确认入口节点能连到自己的端口、核对 genesis hash，并确认 vote account 存在且属于这个 identity。<code>LimitNOFILE=1000000</code> 在打开 blockstore 时才用到：缺了它，验证者会先下载完快照，然后退出。<code>User=sol</code> 让进程不以 root 运行。', 'Before downloading anything, Agave checked the UDP buffers, read the identity, confirmed that the entrypoint can reach its ports, matched the genesis hash, and confirmed that the vote account exists and belongs to this identity. <code>LimitNOFILE=1000000</code> matters when the blockstore opens: without it the validator downloads the snapshot and then exits. <code>User=sol</code> keeps the process off root.'),
        check: w => { const s = svcOf(w); return s.state === 'active' && s.enabled === true && ['download', 'load', 'run'].includes(node(w).sol.phase); },
      },
      {
        text: LL('等待节点追上集群', 'Wait for the node to catch up'),
        how: LL(`快照加载完、RPC 起来之后，${c('solana catchup --our-localhost')} 才有回应。重复执行，直到它报告 <code>has caught up</code>。`, `${c('solana catchup --our-localhost')} answers once RPC is up, after the snapshot has loaded. Repeat it until it reports <code>has caught up</code>.`),
        after: LL('节点从 known validator 下载了快照，加载后重放此后产生的 slot，一点点追近集群，直到到达链头（基础课第 7 章）。它现在与集群同步，但还不在验证者集合里，所以还不投票：机制面板显示"已同步，不在验证者集合中"。', 'The node downloaded a snapshot from a known validator, loaded it, then replayed the slots produced since, gaining on the cluster until it reached the tip (Fundamentals, chapter 7). It is now in sync but not yet in the validator set, so it does not vote: the mechanism panel shows "in sync, not in the validator set".'),
        check: w => { const n = node(w); return svcOf(w).state === 'active' && n.sol.phase === 'run' && n.sol.catchup <= 0; },
      },
      {
        text: LL('越过 epoch 边界，确认入选', 'Cross the epoch boundary and confirm admission'),
        how: LL(`把右上角的时钟调到 3600×。${c('solana epoch-info -ut')} 显示离边界还有多久。bank 进入下一个 epoch 时，事件日志会显示准入费被扣除、验证者被选入再下一个 epoch。用 ${c(`solana vote-account ${VOTE} -ut`)} 确认余额少了 0.8 SOL。`, `Set the clock at the top right to 3600×. ${c('solana epoch-info -ut')} shows the time left to the boundary. When the bank enters the next epoch, the event log shows the ticket debited and the validator admitted to the epoch after. Confirm with ${c(`solana vote-account ${VOTE} -ut`)} that the balance fell by 0.8 SOL.`),
        after: LL('边界上，运行时按当时的 vote account 余额和 BLS 公钥决定了再下一个 epoch 的集合，并扣了准入费。新验证者因此要等两个边界：第一个边界决定它入选，第二个边界开始它入选的那个 epoch。在生产环境中，admin RPC 方法 <code>validatorAdmissionTicketStatus</code> 会提前两个 epoch 报告准入资格。', 'At the boundary, the runtime decided the set for the epoch after next from the vote account balance and the BLS key at that moment, and debited the ticket. A new validator therefore waits for two boundaries: the first admits it, and the second begins the epoch it was admitted to. In production, the admin RPC method <code>validatorAdmissionTicketStatus</code> reports eligibility two epochs ahead.'),
        check: w => w.flags.admitted !== undefined,
      },
      {
        text: LL('入选的 epoch 开始后，在链上确认验证者正在投票', 'Once the admitted epoch begins, confirm on chain that the validator votes'),
        how: LL(`保持 3600×，等下一个边界。之后回到工作电脑（${c('exit')}、${c('exit')}）：${c('solana validators -ut')}、${c(`solana gossip -ut | grep ${ID}`)}、${c(`solana vote-account ${VOTE} -ut`)}。credits 随投票增加。`, `Keep 3600× and wait for the next boundary. Then, from the workstation (${c('exit')}, ${c('exit')}): ${c('solana validators -ut')}, ${c(`solana gossip -ut | grep ${ID}`)}, ${c(`solana vote-account ${VOTE} -ut`)}. Credits grow as it votes.`),
        after: LL('gossip 说明节点可达，验证者列表说明它正在投票。投票是直接发给其他验证者的消息，identity 余额不会因此减少；每个边界从 vote account 扣一次准入费。没有质押的验证者只有在投票时才出现在列表里，在有人委托质押之前没有通胀奖励（基础课第 6 章）。', 'Gossip shows the node is reachable; the validator list shows it voting. Votes are messages sent directly to other validators, so the identity balance does not fall; each boundary takes the ticket from the vote account. An unstaked validator appears in the list only while it votes, and earns no inflation rewards until stake is delegated to it (Fundamentals, chapter 6).'),
        check: w => H().isVoting(w, node(w)) && w.chain.credits > 0 && w.flags.fresh_seen !== undefined,
      },
      {
        text: LL('练习安全重启的习惯', 'Practise the safe-restart habit'),
        how: LL(`在服务器上（${c('ssm sol-new')}、${c('sudo -i')}）：${c('agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2')}。`, `On the server (${c('ssm sol-new')}, ${c('sudo -i')}): ${c('agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2')}.`),
        after: LL('<code>wait-for-restart-window</code> 等到验证者在指定时间内没有 leader slot、集群中 delinquent 的质押也足够少时才返回，这时重启不会让自己的 leader 窗口变成 skip 证书。这台验证者还没有质押，没有 leader slot，所以立即返回。有了质押之后，每次计划内重启都先运行它，再执行 <code>systemctl restart agave-validator</code>。200 ms 的 slot 下，停投约 26 秒就会被标记为 delinquent。', '<code>wait-for-restart-window</code> returns once the validator has no leader slots within the idle time given and the cluster\'s delinquent stake is low enough, so a restart does not turn its own leader window into skip certificates. This validator has no stake and no leader slots yet, so it returns at once. Once it is staked, run it before every planned restart, then <code>systemctl restart agave-validator</code>. At 200 ms slots, about 26 seconds without voting marks it delinquent.'),
        check: w => w.flags.restart_window !== undefined,
      },
    ].map(st => Object.assign(st, { how: LL(`<p>${st.how.zh}</p>`, `<p>${st.how.en}</p>`) })),
    forbidden: [
      { flag: 'withdrawer_hot', text: LL('把 authorized withdrawer 的 keypair 放到验证者主机上', 'Putting the authorized withdrawer keypair on the validator host') },
      { flag: 'mainnet_spend', text: LL('搭建 testnet 验证者时花掉了 mainnet 的 SOL', 'Spending mainnet SOL while setting up a testnet validator') },
    ],
    limit: 4 * 86400,
    score: w => {
      const ch = w.chain, first = ch.startEpoch + 2;
      return [
        [LL('第一个入选的 epoch', 'First epoch in the set'), ch.firstAdmitted != null ? String(ch.firstAdmitted) : '—', ch.firstAdmitted === first ? 'good' : 'mid'],
        [LL('佣金', 'Commission'), ch.commission != null ? `${ch.commission}%` : '—', ch.commission != null && ch.commission <= 10 ? 'good' : 'mid'],
        [LL('vote account 余额（testnet）', 'Vote account balance (testnet)'), ch.vote ? `◎ ${H().voteBal(w).toFixed(3)}` : '—', ch.vote && H().voteBal(w) >= H().VOTE_FLOOR ? 'good' : 'mid'],
        [LL('identity 余额（testnet）', 'Identity balance (testnet)'), ch.identity ? `◎ ${(ch.bal[ch.identity] || 0).toFixed(3)}` : '—', ch.identity && ch.bal[ch.identity] >= H().ID_FLOOR ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      '本练习按 Agave 在 Alpenglow 集群上搭建 testnet 验证者的通用步骤编写。有四个习惯适用于任何网络。第一，按钥匙的用途决定放在哪里：identity 持续签名，所以在服务器上；withdrawer 控制资金，所以离线。第二，每条命令都写明集群，因为同一个地址在 testnet 和 mainnet 上同时存在。第三，节点自己的启动检查就是它最早的监控：内核参数缺失、端口不通、genesis hash 不对，每一种都会在造成损害之前带着明确的信息停下来。第四，在 Alpenglow 下，加入集合是一件按 epoch 排期的事：BLS 公钥和准入费都要在边界之前就位，新验证者要等两个边界才开始投票。错过一个边界，就要再等一天。',
      'This lab follows the standard Agave setup for a testnet validator on an Alpenglow cluster. Four habits carry over to any network. First, place each key by what it does: the identity signs continuously and lives on the server; the withdrawer controls the money and stays offline. Second, name the cluster in every command, because the same address exists on testnet and on mainnet. Third, the node\'s own startup checks are its first monitoring: a missing kernel setting, a closed port or a wrong genesis hash each stop it with a clear message before it can do harm. Fourth, under Alpenglow, joining the set is scheduled by epoch: the BLS key and the ticket must be in place before the boundary, and a new validator waits two boundaries before it votes. Miss a boundary and the wait grows by a day.'),
  });
})(SIM);
