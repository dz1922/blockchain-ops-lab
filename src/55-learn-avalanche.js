/* ============================================================
   Avalanche, steps 1 and 2: fundamentals (a lesson with widgets)
   and "run a validator" (a guided lab on a fresh host).
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL, L = (zh, en) => S.L(zh, en);
  const W = () => S.wg;
  const A = () => S.networks.avalanche.helpers;

  /* ---------- small widget helpers ---------- */
  const title = el => el.appendChild(W().el('div', 'wg-title', L('动手试试', 'Try it')));
  const cap = (el, html) => el.appendChild(W().el('div', 'wg-cap', html));
  const box = (el, html) => { const b = W().el('div', '', html); b.style.cssText = 'font-size:.9rem;color:var(--ink-2);border-top:1px solid var(--line);padding-top:.7rem'; el.appendChild(b); return b; };
  const svgEl = (el, vb, h) => { const d = W().el('div'); d.innerHTML = `<svg viewBox="${vb}" role="img" style="width:100%;max-height:${h}px"></svg>`; el.appendChild(d); return d.firstChild; };
  const fmt = (x, d = 1) => Number(x).toLocaleString(S.lang === 'zh' ? 'zh-CN' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  /* ============================================================
     Chapter widgets
     ============================================================ */

  // 1. The Primary Network: one validator, three chains, and L1s beside it
  function wgPrimary(el) {
    title(el);
    const svg = svgEl(el, '0 0 640 230', 260);
    const info = {
      P: [L('P-Chain（Platform Chain）', 'P-Chain (Platform Chain)'), 'PlatformVM', L('验证者集合、质押与奖励、L1 与子网的注册。新验证者的注册交易发在这条链上，质押期结束时的奖励也由它发放。', 'The validator set, staking and rewards, and the registry of L1s and subnets. A new validator\'s registration is a P-Chain transaction, and the reward at the end of the period is paid here.'), '/ext/bc/P'],
      X: [L('X-Chain（Exchange Chain）', 'X-Chain (Exchange Chain)'), 'AVM', L('创建和转移资产，采用 UTXO 模型。2023 年的 Cortina 升级把它改为线性链，也用 Snowman 共识。', 'Creating and transferring assets, on a UTXO model. The Cortina upgrade in 2023 made it a linear chain that also runs Snowman.'), '/ext/bc/X'],
      C: [L('C-Chain（Contract Chain）', 'C-Chain (Contract Chain)'), 'EVM (coreth)', L('以太坊兼容的智能合约链。大部分用户活动在这里，状态也最大，节点的磁盘和同步时间主要花在它身上。', 'The Ethereum-compatible smart-contract chain. Most user activity happens here and its state is the largest, so it dominates a node\'s disk use and sync time.'), '/ext/bc/C/rpc'],
      L1: [L('Avalanche L1（原称子网）', 'Avalanche L1 (formerly subnet)'), L('任意 VM', 'any VM'), L('有自己的验证者集合。Etna 升级之后，L1 的验证者在 P-Chain 上登记并按时间付费，不必同时验证 Primary Network。旧式子网仍要求其验证者也是 Primary Network 验证者。', 'Has its own validator set. Since the Etna upgrade, L1 validators register on the P-Chain and pay a continuous fee, and need not validate the Primary Network. Legacy subnets still require their validators to be Primary Network validators too.'), L('由 L1 自己决定', 'chosen by the L1')],
    };
    const out = box(el, '');
    let sel = 'P';
    const draw = () => {
      const chain = (k, x, y, label) => {
        const on = sel === k;
        return `<g data-k="${k}" style="cursor:pointer"><rect x="${x}" y="${y}" width="120" height="46" rx="9" fill="${on ? '#26331f' : 'var(--panel-2)'}" stroke="${on ? 'var(--lime)' : 'var(--line-2)'}" stroke-width="${on ? 2 : 1}"/><text x="${x + 60}" y="${y + 28}" text-anchor="middle" font-size="14" style="fill:${on ? 'var(--ink)' : 'var(--ink-2)'}">${label}</text></g>`;
      };
      const line = (y, k) => `<path d="M170 115 C230 115 230 ${y + 23} 290 ${y + 23}" fill="none" stroke="${sel === k ? 'var(--lime)' : 'var(--line-2)'}" stroke-width="${sel === k ? 2.5 : 1.5}"/>`;
      svg.innerHTML = `
        <rect x="20" y="85" width="150" height="60" rx="10" fill="var(--panel-3)" stroke="var(--amber)"/>
        <text x="95" y="110" text-anchor="middle" font-size="13" style="fill:var(--ink)">avalanchego</text>
        <text x="95" y="128" text-anchor="middle" font-size="10">${L('一个 NodeID · 一份质押', 'one NodeID · one stake')}</text>
        ${line(20, 'P')}${line(92, 'X')}${line(164, 'C')}
        ${chain('P', 290, 20, 'P-Chain')}${chain('X', 290, 92, 'X-Chain')}${chain('C', 290, 164, 'C-Chain')}
        <rect x="270" y="8" width="160" height="214" rx="14" fill="none" stroke="var(--line-2)" stroke-dasharray="4 4"/>
        <text x="350" y="226" text-anchor="middle" font-size="10">Primary Network</text>
        <path d="M410 43 L480 60" stroke="${sel === 'L1' ? 'var(--lime)' : 'var(--line-2)'}" stroke-dasharray="3 3"/>
        ${chain('L1', 480, 40, 'L1 · A')}
        <g opacity=".75">${chain('L1x', 480, 120, 'L1 · B')}</g>
        <text x="540" y="200" text-anchor="middle" font-size="10">${L('在 P-Chain 上登记', 'registered on the P-Chain')}</text>`;
      svg.querySelectorAll('[data-k]').forEach(g => g.addEventListener('click', () => { sel = g.dataset.k === 'L1x' ? 'L1' : g.dataset.k; draw(); }));
      const [name, vm, what, api] = info[sel];
      out.innerHTML = `<b>${name}</b> · VM: <code>${vm}</code> · API: <code>${api}</code><br>${what}`;
    };
    W().buttons(el, [['P-Chain', () => { sel = 'P'; draw(); }], ['X-Chain', () => { sel = 'X'; draw(); }], ['C-Chain', () => { sel = 'C'; draw(); }], ['L1', () => { sel = 'L1'; draw(); }]], { toggle: true });
    el.appendChild(out);
    cap(el, L('点击链或按钮。Primary Network 验证者用同一个进程、同一个身份验证全部三条链。', 'Click a chain or a button. A Primary Network validator runs all three chains with one process and one identity.'));
    draw();
  }

  // 2. Snowman: repeated random sampling between two competing blocks
  function wgSnowman(el) {
    title(el);
    const N = 60, COLS = 12, YOU = 29;
    const svg = svgEl(el, '0 0 640 270', 300);
    const st = W().stats(el);
    let k = 20, alpha = 15, beta = 20, share = 0.5, nodes, round, sample = [], playing = true, tally = null;
    const rnd = S.rng(Date.now() & 0xffff);
    const reset = () => {
      nodes = Array.from({ length: N }, (_, i) => ({ pref: rnd() < share ? 1 : 0, cnt: [0, 0], last: -1, conf: 0, done: false }));
      round = 0; sample = []; tally = null; draw();
    };
    const pick = (self) => { const s = new Set(); while (s.size < Math.min(k, N - 1)) { const j = Math.floor(rnd() * N); if (j !== self) s.add(j); } return [...s]; };
    const step = () => {
      round++;
      const prefs = nodes.map(n => n.pref);
      nodes.forEach((n, i) => {
        if (n.done) return;
        const smp = pick(i), votes = [0, 0];
        smp.forEach(j => votes[prefs[j]]++);
        if (i === YOU) { sample = smp; tally = votes; }
        const c = votes[1] >= alpha ? 1 : votes[0] >= alpha ? 0 : -1;
        if (c < 0) { n.conf = 0; return; }
        n.cnt[c]++;
        if (n.cnt[c] > n.cnt[n.pref]) n.pref = c;
        n.conf = c === n.last ? n.conf + 1 : 1;
        n.last = c;
        if (n.conf >= beta) n.done = true;
      });
      draw();
    };
    const pos = i => [40 + (i % COLS) * 50, 40 + Math.floor(i / COLS) * 46];
    const col = p => (p ? 'var(--blue)' : 'var(--amber)');
    function draw() {
      const [yx, yy] = pos(YOU);
      const lines = sample.map(j => { const [x, y] = pos(j); return `<line x1="${yx}" y1="${yy}" x2="${x}" y2="${y}" stroke="${col(nodes[j].pref)}" stroke-opacity=".35"/>`; }).join('');
      const dots = nodes.map((n, i) => { const [x, y] = pos(i); return `<circle cx="${x}" cy="${y}" r="${i === YOU ? 11 : 8}" fill="${col(n.pref)}" fill-opacity="${n.done ? 1 : 0.45}" stroke="${n.done ? 'var(--lime)' : i === YOU ? 'var(--ink)' : 'none'}" stroke-width="2"/>`; }).join('');
      svg.innerHTML = lines + dots + `<text x="${yx - 6}" y="${yy + 26}" font-size="10" style="fill:var(--ink)">${L('你的节点', 'your node')}</text>
        <circle cx="430" cy="258" r="6" fill="var(--amber)"/><text x="440" y="262" font-size="10">${L('区块 A', 'block A')}</text>
        <circle cx="500" cy="258" r="6" fill="var(--blue)"/><text x="510" y="262" font-size="10">${L('区块 B', 'block B')}</text>
        <circle cx="570" cy="258" r="6" fill="none" stroke="var(--lime)" stroke-width="2"/><text x="580" y="262" font-size="10">${L('已接受', 'accepted')}</text>`;
      const me = nodes[YOU], done = nodes.filter(n => n.done).length, allSame = nodes.every(n => n.done && n.pref === nodes[0].pref);
      st.set([
        [L('轮次', 'Round'), round, ''],
        [L('本轮你收到的票（A : B）', 'Your sample (A : B)'), tally ? `${tally[0]} : ${tally[1]}` : '—', tally && Math.max(...tally) >= alpha ? 'good' : tally ? 'mid' : ''],
        [L('你的偏好', 'Your preference'), me.pref ? 'B' : 'A', ''],
        [L('你的连续成功轮数 / β', 'Your streak / β'), me.done ? L('已接受', 'accepted') : `${me.conf} / ${beta}`, me.done ? 'good' : ''],
        [L('已接受的节点', 'Nodes that accepted'), `${done} / ${N}`, allSame ? 'good' : done ? 'mid' : ''],
      ]);
      if (warn) warn.hidden = alpha * 2 > k;
    }
    W().slider(el, { label: L('k：每轮抽样数', 'k: sample size'), min: 2, max: 30, value: k }, v => { k = v; if (alpha > k) alpha = k; if (aS) aS.set(Math.min(aS.value, k)); });
    const aS = W().slider(el, { label: L('α：本轮成立所需票数', 'α: votes needed'), min: 1, max: 30, value: alpha }, v => { alpha = Math.min(v, k); });
    W().slider(el, { label: L('β：接受所需连续轮数', 'β: rounds in a row'), min: 1, max: 30, value: beta }, v => { beta = v; });
    W().slider(el, { label: L('开始时偏好 B 的比例', 'Start: share preferring B'), min: 10, max: 90, value: 50, fmt: v => v + '%' }, v => { share = v / 100; });
    const warn = W().el('div', 'wg-cap', L('α 没有超过 k 的一半：两种结果可能同时达到 α，网络可能长时间无法收敛。', 'α is not more than half of k: both blocks can reach α, and the network may fail to converge for a long time.'));
    warn.style.color = 'var(--amber)'; el.appendChild(warn);
    W().buttons(el, [[L('暂停 / 继续', 'Pause / resume'), () => { playing = !playing; }], [L('单步', 'One round'), () => { playing = false; step(); }], [L('重新开始', 'Restart'), () => { reset(); playing = true; }]]);
    cap(el, L('每轮里，每个节点随机问 k 个节点。至少 α 个回答一致时，这一轮才算数；同一区块连续成功 β 轮，节点就接受它（外圈变绿）。连线是你的节点本轮问到的节点。', 'Each round every node asks k random nodes. The round counts only if at least α answers agree; after β successful rounds in a row for the same block, the node accepts it (green ring). The lines show whom your node asked this round.'));
    reset();
    W().every(450, () => { if (playing && !nodes.every(n => n.done)) step(); });
  }

  // 3. Becoming a validator: the identity files, and what a valid registration looks like
  function wgRegister(el) {
    title(el);
    const files = {
      'staker.crt': [L('TLS 证书。NodeID 由它推导而来。', 'TLS certificate. The NodeID is derived from it.'), L('丢失后节点会生成新的证书，得到新的 NodeID。已注册的那个 NodeID 再也无法上线，整期奖励都会作废。', 'Without it the node generates a new certificate and gets a new NodeID. The registered NodeID can never come online again, and the period\'s reward is lost.')],
      'staker.key': [L('TLS 私钥，与 staker.crt 配对。每条节点间连接都用它握手。', 'TLS private key paired with staker.crt. Every connection to a peer is authenticated with it.'), L('与 staker.crt 一样：丢失就等于换了身份。泄露则意味着别人可以冒充这个 NodeID。', 'As with staker.crt, losing it means a new identity. If it leaks, someone else can impersonate the NodeID.')],
      'signer.key': [L('BLS 私钥。注册时登记的是它的公钥和所有权证明，用于 BLS 签名（例如 Avalanche Warp 消息）。', 'BLS secret key. Its public key and proof of possession are registered on the P-Chain; it produces BLS signatures, for example for Avalanche Warp messages.'), L('重新生成后公钥与链上登记的不一致。同一个 NodeID 续期时也必须用原来的这一份。', 'A regenerated key no longer matches the public key on the P-Chain. Re-registering the same NodeID also needs this same file.')],
    };
    const fbox = box(el, '');
    const showFile = f => { fbox.innerHTML = `<code>~/.avalanchego/staking/${f}</code><br><b>${L('作用：', 'What it is: ')}</b>${files[f][0]}<br><b>${L('丢失或重新生成：', 'If lost or regenerated: ')}</b>${files[f][1]}`; };
    W().buttons(el, Object.keys(files).map(f => [f, () => showFile(f)]), { toggle: true });
    el.appendChild(fbox); showFile('staker.crt');
    const st = W().stats(el);
    let stake = 2000, days = 14, fee = 2;
    const upd = () => {
      const errs = [];
      if (stake < 2000) errs.push(L('质押低于 2,000 AVAX', 'stake below 2,000 AVAX'));
      if (days * 24 < 48) errs.push(L('质押期短于 48 小时', 'period shorter than 48 hours'));
      if (days > 365) errs.push(L('质押期超过一年', 'period longer than one year'));
      if (fee < 2) errs.push(L('委托费率低于 2%', 'delegation fee below 2%'));
      const room = Math.max(0, Math.min(3e6, 5 * stake) - stake);
      st.set([
        [L('交易', 'Transaction'), errs.length ? L('会被拒绝', 'rejected') : L('有效', 'valid'), errs.length ? 'bad' : 'good'],
        [L('最多可接受的委托', 'Delegation it can accept'), stake < 2000 ? '—' : `${fmt(room, 0)} AVAX`, ''],
        [L('允许的离线时间（90%）', 'Downtime allowed (90%)'), `${fmt(days * 24 * 0.1, 1)} h`, days * 24 * 0.1 < 12 ? 'mid' : ''],
        [L('质押期结束', 'Period ends'), L(`接受后 ${days} 天`, `${days} days after acceptance`), ''],
      ]);
      why.textContent = errs.length ? L('原因：', 'Why: ') + errs.join(L('；', '; ')) : L('注意：交易一旦被接受，这些参数就不能再修改。', 'Once the transaction is accepted, none of these can be changed.');
    };
    W().slider(el, { label: L('自有质押（AVAX）', 'Own stake (AVAX)'), min: 1000, max: 20000, step: 250, value: stake, fmt: v => fmt(v, 0) }, v => { stake = v; upd(); });
    W().slider(el, { label: L('质押期（天）', 'Period (days)'), min: 1, max: 400, value: days }, v => { days = v; upd(); });
    W().slider(el, { label: L('委托费率', 'Delegation fee'), min: 0, max: 20, step: 0.5, value: fee, fmt: v => v.toFixed(1) + '%' }, v => { fee = v; upd(); });
    const why = W().el('div', 'wg-cap'); el.appendChild(why);
    upd();
  }

  // 4. Uptime calculator
  function wgUptime(el) {
    title(el);
    const st = W().stats(el);
    const m = W().el('div'); el.appendChild(m);
    let period = 14, left = 7, down = 10, thr = 90;
    let downS, leftS;
    const upd = () => {
      const P = period * 24, el2 = (period - left) * 24;
      const now = el2 > 0 ? 100 * (1 - down / el2) : 100, end = 100 * (1 - down / P), allow = P * (1 - thr / 100) - down;
      const ok = end >= thr;
      st.set([
        [L('目前的在线率', 'Uptime so far'), el2 > 0 ? fmt(Math.max(0, now), 2) + '%' : '—', now >= thr ? 'good' : 'mid'],
        [L('期末在线率（之后不再离线）', 'End of period (no more downtime)'), fmt(Math.max(0, end), 2) + '%', ok ? 'good' : 'bad'],
        [L('还能离线', 'Downtime still allowed'), ok ? `${fmt(allow, 1)} h` : L('已无余量', 'none'), ok ? (allow < 6 ? 'mid' : 'good') : 'bad'],
        [L('奖励', 'Reward'), ok ? L('保住', 'kept') : L('整期作废', 'forfeited'), ok ? 'good' : 'bad'],
      ]);
      const pos = v => Math.max(0, Math.min(100, (v - 70) / 30 * 100));
      m.innerHTML = W().meter(pos(end), ok ? (allow < 6 ? 'mid' : '') : 'bad', [[pos(thr), thr + '%']]) + `<div class="wg-cap" style="display:flex;justify-content:space-between"><span>70%</span><span>${L('标记线以上保住奖励', 'above the mark keeps the reward')} (${thr}%)</span><span>100%</span></div>`;
    };
    W().slider(el, { label: L('质押期（天）', 'Period length (days)'), min: 2, max: 365, value: period }, v => {
      period = v;
      if (leftS) { leftS.input.max = v; if (left > v) leftS.set(v); }
      if (downS) { downS.input.max = Math.max(1, Math.round((v - left) * 24)); if (down > (v - left) * 24) downS.set(Math.floor((v - left) * 24)); }
      upd();
    });
    leftS = W().slider(el, { label: L('剩余天数', 'Days left'), min: 0, max: period, value: left }, v => {
      left = v;
      if (downS) { downS.input.max = Math.max(1, Math.round((period - v) * 24)); if (down > (period - v) * 24) downS.set(Math.floor((period - v) * 24)); }
      upd();
    });
    downS = W().slider(el, { label: L('至今离线（小时）', 'Hours down so far'), min: 0, max: (period - left) * 24, value: down, fmt: v => v + ' h' }, v => { down = v; upd(); });
    W().buttons(el, [[L('门槛 90%（Helicon 之后开始的质押期）', '90% threshold (period started after Helicon)'), () => { thr = 90; upd(); }], [L('门槛 80%（Helicon 之前开始的质押期）', '80% threshold (period started before Helicon)'), () => { thr = 80; upd(); }]], { toggle: true });
    cap(el, L('在线率是累计值。剩下的每一天如果都在线，它就会往上走。判断奖励看期末值，不看当前值。', 'Uptime is cumulative: every remaining day online pulls it up. Judge the reward by the end-of-period figure, not the current one.'));
    upd();
  }

  // 5. Bootstrapping per chain, and the one-way database migration
  function wgBootstrap(el) {
    title(el);
    const bars = W().el('div'); bars.style.cssText = 'display:grid;gap:.55rem'; el.appendChild(bars);
    const st = W().stats(el);
    // relative work units per chain; C-Chain without state sync executes all history
    let stateSync = true, t = 0, running = true;
    const work = () => ({ P: 30, X: 10, C: stateSync ? 40 : 260 });
    const prog = () => {
      const w = work(), p = Math.min(1, t / w.P), rest = Math.max(0, t - w.P);
      return { P: p, X: Math.min(1, rest / w.X), C: Math.min(1, rest / w.C), total: w.P + Math.max(w.X, w.C) };
    };
    const draw = () => {
      const p = prog(), row = (k, v, note) => `<div style="display:grid;grid-template-columns:5.5rem 1fr 11.5rem;gap:.7rem;align-items:center;font-size:.85rem"><span class="mono">${k}-Chain</span>${W().meter(v * 100, v >= 1 ? '' : 'mid')}<span class="mono" style="font-size:.76rem;color:var(--ink-3);white-space:nowrap">${v >= 1 ? 'isBootstrapped: true' : v > 0 ? note : k === 'P' ? L('未开始', 'not started') : L('等待 P-Chain', 'waiting for P')}</span></div>`;
      bars.innerHTML = row('P', p.P, L('获取并执行区块', 'fetch + execute')) + row('X', p.X, L('获取并执行区块', 'fetch + execute')) + row('C', p.C, stateSync ? L('状态同步', 'state sync') : L('执行全部历史', 'execute history'));
      const done = p.P >= 1 && p.X >= 1 && p.C >= 1;
      st.set([
        [L('/ext/health', '/ext/health'), done ? 'healthy' : '503', done ? 'good' : 'mid'],
        [L('相对耗时', 'Relative time'), `${Math.round(p.total)} ${L('单位', 'units')}`, stateSync ? 'good' : 'bad'],
        [L('C-Chain 执行的历史区块', 'C-Chain history executed'), stateSync ? L('无', 'none') : L('全部', 'all'), stateSync ? 'good' : 'mid'],
      ]);
    };
    W().buttons(el, [[L('从头同步', 'Sync from scratch'), () => { t = 0; running = true; }], [L('C-Chain 状态同步：开', 'C-Chain state sync: on'), () => { stateSync = true; t = 0; running = true; }], [L('C-Chain 状态同步：关', 'C-Chain state sync: off'), () => { stateSync = false; t = 0; running = true; }]]);
    W().loop(dt => { if (!running) return; t += dt * 22; if (t >= prog().total) { t = prog().total; running = false; } draw(); });
    draw();
    el.appendChild(W().el('div', 'wg-title', L('数据库格式与二进制版本', 'Database format and binary version')));
    const res = box(el, '');
    let dbv = 1, bin = 1;
    const outcome = () => {
      const r = bin > dbv ? [L('新版本先把数据库迁移到新格式，然后重放区块。期间节点不健康，这是正常过程。迁移只能向前。', 'The newer release migrates the database to its format, then replays blocks. The node is unhealthy meanwhile; this is expected. The migration only goes forward.'), 'var(--amber)']
        : bin === dbv ? [L('格式一致，节点直接启动，只需追上停机期间的区块。', 'Formats match. The node starts and only catches up on the blocks it missed.'), 'var(--lime)']
          : [L('旧二进制读不了新格式，启动即退出：<code>unknown codec version</code>。systemd 每 5 秒重启一次，每次都失败。修复方法是装回较新的版本，不需要删库重同步。', 'The older binary cannot read the newer format and exits at startup: <code>unknown codec version</code>. systemd restarts it every 5 seconds and it fails each time. The fix is to install the newer release again; no wipe and resync is needed.'), 'var(--red)'];
      res.innerHTML = `<b style="color:${r[1]}">${L(`数据库：${['旧', '新'][dbv]}格式 · 二进制：${['旧', '新', '更新'][bin]}版本`, `Database: ${['older', 'newer'][dbv]} format · binary: ${['older', 'newer', 'newest'][bin]} release`)}</b><br>${r[0]}`;
    };
    W().buttons(el, [[L('数据库：旧格式', 'Database: older format'), () => { dbv = 0; outcome(); }], [L('数据库：新格式', 'Database: newer format'), () => { dbv = 1; outcome(); }]], { toggle: true, selected: 1 });
    W().buttons(el, [[L('装旧版本', 'Install older release'), () => { bin = 0; outcome(); }], [L('装新版本', 'Install newer release'), () => { bin = 1; outcome(); }], [L('装更新的版本', 'Install a later release'), () => { bin = 2; outcome(); }]], { toggle: true, selected: 1 });
    el.appendChild(res); outcome();
  }

  // 6. Network upgrades: when the node is upgraded relative to activation
  function wgUpgrade(el) {
    title(el);
    const svg = svgEl(el, '0 0 640 120', 150);
    const st = W().stats(el);
    let at = -24, period = 14;
    const RESTART = 0.4; // hours of restart, migration and replay
    const upd = () => {
      const x = h => 40 + (h + 72) / 96 * 560;
      const lateH = Math.max(0, at + RESTART) - Math.max(0, at), down = at > 0 ? at + RESTART : RESTART;
      const offAfter = at > 0 ? at : 0;
      svg.innerHTML = `<line x1="40" y1="60" x2="600" y2="60" stroke="var(--line-2)" stroke-width="2"/>
        ${[-72, -48, -24, 0, 24].map(h => `<line x1="${x(h)}" y1="54" x2="${x(h)}" y2="66" stroke="var(--line-2)"/><text x="${x(h)}" y="84" text-anchor="middle" font-size="10">${h === 0 ? L('激活', 'activation') : (h > 0 ? '+' : '') + h + 'h'}</text>`).join('')}
        <line x1="${x(0)}" y1="20" x2="${x(0)}" y2="100" stroke="var(--red)" stroke-width="2"/>
        ${offAfter > 0 ? `<rect x="${x(0)}" y="48" width="${x(offAfter) - x(0)}" height="24" fill="var(--red)" fill-opacity=".35"/><text x="${(x(0) + x(offAfter)) / 2}" y="44" text-anchor="middle" font-size="10" style="fill:var(--red)">${L('被网络断开', 'disconnected by peers')}</text>` : ''}
        <rect x="${x(at)}" y="50" width="${Math.max(3, x(at + RESTART) - x(at))}" height="20" fill="var(--amber)"/>
        <text x="${x(at)}" y="108" text-anchor="middle" font-size="10" style="fill:var(--amber)">${L('升级并重启', 'upgrade + restart')}</text>`;
      const cost = down / (period * 24) * 100;
      st.set([
        [L('离线时间', 'Time offline'), `${fmt(down, 1)} h`, at > 0 ? 'bad' : 'good'],
        [L('其中激活后被断开', 'of which after activation'), `${fmt(offAfter + lateH, 1)} h`, offAfter > 0 ? 'bad' : 'good'],
        [L('占用本期在线率', 'Uptime cost this period'), `${fmt(cost, 2)} pp`, cost > 5 ? 'bad' : cost > 1 ? 'mid' : 'good'],
      ]);
    };
    W().slider(el, { label: L('升级时间（相对激活）', 'Upgrade at (vs activation)'), min: -72, max: 24, value: at, fmt: v => (v > 0 ? '+' : '') + v + 'h' }, v => { at = v; upd(); });
    W().slider(el, { label: L('质押期（天）', 'Period length (days)'), min: 2, max: 365, value: period }, v => { period = v; upd(); });
    cap(el, L('激活之前升级，只付出一次重启的代价。激活之后才升级，从激活时刻起直到升级完成，节点都被记为离线。', 'Upgrading before activation costs one restart. Upgrading after activation adds every hour from activation until the upgrade is done, recorded as offline.'));
    upd();
  }

  // 7. Ports and reachability
  function wgPorts(el) {
    title(el);
    const svg = svgEl(el, '0 0 640 220', 250);
    const st = W().stats(el);
    const s = { fw9651: false, ipOk: true, host0: false, fw9650: false };
    const upd = () => {
      const reach = s.fw9651 && s.ipOk, api = s.host0 && s.fw9650;
      const arrow = (y, ok, label, x2) => `<line x1="150" y1="${y}" x2="${x2}" y2="${y}" stroke="${ok ? 'var(--lime)' : 'var(--red)'}" stroke-width="2.5" ${ok ? '' : 'stroke-dasharray="6 5"'}/><text x="${(150 + x2) / 2}" y="${y - 8}" text-anchor="middle" font-size="10" style="fill:${ok ? 'var(--lime)' : 'var(--red)'}">${label}</text>`;
      svg.innerHTML = `
        <rect x="20" y="40" width="130" height="140" rx="14" fill="var(--panel-2)" stroke="var(--line-2)"/>
        <text x="85" y="104" text-anchor="middle" font-size="12" style="fill:var(--ink)">${L('互联网', 'Internet')}</text>
        <text x="85" y="122" text-anchor="middle" font-size="10">${L('其他验证者 · 任何人', 'other validators · anyone')}</text>
        <rect x="330" y="20" width="290" height="180" rx="14" fill="var(--panel-3)" stroke="var(--amber)"/>
        <text x="475" y="40" text-anchor="middle" font-size="11" style="fill:var(--ink)">avax · ${s.ipOk ? 'public-ip ✓' : L('public-ip 已过期', 'public-ip stale')}</text>
        <rect x="350" y="60" width="250" height="42" rx="8" fill="var(--panel)" stroke="var(--line-2)"/>
        <text x="362" y="86" font-size="12" style="fill:var(--ink)">9651 staking / P2P</text>
        <rect x="350" y="130" width="250" height="42" rx="8" fill="var(--panel)" stroke="var(--line-2)"/>
        <text x="362" y="150" font-size="12" style="fill:var(--ink)">9650 HTTP API</text>
        <text x="362" y="165" font-size="10">${s.host0 ? 'http-host 0.0.0.0' : 'http-host 127.0.0.1'}</text>
        <rect x="290" y="50" width="12" height="130" fill="${'var(--line-2)'}"/><text x="296" y="196" text-anchor="middle" font-size="9">ufw</text>
        ${arrow(81, reach, reach ? L('可以连入', 'peers connect') : !s.ipOk ? L('拨打旧地址', 'dialing the old IP') : L('被防火墙挡住', 'blocked'), reach ? 350 : 288)}
        ${arrow(151, api, api ? L('API 对外暴露', 'API exposed') : L('外部无法访问', 'not reachable'), api ? 350 : (s.fw9650 ? 350 : 288))}`;
      if (!api && s.fw9650) svg.innerHTML += `<text x="475" y="190" text-anchor="middle" font-size="9" style="fill:var(--ink-3)">${L('只监听 127.0.0.1，外部连不上', 'listens on 127.0.0.1 only')}</text>`;
      st.set([
        ['connected', reach ? 'true' : 'false', reach ? 'good' : 'bad'],
        [L('在线率', 'Uptime'), reach ? L('累计', 'accrues') : L('流失中', 'being lost'), reach ? 'good' : 'bad'],
        [L('健康检查 network 项（验证者）', 'health check: network (validator)'), reach ? 'ok' : L('失败', 'failing'), reach ? 'good' : 'bad'],
        [L('9650 API', '9650 API'), api ? L('任何人都能调用', 'open to anyone') : L('仅本机', 'local only'), api ? 'bad' : 'good'],
      ]);
    };
    const tog = (key, on, off) => W().buttons(el, [[off, () => { s[key] = false; upd(); }], [on, () => { s[key] = true; upd(); }]], { toggle: true, selected: s[key] ? 1 : 0 });
    tog('fw9651', 'ufw allow 9651/tcp', L('9651 未放行', '9651 closed'));
    tog('ipOk', L('public-ip 正确', 'public-ip correct'), L('public-ip 是旧地址', 'public-ip is the old address'));
    tog('host0', 'http-host 0.0.0.0', 'http-host 127.0.0.1');
    tog('fw9650', 'ufw allow 9650/tcp', L('9650 未放行', '9650 closed'));
    cap(el, L('9651 必须能从外部连入，public-ip 必须是别人能拨通的地址。9650 只给本机的工具和监控用。', '9651 must be reachable from outside, and public-ip must be an address peers can dial. 9650 is for tools and monitoring on the host itself.'));
    upd();
  }

  /* ============================================================
     Step 1: the lesson
     ============================================================ */
  S.registerLesson({
    id: 'avalanche-basics', network: 'avalanche', minutes: 35,
    title: LL('Avalanche 验证者运维基础', 'Avalanche fundamentals for validator operators'),
    tagline: LL('Primary Network 的三条链、Snowman 共识、身份与注册、在线率与奖励、同步、网络升级和端口。', 'The three Primary Network chains, Snowman consensus, identity and registration, uptime and rewards, sync, network upgrades and ports.'),
    chapters: [
      {
        title: LL('Primary Network', 'The Primary Network'),
        body: LL(
          `<p>Avalanche 上运行着许多条区块链。<b>Primary Network</b> 是其中内置的三条链，每个 Avalanche 验证者都要运行它们：</p>
          <table><tr><th>链</th><th>虚拟机</th><th>职责</th></tr>
          <tr><td>P-Chain</td><td>PlatformVM</td><td>验证者集合、质押、奖励，以及 L1 和子网的登记</td></tr>
          <tr><td>X-Chain</td><td>AVM</td><td>创建和转移资产，UTXO 模型</td></tr>
          <tr><td>C-Chain</td><td>EVM（coreth）</td><td>智能合约。大部分用户活动在这里，状态也远大于另外两条链</td></tr></table>
          <p>Primary Network 验证者只质押一次 AVAX，用同一个节点、同一个身份验证全部三条链。节点是一个进程 <code>avalanchego</code>，有一个数据库和一套质押密钥。任何一条链出问题，都是这个验证者的问题：<code>/ext/health</code> 分别报告每条链的状态，三条链都正常，节点才算健康。</p>
          <p>其余的链属于 <b>Avalanche L1</b>（过去称为子网）。L1 有自己的验证者集合。Etna 升级之后，L1 验证者在 P-Chain 上登记并按时间付费，不必同时验证 Primary Network。本课程讲的是 Primary Network 验证者。</p>`,
          `<p>Avalanche runs many blockchains. The <b>Primary Network</b> is the set of three built-in chains that every Avalanche validator runs:</p>
          <table><tr><th>Chain</th><th>Virtual machine</th><th>Role</th></tr>
          <tr><td>P-Chain</td><td>PlatformVM</td><td>The validator set, staking, rewards, and the registry of L1s and subnets</td></tr>
          <tr><td>X-Chain</td><td>AVM</td><td>Creating and transferring assets, on a UTXO model</td></tr>
          <tr><td>C-Chain</td><td>EVM (coreth)</td><td>Smart contracts. Most user activity happens here, and its state is far larger than the other two</td></tr></table>
          <p>A Primary Network validator stakes AVAX once and validates all three chains with the same node and the same identity. The node is one process, <code>avalanchego</code>, with one database and one set of staking keys. A problem on any chain is a problem for the validator: <code>/ext/health</code> reports each chain separately, and the node is healthy only when all three are.</p>
          <p>Other chains are <b>Avalanche L1s</b> (formerly called subnets). An L1 has its own validator set. Since the Etna upgrade, L1 validators register on the P-Chain and pay a continuous fee, and do not have to validate the Primary Network. This course covers Primary Network validators.</p>`),
        widget: wgPrimary,
        quiz: [
          { q: LL('验证者集合和质押奖励记录在哪条链上？', 'Which chain holds the validator set and pays staking rewards?'), options: [LL('X-Chain', 'X-Chain'), LL('P-Chain', 'P-Chain'), LL('C-Chain', 'C-Chain'), LL('每个 L1 各自记录', 'Each L1 keeps its own')], answer: 1, why: LL('质押、验证者注册和奖励都是 P-Chain 的交易和状态。', 'Staking, validator registration and rewards are P-Chain transactions and state.') },
          { q: LL('某个 Primary Network 验证者的 C-Chain 卡住了，P-Chain 和 X-Chain 正常。/ext/health 会怎样报告？', 'A Primary Network validator\'s C-Chain is stuck while P and X are fine. What does /ext/health report?'), options: [LL('healthy，质押由 P-Chain 决定', 'Healthy, because staking is decided on the P-Chain'), LL('unhealthy，三条链都正常节点才健康', 'Unhealthy: the node is healthy only when every chain is'), LL('healthy，C-Chain 对验证者是可选的', 'Healthy, the C-Chain is optional for validators')], answer: 1, why: LL('验证者要验证全部三条链，健康检查按链分别报告。', 'A validator validates all three chains, and the health check reports each one.') },
        ],
      },
      {
        title: LL('Snowman 共识', 'Snowman consensus'),
        body: LL(
          `<p>Avalanche 的共识不选举出块领导者，也不收集全体验证者的投票。每个节点反复向随机抽取的一小部分验证者询问它们偏好哪个区块，再根据回答调整自己的偏好。</p>
          <ul><li><b>k</b>：每一轮抽样询问多少个验证者。抽样按质押权重进行。</li><li><b>α（alpha）</b>：k 个回答中至少要有多少个一致，这一轮才算成功。α 必须超过 k 的一半。</li><li><b>β（beta）</b>：同一个区块需要连续成功多少轮，节点才最终接受它。</li></ul>
          <p>avalanchego 的默认值是 k = 20、α = 15、β = 20：节点连续 20 轮都从 20 个回答中得到至少 15 个对同一区块的支持，就接受这个区块。接受即最终，不会发生重组。Snowman 是这个协议的线性形式（区块一个接一个），Primary Network 的三条链都使用它。</p>
          <p>对运维来说，这意味着两件事。验证者必须一直及时回应查询，否则会拖慢其他节点。另一方面，一台验证者离线也不会让网络停下来，其他节点会抽样询问别的验证者。</p>`,
          `<p>Avalanche consensus does not elect a leader and does not collect votes from every validator. Each node repeatedly asks a small random sample of validators which block they prefer, and adjusts its own preference from the answers.</p>
          <ul><li><b>k</b>: how many validators are sampled in each round. Sampling is weighted by stake.</li><li><b>α (alpha)</b>: how many of the k answers must agree for the round to succeed. α must be more than half of k.</li><li><b>β (beta)</b>: how many successful rounds in a row, all for the same block, before the node accepts it as final.</li></ul>
          <p>avalanchego's defaults are k = 20, α = 15 and β = 20. A node that gets at least 15 of 20 answers for the same block in 20 consecutive rounds accepts that block. Acceptance is final; there are no reorganisations. Snowman is the linear form of this protocol, one block after another, and all three Primary Network chains use it.</p>
          <p>Two things follow for the operator. A validator has to answer queries promptly at all times, or it slows its peers down. And one validator going offline does not stop the network: the others simply sample someone else.</p>`),
        widget: wgSnowman,
        after: LL('<div class="note">把 α 调到 k 的一半或更低再试一次：两个区块都可能达到 α，节点在两者之间来回切换，很久都无法接受任何一个。α 必须是 k 中明确的多数，这是安全性的来源。</div>', '<div class="note">Set α to half of k or lower and run it again. Both blocks can reach α, nodes flip between them, and it can take a long time before anyone accepts either. α has to be a clear majority of k; that is where safety comes from.</div>'),
        quiz: [
          { q: LL('k = 20、α = 15。某节点本轮收到 14 票支持区块 A，6 票支持区块 B。它的连续成功计数会怎样？', 'With k = 20 and α = 15, a node gets 14 answers for block A and 6 for block B. What happens to its streak?'), options: [LL('A 的计数加一', 'It grows for A'), LL('清零：本轮没有达到 α', 'It resets: no answer reached α this round'), LL('改为偏好 B', 'It switches to B'), LL('直接接受 A', 'It accepts A')], answer: 1, why: LL('14 < 15，本轮不成立，连续计数从零开始。', '14 is below 15, so the round fails and the streak starts again from zero.') },
          { q: LL('为什么一台验证者离线不会让共识停下来？', 'Why does one offline validator not stall consensus?'), options: [LL('区块要等全部验证者投票', 'Blocks wait for every validator to vote'), LL('每轮随机抽样 k 个验证者，其他验证者照常回答', 'Each round samples k validators at random, and the others answer as usual'), LL('P-Chain 会立即把它移出验证者集合', 'The P-Chain removes it from the validator set at once')], answer: 1, why: LL('抽样不依赖任何特定节点。离线的代价由这台验证者自己承担：在线率下降。', 'Sampling does not depend on any particular node. The cost of being offline falls on that validator: its uptime drops.') },
        ],
      },
      {
        title: LL('成为验证者', 'Becoming a validator'),
        body: LL(
          `<p>验证者的身份是三个文件。avalanchego 第一次启动时在服务用户的 staking 目录下生成它们，默认是 <code>$HOME/.avalanchego/staking/</code>（例如 <code>/home/avalanche/.avalanchego/staking/</code>）：</p>
          <table><tr><th>文件</th><th>内容</th><th>决定什么</th></tr>
          <tr><td><code>staker.crt</code>、<code>staker.key</code></td><td>TLS 证书和私钥</td><td>NodeID 由证书推导而来；每条节点间连接都用它认证</td></tr>
          <tr><td><code>signer.key</code></td><td>BLS 私钥</td><td>链上登记的 BLS 公钥；用于 BLS 签名，例如 Avalanche Warp 消息</td></tr></table>
          <p><code>info.getNodeID</code> 返回 NodeID 和 <code>nodePOP</code>：BLS 公钥，加上一个<b>所有权证明</b>（proof of possession），即用私钥做的签名，证明登记这个公钥的人确实持有对应的私钥。注册交易要同时带上这两样。</p>
          <p>注册是 P-Chain 上的一笔 <code>AddPermissionlessValidatorTx</code>，由持有质押资金的钱包签名。这个钱包不需要、也不应该放在节点上。主网的参数：</p>
          <ul><li>最低质押 2,000 AVAX。验证者的总权重（自有质押加委托）上限为 3,000,000 AVAX 与自有质押 5 倍中较小的一个。</li><li>质押期：Helicon 升级之后最短 48 小时（之前是两周），最长一年。</li><li>委托费率至少 2%。委托人把 AVAX 委托给你的节点，你从他们的奖励中抽取这个比例。</li><li>质押期从交易被接受的那一刻开始（Durango 升级，ACP-41）。交易一旦被接受，参数就不能再修改。</li></ul>
          <div class="note warn">丢失 staking 文件就意味着新的 NodeID：已注册的验证者再也连不上网络，在线率持续下降，整期奖励面临作废。丢失 <code>signer.key</code> 则意味着链上登记的 BLS 公钥对不上。文件一生成，就把三个文件都备份到主机以外的地方。对已经注册的 NodeID，永远不要重新生成这些文件。</div>`,
          `<p>A validator's identity is three files. avalanchego creates them on first start in the service user's staking directory, by default <code>$HOME/.avalanchego/staking/</code> (for example <code>/home/avalanche/.avalanchego/staking/</code>):</p>
          <table><tr><th>File</th><th>What it is</th><th>What it determines</th></tr>
          <tr><td><code>staker.crt</code>, <code>staker.key</code></td><td>TLS certificate and key</td><td>The NodeID is derived from the certificate; every peer connection is authenticated with them</td></tr>
          <tr><td><code>signer.key</code></td><td>BLS secret key</td><td>The BLS public key registered on the P-Chain; produces BLS signatures, for example for Avalanche Warp messages</td></tr></table>
          <p><code>info.getNodeID</code> returns the NodeID and a <code>nodePOP</code>: the BLS public key plus a <b>proof of possession</b>, a signature made with the secret key that proves whoever registers the public key also holds it. The registration carries both.</p>
          <p>Registration is an <code>AddPermissionlessValidatorTx</code> on the P-Chain, signed by the wallet that holds the stake. That wallet does not need to be on the node, and should not be. On mainnet:</p>
          <ul><li>The minimum stake is 2,000 AVAX. A validator's total weight (own stake plus delegations) is capped at the lower of 3,000,000 AVAX and five times its own stake.</li><li>The staking period is at least 48 hours since the Helicon upgrade (two weeks before it) and at most one year.</li><li>The delegation fee is at least 2%. Delegators stake AVAX on your node, and you keep this share of their rewards.</li><li>The period starts when the transaction is accepted (Durango upgrade, ACP-41). Once it is accepted, its parameters cannot be changed.</li></ul>
          <div class="note warn">Losing the staking files means a new NodeID. The registered validator can no longer reach the network, its uptime falls, and the period's reward is at risk. Losing <code>signer.key</code> means the BLS key registered on the P-Chain no longer matches. Back up all three files off the host as soon as they exist, and never generate new ones for a NodeID that is registered.</div>`),
        widget: wgRegister,
        quiz: [
          { q: LL('哪个文件决定 NodeID？', 'Which file decides the NodeID?'), options: [LL('signer.key', 'signer.key'), LL('staker.crt（及其私钥 staker.key）', 'staker.crt (with its key, staker.key)'), LL('/etc/avalanche/config.json', '/etc/avalanche/config.json'), LL('钱包私钥', 'The wallet key')], answer: 1, why: LL('NodeID 由 TLS 证书推导而来，与钱包和配置无关。', 'The NodeID is derived from the TLS certificate. The wallet and the config play no part.') },
          { q: LL('注册交易为什么要带所有权证明？', 'Why does the registration carry a proof of possession?'), options: [LL('证明登记 BLS 公钥的人持有对应的私钥', 'To prove that whoever registers the BLS public key holds its secret key'), LL('证明质押资金的来源', 'To prove where the stake came from'), LL('加密节点之间的流量', 'To encrypt traffic between nodes')], answer: 0, why: LL('没有这个证明，任何人都可以登记别人的公钥。', 'Without it, anyone could register someone else\'s public key.') },
          { q: LL('自有质押 2,000 AVAX，这个节点最多还能接受多少委托？', 'With 2,000 AVAX of own stake, how much delegation can the node accept at most?'), options: [LL('8,000 AVAX', '8,000 AVAX'), LL('10,000 AVAX', '10,000 AVAX'), LL('3,000,000 AVAX', '3,000,000 AVAX'), LL('没有上限', 'No limit')], answer: 0, why: LL('总权重上限是 min(3,000,000, 5 × 2,000) = 10,000，减去自有的 2,000。', 'Total weight is capped at min(3,000,000, 5 × 2,000) = 10,000; minus the own 2,000.') },
        ],
      },
      {
        title: LL('在线率与奖励', 'Uptime and rewards'),
        body: LL(
          `<p>每个验证者都记录自己与其他验证者保持连接的时间。质押期结束时，P-Chain 依据验证者们按质押加权的观察结果，判断这台验证者在本期内的在线时间是否足够。验证者无法自己申报在线率。</p>
          <p>Helicon 升级（ACP-267）之后，激活后开始的质押期门槛是 <b>90%</b>；激活前已经开始的质押期仍按原来的 80% 判定。奖励是全有或全无：90.01% 拿到全部奖励，89.99% 一分也没有。质押本金无论如何都会退回。</p>
          <pre class="term-snip">目前在线率   = 1 − 离线时间 ÷ 已过时间
期末在线率   = 1 − 离线时间 ÷ 整期长度      （假设之后不再离线）
还能离线多久 = 10% × 整期长度 − 已离线时间</pre>
          <p>14 天的质押期总共只允许离线约 33.6 小时；一年的质押期允许约 36.5 天。质押期越短，出一次事故的余量越小。</p>
          <p>读取在线率要用独立节点，例如向 <code>api.avax.network</code> 调用 <code>platform.getCurrentValidators</code>。向节点询问它自己的记录，结果总是接近 100%：它离线期间什么也观察不到。</p>`,
          `<p>Every validator records how long it has been connected to each of the others. When a staking period ends, the P-Chain decides from the validators' stake-weighted view whether this validator was up for enough of the period. A validator cannot report its own uptime.</p>
          <p>Since the Helicon upgrade (ACP-267) the threshold is <b>90%</b> for periods that start after activation. Periods that began before activation are still judged against 80%. The reward is all or nothing: at 90.01% the full reward is paid, at 89.99% none of it. The stake itself is always returned.</p>
          <pre class="term-snip">uptime so far       = 1 − downtime ÷ time elapsed
end-of-period       = 1 − downtime ÷ period length     (if no further downtime)
downtime still left = 10% × period length − downtime so far</pre>
          <p>A 14-day period allows about 33.6 hours offline in total; a one-year period allows about 36.5 days. The shorter the period, the less room one bad day leaves.</p>
          <p>Read uptime from an independent node, for example <code>platform.getCurrentValidators</code> on <code>api.avax.network</code>. A node asked about its own record reports close to 100%, because it observes nothing while it is down.</p>`),
        widget: wgUptime,
        quiz: [
          { q: LL('质押期 30 天，已离线 60 小时，还剩 10 天。之后如果不再出问题，按 90% 门槛能保住奖励吗？', 'A 30-day period, 60 hours offline so far, 10 days left. If nothing else goes wrong, is the reward kept at the 90% threshold?'), options: [LL('能，期末约 91.7%，还有约 12 小时余量', 'Yes: it ends at about 91.7%, with about 12 hours to spare'), LL('不能，目前在线率只有 87.5%', 'No: uptime so far is only 87.5%'), LL('不能，离线超过了 48 小时', 'No: it has been down for more than 48 hours')], answer: 0, why: LL('期末值 = 1 − 60 ÷ 720 ≈ 91.7%。目前值偏低，但剩下的 10 天在线会把它拉上来。', 'End of period = 1 − 60 ÷ 720 ≈ 91.7%. The current figure is low, but ten more days online pull it up.') },
          { q: LL('判断奖励时，在线率应该从哪里读？', 'Where should uptime be read to judge the reward?'), options: [LL('节点本地的 info.uptime', 'info.uptime on the node itself'), LL('独立节点（如 api.avax.network）上的 platform.getCurrentValidators', 'platform.getCurrentValidators on an independent node such as api.avax.network'), LL('systemctl status 显示的运行时长', 'The run time shown by systemctl status')], answer: 1, why: LL('奖励依据的是其他验证者的观察，独立视角才与之一致。', 'The reward is based on what other validators observed; only an independent view matches it.') },
        ],
      },
      {
        title: LL('引导同步与数据库', 'Bootstrapping and the database'),
        body: LL(
          `<p>新节点从空数据库开始，必须先追上网络才能参与验证。这个过程叫<b>引导</b>（bootstrapping），按链进行：</p>
          <ul><li>先引导 <b>P-Chain</b>。它的状态（验证者集合）决定了节点在另外两条链上信任哪些对等节点。节点从对等节点获取 P-Chain 的区块并逐个执行。</li><li>然后 <b>X-Chain</b> 和 <b>C-Chain</b> 并行引导。</li><li>在空数据库上，C-Chain 默认使用<b>状态同步</b>（state sync）：从对等节点下载近期的 EVM 状态，并对照状态根校验，而不是执行全部历史区块。</li></ul>
          <p>在主网上，第一次同步需要数小时，期间 CPU、磁盘 I/O 和带宽占用都很高。<code>info.isBootstrapped</code> 按链回答；三条链全部完成之前，<code>/ext/health</code> 一直报告不健康。数据库随链增长：状态同步的节点第一天就需要数百 GB，之后每天还在增长，磁盘要留足余量。</p>
          <h3>数据库格式与二进制版本</h3>
          <p>每个版本都知道自己写哪种数据库格式（<code>avalanchego --version</code> 输出中的 <code>database=</code>）。新版本在旧格式的数据库上启动时，会先把数据迁移到新格式，这可能需要一段时间。迁移是单向的：旧的二进制读不了新格式，启动即退出（本课程中的报错是 <code>unknown codec version</code>）。练习 A2 就建立在这一点上。正确的处理是重新运行新版本，而不是回滚，也不是删库重同步。</p>`,
          `<p>A new node starts with an empty database and has to catch up with the network before it can validate. This is <b>bootstrapping</b>, and it happens chain by chain:</p>
          <ul><li>The <b>P-Chain</b> goes first. Its state, the validator set, tells the node which peers to trust for the other chains. The node fetches P-Chain blocks from peers and executes them.</li><li>The <b>X-Chain</b> and <b>C-Chain</b> follow, in parallel.</li><li>On an empty database the C-Chain uses <b>state sync</b> by default: the node downloads a recent copy of the EVM state from peers and checks it against a state root, instead of executing every historical block.</li></ul>
          <p>On mainnet a first sync takes hours, with heavy CPU, disk I/O and bandwidth use. <code>info.isBootstrapped</code> answers per chain, and <code>/ext/health</code> stays unhealthy until all three are done. The database grows with the chains: a state-synced node needs a few hundred GB on day one and keeps growing every day, so plan the disk with room to spare.</p>
          <h3>Database format and binary version</h3>
          <p>Each release knows which database format it writes (<code>database=</code> in the output of <code>avalanchego --version</code>). When a newer release starts on an older database, it first migrates the data to its format, which can take a while. The migration is one-way: an older binary cannot read the newer format and exits at startup (the error in this course is <code>unknown codec version</code>). Lab A2 is built on this. The fix is to run the newer release again, not to roll back and not to resync.</p>`),
        widget: wgBootstrap,
        quiz: [
          { q: LL('为什么先引导 P-Chain？', 'Why does the P-Chain bootstrap first?'), options: [LL('它的数据最少', 'It has the least data'), LL('它的验证者集合决定节点在其他链上信任哪些对等节点', 'Its validator set tells the node which peers to trust for the other chains'), LL('按字母顺序', 'Alphabetical order')], answer: 1, why: LL('X-Chain 和 C-Chain 的引导依赖 P-Chain 给出的验证者集合。', 'Bootstrapping X and C relies on the validator set that the P-Chain provides.') },
          { q: LL('一次升级迁移了数据库之后，运维人员又装回了旧版本。会发生什么？', 'After an upgrade migrated the database, the operator installs the old binary again. What happens?'), options: [LL('旧版本照常运行', 'The old binary runs normally'), LL('旧版本读不了新格式，启动即退出', 'It cannot read the newer format and exits at startup'), LL('数据库自动回退到旧格式', 'The database rolls back to the old format by itself')], answer: 1, why: LL('迁移只能向前。重新装上新版本即可恢复。', 'Migration only goes forward. Installing the newer release again recovers it.') },
          { q: LL('第一次同步期间 /ext/health 返回 503，应该怎么做？', 'During the first sync /ext/health returns 503. What should the operator do?'), options: [LL('重启 avalanchego', 'Restart avalanchego'), LL('等待，用 info.isBootstrapped 和日志观察进度', 'Wait, and follow progress with info.isBootstrapped and the logs'), LL('删除数据库重新开始', 'Delete the database and start over')], answer: 1, why: LL('三条链完成引导之前，不健康是预期状态。重启只会让进度变慢。', 'Unhealthy is expected until all three chains have bootstrapped. Restarting only slows it down.') },
        ],
      },
      {
        title: LL('网络升级', 'Network upgrades'),
        body: LL(
          `<p>Avalanche 通过有名字的网络升级来修改协议（Durango、Etna、Helicon 等）。每次升级都以<b>激活时间</b>的形式写进发布版本。激活之前，新规则处于休眠状态；到了激活时间，所有运行兼容版本的节点同时切换。</p>
          <p>从激活时刻起，运行旧版本的节点就不再兼容：对等节点会断开与它的连接，它跟不上链，P-Chain 把它记为离线。它的进程仍在运行，在本机看起来可能一切正常；问题表现为独立视角下的 <code>connected: false</code> 和不断下降的在线率。</p>
          <p>运维人员要做的是：</p>
          <ul><li>升级公布后，立即记下激活时间和最低版本。</li><li>在激活之前留出充足时间完成所有节点的升级。支持新升级的版本会提前数周发布。</li><li>每次升级都要重启，有时还要迁移数据库。把它安排在远离截止时间的窗口里，出了问题还有时间处理。</li></ul>
          <p>以 Helicon 为例：主网于 2026 年 9 月 22 日 15:00 UTC 激活，要求 avalanchego 1.15.0 或更高版本。练习 A1 和 A2 都发生在这一天。</p>`,
          `<p>Avalanche changes its protocol through named network upgrades (Durango, Etna, Helicon and so on). Each upgrade is written into a release as an <b>activation time</b>. Before that time the new rules are dormant; at that time every node running a compatible release switches together.</p>
          <p>From the activation time, nodes on older releases are incompatible. Peers disconnect them, they stop following the chain, and the P-Chain records them as offline. The process keeps running and may look fine locally; the problem shows up as <code>connected: false</code> and falling uptime in the independent view.</p>
          <p>The operator's job:</p>
          <ul><li>Note the activation time and the minimum version as soon as an upgrade is announced.</li><li>Upgrade every node well before activation. Releases that support an upgrade are published weeks ahead.</li><li>Every upgrade means a restart and sometimes a database migration. Schedule it far from the deadline, so that a problem still leaves time to fix it.</li></ul>
          <p>Helicon is an example: it activated on mainnet on 22 September 2026 at 15:00 UTC and required avalanchego 1.15.0 or later. Labs A1 and A2 take place on that day.</p>`),
        widget: wgUpgrade,
        quiz: [
          { q: LL('距离激活还有 2 小时，某节点仍在运行旧版本。如果什么都不做，激活时会怎样？', 'Activation is two hours away and a node still runs the old release. If nothing is done, what happens at activation?'), options: [LL('在下次重启之前没有影响', 'Nothing until its next restart'), LL('对等节点断开它，从那一刻起它被记为离线', 'Peers disconnect it and it is recorded offline from that moment'), LL('它会自动升级', 'It upgrades itself')], answer: 1, why: LL('兼容性在激活时刻生效，与节点是否重启无关。', 'Compatibility changes at the activation time, whether or not the node restarts.') },
          { q: LL('为什么要提前几天升级，而不是在激活前几分钟？', 'Why upgrade days ahead rather than minutes before activation?'), options: [LL('重启和可能的迁移都要时间，提前发现问题才有余地处理', 'The restart and any migration take time, and finding a problem early leaves room to fix it'), LL('旧版本过一段时间就无法下载', 'Old releases stop being downloadable'), LL('P-Chain 要求提前一周登记', 'The P-Chain requires a week\'s notice')], answer: 0, why: LL('升级本身不难，难的是在截止时间前处理意外。', 'The upgrade itself is easy; the hard part is handling a surprise before the deadline.') },
        ],
      },
      {
        title: LL('端口与可达性', 'Ports and reachability'),
        body: LL(
          `<table><tr><th>端口</th><th>用途</th><th>是否对外</th></tr>
          <tr><td><code>9651/tcp</code></td><td>staking / P2P：与其他验证者之间的全部连接</td><td>必须能从互联网连入</td></tr>
          <tr><td><code>9650/tcp</code></td><td>HTTP API：<code>/ext/info</code>、<code>/ext/health</code>、<code>/ext/bc/…</code></td><td>只给本机使用，监听 127.0.0.1</td></tr></table>
          <p>对等节点从节点自己那里得知它的地址。配置中的 <code>public-ip</code> 应设为别人能拨通的地址，也可以用 <code>public-ip-resolution-service</code> 自动查询。如果通告的地址错了（例如实例停止再启动后换了 IP），或者 9651 被防火墙挡住，节点仍能主动向外连接，起初甚至看起来正常，但其他验证者连不进来。独立视角随之显示 <code>connected: false</code>，在线率下降；节点成为验证者之后，<code>network</code> 健康检查会失败，报 <code>primary network validator has no inbound connections</code>。练习 A3 就是这种情况。</p>
          <p><code>http-host</code> 决定 API 监听的地址，默认是 <code>127.0.0.1</code>。把它设为 <code>0.0.0.0</code> 并放行 9650，互联网上的任何人都能调用节点的 API，包括已经开启的管理和调试接口，也可以用高开销的查询拖垮节点。监控代理运行在本机，通过回环地址读取 API 即可。</p>`,
          `<table><tr><th>Port</th><th>Use</th><th>Exposure</th></tr>
          <tr><td><code>9651/tcp</code></td><td>Staking / P2P: every connection to other validators</td><td>Must be reachable from the internet</td></tr>
          <tr><td><code>9650/tcp</code></td><td>HTTP API: <code>/ext/info</code>, <code>/ext/health</code>, <code>/ext/bc/…</code></td><td>Local only, listening on 127.0.0.1</td></tr></table>
          <p>Peers learn a node's address from the node itself. Set <code>public-ip</code> in the config to an address peers can dial, or let <code>public-ip-resolution-service</code> look it up. If the advertised address is wrong (an instance that got a new IP after a stop and start, for example), or 9651 is blocked by a firewall, the node can still connect outwards and may look fine at first, but other validators cannot reach it. The independent view then shows <code>connected: false</code> and uptime falls; once the node is a validator, the <code>network</code> health check fails with <code>primary network validator has no inbound connections</code>. Lab A3 is this case.</p>
          <p><code>http-host</code> sets the address the API listens on; the default is <code>127.0.0.1</code>. Setting it to <code>0.0.0.0</code> and opening 9650 lets anyone on the internet call the node's API, including any admin or debugging endpoints that are enabled, and load the node with expensive queries. Monitoring agents run on the host and read the API over loopback.</p>`),
        widget: wgPorts,
        quiz: [
          { q: LL('哪个端口必须能从互联网连入？', 'Which port must be reachable from the internet?'), options: [LL('9650', '9650'), LL('9651', '9651'), LL('两个都要', 'Both'), LL('都不需要', 'Neither')], answer: 1, why: LL('9651 承载与其他验证者的连接；9650 是本机 API。', '9651 carries the connections to other validators; 9650 is the local API.') },
          { q: LL('验证者的实例停止后再启动，换了新的公网 IP，config.json 里仍是旧的 public-ip。独立视角会显示什么？', 'A validator\'s instance was stopped and started and got a new public IP, but config.json still has the old public-ip. What does the independent view show?'), options: [LL('connected: true，对等节点按 NodeID 找到它', 'connected: true, peers find it by NodeID'), LL('connected: false，在线率下降', 'connected: false, and uptime falls'), LL('质押期结束之前没有变化', 'No change until the period ends')], answer: 1, why: LL('对等节点拨打的是通告的地址，旧地址上没有这台节点。', 'Peers dial the advertised address, and the node is no longer there.') },
          { q: LL('http-host 是 0.0.0.0，防火墙放行了 9650。问题在哪里？', 'http-host is 0.0.0.0 and the firewall allows 9650. What is the problem?'), options: [LL('互联网上任何人都能调用这台节点的 API', 'Anyone on the internet can call the node\'s API'), LL('staking 端口会停止工作', 'The staking port stops working'), LL('没有问题，API 是只读的', 'None, the API is read-only')], answer: 0, why: LL('API 不是为公网设计的：有的接口能改变节点状态，查询本身也会消耗资源。', 'The API is not built for the public internet: some endpoints change node state, and queries themselves cost resources.') },
        ],
      },
    ],
  });

  /* ============================================================
     Step 2: run a validator on a fresh host
     ============================================================ */
  const NEW = {
    moniker: 'avax-new', region: 'us-east-1', instanceId: 'i-0e6d4c2a8f1b35790', type: 'c6in.2xlarge', memGB: 16, cpus: 8, diskGB: 2000,
    ip: '198.51.100.60', nodeID: 'NodeID-cv6fZLhBXYZurTxPyrpZv7BeCJDJi9RkA',
    pop: { publicKey: '0x8ea6f1f241a627d276411538ed86e2a6216e6ea59421b362c60cc45cc659fbedee7600624b5135ef590b88ee7cfa7e28', proofOfPossession: '0x9ff32ccc07e40d9ffc1da19df426166ab61bd359349e5aeb16fd62e8cbe1da5dc5432200749b3380a351c1a376a3c82cc0d503b580b9cd73b9722b995542cc39a9cb9e6358c59bf5b7b5c5bff397a965e942bee89c143f8dde33b42b2fafe9eb' },
  };
  const WALLET = { name: 'ops-wallet', addr: 'P-avax1v8x5v8vup26q39r4yknreymrdhp00lmxhfpq9v', balance: 2150.25 };
  const REL = 'https://github.com/ava-labs/avalanchego/releases/download/v1.15.0/avalanchego-linux-amd64-v1.15.0.tar.gz';
  const TGZ = 'avalanchego-linux-amd64-v1.15.0.tar.gz';
  const UNIT = ['[Unit]', 'Description=Avalanche node', 'Wants=network-online.target', 'After=network-online.target', '', '[Service]', 'User=avalanche', 'Group=avalanche', 'ExecStart=/usr/local/bin/avalanchego --config-file=/etc/avalanche/config.json', 'Restart=on-failure', 'RestartSec=5', 'TimeoutStopSec=120', 'LimitNOFILE=32768', '', '[Install]', 'WantedBy=multi-user.target', ''];
  const RPC = (method, params) => `curl -s -X POST --data '${JSON.stringify(Object.assign({ jsonrpc: '2.0', id: 1, method }, params ? { params } : {}))}' -H 'content-type:application/json;'`;
  const CMD = {
    ssm: 'ssm avax-new', root: 'sudo -i',
    df: 'df -h /', nproc: 'nproc', free: 'free -h', ulimit: 'ulimit -n', ufwS: 'ufw status verbose', ufw: 'ufw allow 9651/tcp',
    cd: 'cd /tmp',
    dl: `curl -fsSL -o ${TGZ} ${REL}`,
    dlSig: `curl -fsSL -o ${TGZ}.sig ${REL}.sig`,
    key: 'curl -fsSL https://downloads.avax.network/avalanchego.gpg.key | gpg --import',
    verify: `gpg --verify ${TGZ}.sig ${TGZ}`,
    untar: `tar xzf ${TGZ} -C /tmp`,
    install: 'install -m 0755 -o root -g root /tmp/avalanchego-v1.15.0/avalanchego /usr/local/bin/avalanchego',
    ver: 'avalanchego --version',
    useradd: 'useradd --system --create-home --shell /usr/sbin/nologin avalanche',
    id: 'id avalanche',
    ip: 'curl -s checkip.amazonaws.com',
    mkdir: 'mkdir -p /etc/avalanche',
    config: `echo '{"network-id":"mainnet","public-ip":"${NEW.ip}","http-host":"127.0.0.1","http-port":9650,"staking-port":9651}' > /etc/avalanche/config.json`,
    jq: 'jq . /etc/avalanche/config.json',
    unit: `printf '${UNIT.join('\\n')}' > /etc/systemd/system/avalanchego.service`,
    reload: 'systemctl daemon-reload', enable: 'systemctl enable avalanchego', start: 'systemctl start avalanchego', status: 'systemctl status avalanchego',
    journal: 'journalctl -u avalanchego -n 20 --no-pager',
    bootP: `${RPC('info.isBootstrapped', { chain: 'P' })} 127.0.0.1:9650/ext/info`,
    bootX: `${RPC('info.isBootstrapped', { chain: 'X' })} 127.0.0.1:9650/ext/info`,
    bootC: `${RPC('info.isBootstrapped', { chain: 'C' })} 127.0.0.1:9650/ext/info`,
    health: 'curl -s 127.0.0.1:9650/ext/health | jq .healthy',
    nodeid: `${RPC('info.getNodeID')} 127.0.0.1:9650/ext/info | jq .result`,
    lsKeys: 'ls -l /home/avalanche/.avalanchego/staking',
    backup: 'aws s3 cp --recursive /home/avalanche/.avalanchego/staking/ s3://example-validator-backups/avax-new/staking/ --sse aws:kms',
    lsBackup: 'aws s3 ls s3://example-validator-backups/avax-new/staking/',
    exit: 'exit',
    keys: 'platform-cli keys list',
    register: `platform-cli validator add-permissionless --node-id ${NEW.nodeID} --bls-public-key ${NEW.pop.publicKey} --bls-pop ${NEW.pop.proofOfPossession} --stake 2000 --duration 336h --delegation-fee 0.02 --key-name ops-wallet --network mainnet`,
    pchain: `${RPC('platform.getCurrentValidators', { nodeIDs: [NEW.nodeID] })} https://api.avax.network/ext/bc/P | jq '.result.validators[0] | {nodeID, startTime, endTime, uptime, connected, delegationFee}'`,
    nc: `nc -zv ${NEW.ip} 9651`, nc50: `nc -zv ${NEW.ip} 9650`,
  };
  const cmds = (...ks) => ks.map(k => CMD[k]);
  // one paragraph per step: the goals box lays out each child of .how as a grid cell
  const HOW = (zh, en) => LL(`<p>${zh}</p>`, `<p>${en}</p>`);
  const node = w => w.nodes['avax-new'];

  /* platform-cli: the wallet side of registration, on the workstation */
  const goDur = s => {
    const m = String(s || '').match(/^((\d+(\.\d+)?)(h|m|s))+$/);
    if (!m) return null;
    let t = 0; String(s).replace(/(\d+(?:\.\d+)?)(h|m|s)/g, (_, v, u) => { t += +v * { h: 3600, m: 60, s: 1 }[u]; });
    return t;
  };
  const goFmt = sec => `${Math.floor(sec / 3600)}h${Math.floor(sec % 3600 / 60)}m${Math.floor(sec % 60)}s`;
  async function platformCli(ctx) {
    const w = ctx.w, a = ctx.args, f = S.parseFlags(a), [g, sub] = f._;
    const err = m => ({ code: 1, out: `Error: ${m}\n` });
    if (!g || g === 'help' || f.help) return `platform-cli: P-Chain operations from the command line\n\nUsage:\n  platform-cli keys list\n  platform-cli validator add-permissionless --node-id ID --bls-public-key HEX --bls-pop HEX --stake AVAX --duration DUR --delegation-fee FRACTION --key-name NAME --network mainnet\n${S.C.gray(S.L('（模拟：真实环境中这一步是在持有资金的钱包上签名并提交 P-Chain 交易）', '(simulated: in practice this signs and submits a P-Chain transaction from the wallet that holds the funds)'))}\n`;
    if (g === 'keys' && sub === 'list') return S.table([[WALLET.name, WALLET.addr, `${WALLET.balance.toFixed(2)} AVAX`, 'encrypted']], ['NAME', 'P-CHAIN ADDRESS', 'BALANCE', 'STORAGE']) + '\n';
    if (g !== 'validator' || sub !== 'add-permissionless') return err(`unknown command "${f._.join(' ')}" for "platform-cli"`);
    const n = node(w), net = f.network || 'fuji';
    if (net !== 'mainnet') return err(`network "${net}": the funds and this node are on mainnet; pass --network mainnet`);
    if (typeof f['key-name'] !== 'string') return err('required flag "key-name" not set');
    if (f['key-name'] !== WALLET.name) return err(`key "${f['key-name']}" not found (see: platform-cli keys list)`);
    for (const k of ['node-id', 'stake', 'duration', 'delegation-fee', 'bls-public-key', 'bls-pop']) if (typeof f[k] !== 'string') return err(`required flag "${k}" not set`);
    if (!/^NodeID-[1-9A-HJ-NP-Za-km-z]{30,40}$/.test(f['node-id'])) return err(`invalid node ID "${f['node-id']}"`);
    if (f['node-id'] !== n.nodeID) return { code: 1, out: `Error: issuing tx: failed verification: invalid proof of possession\n${S.C.gray(S.L('（这个 NodeID 与 BLS 公钥不是同一台节点的。三个值都要从 avax-new 的 info.getNodeID 复制）', '(this NodeID and BLS key do not belong to the same node; copy all three values from info.getNodeID on avax-new)'))}\n` };
    if (f['bls-public-key'] !== n.pop.publicKey || f['bls-pop'] !== n.pop.proofOfPossession) return err('issuing tx: failed verification: invalid proof of possession');
    const stake = +f.stake, dur = goDur(f.duration), fee = +f['delegation-fee'];
    if (!(stake > 0)) return err(`invalid stake "${f.stake}"`);
    if (dur === null) return err(`invalid argument "${f.duration}" for "--duration" flag: time: unknown unit in duration "${f.duration}" (use Go durations such as 336h)`);
    if (!(fee >= 0 && fee <= 1)) return err(`invalid delegation fee "${f['delegation-fee']}": use a fraction, 0.02 = 2%`);
    if (stake < 2000) return err(`issuing tx: failed verification: weight of this validator (${stake * 1e9}) is less than the minimum stake (2000000000000)`);
    if (stake > WALLET.balance - 0.1) return err(`insufficient funds: need ${stake} AVAX plus fees, have ${WALLET.balance} AVAX`);
    if (dur < 48 * 3600) return err(`issuing tx: failed verification: staking period (${goFmt(dur)}) is shorter than the minimum (48h0m0s)`);
    if (dur > 365 * 86400) return err(`issuing tx: failed verification: staking period (${goFmt(dur)}) is longer than the maximum (8760h0m0s)`);
    if (fee < 0.02) return err(`issuing tx: failed verification: delegation fee ${(fee * 100).toFixed(2)}% is below the minimum (2.00%)`);
    if (n.av.validator) return err(`issuing tx: failed verification: attempted to issue a duplicate validation for ${n.nodeID}`);
    ctx.write(`Building AddPermissionlessValidatorTx on mainnet\n  Node ID          ${n.nodeID}\n  Stake            ${stake.toLocaleString('en-US')} AVAX\n  Duration         ${goFmt(dur)} (ends ${S.fmtClock(new Date(w.now().getTime() + dur * 1000))})\n  Delegation fee   ${(fee * 100).toFixed(2)}%\n  Rewards to       ${WALLET.addr}\nSigning with key "${WALLET.name}"\n`);
    await ctx.sleep(3);
    const txID = 'V42PoFgqSNBRnEpPvZwPZ2GTqsdNJbc92w3FhkbLcy8nLoipg';
    A().registerFresh(w, n, { stake, durSec: dur, fee, txID });
    S.event(w, 'sys', LL(`P-Chain 已接受 <b>avax-new</b> 的验证者注册交易。质押期从现在开始，共 ${goFmt(dur)}。`, `The P-Chain accepted the validator registration for <b>avax-new</b>. The ${goFmt(dur)} period starts now.`));
    return `Issued tx ${txID}\nTx accepted (chain time ${S.fmtClock(w.now())}). The staking period starts now.\n`;
  }

  const fresh = w => node(w).fresh;
  S.registerScenario({
    id: 'avax-run', network: 'avalanche', module: LL('Avalanche 验证者运维', 'Avalanche validator operations'), lab: 'R1', difficulty: 1, minutes: 25,
    title: LL('从零运行一台 Avalanche 验证者', 'Run an Avalanche validator from scratch'),
    tagline: LL('一台空白的 Ubuntu 主机。装好 avalanchego，完成同步，把它注册进验证者集合。', 'A blank Ubuntu host. Install avalanchego, let it sync, and get it into the validator set.'),
    learn: [
      LL('安装经过签名校验的版本，用独立用户和 systemd 运行它', 'Installing a release you have verified, and running it under its own user with systemd'),
      LL('配置里必须写对的两件事：通告的公网 IP，以及只监听本机的 API', 'The two things the config must get right: the advertised public IP, and an API that stays on loopback'),
      LL('观察 P、X、C 三条链的引导，读取节点身份并备份', 'Watching P, X and C bootstrap, then reading and backing up the node\'s identity'),
      LL('用不接触节点的钱包完成注册，再从独立视角确认结果', 'Registering from a wallet that never touches the node, and checking the result from an independent view'),
    ],
    brief: LL(
      `<p>一台新的 Ubuntu 24.04 主机 <b>avax-new</b>（c6in.2xlarge：8 vCPU、16 GiB 内存、2 TB gp3，公网 IP ${NEW.ip}）已经开好，准备用作新的 Primary Network 验证者。上面什么都没装。入站流量由主机上的 ufw 过滤，目前一个端口都没有放行。</p>
      <p>请从零搭建这台验证者：安装经过校验的 avalanchego，用独立用户和 systemd 运行，等它完成同步，备份它的身份文件，用运维钱包质押 2,000 AVAX 把它注册到 P-Chain，最后从外部确认网络能看到它。</p>
      <p>右侧的目标框给出每一步要做的事；点击其中的命令可以把它放进终端。同步需要几个模拟小时，等待时把右上角的速度调到 600× 或 3600×。</p>`,
      `<p>A new Ubuntu 24.04 host, <b>avax-new</b> (c6in.2xlarge: 8 vCPU, 16 GiB of memory, 2 TB gp3, public IP ${NEW.ip}), has been provisioned for a new Primary Network validator. Nothing is installed. Inbound traffic is filtered by ufw on the host, which currently allows nothing.</p>
      <p>Build the validator from scratch: install a verified avalanchego release, run it under its own user with systemd, let it sync, back up its identity, register it on the P-Chain with 2,000 AVAX from the operations wallet, and confirm from outside that the network sees it.</p>
      <p>The goals box on the right shows each step; click a command there to put it in the terminal. Syncing takes several simulated hours, so set the speed at the top right to 600× or 3600× while you wait.</p>`),
    startAt: '2026-10-20T08:00:00Z',
    config: { activation: -(27 * 86400 + 17 * 3600), upgrade: 'Helicon', freshNodes: [NEW] },
    laptopCommands: { 'platform-cli': platformCli },
    steps: [
      {
        text: LL('登录 avax-new 并切换到 root', 'Log in to avax-new and become root'),
        how: HOW('从工作电脑通过 SSM 登录新主机，再切换到 root。后面的步骤都需要 root 权限。', 'Open an SSM session to the new host from the workstation, then become root. Every later step needs root.'),
        cmds: cmds('ssm', 'root'),
        after: LL('SSM 会话不需要开放 22 端口。<code>sudo -i</code> 之后 <code>~</code> 是 <code>/root</code>；节点的数据目录在服务用户的家目录下，所以后面一律写绝对路径。', 'An SSM session needs no open port 22. After <code>sudo -i</code>, <code>~</code> is <code>/root</code>; the node\'s data lives in the service user\'s home, so later steps use absolute paths.'),
        check: w => (node(w).sessions || 0) > 0,
      },
      {
        text: LL('检查主机，并在防火墙上放行 9651/tcp', 'Check the host and allow 9651/tcp through the firewall'),
        how: HOW('先确认磁盘、CPU、内存和文件描述符上限够用，再看防火墙规则，只放行 staking 端口 9651。不要放行 9650。', 'Check that the disk, CPUs, memory and file-descriptor limit are enough. Then look at the firewall rules and open only the staking port, 9651. Do not open 9650.'),
        cmds: cmds('df', 'nproc', 'free', 'ulimit', 'ufwS', 'ufw'),
        after: LL('9651 是与其他验证者之间的全部连接，必须能从外部连入；9650 只给本机用（基础课《端口与可达性》）。shell 里的 <code>ulimit -n</code> 是 1024，服务的上限由 systemd 单元里的 <code>LimitNOFILE</code> 决定，下一步会写进去。', '9651 carries every connection to other validators and must be reachable from outside; 9650 is for the host only (Fundamentals: Ports and reachability). The shell\'s <code>ulimit -n</code> is 1024; the service\'s limit comes from <code>LimitNOFILE</code> in the systemd unit, written in a later step.'),
        check: w => node(w).ufw.active && A().fwAllows(node(w), 9651),
      },
      {
        text: LL('下载 avalanchego v1.15.0，校验签名后安装', 'Download avalanchego v1.15.0, verify its signature, and install it'),
        how: HOW('在 /tmp 下载发布包和它的签名，导入 Ava Labs 的发布公钥并校验。只有看到 <span class="mono">Good signature</span> 才解压，把二进制安装到 /usr/local/bin，再确认版本。', 'Download the release and its signature into /tmp, import the Ava Labs release key and verify. Unpack only after <span class="mono">Good signature</span>, install the binary to /usr/local/bin, and confirm the version.'),
        cmds: cmds('cd', 'dl', 'dlSig', 'key', 'verify', 'untar', 'install', 'ver'),
        after: LL('签名证明这个压缩包就是 Ava Labs 发布的那一份。公钥的指纹应与官方公布的一致（<code>5395 BDA1 … C0D5 FE8B</code>）。Helicon 激活之后，低于 1.15.0 的节点会被网络断开（基础课《网络升级》）。', 'The signature proves the tarball is the one Ava Labs released. Check the key\'s fingerprint against the published one (<code>5395 BDA1 … C0D5 FE8B</code>). Since Helicon activated, nodes below 1.15.0 are disconnected by the network (Fundamentals: Network upgrades).'),
        check: w => { const v = fresh(w).verified, b = A().binVer(S.fsRead(w, node(w), '/usr/local/bin/avalanchego')); return !!v && b === v && S.semverCmp(b, A().MIN) >= 0; },
      },
      {
        text: LL('创建服务用户 avalanche，写好 /etc/avalanche/config.json', 'Create the avalanche service user and write /etc/avalanche/config.json'),
        how: HOW(`创建一个不能登录的系统用户来运行节点。查出本机的公网 IP，写进配置的 <code>public-ip</code>；<code>http-host</code> 设为 <code>127.0.0.1</code>。最后用 jq 确认 JSON 有效。`, `Create a system user that cannot log in to run the node. Look up the host's public IP and write it as <code>public-ip</code> in the config, with <code>http-host</code> on <code>127.0.0.1</code>. Then check with jq that the JSON is valid.`),
        cmds: cmds('useradd', 'id', 'ip', 'mkdir', 'config', 'jq'),
        after: LL('<code>public-ip</code> 是告诉对等节点"拨这个地址找我"；写错了，别人就连不进来。<code>http-host</code> 设为 <code>127.0.0.1</code>，API 只在本机可用。节点以无登录权限的 <code>avalanche</code> 用户运行，数据和密钥放在 <code>/home/avalanche/.avalanchego</code>。', '<code>public-ip</code> tells peers which address to dial; if it is wrong, nobody can connect in. <code>http-host</code> at <code>127.0.0.1</code> keeps the API on the host. The node runs as the <code>avalanche</code> user, which cannot log in, and keeps its data and keys in <code>/home/avalanche/.avalanchego</code>.'),
        check: w => { const n = node(w), u = A().users(n).avalanche, cf = A().cfg(w, n); return !!u && S.fsIsDir(n, u.home) && !!cf && cf['public-ip'] === n.ip && A().loopback(cf['http-host'] ?? '127.0.0.1') && (cf['network-id'] ?? 'mainnet') === 'mainnet'; },
      },
      {
        text: LL('写好 systemd 单元，设为开机启动并启动节点', 'Write the systemd unit, enable it and start the node'),
        how: HOW('写入单元文件：以 <span class="mono">avalanche</span> 用户运行，失败后自动重启，<span class="mono">LimitNOFILE=32768</span>。让 systemd 重新读取单元，设为开机启动，启动服务，确认状态是 <span class="mono">active (running)</span>。', 'Write the unit file: it runs as <span class="mono">avalanche</span>, restarts on failure, and sets <span class="mono">LimitNOFILE=32768</span>. Have systemd reload its units, enable the service, start it, and confirm it is <span class="mono">active (running)</span>.'),
        cmds: cmds('unit', 'reload', 'enable', 'start', 'status'),
        after: LL('第一次启动时，avalanchego 在 <code>/home/avalanche/.avalanchego/staking/</code> 生成 <code>staker.crt</code>、<code>staker.key</code> 和 <code>signer.key</code>，这就是这台验证者的身份（基础课《成为验证者》）。', 'On first start avalanchego creates <code>staker.crt</code>, <code>staker.key</code> and <code>signer.key</code> in <code>/home/avalanche/.avalanchego/staking/</code>. They are this validator\'s identity (Fundamentals: Becoming a validator).'),
        check: w => { const n = node(w), u = A().unitOf(w, n), s = n.services.avalanchego; return !!u && u.user === 'avalanche' && u.exec.includes('/usr/local/bin/avalanchego') && u.exec.includes('--config-file=/etc/avalanche/config.json') && !!s && s.enabled === true && A().active(n); },
      },
      {
        text: LL('等待 P、X、C 三条链完成引导，节点变为健康', 'Wait until P, X and C have bootstrapped and the node is healthy'),
        how: HOW('日志显示每条链的同步进度。同步结束前，三条链的查询都返回 false，health 也是 false。把速度调到 600× 或 3600×，等时钟走完后再查一次，直到全部为 true。', 'The log shows each chain\'s sync progress. Until the sync finishes, all three chains answer false and health is false. Set the speed to 600× or 3600×, let the clock run, then ask again until everything is true.'),
        cmds: cmds('journal', 'bootP', 'bootX', 'bootC', 'health'), wait: 12000,
        after: LL('P-Chain 先完成，X-Chain 和 C-Chain 随后并行；C-Chain 用状态同步，而不是执行全部历史。主网上第一次同步需要数小时，本练习做了压缩（基础课《引导同步与数据库》）。', 'The P-Chain finishes first, then X and C in parallel; the C-Chain uses state sync instead of executing all history. A first mainnet sync takes hours; this lab compresses it (Fundamentals: Bootstrapping and the database).'),
        check: w => A().bootDone(node(w)) && A().healthy(w, node(w)),
      },
      {
        text: LL('读取 NodeID 和 BLS 公钥及所有权证明', 'Read the NodeID, the BLS public key and its proof of possession'),
        how: HOW('向本机的 info API 查询节点身份。记下 <span class="mono">nodeID</span>、<span class="mono">nodePOP.publicKey</span> 和 <span class="mono">nodePOP.proofOfPossession</span>，注册时三个都要用。', 'Ask the local info API for the node\'s identity. Note <span class="mono">nodeID</span>, <span class="mono">nodePOP.publicKey</span> and <span class="mono">nodePOP.proofOfPossession</span>; registration needs all three.'),
        cmds: cmds('nodeid'),
        after: LL('NodeID 来自 <code>staker.crt</code>；BLS 公钥和所有权证明来自 <code>signer.key</code>。这三个值都公开，可以复制到钱包所在的机器上；私钥永远留在节点上。', 'The NodeID comes from <code>staker.crt</code>; the BLS public key and proof of possession come from <code>signer.key</code>. All three values are public and can be copied to the wallet machine; the secret keys stay on the node.'),
        check: w => fresh(w).idAt != null,
      },
      {
        text: LL('把 staking 文件备份到主机以外，并确认备份完整', 'Back up the staking files off the host and confirm the backup'),
        how: HOW('列出 staking 目录里的三个文件，上传到加密的备份桶，再列出备份，确认三个文件都在。', 'List the three files in the staking directory, upload them to the encrypted backup bucket, then list the backup to confirm all three are there.'),
        cmds: cmds('lsKeys', 'backup', 'lsBackup'),
        after: LL('这三个文件就是验证者。主机损坏时，用同一份文件在新主机上恢复，NodeID 和 BLS 公钥都保持不变。要在注册之前完成备份。', 'These three files are the validator. If the host is lost, the same files restore it on a new host with the same NodeID and BLS key. Do this before registering.'),
        check: w => A().backupOk(w, node(w)) && fresh(w).listedAt != null,
      },
      {
        text: LL('在工作电脑上用钱包注册验证者', 'Register the validator from the wallet on the workstation'),
        how: HOW('退出 root 和会话，回到工作电脑。确认钱包里有足够的余额，然后提交注册：质押 2,000 AVAX，期限 336 小时，委托费率 2%。<br>真实环境中这一步通常在钱包里完成（例如 Core 钱包的 Stake → Validate），这里用一个命令行钱包来模拟。', 'Leave root and the session to get back to the workstation. Check that the wallet holds enough, then submit the registration: 2,000 AVAX, 336 hours, 2% delegation fee.<br>In practice this is usually done in a wallet (for example Stake → Validate in Core); a command-line wallet stands in for it here.'),
        cmds: cmds('exit', 'exit', 'keys', 'register'),
        after: LL('交易被接受的那一刻，质押期就开始了，参数从此不能修改（基础课《成为验证者》）。资金和签名钥匙都在钱包这边，节点上只有它自己的身份文件。', 'The period starts the moment the transaction is accepted, and its parameters can no longer change (Fundamentals: Becoming a validator). The funds and the signing key stay with the wallet; the node holds only its own identity files.'),
        check: w => node(w).av.validator,
      },
      {
        text: LL('从独立视角确认它已在验证者集合中，并且 connected', 'Confirm from an independent view that it is in the validator set and connected'),
        how: HOW('向 api.avax.network 查询这台验证者的 P-Chain 记录。期望看到 <span class="mono">connected: true</span>，<span class="mono">uptime</span> 接近 100。过几分钟再查一次。', 'Ask api.avax.network for this validator\'s P-Chain record. Expect <span class="mono">connected: true</span> and an <span class="mono">uptime</span> close to 100. Ask again a few minutes later.'),
        cmds: cmds('pchain'),
        after: LL('奖励依据的是其他验证者看到的在线率，节点无法自证（基础课《在线率与奖励》）。从现在起每离线一小时，14 天的质押期就少约 0.3 个百分点。', 'The reward depends on the uptime other validators see; a node cannot vouch for itself (Fundamentals: Uptime and rewards). From now on, each hour offline costs about 0.3 percentage points of a 14-day period.'),
        check: w => { const f = fresh(w); return f.seenAt != null && f.seenAt >= f.valStart && A().connected(w, node(w)); },
      },
      {
        text: LL('确认外部可达性和节点健康', 'Confirm reachability from outside and node health'),
        how: HOW('从工作电脑测试两个端口：9651 应当连通，9650 应当超时。再登录节点，确认 health 为 true。', 'Test both ports from the workstation: 9651 should connect and 9650 should time out. Then log in to the node and confirm health is true.'),
        cmds: cmds('nc', 'nc50', 'ssm', 'root', 'health'),
        after: LL('节点进入验证者集合之后，<code>network</code> 健康检查也会核对是否有入站连接。9651 能连通、9650 连不通，这正是期望的状态。', 'Now that the node is a validator, the <code>network</code> health check also requires inbound connections. 9651 reachable and 9650 not is exactly the intended state.'),
        check: w => { const f = fresh(w); return f.ncAt != null && f.healthAt != null && f.healthAt >= f.valStart && A().healthy(w, node(w)); },
      },
    ],
    forbidden: [
      { flag: 'api_public', text: LL('让 9650 的 HTTP API 对互联网开放（http-host 不是回环地址，且防火墙放行了 9650）', 'Exposing the HTTP API on 9650 to the internet (http-host not on loopback, with 9650 open in the firewall)') },
      { flag: 'early_register', text: LL('在节点完成引导之前注册验证者', 'Registering the validator before the node has finished bootstrapping') },
      { flag: 'lost_identity', text: LL('删除或移走 staking 身份文件', 'Deleting or moving the staking identity files') },
    ],
    score: w => {
      const n = node(w), reg = n.av.validator, early = w.flags.early_register !== undefined;
      return [
        [LL('注册时节点已完成引导', 'Bootstrapped before registering'), early ? LL('否', 'no') : reg ? LL('是', 'yes') : '—', early ? 'bad' : 'good'],
        [LL('staking 文件已备份', 'Staking files backed up'), A().backupOk(w, n) ? LL('是', 'yes') : LL('否', 'no'), A().backupOk(w, n) ? 'good' : 'bad'],
        [LL('注册以来的在线率', 'Uptime since registration'), reg ? A().uptimePct(n).toFixed(3) + '%' : '—', !reg || A().uptimePct(n) >= 99 ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      '搭建一台验证者分三部分，容易混在一起。主机部分（防火墙、用户、单元、配置）决定对等节点能否连进来，以及进程能否干净地重启。同步部分要花几个小时，除了耐心和磁盘，不需要运维人员做什么。注册部分是一笔 P-Chain 交易，由不在节点上的钱包签名，而且无法撤回：交易被接受时质押期就开始了。只有在节点已经完成引导、状态健康、9651 能从外部连通、staking 文件已经备份到别处之后，才应该注册。注册之后，以其他验证者看到的情况为准：在独立节点上调用 platform.getCurrentValidators，connected 为 true，在线率保持在接近 100%。还有两点以后会用到：staking 文件就是验证者本身，恢复时必须用同一份文件，绝不能重新生成；http-host 一直保持 127.0.0.1，监控在本机读取 API。',
      'A validator build has three parts that are easy to blur together. The host part (firewall, user, unit, config) decides whether peers can reach the node and whether the process restarts cleanly. The sync part takes hours and needs nothing from the operator but patience and disk. The registration part is a P-Chain transaction, signed by a wallet that is not on the node, and it cannot be undone: the period starts when the transaction is accepted. Register only once the node has bootstrapped, is healthy, is reachable on 9651 from outside, and has its staking files backed up somewhere else. After registration, judge the node by what other validators see: platform.getCurrentValidators on an independent endpoint, connected true, uptime holding near 100%. Two details matter later. The staking files are the validator, so a restore must use the same three files and never new ones. And http-host stays on 127.0.0.1, with monitoring reading the API locally.'),
  });
})(SIM);
