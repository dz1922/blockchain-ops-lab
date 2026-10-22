/* ============================================================
   Solana, steps 1 and 2.
   Step 1: "Solana fundamentals for validator operators", seven
   chapters with widgets and quizzes.
   Step 2: lab R1, a guided build of a testnet validator on a new
   Ubuntu host (the plugin's cfg.fresh mode).
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL, L = S.L;
  const E = (tag, cls, html) => S.wg.el(tag, cls, html);
  const title = el => el.appendChild(E('div', 'wg-title', L('动手试试', 'Try it')));
  const cap = (el, zh, en) => el.appendChild(E('div', 'wg-cap', L(zh, en)));
  const fmt = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const dur = sec => (sec === Infinity ? '∞' : sec >= 86400 * 2 ? L(`${fmt(sec / 86400, 1)} 天`, `${fmt(sec / 86400, 1)} days`) : sec >= 3600 ? L(`${fmt(sec / 3600, 1)} 小时`, `${fmt(sec / 3600, 1)} h`) : sec >= 60 ? L(`${fmt(sec / 60, 1)} 分钟`, `${fmt(sec / 60, 1)} min`) : L(`${fmt(sec, 1)} 秒`, `${fmt(sec, 1)} s`));
  const EPOCH = 432000;
  const C = { lime: '#b6f23a', amber: '#f5a623', red: '#ff6b57', blue: '#7cc4ff', ink2: '#b9c7b4', ink3: '#7f9180', line: '#34413a', panel: '#161e1a', bg: '#0b0f0d' };

  /* ---------- chapter widgets ---------- */

  // 1. slot clock: leader schedule strip, epoch progress, adjustable speed and slot time
  function slotClock(el) {
    title(el);
    const NAMES = ['Kite', 'Orca', 'Lynx', 'Puma', 'Wren', 'Ibis', L('你', 'you')];
    const WEIGHT = [22, 18, 15, 13, 11, 9, 4], COL = ['#7cc4ff', '#f5a623', '#c792ea', '#ff8a7a', '#5fd3bc', '#e6db74', C.lime];
    const hash = (a, b) => { let h = (Math.imul(a, 2654435761) ^ Math.imul(b, 40503)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const leader = s => { const r = hash(Math.floor(s / 4), Math.floor(s / EPOCH) + 11); let acc = 0; for (let i = 0; i < 7; i++) { acc += WEIGHT[i] / 92; if (r < acc) return i; } return 6; };
    let slotMs = 400, speed = 1, s = 724 * EPOCH + 429600, msg = '';
    S.wg.buttons(el, [[L('slot 时长 400 ms', 'slot time 400 ms'), () => { slotMs = 400; }], [L('slot 时长 200 ms', 'slot time 200 ms'), () => { slotMs = 200; }]], { toggle: true });
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
      if (Math.floor(s / EPOCH) !== before) msg = L(`epoch ${Math.floor(s / EPOCH)} 开始。它的 leader 表在上一个 epoch 就已按质押算好，质押变动也在此刻生效。`, `Epoch ${Math.floor(s / EPOCH)} began. Its leader schedule was computed from stake during the previous epoch, and stake changes take effect now.`);
      draw();
    });
    draw();
  }

  // 2. keys: which key signs what, and what a stolen key costs
  function keyMap(el) {
    title(el);
    const BOX = {
      id: [24, 46, 172, 46, L('identity keypair', 'identity keypair'), L('常驻服务器', 'always on the server')],
      vkp: [24, 130, 172, 46, L('vote account keypair', 'vote account keypair'), L('只在创建时用一次', 'used once, at creation')],
      vacct: [236, 46, 168, 46, L('vote account', 'vote account'), L('投票、credits、佣金', 'votes, credits, commission')],
      iacct: [236, 130, 168, 46, L('identity 账户', 'identity account'), L('余额：付手续费', 'balance: pays fees')],
      wd: [444, 46, 172, 46, L('authorized withdrawer', 'authorized withdrawer'), L('离线保存', 'kept offline')],
    };
    const ACT = [
      [L('签一票', 'Sign a vote'), ['id'], ['vacct'], L('identity 默认就是 vote authority，用它签名的投票记入 vote account。', 'The identity is the default vote authority. Votes it signs are recorded in the vote account.')],
      [L('付投票手续费', 'Pay vote fees'), ['id'], ['iacct'], L('手续费从 identity 账户的余额里扣。余额为零时，投票交易无法上链。', 'Fees come out of the identity account. At zero balance, vote transactions cannot land.')],
      [L('出块', 'Produce a block'), ['id'], ['iacct'], L('轮到 leader 时用 identity 签名出块。块里的交易费默认进入 identity 账户。', 'As leader, the identity signs the block. Transaction fees from it go to the identity account by default.')],
      [L('创建 vote account', 'Create the vote account'), ['vkp', 'id'], ['vacct'], L('需要新账户的 keypair 和 identity 共同签名。这是 vote account keypair 唯一一次签名。', 'Needs the new account\'s keypair and the identity. This is the only thing the vote account keypair ever signs.')],
      [L('修改佣金', 'Change commission'), ['wd'], ['vacct'], L('只有 withdrawer 能改佣金。谁持有它，谁就决定这台验证者的收入怎么分。', 'Only the withdrawer can change the commission. Whoever holds it decides how the validator\'s income is split.')],
      [L('从 vote account 取款', 'Withdraw from the vote account'), ['wd'], ['vacct'], L('佣金累积在 vote account 里，只有 withdrawer 能把它转走。', 'Commission accumulates in the vote account. Only the withdrawer can move it.')],
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

  // 3. vote cost: identity burn under Tower BFT, or a flat per-epoch fee from the vote account
  function voteCost(el) {
    title(el);
    let mode = 'tower', balance = 12, rate = 100, sigs = 1, slotMs = 400, fee = 0.8;
    S.wg.buttons(el, [[L('Tower BFT：按票付费', 'Tower BFT: fee per vote'), () => { mode = 'tower'; draw(); }], [L('Alpenglow：按 epoch 固定费用', 'Alpenglow: flat fee per epoch'), () => { mode = 'alpen'; draw(); }]], { toggle: true });
    S.wg.slider(el, { label: L('余额（SOL）', 'Balance (SOL)'), min: 0, max: 40, step: 0.5, value: balance, fmt: v => `◎${v}` }, v => { balance = v; draw(); });
    S.wg.slider(el, { label: L('有投票的 slot 比例', 'Slots with a vote'), min: 50, max: 100, value: rate, fmt: v => `${v}%` }, v => { rate = v; draw(); });
    S.wg.slider(el, { label: L('Alpenglow 每 epoch 费用', 'Alpenglow fee per epoch'), min: 0.2, max: 2, step: 0.1, value: fee, fmt: v => `◎${fmt(v, 1)}` }, v => { fee = v; draw(); });
    S.wg.buttons(el, [[L('每票 1 个签名', '1 signature per vote'), () => { sigs = 1; draw(); }], [L('每票 2 个签名（单独的 vote authority）', '2 signatures (separate vote authority)'), () => { sigs = 2; draw(); }]], { toggle: true });
    S.wg.buttons(el, [['400 ms slots', () => { slotMs = 400; draw(); }], ['200 ms slots', () => { slotMs = 200; draw(); }]], { toggle: true });
    const st = S.wg.stats(el), chart = E('div'), note = E('div', 'wg-cap');
    el.appendChild(chart); el.appendChild(note);
    function draw() {
      if (!chart.isConnected && !el.contains(chart)) return;
      const slotsDay = 86400 / (slotMs / 1000), epochsDay = slotsDay / EPOCH;
      const perDay = mode === 'tower' ? slotsDay * rate / 100 * 5000 * sigs / 1e9 : fee * epochsDay;
      const days = perDay > 0 ? balance / perDay : Infinity;
      st.set(mode === 'tower' ? [
        [L('每票手续费', 'Fee per vote'), `${(5000 * sigs).toLocaleString('en-US')} lamports`, ''],
        [L('每天投票数', 'Votes per day'), Math.round(slotsDay * rate / 100).toLocaleString('en-US'), ''],
        [L('每天花费', 'Cost per day'), `◎${fmt(perDay, 3)}`, perDay > 1.5 ? 'mid' : ''],
        [L('余额可用', 'Balance lasts'), dur(days * 86400), days < 3 ? 'bad' : days < 7 ? 'mid' : 'good'],
        [L('降到 5 SOL 还剩', 'Reaches 5 SOL in'), balance > 5 ? dur((balance - 5) / perDay * 86400) : L('已低于', 'already below'), balance > 8 ? '' : 'bad'],
      ] : [
        [L('每 epoch 费用', 'Fee per epoch'), `◎${fmt(fee, 1)}`, ''],
        [L('每天 epoch 数', 'Epochs per day'), fmt(epochsDay, 2), ''],
        [L('每天花费（vote account）', 'Cost per day (vote account)'), `◎${fmt(perDay, 3)}`, ''],
        [L('identity 的投票费用', 'Identity vote fees'), '◎0', 'good'],
        [L('vote account 余额可用', 'Vote account balance lasts'), dur(days * 86400), days < 3 ? 'bad' : days < 7 ? 'mid' : 'good'],
      ]);
      const W = 600, H = 150, X = d => 40 + d / 30 * (W - 60), top = Math.max(10, balance), Y = b => 14 + (1 - b / top) * (H - 40);
      const end = Math.min(30, days), pts = `${X(0)},${Y(balance)} ${X(end)},${Y(Math.max(0, balance - perDay * end))}${days < 30 ? ` ${X(30)},${Y(0)}` : ''}`;
      const th = mode === 'tower' ? [[8, C.amber, L('预警 8', 'warn 8')], [5, C.red, L('严重 5', 'crit 5')]].filter(t => t[0] <= top).map(([b, c, t]) => `<line x1="40" x2="${W - 20}" y1="${Y(b)}" y2="${Y(b)}" stroke="${c}" stroke-dasharray="4 4" stroke-width="1"/><text x="${W - 18}" y="${Y(b) + 4}" font-size="10" fill="${c}" text-anchor="end" dy="-6">${t}</text>`).join('') : '';
      chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="balance over time"><line x1="40" x2="${W - 20}" y1="${Y(0)}" y2="${Y(0)}" stroke="${C.line}"/><line x1="40" x2="40" y1="10" y2="${Y(0)}" stroke="${C.line}"/>${th}
        <polyline points="${pts}" fill="none" stroke="${C.lime}" stroke-width="2.5"/>${days <= 30 ? `<circle cx="${X(days)}" cy="${Y(0)}" r="4" fill="${C.red}"/>` : ''}
        ${[0, 10, 20, 30].map(d => `<text x="${X(d)}" y="${H - 6}" font-size="10" text-anchor="middle">${L(`${d} 天`, `day ${d}`)}</text>`).join('')}<text x="34" y="${Y(top) + 4}" font-size="10" text-anchor="end">◎${fmt(top, 0)}</text><text x="34" y="${Y(0) + 4}" font-size="10" text-anchor="end">0</text></svg>`;
      note.textContent = mode === 'tower'
        ? L('identity 余额按天匀速下降。告警按"还能撑几天"设置，留出处理时间。', 'The identity balance falls at a steady daily rate. Set alerts in days of runway so there is time to act.')
        : L('Alpenglow 下投票不是交易，"有投票的 slot 比例"和签名数不影响费用。这里的余额指 vote account 中超出免租金额的部分，费用值以集群当前参数为准。', 'Under Alpenglow, votes are not transactions, so the vote share and the signature count do not change the cost. Balance here means the vote account balance above its rent-exempt minimum. Check the cluster\'s current fee.');
    }
    draw();
  }

  // 4. Tower BFT: push votes, watch lockouts double, measure the cost of switching forks
  function tower(el) {
    title(el);
    const MAX = 31;
    let votes, root, cur, depth = 3, auto = null;
    const reset = () => { votes = []; root = null; cur = 1000; };
    reset();
    const lockout = v => 2 ** v.conf, until = v => v.slot + lockout(v);
    const vote = () => {
      const s = cur;
      while (votes.length && until(votes[votes.length - 1]) < s) votes.pop();
      if (votes.length === MAX) root = votes.shift().slot;
      votes.push({ slot: s, conf: 1 });
      const n = votes.length;
      votes.forEach((v, i) => { if (n > i + v.conf) v.conf++; });
      cur = s + 1;
    };
    S.wg.buttons(el, [
      [L('投下一个 slot', 'Vote next slot'), () => { vote(); draw(); }],
      [L('跳过 4 个 slot 不投', 'Skip 4 slots'), () => { cur += 4; draw(); }],
      [L('自动投票', 'Auto-vote'), b => { if (auto) { auto(); auto = null; b.classList.remove('on'); } else { auto = S.wg.every(350, () => { vote(); draw(); }); b.classList.add('on'); } }],
      [L('重来', 'Reset'), () => { reset(); draw(); }],
    ]);
    S.wg.slider(el, { label: L('另一个分叉从最近几票之下分出', 'Other fork splits below your last N votes'), min: 1, max: 31, value: 3, fmt: v => String(v) }, v => { depth = v; draw(); });
    const svg = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(svg, st.el); el.appendChild(note);
    function draw() {
      const n = votes.length, k = Math.min(depth, n);
      const show = votes.slice(-12).reverse(), maxLog = 32;
      let g = '';
      show.forEach((v, i) => {
        const y = 6 + i * 17, idx = n - 1 - i, onFork = idx >= n - k, w = 20 + v.conf / maxLog * 360, expired = until(v) < cur;
        g += `<rect x="150" y="${y}" width="${w}" height="12" rx="3" fill="${onFork ? C.amber : C.lime}" opacity="${expired ? 0.25 : 0.85}"/><text x="8" y="${y + 10}" font-size="10">slot ${v.slot}</text><text x="78" y="${y + 10}" font-size="10">conf ${v.conf}</text><text x="${158 + w}" y="${y + 10}" font-size="10">${(2 ** v.conf).toLocaleString('en-US')} ${L('个 slot，至', 'slots, until')} ${until(v).toLocaleString('en-US')}</text>`;
      });
      if (n > 12) g += `<text x="8" y="${6 + 12 * 17 + 10}" font-size="10" fill="${C.ink3}">… ${L(`下面还有 ${n - 12} 票`, `${n - 12} older votes below`)}</text>`;
      if (!n) g += `<text x="8" y="16" font-size="11" fill="${C.ink3}">${L('还没有投票。点"投下一个 slot"。', 'No votes yet. Press "Vote next slot".')}</text>`;
      svg.innerHTML = `<svg viewBox="0 0 640 ${Math.max(40, Math.min(n, 12) * 17 + (n > 12 ? 22 : 8))}" role="img" aria-label="vote tower">${g}</svg>`;
      const fork = votes.slice(n - k), earliest = fork.length ? Math.max(...fork.map(until)) + 1 : cur, wait = Math.max(0, earliest - cur);
      st.set([
        [L('当前 slot', 'Current slot'), cur.toLocaleString('en-US'), ''],
        [L('tower 深度', 'Tower depth'), `${n} / ${MAX}`, n === MAX ? 'good' : ''],
        ['root', root === null ? '—' : root.toLocaleString('en-US'), root === null ? '' : 'good'],
        [L('最早可投另一分叉', 'Earliest vote on other fork'), n ? earliest.toLocaleString('en-US') : '—', ''],
        [L('需要等待', 'Wait'), n ? `${wait.toLocaleString('en-US')} slots ≈ ${dur(wait * 0.4)}` : '—', wait > 1000 ? 'bad' : wait > 30 ? 'mid' : 'good'],
      ]);
      note.textContent = L('黄色是分叉点之上、属于被放弃分叉的票。要改投另一分叉，这些票都必须先过期。连续投票时下层的锁定期不断翻倍，切换的代价随之增长。', 'Amber votes sit above the fork point, on the fork being abandoned. All of them must expire before the validator may vote on the other fork. Consistent voting keeps doubling the lockouts underneath, so switching gets more expensive.');
    }
    draw();
  }

  // 5. delinquency and credits: stop voting and watch the 128-slot line; vote latency and TVC credits; skip rate
  function delinquency(el) {
    title(el);
    let voting = true, tip = 0, last = 0, latency = 1, speed = 4, skipped = 2;
    S.wg.buttons(el, [[L('投票中', 'Voting'), () => { voting = true; }], [L('停止投票', 'Stop voting'), () => { voting = false; }]], { toggle: true });
    S.wg.buttons(el, [['1×', () => { speed = 1; }], ['4×', () => { speed = 4; }], ['16×', () => { speed = 16; }]], { toggle: true, selected: 1 });
    S.wg.slider(el, { label: L('投票落地延迟（slot）', 'Vote latency (slots)'), min: 1, max: 20, value: 1 }, v => { latency = v; });
    S.wg.slider(el, { label: L('40 个 leader slot 中跳过', 'Skipped of 40 leader slots'), min: 0, max: 40, value: 2 }, v => { skipped = v; });
    const meter = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(meter, st.el); el.appendChild(note);
    const credits = lat => (lat <= 2 ? 16 : Math.max(1, 16 - (lat - 2)));
    const draw = () => {
      const behind = Math.max(0, Math.floor(tip - last)), del = behind > 128;
      meter.innerHTML = `<div class="wg-cap" style="margin-bottom:.3rem">${L('最后一票落后链头', 'Last vote behind the tip')}: <b style="color:${del ? C.red : C.ink2}">${behind} slots</b> · ${L('128 处是 delinquent 线', 'the line at 128 is the delinquency threshold')}</div>${S.wg.meter(behind / 256 * 100, del ? 'bad' : behind > 64 ? 'mid' : '', [[50, '128']])}`;
      const c = credits(latency);
      st.set([
        [L('状态', 'Status'), del ? 'DELINQUENT' : voting ? L('投票中', 'voting') : L('未投票', 'not voting'), del ? 'bad' : voting ? 'good' : 'mid'],
        [L('每票 credits', 'Credits per vote'), `${c} / 16`, c === 16 ? 'good' : c >= 12 ? 'mid' : 'bad'],
        [L('与中位数之比（中位数按满分）', 'vs median (median at full credit)'), `${fmt(c / 16 * 100, 0)}%`, c === 16 ? 'good' : c >= 12 ? 'mid' : 'bad'],
        ['skip rate', `${fmt(skipped / 40 * 100, 1)}%`, skipped <= 2 ? 'good' : skipped <= 8 ? 'mid' : 'bad'],
      ]);
      note.textContent = del
        ? L('落后超过 128 个 slot：RPC 把它列为 delinquent，不再获得 credits。恢复投票后，最后一票会立即追到链头附近。', 'More than 128 slots behind: RPC lists it as delinquent and it earns no credits. Once it votes again, its last vote jumps back near the tip.')
        : L('延迟在 2 个 slot 以内拿满 16 分，之后每晚一个 slot 少 1 分。跳过的 leader slot 损失的是出块收入，不影响 credits。', 'A vote landing within 2 slots earns the full 16 credits; each slot later earns one less. Skipped leader slots lose block income; they do not change credits.');
    };
    S.wg.loop(dt => {
      tip += dt * 2.5 * speed;
      if (voting) last = tip - latency;
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
    S.wg.slider(el, { label: L('credits 相对中位数', 'Credits vs median'), min: 70, max: 100, value: 100, fmt: v => `${v}%` }, v => { perf = v; draw(); });
    S.wg.slider(el, { label: L('在 epoch N 的何时委托', 'Delegate during epoch N at'), min: 0, max: 99, value: 50, fmt: v => `${v}%` }, v => { at = v; draw(); });
    const svg = E('div'), st = S.wg.stats(el), note = E('div', 'wg-cap');
    el.insertBefore(svg, st.el); el.appendChild(note);
    function draw() {
      if (!el.contains(svg)) return;
      const perYear = 365.25 * 86400 / (EPOCH * 0.4), gross = stake * apy / 100 / perYear * perf / 100, cut = gross * comm / 100;
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
        [L('一年合计（按 400 ms slot）', 'Per year (400 ms slots)'), `◎${fmt(gross * perYear, 0)}`, ''],
      ]);
      note.textContent = L('收益率是假设值，实际值随通胀计划和全网质押比例变化。credits 低于中位数时，奖励按比例减少，委托人和验证者一起少拿。', 'The yield is an assumption; the real figure follows the inflation schedule and the share of SOL staked. Credits below the median shrink the reward for delegators and validator alike.');
    }
    draw();
  }

  // 7. snapshots: downtime vs local snapshot vs download, and whether the node can catch up
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
      const RATE = 2.5, LOAD = 240, GAIN = 25, gapDown = down * RATE;
      let path, prep, gap, gain;
      if (gapDown <= 2500 || noFetch) {
        path = L('使用本地快照', 'use local snapshot'); prep = LOAD; gap = gapDown + LOAD * RATE;
        gain = gap > 50000 ? -0.9 : GAIN;
      } else {
        const dl = size * 1024 / mbps;
        path = L('从 known validator 下载新快照', 'download a fresh snapshot from a known validator'); prep = dl + LOAD; gap = 380 + prep * RATE; gain = GAIN;
      }
      const catchT = gain > 0 ? gap / gain : Infinity, total = prep + catchT;
      const W = 600, maxT = Math.min(Math.max(total === Infinity ? prep * 2 : total, 120), 7200), X = t => 20 + Math.min(t, maxT) / maxT * (W - 40);
      const seg = (a, b, c, t) => (b > a ? `<rect x="${X(a)}" y="20" width="${Math.max(2, X(b) - X(a))}" height="24" rx="3" fill="${c}" opacity=".75"/><text x="${X(a) + 4}" y="36" font-size="10" fill="${C.bg}">${X(b) - X(a) > 60 ? t : ''}</text>` : '');
      let g = seg(0, prep - LOAD, C.blue, L('下载', 'download')) + seg(prep - LOAD, prep, C.amber, L('加载', 'load')) + (gain > 0 ? seg(prep, total, C.lime, L('追赶', 'catch up')) : seg(prep, maxT, C.red, L('越落越远', 'falling behind')));
      g += `<text x="20" y="62" font-size="10">0</text><text x="${W - 20}" y="62" font-size="10" text-anchor="end">${dur(maxT)}</text>`;
      svg.innerHTML = `<svg viewBox="0 0 ${W} 68" role="img" aria-label="restart timeline">${g}</svg>`;
      st.set([
        [L('启动方式', 'Start path'), path, ''],
        [L('加载后落后', 'Behind after load'), `${Math.round(gap).toLocaleString('en-US')} slots`, gap > 50000 ? 'bad' : ''],
        [L('恢复投票还需', 'Voting again in'), gain > 0 ? dur(total) : L('追不上', 'never'), gain > 0 ? (total < 900 ? 'good' : 'mid') : 'bad'],
      ]);
      note.textContent = gain > 0
        ? L('模型是示意性的：加载约 4 分钟，追赶速度约每秒 25 个 slot。真实数值取决于硬件、网络和集群负载。', 'The model is illustrative: about 4 minutes to load and a catch-up rate of about 25 slots a second. Real figures depend on hardware, network and cluster load.')
        : L('本地快照太旧。缺失的 slot 只能靠 repair 从其他节点要，速度比集群出块还慢，所以差距只会扩大。去掉 --no-snapshot-fetch 重启。', 'The local snapshot is too old. Missing slots can only be repaired from peers, more slowly than the cluster produces them, so the gap only grows. Restart without --no-snapshot-fetch.');
    }
    draw();
  }

  /* ---------- step 1: the lesson ---------- */
  S.registerLesson({
    id: 'solana-basics', network: 'solana', minutes: 35,
    title: LL('面向验证者运维的 Solana 基础', 'Solana fundamentals for validator operators'),
    tagline: LL('slot 与 leader、三把钥匙、投票的成本、锁定期、delinquent、质押奖励和快照。', 'Slots and leaders, the three keys, what voting costs, lockouts, delinquency, stake rewards and snapshots.'),
    chapters: [
      {
        title: LL('slot、leader 与 epoch', 'Slots, leaders and epochs'),
        body: LL(
          `<p>Solana 把时间切成 <b>slot</b>。每个 slot 只有一个验证者有权出块，它就是这个 slot 的 <b>leader</b>。其他验证者重放这个块，再对它投票。</p>
<p><b>leader 表</b>按连续 4 个 slot 为一组分配，事先根据质押分布算好：质押越多，分到的 slot 越多。每个验证者都能算出同一张表，所以都知道接下来轮到谁，交易可以直接发给即将出块的 leader。</p>
<p>一个 <b>epoch</b> 是 432,000 个 slot。质押的生效与解除、通胀奖励的结算、新的 leader 表，都在 epoch 边界发生。</p>
<p>大多数验证者运行的客户端是 Anza 维护的 Agave，本课程的练习也使用它。Firedancer 是另一套独立实现；Frankendancer 则把 Firedancer 的网络层与 Agave 的运行时组合在一起。</p>
<div class="note warn">练习中的模拟集群使用 400 ms 的 slot，一个 epoch 约两天。2026 年主网的目标 slot 时长分几步降到了 200 ms。epoch 仍是 432,000 个 slot，所以现在一个 epoch 约一天。在下面的组件里切换 slot 时长，可以看到两者的差别。</div>`,
          `<p>Solana divides time into <b>slots</b>. In each slot exactly one validator may produce a block: the slot's <b>leader</b>. The other validators replay that block and vote on it.</p>
<p>The <b>leader schedule</b> assigns slots in runs of four consecutive slots per leader. It is computed in advance from the stake distribution: more stake means more slots. Every validator can compute the same schedule, so all of them know who leads next, and transactions go straight to the upcoming leaders.</p>
<p>An <b>epoch</b> is 432,000 slots. Stake activation and deactivation, inflation rewards and the next leader schedule all change at epoch boundaries.</p>
<p>Most validators run Agave, the client maintained by Anza, and the labs in this course use it. Firedancer is an independent implementation; Frankendancer combines Firedancer's networking with Agave's runtime.</p>
<div class="note warn">The simulated cluster in the labs uses 400 ms slots, which makes an epoch about two days. In 2026 the target slot time on mainnet was cut to 200 ms in stages. Epochs kept 432,000 slots, so an epoch now lasts about one day. Switch the slot time in the widget below to compare.</div>`),
        widget: slotClock,
        quiz: [
          { q: LL('一个 leader 每次连续分到几个 slot？', 'How many consecutive slots does a leader get at a time?'), options: [LL('1 个', '1'), LL('4 个', '4'), LL('32 个', '32'), LL('整个 epoch', 'A whole epoch')], answer: 1, why: LL('leader 表以 4 个连续 slot 为一组，leader 可以连续出块。', 'The schedule assigns four consecutive slots, so a leader can build blocks back to back.') },
          { q: LL('slot 为 400 ms 时，一个 epoch 大约多长？', 'With 400 ms slots, about how long is an epoch?'), options: [LL('约 3 小时', 'About 3 hours'), LL('约 1 天', 'About 1 day'), LL('约 2 天', 'About 2 days'), LL('约 1 周', 'About 1 week')], answer: 2, why: LL('432,000 × 0.4 秒 = 172,800 秒，即两天。slot 为 200 ms 时约一天。', '432,000 × 0.4 s = 172,800 s, which is two days. At 200 ms it is about one day.') },
          { q: LL('epoch 边界上会发生什么？', 'What happens at an epoch boundary?'), options: [LL('新的 leader 表生效，质押变动生效', 'A new leader schedule and stake changes take effect'), LL('所有验证者重启', 'All validators restart'), LL('ledger 被清空', 'The ledger is wiped'), LL('佣金被重置', 'Commissions are reset')], answer: 0, why: LL('leader 表、质押激活与解除、奖励结算都以 epoch 为单位。', 'The leader schedule, stake activation and deactivation, and rewards all work per epoch.') },
        ],
      },
      {
        title: LL('钥匙与账户', 'Keys and accounts'),
        body: LL(
          `<p>一个验证者涉及三把钥匙和两个链上账户。</p>
<table><tr><th>钥匙</th><th>放在哪里</th><th>能做什么</th></tr>
<tr><td>identity</td><td>验证者主机</td><td>以默认 vote authority 的身份签投票；签区块和 gossip 消息；支付投票手续费。它的账户还会收到自己所出区块的交易费。</td></tr>
<tr><td>vote account keypair</td><td>只用一次</td><td>只在创建 vote account 时签名。账户建好之后，这把钥匙没有任何权限，账户地址才是长期使用的东西。</td></tr>
<tr><td>authorized withdrawer</td><td>离线</td><td>从 vote account 取款、修改佣金、更换 vote account 上的 identity 和 vote authority。它是控制权的根。</td></tr></table>
<p><b>vote account</b> 记录投票状态：最近的投票、获得的 credits、佣金比例，通胀奖励中的佣金也打进这里。<b>identity 账户</b>就是 identity 公钥对应的普通账户，余额用来付手续费。</p>
<p>identity 要持续签名，所以必须放在服务器上。withdrawer 很少用到，应当离线保存，例如放在硬件钱包或一台不联网的机器上，助记词另外存放。</p>`,
          `<p>A validator involves three keys and two on-chain accounts.</p>
<table><tr><th>Key</th><th>Where it lives</th><th>What it can do</th></tr>
<tr><td>identity</td><td>validator host</td><td>Signs votes as the default vote authority; signs blocks and gossip messages; pays vote fees. Its account also receives transaction fees from the blocks it produces.</td></tr>
<tr><td>vote account keypair</td><td>used once</td><td>Signs only the creation of the vote account. Afterwards it has no authority; the account address is what stays in use.</td></tr>
<tr><td>authorized withdrawer</td><td>offline</td><td>Withdraws from the vote account, changes the commission, and reassigns the identity and the vote authority on the vote account. It is the root of control.</td></tr></table>
<p>The <b>vote account</b> holds the vote state: recent votes, earned credits and the commission rate, and commission from inflation rewards is paid into it. The <b>identity account</b> is the ordinary account at the identity's pubkey; its balance pays the fees.</p>
<p>The identity signs continuously, so it has to be on the server. The withdrawer is rarely needed and belongs offline, on a hardware wallet or a machine that is not on the network, with its seed phrase stored separately.</p>`),
        widget: keyMap,
        after: LL('<div class="note warn">identity 泄露，损失的是它的余额，还可能被人在别处冒用；用 withdrawer 换一个新 identity 就能止损。withdrawer 泄露，损失的是整个 vote account 和对它的控制权，没有补救办法。</div>', '<div class="note warn">A leaked identity costs its balance and can be used elsewhere; the withdrawer replaces it with a new identity. A leaked withdrawer costs the vote account and control over it, with no way back.</div>'),
        quiz: [
          { q: LL('哪把钥匙能修改 vote account 的佣金？', 'Which key can change the commission on the vote account?'), options: [LL('identity', 'The identity'), LL('vote account keypair', 'The vote account keypair'), LL('authorized withdrawer', 'The authorized withdrawer'), LL('任何一个委托人', 'Any delegator')], answer: 2, why: LL('改佣金需要 withdrawer 签名，所以它决定这台验证者的收入。', 'Commission changes need the withdrawer\'s signature, which is why that key controls the validator\'s income.') },
          { q: LL('为什么 withdrawer 不能放在验证者主机上？', 'Why must the authorized withdrawer not be stored on the validator host?'), options: [LL('会拖慢投票', 'It slows down voting'), LL('拿到主机权限的人就能取走 vote account 的钱并改掉授权', 'Anyone who takes over the host could drain the vote account and change its authorities'), LL('验证者发现它就拒绝启动', 'The validator refuses to start if it finds it'), LL('它一个 epoch 后就过期', 'It expires after one epoch')], answer: 1, why: LL('服务器暴露在网络上。withdrawer 和 identity 放在一起，一次入侵就会失去全部控制权。', 'The server faces the network. Keeping the withdrawer next to the identity means one intrusion loses all control.') },
          { q: LL('vote account 创建之后，它自己的 keypair 还能做什么？', 'After the vote account is created, what can its own keypair do?'), options: [LL('签投票', 'Sign votes'), LL('取出奖励', 'Withdraw rewards'), LL('什么都不能做，它没有权限', 'Nothing; it has no authority over the account'), LL('更换 identity', 'Change the identity')], answer: 2, why: LL('权限在 vote authority 和 withdrawer 手里，vote account keypair 只签过创建那一次。', 'Authority sits with the vote authority and the withdrawer. The vote account keypair only signed the creation.') },
        ],
      },
      {
        title: LL('投票的成本', 'Voting and its cost'),
        body: LL(
          `<p>在 Tower BFT 下，每一票都是一笔普通交易。验证者几乎每个 slot 都投一票，手续费由 identity 支付。基础手续费是每个签名 5,000 lamports，即 0.000005 SOL。只由 identity 签名的投票交易有一个签名。</p>
<p>slot 为 400 ms 时，一天约 216,000 票，约 1.1 SOL。identity 余额因此按固定速度下降。余额归零后，投票交易无法上链：进程还在运行，链上的验证者却已经停止投票。余额告警应当按"还能撑几天"来设，而不是按一个绝对数额。</p>
<p>如果 vote authority 是 identity 之外的另一把钥匙，每票带两个签名，费用翻倍。</p>
<div class="note warn">2026 年，testnet 和主网先后用 Alpenglow 取代了 Tower BFT。投票改为验证者之间直接传递的消息，不再是交易，按票收取的手续费随之取消，改为每个 epoch 从 vote account 扣一笔固定的准入费用。练习中的模拟集群仍按 Tower BFT 的按票收费建模。</div>`,
          `<p>Under Tower BFT, every vote is an ordinary transaction. The validator votes in almost every slot, and the identity pays the fee. The base fee is 5,000 lamports, or 0.000005 SOL, per signature. A vote signed only by the identity carries one signature.</p>
<p>At 400 ms slots that is about 216,000 votes a day, roughly 1.1 SOL. The identity balance therefore falls at a steady rate. When it reaches zero, vote transactions can no longer land: the process keeps running, while on chain the validator has stopped voting. Set balance alerts in days of runway, not as a fixed amount.</p>
<p>If the vote authority is a different key from the identity, each vote carries two signatures and costs twice as much.</p>
<div class="note warn">In 2026, testnet and then mainnet replaced Tower BFT with Alpenglow. Votes became messages sent directly between validators instead of transactions. The per-vote fee went away, replaced by a fixed admission fee taken from the vote account each epoch. The simulated cluster in the labs still models Tower BFT's per-vote fees.</div>`),
        widget: voteCost,
        quiz: [
          { q: LL('Tower BFT 下，投票交易的手续费由谁支付？', 'Under Tower BFT, who pays the fee for a vote transaction?'), options: [LL('vote account', 'The vote account'), LL('identity', 'The identity'), LL('委托人', 'The delegators'), LL('当前 leader', 'The current leader')], answer: 1, why: LL('identity 是投票交易的付费方，所以它的余额会持续下降。', 'The identity is the fee payer of each vote, so its balance keeps falling.') },
          { q: LL('identity 有 9 SOL，每天花 1.1 SOL，余额告警设在 0.1 SOL。问题在哪里？', 'The identity holds 9 SOL and spends 1.1 SOL a day. The balance alert is set at 0.1 SOL. What is wrong?'), options: [LL('没有问题', 'Nothing'), LL('告警只比余额耗尽早两个小时左右', 'It fires only about two hours before the balance runs out'), LL('告警会过于频繁', 'It will fire too often'), LL('余额无法监控', 'Balances cannot be monitored')], answer: 1, why: LL('0.1 SOL 大约是两小时的投票费用。按剩余天数设阈值，才有处理的时间。', '0.1 SOL is about two hours of votes. Thresholds in days of runway leave time to act.') },
        ],
      },
      {
        title: LL('Tower BFT 与锁定期', 'Tower BFT and lockouts'),
        body: LL(
          `<p>当一个块没有及时传到所有节点，或者两个 leader 接在不同的父块上出块时，就会出现分叉。每个验证者必须选定一个分叉，并且坚持足够长的时间，让整个集群收敛。Tower BFT 用<b>锁定期</b>（lockout）来保证这一点。</p>
<p>验证者对某个 slot 投票后，承诺在 2 个 slot 内不给冲突的分叉投票。之后在同一分叉上每多投一票，下面那些票的锁定期就会翻倍，最早的票依次锁定 4、8、16……个 slot。投票栈最多保存 31 票；第 32 票到来时，最底下的一票出栈，成为这个验证者的 <b>root</b>，对它来说已不可逆。</p>
<p>要改投另一个分叉，必须等被放弃分叉上的每一票都过期。投入越深，等待越久。这让在两个分叉之间摇摆的代价非常高。投票栈（tower）会保存到磁盘上的 <b>tower 文件</b>里，重启之后锁定仍然有效。</p>
<h3>一个 identity，只能有一台机器投票</h3>
<p>两台机器运行同一个 identity，会各自维护一个 tower，签出相互违反锁定的投票，这就是双签（equivocation）。目前协议不会自动罚没质押，但这些矛盾的投票会公开留在链上，可能扰乱集群，委托计划也会把这样的验证者移出名单。<code>--require-tower</code> 让验证者在没有已保存 tower 的情况下拒绝启动或拒绝 <code>set-identity</code>，防止备用机带着空白的投票历史接管 identity。</p>
<div class="note warn">Alpenglow 用新的投票协议 Votor 取代了 Tower BFT，靠证书而不是锁定期来确认区块。在运行 Alpenglow 的集群上，tower 文件不再起作用。上面那条规则不变：一个 identity 绝不能同时在两台机器上运行。</div>`,
          `<p>Forks happen when a block does not reach every node in time, or when two leaders build on different parents. Each validator has to choose a fork and stay with it long enough for the cluster to converge. Tower BFT enforces this with <b>lockouts</b>.</p>
<p>A vote for a slot commits the validator not to vote for a conflicting fork for 2 slots. Each further vote on the same fork doubles the lockout of the votes beneath it, so the oldest votes become locked for 4, 8, 16 … slots. The vote stack holds up to 31 votes. When a 32nd arrives, the bottom vote leaves the stack and becomes the validator's <b>root</b>, final as far as that validator is concerned.</p>
<p>Switching to another fork means waiting until every vote on the abandoned fork has expired. The deeper the commitment, the longer the wait, which makes swinging between forks very expensive. The vote stack, the tower, is saved to disk in the <b>tower file</b>, so lockouts survive a restart.</p>
<h3>One identity, one voting machine</h3>
<p>Two machines running the same identity each keep their own tower and sign votes that break each other's lockouts. That is equivocation. The protocol does not slash stake for it automatically today, but the conflicting votes stay on chain as evidence, they can disrupt the cluster, and delegation programs drop validators that do it. <code>--require-tower</code> makes the validator refuse to start, or refuse <code>set-identity</code>, without a saved tower, so a standby cannot take over the identity with an empty vote history.</p>
<div class="note warn">Alpenglow replaced Tower BFT with a new vote protocol, Votor, which finalises blocks with certificates instead of lockouts. On clusters that run it, the tower file no longer applies. The rule above stays: one identity never runs on two machines at once.</div>`),
        widget: tower,
        quiz: [
          { q: LL('一票的确认数（confirmation count）是 3，它锁定多少个 slot？', 'A vote has a confirmation count of 3. How many slots is it locked out for?'), options: [LL('3', '3'), LL('6', '6'), LL('8', '8'), LL('16', '16')], answer: 2, why: LL('锁定期是 2 的确认数次方：2³ = 8。', 'Lockout is 2 to the power of the confirmation count: 2³ = 8 slots.') },
          { q: LL('备用机接管质押 identity 时为什么要加 --require-tower？', 'Why does a standby use --require-tower when taking over the staked identity?'), options: [LL('加快追块', 'It speeds up catch-up'), LL('没有已保存的投票历史就拒绝投票，避免投出违反之前锁定的票', 'It refuses to vote without the saved vote history, preventing votes that break earlier lockouts'), LL('从 known validator 下载 tower', 'It downloads the tower from a known validator'), LL('RPC 需要它', 'RPC needs it')], answer: 1, why: LL('没有 tower，新机器不知道自己被锁在哪些分叉上。', 'Without the tower the new machine does not know which forks it is locked out of.') },
        ],
      },
      {
        title: LL('delinquent、skip rate 与 credits', 'Delinquency, skip rate and credits'),
        body: LL(
          `<p>集群通过投票来评价验证者。最后一张落地的票落后链头超过 128 个 slot（400 ms 下约 51 秒）时，RPC 节点会把它报告为 <b>delinquent</b>。delinquent 的验证者没有收益，质押池也可能撤走委托。</p>
<p>每一票都会挣到 <b>vote credits</b>。按照 timely vote credits（TVC）规则，在所投 slot 之后 2 个 slot 内落地的票拿满 16 分，每再晚一个 slot 少 1 分，最低 1 分。通胀奖励按"质押 × credits"分配，所以一个反应慢的验证者，即使从不 delinquent，也会少拿奖励。运维看的是本 epoch 自己的 credits 与集群中位数之比。</p>
<p><b>skip rate</b> 是验证者自己的 leader slot 中，没有块进入集群主链的比例。被跳过的 slot 损失的是这些 slot 的出块收入，与 vote credits 无关。</p>`,
          `<p>The cluster judges a validator by its votes. When its last landed vote is more than 128 slots behind the tip, about 51 seconds at 400 ms, RPC nodes report it as <b>delinquent</b>. A delinquent validator earns nothing, and stake pools may withdraw their delegation.</p>
<p>Each vote earns <b>vote credits</b>. Under timely vote credits (TVC), a vote that lands within 2 slots of the slot it votes for earns the full 16 credits; each slot later earns one fewer, down to 1. Inflation rewards are shared by stake times credits, so a slow validator earns less even if it is never delinquent. Operators watch their credits for the epoch against the cluster median.</p>
<p><b>Skip rate</b> is the share of the validator's own leader slots that produced no block on the cluster's chain. Skipped slots lose the block income of those slots. They do not affect vote credits.</p>`),
        widget: delinquency,
        quiz: [
          { q: LL('一个验证者的最后一票落后链头 200 个 slot，RPC 会怎么报告？', 'A validator\'s last vote is 200 slots behind the tip. What does RPC report?'), options: [LL('正常', 'Healthy'), LL('delinquent', 'Delinquent'), LL('skipped', 'Skipped'), LL('rooted', 'Rooted')], answer: 1, why: LL('超过 128 个 slot 即为 delinquent。', 'More than 128 slots behind means delinquent.') },
          { q: LL('投票延迟 5 个 slot，按 TVC 每票能拿多少 credits？', 'Votes land 5 slots late. How many credits does each earn under TVC?'), options: [LL('16', '16'), LL('13', '13'), LL('11', '11'), LL('5', '5')], answer: 1, why: LL('2 个 slot 之内满分 16，超出 3 个 slot 扣 3 分：16 − 3 = 13。', 'Full credit up to 2 slots; 3 slots beyond that cost 3 credits: 16 − 3 = 13.') },
          { q: LL('下面哪一项会减少通胀奖励？', 'Which of these reduces inflation rewards?'), options: [LL('skip rate 高', 'A high skip rate'), LL('vote credits 低', 'Low vote credits'), LL('RPC 负载高', 'A high RPC load'), LL('ledger 很大', 'A large ledger')], answer: 1, why: LL('通胀奖励按质押和 credits 分配。跳过的 leader slot 损失的是出块收入。', 'Inflation rewards follow stake and credits. Skipped leader slots lose block income instead.') },
        ],
      },
      {
        title: LL('质押、佣金与奖励', 'Stake, commission and rewards'),
        body: LL(
          `<p>持币人通过 <b>stake account</b> 把 SOL 委托给验证者。每个 stake account 有自己的 stake authority 和 withdraw authority，由委托人掌握。验证者从头到尾都控制不了委托进来的 SOL。</p>
<p>质押变动在 epoch 边界生效。新委托在下一个 epoch 开始前处于<b>激活中</b>；解除委托的质押在边界之前仍然有效，过了边界才能取回。网络限制每个 epoch 能激活或解除的质押总量，所以很大的变动可能要跨好几个 epoch。</p>
<p>每个 epoch 开始时，网络按各验证者上一个 epoch 的 credits 和质押计算通胀奖励，在新 epoch 的头一批区块中发到各个 stake account。验证者的<b>佣金</b>是从委托人通胀奖励中抽取的比例，进入 vote account。</p>
<p>验证者当 leader 时，还能拿到自己区块的交易费，默认进入 identity 账户。很多验证者运行 Jito-Solana，这是 Agave 的一个分支，可以接收搜索者附带小费的交易包（MEV）。小费每个 epoch 按验证者另设的 MEV 佣金，在验证者和委托人之间分配。</p>`,
          `<p>Holders delegate SOL to a validator through <b>stake accounts</b>. Each stake account has its own stake authority and withdraw authority, held by the delegator. The validator never controls delegated SOL.</p>
<p>Stake changes take effect at epoch boundaries. A new delegation is <b>activating</b> until the next epoch begins. Deactivating stake stays active until the boundary and can be withdrawn after it. The network limits how much stake can activate or deactivate per epoch, so very large changes can take several epochs.</p>
<p>At the start of each epoch, the network computes inflation rewards for the previous epoch from each validator's credits and stake, and pays them to the stake accounts over the first blocks of the new epoch. The validator's <b>commission</b> is its share of its delegators' inflation rewards, and it goes to the vote account.</p>
<p>As leader, a validator also earns the transaction fees of its blocks, paid to the identity account by default. Many validators run Jito-Solana, a fork of Agave that accepts bundles with tips from searchers (MEV). Tips are split each epoch between the validator and its stakers according to a separate MEV commission.</p>`),
        widget: rewards,
        quiz: [
          { q: LL('在 epoch 700 的一半时委托质押，它什么时候开始挣奖励？', 'Stake is delegated halfway through epoch 700. When does it start earning?'), options: [LL('立刻', 'Immediately'), LL('从 epoch 701 起，第一笔奖励在 epoch 702 开始时发放', 'From epoch 701, with the first reward paid at the start of epoch 702'), LL('7 天之后', 'After 7 days'), LL('从 epoch 700 起追溯计算', 'From epoch 700, backdated')], answer: 1, why: LL('委托在下一个 epoch 生效，这个 epoch 的奖励在再下一个 epoch 开始时发放。', 'Delegation takes effect at the next epoch, and that epoch\'s reward is paid as the following one begins.') },
          { q: LL('10% 的佣金拿走的是什么？', 'What does a 10% commission take?'), options: [LL('委托质押本金的 10%', '10% of the delegated stake'), LL('委托人通胀奖励的 10%，打进 vote account', '10% of the delegators\' inflation rewards, paid to the vote account'), LL('区块交易费的 10%', '10% of block fees'), LL('每笔交易的 10%', '10% of every transaction')], answer: 1, why: LL('佣金只作用于通胀奖励，本金始终在委托人的 stake account 里。', 'Commission applies to inflation rewards. The principal stays in the delegator\'s stake account.') },
        ],
      },
      {
        title: LL('快照与追块', 'Snapshots and catch-up'),
        body: LL(
          `<p>新启动或重启的验证者不会从创世块开始重放，而是加载一个<b>快照</b>：某个 slot 时刻的完整账户状态。<b>全量快照</b>包含全部状态，每隔数万个 slot 生成一次；<b>增量快照</b>只包含上一个全量快照之后的变化，生成得频繁得多。用全量快照加上一份较新的增量快照启动，需要重放的差距就很小。</p>
<p>启动时 Agave 先找本地快照。如果它比其他节点提供的最新快照落后超过 <code>--maximum-local-snapshot-age</code>（默认 2,500 个 slot），就下载新的。<code>--known-validator</code> 加上 <code>--only-known-rpc</code>，把下载来源限制在你信任的节点上：快照里的状态会被直接接受，节点不会自己重新推导一遍。</p>
<p><code>--no-snapshot-fetch</code> 强制使用本地快照。短暂重启时它省去一次下载；长时间停机之后，它会留下一大段差距，只能靠 repair 从其他节点补，而 repair 的速度可能还赶不上集群出块。</p>
<p><code>solana catchup --our-localhost</code> 把本节点与集群对比，报告它是在追赶还是在落后：</p>
<pre class="term-snip">$ solana catchup --our-localhost
8vRtQm4K… has 2310 slot(s) behind (us:313190110 them:313192420), our node is gaining at 25.0 slots/second
8vRtQm4K… has caught up (us:313192530 them:313192530)</pre>`,
          `<p>A new or restarted validator does not replay the chain from genesis. It loads a <b>snapshot</b>: the full account state at one slot. A <b>full snapshot</b> holds everything and is produced every several tens of thousands of slots. An <b>incremental snapshot</b> holds only the changes since the last full one and is produced much more often. Starting from a full snapshot plus a recent incremental one leaves only a short gap to replay.</p>
<p>At startup Agave looks for a local snapshot. If it is further behind the newest snapshot that peers offer than <code>--maximum-local-snapshot-age</code> (2,500 slots by default), it downloads a new one. <code>--known-validator</code> with <code>--only-known-rpc</code> limits downloads to nodes you trust: the state in a snapshot is accepted as it is, not re-derived by the node.</p>
<p><code>--no-snapshot-fetch</code> forces the local snapshot. After a short restart it saves a download. After a long outage it leaves a large gap that can only be filled by repair from peers, which may be slower than the cluster produces slots.</p>
<p><code>solana catchup --our-localhost</code> compares the node with the cluster and reports whether it is gaining or falling behind:</p>
<pre class="term-snip">$ solana catchup --our-localhost
8vRtQm4K… has 2310 slot(s) behind (us:313190110 them:313192420), our node is gaining at 25.0 slots/second
8vRtQm4K… has caught up (us:313192530 them:313192530)</pre>`),
        widget: snapshots,
        quiz: [
          { q: LL('验证者停机两天后带着 --no-snapshot-fetch 重启，最可能的结果是？', 'A validator was offline for two days and restarts with --no-snapshot-fetch. What is the likely result?'), options: [LL('几秒钟就追上', 'It catches up in seconds'), LL('加载旧的本地快照，一边 repair 一边越落越远', 'It loads an old local snapshot and falls further behind while repairing'), LL('拒绝启动', 'It refuses to start'), LL('照样下载新快照', 'It downloads a fresh snapshot anyway')], answer: 1, why: LL('两天的差距只能靠 repair 补，速度跟不上集群。', 'Two days of slots can only come from repair, which cannot keep up with the cluster.') },
          { q: LL('为什么要把 --known-validator 和 --only-known-rpc 一起用？', 'Why use --known-validator together with --only-known-rpc?'), options: [LL('获得更多质押', 'To attract more stake'), LL('只从可信节点下载快照，因为节点会直接采信快照中的状态', 'To download snapshots only from trusted nodes, because the node accepts snapshot state as given'), LL('加快 gossip', 'To speed up gossip'), LL('决定 leader 顺序', 'To choose the leader order')], answer: 1, why: LL('快照决定了节点的起点状态，来源必须可信。', 'A snapshot sets the node\'s starting state, so its source must be trusted.') },
        ],
      },
    ],
  });

  /* ---------- step 2: build a testnet validator on a new host ---------- */
  const H = () => S.networks.solana.helpers;
  const ID = '8vRtQm4KcZ7wLx2NbYp9HsJd3Fa6Ue5GkT1nWq7XzMpA', VOTE = 'Vt3kPq8WmZ2xRc6NbLd9Hf5Jy7Ts4Ua1GeK3nQrW8sMx', WD = 'Wd9pLq4XkT7mVz2NcR8bHs5Jy3Fa6GeU1oKt4Pw7Qn2Y';
  const SYSCTL = String.raw`printf 'net.core.rmem_default = 134217728\nnet.core.rmem_max = 134217728\nnet.core.wmem_default = 134217728\nnet.core.wmem_max = 134217728\nvm.max_map_count = 1000000\nfs.nr_open = 1000000\n' > /etc/sysctl.d/21-agave-validator.conf`;
  const SCRIPT = String.raw`printf '#!/bin/bash\nexec agave-validator \\\n  --identity /home/sol/validator-keypair.json \\\n  --vote-account /home/sol/vote-account-keypair.json \\\n  --known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \\\n  --known-validator dv1ZAGvdsz5hHLwWXsVnM94hWf1pjbKVau1QVkaMJ92 \\\n  --only-known-rpc \\\n  --entrypoint entrypoint.testnet.solana.com:8001 \\\n  --entrypoint entrypoint2.testnet.solana.com:8001 \\\n  --expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\\n  --ledger /mnt/ledger \\\n  --accounts /mnt/accounts \\\n  --limit-ledger-size \\\n  --dynamic-port-range 8000-8020 \\\n  --rpc-port 8899 \\\n  --private-rpc \\\n  --wal-recovery-mode skip_any_corrupted_record \\\n  --log -\n' > /home/sol/bin/validator.sh`;
  const UNIT = String.raw`printf '[Unit]\nDescription=Agave validator (testnet)\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=sol\nLimitNOFILE=1000000\nLimitMEMLOCK=2000000000\nRestart=on-failure\nRestartSec=5\nExecStart=/home/sol/bin/validator.sh\n\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/agave-validator.service`;
  const c = s => `<code>${S.esc(s)}</code>`;
  const node = w => w.nodes['sol-new'];
  const kpOn = (w, h, p) => { const f = S.fsGet(h, p); return f && typeof f.c === 'string' ? H().pubkeyOf(w, f.c) : null; };
  const serverId = w => kpOn(w, node(w), '/home/sol/validator-keypair.json');
  const laptopKeys = w => Object.keys(w.laptop.fs).filter(p => !['/home/ops/funding-testnet.json', '/home/ops/.config/solana/id.json'].includes(p)).map(p => kpOn(w, w.laptop, p)).filter(Boolean);
  const scriptOk = w => {
    const n = node(w), f = S.fsGet(n, '/home/sol/bin/validator.sh');
    if (!f || !H().execBit(f.mode)) return false;
    const t = String(S.fsRead(w, n, '/home/sol/bin/validator.sh') || '').replace(/\\\n/g, ' ');
    return [/--identity\s+\S+/, /--vote-account\s+\S+/, /--known-validator\s+\S+/, new RegExp('--expected-genesis-hash\\s+' + H().TESTNET_GENESIS), /--entrypoint\s+\S*testnet\S*/, /--ledger\s+\/mnt\/ledger/, /--accounts\s+\/mnt\/accounts/, /--limit-ledger-size/, /--dynamic-port-range\s+8000-8020/, /--rpc-port\s+\d+/].every(re => re.test(t));
  };
  const svcOf = w => node(w).services['agave-validator'];

  S.registerScenario({
    id: 'sol-run', network: 'solana', module: LL('Solana 验证者运维', 'Solana validator operations'), lab: 'R1', difficulty: 1, minutes: 25,
    title: LL('从零搭建 testnet 验证者', 'Build a testnet validator from scratch'),
    tagline: LL('在一台全新的 Ubuntu 主机上搭起 Agave testnet 验证者，从内核调优一直到第一张选票。', 'Bring up an Agave testnet validator on a new Ubuntu host, from kernel tuning to the first vote.'),
    learn: [
      LL('验证者主机需要什么：网络缓冲区、文件句柄上限、开放端口', 'What a validator host needs: network buffers, file limits, open ports'),
      LL('哪些钥匙放在服务器上，哪些必须离线', 'Which keys go on the server and which stay offline'),
      LL('从 vote account 到第一张选票：启动检查、快照下载、追块', 'From vote account to first vote: startup checks, snapshot download, catch-up'),
    ],
    brief: LL(
      `<p>us-west-2 有一台新装好的 Ubuntu 24.04 主机 <b>sol-new</b>：32 核、384 GiB 内存，系统盘之外还有两块 NVMe，分别挂载在 <code>/mnt/ledger</code> 和 <code>/mnt/accounts</code>。除此之外什么都没装。</p><p>在它上面搭一台 Solana <b>testnet</b> 验证者：调好系统，从发布标签编译 Agave，生成钥匙、创建 vote account，写好启动脚本和 systemd unit，然后让节点跑起来，直到它开始投票。每一步完成后，都会解释它对应的基础知识。</p><p>工作电脑上的说明在 <code>~/NOTES.md</code>。那里的 CLI 默认连接 mainnet，默认 keypair 里是 mainnet 的 SOL。</p><p>模拟集群按 Tower BFT 建模：slot 为 400 ms，每票的手续费由 identity 支付。</p>`,
      `<p>A new Ubuntu 24.04 host, <b>sol-new</b>, is ready in us-west-2: 32 cores, 384 GiB of memory, and besides the system disk two NVMe drives mounted at <code>/mnt/ledger</code> and <code>/mnt/accounts</code>. Nothing else is installed.</p><p>Build a Solana <b>testnet</b> validator on it: tune the system, build Agave from a release tag, create the keys and the vote account, write the startup script and the systemd unit, and bring the node up until it votes. After each step the lab explains the concept behind it.</p><p>The workstation notes are in <code>~/NOTES.md</code>. The CLI there defaults to mainnet, and its default keypair holds mainnet SOL.</p><p>The simulated cluster models Tower BFT: 400 ms slots, with each vote's fee paid by the identity.</p>`),
    startAt: '2026-10-14T09:00:00Z',
    config: { fresh: true, burnPerDay: 1.1 },
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
        after: LL('Agave 收发大量 UDP 流量，并把 accounts 数据库映射进内存。启动时它会检查 UDP 缓冲区大小，太小就直接退出。gossip、TPU、TVU 和 repair 都从 <code>--dynamic-port-range</code> 中取端口；gossip 还需要 TCP，其他节点靠它确认本节点可达。文件句柄上限稍后在 systemd unit 里设置。', 'Agave moves a lot of UDP traffic and maps the accounts database into memory. At startup it checks the UDP buffer sizes and exits if they are too small. Gossip, TPU, TVU and repair all take ports from <code>--dynamic-port-range</code>; gossip also needs TCP, which peers use to confirm the node is reachable. The file-descriptor limit is set later, in the systemd unit.'),
        check: w => { const n = node(w); return H().netOk(n) && n.sysctl['vm.max_map_count'] >= 1000000 && H().portsOpen(n, 8000, 8020); },
      },
      {
        text: LL('从发布标签编译 Agave', 'Build Agave from a release tag'),
        how: LL(`Anza 以源码形式发布版本，验证者程序由运维自己编译。克隆发布标签，把程序装到 /usr/local/bin：${c('git clone --branch v4.3.0 --depth 1 https://github.com/anza-xyz/agave.git /opt/agave')}、${c('/opt/agave/scripts/cargo-install-all.sh /usr/local')}，然后 ${c('agave-validator --version')}。编译要几分钟模拟时间，可以先把时钟调快。`, `Anza releases source code, and operators build the validator themselves. Clone the release tag and install the binaries into /usr/local/bin: ${c('git clone --branch v4.3.0 --depth 1 https://github.com/anza-xyz/agave.git /opt/agave')}, ${c('/opt/agave/scripts/cargo-install-all.sh /usr/local')}, then ${c('agave-validator --version')}. The build takes several simulated minutes; speed up the clock meanwhile.`),
        after: LL('只从发布标签编译，不要用 master。版本号是集群认识你的一部分：<code>solana gossip</code> 会显示它，功能激活依赖它，升级也就是换一个标签重新编译。同一次编译还装好了 <code>solana</code> 和 <code>solana-keygen</code>。', 'Build from a release tag, never from master. The version is part of how the cluster sees you: <code>solana gossip</code> shows it, feature activations depend on it, and an upgrade is another tagged build. The same build installs <code>solana</code> and <code>solana-keygen</code>.'),
        check: w => H().binAt(w, node(w), '/usr/local/bin/agave-validator') === '4.3.0' && w.flags.agave_version !== undefined,
      },
      {
        text: LL('在服务器上生成 identity 和 vote account keypair', 'Generate the identity and vote account keypairs on the server'),
        how: LL(`${c('solana-keygen new --no-bip39-passphrase -o /home/sol/validator-keypair.json')}、${c('solana-keygen new --no-bip39-passphrase -o /home/sol/vote-account-keypair.json')}。服务将以 <code>sol</code> 用户运行，把两个文件交给它：${c('chown sol:sol /home/sol/validator-keypair.json /home/sol/vote-account-keypair.json')}。`, `${c('solana-keygen new --no-bip39-passphrase -o /home/sol/validator-keypair.json')}, ${c('solana-keygen new --no-bip39-passphrase -o /home/sol/vote-account-keypair.json')}. The service will run as <code>sol</code>, so hand both files to it: ${c('chown sol:sol /home/sol/validator-keypair.json /home/sol/vote-account-keypair.json')}.`),
        after: LL('identity 签每一票、付每一笔手续费，所以必须在服务器上。vote account keypair 只在创建 vote account 时签一次名，之后没有任何权限（基础课第 2 章）。withdrawer 不在这里生成。', 'The identity signs every vote and pays every fee, so it has to live on the server. The vote account keypair signs only the creation of the vote account and has no authority afterwards (Fundamentals, chapter 2). The withdrawer is not generated here.'),
        check: w => { const n = node(w); return ['/home/sol/validator-keypair.json', '/home/sol/vote-account-keypair.json'].every(p => { const f = S.fsGet(n, p); return f && f.owner === 'sol' && kpOn(w, n, p); }); },
      },
      {
        text: LL('在工作电脑上生成 authorized withdrawer', 'Generate the authorized withdrawer on the workstation'),
        how: LL(`回到工作电脑：${c('exit')}（退出 root），再 ${c('exit')}。在那里生成：${c('solana-keygen new -o ~/authorized-withdrawer-keypair.json')}。输出里有它的公钥，也可以用 ${c('solana-keygen pubkey ~/authorized-withdrawer-keypair.json')} 再看一次。`, `Return to the workstation: ${c('exit')} (leaves root), then ${c('exit')} again. Generate the key there: ${c('solana-keygen new -o ~/authorized-withdrawer-keypair.json')}. The output shows its pubkey; ${c('solana-keygen pubkey ~/authorized-withdrawer-keypair.json')} shows it again.`),
        after: LL('withdrawer 能取走 vote account 的钱、修改佣金、更换 identity。如果它放在服务器上，任何拿到 root 的人都能夺走这台验证者的收入。生产环境里它放在硬件钱包或离线机器上，助记词另外保存。', 'The withdrawer can empty the vote account, change the commission and reassign the identity. On the server, anyone who gained root would own the validator\'s income. In production it lives on a hardware wallet or an offline machine, with the seed phrase stored apart from it.'),
        check: w => laptopKeys(w).length > 0,
      },
      {
        text: LL('在 testnet 上给 identity 充值', 'Fund the identity on testnet'),
        how: LL(`新账户在收到 SOL 之前并不存在，所以 CLI 要求确认：${c(`solana transfer ${ID} 20 --from ~/funding-testnet.json --allow-unfunded-recipient -ut`)}。查看余额：${c(`solana balance ${ID} -ut`)}。`, `A new account does not exist until it holds SOL, so the CLI asks for confirmation: ${c(`solana transfer ${ID} 20 --from ~/funding-testnet.json --allow-unfunded-recipient -ut`)}. Check it: ${c(`solana balance ${ID} -ut`)}.`),
        after: LL('identity 先要付 vote account 的免租金额，之后每票约 5,000 lamports，400 ms slot 下每天约 1.1 SOL（基础课第 3 章）。每条命令都用 <code>-ut</code> 写明集群，用 <code>--from</code> 写明付款方。在这台电脑上漏掉其中任何一个，转出去的都是默认 keypair 里的 mainnet SOL。', 'The identity first pays the vote account\'s rent, then about 5,000 lamports per vote, roughly 1.1 SOL a day at 400 ms slots (Fundamentals, chapter 3). Every command named the cluster with <code>-ut</code> and the payer with <code>--from</code>. Leave either out on this workstation and the transfer spends mainnet SOL from the default keypair.'),
        check: w => !!serverId(w) && H().testnetBal(w, serverId(w)) >= 10,
      },
      {
        text: LL('创建 vote account', 'Create the vote account'),
        how: LL(`回到服务器：${c('ssm sol-new')}、${c('sudo -i')}。在 testnet 上创建，由 identity 付费，withdrawer 只给公钥：${c(`solana create-vote-account -ut --fee-payer /home/sol/validator-keypair.json --commission 10 /home/sol/vote-account-keypair.json /home/sol/validator-keypair.json ${WD}`)}。查看结果：${c(`solana vote-account ${VOTE} -ut`)}。`, `Back on the server: ${c('ssm sol-new')}, ${c('sudo -i')}. Create it on testnet, with the identity paying and the withdrawer given only by its pubkey: ${c(`solana create-vote-account -ut --fee-payer /home/sol/validator-keypair.json --commission 10 /home/sol/vote-account-keypair.json /home/sol/validator-keypair.json ${WD}`)}. Inspect it: ${c(`solana vote-account ${VOTE} -ut`)}.`),
        after: LL('vote account 把 identity 和它的投票、credits 绑在一起。withdrawer 只以公钥出现，私钥从没碰过服务器。佣金要明确指定：CLI 的默认值是 100%，会拿走委托人的全部通胀奖励。', 'The vote account ties the identity to its votes and credits. The withdrawer appears only as a pubkey; its private key never touched the server. Set the commission explicitly: the CLI default is 100%, which keeps all of the delegators\' inflation rewards.'),
        check: w => { const ch = w.chain; return !!ch.vote && ch.identity === serverId(w) && laptopKeys(w).includes(ch.withdrawer); },
      },
      {
        text: LL('写启动脚本', 'Write the startup script'),
        how: LL(`${c('mkdir -p /home/sol/bin')}，然后写入脚本：${c(SCRIPT)}。加上执行权限并检查内容：${c('chmod 755 /home/sol/bin/validator.sh')}、${c('cat /home/sol/bin/validator.sh')}。`, `${c('mkdir -p /home/sol/bin')}, then write the script: ${c(SCRIPT)}. Make it executable and read it back: ${c('chmod 755 /home/sol/bin/validator.sh')}, ${c('cat /home/sol/bin/validator.sh')}.`),
        after: LL('每个参数都有用处。<code>--entrypoint</code> 和 <code>--expected-genesis-hash</code> 把节点固定在 testnet，genesis hash 不对时节点直接停下，不会加入别的集群。<code>--known-validator</code> 和 <code>--only-known-rpc</code> 只从可信节点下载快照（基础课第 7 章）。<code>--ledger</code> 和 <code>--accounts</code> 让两个数据库各用一块盘。<code>--limit-ledger-size</code> 防止 ledger 写满磁盘。<code>--private-rpc</code> 不对外公布 RPC 端口。', 'Each flag has a job. <code>--entrypoint</code> and <code>--expected-genesis-hash</code> pin the node to testnet; with a wrong genesis hash it stops instead of joining another cluster. <code>--known-validator</code> with <code>--only-known-rpc</code> takes snapshots only from trusted nodes (Fundamentals, chapter 7). <code>--ledger</code> and <code>--accounts</code> give each database its own drive. <code>--limit-ledger-size</code> keeps the ledger from filling the disk. <code>--private-rpc</code> does not advertise the RPC port.'),
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
        after: LL('节点从 known validator 下载了快照，加载后重放此后产生的 slot，一点点追近集群，直到到达链头（基础课第 7 章）。只有追上之后，它的投票才有意义。', 'The node downloaded a snapshot from a known validator, loaded it, then replayed the slots produced since, gaining on the cluster until it reached the tip (Fundamentals, chapter 7). Only now do its votes count.'),
        check: w => { const n = node(w); return svcOf(w).state === 'active' && n.sol.phase === 'run' && n.sol.catchup <= 0; },
      },
      {
        text: LL('在链上确认验证者正在投票', 'Confirm on chain that the validator votes'),
        how: LL(`回到工作电脑（${c('exit')}、${c('exit')}）：${c('solana validators -ut')}、${c(`solana gossip -ut | grep ${ID}`)}、${c(`solana vote-account ${VOTE} -ut`)}。credits 随每一票增加。`, `From the workstation (${c('exit')}, ${c('exit')}): ${c('solana validators -ut')}, ${c(`solana gossip -ut | grep ${ID}`)}, ${c(`solana vote-account ${VOTE} -ut`)}. Credits grow with every vote.`),
        after: LL('gossip 说明节点可达，验证者列表说明它的投票正在落地。没有质押的验证者只有在投票时才出现在列表里。它能挣 credits，但在有人委托质押之前拿不到通胀奖励（基础课第 6 章）。', 'Gossip shows the node is reachable; the validator list shows its votes landing. An unstaked validator appears in the list only while it votes. It earns credits, but no inflation rewards until stake is delegated to it (Fundamentals, chapter 6).'),
        check: w => H().isVoting(w, node(w)) && w.chain.credits > 0 && w.flags.fresh_seen !== undefined,
      },
      {
        text: LL('练习安全重启的习惯', 'Practise the safe-restart habit'),
        how: LL(`在服务器上（${c('ssm sol-new')}、${c('sudo -i')}）：${c('agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2')}。`, `On the server (${c('ssm sol-new')}, ${c('sudo -i')}): ${c('agave-validator -l /mnt/ledger wait-for-restart-window --min-idle-time 2')}.`),
        after: LL('<code>wait-for-restart-window</code> 等到验证者在指定时间内没有 leader slot、集群中 delinquent 的质押也足够少时才返回，这时重启不会丢掉出块机会。这台验证者还没有质押，没有 leader slot，所以立即返回。有了质押之后，每次计划内重启都先运行它，再执行 <code>systemctl restart agave-validator</code>。', '<code>wait-for-restart-window</code> returns once the validator has no leader slots within the idle time given and the cluster\'s delinquent stake is low enough, so a restart costs no blocks. This validator has no stake and no leader slots yet, so it returns at once. Once it is staked, run it before every planned restart, then <code>systemctl restart agave-validator</code>.'),
        check: w => w.flags.restart_window !== undefined,
      },
    ].map(st => Object.assign(st, { how: LL(`<p>${st.how.zh}</p>`, `<p>${st.how.en}</p>`) })),
    forbidden: [
      { flag: 'withdrawer_hot', text: LL('把 authorized withdrawer 的 keypair 放到验证者主机上', 'Putting the authorized withdrawer keypair on the validator host') },
      { flag: 'mainnet_spend', text: LL('搭建 testnet 验证者时花掉了 mainnet 的 SOL', 'Spending mainnet SOL while setting up a testnet validator') },
    ],
    limit: 6 * 3600,
    score: w => {
      const ch = w.chain, t = ch.firstVoteAt;
      return [
        [LL('到第一张选票用时', 'Time to first vote'), t != null ? S.fmtDur(t) : '—', t != null && t < 3600 ? 'good' : 'mid'],
        [LL('佣金', 'Commission'), ch.commission != null ? `${ch.commission}%` : '—', ch.commission != null && ch.commission <= 10 ? 'good' : 'mid'],
        [LL('identity 余额（testnet）', 'Identity balance (testnet)'), ch.identity ? `◎ ${(ch.bal[ch.identity] || 0).toFixed(3)}` : '—', ch.identity && ch.bal[ch.identity] >= 8 ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      '本练习按 Agave 搭建 testnet 验证者的通用步骤编写。有三个习惯适用于任何网络。第一，按钥匙的用途决定放在哪里：identity 持续签名，所以在服务器上；withdrawer 控制资金，所以离线。第二，每条命令都写明集群，因为同一个地址在 testnet 和 mainnet 上同时存在。第三，节点自己的启动检查就是它最早的监控：内核参数缺失、端口不通、genesis hash 不对，每一种都会在造成损害之前带着明确的信息停下来。模拟集群按 Tower BFT 和按票收费建模。在运行 Alpenglow 的集群上，按票的手续费换成了每个 epoch 从 vote account 扣的费用，所以除了 identity，vote account 也要留足余额。',
      'This lab follows the standard Agave setup for a testnet validator. Three habits carry over to any network. First, place each key by what it does: the identity signs continuously and lives on the server; the withdrawer controls the money and stays offline. Second, name the cluster in every command, because the same address exists on testnet and on mainnet. Third, the node\'s own startup checks are its first monitoring: a missing kernel setting, a closed port or a wrong genesis hash each stop it with a clear message before it can do harm. The simulated cluster models Tower BFT with per-vote fees. On a cluster running Alpenglow, the per-vote fee is replaced by a per-epoch fee taken from the vote account, so the vote account needs a balance as well as the identity.'),
  });
})(SIM);
