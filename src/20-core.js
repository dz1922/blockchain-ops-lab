/* ============================================================
   Validator Simulator — core engine
   Networks and scenarios are plugins; this file knows nothing
   about any particular chain. See README.md for the contract.
   ============================================================ */
'use strict';
const SIM = (function () {
  const S = {};
  S.networks = {};
  S.scenarios = [];
  S.lessons = [];              // step 1 of each module: interactive fundamentals
  S.commands = {};             // generic shell commands, available everywhere
  S.registerNetwork = n => { S.networks[n.id] = n; };
  // track: 'run' (step 2, guided: `steps` instead of `objectives`) or 'ops' (step 3, production problems)
  S.registerScenario = s => {
    if (s.steps) s.objectives = s.steps.map(st => ({ text: st.text, check: st.check }));
    s.track = s.track || (s.steps ? 'run' : 'ops');
    S.scenarios.push(s);
  };
  S.registerLesson = l => { S.lessons.push(l); };

  /* ---------- language ----------
     S.L(zh, en)  → string in the current language (terminal output, written once)
     S.LL(zh, en) → bilingual value kept for later rendering (events, lessons, scenario text)
     S.tr(x)      → resolve a bilingual value                                              */
  S.lang = 'zh';
  S.L = (zh, en) => (S.lang === 'en' ? en : zh);
  S.LL = (zh, en) => ({ zh, en });
  S.tr = x => (x && typeof x === 'object' && 'zh' in x ? x[S.lang] : x);

  /* ---------- tiny event bus ---------- */
  const listeners = {};
  S.on = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
  S.emit = (name, ...a) => (listeners[name] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } });

  /* ---------- formatting ---------- */
  const wrap = code => s => `\x1b[${code}m${s}\x1b[0m`;
  S.C = { red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34), magenta: wrap(35), cyan: wrap(36), gray: wrap(90), bold: wrap(1) };
  S.esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  S.stripAnsi = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');
  S.ansiToHtml = function (s) {
    let out = '', open = 0, last = 0, m;
    const re = /\x1b\[([0-9;]*)m/g;
    const cls = { 1: 'b', 31: 'r', 32: 'g', 33: 'y', 34: 'bl', 35: 'm', 36: 'c', 90: 'k' };
    while ((m = re.exec(s))) {
      out += S.esc(s.slice(last, m.index)); last = re.lastIndex;
      const codes = m[1].split(';').filter(Boolean).map(Number);
      if (!codes.length || codes.includes(0)) { out += '</span>'.repeat(open); open = 0; continue; }
      codes.forEach(c => { if (cls[c]) { out += `<span class="a-${cls[c]}">`; open++; } });
    }
    return out + S.esc(s.slice(last)) + '</span>'.repeat(open);
  };
  S.fmtDur = function (sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  };
  S.semverCmp = (a, b) => {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };
  S.pad = (s, n) => { s = String(s); const len = S.stripAnsi(s).length; return len >= n ? s : s + ' '.repeat(n - len); };
  S.table = function (rows, head) {
    const all = head ? [head, ...rows] : rows;
    const w = all[0].map((_, i) => Math.max(...all.map(r => S.stripAnsi(String(r[i] ?? '')).length)));
    const line = r => r.map((c, i) => S.pad(c ?? '', w[i])).join('  ').replace(/\s+$/, '');
    return all.map(line).join('\n');
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const p2 = n => String(n).padStart(2, '0');
  S.fmtLogTime = d => `${MON[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  S.fmtClock = d => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC`;
  S.fmtDate = d => `${DAY[d.getUTCDay()]} ${S.fmtClock(d)}`;
  S.isoTime = d => d.toISOString().replace(/\.\d+Z$/, 'Z');

  /* ---------- deterministic randomness ---------- */
  S.rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  /* ---------- world ---------- */
  S.makeHost = o => Object.assign({
    fs: {}, dirs: new Set(), services: {}, journal: {}, kind: 'node',
    mem: { total: 16 * 1024, used: 6 * 1024 }, disk: { size: 1664, used: 300 }, cpus: 8, load: [0.42, 0.51, 0.58],
    homeUser: 'ubuntu',
  }, o);

  S.createWorld = function (scn) {
    const net = S.networks[scn.network];
    const w = {
      scn, net, t: 0, base: Date.parse(scn.startAt), nodes: {}, events: [], alerts: {}, groups: {},
      flags: {}, violations: {}, stats: { commands: 0, hints: 0, calls: 0, offline: {} },
      waiters: [], lessonsShown: {}, done: false, result: null, okFor: 0, objState: [], hintIdx: 0,
      rand: S.rng(scn.seed || 7),
    };
    w.now = () => new Date(w.base + w.t * 1000);
    w.laptop = S.makeHost({ id: 'laptop', hostname: 'laptop', kind: 'laptop', homeUser: 'ops' });
    S.fsWrite(w.laptop, '/home/ops/README.txt', S.L(
      '这是你的工作电脑。用 ssm <节点名> 登录节点，exit 返回。\nhelp 列出可用命令，hint 给出下一条提示，objectives 显示练习目标。\n',
      'This is your workstation. Log in to a node with ssm <node>, and type exit to come back.\nhelp lists the commands, hint gives the next hint, objectives shows the lab goals.\n'));
    w.booting = true;
    net.init(w, scn.config || {});
    if (scn.setup) scn.setup(w);
    w.booting = false;
    return w;
  };

  /* ---------- filesystem ---------- */
  S.norm = function (p) {
    const out = [];
    p.split('/').forEach(seg => { if (!seg || seg === '.') return; if (seg === '..') out.pop(); else out.push(seg); });
    return '/' + out.join('/');
  };
  S.fsGet = (h, p) => h.fs[S.norm(p)];
  S.fsRead = function (w, h, p) {
    const f = S.fsGet(h, p);
    if (!f) return null;
    return typeof f.c === 'function' ? f.c(w, h) : f.c;
  };
  S.fsWrite = function (h, p, c, opt = {}) {
    p = S.norm(p);
    const prev = h.fs[p] || {};
    h.fs[p] = Object.assign({ mode: '644', owner: 'root' }, prev, opt, { c });
    let d = p.slice(0, p.lastIndexOf('/'));
    while (d) { h.dirs.add(d); d = d.slice(0, d.lastIndexOf('/')); }
  };
  S.fsIsDir = (h, p) => { p = S.norm(p); return p === '/' || h.dirs.has(p) || Object.keys(h.fs).some(k => k.startsWith(p + '/')); };
  S.fsList = function (h, dir) {
    dir = S.norm(dir); const pre = dir === '/' ? '/' : dir + '/';
    const names = new Set();
    Object.keys(h.fs).forEach(k => { if (k.startsWith(pre)) names.add(k.slice(pre.length).split('/')[0]); });
    h.dirs.forEach(k => { if (k.startsWith(pre) && k !== dir) names.add(k.slice(pre.length).split('/')[0]); });
    return [...names].sort();
  };
  S.fsRemove = function (h, p, recursive) {
    p = S.norm(p); let n = 0;
    Object.keys(h.fs).forEach(k => { if (k === p || (recursive && k.startsWith(p + '/'))) { delete h.fs[k]; n++; } });
    if (recursive) [...h.dirs].forEach(d => { if (d === p || d.startsWith(p + '/')) h.dirs.delete(d); });
    return n;
  };

  /* ---------- journal ---------- */
  S.log = function (w, h, unit, level, msg) {
    const j = h.journal[unit] = h.journal[unit] || [];
    h.logSeq = (h.logSeq || 0) + 1;
    j.push({ t: w.t, level, msg, id: h.logSeq });
    if (j.length > 3000) j.splice(0, j.length - 3000);
  };

  /* ---------- events, lessons ---------- */
  S.event = function (w, kind, html) {
    w.events.push({ t: w.t, kind, html });
    if (w.events.length > 500) w.events.shift();
    S.emit('event', w, w.events[w.events.length - 1]);
  };
  S.lesson = function (w, key, title, text) {
    if (w.booting || w.lessonsShown[key]) return;
    w.lessonsShown[key] = true;
    S.event(w, 'lesson', { zh: `<b>${title.zh}</b> ${text.zh}`, en: `<b>${title.en}</b> ${text.en}` });
  };
  S.flag = function (w, name) { if (!w.booting && w.flags[name] === undefined) { w.flags[name] = w.t; } };

  /* ---------- sim time ---------- */
  S.sleep = (w, sec, sig) => new Promise(res => { w.waiters.push({ at: w.t + sec, res, sig }); });
  S.wakeAborted = function (w) {
    w.waiters = w.waiters.filter(x => { if (x.sig && x.sig.aborted) { x.res(); return false; } return true; });
  };
  function resolveWaiters(w) {
    w.waiters = w.waiters.filter(x => { if (x.at <= w.t || (x.sig && x.sig.aborted)) { x.res(); return false; } return true; });
  }

  S.tick = function (w, dt) {
    let rem = dt;
    while (rem > 1e-9) {
      const step = Math.min(rem, 5);
      rem -= step; w.t += step;
      w.net.tick(w, step);
      if (w.scn.tick) w.scn.tick(w, step);
      evalAlerts(w);
      escalate(w);
      if (!w.done) checkObjectives(w, step);
    }
    resolveWaiters(w);
    S.emit('tick', w);
  };

  /* ---------- alerting: rule eval → Alertmanager-style groups → Teams/phone ---------- */
  function evalAlerts(w) {
    const rules = w.net.rules.concat(w.scn.extraRules || []);
    const seen = {};
    rules.forEach(r => {
      (r.check(w) || []).forEach(a => {
        const key = r.name + '|' + a.instance;
        seen[key] = true;
        let st = w.alerts[key];
        if (!st) {
          const aged = w.t <= 5 && w.scn.alertAge ? -w.scn.alertAge : w.t;
          st = w.alerts[key] = { name: r.name, sev: r.severity, instance: a.instance, since: aged, state: 'pending', for: r.for };
        }
        st.summary = a.summary;
        if (st.state === 'pending' && w.t - st.since >= r.for) { st.state = 'firing'; onFire(w, st); }
      });
    });
    Object.keys(w.alerts).forEach(k => {
      if (seen[k]) return;
      const st = w.alerts[k];
      if (st.state === 'firing') onResolve(w, st);
      delete w.alerts[k];
    });
  }
  function onFire(w, st) {
    let g = w.groups[st.name];
    if (!g || g.resolved) {
      g = w.groups[st.name] = { name: st.name, sev: st.sev, instances: {}, firstAt: Math.min(w.t, st.since + st.for), acked: false, calls: 0, lastCall: null, resolved: false };
      if (g.firstAt < -600 && g.sev === 'critical') { g.calls = 9; g.lastCall = 0; }
    }
    g.instances[st.instance] = st;
    S.event(w, st.sev === 'critical' ? 'alert' : 'warn', `<b>${st.name}</b> · ${S.esc(st.instance)} · ${S.esc(st.summary || '')}`);
    S.emit('alerts', w);
  }
  function onResolve(w, st) {
    const g = w.groups[st.name];
    S.event(w, 'ok', S.LL(`已恢复 · <b>${st.name}</b> · ${S.esc(st.instance)}`, `Resolved · <b>${st.name}</b> · ${S.esc(st.instance)}`));
    if (g) {
      delete g.instances[st.instance];
      if (!Object.keys(g.instances).length) { g.resolved = true; g.resolvedAt = w.t; }
    }
    S.emit('alerts', w);
  }
  function escalate(w) {
    Object.values(w.groups).forEach(g => {
      if (g.sev !== 'critical' || g.acked || g.resolved || !Object.keys(g.instances).length) return;
      if (w.t - g.firstAt < 600) return;
      if (g.lastCall !== null && w.t - g.lastCall < 90) return;
      if (g.calls >= 9) return;
      g.calls++; g.lastCall = w.t; w.stats.calls++;
      S.event(w, 'call', S.LL(`<b>${g.name}</b> 10 分钟内无人确认，值班电话已拨出（第 ${g.calls} 轮）`, `<b>${g.name}</b> was not acknowledged within 10 minutes. Paging the on-call phones (round ${g.calls}).`));
      S.emit('call', w, g);
    });
  }
  S.ack = function (w, name) {
    const g = w.groups[name];
    if (!g || g.acked) return;
    g.acked = true; g.ackedAt = w.t;
    S.event(w, 'ok', S.LL(`已确认 <b>${name}</b>。电话停止，这组告警恢复之前不会重复通知。`, `Acknowledged <b>${name}</b>. Paging stops, and the group will not notify again until it resolves.`));
    S.emit('alerts', w);
  };

  /* ---------- objectives, scoring ---------- */
  // guided labs: steps complete in order and stay complete; each may explain what just happened
  function advanceSteps(w) {
    const s = w.scn;
    while (w.stepIdx < s.steps.length) {
      const st = s.steps[w.stepIdx];
      let ok = false; try { ok = !!st.check(w); } catch (e) { ok = false; }
      if (!ok) break;
      w.stepIdx++;
      S.event(w, 'ok', { zh: `<b>第 ${w.stepIdx} 步完成</b> · ${st.text.zh}`, en: `<b>Step ${w.stepIdx} done</b> · ${st.text.en}` });
      if (st.after) S.lesson(w, 'step-' + w.stepIdx, st.text, st.after);
      S.emit('step', w, w.stepIdx);
    }
    w.objState = s.steps.map((_, i) => i < w.stepIdx);
  }
  function checkObjectives(w, dt) {
    const s = w.scn;
    if (s.steps) { w.stepIdx = w.stepIdx || 0; advanceSteps(w); }
    else w.objState = s.objectives.map(o => { try { return !!o.check(w); } catch (e) { return false; } });
    (s.forbidden || []).forEach(f => {
      if (w.flags[f.flag] !== undefined && w.violations[f.flag] === undefined) {
        w.violations[f.flag] = w.t;
        S.event(w, 'bad', { zh: `<b>违规：</b>${f.text.zh}`, en: `<b>Violation:</b> ${f.text.en}` });
      }
    });
    if (w.objState.length && w.objState.every(Boolean)) {
      w.okFor += dt;
      if (w.okFor >= (s.holdFor ?? (s.steps ? 0 : 60))) S.finish(w, true);
    } else w.okFor = 0;
    if (s.limit && w.t >= s.limit) S.finish(w, false);
  }
  S.finish = function (w, success) {
    if (w.done) return;
    w.done = true;
    const violated = Object.keys(w.violations).length > 0;
    w.result = { success: success && !violated, reachedGoal: success, violated, t: w.t, extra: w.scn.score ? w.scn.score(w) : [] };
    S.event(w, success && !violated ? 'ok' : 'bad', success ? (violated ? S.LL('目标已达成，但过程中有违规操作。', 'Goals reached, with a rule violation along the way.') : S.LL('练习完成。', 'Lab complete.')) : S.LL('时间到。', 'Time is up.'));
    S.emit('done', w);
  };

  return S;
})();
