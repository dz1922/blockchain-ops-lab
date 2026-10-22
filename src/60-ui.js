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
    heroLead2: {
      zh: '每个网络分三步：先用交互式讲解掌握基本概念，再从零运行一个验证者，最后处理来自生产环境的问题。',
      en: 'Each network has three steps: learn the core concepts through interactive explanations, run a validator from scratch, then work through problems taken from production.',
    },
    stepNames: { zh: ['基础知识', '运行验证者', '生产问题挑战'], en: ['Fundamentals', 'Run a validator', 'Production challenges'] },
    stepSubs: {
      zh: ['交互式讲解与小测，不需要终端', '在模拟环境里从零搭建一个验证者，每一步都有指引', '告警已经响了：排查、修复，避开会造成损失的操作'],
      en: ['Interactive explanations and short quizzes; no terminal needed', 'Build a validator from scratch in the simulator, with guidance at every step', 'The alert has fired: investigate, fix, and avoid the moves that cause damage'],
    },
    stepWord: { zh: '第 {n} 步', en: 'Step {n}' },
    netsTitle: { zh: '选择一个网络', en: 'Choose a network' },
    netsSub: { zh: '每个网络都按三步走：基础知识、运行验证者、生产问题挑战。', en: 'Every network follows the same three steps: fundamentals, running a validator, and production challenges.' },
    allNets: { zh: '← 全部网络', en: '← All networks' },
    open: { zh: '进入 →', en: 'Open →' },
    notStarted: { zh: '未开始', en: 'not started' },
    doneWord: { zh: '已完成', en: 'done' },
    nChapters: { zh: '{d}/{n} 章', en: '{d}/{n} chapters' },
    nLabs: { zh: '{d}/{n} 个练习', en: '{d}/{n} labs' },
    netMeta: { zh: '{c} 章基础 · {r} 个引导练习 · {o} 个挑战', en: '{c} chapters · {r} guided lab · {o} challenges' },
    soon: { zh: '这一部分正在编写。', en: 'This part is being written.' },
    chapters: { zh: '{n} 章', en: '{n} chapters' },
    chapterOf: { zh: '第 {i} / {n} 章', en: 'Chapter {i} of {n}' },
    chaptersDone: { zh: '已完成 {d}/{n} 章', en: '{d} of {n} chapters done' },
    basicsWord: { zh: '基础', en: 'Basics' },
    stepsN: { zh: '{n} 个步骤', en: '{n} steps' },
    quizTitle: { zh: '检查一下', en: 'Check your understanding' },
    right: { zh: '回答正确。', en: 'Correct.' },
    wrong: { zh: '不对，再想一想。', en: 'Not quite. Try again.' },
    prev: { zh: '← 上一章', en: '← Previous' },
    next: { zh: '下一章 →', en: 'Next →' },
    toRun: { zh: '下一步：运行验证者 →', en: 'Next: run a validator →' },
    toHome: { zh: '返回这个网络', en: 'Back to this network' },
    lessonDone: { zh: '本节基础知识已全部完成。', en: 'You have finished the fundamentals for this network.' },
    allCourses: { zh: '← 返回', en: '← Back' },
    stepsTitle: { zh: '步骤', en: 'Steps' },
    rRunDone: { zh: '全部步骤完成', en: 'All steps complete' },
    runDoneNext: { zh: '下一步：生产问题挑战', en: 'Next: production challenges' },
    clickToPaste: { zh: '点击命令可以填入终端。', en: 'Click a command to put it in the terminal.' },
    heroMeta: { zh: ['{nets} 个网络', '{lessons} 节基础课', '{labs} 个练习', '无需安装，进度保存在本浏览器'], en: ['{nets} networks', '{lessons} fundamentals courses', '{labs} labs', 'Nothing to install; progress stays in this browser'] },
    howTitle: { zh: '练习环境', en: 'The practice environment' },
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
    back: { zh: '← 返回', en: '← Back' },
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
    allLabs: { zh: '返回这个网络', en: 'Back to this network' },
    toastTitle: { zh: '值班电话正在响', en: 'The pager is ringing' },
    toastBody: { zh: '{name} 尚未确认（第 {n} 次呼叫）。请在右侧告警卡片上点击确认。', en: '{name} has not been acknowledged (page {n}). Acknowledge it on the alert card.' },
    welcome: { zh: 'help 列出命令 · hint 提示 · objectives 目标 · ssm <节点名> 登录节点', en: 'help lists commands · hint for a hint · objectives for goals · ssm <node> to log in' },
  };
  const t = (k, vars) => { let s = tr(T[k]); if (vars && typeof s === 'string') Object.entries(vars).forEach(([a, b]) => { s = s.split(`{${a}}`).join(b); }); return s; };
  const mono = (txt, bg) => `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="${bg}"/><text x="16" y="20.5" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${txt.length > 2 ? 10 : 13}" font-weight="700" fill="#fff">${txt}</text></svg>`;
  const PLANNED = [
    { name: 'Ethereum', logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#627EEA"/><g fill="#fff"><path fill-opacity=".6" d="M16.5 4v8.87l7.5 3.35z"/><path d="M16.5 4 9 16.22l7.5-3.35z"/><path fill-opacity=".6" d="M16.5 21.97V28l7.5-10.38z"/><path d="M16.5 28v-6.03L9 17.62z"/><path fill-opacity=".2" d="m16.5 20.57 7.5-4.35-7.5-3.35z"/><path fill-opacity=".6" d="m9 16.22 7.5 4.35v-7.7z"/></g></svg>' },
    { name: 'XDC', logo: mono('XDC', '#2a5bd7') },
    { name: 'Canton', logo: mono('C', '#3d4a5c') },
    { name: 'Audius', logo: mono('A', '#a21fe0') },
  ];
  let logoSeq = 0;
  // network mark at a given pixel size; plugins without a logo fall back to their colour
  function logo(n, px) {
    const svg = typeof n.logo === 'function' ? n.logo('lg' + (++logoSeq)) : n.logo;
    return `<span class="logo" style="width:${px}px;height:${px}px">${svg || `<i style="background:${n.color}"></i>`}</span>`;
  }
  const SPEEDS = [1, 10, 60, 600, 3600];
  let w = null, sh = null, speed = 10, paused = true, busy = false, hIdx = 0, lastRender = 0;

  /* ---------- language ---------- */
  function initLang() {
    const q = /[?&]lang=(zh|en)/.exec(location.search);
    let saved = null; try { saved = localStorage.getItem('vsim.lang'); } catch (e) { /* ignore */ }
    S.lang = (q && q[1]) || saved || 'en';
    document.documentElement.lang = S.lang === 'zh' ? 'zh-CN' : 'en';
  }
  function setLang(l) {
    S.lang = l; try { localStorage.setItem('vsim.lang', l); } catch (e) { /* ignore */ }
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    renderChrome();
    if (w) { $('ttl').textContent = `${w.scn.lab} · ${tr(w.scn.title)}`; w.net.panel.mount($('mech'), w); renderSide(true); renderSpeeds(); }
    else if (lv) renderChapter();
    else renderHome(homeNet);
  }
  function langSwitch(el) {
    el.innerHTML = `<button data-l="en" class="${S.lang === 'en' ? 'on' : ''}">EN</button><button data-l="zh" class="${S.lang === 'zh' ? 'on' : ''}">中文</button>`;
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.l)));
  }
  function renderChrome() {
    langSwitch($('lang-home')); langSwitch($('lang-play')); langSwitch($('lang-learn')); $('l-back').textContent = t('allCourses');
    $('back').textContent = t('back'); $('btn-hint').textContent = t('hint'); $('btn-brief').textContent = t('briefing');
    $('h-mech').textContent = t('hMech'); $('h-alerts').textContent = t('hAlerts'); $('h-goals').textContent = t('hGoals');
    $('h-feed').textContent = t('hFeed'); $('h-feed2').textContent = t('newest'); $('term-busy').textContent = t('busy');
    document.title = w ? `${tr(w.scn.title)} · Validator Operations Lab` : lv ? `${tr(lv.l.title)} · Validator Operations Lab` : (S.lang === 'zh' ? '验证者运维实验室 · Validator Operations Lab' : 'Validator Operations Lab');
  }

  /* ---------- landing ---------- */
  const lessonProgress = l => { const c = ((store.get().learn || {})[l.id] || {}).c || {}; return l.chapters.filter((_, i) => c[i]).length; };
  function labCard(s, n, done) {
    const d = done[s.id];
    const meta = s.steps ? t('stepsN', { n: s.steps.length }) : `${t('difficulty')} ${'●'.repeat(s.difficulty || 1)}${'○'.repeat(3 - (s.difficulty || 1))}`;
    return `<button class="card" data-s="${s.id}" style="border-top:3px solid ${n.color}">
      ${d ? `<span class="c-done">${d.grade === '✔' ? '✔' : '✔ ' + d.grade}</span>` : ''}
      <span class="lab">${logo(n, 14)}${t('labWord')} ${s.lab}</span>
      <h3>${tr(s.title)}</h3><p>${tr(s.tagline)}</p>
      <ul>${(s.learn || []).map(x => `<li>${tr(x)}</li>`).join('')}</ul>
      <span class="c-meta"><span>${meta}</span><span>${t('minutes', { n: s.minutes })}</span></span></button>`;
  }
  function lessonCard(l, n) {
    const k = lessonProgress(l), N = l.chapters.length;
    return `<button class="card" data-l="${l.id}" style="border-top:3px solid ${n.color}">
      ${k === N ? '<span class="c-done">✔</span>' : ''}
      <span class="lab">${logo(n, 14)}${t('basicsWord')} · ${t('chapters', { n: N })}</span>
      <h3>${tr(l.title)}</h3><p>${tr(l.tagline)}</p>
      <ul>${l.chapters.map(c => `<li>${tr(c.title)}</li>`).join('')}</ul>
      <span class="c-meta" style="display:grid;gap:.45rem"><span class="c-prog"><i style="width:${k / N * 100}%"></i></span><span style="display:flex;gap:1rem"><span>${t('chaptersDone', { d: k, n: N })}</span><span>${t('minutes', { n: l.minutes })}</span></span></span></button>`;
  }
  // per-network progress for the three steps: [[done, total, label], …]
  function netProgress(n, done) {
    const lessons = S.lessons.filter(l => l.network === n.id);
    const run = S.scenarios.filter(s => s.network === n.id && s.track === 'run');
    const ops = S.scenarios.filter(s => s.network === n.id && s.track === 'ops');
    const ch = lessons.reduce((a, l) => a + l.chapters.length, 0), chd = lessons.reduce((a, l) => a + lessonProgress(l), 0);
    return { lessons, run, ops, steps: [[chd, ch, t('nChapters', { d: chd, n: ch })], [run.filter(s => done[s.id]).length, run.length, t('nLabs', { d: run.filter(s => done[s.id]).length, n: run.length })], [ops.filter(s => done[s.id]).length, ops.length, t('nLabs', { d: ops.filter(s => done[s.id]).length, n: ops.length })]] };
  }
  function moduleName(n) { const first = S.scenarios.find(s => s.network === n.id); return first ? tr(first.module) : n.name; }
  function renderHome(netId) {
    const done = store.get().done || {};
    $('brand').innerHTML = t('brand');
    const nets = Object.values(S.networks);
    const net = netId && S.networks[netId];
    ['hero', 'how', 'planned', 'framework'].forEach(id => { $(id).style.display = net ? 'none' : ''; });
    $('foot').textContent = t('foot');
    if (net) { renderNetwork(net, done); return; }
    $('hero').innerHTML = `<h1>${t('heroTitle')}</h1><p>${t('heroLead2')} ${t('heroLead')}</p><div class="meta-line">${tr(T.heroMeta).map(x => `<span>${x.replace('{labs}', S.scenarios.length).replace('{nets}', nets.length).replace('{lessons}', S.lessons.length)}</span>`).join('')}</div>`;
    $('how').innerHTML = `<h2>${t('howTitle')}</h2><div class="how">${tr(T.how).map(([h, p]) => `<div><h4>${h}</h4><p>${p}</p></div>`).join('')}</div>`;
    const names = tr(T.stepNames);
    $('modules').innerHTML = `<section class="home-sec"><h2>${t('netsTitle')}</h2><p class="sec-sub">${t('netsSub')}</p>
      <div class="net-grid">${nets.map(n => {
        const p = netProgress(n, done);
        const all = p.steps.every(([d, tot]) => tot && d === tot);
        return `<button class="net-card" data-n="${n.id}" style="--c:${n.color}">
          <span class="nc-h">${logo(n, 40)}<span><h3>${n.name}</h3><span class="nc-sub">${t('netMeta', { c: p.steps[0][1], r: p.steps[1][1], o: p.steps[2][1] })}</span></span>${all ? '<span class="c-done">✔</span>' : ''}</span>
          <p>${tr(n.desc || '')}</p>
          <ol class="nc-steps">${p.steps.map(([d, tot, label], i) => `<li class="${tot && d === tot ? 'ok' : d ? 'part' : ''}"><span class="m">${tot && d === tot ? '✔' : i + 1}</span><span>${names[i]}</span><span class="v">${tot ? (d ? label : t('notStarted')) : '—'}</span></li>`).join('')}</ol>
          <span class="nc-meta"><span></span><span class="go">${t('open')}</span></span></button>`;
      }).join('')}${PLANNED.filter(p => !nets.some(n => n.name === p.name)).map(p => `<div class="net-card soon"><span class="nc-h">${logo(p, 40)}<span><h3>${p.name}</h3><span class="nc-sub">${t('planned')}</span></span></span></div>`).join('')}</div></section>`;
    $('modules').querySelectorAll('.net-card[data-n]').forEach(c => c.addEventListener('click', () => { location.hash = 'n=' + c.dataset.n; }));
    $('planned').innerHTML = '';
    $('framework').innerHTML = `<h2>${t('fwTitle')}</h2><p style="color:var(--ink-2);max-width:72ch">${t('fw')}</p>`;
  }
  function renderNetwork(n, done) {
    const names = tr(T.stepNames), subs = tr(T.stepSubs);
    const p = netProgress(n, done);
    const soon = `<div class="card soon">${t('soon')}</div>`;
    const steps = [
      [p.lessons.length && p.lessons.every(l => lessonProgress(l) === l.chapters.length), p.lessons.map(l => lessonCard(l, n)).join('') || soon],
      [p.run.length && p.run.every(s => done[s.id]), p.run.map(s => labCard(s, n, done)).join('') || soon],
      [p.ops.length && p.ops.every(s => done[s.id]), p.ops.map(s => labCard(s, n, done)).join('') || soon],
    ];
    $('modules').innerHTML = `<button class="crumb" id="to-nets">${t('allNets')}</button>
      <section class="module"><div class="module-h">${logo(n, 36)}<h2>${moduleName(n)}</h2></div><p class="desc">${tr(n.desc || '')}</p>
      <ol class="path">${steps.map(([ok, cards], i) => `<li class="step ${ok ? 'done' : ''}"><span class="num">${ok ? '✔' : i + 1}</span>
        <div class="step-h"><h3>${t('stepWord', { n: i + 1 })} · ${names[i]}</h3><span>${subs[i]}</span></div>
        <div class="cards">${cards}</div></li>`).join('')}</ol></section>`;
    $('to-nets').addEventListener('click', () => { location.hash = ''; });
    $('modules').querySelectorAll('.card[data-s]').forEach(c => c.addEventListener('click', () => { location.hash = 's=' + c.dataset.s; }));
    $('modules').querySelectorAll('.card[data-l]').forEach(c => c.addEventListener('click', () => { location.hash = 'l=' + c.dataset.l; }));
  }

  /* ---------- lessons (step 1) ---------- */
  let lv = null; // { l, i }
  function lessonState(id) { const d = store.get(); d.learn = d.learn || {}; d.learn[id] = d.learn[id] || { c: {} }; return d; }
  function markChapter(l, i) {
    const d = lessonState(l.id);
    if (d.learn[l.id].c[i]) return;
    d.learn[l.id].c[i] = true; store.set(d); renderLessonNav();
  }
  function renderLessonNav() {
    const { l, i } = lv, c = ((store.get().learn || {})[l.id] || {}).c || {};
    const k = l.chapters.filter((_, j) => c[j]).length;
    $('l-prog').textContent = t('chaptersDone', { d: k, n: l.chapters.length });
    const run = S.scenarios.find(s => s.network === l.network && s.track === 'run');
    $('l-nav').innerHTML = l.chapters.map((ch, j) => `<button data-i="${j}" class="${j === i ? 'on' : ''} ${c[j] ? 'ok' : ''}"><span class="m">${c[j] ? '✔' : String(j + 1).padStart(2, '0')}</span><span>${tr(ch.title)}</span></button>`).join('')
      + (run ? `<button class="next" data-run="${run.id}">${t('toRun')}</button>` : '');
    $('l-nav').querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { location.hash = `l=${l.id}/${b.dataset.i}`; }));
    $('l-nav').querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => { location.hash = 's=' + b.dataset.run; }));
    const on = $('l-nav').querySelector('.on'); if (on && $('l-nav').scrollWidth > $('l-nav').clientWidth) $('l-nav').scrollLeft = on.offsetLeft - 16;
  }
  function renderChapter() {
    S.wg.cleanup();
    const { l, i } = lv, ch = l.chapters[i], N = l.chapters.length, net = S.networks[l.network];
    $('l-ttl').textContent = tr(l.title); $('l-logo').innerHTML = logo(net, 18);
    const quiz = ch.quiz || [];
    const run = S.scenarios.find(s => s.network === l.network && s.track === 'run');
    const last = i === N - 1;
    $('l-main').innerHTML = `<span class="k">${t('chapterOf', { i: i + 1, n: N })}</span><h2>${tr(ch.title)}</h2>
      <div class="lv-body">${tr(ch.body)}</div>
      <div class="wg" id="l-wg"></div>
      ${ch.after ? `<div class="lv-body">${tr(ch.after)}</div>` : ''}
      ${quiz.length ? `<div class="quiz"><h4>${t('quizTitle')}</h4>${quiz.map((q, qi) => `<div class="q" data-q="${qi}"><p>${tr(q.q)}</p><div class="opts">${q.options.map((o, oi) => `<button data-o="${oi}">${tr(o)}</button>`).join('')}</div><div class="why" hidden></div></div>`).join('')}</div>` : ''}
      <div class="lv-pn">${i > 0 ? `<button class="btn ghost" id="l-prev">${t('prev')}</button>` : '<span></span>'}
        ${!last ? `<button class="btn" id="l-next">${t('next')}</button>` : run ? `<button class="btn" id="l-run">${t('toRun')}</button>` : `<button class="btn" id="l-home">${t('toHome')}</button>`}</div>`;
    if (ch.widget) { try { ch.widget($('l-wg')); } catch (e) { console.error(e); } }
    const solved = new Set();
    $('l-main').querySelectorAll('.q').forEach(qe => {
      const q = quiz[+qe.dataset.q];
      qe.querySelectorAll('[data-o]').forEach(b => b.addEventListener('click', () => {
        const ok = +b.dataset.o === q.answer, why = qe.querySelector('.why');
        if (ok) {
          b.classList.add('right'); qe.classList.add('ok'); qe.querySelectorAll('[data-o]').forEach(x => { x.disabled = true; });
          why.innerHTML = `<b style="color:var(--lime)">${t('right')}</b> ${tr(q.why || '')}`; why.hidden = false;
          solved.add(qe.dataset.q); if (solved.size === quiz.length) markChapter(l, i);
        } else { b.classList.add('wrong'); b.disabled = true; why.innerHTML = `<b style="color:var(--red)">${t('wrong')}</b>`; why.hidden = false; }
      }));
    });
    if (!quiz.length) markChapter(l, i);
    renderLessonNav();
    const go = (id, h) => { const e = $(id); if (e) e.addEventListener('click', () => { location.hash = h; }); };
    go('l-prev', `l=${l.id}/${i - 1}`); go('l-next', `l=${l.id}/${i + 1}`); if (run) go('l-run', 's=' + run.id); go('l-home', 'n=' + l.network);
    window.scrollTo(0, 0);
  }
  function openLesson(id, i) {
    const l = S.lessons.find(x => x.id === id);
    if (!l) { location.hash = ''; return; }
    homeNet = l.network;
    leavePlay();
    lv = { l, i: Math.max(0, Math.min(l.chapters.length - 1, i || 0)) };
    $('home').style.display = 'none'; $('learn').classList.add('on');
    renderChrome(); renderChapter();
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
    const hold = w.scn.holdFor ?? 60, steps = w.scn.steps, cur = w.stepIdx || 0;
    const objHtml = steps
      ? `<ul>${steps.map((x, i) => `<li class="${st[i] ? 'ok' : ''} ${!w.done && i === cur ? 'cur' : ''}"><span class="m">${st[i] ? '✔' : i === cur ? '▸' : '○'}</span><span>${i + 1}. ${tr(x.text)}</span>${!w.done && i === cur && x.how ? `<div class="how">${tr(x.how)}</div>` : ''}</li>`).join('')}</ul><div class="sub" style="text-transform:none;letter-spacing:0">${t('clickToPaste')}</div>`
      : `<ul>${os.map((o, i) => `<li class="${st[i] ? 'ok' : ''}"><span class="m">${st[i] ? '✔' : '○'}</span><span>${tr(o.text)}</span></li>`).join('')}</ul>`;
    const objKey = steps ? `${S.lang}|${cur}|${w.done}|${Object.keys(w.violations).length}` : null;
    const objFull = `${objHtml}
      ${(w.scn.forbidden || []).length ? `<div class="sub">${t('doNot')}</div><ul>${w.scn.forbidden.map(f => `<li class="${w.violations[f.flag] !== undefined ? 'no' : ''}"><span class="m">${w.violations[f.flag] !== undefined ? '✕' : '·'}</span><span>${tr(f.text)}</span></li>`).join('')}</ul>` : ''}
      ${!steps && st.length && st.every(Boolean) && !w.done ? `<div class="sub">${t('hold', { n: hold })}</div><div class="hold"><i style="width:${Math.min(100, w.okFor / hold * 100)}%"></i></div>` : ''}`;
    if (!objKey || objKey !== renderSide.objKey) { $('obj').innerHTML = objFull; renderSide.objKey = objKey; }
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
      <p><b>${s.steps ? t('stepsTitle') : t('goals')}</b></p>${s.steps ? `<ol>${s.steps.map(o => `<li>${tr(o.text)}</li>`).join('')}</ol>` : `<ul>${s.objectives.map(o => `<li>${tr(o.text)}</li>`).join('')}</ul>`}
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
    const r = w.result, s = w.scn, g = s.steps ? (r.success ? '✔' : 'F') : grade(r);
    const d = store.get(); d.done = d.done || {};
    if (r.success) { const prev = d.done[s.id]; if (!prev || s.steps || 'SABCF'.indexOf(g) < 'SABCF'.indexOf(prev.grade)) d.done[s.id] = { grade: g, at: Date.now() }; store.set(d); }
    const lessons = w.events.filter(e => e.kind === 'lesson');
    const L = tr(T.rows);
    const rows = [[L[0], S.fmtDur(r.t), ''], [L[1], String(w.stats.calls), w.stats.calls ? 'bad' : 'good'], [L[2], `${w.stats.hints} / ${(s.hints || []).length}`, w.stats.hints > 2 ? 'mid' : 'good'], [L[3], String(w.stats.commands), ''], ...r.extra.map(x => [tr(x[0]), x[1], x[2]])];
    $('dlg-done').innerHTML = `<span class="grade ${g}">${g}</span><span class="k">${r.success ? (s.steps ? t('rRunDone') : t('rDone')) : r.reachedGoal ? t('rViol') : t('rFail')}</span>
      <h2>${t('labWord')} ${s.lab} · ${tr(s.title)}</h2>
      <table class="score">${rows.map(x => `<tr><td>${x[0]}</td><td class="${x[2] || ''}">${x[1]}</td></tr>`).join('')}</table>
      ${Object.keys(w.violations).length ? `<p style="color:var(--red)"><b style="color:var(--red)">${t('violations')}${S.lang === 'zh' ? '：' : ': '}</b>${(s.forbidden || []).filter(f => w.violations[f.flag] !== undefined).map(f => tr(f.text)).join(S.lang === 'zh' ? '；' : '; ')}</p>` : ''}
      <p><b>${t('background')}</b></p><p>${tr(s.debrief) || ''}</p>
      ${lessons.length ? `<p><b>${t('mechanics')}</b></p><ul>${lessons.map(l => `<li>${tr(l.html)}</li>`).join('')}</ul>` : ''}
      <div class="row">${s.steps && r.success ? `<button class="btn" id="list">${t('runDoneNext')}</button><button class="btn ghost" id="again">${t('again')}</button>` : `<button class="btn" id="again">${t('again')}</button><button class="btn ghost" id="list">${t('allLabs')}</button>`}</div>`;
    $('ov-done').classList.add('on');
    $('again').addEventListener('click', () => { $('ov-done').classList.remove('on'); start(s.id); });
    $('list').addEventListener('click', () => {
      $('ov-done').classList.remove('on'); location.hash = 'n=' + s.network;
      if (s.steps && r.success) setTimeout(() => { const c = document.querySelector(`.card[data-s="${s.id}"]`); const st = c && c.closest('.path').children[2]; if (st) st.scrollIntoView({ block: 'start' }); }, 50);
    });
  }
  function toast(html) {
    const el = $('toast'); el.innerHTML = html; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 7000);
  }

  /* ---------- lifecycle ---------- */
  function leaveLesson() { if (lv) { S.wg.cleanup(); lv = null; $('learn').classList.remove('on'); } }
  function leavePlay() { if (w) { w = null; sh = null; paused = true; $('play').classList.remove('on'); $('ov-brief').classList.remove('on'); $('ov-done').classList.remove('on'); } }
  function start(id) {
    const scn = S.scenarios.find(s => s.id === id);
    if (!scn) { location.hash = ''; return; }
    homeNet = scn.network;
    leaveLesson();
    w = S.createWorld(scn);
    renderSide.objKey = null;
    sh = new S.Shell(w, term);
    paused = true; speed = 10; hIdx = 0;
    $('home').style.display = 'none'; $('play').classList.add('on');
    $('ttl').textContent = `${scn.lab} · ${tr(scn.title)}`; $('ttl-logo').innerHTML = logo(w.net, 18); $('mech-net').innerHTML = logo(w.net, 14) + w.net.name;
    w.net.panel.mount($('mech'), w);
    S.tick(w, 0.01);
    term.clear();
    term.write(`\x1b[90m# ${t('labWord')} ${scn.lab} · ${tr(scn.title)}\n# ${t('welcome')}\x1b[0m\n\n`);
    renderChrome(); setBusy(false); renderSpeeds(); renderSide(true);
    showBrief(true);
  }
  let homeNet = null;   // network page to return to from a lesson or lab
  function goHome(netId) {
    leaveLesson();
    homeNet = netId || null;
    w = null; sh = null; paused = true;
    $('play').classList.remove('on'); $('home').style.display = 'block';
    $('ov-brief').classList.remove('on'); $('ov-done').classList.remove('on');
    renderChrome(); renderHome(homeNet);
    window.scrollTo(0, 0);
  }
  function route() {
    const m = /s=([\w-]+)/.exec(location.hash), l = /l=([\w-]+)(?:\/(\d+))?/.exec(location.hash);
    const n = /n=([\w-]+)/.exec(location.hash);
    if (m) start(m[1]); else if (l) openLesson(l[1], +(l[2] || 0)); else goHome(n && S.networks[n[1]] ? n[1] : null);
  }

  S.on('done', ww => { renderSide(true); setTimeout(() => { if (ww === w && w.result) showDone(); }, 400); });
  S.on('call', (ww, g) => toast(`<b>${t('toastTitle')}</b><br>${t('toastBody', { name: g.name, n: g.calls })}`));
  S.on('tick', () => renderSide(false));

  setInterval(() => { if (w && !paused) S.tick(w, 0.2 * speed); }, 200);

  initLang();
  document.addEventListener('DOMContentLoaded', () => {
    bindTerminal();
    $('back').addEventListener('click', () => { location.hash = homeNet ? 'n=' + homeNet : ''; });
    $('l-back').addEventListener('click', () => { location.hash = homeNet ? 'n=' + homeNet : ''; });
    $('obj').addEventListener('click', e => { const c = e.target.closest('.how code'); if (c && !busy) { $('cmd').value = c.textContent; $('cmd').focus(); } });
    $('btn-hint').addEventListener('click', () => { if (!busy) { echo('hint'); term.write('\n'); runLine('hint'); } });
    $('btn-brief').addEventListener('click', () => showBrief(false));
    window.addEventListener('hashchange', route);
    route();
  });

  /* test hook */
  window.VSIM = { S, get w() { return w; }, get sh() { return sh; }, run: runLine, advance: sec => { S.tick(w, sec); renderSide(false); }, start, setLang, begin: () => { $('ov-brief').classList.remove('on'); paused = true; renderSpeeds(); }, get busy() { return busy; }, openLesson, get lv() { return lv; } };
})(SIM);
