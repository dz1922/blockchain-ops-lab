/* ============================================================
   Ethereum, steps 1 and 2: fundamentals (lesson) and the guided
   "run a validator" lab on the Hoodi testnet (R1).
   ============================================================ */
(function (S) {
  'use strict';
  const LL = S.LL, L = (zh, en) => S.L(zh, en), W = () => S.wg;
  const MOD = LL('以太坊验证者运维', 'Ethereum validator operations');

  /* ---------- small widget helpers ---------- */
  const box = (parent, cls, html, style) => { const e = W().el('div', cls, html); if (style) e.style.cssText = style; parent.appendChild(e); return e; };
  const title = el => el.appendChild(W().el('div', 'wg-title', L('动手试试', 'Try it')));
  const cap = (parent, html) => box(parent, 'wg-cap', html);
  const svgOf = (vb, inner) => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img">${inner}</svg>`;
  const fmt = (x, d = 3) => (x >= 0 ? '' : '−') + Math.abs(x).toFixed(d);

  /* ==========================================================
     Chapter 1: two clients, one node
     ========================================================== */
  function wgClients(el) {
    title(el);
    const LINKS = {
      engine: { name: L('Engine API（Besu ↔ beacon）', 'Engine API (Besu ↔ beacon)'), a: [210, 175], b: [430, 175],
        flows: L('<code>engine_newPayload</code> 把每个新区块的执行负载交给 Besu 验证；<code>engine_forkchoiceUpdated</code> 告诉它当前链头和已最终确定的区块，出块时让它开始组装区块；<code>engine_getPayload</code> 取回组装好的区块。走 127.0.0.1:8551 上的 HTTP，每个请求都带一个用共享密钥签名的 JWT。', '<code>engine_newPayload</code> hands Besu each new block\'s execution payload to verify; <code>engine_forkchoiceUpdated</code> tells it the head and the finalized block, and asks it to start building a block when the validator proposes; <code>engine_getPayload</code> fetches the built block. HTTP on 127.0.0.1:8551, every request carrying a JWT signed with the shared secret.'),
        cut: L('beacon 节点无法验证区块，报告执行客户端离线。Besu 停在原来的高度，日志里反复出现没有被调用的警告。验证者错过每一项任务。', 'The beacon node cannot verify blocks and reports the execution client offline. Besu stays at the same height and keeps logging that it is not being called. The validator misses every duty.') },
      rest: { name: L('Beacon API（beacon ↔ 验证者客户端）', 'Beacon API (beacon ↔ validator client)'), a: [500, 205], b: [500, 255],
        flows: L('验证者客户端通过 5051 端口的 REST API 查询自己的任务（哪个 slot 出证明、何时出块），取回要签名的证明数据和区块，再把签好的消息交回 beacon 节点广播。钥匙只在验证者客户端里。', 'The validator client asks the REST API on port 5051 for its duties (which slot to attest in, when to propose), fetches the attestation data and blocks to sign, and hands the signed messages back for the beacon node to publish. The keys live only in the validator client.'),
        cut: L('节点本身仍然同步，但什么都没有签名，每项任务都错过。只看 beacon 节点的监控发现不了问题。', 'The node itself stays in sync, but nothing gets signed and every duty is missed. Monitoring that only watches the beacon node sees nothing wrong.') },
      elp2p: { name: L('执行层 P2P（30303）', 'Execution P2P (30303)'), a: [140, 75], b: [140, 150],
        flows: L('交易进入交易池；新节点在 snap sync 时下载状态。TCP 和 UDP 30303。', 'Transactions for the mempool, and the state a new node downloads during snap sync. TCP and UDP 30303.'),
        cut: L('已同步的节点仍能通过 beacon 节点跟上新区块，但交易池是空的：轮到它出块时，区块里没有交易。新节点根本无法同步。', 'A synced node still follows new blocks through the beacon node, but its mempool is empty: when it proposes, the block carries no transactions. A new node cannot sync at all.') },
      clp2p: { name: L('共识层 P2P（9000）', 'Consensus P2P (9000)'), a: [500, 75], b: [500, 150],
        flows: L('区块、证明、聚合证明和同步委员会消息，通过 gossipsub 传播。TCP 和 UDP 9000；Teku 还在 UDP 9001 上使用 QUIC。', 'Blocks, attestations, aggregates and sync committee messages, spread by gossipsub. TCP and UDP 9000; Teku also uses QUIC on UDP 9001.'),
        cut: L('收不到区块和证明，链头停住。验证者签出的证明也发不出去。', 'No blocks or attestations arrive and the head stops. The validator\'s attestations cannot be published either.') },
    };
    const cut = {}; let sel = 'engine';
    const svgBox = box(el, '', '');
    const ctl = box(el, '', '', 'display:grid;gap:.6rem');
    const info = box(el, 'lv-body', '', 'max-width:none;font-size:.92rem');
    const stats = W().stats(el);
    const nodeR = (x, y, w2, h, t1, t2, col) => `<rect x="${x}" y="${y}" width="${w2}" height="${h}" rx="10" style="fill:var(--panel-2);stroke:${col};stroke-width:1.5"/><text x="${x + w2 / 2}" y="${y + h / 2 - 4}" text-anchor="middle" style="font-size:14px;fill:var(--ink)">${t1}</text><text x="${x + w2 / 2}" y="${y + h / 2 + 14}" text-anchor="middle" style="font-size:11px">${t2}</text>`;
    function draw() {
      let s = '';
      s += nodeR(60, 20, 160, 55, L('执行层对等节点', 'EL peers'), 'devp2p', 'var(--line-2)');
      s += nodeR(420, 20, 160, 55, L('共识层对等节点', 'CL peers'), 'libp2p', 'var(--line-2)');
      s += nodeR(60, 150, 160, 55, 'Besu', L('执行客户端 EL', 'execution client'), '#627EEA');
      s += nodeR(430, 150, 140, 55, 'Teku beacon', L('共识客户端 CL', 'consensus client'), '#7cc4ff');
      s += nodeR(405, 255, 190, 55, 'Teku vc', L('验证者客户端 · 钥匙', 'validator client · keys'), 'var(--amber)');
      Object.entries(LINKS).forEach(([k, l]) => {
        const col = cut[k] ? 'var(--red)' : k === sel ? 'var(--lime)' : 'var(--ink-3)';
        s += `<line x1="${l.a[0]}" y1="${l.a[1]}" x2="${l.b[0]}" y2="${l.b[1]}" style="stroke:${col};stroke-width:${k === sel ? 3.5 : 2};${cut[k] ? 'stroke-dasharray:6 5' : ''}"/>`;
        s += `<line data-k="${k}" x1="${l.a[0]}" y1="${l.a[1]}" x2="${l.b[0]}" y2="${l.b[1]}" style="stroke:transparent;stroke-width:22;cursor:pointer"/>`;
        if (cut[k]) { const mx = (l.a[0] + l.b[0]) / 2, my = (l.a[1] + l.b[1]) / 2; s += `<text x="${mx}" y="${my - 8}" text-anchor="middle" style="fill:var(--red);font-size:16px">✕</text>`; }
        else s += `<circle data-dot="${k}" r="4" style="fill:${k === sel ? 'var(--lime)' : 'var(--ink-2)'}"/>`;
      });
      s += `<text x="320" y="167" text-anchor="middle" style="font-size:11px">:8551 · JWT</text><text x="510" y="236" style="font-size:11px">:5051</text><text x="150" y="118" style="font-size:11px">:30303</text><text x="510" y="118" style="font-size:11px">:9000</text>`;
      svgBox.innerHTML = svgOf('0 0 640 320', s);
      svgBox.querySelectorAll('[data-k]').forEach(x => x.addEventListener('click', () => { sel = x.dataset.k; btns.forEach(b => b.classList.toggle('on', b.dataset.k === sel)); update(); }));
    }
    const btns = W().buttons(ctl, Object.entries(LINKS).map(([k, l]) => [l.name, () => { sel = k; update(); }]), { toggle: true });
    btns.forEach((b, i) => { b.dataset.k = Object.keys(LINKS)[i]; });
    const [cutBtn, resetBtn] = W().buttons(ctl, [[L('切断这条连接', 'Cut this link'), () => { cut[sel] = !cut[sel]; update(); }], [L('全部恢复', 'Restore all'), () => { Object.keys(cut).forEach(k => delete cut[k]); update(); }]]);
    function update() {
      const l = LINKS[sel];
      cutBtn.textContent = cut[sel] ? L('恢复这条连接', 'Restore this link') : L('切断这条连接', 'Cut this link');
      info.innerHTML = `<p><b style="color:var(--ink)">${l.name}</b></p><p>${l.flows}</p><div class="note ${cut[sel] ? 'warn' : ''}">${cut[sel] ? '' : L('如果切断：', 'If cut: ')}${l.cut}</div>`;
      const head = !cut.clp2p && !cut.engine, imports = head, duties = head && !cut.rest;
      stats.set([
        [L('beacon 跟上链头', 'Beacon follows the head'), head ? L('是', 'yes') : L('否', 'no'), head ? 'good' : 'bad'],
        [L('Besu 导入区块', 'Besu imports blocks'), imports ? L('是', 'yes') : L('否', 'no'), imports ? 'good' : 'bad'],
        [L('证明', 'Attestations'), duties ? L('按时', 'on time') : L('全部错过', 'all missed'), duties ? 'good' : 'bad'],
        [L('出块', 'Proposals'), !duties ? L('错过', 'missed') : cut.elp2p ? L('空块', 'empty blocks') : L('正常', 'normal'), !duties ? 'bad' : cut.elp2p ? 'mid' : 'good'],
      ]);
      draw();
    }
    update();
    W().loop((dt, t) => {
      svgBox.querySelectorAll('[data-dot]').forEach(d => {
        const l = LINKS[d.dataset.dot], f = (t * 0.6 + l.a[0] / 640) % 1, g = f < 0.5 ? f * 2 : 2 - f * 2;
        d.setAttribute('cx', l.a[0] + (l.b[0] - l.a[0]) * g); d.setAttribute('cy', l.a[1] + (l.b[1] - l.a[1]) * g);
      });
    });
    cap(el, L('点击图中的连线或上方按钮选择一条连接，再把它切断。', 'Click a line in the diagram or a button above to pick a link, then cut it.'));
  }

  /* ==========================================================
     Chapter 2: slots, epochs and duties
     ========================================================== */
  function wgEpoch(el) {
    title(el);
    const strip = box(el, '', '', 'display:grid;grid-template-columns:repeat(32,1fr);gap:3px');
    const cells = Array.from({ length: 32 }, () => box(strip, '', '', 'height:30px;border-radius:4px;background:var(--panel-3);position:relative'));
    const slotBar = box(el, '', '');
    const msg = box(el, 'wg-cap', '', 'min-height:2.6em');
    let speed = 24, t = 0, sync = false, propose = false, included = 0, synced = 0, proposed = 0, lastSlot = -1;
    W().slider(el, { label: L('模拟速度', 'Speed'), min: 6, max: 96, step: 6, value: 24, fmt: v => `${v}×` }, v => { speed = v; });
    W().buttons(el, [[L('同步委员会成员', 'Sync committee member'), b => { sync = !sync; b.classList.toggle('on', sync); }], [L('本 epoch 安排一次出块', 'Give it a proposal this epoch'), b => { propose = !propose; b.classList.toggle('on', propose); }]]);
    const stats = W().stats(el);
    const attOf = e => (e * 13 + 7) % 32, propOf = e => (e * 5 + 19) % 32;
    W().loop(dt => {
      t += dt * speed;
      const e = Math.floor(t / 384), s = Math.floor((t % 384) / 12), within = t % 12, att = attOf(e), prop = propOf(e);
      if (s !== lastSlot) {
        // leaving a slot: count what happened in it; entering the slot after the attestation slot: it is included
        if (lastSlot >= 0) { if (sync) synced++; if (propose && lastSlot === prop) proposed++; }
        if ((s > 0 && s === att + 1) || (s === 0 && e > 0 && attOf(e - 1) === 31)) included++;
        lastSlot = s;
      }
      cells.forEach((c, i) => {
        const past = i < s, cur = i === s;
        c.style.background = cur ? 'var(--blue)' : past ? 'var(--line-2)' : 'var(--panel-3)';
        c.style.boxShadow = i === att ? 'inset 0 -6px 0 var(--amber)' : propose && i === prop ? 'inset 0 -6px 0 #b36bff' : sync ? 'inset 0 -2px 0 var(--lime)' : 'none';
        c.textContent = '';
      });
      if (s > att) cells[att].innerHTML = '<span style="position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:var(--lime)">✔</span>';
      const mark = (p, lbl) => `<em style="left:${p}%" title="${lbl}"></em>`;
      slotBar.innerHTML = `<div class="wg-cap" style="margin-bottom:.3rem">slot ${s + 1}/32 · ${within.toFixed(1)} s / 12 s</div><div class="wg-meter"><i style="width:${within / 12 * 100}%;background:var(--blue)"></i>${mark(33.3, '4 s')}${mark(66.6, '8 s')}</div><div style="display:flex;justify-content:space-between;font-family:var(--f-mono);font-size:.7rem;color:var(--ink-3);margin-top:.2rem"><span>0 s ${L('出块', 'block')}</span><span>4 s ${L('证明截止', 'attest')}</span><span>8 s ${L('聚合', 'aggregate')}</span><span>12 s</span></div>`;
      let m;
      if (s === att) m = within < 4 ? L('本 slot 轮到你的验证者出证明：等区块到达，最晚在 4 秒时对链头投票。', 'Your validator attests in this slot: it waits for the block and votes on the head by the 4-second mark.') : L('证明已签名并广播，等下一个 slot 的出块者把它打包。', 'The attestation is signed and broadcast; the next slot\'s proposer should include it.');
      else if (s === (att + 1) % 32) m = L('证明被打包进这个区块：按时，source、target 和 head 三部分奖励都拿到。', 'The attestation is included in this block: on time, so all three parts, source, target and head, are rewarded.');
      else if (propose && s === prop) m = L('你的验证者是本 slot 的出块者：在 slot 开始时提出区块。', 'Your validator is this slot\'s proposer: it proposes a block at the start of the slot.');
      else m = sync ? L('同步委员会成员每个 slot 都要签一次链头。', 'A sync committee member signs the head in every slot.') : L('其余 slot 里，这个验证者没有任务。', 'In the other slots this validator has no duty.');
      msg.textContent = m;
      stats.set([['epoch', String(e), ''], [L('已打包的证明', 'Attestations included'), String(included), 'good'], [L('同步委员会签名', 'Sync committee signatures'), String(synced), sync ? 'good' : ''], [L('出块', 'Blocks proposed'), String(proposed), proposed ? 'good' : '']]);
    });
    cap(el, L('琥珀色是本 epoch 的证明 slot，紫色是出块 slot。每个 epoch 的证明 slot 都会重新分配。', 'Amber marks this epoch\'s attestation slot, purple a proposal slot. The attestation slot is reassigned every epoch.'));
  }

  /* ==========================================================
     Chapter 3: finality
     ========================================================== */
  function wgFinality(el) {
    title(el);
    let part = 95, cur = 2, just = { 0: true, 1: true }, fin = 0, auto = false;
    const row = box(el, '', '', 'display:grid;grid-template-columns:repeat(12,1fr);gap:4px');
    const meterBox = box(el, '', '');
    W().slider(el, { label: L('参与投票的质押', 'Stake attesting'), min: 0, max: 100, value: 95, fmt: v => v + '%' }, v => { part = v; draw(); });
    const stats = W().stats(el);
    const step = () => {
      const e = cur - 1;
      if (part * 3 >= 200) { just[e] = true; if (just[e - 1]) fin = Math.max(fin, e - 1); }
      cur++; draw();
    };
    const [, autoBtn] = W().buttons(el, [[L('下一个 epoch', 'Next epoch'), step], [L('自动', 'Auto'), b => { auto = !auto; b.classList.toggle('on', auto); }], [L('重置', 'Reset'), () => { cur = 2; just = { 0: true, 1: true }; fin = 0; draw(); }]]);
    let acc = 0;
    W().loop(dt => { if (!auto) return; acc += dt; if (acc > 0.9) { acc = 0; step(); } });
    function draw() {
      const lastJ = Math.max(...Object.keys(just).map(Number));
      const first = Math.max(0, cur - 11);
      row.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const e = first + i; if (e > cur) return '<div></div>';
        const st = e === cur ? 'cur' : e <= fin ? 'fin' : just[e] ? 'just' : 'none';
        const bg = { cur: 'var(--panel-3)', fin: 'var(--lime)', just: 'var(--blue)', none: 'var(--line)' }[st];
        const fg = st === 'fin' || st === 'just' ? '#0b0f0d' : 'var(--ink-2)';
        return `<div style="border-radius:6px;padding:.35rem 0;text-align:center;background:${bg};color:${fg};font-family:var(--f-mono);font-size:.72rem;${st === 'cur' ? 'outline:1px dashed var(--ink-3)' : ''}">${e}<br>${{ cur: L('进行中', 'now'), fin: 'F', just: 'J', none: '–' }[st]}</div>`;
      }).join('');
      meterBox.innerHTML = W().meter(part, part * 3 >= 200 ? '' : 'bad', [[66.7, '2/3']]) + `<div class="wg-cap" style="margin-top:.3rem">${L('三分之二的标记线', 'the line marks 2/3')}</div>`;
      const lag = cur - fin, leak = lag > 4;
      stats.set([[L('当前 epoch', 'Current epoch'), String(cur), ''], [L('最近 justified', 'Latest justified'), String(lastJ), ''], [L('最近 finalized', 'Latest finalized'), String(fin), ''], [L('最终确定滞后', 'Finality lag'), `${lag} ` + L('个 epoch', lag === 1 ? 'epoch' : 'epochs'), lag <= 2 ? 'good' : lag <= 4 ? 'mid' : 'bad'], [L('不活跃惩罚', 'Inactivity leak'), leak ? L('进行中', 'active') : L('无', 'off'), leak ? 'bad' : 'good']]);
    }
    draw();
    cap(el, L('F 为已最终确定，J 为已 justified。把参与率拖到 2/3 以下，看 justified 和 finalized 如何停住；再拖回去，看它们如何恢复。', 'F is finalized, J is justified. Drag participation below 2/3 and watch justification and finality stop; drag it back and watch them recover.'));
  }

  /* ==========================================================
     Chapter 4: rewards and penalties
     ========================================================== */
  function wgRewards(el) {
    title(el);
    let up = 99, apr = 2.8, days = 0;
    box(el, 'wg-cap', L('<b style="color:var(--ink)">正常最终确定时：</b>在线率与一年的大致收益（32 ETH，估算值）', '<b style="color:var(--ink)">While the chain finalizes:</b> uptime against approximate yearly income (32 ETH, estimates)'));
    W().slider(el, { label: L('在线率', 'Uptime'), min: 0, max: 100, value: 99, fmt: v => v + '%' }, v => { up = v; upd(); });
    W().slider(el, { label: L('全网年化（约）', 'Network APR (approx.)'), min: 2, max: 4, step: 0.1, value: 2.8, fmt: v => v.toFixed(1) + '%' }, v => { apr = v; upd(); });
    const s1 = W().stats(el);
    const bar = box(el, '', '');
    box(el, 'wg-cap', L('<b style="color:var(--ink)">不活跃惩罚期间：</b>链已经很多天没有最终确定，你的验证者一直离线', '<b style="color:var(--ink)">During an inactivity leak:</b> the chain has not finalized for days and your validator is offline the whole time'), 'margin-top:.6rem');
    W().slider(el, { label: L('未最终确定的天数', 'Days without finality'), min: 0, max: 21, value: 0, fmt: v => v + L(' 天', ' d') }, v => { days = v; upd(); });
    const s2 = W().stats(el);
    function upd() {
      const u = up / 100, A = 32 * apr / 100 * 54 / 64, P = 32 * apr / 100 * 10 / 64;
      const net = u * A + u * P - (1 - u) * A * 40 / 54, best = A + P, even = (A * 40 / 54) / (A + P + A * 40 / 54);
      s1.set([[L('一年净收益', 'Net per year'), fmt(net) + ' ETH', net >= best * 0.97 ? 'good' : net > 0 ? 'mid' : 'bad'], [L('100% 在线时', 'At 100% uptime'), fmt(best) + ' ETH', ''], [L('离线损失', 'Lost to downtime'), fmt(best - net) + ' ETH', up >= 99 ? 'good' : 'mid'], [L('收支平衡的在线率', 'Break-even uptime'), Math.round(even * 100) + '%', '']]);
      bar.innerHTML = W().meter(Math.max(0, net / best * 100), net >= best * 0.97 ? '' : net > 0 ? 'mid' : 'bad', [[100 * even, 'break-even']]);
      const d = days * 225, leak = Math.min(16, 32 * d * (d + 1) / 2 / 16777216);
      s2.set([[L('离线验证者损失', 'Offline validator loses'), fmt(leak, 2) + ' ETH', leak < 0.5 ? 'mid' : 'bad'], [L('在线验证者', 'Online validator'), L('约 0（不罚也几乎不奖）', '≈ 0 (no penalty, almost no reward)'), 'good'], [L('余额降到 16 ETH', 'Balance reaches 16 ETH'), leak >= 16 ? L('被强制退出', 'ejected') : L('尚未', 'not yet'), leak >= 16 ? 'bad' : '']]);
    }
    cap(el, L('数字都是近似值：实际年化取决于全网质押总量，出块和同步委员会是随机分配的。不活跃惩罚按离线时间的平方增长。', 'All numbers are approximate: the real APR depends on total stake, and proposals and sync committees are random. The inactivity penalty grows with the square of the time offline.'));
  }

  /* ==========================================================
     Chapter 5: slashing
     ========================================================== */
  function wgSlashing(el) {
    title(el);
    let sA = 4, tA = 5, sB = 4, tB = 5, sameRoot = false, two = true, share = 0.1;
    const svgBox = box(el, '', '');
    const grid = box(el, '', '', 'display:grid;gap:.4rem');
    W().slider(grid, { label: L('A 的 source', 'A source'), min: 0, max: 9, value: 4 }, v => { sA = v; upd(); });
    W().slider(grid, { label: L('A 的 target', 'A target'), min: 1, max: 10, value: 5 }, v => { tA = v; upd(); });
    W().slider(grid, { label: L('B 的 source', 'B source'), min: 0, max: 9, value: 4 }, v => { sB = v; upd(); });
    W().slider(grid, { label: L('B 的 target', 'B target'), min: 1, max: 10, value: 5 }, v => { tB = v; upd(); });
    W().buttons(el, [[L('B 投给另一个区块', 'B votes for a different block'), () => { sameRoot = false; upd(); }], [L('B 与 A 完全相同', 'B is identical to A'), () => { sameRoot = true; upd(); }]], { toggle: true });
    W().buttons(el, [[L('钥匙复制到两台机器', 'Key copied to two machines'), () => { two = true; upd(); }], [L('只有一个验证者客户端', 'One validator client only'), () => { two = false; upd(); }]], { toggle: true });
    const verdict = box(el, 'lv-body', '', 'max-width:none;font-size:.92rem');
    W().slider(el, { label: L('同期被罚没的质押占比', 'Stake slashed in the same window'), min: 0, max: 40, step: 0.5, value: 0.1, fmt: v => v + '%' }, v => { share = v / 100; upd(); });
    const stats = W().stats(el);
    function arc(s, t, col, up) {
      const x1 = 40 + s * 56, x2 = 40 + t * 56, h = Math.max(18, (x2 - x1) * 0.45) * (up ? 1 : -1);
      return `<path d="M${x1} 80 Q ${(x1 + x2) / 2} ${80 - h} ${x2} 80" style="fill:none;stroke:${col};stroke-width:2.5"/><circle cx="${x2}" cy="80" r="4" style="fill:${col}"/>`;
    }
    function upd() {
      let s = `<line x1="30" y1="80" x2="610" y2="80" style="stroke:var(--line-2)"/>`;
      for (let e = 0; e <= 10; e++) s += `<line x1="${40 + e * 56}" y1="76" x2="${40 + e * 56}" y2="84" style="stroke:var(--line-2)"/><text x="${40 + e * 56}" y="100" text-anchor="middle" style="font-size:11px">${e}</text>`;
      const okA = tA > sA, okB = tB > sB;
      if (okA) s += arc(sA, tA, 'var(--lime)', true);
      if (okB) s += arc(sB, tB, 'var(--amber)', false);
      s += `<text x="16" y="62" style="font-size:12px;fill:var(--lime)">A ↑</text><text x="16" y="112" style="font-size:12px;fill:var(--amber)">B ↓</text>`;
      svgBox.innerHTML = svgOf('0 0 640 150', s);
      let v, cls = 'note';
      const same = sameRoot && sA === sB && tA === tB;
      const dbl = tA === tB && !same, sur = (sA < sB && tB < tA) || (sB < sA && tA < tB);
      if (!okA || !okB) v = L('target 必须大于 source。', 'The target must be after the source.');
      else if (same) v = L('两条完全相同的证明：重复广播无害。', 'Two identical attestations: broadcasting one twice is harmless.');
      else {
        const kind = dbl ? L('double vote：同一个 target epoch 投了两个不同的票', 'a double vote: two different votes for the same target epoch') : sur ? L('surround vote：一个投票的区间包住了另一个', 'a surround vote: one vote\'s span encloses the other') : null;
        const refused = tB <= tA || sB < sA;
        if (!two) { v = refused ? L(`验证者客户端拒绝签 B：它的 slashing 保护数据库记得 A（规则：target 必须比签过的更大，source 不能比签过的更小）。${kind ? `如果签了，就是 ${kind}。` : ''}`, `The validator client refuses to sign B: its slashing protection database remembers A (rule: the target must be higher than any signed so far, and the source must not be lower). ${kind ? `Had it signed, this would be ${kind}.` : ''}`) : L('B 与 A 不冲突，客户端照常签名。这是正常的逐个 epoch 前进。', 'B does not conflict with A, so the client signs it. This is the normal epoch-by-epoch progression.'); }
        else if (kind) { v = L(`两台机器各有一个空的保护数据库，谁也不知道对方签过什么，于是都签了。这是 ${kind}。任何人都可以把这两条消息作为证据提交上链，验证者被罚没。`, `Each machine has its own empty protection database and neither knows what the other signed, so both sign. This is ${kind}. Anyone can submit the two messages as evidence and the validator is slashed.`); cls = 'note warn'; }
        else v = L('两条投票不冲突。即使在两台机器上签，这一对也不会被罚没，但下一对可能会。', 'The two votes do not conflict. Even signed on two machines this pair is not slashable, but the next pair may be.');
      }
      verdict.innerHTML = `<div class="${cls}">${v}</div>`;
      const slashed = two && okA && okB && !same && (dbl || sur);
      const corr = Math.min(1, 3 * share) * 32;
      stats.set([[L('结果', 'Outcome'), slashed ? L('被罚没', 'slashed') : L('安全', 'safe'), slashed ? 'bad' : 'good'], [L('立即扣罚（约）', 'Initial penalty (approx.)'), slashed ? '0.008 ETH' : '0', slashed ? 'mid' : ''], [L('关联扣罚（约）', 'Correlation penalty (approx.)'), slashed ? corr.toFixed(2) + ' ETH' : '0', slashed ? (corr > 1 ? 'bad' : 'mid') : ''], [L('能取回余额', 'Withdrawable after'), slashed ? L('约 36 天', '≈ 36 days') : '—', slashed ? 'bad' : '']]);
    }
    upd();
    cap(el, L('A 画在轴上方，B 画在下方。数字为 epoch。关联扣罚大约是同期被罚没质押占比的三倍，单独出错时很小，大规模同时出错时可能扣光余额。', 'A is drawn above the axis and B below; the numbers are epochs. The correlation penalty is roughly three times the share of stake slashed in the same period: small for a lone mistake, up to the whole balance when many fail together.'));
  }

  /* ==========================================================
     Chapter 6: keys, deposits and the activation queue
     ========================================================== */
  function wgKeys(el) {
    title(el);
    let cred = 1, bal = 33.4, i = 0;
    box(el, 'wg-cap', L('<b style="color:var(--ink)">取款凭证</b>', '<b style="color:var(--ink)">Withdrawal credentials</b>'));
    W().buttons(el, [['0x00 (BLS)', () => { cred = 0; upd(); }], ['0x01', () => { cred = 1; upd(); }], ['0x02 (compounding)', () => { cred = 2; upd(); }]], { toggle: true, selected: 1 });
    W().slider(el, { label: L('余额（ETH）', 'Balance (ETH)'), min: 32, max: 72, step: 0.1, value: 33.4, fmt: v => v.toFixed(1) }, v => { bal = v; upd(); });
    const s1 = W().stats(el);
    const note1 = box(el, 'wg-cap', '');
    box(el, 'wg-cap', L('<b style="color:var(--ink)">一个验证者的生命周期</b>（<code>/eth/v1/beacon/states/head/validators/&lt;pubkey&gt;</code> 中的 status）', '<b style="color:var(--ink)">A validator\'s lifecycle</b> (the status in <code>/eth/v1/beacon/states/head/validators/&lt;pubkey&gt;</code>)'), 'margin-top:.6rem');
    const STAGES = [
      ['deposit', L('存款交易打包进执行层区块。信标链要等这个区块被最终确定，才处理这笔存款。在此之前查询这个公钥会得到 404。', 'The deposit transaction is in an execution block. The beacon chain processes it only after that block is finalized; until then a lookup for the pubkey returns 404.'), L('约 15 分钟', '≈ 15 min')],
      ['pending_initialized', L('存款排在待处理存款队列中，按 churn 限额（每个 epoch 可进入的新质押量）依次处理。处理后验证者进入状态，获得索引。', 'The deposit waits in the pending-deposit queue, processed within the churn limit (the new stake allowed in per epoch). Once processed, the validator is in the state and has an index.'), L('取决于队列', 'depends on the queue')],
      ['pending_queued', L('验证者已具备激活资格，等待这一资格被最终确定，然后在之后第 5 个 epoch 激活。', 'The validator is eligible. Once that eligibility is finalized, it activates five epochs later.'), L('约 1 小时', '≈ 1 h')],
      ['active_ongoing', L('开始承担任务：每个 epoch 一次证明，偶尔出块或进入同步委员会。从这一刻起，离线就会被扣罚。', 'Duties begin: one attestation per epoch, now and then a proposal or a sync committee. From now on, being offline costs money.'), L('直到退出', 'until exit')],
      ['active_exiting', L('已提交自愿退出（用签名钥匙签，或在 Pectra 之后从取款地址在执行层触发）。在退出 epoch 之前仍要履行职责。', 'A voluntary exit was submitted (signed with the signing key, or since Pectra triggered from the withdrawal address on the execution layer). Duties continue until the exit epoch.'), L('排队，受 churn 限制', 'queued, churn-limited')],
      ['exited_unslashed', L('不再有任务。余额要等到可取款 epoch（退出后约 27 小时）。', 'No more duties. The balance waits for the withdrawable epoch (about 27 hours after exit).'), L('约 27 小时', '≈ 27 h')],
      ['withdrawal_done', L('全部余额由取款扫描自动发到取款地址，不需要发交易。', 'The withdrawal sweep sends the whole balance to the withdrawal address automatically; no transaction is needed.'), L('扫描一轮', 'one sweep')],
    ];
    const track = box(el, '', '', 'display:flex;gap:4px;flex-wrap:wrap');
    const desc = box(el, 'lv-body', '', 'max-width:none;font-size:.92rem');
    W().buttons(el, [[L('◀ 上一步', '◀ Back'), () => { i = Math.max(0, i - 1); upd(); }], [L('下一步 ▶', 'Next ▶'), () => { i = Math.min(STAGES.length - 1, i + 1); upd(); }]]);
    function upd() {
      let eff, skim, msg;
      if (cred === 0) { eff = 32; skim = 0; msg = L('0x00 凭证只是 BLS 取款公钥的哈希，不能取款。要先签一条 BLS to execution change 消息，改成 0x01。', '0x00 credentials are only a hash of a BLS withdrawal key, and cannot receive withdrawals. A signed BLS-to-execution change has to convert them to 0x01 first.'); }
      else if (cred === 1) { eff = 32; skim = Math.max(0, bal - 32); msg = L('0x01：有效余额最多 32 ETH。超出部分由取款扫描定期自动转到取款地址，不会产生复利。', '0x01: the effective balance stops at 32 ETH. The excess is swept to the withdrawal address automatically and does not compound.'); }
      else { eff = Math.min(2048, Math.floor(bal - 0.25)); skim = 0; msg = L('0x02（Pectra 引入）：有效余额可以涨到 2048 ETH，奖励留在验证者里继续产生收益。超出 2048 的部分才会被自动转走。', '0x02 (since Pectra): the effective balance can grow up to 2048 ETH, so rewards stay in the validator and earn too. Only the part above 2048 is swept.'); }
      s1.set([[L('有效余额', 'Effective balance'), eff + ' ETH', ''], [L('自动转走', 'Swept out'), cred === 0 ? L('不能取款', 'not withdrawable') : skim.toFixed(1) + ' ETH', cred === 0 ? 'bad' : ''], [L('按什么计奖励', 'Rewards scale with'), eff + ' ETH', '']]);
      note1.innerHTML = msg;
      track.innerHTML = STAGES.map((st, k) => `<span style="font-family:var(--f-mono);font-size:.72rem;padding:.3rem .5rem;border-radius:6px;background:${k === i ? 'var(--lime)' : k < i ? 'var(--line-2)' : 'var(--panel-3)'};color:${k === i ? '#0b0f0d' : 'var(--ink-2)'}">${st[0]}</span>`).join('');
      desc.innerHTML = `<p><code>${STAGES[i][0]}</code> · ${STAGES[i][2]}</p><p>${STAGES[i][1]}</p>`;
    }
    upd();
  }

  /* ==========================================================
     Chapter 7: sync and checkpoint sync
     ========================================================== */
  function wgSync(el) {
    title(el);
    let mode = 'cp', t = 0, elOn = true, running = false, speed = 1;
    W().buttons(el, [['checkpoint sync', () => { mode = 'cp'; reset(); }], [L('从创世同步', 'sync from genesis'), () => { mode = 'gen'; reset(); }]], { toggle: true });
    const bars = box(el, '', '', 'display:grid;gap:.5rem');
    const json = W().el('pre', 'term-snip', ''); json.style.margin = '0'; el.appendChild(json);
    W().buttons(el, [[L('开始', 'Start'), b => { running = !running; b.textContent = running ? L('暂停', 'Pause') : L('开始', 'Start'); }], [L('停止执行客户端', 'Stop the execution client'), b => { elOn = !elOn; b.classList.toggle('on', !elOn); b.textContent = elOn ? L('停止执行客户端', 'Stop the execution client') : L('启动执行客户端', 'Start the execution client'); }]]);
    const stats = W().stats(el);
    function reset() { t = 0; draw(); }
    // simulated hours: checkpoint sync reaches the head in minutes, genesis sync takes days; snap sync of the EL takes hours
    const clDone = () => (mode === 'cp' ? 0.1 : 60), elDone = 6;
    let cl = 0, ex = 0;
    function draw() {
      const clP = Math.min(1, cl / clDone()), elP = Math.min(1, ex / elDone);
      const synced = clP >= 1, opt = synced && elP < 1;
      bars.innerHTML = `<div class="wg-cap">${L('beacon 节点（共识层）', 'Beacon node (consensus)')} · ${Math.round(clP * 100)}%</div>${W().meter(clP * 100, clP >= 1 ? '' : 'mid')}<div class="wg-cap">${L('Besu（执行层，snap sync）', 'Besu (execution, snap sync)')} · ${elOn ? Math.round(elP * 100) + '%' : L('已停止', 'stopped')}</div>${W().meter(elP * 100, !elOn ? 'bad' : elP >= 1 ? '' : 'mid')}`;
      const dist = Math.round((1 - clP) * (mode === 'cp' ? 80 : 4200000));
      json.textContent = `$ curl -s localhost:5051/eth/v1/node/syncing | jq .data\n${JSON.stringify({ head_slot: String(4203550 - dist), sync_distance: String(dist), is_syncing: !synced, is_optimistic: !synced || elP < 1 || !elOn, el_offline: !elOn }, null, 2)}`;
      stats.set([[L('模拟时间', 'Simulated time'), t < 1 ? Math.round(t * 60) + ' min' : t.toFixed(1) + ' h', ''], [L('验证者能否工作', 'Can the validator work'), synced && elP >= 1 && elOn ? L('能', 'yes') : L('不能', 'no'), synced && elP >= 1 && elOn ? 'good' : 'bad'], [L('状态', 'State'), !elOn ? 'el_offline' : !synced ? 'syncing' : opt ? 'optimistic' : 'synced', !elOn ? 'bad' : opt || !synced ? 'mid' : 'good']]);
    }
    W().loop(dt => {
      if (!running) return;
      const h = dt * 0.8 * speed; t += h;
      if (elOn) { cl += h; if (cl >= clDone()) ex += h; }
      draw();
    });
    reset();
    cap(el, L('时间按模拟小时计算，只示意数量级：checkpoint sync 几分钟，从创世同步要几天；执行层的 snap sync 在测试网上要几个小时，在主网上更久。', 'Time runs in simulated hours and only shows the order of magnitude: checkpoint sync takes minutes, genesis sync days; the execution client\'s snap sync takes hours on a testnet and longer on mainnet.'));
  }

  /* ==========================================================
     The lesson
     ========================================================== */
  S.registerLesson({
    id: 'ethereum-basics', network: 'ethereum', minutes: 35,
    title: LL('以太坊验证者运维基础', 'Ethereum fundamentals for validator operators'),
    tagline: LL('一个节点里的三个进程、slot 与 epoch、最终确定、奖励与惩罚、罚没、钥匙与存款、同步。', 'The three processes in a node, slots and epochs, finality, rewards and penalties, slashing, keys and deposits, and sync.'),
    chapters: [
      {
        title: LL('一个节点，两个客户端', 'Two clients, one node'),
        body: LL(
          `<p>合并之后，一个以太坊节点由两个客户端组成。<b>执行客户端</b>（EL，例如 Besu、Geth、Nethermind）保存账户状态、执行交易、维护交易池。<b>共识客户端</b>（CL，也叫 beacon 节点，例如 Teku、Lighthouse、Prysm）跟踪信标链，决定哪个区块是链头、哪个已经最终确定。</p>
<p>两者通过 <b>Engine API</b> 通信。beacon 节点把每个新区块的执行负载交给执行客户端验证，并告诉它链头在哪里。执行客户端自己不再决定导入哪个区块。Engine API 只监听本机（默认 8551 端口），每个请求都带一个 JWT，用两边共享的 32 字节密钥签名。</p>
<p><b>验证者客户端</b>（VC）是第三个进程。它持有签名钥匙，通过 beacon 节点的 REST API（常见端口 5051）查询任务、取回要签名的数据，再把签好的消息交回去。把钥匙放在单独的进程里，beacon 节点就可以重启、升级或替换，而不必碰钥匙。</p>
<h3>客户端多样性</h3>
<p>同一实现的 bug 会同时影响所有运行它的验证者。如果一个客户端占全网质押超过三分之一，它的 bug 可以让整条链无法最终确定；超过三分之二，它可能把一条无效的链最终确定，使用者会被困在那条链上并受到惩罚。所以运营者倾向于选择占比较小的客户端组合。</p>`,
          `<p>Since the Merge an Ethereum node is two clients. The <b>execution client</b> (EL: Besu, Geth, Nethermind and others) holds the account state, executes transactions and keeps the mempool. The <b>consensus client</b> (CL, or beacon node: Teku, Lighthouse, Prysm and others) follows the beacon chain and decides which block is the head and which is finalized.</p>
<p>They talk over the <b>Engine API</b>. The beacon node hands every new block's execution payload to the execution client to verify, and tells it where the head is. The execution client no longer chooses which blocks to import. The Engine API listens on localhost only (port 8551 by default), and every request carries a JWT signed with a 32-byte secret that both sides share.</p>
<p>The <b>validator client</b> (VC) is a third process. It holds the signing keys, asks the beacon node's REST API (usually port 5051) for its duties and for the data to sign, and hands the signed messages back. With the keys in a separate process, the beacon node can be restarted, upgraded or replaced without touching them.</p>
<h3>Client diversity</h3>
<p>A bug in one implementation hits every validator running it at the same moment. A client with more than one third of the stake can stop the chain from finalizing; one with more than two thirds could finalize an invalid chain, and its users would be stuck on it and penalized. Operators therefore prefer client combinations with a smaller share.</p>`),
        widget: wgClients,
        quiz: [
          { q: LL('Besu 在运行，有 25 个对等节点，RPC 也能应答，但区块高度 20 分钟没有变化。最可能断掉的是哪条连接？', 'Besu is running, has 25 peers and answers RPC, but its block number has not changed for 20 minutes. Which link is most likely broken?'),
            options: [LL('执行层 P2P', 'Execution P2P'), LL('Besu 和 beacon 节点之间的 Engine API', 'The Engine API between Besu and the beacon node'), LL('验证者客户端和 beacon 节点之间的 REST API', 'The REST API between the validator client and the beacon node')], answer: 1,
            why: LL('合并之后，执行客户端只导入 beacon 节点通过 Engine API 交给它的区块。', 'Since the Merge the execution client only imports blocks that the beacon node hands it over the Engine API.') },
          { q: LL('客户端多样性为什么重要？', 'Why does client diversity matter?'),
            options: [LL('占比较小的客户端奖励更高', 'Less popular clients pay higher rewards'), LL('一个占三分之二以上质押的客户端出现 bug，可能把无效的链最终确定', 'A bug in a client with more than two thirds of the stake could finalize an invalid chain'), LL('协议要求每个验证者运行两个不同的共识客户端', 'The protocol requires every validator to run two different consensus clients')], answer: 1,
            why: LL('同一实现的 bug 会同时作用于所有使用者；份额越大，波及整条链的风险越大。', 'A bug in one implementation acts on all its users at once; the larger its share, the more of the chain it can drag along.') },
        ],
      },
      {
        title: LL('slot、epoch 与任务', 'Slots, epochs and duties'),
        body: LL(
          `<p>信标链的时间分成 <b>slot</b>，每个 12 秒；32 个 slot 组成一个 <b>epoch</b>，约 6.4 分钟。每个 slot 最多有一个区块。</p>
<table><tr><th>任务</th><th>频率</th><th>时机</th></tr>
<tr><td>证明（attestation）</td><td>每个 epoch 一次</td><td>在分配到的 slot 里，收到区块后、最晚在 slot 开始 4 秒时投票</td></tr>
<tr><td>出块（proposal）</td><td>被随机选中时</td><td>slot 开始时。全网验证者很多，单个验证者平均几个月才轮到一次</td></tr>
<tr><td>同步委员会</td><td>被随机选中时，持续 256 个 epoch（约 27 小时）</td><td>期间每个 slot 签一次链头</td></tr>
<tr><td>聚合</td><td>部分证明者被选中</td><td>slot 开始后 8 秒，把同一委员会的证明合并</td></tr></table>
<p>一条证明同时投三票：<b>source</b>（最近的 justified checkpoint）、<b>target</b>（当前 epoch 的第一个区块）和 <b>head</b>（当前链头）。证明在自己的 slot 签出，通常被下一个 slot 的区块打包。打包得越晚，能拿到的奖励越少。</p>
<p>任务提前一个 epoch 确定，验证者客户端会预先向 beacon 节点查询。所以重启 beacon 节点或验证者客户端时，最好避开即将到来的任务。</p>`,
          `<p>Beacon chain time is divided into <b>slots</b> of 12 seconds; 32 slots make an <b>epoch</b> of about 6.4 minutes. Each slot holds at most one block.</p>
<table><tr><th>Duty</th><th>How often</th><th>When</th></tr>
<tr><td>Attestation</td><td>Once per epoch</td><td>In its assigned slot, after the block arrives and by 4 seconds into the slot</td></tr>
<tr><td>Proposal</td><td>When randomly selected</td><td>At the start of the slot. With so many validators, one validator proposes only every few months on average</td></tr>
<tr><td>Sync committee</td><td>When randomly selected, for 256 epochs (about 27 hours)</td><td>Signs the head in every slot of that period</td></tr>
<tr><td>Aggregation</td><td>Some attesters are selected</td><td>8 seconds into the slot, combines its committee's attestations</td></tr></table>
<p>One attestation casts three votes: <b>source</b> (the latest justified checkpoint), <b>target</b> (the first block of the current epoch) and <b>head</b> (the current head). It is signed in its own slot and normally included by the block of the next slot. The later it is included, the less it earns.</p>
<p>Duties are known one epoch ahead, and the validator client fetches them from the beacon node in advance. When restarting the beacon node or the validator client, stay clear of an upcoming duty if you can.</p>`),
        widget: wgEpoch,
        quiz: [
          { q: LL('一个处于激活状态的验证者多久出一次证明？', 'How often does an active validator attest?'),
            options: [LL('每个 slot', 'Every slot'), LL('每个 epoch 一次，约 6.4 分钟', 'Once per epoch, about every 6.4 minutes'), LL('只在被选为出块者时', 'Only when selected to propose')], answer: 1,
            why: LL('每个激活的验证者每个 epoch 都被分到一个 slot 出一次证明。', 'Every active validator is assigned one slot per epoch in which it attests.') },
          { q: LL('你的验证者在 slot N 出证明。它通常什么时候被打包？', 'Your validator attests in slot N. When is that attestation normally included?'),
            options: [LL('在 slot N 自己的区块里', 'In the block of slot N itself'), LL('在 slot N+1 的区块里', 'In the block of slot N+1'), LL('在 epoch 结束时统一打包', 'All together at the end of the epoch')], answer: 1,
            why: LL('证明要等 slot N 的区块出现后才签，所以最早由下一个 slot 的出块者打包。', 'The attestation is signed after the block of slot N appears, so the earliest proposer to include it is the next one.') },
        ],
      },
      {
        title: LL('最终确定', 'Finality'),
        body: LL(
          `<p>以太坊用 Casper FFG 做最终确定。每个 epoch 的第一个 slot 是一个 <b>checkpoint</b>。证明里的 source 和 target 两票，就是从一个 checkpoint 指向另一个 checkpoint 的投票。</p>
<ul><li>如果代表全部质押 <b>三分之二以上</b> 的验证者都投了某个 checkpoint 作为 target，它就被 <b>justified</b>。</li>
<li>一个 justified 的 checkpoint，如果紧接着的下一个 checkpoint 也被 justified（并以它为 source），它就被 <b>finalized</b>。</li></ul>
<p>正常情况下，节点看到的已最终确定 epoch 比当前 epoch 落后 2 个，大约 13 分钟。<b>最终确定滞后</b>就是当前 epoch 与已最终确定 epoch 之差。要撤销一个已最终确定的区块，至少三分之一的质押要被罚没。</p>
<p>如果参与投票的质押低于三分之二，区块照常产生，但 justification 和 finality 停止。滞后超过 4 个 epoch，<b>不活跃惩罚</b>开始：离线验证者的扣罚随时间快速增长，直到在线的验证者重新占到三分之二。</p>`,
          `<p>Ethereum finalizes with Casper FFG. The first slot of each epoch is a <b>checkpoint</b>. The source and target votes in an attestation are a vote from one checkpoint to another.</p>
<ul><li>When validators holding <b>more than two thirds</b> of all stake vote for a checkpoint as their target, it becomes <b>justified</b>.</li>
<li>A justified checkpoint becomes <b>finalized</b> when the next checkpoint is also justified, with the first one as its source.</li></ul>
<p>Normally the finalized epoch a node sees is 2 behind the current one, about 13 minutes. The <b>finality lag</b> is the difference between the current epoch and the finalized one. Reverting a finalized block would require at least one third of all stake to be slashed.</p>
<p>When less than two thirds of the stake votes, blocks keep coming but justification and finality stop. Once the lag passes 4 epochs, the <b>inactivity leak</b> starts: penalties on offline validators grow quickly with time, until the online validators make up two thirds again.</p>`),
        widget: wgFinality,
        quiz: [
          { q: LL('只有 60% 的质押在投票。会发生什么？', 'Only 60% of the stake is voting. What happens?'),
            options: [LL('最终确定变慢，但仍在继续', 'Finality continues, only slower'), LL('不再有新的 checkpoint 被 justified，最终确定停止，区块照常产生', 'No new checkpoint is justified, so finality stops, while blocks keep coming'), LL('不再产生区块', 'No more blocks are produced')], answer: 1,
            why: LL('justification 需要三分之二的质押；出块不需要。', 'Justification needs two thirds of the stake; producing blocks does not.') },
          { q: LL('正常的最终确定滞后大约是多少？', 'What is a normal finality lag?'),
            options: [LL('2 个 epoch，约 13 分钟', '2 epochs, about 13 minutes'), LL('1 个 slot', '1 slot'), LL('1 天', '1 day')], answer: 0,
            why: LL('当前 epoch 的上一个 checkpoint 被 justified，再上一个被 finalized。', 'The previous checkpoint is justified and the one before it finalized.') },
        ],
      },
      {
        title: LL('奖励与惩罚', 'Rewards and penalties'),
        body: LL(
          `<p>大部分收益来自证明。一条证明的三票分开计奖励，各有条件：</p>
<table><tr><th>部分</th><th>约占全部奖励</th><th>得到奖励的条件</th><th>错过时</th></tr>
<tr><td>source</td><td>14/64</td><td>5 个 slot 内打包</td><td>扣罚，金额与奖励相当</td></tr>
<tr><td>target</td><td>26/64</td><td>投对 target 并被打包（最晚到下一个 epoch 结束）</td><td>扣罚，金额与奖励相当</td></tr>
<tr><td>head</td><td>14/64</td><td>下一个 slot 打包，且投对链头</td><td>只是没有奖励</td></tr></table>
<p>其余来自出块（8/64）和同步委员会（2/64）。出块的机会是随机的，单个验证者一年可能只有几次。</p>
<p>正常最终确定时，一次错过的证明扣掉的金额大约是它本来能赚的四分之三。离线一小时，损失也就是大约一小时的收益。<b>效率</b>（effectiveness）衡量按时、完整的证明所占的比例，运维中常用它而不是余额来发现问题。</p>
<p>不活跃惩罚期间完全不同：离线验证者的"不活跃分数"每个 epoch 增加，扣罚按离线时间的平方增长，余额跌到 16 ETH 时被强制退出。在线的验证者不被扣罚，但几乎也没有奖励。</p>`,
          `<p>Most income comes from attestations. The three votes are rewarded separately, each with its own condition:</p>
<table><tr><th>Part</th><th>Share of all rewards</th><th>Rewarded when</th><th>When missed</th></tr>
<tr><td>source</td><td>14/64</td><td>included within 5 slots</td><td>a penalty about equal to the reward</td></tr>
<tr><td>target</td><td>26/64</td><td>with the right target, whenever included (up to the end of the next epoch)</td><td>a penalty about equal to the reward</td></tr>
<tr><td>head</td><td>14/64</td><td>included in the next slot, with the right head</td><td>no reward, no penalty</td></tr></table>
<p>The rest comes from proposals (8/64) and sync committees (2/64). Proposals are random; one validator may get only a few a year.</p>
<p>While the chain finalizes, a missed attestation costs about three quarters of what it would have earned. An hour offline costs roughly an hour of income. <b>Effectiveness</b> measures the share of attestations that were complete and on time, and operators watch it rather than the balance to spot problems.</p>
<p>An inactivity leak is different: an offline validator's inactivity score rises every epoch, its penalty grows with the square of the time offline, and at 16 ETH it is ejected. Online validators are not penalized, but earn almost nothing.</p>`),
        widget: wgRewards,
        quiz: [
          { q: LL('链在正常最终确定，一个验证者离线了 1 小时。它大约损失多少？', 'The chain finalizes normally and a validator is offline for 1 hour. Roughly what does it lose?'),
            options: [LL('大约相当于这一小时本该赚到的收益', 'About what it would have earned in that hour'), LL('全部质押', 'Its whole stake'), LL('什么都不损失', 'Nothing at all')], answer: 0,
            why: LL('错过 source 和 target 的扣罚与其奖励相当，加起来约为证明收益的四分之三。', 'Missed source and target votes are penalized by about their reward, together roughly three quarters of an attestation\'s income.') },
          { q: LL('离线的扣罚什么时候会迅速增长？', 'When do penalties for being offline grow quickly?'),
            options: [LL('出块失败时', 'When a proposal fails'), LL('链超过 4 个 epoch 没有最终确定，进入不活跃惩罚时', 'In an inactivity leak, when the chain has not finalized for more than 4 epochs'), LL('同步委员会期间', 'During a sync committee')], answer: 1,
            why: LL('不活跃惩罚期间，扣罚随不活跃分数增长，离线越久越重。', 'During a leak the penalty follows the inactivity score, which keeps rising the longer a validator stays offline.') },
        ],
      },
      {
        title: LL('罚没', 'Slashing'),
        body: LL(
          `<p>只有两类行为会被罚没，两者都是用同一把钥匙签了自相矛盾的消息：</p>
<ul><li><b>双重出块</b>：同一个 slot 签了两个不同的区块。</li>
<li><b>双重投票或环绕投票</b>：同一个 target epoch 签了两条不同的证明（double vote），或者一条证明的 source 到 target 区间完全包住了另一条（surround vote）。</li></ul>
<p>任何人都可以把两条矛盾的消息作为证据提交上链。被罚没的验证者立即被扣除一小部分余额（Pectra 之后约为有效余额的 1/4096），被强制退出，并在约 36 天后才能取回余额。在这段时间的中点，还有一笔<b>关联扣罚</b>，与同一时期被罚没的总质押成正比：单独一个验证者出错时很小，大批验证者同时出错时可能扣光。</p>
<h3>slashing 保护</h3>
<p>验证者客户端在本地数据库里记录每把钥匙签过的最高 source 和 target epoch 以及出块 slot，拒绝签任何与之冲突的消息。EIP-3076 定义了这个数据库的交换格式，迁移钥匙时把记录一起导出、导入。</p>
<div class="note warn">保护只在一个数据库内有效。把同一把钥匙放进两个验证者客户端，例如为了"冗余"，两边各有一份空白记录，谁也不知道对方签过什么。实际发生的罚没大多来自这种情况：迁移、故障切换、备份恢复。</div>`,
          `<p>Only two kinds of behaviour are slashed, and both mean the same key signed contradictory messages:</p>
<ul><li><b>Double proposal</b>: two different blocks signed for the same slot.</li>
<li><b>Double vote or surround vote</b>: two different attestations for the same target epoch (a double vote), or one attestation whose source-to-target span encloses another's (a surround vote).</li></ul>
<p>Anyone can submit the two messages as evidence on chain. The slashed validator loses a small part of its balance at once (since Pectra about 1/4096 of its effective balance), is forced to exit, and can only withdraw after about 36 days. Halfway through, a <b>correlation penalty</b> is applied in proportion to the total stake slashed in the same period: small for a single mistake, up to the whole balance when many validators fail together.</p>
<h3>Slashing protection</h3>
<p>The validator client keeps a local database of the highest source and target epochs and block slots each key has signed, and refuses to sign anything that conflicts. EIP-3076 defines an interchange format for this database, so the history can be exported and imported with the key when it moves.</p>
<div class="note warn">Protection only works within one database. Put the same key into two validator clients, for example for "redundancy", and each side has its own empty history and cannot know what the other signed. Most real slashings come from exactly this: migrations, failover setups, restores from backup.</div>`),
        widget: wgSlashing,
        quiz: [
          { q: LL('下面哪一对证明会被罚没？', 'Which pair of attestations is slashable?'),
            options: [LL('source 5 → target 6，然后 source 6 → target 7', 'source 5 → target 6, then source 6 → target 7'), LL('source 4 → target 7，然后 source 5 → target 6', 'source 4 → target 7, then source 5 → target 6'), LL('同一条证明广播了两次', 'The same attestation broadcast twice')], answer: 1,
            why: LL('4→7 的区间包住了 5→6，这是 surround vote。', 'The span 4→7 encloses 5→6: a surround vote.') },
          { q: LL('为什么为了"冗余"把 keystore 复制到第二台机器很危险？', 'Why is copying a keystore to a second machine "for redundancy" dangerous?'),
            options: [LL('每台机器有自己的 slashing 保护数据库，谁都不知道对方签过什么', 'Each machine has its own slashing protection database, and neither knows what the other signed'), LL('keystore 只能被解密一次', 'A keystore can only be decrypted once'), LL('存款合约会拒绝第二台机器', 'The deposit contract rejects the second machine')], answer: 0,
            why: LL('两边都会签，只要两条消息有冲突，验证者就会被罚没。', 'Both sides sign, and as soon as two of the messages conflict the validator is slashed.') },
        ],
      },
      {
        title: LL('钥匙、存款与激活队列', 'Keys, deposits and the activation queue'),
        body: LL(
          `<p>一个验证者涉及两样东西：</p>
<ul><li><b>签名钥匙</b>：BLS 钥匙，每个 epoch 都要用来签证明。它以加密的 <b>keystore</b>（EIP-2335 的 JSON 文件）形式放在验证者客户端旁边，配一个密码。</li>
<li><b>取款凭证</b>：决定余额最终去哪里。<code>0x01</code> 指向一个执行层地址；Pectra 引入的 <code>0x02</code> 也指向执行层地址，并允许有效余额从 32 ETH 涨到 2048 ETH（复利）。旧的 <code>0x00</code> 不能取款，要先转换成 0x01。</li></ul>
<p>两者都由一个<b>助记词</b>推导出来，通常用 staking deposit CLI 生成。助记词能重新生成签名钥匙，也能签取款相关的消息，所以只在离线或专用的机器上生成和保存，服务器上只放 keystore 和密码。</p>
<h3>存款与排队</h3>
<p>向<b>存款合约</b>发送 32 ETH，并附上 deposit CLI 生成的存款数据（公钥、取款凭证、签名）。Pectra 之后，信标链直接读取执行层区块里的存款请求，放入待处理队列，每笔存款要等它所在的区块被最终确定后才处理。每个 epoch 能进入的新质押受 <b>churn 限额</b>约束（目前约 256 ETH，相当于 8 个 32 ETH 验证者），队列长时可能要等几天甚至几周。之后验证者经过 pending_initialized、pending_queued 两个状态，变为 active_ongoing。</p>
<p>退出同样排队并受同一个限额约束。退出后约 27 小时可以取款，余额由取款扫描自动发到取款地址。</p>`,
          `<p>A validator involves two things:</p>
<ul><li>The <b>signing key</b>: a BLS key used to sign an attestation every epoch. It sits next to the validator client as an encrypted <b>keystore</b> (an EIP-2335 JSON file) with a password.</li>
<li>The <b>withdrawal credentials</b>: where the balance ends up. <code>0x01</code> points at an execution-layer address; <code>0x02</code>, added by Pectra, also points at an address and lets the effective balance grow from 32 ETH up to 2048 ETH (compounding). The old <code>0x00</code> cannot receive withdrawals until it is converted to 0x01.</li></ul>
<p>Both derive from a <b>mnemonic</b>, usually generated with the staking deposit CLI. The mnemonic can regenerate the signing keys and sign withdrawal-related messages, so it is generated and kept only on an offline or dedicated machine. The server gets the keystore and its password, nothing more.</p>
<h3>Deposit and queue</h3>
<p>Send 32 ETH to the <b>deposit contract</b> with the deposit data the CLI produced (pubkey, withdrawal credentials, signature). Since Pectra the beacon chain reads deposit requests straight from execution blocks into a pending queue, and processes each one only after its block is finalized. New stake per epoch is limited by the <b>churn limit</b> (currently about 256 ETH, eight 32-ETH validators), so a long queue can take days or weeks. The validator then passes through pending_initialized and pending_queued to active_ongoing.</p>
<p>Exits queue too, under the same limit. About 27 hours after the exit the balance becomes withdrawable and the withdrawal sweep sends it to the withdrawal address automatically.</p>`),
        widget: wgKeys,
        quiz: [
          { q: LL('0x01 取款凭证指向什么？', 'What do 0x01 withdrawal credentials point to?'),
            options: [LL('验证者的签名钥匙', 'The validator\'s signing key'), LL('一个接收取款的执行层地址', 'An execution-layer address that receives withdrawals'), LL('存款合约', 'The deposit contract')], answer: 1,
            why: LL('取款凭证决定余额去哪里，与签名钥匙无关。', 'Withdrawal credentials decide where the balance goes; they are separate from the signing key.') },
          { q: LL('存款之后，status 显示 pending_queued 是什么意思？', 'After the deposit, what does status pending_queued mean?'),
            options: [LL('存款交易还在交易池里', 'The deposit transaction is still in the mempool'), LL('验证者已在信标链状态中，等待它的激活 epoch', 'The validator is in the beacon state and waits for its activation epoch'), LL('验证者已激活但离线', 'The validator is active but offline')], answer: 1,
            why: LL('pending_queued 表示已具备激活资格、激活 epoch 尚未到来。', 'pending_queued means the validator is eligible and its activation epoch has not arrived yet.') },
          { q: LL('助记词应该在哪里生成？', 'Where should the mnemonic be generated?'),
            options: [LL('在验证者服务器上，方便直接使用', 'On the validator server, where it is needed'), LL('在离线或专用的机器上，绝不在验证者服务器上', 'On an offline or dedicated machine, never on the validator server'), LL('在任何浏览器里', 'In any web browser')], answer: 1,
            why: LL('服务器一直联网、会被备份；助记词控制钥匙和资金，必须远离它。', 'A server is always online and gets backed up; the mnemonic controls keys and funds and must stay away from it.') },
        ],
      },
      {
        title: LL('同步与 checkpoint sync', 'Sync and checkpoint sync'),
        body: LL(
          `<p>新节点要先追上网络才能工作，两个客户端各自同步：</p>
<ul><li><b>共识层</b>：从创世开始处理每个 slot 要几天。<b>checkpoint sync</b> 从一个可信端点下载最近的已最终确定状态，几分钟就能追上链头，历史区块可以之后在后台补齐。启动后应把加载的 checkpoint 根与另一个独立来源（例如区块浏览器）核对。</li>
<li><b>执行层</b>：snap sync 之类的模式直接下载最近的状态，再补齐区块，不必从头执行每笔交易。即便如此，测试网也要几个小时，主网更久。执行客户端需要 beacon 节点告诉它同步目标，所以两个客户端都要启动。</li></ul>
<p>beacon 节点已经跟上而执行客户端还没同步完时，beacon 处于 <b>optimistic</b> 状态：它跟着链头，却无法验证区块里的交易，不能用于出证明和出块。执行客户端停止或无法认证时，beacon 节点报告 <code>el_offline: true</code>。</p>
<p>磁盘会持续增长。主网上执行客户端的数据以 TB 计，共识客户端在修剪模式下也有数百 GB；测试网小一些，但同样逐月增长。监控磁盘，提前扩容。</p>`,
          `<p>A new node has to catch up with the network before it can work, and each client syncs on its own:</p>
<ul><li><b>Consensus</b>: processing every slot from genesis takes days. <b>Checkpoint sync</b> downloads a recent finalized state from a trusted endpoint and reaches the head in minutes; older blocks can be filled in later in the background. After startup, compare the checkpoint root it loaded with a second, independent source such as a block explorer.</li>
<li><b>Execution</b>: modes such as snap sync download a recent state and then the blocks, without re-executing every transaction. Even so it takes hours on a testnet and longer on mainnet. The execution client needs the beacon node to give it a sync target, so both clients must run.</li></ul>
<p>When the beacon node has caught up but the execution client has not, the beacon node is <b>optimistic</b>: it follows the head but cannot verify the transactions in the blocks, and must not be used to attest or propose. When the execution client is stopped or cannot authenticate, the beacon node reports <code>el_offline: true</code>.</p>
<p>Disk use keeps growing. On mainnet the execution client's data is measured in terabytes and a pruned consensus client still needs hundreds of GB; a testnet is smaller but grows month by month as well. Monitor the disk and grow it early.</p>`),
        widget: wgSync,
        quiz: [
          { q: LL('为什么用 checkpoint sync？', 'Why use checkpoint sync?'),
            options: [LL('从最近的已最终确定状态开始，beacon 节点几分钟内可用，而不是几天', 'It starts from a recent finalized state, so the beacon node is ready in minutes instead of days'), LL('它让验证者可以在执行客户端同步完成前出证明', 'It lets the validator attest before the execution client has synced'), LL('它跳过所有签名验证', 'It skips all signature checks')], answer: 0,
            why: LL('checkpoint sync 只省掉从创世重放的时间，节点之后照常验证每个新区块。', 'Checkpoint sync only saves replaying from genesis; the node still verifies every new block afterwards.') },
          { q: LL('<code>/eth/v1/node/syncing</code> 显示 <code>is_syncing: false</code> 和 <code>is_optimistic: true</code>。这是什么情况？', '<code>/eth/v1/node/syncing</code> shows <code>is_syncing: false</code> and <code>is_optimistic: true</code>. What does it mean?'),
            options: [LL('一切正常', 'Everything is healthy'), LL('beacon 节点已跟上链头，执行客户端还没同步完，验证者还不能工作', 'The beacon node is at the head but the execution client has not finished syncing, so the validator cannot work yet'), LL('beacon 节点正在从创世同步', 'The beacon node is syncing from genesis')], answer: 1,
            why: LL('optimistic 表示区块的执行部分还没有被验证。', 'Optimistic means the execution part of the blocks has not been verified yet.') },
        ],
      },
    ],
  });

  /* ==========================================================
     Step 2: run a validator on Hoodi (guided lab R1)
     ========================================================== */
  const H = () => S.networks.ethereum.helpers;
  const START = '2026-10-22T08:00:00Z';
  const TS = Math.floor(Date.parse(START) / 1000) + 1380;
  const WALLET = '0x3c1e5a7b9d0f2a4c6e8b1d3f5a7c9e0b2d4f6a81';
  const PASS = 'hoodi-lab-passphrase';
  const KS = `keystore-m_12381_3600_0_0_0-${TS}`, DD = `deposit_data-${TS}.json`;
  const PK = H().keyFor('laptop', 'hoodi');
  const KIT = '/home/ubuntu/hoodi-kit';
  const RPC = `curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}' localhost:8545 | jq .result`;
  const N = w => w.nodes['eth-new'];
  const myVal = w => w.chain.vals.find(v => v.pubkey === PK);
  const hits = w => { const v = myVal(w); return v ? v.hist.filter(x => x.hit && x.by === 'eth-new').length : 0; };

  S.registerScenario({
    id: 'eth-run', network: 'ethereum', module: MOD, lab: 'R1', minutes: 25,
    title: LL('在 Hoodi 上运行一个验证者', 'Run a validator on Hoodi'),
    tagline: LL('在一台全新的 Ubuntu 主机上装好 Besu 和 Teku，在工作电脑上生成钥匙、存款，直到第一批证明被打包。', 'Install Besu and Teku on a new Ubuntu host, generate keys and deposit from your workstation, and see the first attestations included.'),
    learn: [
      LL('执行客户端、beacon 节点和验证者客户端如何组成一个节点，以及共享的 JWT 密钥', 'How the execution client, beacon node and validator client make up one node, and the shared JWT secret'),
      LL('checkpoint sync、optimistic 状态和同步进度的读法', 'Checkpoint sync, the optimistic state, and how to read sync progress'),
      LL('在工作电脑上生成钥匙，存款，看着验证者从排队到激活', 'Generating keys on the workstation, depositing, and following the validator from the queue to active'),
    ],
    brief: LL(
      `<p><b>eth-new</b> 是一台刚开出来的 Ubuntu 主机（<code>ssm eth-new</code>），已经装好 Java 21，建好了系统用户 besu、teku 和 <code>/var/lib</code> 下的数据目录，<code>/var/lib</code> 挂在一块单独的 NVMe 上。<code>${KIT}</code> 里有为这台主机准备好的 systemd 单元文件。客户端还没有安装。</p>
<p>工作电脑上有 ethstaker 的 staking deposit CLI（命令 <code>deposit</code>），一个装有测试网 ETH 的钱包 <code>${WALLET}</code>，以及 <code>launchpad</code>：本课程的辅助命令，代替 Hoodi Launchpad 网页发送存款。两台机器之间用 S3 桶 <code>s3://example-eth-ops/</code> 传文件。</p>
<p>目标：在 Hoodi 测试网上从零运行一个验证者，直到它的证明被打包。同步和激活排队在模拟里被压缩了，等待时可以用右上角加快模拟时钟。</p>`,
      `<p><b>eth-new</b> is a newly launched Ubuntu host (<code>ssm eth-new</code>). It has Java 21, the system users besu and teku, and the data directories under <code>/var/lib</code>, which sits on its own NVMe volume. <code>${KIT}</code> holds systemd unit files prepared for this host. The clients are not installed yet.</p>
<p>Your workstation has the ethstaker staking deposit CLI (the <code>deposit</code> command), a wallet <code>${WALLET}</code> funded with testnet ETH, and <code>launchpad</code>: a course helper that stands in for the Hoodi Launchpad web page and sends the deposit. Files move between the two machines through the S3 bucket <code>s3://example-eth-ops/</code>.</p>
<p>The goal: run a validator on the Hoodi testnet from scratch until its attestations are included. Sync and the activation queue are compressed in the simulator; speed up the clock at the top right while you wait.</p>`),
    startAt: START,
    config: { fresh: true, network: 'hoodi', keyTs: TS, wallet: WALLET, planIndex: 1293417, hosts: [{ id: 'eth-new' }] },
    laptopCommands: { deposit: ctx => H().depositCli(ctx), launchpad: ctx => H().launchpad(ctx) },
    steps: [
      {
        text: LL('检查主机，打开 P2P 端口', 'Check the host and open the P2P ports'),
        how: LL('登录新主机，确认 <code>/var/lib</code> 有足够空间、系统时钟已同步（System clock synchronized 必须是 yes）。然后放行入站 P2P 端口：Besu 的 30303、Teku 的 9000，以及 Teku QUIC 用的 9001/udp。不写协议时，ufw 同时放行 TCP 和 UDP。',
          'Log in to the new host and check that <code>/var/lib</code> has room and that the clock is synchronized (System clock synchronized must be yes). Then open the inbound P2P ports: 30303 for Besu, 9000 for Teku, and 9001/udp for Teku\'s QUIC. Without a protocol, ufw allows both TCP and UDP.'),
        cmds: [
          'ssm eth-new',
          'sudo -i',
          'df -h /var/lib',
          'timedatectl',
          'ufw status',
          'ufw allow 30303',
          'ufw allow 9000',
          'ufw allow 9001/udp',
          'ufw status',
        ],
        after: LL('验证者对时间敏感：证明要在 slot 开始后 4 秒内发出，时钟偏差几秒就会错过。入站 P2P 端口决定了别的节点能否连进来，开放后对等节点更多，区块和证明到得更早。（第 1 章）', 'A validator is time-sensitive: attestations go out within 4 seconds of the slot start, and a clock a few seconds off misses them. Inbound P2P ports decide whether other nodes can connect in; with them open there are more peers, and blocks and attestations arrive sooner. (Chapter 1)'),
        check: w => H().fwOpen(N(w), 30303) && H().fwOpen(N(w), 9000) && H().fwOpen(N(w), 9001, 'udp'),
      },
      {
        text: LL('生成 Engine API 的 JWT 密钥', 'Create the Engine API JWT secret'),
        how: LL('Besu 和 Teku 用同一个 32 字节的密钥认证 Engine API。只生成一次：两个客户端在启动时读取它，之后再改，两边就对不上了。',
          'Besu and Teku authenticate the Engine API with the same 32-byte secret. Create it once: both clients read it when they start, and changing it later leaves them out of step.'),
        cmds: [
          'mkdir -p /etc/ethereum',
          'openssl rand -hex 32 > /etc/ethereum/jwt.hex',
          'chmod 644 /etc/ethereum/jwt.hex',
          'cat /etc/ethereum/jwt.hex',
        ],
        after: LL('这 32 个字节是 Besu 和 Teku 之间唯一的凭证。Engine API 的每个请求都带一个用它签名的 JWT，Besu 拒绝签名不对的请求。（第 1 章）', 'These 32 bytes are the only credential between Besu and Teku. Every Engine API request carries a JWT signed with them, and Besu rejects any request signed with something else. (Chapter 1)'),
        check: w => /^[0-9a-f]{64}\s*$/i.test(S.fsRead(w, N(w), '/etc/ethereum/jwt.hex') || ''),
      },
      {
        text: LL('安装并启动 Besu', 'Install and start Besu'),
        how: LL('下载并解压 Besu，读一遍单元文件，注意 <code>--network=hoodi</code> 和 <code>--engine-jwt-secret</code>，然后安装并启动服务。',
          'Download and unpack Besu, and read the unit file, noting <code>--network=hoodi</code> and <code>--engine-jwt-secret</code>. Then install and start the service.'),
        cmds: [
          'curl -fsSL -o /tmp/besu.tar.gz https://github.com/hyperledger/besu/releases/download/26.9.0/besu-26.9.0.tar.gz',
          'mkdir -p /opt/besu',
          'tar xzf /tmp/besu.tar.gz -C /opt/besu --strip-components=1',
          `cat ${KIT}/besu.service`,
          `cp ${KIT}/besu.service /etc/systemd/system/`,
          'systemctl enable --now besu',
          'journalctl -u besu -n 20 --no-pager',
        ],
        wait: 60,
        after: LL('Besu 已经启动，但还不会同步：合并之后，执行客户端要由 beacon 节点告诉它链头在哪里。在此之前，它每两分钟记录一次没有被共识客户端调用。生产环境还应校验下载文件的 SHA-256。（第 1 章、第 7 章）', 'Besu is up but does not sync yet: since the Merge the execution client needs the beacon node to tell it where the head is. Until then it logs every two minutes that the consensus client has not called it. In production, also verify the download\'s SHA-256. (Chapters 1 and 7)'),
        check: w => { const el = N(w).eth.c.el; return !!el && H().ready(w, el); },
      },
      {
        text: LL('安装并启动 Teku beacon 节点', 'Install and start the Teku beacon node'),
        how: LL('下载并解压 Teku。单元文件里有 <code>--ee-jwt-secret-file</code>（与 Besu 同一个文件）和 <code>--checkpoint-sync-url</code>。读一遍，然后安装并启动 beacon 节点。',
          'Download and unpack Teku. The unit file has <code>--ee-jwt-secret-file</code> (the same file as Besu) and <code>--checkpoint-sync-url</code>. Read it, then install and start the beacon node.'),
        cmds: [
          'curl -fsSL -o /tmp/teku.tar.gz https://artifacts.consensys.net/public/teku/raw/names/teku.tar.gz/versions/26.9.0/teku-26.9.0.tar.gz',
          'mkdir -p /opt/teku',
          'tar xzf /tmp/teku.tar.gz -C /opt/teku --strip-components=1',
          `cat ${KIT}/teku-beacon.service`,
          `cp ${KIT}/teku-beacon.service /etc/systemd/system/`,
          'systemctl enable --now teku-beacon',
          'journalctl -u teku-beacon -n 20 --no-pager',
        ],
        wait: 60,
        after: LL('日志里的 "Loaded initial state at epoch …" 说明 beacon 节点是从 checkpoint 启动的，而不是从创世。Engine API 认证通过后，它开始把区块交给 Besu，Besu 也就有了同步目标。（第 7 章）', '"Loaded initial state at epoch …" in the log means the beacon node started from a checkpoint, not from genesis. Once the Engine API authenticates, it starts handing blocks to Besu, and Besu has a sync target. (Chapter 7)'),
        check: w => { const n = N(w), cl = n.eth.c.cl; return !!cl && H().ready(w, cl) && !!n.eth.cpFrom && H().engineOk(n); },
      },
      {
        text: LL('等两个客户端都同步完成', 'Wait until both clients are in sync'),
        how: LL('beacon 节点的同步状态看 <code>is_syncing</code>、<code>is_optimistic</code> 和 <code>el_offline</code>；Besu 的 <code>eth_syncing</code> 同步时返回进度对象，完成后返回 false。把本地的 finalized 根和独立来源核对，确认 checkpoint 可信，再看一眼磁盘。Besu 同步约需 20 分钟模拟时间。',
          'For the beacon node, read <code>is_syncing</code>, <code>is_optimistic</code> and <code>el_offline</code>. Besu\'s <code>eth_syncing</code> returns a progress object while syncing and false when done. Compare the local finalized root with an independent source to trust the checkpoint, and check the disk. Besu takes about 20 simulated minutes.'),
        cmds: [
          'curl -s localhost:5051/eth/v1/node/syncing | jq .data',
          RPC,
          'curl -s localhost:5051/eth/v1/beacon/headers/finalized | jq .data.root',
          'curl -s https://checkpoint-sync.hoodi.ethpandaops.io/eth/v1/beacon/headers/finalized | jq .data.root',
          'df -h /var/lib',
        ],
        wait: 1500,
        after: LL('beacon 节点几分钟就跟上了链头，但在 Besu 完成之前一直是 optimistic，告警 EthExecutionNotSynced 会在这段时间出现，同步完成后自行恢复。只有 is_syncing 和 is_optimistic 都为 false、el_offline 为 false，节点才能支撑验证者工作。（第 7 章）', 'The beacon node reached the head within minutes but stayed optimistic until Besu finished; EthExecutionNotSynced fires meanwhile and clears by itself once sync completes. Only with is_syncing, is_optimistic and el_offline all false can the node support a validator. (Chapter 7)'),
        check: w => { const n = N(w), V = H().view(w, n); return V.clUp && !V.syncing && !V.elOffline && !H().elSyncing(n); },
      },
      {
        text: LL('在工作电脑上生成钥匙', 'Generate the keys on your workstation'),
        how: LL('回到工作电脑，直到提示符是 ops@laptop：助记词不能出现在服务器上。生成助记词、keystore 和存款数据，取款地址设为你的钱包，然后检查结果。（在真实的机器上，不要把密码写在命令行里，在提示时输入。）',
          'Go back to the workstation until the prompt reads ops@laptop: the mnemonic must never appear on the server. Generate the mnemonic, keystore and deposit data with your wallet as the withdrawal address, then check the result. (On a real machine, leave the password off the command line and type it at the prompt.)'),
        cmds: [
          'exit',
          'exit',
          `deposit --non_interactive new-mnemonic --num_validators 1 --chain hoodi --withdrawal_address ${WALLET} --keystore_password ${PASS}`,
          'ls ~/validator_keys',
          `jq '.[0] | {pubkey, withdrawal_credentials, network_name, fork_version}' ~/validator_keys/${DD}`,
        ],
        after: LL('助记词只出现在工作电脑的屏幕上。withdrawal_credentials 以 01 开头，后面是你的钱包地址：余额最终会回到这个地址。fork_version 把存款签名绑定到 Hoodi，同一份存款数据在其他网络上无效。（第 6 章）', 'The mnemonic appeared only on the workstation\'s screen. withdrawal_credentials starts with 01 followed by your wallet address: the balance will eventually go back there. fork_version binds the deposit signature to Hoodi, so the same deposit data is invalid on any other network. (Chapter 6)'),
        check: w => Object.values(w.chain.keygen || {}).some(k => k.laptop && k.chain === 'hoodi' && !!S.fsGet(w.laptop, k.ks)),
      },
      {
        text: LL('存入 32 ETH（测试网）', 'Deposit 32 ETH (testnet)'),
        how: LL('真实环境里，这一步在 Hoodi Launchpad 网页上完成：上传存款数据文件，用钱包签名发送。本课程用辅助命令 <code>launchpad</code> 代替网页，它做同样的检查，然后从你的钱包发出交易。',
          'For real, this step happens on the Hoodi Launchpad web page: upload the deposit data file and send the transaction from your wallet. The course replaces the page with the helper <code>launchpad</code>, which runs the same checks and then sends the transaction from your wallet.'),
        cmds: [
          `launchpad deposit --network hoodi --deposit-data ~/validator_keys/${DD}`,
        ],
        after: LL('ETH 已经进了存款合约，但信标链还不知道这个验证者：要等存款所在的区块被最终确定，再等存款队列轮到它。现在查询这个公钥会得到 404。（第 6 章）', 'The ETH is in the deposit contract, but the beacon chain does not know the validator yet: the block holding the deposit must be finalized first, and then the deposit queue must reach it. A lookup for the pubkey returns 404 for now. (Chapter 6)'),
        check: w => !!(w.chain.deposits || {})[PK],
      },
      {
        text: LL('把 keystore 导入验证者客户端并启动', 'Import the keystore into the validator client and start it'),
        how: LL('在工作电脑上只上传加密的 keystore，再在服务器上把它放进钥匙目录。Teku 在每个 keystore 旁边找同名的 .txt 密码文件。这是一把新钥匙，slashing 保护数据库应该是空的。最后安装并启动验证者客户端。',
          'From the workstation, upload only the encrypted keystore, then put it in the key directory on the server. Teku expects a .txt password file with the same name next to each keystore. This is a new key, so the slashing protection database should be empty. Finally install and start the validator client.'),
        cmds: [
          `aws s3 cp ~/validator_keys/${KS}.json s3://example-eth-ops/hoodi/`,
          'ssm eth-new',
          'sudo -i',
          `aws s3 cp s3://example-eth-ops/hoodi/${KS}.json /var/lib/teku-vc/validator-keys/`,
          `echo '${PASS}' > /var/lib/teku-vc/validator-keys/${KS}.txt`,
          'ls /var/lib/teku-vc/validator/slashprotection',
          `cp ${KIT}/teku-vc.service /etc/systemd/system/`,
          'systemctl enable --now teku-vc',
          'journalctl -u teku-vc -n 10 --no-pager',
        ],
        wait: 60,
        after: LL('服务器上只有 keystore 和它的密码，助记词和存款数据留在工作电脑上。新钥匙从空的保护数据库开始是对的；如果这把钥匙曾在别处签过名，就必须先导入那边的 EIP-3076 记录（练习 E3）。doppelganger 检测会先观察两个 epoch。（第 5 章）', 'The server holds only the keystore and its password; the mnemonic and the deposit data stay on the workstation. A new key correctly starts with an empty protection database; a key that has signed elsewhere needs that machine\'s EIP-3076 history imported first (lab E3). Doppelganger detection watches for two epochs first. (Chapter 5)'),
        check: w => { const vc = N(w).eth.c.vc; return !!vc && H().ready(w, vc) && (vc.keys || []).includes(PK); },
      },
      {
        text: LL('等待激活', 'Wait for activation'),
        how: LL('向 beacon 节点查询这个公钥：存款被处理之前是 404，之后状态依次是 pending_initialized、pending_queued，最后 active_ongoing。验证者客户端会在日志里记录每次变化。在模拟里约需 75 分钟。',
          'Ask the beacon node for the pubkey: it returns 404 until the deposit is processed, then the status moves through pending_initialized and pending_queued to active_ongoing. The validator client logs each change. It takes about 75 simulated minutes.'),
        cmds: [
          `curl -s localhost:5051/eth/v1/beacon/states/head/validators/${PK}`,
          'journalctl -u teku-vc -n 5 --no-pager',
        ],
        wait: 4500,
        after: LL('activation_eligibility_epoch 和 activation_epoch 依次被填上。激活 epoch 一到，验证者就有了证明任务，从此离线就会被扣罚。主网上排队可能要几天或几周，取决于 churn 限额前面排了多少质押。（第 6 章）', 'activation_eligibility_epoch and then activation_epoch were filled in. From the activation epoch on, the validator has attestation duties, and from now on being offline costs money. On mainnet the queue can take days or weeks, depending on how much stake waits ahead of the churn limit. (Chapter 6)'),
        check: w => { const v = myVal(w); return !!v && H().statusOf(w, v) === 'active_ongoing'; },
      },
      {
        text: LL('确认最初的几次证明被按时打包', 'Confirm the first attestations are included on time'),
        how: LL('在验证者客户端日志里找 "Published attestation"。在区块浏览器的记录里，inclusionslot 应该是 attesterslot + 1。beacon 节点的完整记录里有激活 epoch 和余额，余额每个 epoch 增加一点。连续三次按时打包即完成，大约需要三个 epoch。',
          'Look for "Published attestation" in the validator client log. In the block explorer\'s record, inclusionslot should be attesterslot + 1. The beacon node\'s full record shows the activation epoch and the balance, which rises a little each epoch. Three included attestations complete the lab, which takes about three epochs.'),
        cmds: [
          'journalctl -u teku-vc -n 10 --no-pager',
          `curl -s https://hoodi.beaconcha.in/api/v1/validator/${PK}/attestations | jq .data[0]`,
          `curl -s localhost:5051/eth/v1/beacon/states/head/validators/${PK} | jq .data`,
        ],
        wait: 1200,
        after: LL('每个 epoch 一次证明，下一个 slot 被打包，余额每次增加一点。从现在起要监控的是：证明是否按时（效率）、两个客户端是否同步、对等节点数和磁盘。（第 2 章、第 4 章）', 'One attestation per epoch, included in the next slot, and the balance rising a little each time. From now on, monitor whether attestations are on time (effectiveness), whether both clients are in sync, the peer counts, and the disk. (Chapters 2 and 4)'),
        check: w => { const v = myVal(w); return !!v && hits(w) >= 3 && v.hist[v.hist.length - 1].hit; },
      },
    ],
    forbidden: [
      { flag: 'keys_on_server', text: LL('在验证者服务器上生成助记词和钥匙', 'Generating the mnemonic and keys on the validator server') },
      { flag: 'jwt_mismatch', text: LL('让 beacon 节点使用一个 Besu 不认可的 JWT 密钥运行（Engine API 拒绝每个请求）', 'Running the beacon node with a JWT secret that Besu does not use (the Engine API rejects every request)') },
    ],
    hints: [],
    limit: 10 * 3600,
    score: w => {
      const v = myVal(w), d = v && v.bal0 ? (v.bal - v.bal0) / 1e9 : 0, miss = v ? v.hist.filter(x => !x.hit).length : 0;
      return [
        [LL('按时打包的证明', 'Attestations included'), String(hits(w)), hits(w) >= 3 ? 'good' : 'mid'],
        [LL('错过的证明', 'Attestations missed'), String(miss), miss ? 'mid' : 'good'],
        [LL('激活后余额变化', 'Balance change since activation'), `${d >= 0 ? '+' : ''}${d.toFixed(6)} ETH`, d >= 0 ? 'good' : 'mid'],
      ];
    },
    debrief: LL(
      '一个以太坊验证者是三个进程：执行客户端、beacon 节点和验证者客户端。前两个通过 Engine API 相连，靠同一个 JWT 密钥认证；验证者客户端只通过 beacon 节点的 REST API 工作，钥匙只在它那里。新节点用 checkpoint sync 在几分钟内追上共识层，但在执行客户端同步完成之前一直是 optimistic，不能用于签名。钥匙在工作电脑上生成，服务器只拿到加密的 keystore 和密码；助记词控制取款凭证，从不接触服务器。存款之后，信标链要等存款区块被最终确定、存款队列轮到它，再经过资格确认和激活等待，验证者才开始工作。激活之后，运维的重点变成持续的监控：证明是否按时、两个客户端是否同步、对等节点和磁盘，以及在迁移钥匙时保证任何时候只有一个签名方。',
      'An Ethereum validator is three processes: the execution client, the beacon node and the validator client. The first two are joined by the Engine API and authenticate with the same JWT secret; the validator client works only through the beacon node\'s REST API, and it alone holds the keys. A new node catches up on the consensus side in minutes with checkpoint sync, but stays optimistic, and unusable for signing, until the execution client has synced. Keys are generated on a workstation, and the server receives only the encrypted keystore and its password; the mnemonic controls the withdrawal credentials and never touches the server. After the deposit, the beacon chain waits for the deposit block to finalize and for the deposit queue, then for eligibility and the activation delay, before the validator starts working. Once it is active, the work becomes steady monitoring: attestations on time, both clients in sync, peers and disk, and, whenever a key moves, exactly one signer at any moment.'),
  });
})(SIM);
