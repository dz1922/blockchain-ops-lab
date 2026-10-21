/* ============================================================
   UI: course landing, terminal, side panels, briefing / review.
   All interface text lives in T (zh / en).
   ============================================================ */
(function (S) {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'vsim.v1';
  const store = { get() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }, set(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* private mode */ } } };
  const tr = S.tr;

  const T = {
    brand: { zh: '<b>验证者运维实验室</b> · Validator Operations Lab', en: '<b>Validator Operations Lab</b>' },
    heroTitle: { zh: '验证者运维实验室', en: 'Validator Operations Lab' },
    heroLead: {
      zh: '在浏览器里练习运行区块链验证者。每个练习给你一组节点、一条持续运行的链，以及和生产环境一样会触发的告警。你在终端里排查和修复，右侧面板显示每一步操作在协议层面的效果。',
      en: 'Practise running blockchain validators in your browser. Each lab gives you a set of nodes, a running chain, and alerts that fire the way they do in production. You investigate and fix things from a terminal while the panel on the right shows what each step does at the protocol level.',
    },
    heroMeta: { zh: ['{labs} 个练习', '{nets} 个网络', '无需安装，进度保存在本浏览器'], en: ['{labs} labs', '{nets} networks', 'Nothing to install; progress stays in this browser'] },
    howTitle: { zh: '练习方式', en: 'How the labs work' },
    how: {
      zh: [['终端', '命令和输出与生产环境一致：systemctl、journalctl、curl 和各条链的 CLI。权限、区域或集群用错了，会得到和真实环境一样的报错。'],
        ['持续运行的链', '模拟时钟可以加速。区块、epoch、在线率和余额都随时间推进，拖延会产生实际的代价。'],
        ['告警与值班', '告警规则沿用生产环境的名称和阈值。critical 告警 10 分钟内没有确认，会呼叫值班电话。'],
        ['复盘', '每个练习结束后给出评分，列出你遇到的协议机制，并介绍它所参考的真实事故。']],
      en: [['A terminal', 'Commands and output follow production: systemctl, journalctl, curl and each chain\'s CLI. The wrong permissions, region or cluster fail the way they would for real.'],
        ['A chain that keeps moving', 'The simulated clock can run faster. Blocks, epochs, uptime and balances advance with time, so waiting has a cost.'],
        ['Alerts and paging', 'Alert rules use production names and thresholds. A critical alert that is not acknowledged within 10 minutes pages the on-call phone.'],
        ['A review', 'Each lab ends with a score, the protocol mechanics you ran into, and the real incident it is based on.']],
    },
    moduleDesc: {
      avalanche: { zh: 'Primary Network 验证者：avalanchego 的进程与配置、数据库版本、网络升级、P-Chain 在线率与奖励门槛。', en: 'Primary Network validators: the avalanchego process and its config, database versions, network upgrades, P-Chain uptime and the reward threshold.' },
      solana: { zh: 'Agave 验证者：slot 与 epoch、投票交易与手续费、delinquent 的判定、identity 与备用机。', en: 'Agave validators: slots and epochs, vote transactions and their fees, delinquency, identities and standby machines.' },
    },
    labWord: { zh: '练习', en: 'Lab' },
    difficulty: { zh: '难度', en: 'Difficulty' },
    minutes: { zh: '约 {n} 分钟', en: 'about {n} min' },
    youPractise: { zh: '你将练习', en: 'You will practise' },
    plannedTitle: { zh: '计划中的模块', en: 'Planned modules' },
    planned: { zh: '规划中', en: 'planned' },
    fwTitle: { zh: '课程如何扩展', en: 'How the labs are built' },
    fw: {
      zh: '每个网络是一个独立模块，描述这个网络的机制、节点、命令、API 和告警规则。每个练习都是纯数据：初始状态、故障、目标、提示和复盘。增加网络或练习，不需要改动其他部分。',
      en: 'Each network is a self-contained module that describes its mechanics, nodes, commands, APIs and alert rules. Each lab is plain data: a starting state, faults, goals, hints and a review. Adding a network or a lab does not require changes anywhere else.',
    },
    foot: { zh: '练习中的主机、地址和身份均为虚构。', en: 'All hosts, addresses and identities in these labs are fictional.' },
    back: { zh: '← 全部练习', en: '← All labs' },
    hint: { zh: '提示', en: 'Hint' },
    briefing: { zh: '说明', en: 'Briefing' },
    hMech: { zh: '链上状态', en: 'Chain state' },
    hAlerts: { zh: '告警', en: 'Alerts' },
    hGoals: { zh: '目标', en: 'Goals' },
    hFeed: { zh: '事件记录', en: 'Event log' },
    newest: { zh: '最新在上', en: 'newest first' },
    busy: { zh: '（命令运行中，Ctrl+C 中断）', en: '(running; Ctrl+C to interrupt)' },
    paused: { zh: '已暂停', en: 'paused' },
    pause: { zh: '暂停', en: 'Pause' },
    speedTitle: { zh: '1 秒等于 {n} 秒模拟时间', en: '1 second = {n} simulated seconds' },
    firingN: { zh: '{n} 组告警', en: '{n} firing' },
    quiet: { zh: '无告警', en: 'quiet' },
    noAlerts: { zh: '目前没有告警。', en: 'No alerts firing.' },
    resolved: { zh: '已恢复', en: 'Resolved' },
    firingFor: { zh: '节点数 {n} · 已持续 {d}', en: 'Instances {n} · firing for {d}' },
    ack: { zh: '确认', en: 'Acknowledge' },
    acked: { zh: '已确认', en: 'Acknowledged' },
    paged: { zh: '已呼叫 {n} 次', en: 'paged {n} times' },
    pagesIn: { zh: '{d} 后呼叫值班', en: 'pages in {d}' },
    doNot: { zh: '不要做', en: 'Do not' },
    hold: { zh: '保持 {n} 秒（模拟时间）以确认稳定', en: 'Holding for {n} simulated seconds to confirm' },
    noEvents: { zh: '还没有事件。', en: 'Nothing yet.' },
    goals: { zh: '目标', en: 'Goals' },
    howToPlay: {
      zh: '你在自己的工作电脑上。<code>help</code> 列出命令，<code>hint</code> 给出提示，<code>objectives</code> 显示目标，<code>ssm &lt;节点名&gt;</code> 登录节点。右上角可以调整模拟速度。',
      en: 'You are on your own workstation. <code>help</code> lists the commands, <code>hint</code> gives a hint, <code>objectives</code> shows the goals, and <code>ssm &lt;node&gt;</code> logs in to a node. Change the simulation speed at the top right.',
    },
    start: { zh: '开始（10× 速度）', en: 'Start (10× speed)' },
    cont: { zh: '继续', en: 'Continue' },
    restart: { zh: '重新开始', en: 'Restart' },
    rDone: { zh: '练习完成', en: 'Lab complete' },
    rViol: { zh: '目标已达成，但有违规操作', en: 'Goals reached, with a violation' },
    rFail: { zh: '未完成', en: 'Not completed' },
    rows: { zh: ['模拟用时', '值班呼叫次数', '使用提示', '执行命令数'], en: ['Simulated time', 'Pages', 'Hints used', 'Commands run'] },
    violations: { zh: '违规', en: 'Violations' },
    background: { zh: '背景', en: 'Background' },
    mechanics: { zh: '这次遇到的机制', en: 'Mechanics you ran into' },
    again: { zh: '再做一次', en: 'Try again' },
    allLabs: { zh: '返回练习列表', en: 'Back to all labs' },
    toastTitle: { zh: '值班电话正在响', en: 'The pager is ringing' },
    toastBody: { zh: '{name} 尚未确认（第 {n} 次呼叫）。请在右侧告警卡片上点击确认。', en: '{name} has not been acknowledged (page {n}). Acknowledge it on the alert card.' },
    welcome: { zh: 'help 列出命令 · hint 提示 · objectives 目标 · ssm <节点名> 登录节点', en: 'help lists commands · hint for a hint · objectives for goals · ssm <node> to log in' },
  };
  const t = (k, vars) => { let s = tr(T[k]); if (vars && typeof s === 'string') Object.entries(vars).forEach(([a, b]) => { s = s.split(`{${a}}`).join(b); }); return s; };
  const PLANNED = [['Ethereum', '#7cc4ff'], ['XDC', '#9fb38f'], ['Canton', '#9fb38f'], ['Audius', '#9fb38f']];
  const SPEEDS = [1, 10, 60, 600, 3600];
  let w = null, sh = null, speed = 10, paused = true, busy = false, hIdx = 0, lastRender = 0;

  /* ---------- language ---------- */
  function initLang() {
    const q = /[?&]lang=(zh|en)/.exec(location.search);
    let saved = null; try { saved = localStorage.getItem('vsim.lang'); } catch (e) { /* ignore */ }
    S.lang = (q && q[1]) || saved || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
    document.documentElement.lang = S.lang === 'zh' ? 'zh-CN' : 'en';
  }
  function setLang(l) {
    S.lang = l; try { localStorage.setItem('vsim.lang', l); } catch (e) { /* ignore */ }
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    renderChrome();
    if (w) { $('ttl').textContent = `${w.scn.lab} · ${tr(w.scn.title)}`; w.net.panel.mount($('mech'), w); renderSide(true); renderSpeeds(); }
    else renderHome();
  }
  function langSwitch(el) {
    el.innerHTML = `<button data-l="zh" class="${S.lang === 'zh' ? 'on' : ''}">中文</button><button data-l="en" class="${S.lang === 'en' ? 'on' : ''}">EN</button>`;
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.l)));
  }
  function renderChrome() {
    langSwitch($('lang-home')); langSwitch($('lang-play'));
    $('back').textContent = t('back'); $('btn-hint').textContent = t('hint'); $('btn-brief').textContent = t('briefing');
    $('h-mech').textContent = t('hMech'); $('h-alerts').textContent = t('hAlerts'); $('h-goals').textContent = t('hGoals');
    $('h-feed').textContent = t('hFeed'); $('h-feed2').textContent = t('newest'); $('term-busy').textContent = t('busy');
    document.title = w ? `${tr(w.scn.title)} · Validator Operations Lab` : (S.lang === 'zh' ? '验证者运维实验室 · Validator Operations Lab' : 'Validator Operations Lab');
  }

  /* ---------- landing ---------- */
  function renderHome() {
    const done = store.get().done || {};
    $('brand').innerHTML = t('brand');
    const nets = Object.values(S.networks);
    $('hero').innerHTML = `<h1>${t('heroTitle')}</h1><p>${t('heroLead')}</p><div class="meta-line">${tr(T.heroMeta).map(x => `<span>${x.replace('{labs}', S.scenarios.length).replace('{nets}', nets.length)}</span>`).join('')}</div>`;
    $('how').innerHTML = `<h2>${t('howTitle')}</h2><div class="how">${tr(T.how).map(([h, p]) => `<div><h4>${h}</h4><p>${p}</p></div>`).join('')}</div>`;
    $('modules').innerHTML = nets.map(n => {
      const labs = S.scenarios.filter(s => s.network === n.id);
      const mod = labs[0] ? tr(labs[0].module) : n.name;
      return `<section class="module"><div class="module-h"><span class="dot" style="background:${n.color}"></span><h2>${mod}</h2></div><p class="desc">${tr(T.moduleDesc[n.id] || '')}</p>
        <div class="cards">${labs.map(s => {
          const d = done[s.id];
          return `<button class="card" data-s="${s.id}" style="border-top:3px solid ${n.color}">
            ${d ? `<span class="c-done">✔ ${d.grade}</span>` : ''}
            <span class="lab">${t('labWord')} ${s.lab}</span>
            <h3>${tr(s.title)}</h3><p>${tr(s.tagline)}</p>
            <ul>${(s.learn || []).map(x => `<li>${tr(x)}</li>`).join('')}</ul>
            <span class="c-meta"><span>${t('difficulty')} ${'●'.repeat(s.difficulty)}${'○'.repeat(3 - s.difficulty)}</span><span>${t('minutes', { n: s.minutes })}</span></span></button>`;
        }).join('')}</div></section>`;
    }).join('');
    $('modules').querySelectorAll('.card').forEach(c => c.addEventListener('click', () => { location.hash = 's=' + c.dataset.s; }));
    $('planned').innerHTML = `<h2>${t('plannedTitle')}</h2><div class="plan">${PLANNED.map(([n, c]) => `<span class="net-chip soon"><i style="background:${c}"></i>${n} · ${t('planned')}</span>`).join('')}</div>`;
    $('framework').innerHTML = `<h2>${t('fwTitle')}</h2><p style="color:var(--ink-2);max-width:72ch">${t('fw')}</p>`;
    $('foot').textContent = t('foot');
  }

  /* ---------- terminal ---------- */
  const term = {
    write(s) {
      const out = $('term-out');
      const near = out.scrollHeight - out.scrollTop - out.clientHeight < 80;
      out.insertAdjacentHTML('beforeend', S.ansiToHtml(String(s)));
      while (out.childNodes.length > 6000) out.removeChild(out.firstChild);
      if (near) out.scrollTop = out.scrollHeight;
    },
    clear() { $('term-out').innerHTML = ''; },
  };
  function renderPrompt() { $('prompt').innerHTML = S.ansiToHtml(sh.prompt()); }
  function setBusy(b) {
    busy = b;
    $('term-in').style.display = b ? 'none' : 'flex';
    $('term-busy').style.display = b ? 'block' : 'none';
    if (!b) { renderPrompt(); $('cmd').focus(); }
  }
  async function runLine(line) {
    setBusy(true);
    try { await sh.run(line, s => term.write(s)); }
    catch (e) { term.write(`\x1b[31m${e.message}\x1b[0m\n`); }
    setBusy(false);
    renderSide(true);
  }
  function echo(line, suffix = '') {
    $('term-out').insertAdjacentHTML('beforeend', `<span class="t-in">${S.ansiToHtml(sh.prompt())}${S.esc(line)}${suffix}</span>`);
    $('term-out').scrollTop = $('term-out').scrollHeight;
  }
  function commandNames() {
    const h = sh.sess.host, net = w.net;
    const pools = h.kind === 'laptop' ? [net.laptopCommands, w.scn.laptopCommands, S.commands] : [h.commands, net.nodeCommands, S.commands];
    return [...new Set(pools.flatMap(p => Object.keys(p || {}).filter(k => !p[k].hidden)))].sort();
  }
  function complete(input) {
    const v = input.value, m = /(\S*)$/.exec(v), last = m[1], first = !v.slice(0, v.length - last.length).trim();
    let cands;
    if (first && !last.includes('/')) cands = commandNames().filter(c => c.startsWith(last));
    else {
      const slash = last.lastIndexOf('/');
      const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
      const base = slash >= 0 ? last.slice(slash + 1) : last;
      const dir = sh.resolve(dirPart || '.');
      cands = S.fsList(sh.sess.host, dir).filter(n => n.startsWith(base)).map(n => {
        const full = S.norm(dir + '/' + n);
        return dirPart + n + (S.fsIsDir(sh.sess.host, full) && !S.fsGet(sh.sess.host, full) ? '/' : '');
      });
    }
    if (!cands.length) return;
    if (cands.length === 1) { input.value = v.slice(0, v.length - last.length) + cands[0] + (cands[0].endsWith('/') ? '' : ' '); return; }
    let pre = cands[0];
    cands.forEach(c => { while (!c.startsWith(pre)) pre = pre.slice(0, -1); });
    if (pre.length > last.length) input.value = v.slice(0, v.length - last.length) + pre;
    else { echo(v); term.write('\n' + cands.join('  ') + '\n'); }
  }
  function bindTerminal() {
    const input = $('cmd');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const line = input.value; input.value = '';
        echo(line); term.write('\n');
        if (line.trim()) { sh.history.push(line); hIdx = sh.history.length; runLine(line); }
        else renderPrompt();
      } else if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx > 0) { hIdx--; input.value = sh.history[hIdx] || ''; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIdx < sh.history.length) { hIdx++; input.value = sh.history[hIdx] || ''; } }
      else if (e.key === 'Tab') { e.preventDefault(); complete(input); }
      else if (e.key === 'c' && e.ctrlKey) { if (!window.getSelection().toString()) { e.preventDefault(); echo(input.value, '^C'); term.write('\n'); input.value = ''; } }
      else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); term.clear(); }
    });
    document.addEventListener('keydown', e => {
      if (busy && e.key === 'c' && e.ctrlKey && sh) { e.preventDefault(); sh.interrupt(); term.write('^C\n'); }
    });
    $('term-out').addEventListener('mouseup', () => { if (!window.getSelection().toString() && !busy) input.focus(); });
  }

  /* ---------- side panels ---------- */
  function renderSide(force) {
    if (!w) return;
    const now = performance.now();
    if (!force && now - lastRender < 180) return;
    lastRender = now;
    $('clock').textContent = S.fmtClock(w.now()) + (paused ? ` · ${t('paused')}` : '');
    w.net.panel.update($('mech'), w);
    const groups = Object.values(w.groups).filter(g => !g.resolved || w.t - g.resolvedAt < 900)
      .sort((a, b) => (a.resolved - b.resolved) || ((a.sev === 'critical' ? 0 : 1) - (b.sev === 'critical' ? 0 : 1)) || a.firstAt - b.firstAt);
    const firing = groups.filter(g => !g.resolved).length;
    $('al-count').textContent = firing ? t('firingN', { n: firing }) : t('quiet');
    $('alerts').innerHTML = groups.length ? groups.map(g => {
      const inst = Object.values(g.instances);
      const cls = g.resolved ? 'res' : g.sev === 'critical' ? 'crit' : 'warn';
      return `<div class="al ${cls}"><div class="al-h"><span class="sev ${g.sev}">${g.sev}</span><b>${g.name}</b></div>
        ${g.resolved ? `<div class="al-i">${t('resolved')}</div>` : inst.map(i => `<div class="al-i">${S.esc(i.instance)} <span>· ${S.esc(i.summary || '')}</span></div>`).join('')}
        ${!g.resolved ? `<div class="al-f">${t('firingFor', { n: inst.length, d: S.fmtDur(w.t - g.firstAt) })}
          ${g.sev === 'critical' ? (g.acked ? `<span>${t('acked')}</span>` : `<button class="ack" data-ack="${g.name}">${t('ack')}</button>${g.calls ? `<span class="call">${t('paged', { n: g.calls })}</span>` : `<span>${t('pagesIn', { d: S.fmtDur(Math.max(0, 600 - (w.t - g.firstAt))) })}</span>`}`) : ''}</div>` : ''}</div>`;
    }).join('') : `<div class="empty">${t('noAlerts')}</div>`;
    $('alerts').querySelectorAll('[data-ack]').forEach(b => b.addEventListener('click', () => { S.ack(w, b.dataset.ack); renderSide(true); }));
    const os = w.scn.objectives, st = w.objState || [];
    $('obj-count').textContent = `${st.filter(Boolean).length}/${os.length}`;
    const hold = w.scn.holdFor ?? 60;
    $('obj').innerHTML = `<ul>${os.map((o, i) => `<li class="${st[i] ? 'ok' : ''}"><span class="m">${st[i] ? '✔' : '○'}</span><span>${tr(o.text)}</span></li>`).join('')}</ul>
      ${(w.scn.forbidden || []).length ? `<div class="sub">${t('doNot')}</div><ul>${w.scn.forbidden.map(f => `<li class="${w.violations[f.flag] !== undefined ? 'no' : ''}"><span class="m">${w.violations[f.flag] !== undefined ? '✕' : '·'}</span><span>${tr(f.text)}</span></li>`).join('')}</ul>` : ''}
      ${st.length && st.every(Boolean) && !w.done ? `<div class="sub">${t('hold', { n: hold })}</div><div class="hold"><i style="width:${Math.min(100, w.okFor / hold * 100)}%"></i></div>` : ''}`;
    const fmtT = x => S.fmtClock(new Date(w.base + x * 1000)).slice(11, 19);
    $('feed').innerHTML = w.events.slice(-80).reverse().map(e => `<div class="ev ${e.kind}"><span class="t">${fmtT(e.t)}</span><span class="x">${tr(e.html)}</span></div>`).join('') || `<div class="empty">${t('noEvents')}</div>`;
  }
  function renderSpeeds() {
    const opts = [[0, t('pause')]].concat(SPEEDS.map(v => [v, v + '×']));
    $('speeds').innerHTML = opts.map(([v, l]) => `<button data-v="${v}" class="${(paused ? 0 : speed) === v ? 'on' : ''}" title="${v ? t('speedTitle', { n: v }) : t('pause')}">${l}</button>`).join('');
    $('speeds').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const v = +b.dataset.v;
      if (v === 0) paused = true; else { paused = false; speed = v; }
      renderSpeeds(); renderSide(true); $('cmd').focus();
    }));
  }

  /* ---------- briefing / review ---------- */
  function showBrief(first) {
    const s = w.scn, net = w.net;
    $('dlg-brief').innerHTML = `<span class="k" style="color:${net.color}">${t('labWord')} ${s.lab} · ${tr(s.module)}</span><h2>${tr(s.title)}</h2>${tr(s.brief)}
      ${(s.learn || []).length ? `<p><b>${t('youPractise')}</b></p><ul>${s.learn.map(x => `<li>${tr(x)}</li>`).join('')}</ul>` : ''}
      <p><b>${t('goals')}</b></p><ul>${s.objectives.map(o => `<li>${tr(o.text)}</li>`).join('')}</ul>
      ${(s.forbidden || []).length ? `<p><b>${t('doNot')}</b></p><ul>${s.forbidden.map(f => `<li>${tr(f.text)}</li>`).join('')}</ul>` : ''}
      <p style="font-size:.86rem;color:var(--ink-3)">${t('howToPlay')}</p>
      <div class="row"><button class="btn" id="go">${first ? t('start') : t('cont')}</button>${first ? '' : `<button class="btn ghost" id="restart">${t('restart')}</button>`}</div>`;
    $('ov-brief').classList.add('on');
    $('go').addEventListener('click', () => { $('ov-brief').classList.remove('on'); if (first) { paused = false; speed = 10; } renderSpeeds(); $('cmd').focus(); });
    if (!first) $('restart').addEventListener('click', () => { $('ov-brief').classList.remove('on'); start(s.id); });
  }
  function grade(r) {
    if (!r.success) return 'F';
    const extra = r.extra || [];
    const pts = 100 - w.stats.calls * 6 - w.stats.hints * 4 - extra.filter(x => x[2] === 'bad').length * 15 - extra.filter(x => x[2] === 'mid').length * 5;
    return pts >= 92 ? 'S' : pts >= 80 ? 'A' : pts >= 65 ? 'B' : 'C';
  }
  function showDone() {
    const r = w.result, s = w.scn, g = grade(r);
    const d = store.get(); d.done = d.done || {};
    if (r.success) { const prev = d.done[s.id]; if (!prev || 'SABCF'.indexOf(g) < 'SABCF'.indexOf(prev.grade)) d.done[s.id] = { grade: g, at: Date.now() }; store.set(d); }
    const lessons = w.events.filter(e => e.kind === 'lesson');
    const L = tr(T.rows);
    const rows = [[L[0], S.fmtDur(r.t), ''], [L[1], String(w.stats.calls), w.stats.calls ? 'bad' : 'good'], [L[2], `${w.stats.hints} / ${(s.hints || []).length}`, w.stats.hints > 2 ? 'mid' : 'good'], [L[3], String(w.stats.commands), ''], ...r.extra.map(x => [tr(x[0]), x[1], x[2]])];
    $('dlg-done').innerHTML = `<span class="grade ${g}">${g}</span><span class="k">${r.success ? t('rDone') : r.reachedGoal ? t('rViol') : t('rFail')}</span>
      <h2>${t('labWord')} ${s.lab} · ${tr(s.title)}</h2>
      <table class="score">${rows.map(x => `<tr><td>${x[0]}</td><td class="${x[2] || ''}">${x[1]}</td></tr>`).join('')}</table>
      ${Object.keys(w.violations).length ? `<p style="color:var(--red)"><b style="color:var(--red)">${t('violations')}${S.lang === 'zh' ? '：' : ': '}</b>${(s.forbidden || []).filter(f => w.violations[f.flag] !== undefined).map(f => tr(f.text)).join(S.lang === 'zh' ? '；' : '; ')}</p>` : ''}
      <p><b>${t('background')}</b></p><p>${tr(s.debrief) || ''}</p>
      ${lessons.length ? `<p><b>${t('mechanics')}</b></p><ul>${lessons.map(l => `<li>${tr(l.html)}</li>`).join('')}</ul>` : ''}
      <div class="row"><button class="btn" id="again">${t('again')}</button><button class="btn ghost" id="list">${t('allLabs')}</button></div>`;
    $('ov-done').classList.add('on');
    $('again').addEventListener('click', () => { $('ov-done').classList.remove('on'); start(s.id); });
    $('list').addEventListener('click', () => { $('ov-done').classList.remove('on'); location.hash = ''; });
  }
  function toast(html) {
    const el = $('toast'); el.innerHTML = html; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 7000);
  }

  /* ---------- lifecycle ---------- */
  function start(id) {
    const scn = S.scenarios.find(s => s.id === id);
    if (!scn) { location.hash = ''; return; }
    w = S.createWorld(scn);
    sh = new S.Shell(w, term);
    paused = true; speed = 10; hIdx = 0;
    $('home').style.display = 'none'; $('play').classList.add('on');
    $('ttl').textContent = `${scn.lab} · ${tr(scn.title)}`; $('ttl-dot').style.background = w.net.color; $('mech-net').textContent = w.net.name;
    w.net.panel.mount($('mech'), w);
    S.tick(w, 0.01);
    term.clear();
    term.write(`\x1b[90m# ${t('labWord')} ${scn.lab} · ${tr(scn.title)}\n# ${t('welcome')}\x1b[0m\n\n`);
    renderChrome(); setBusy(false); renderSpeeds(); renderSide(true);
    showBrief(true);
  }
  function goHome() {
    w = null; sh = null; paused = true;
    $('play').classList.remove('on'); $('home').style.display = 'block';
    $('ov-brief').classList.remove('on'); $('ov-done').classList.remove('on');
    renderChrome(); renderHome();
  }
  function route() { const m = /s=([\w-]+)/.exec(location.hash); if (m) start(m[1]); else goHome(); }

  S.on('done', ww => { renderSide(true); setTimeout(() => { if (ww === w && w.result) showDone(); }, 400); });
  S.on('call', (ww, g) => toast(`<b>${t('toastTitle')}</b><br>${t('toastBody', { name: g.name, n: g.calls })}`));
  S.on('tick', () => renderSide(false));

  setInterval(() => { if (w && !paused) S.tick(w, 0.2 * speed); }, 200);

  initLang();
  document.addEventListener('DOMContentLoaded', () => {
    bindTerminal();
    $('back').addEventListener('click', () => { location.hash = ''; });
    $('btn-hint').addEventListener('click', () => { if (!busy) { echo('hint'); term.write('\n'); runLine('hint'); } });
    $('btn-brief').addEventListener('click', () => showBrief(false));
    window.addEventListener('hashchange', route);
    route();
  });

  /* test hook */
  window.VSIM = { S, get w() { return w; }, get sh() { return sh; }, run: runLine, advance: sec => { S.tick(w, sec); renderSide(false); }, start, setLang, begin: () => { $('ov-brief').classList.remove('on'); paused = true; renderSpeeds(); }, get busy() { return busy; } };
})(SIM);
