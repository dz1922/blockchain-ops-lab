/* ============================================================
   Shell: a small bash-alike over the simulated hosts.
   Supports pipes, && || ;, > >>, $VAR, $(cmd), quotes, ~.
   ============================================================ */
(function (S) {
  'use strict';

  /* ---------- tokenizer ---------- */
  function readDollar(line, i) {
    if (line[i + 1] === '(') {
      let depth = 1, j = i + 2, inS = false, inD = false;
      while (j < line.length && depth > 0) {
        const c = line[j];
        if (c === "'" && !inD) inS = !inS;
        else if (c === '"' && !inS) inD = !inD;
        else if (!inS && !inD) { if (c === '(') depth++; else if (c === ')') depth--; }
        j++;
      }
      return { part: { cmd: line.slice(i + 2, j - 1) }, end: j };
    }
    if (line[i + 1] === '{') { const j = line.indexOf('}', i); return { part: { v: line.slice(i + 2, j) }, end: j + 1 }; }
    const m = /^([A-Za-z_][A-Za-z0-9_]*|\?)/.exec(line.slice(i + 1));
    if (!m) return { part: { lit: '$' }, end: i + 1 };
    return { part: { v: m[1] }, end: i + 1 + m[1].length };
  }
  function tokenize(line) {
    const toks = []; let i = 0, cur = null;
    const push = () => { if (cur) { toks.push(cur); cur = null; } };
    const part = p => { if (!cur) cur = { t: 'w', parts: [] }; cur.parts.push(p); };
    while (i < line.length) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') { push(); i++; continue; }
      if (ch === '#' && !cur) break;
      if (ch === '|' && line[i + 1] === '|') { push(); toks.push({ t: 'op', v: '||' }); i += 2; continue; }
      if (ch === '&' && line[i + 1] === '&') { push(); toks.push({ t: 'op', v: '&&' }); i += 2; continue; }
      if (ch === '|') { push(); toks.push({ t: 'op', v: '|' }); i++; continue; }
      if (ch === ';') { push(); toks.push({ t: 'op', v: ';' }); i++; continue; }
      if (ch === '2' && line[i + 1] === '>' && !cur) { // 2>/dev/null, 2>&1 → ignore
        const m = /^2>(&1|\/dev\/null)/.exec(line.slice(i)); if (m) { i += m[0].length; continue; }
      }
      if (ch === '>') { push(); if (line[i + 1] === '>') { toks.push({ t: 'op', v: '>>' }); i += 2; } else { toks.push({ t: 'op', v: '>' }); i++; } continue; }
      if (ch === "'") {
        const j = line.indexOf("'", i + 1);
        if (j < 0) throw new Error('unexpected EOF while looking for matching `\'`');
        part({ lit: line.slice(i + 1, j), q: 1 }); i = j + 1; continue;
      }
      if (ch === '"') {
        let j = i + 1, buf = '', any = false;
        while (j < line.length && line[j] !== '"') {
          if (line[j] === '\\' && j + 1 < line.length && '"\\$`'.includes(line[j + 1])) { buf += line[j + 1]; j += 2; continue; }
          if (line[j] === '$') {
            if (buf) { part({ lit: buf, q: 2 }); buf = ''; }
            const r = readDollar(line, j); part(r.part); any = true; j = r.end; continue;
          }
          buf += line[j]; j++;
        }
        if (j >= line.length) throw new Error('unexpected EOF while looking for matching `"\'');
        if (buf || !any) part({ lit: buf, q: 2 });
        i = j + 1; continue;
      }
      if (ch === '\\' && i + 1 < line.length) { part({ lit: line[i + 1] }); i += 2; continue; }
      if (ch === '$') { const r = readDollar(line, i); part(r.part); i = r.end; continue; }
      let j = i, buf = '';
      while (j < line.length && !' \t\n|&;>\'"$\\'.includes(line[j])) { buf += line[j]; j++; }
      if (!buf) { buf = line[j]; j++; }
      part({ lit: buf, first: !cur }); i = j;
    }
    push();
    return toks;
  }
  /* tokens → [{op, pipeline:[{words, redir}]}] */
  function parse(toks) {
    const seq = []; let pipeline = [], cmd = { words: [], redir: null }, nextOp = null, pendingRedir = null;
    const endCmd = () => { if (cmd.words.length) pipeline.push(cmd); cmd = { words: [], redir: null }; };
    const endPipe = op => { endCmd(); if (pipeline.length) seq.push({ op: nextOp, pipeline }); pipeline = []; nextOp = op; };
    toks.forEach(t => {
      if (t.t === 'w') {
        if (pendingRedir) { cmd.redir = { op: pendingRedir, target: t }; pendingRedir = null; }
        else cmd.words.push(t);
        return;
      }
      if (t.v === '|') endCmd();
      else if (t.v === '>' || t.v === '>>') pendingRedir = t.v;
      else endPipe(t.v);
    });
    endPipe(null);
    return seq;
  }

  /* ---------- shell ---------- */
  class Shell {
    constructor(w, term) {
      this.w = w; this.term = term; this.proc = null; this.history = [];
      this.stack = [{ host: w.laptop, user: 'ops', cwd: '/home/ops', env: { HOME: '/home/ops', USER: 'ops' } }];
      this.lastCode = 0;
    }
    get sess() { return this.stack[this.stack.length - 1]; }
    home(sess = this.sess) { return sess.user === 'root' ? '/root' : sess.user === 'ssm-user' ? '/home/ssm-user' : `/home/${sess.user}`; }
    prompt() {
      const s = this.sess, h = s.host;
      if (h.kind === 'laptop') return `\x1b[32mops@laptop\x1b[0m:\x1b[34m${this.short(s.cwd)}\x1b[0m$ `;
      if (s.user === 'ssm-user') return 'sh-5.2$ ';
      const sym = s.user === 'root' ? '#' : '$';
      return `\x1b[33m${s.user}@${h.hostname}\x1b[0m:\x1b[34m${this.short(s.cwd)}\x1b[0m${sym} `;
    }
    short(p) { const hm = this.home(); return p === hm ? '~' : p.startsWith(hm + '/') ? '~' + p.slice(hm.length) : p; }
    resolve(p, sess = this.sess) {
      if (!p) return sess.cwd;
      if (p === '~' || p.startsWith('~/')) p = this.home(sess) + p.slice(1);
      if (!p.startsWith('/')) p = sess.cwd + '/' + p;
      return S.norm(p);
    }
    canWrite(p, sess = this.sess) {
      if (sess.user === 'root') return true;
      const hm = this.home(sess);
      return p.startsWith('/tmp/') || p === '/tmp' || p.startsWith(hm + '/');
    }
    canRead(p, sess = this.sess) {
      const f = S.fsGet(sess.host, p);
      if (!f || sess.user === 'root') return true;
      if (f.mode === '400' || f.mode === '600') return f.owner === sess.user;
      return true;
    }
    push(sess) { this.stack.push(sess); }
    pop() { if (this.stack.length > 1) this.stack.pop(); }

    async expandWord(word) {
      let out = '';
      for (let k = 0; k < word.parts.length; k++) {
        const p = word.parts[k];
        if (p.lit !== undefined) {
          let v = p.lit;
          if (k === 0 && !p.q && (v === '~' || v.startsWith('~/'))) v = this.home() + v.slice(1);
          out += v;
        } else if (p.v !== undefined) {
          out += p.v === '?' ? String(this.lastCode) : (this.sess.env[p.v] ?? '');
        } else if (p.cmd !== undefined) {
          const r = await this.capture(p.cmd);
          out += r.replace(/\n+$/, '');
        }
      }
      return out;
    }
    async capture(line) {
      const saved = this.capturing; this.capturing = true;
      let buf = '';
      try { await this.runSeq(parse(tokenize(line)), s => { buf += s; }); }
      finally { this.capturing = saved; }
      return S.stripAnsi(buf);
    }

    /* entry point from the terminal */
    async run(line, write) {
      this.w.stats.commands++;
      let seq;
      try { seq = parse(tokenize(line)); }
      catch (e) { write(`bash: ${e.message}\n`); this.lastCode = 2; return; }
      this.proc = { sig: { aborted: false } };
      try { await this.runSeq(seq, write); }
      finally { this.proc = null; }
    }
    interrupt() {
      if (this.proc) { this.proc.sig.aborted = true; S.wakeAborted(this.w); }
    }
    async runSeq(seq, write) {
      let code = 0;
      for (const item of seq) {
        if (item.op === '&&' && code !== 0) continue;
        if (item.op === '||' && code === 0) continue;
        code = await this.runPipeline(item.pipeline, write);
        this.lastCode = code;
        if (this.proc && this.proc.sig.aborted) break;
      }
      return code;
    }
    async runPipeline(cmds, write) {
      let stdin = '', code = 0;
      for (let k = 0; k < cmds.length; k++) {
        const last = k === cmds.length - 1;
        const streamTo = last && !cmds[k].redir ? write : null;
        let buf = '';
        const w2 = streamTo || (s => { buf += s; });
        const r = await this.runCmd(cmds[k], stdin, w2, !!streamTo);
        code = r.code;
        if (cmds[k].redir) {
          const target = this.resolve(await this.expandWord(cmds[k].redir.target));
          const content = S.stripAnsi(buf + (r.out || ''));
          if (!this.canWrite(target)) { write(`bash: ${target}: Permission denied\n`); code = 1; }
          else S.fsWrite(this.sess.host, target, cmds[k].redir.op === '>>' ? (S.fsRead(this.w, this.sess.host, target) || '') + content : content);
          stdin = '';
        } else if (streamTo) {
          if (r.out) write(r.out.endsWith('\n') || !r.out ? r.out : r.out + '\n');
        } else stdin = buf + (r.out || '');
      }
      return code;
    }
    async runCmd(cmd, stdin, write, interactive) {
      const words = [];
      for (const wd of cmd.words) words.push(await this.expandWord(wd));
      if (!words.length) return { code: 0, out: '' };
      // VAR=value
      const asg = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(words[0]);
      if (asg && words.length === 1) { this.sess.env[asg[1]] = asg[2]; return { code: 0, out: '' }; }
      if (asg) words.shift();
      return this.exec(words[0], words.slice(1), stdin, write, interactive);
    }
    lookup(name) {
      const h = this.sess.host, net = this.w.net;
      const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
      if (name.includes('/')) {
        const p = this.resolve(name);
        if (!S.fsGet(h, p)) return { missing: `bash: ${name}: No such file or directory` };
      }
      const pools = h.kind === 'laptop'
        ? [net.laptopCommands, this.w.scn.laptopCommands, S.commands]
        : [h.commands, net.nodeCommands, S.commands, S.nodeFallback];
      for (const pool of pools) if (pool && pool[base]) return { fn: pool[base], base };
      return null;
    }
    async exec(name, args, stdin, write, interactive) {
      const found = this.lookup(name);
      if (found && found.missing) { write(found.missing + '\n'); return { code: 127 }; }
      if (!found) {
        // say where the command does exist, if it exists on the other side
        const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name, net = this.w.net, onLaptop = this.sess.host.kind === 'laptop';
        const onWorkstation = [net.laptopCommands, this.w.scn.laptopCommands].some(p => p && p[base]);
        const onNode = [net.nodeCommands].concat(Object.values(this.w.nodes).map(n => n.commands)).some(p => p && p[base]);
        const hint = onLaptop
          ? (onNode ? S.L(`（${base} 在节点上运行：先用 ssm <节点名> 登录节点）`, `(${base} runs on a node: log in with ssm <node> first)`)
            : S.L('（你在工作电脑上。节点上的命令需要先登录节点）', '(you are on your workstation; node commands need a session on the node)'))
          : (onWorkstation ? S.L(`（${base} 在你的工作电脑上：exit 回到工作电脑再运行）`, `(${base} is on your workstation: type exit to go back to it)`)
            : S.L('（这个命令不在练习范围内，help 列出可用命令）', '(not available in this lab; help lists the commands)'));
        write(`bash: ${name}: command not found ${S.C.gray(hint)}\n`);
        return { code: 127 };
      }
      const sig = this.proc ? this.proc.sig : { aborted: false };
      const ctx = {
        name, argv0: found.base, args, stdin, w: this.w, sh: this, sess: this.sess, host: this.sess.host,
        isRoot: this.sess.user === 'root', write, interactive, sig,
        sleep: sec => S.sleep(this.w, sec, sig),
        resolve: p => this.resolve(p), read: p => S.fsRead(this.w, this.sess.host, this.resolve(p)),
        flags: parseFlags(args),
      };
      try {
        const r = await found.fn(ctx);
        if (r === undefined || r === null) return { code: 0, out: '' };
        if (typeof r === 'string') return { code: 0, out: r };
        return { code: r.code ?? 0, out: r.out ?? '' };
      } catch (e) {
        console.error(e);
        return { code: 1, out: `${name}: internal simulator error: ${e.message}\n` };
      }
    }
  }
  S.Shell = Shell;
  S.tokenize = tokenize;

  /* ---------- flag helper ---------- */
  function parseFlags(args) {
    const f = { _: [] };
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        if (eq > 0) f[a.slice(2, eq)] = a.slice(eq + 1);
        else f[a.slice(2)] = (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) ? args[++i] : true;
      } else f._.push(a);
    }
    return f;
  }
  S.parseFlags = parseFlags;
  /* short flags that take a value, e.g. -n 50, -u unit */
  S.opt = function (args, names, takesValue = true) {
    for (let i = 0; i < args.length; i++) {
      if (names.includes(args[i])) return takesValue ? args[i + 1] : true;
      for (const n of names) if (n.startsWith('--') && args[i].startsWith(n + '=')) return args[i].slice(n.length + 1);
    }
    return undefined;
  };
  S.hasFlag = (args, ...names) => args.some(a => names.includes(a) || (/^-[a-zA-Z]+$/.test(a) && names.some(n => /^-[a-zA-Z]$/.test(n) && a.includes(n[1]))));

  /* ---------- jq (the subset people actually type) ---------- */
  function jqParse(src) {
    let i = 0;
    const ws = () => { while (src[i] === ' ' || src[i] === '\n') i++; };
    function pipe() { let l = alt(); ws(); while (src[i] === '|') { i++; const r = alt(); const a = l; l = { t: 'pipe', a, b: r }; ws(); } return l; }
    function alt() { let l = assign(); ws(); while (src.slice(i, i + 2) === '//') { i += 2; const r = assign(); l = { t: 'alt', a: l, b: r }; ws(); } return l; }
    function assign() { const l = cmp(); ws(); if (src[i] === '=' && src[i + 1] !== '=') { i++; const r = cmp(); return { t: 'set', a: l, b: r }; } return l; }
    function cmp() { const l = term(); ws(); const m = /^(==|!=|>=|<=|>|<)/.exec(src.slice(i)); if (m) { i += m[1].length; const r = term(); return { t: 'cmp', op: m[1], a: l, b: r }; } return l; }
    function term() {
      ws();
      let node;
      if (src[i] === '.') {
        node = { t: 'id' }; i++;
        node = postfix(node, true);
      } else if (src[i] === '{') {
        i++; const fields = [];
        while (true) {
          ws(); if (src[i] === '}') { i++; break; }
          let key; if (src[i] === '"') { const j = src.indexOf('"', i + 1); key = src.slice(i + 1, j); i = j + 1; } else { const m = /^[A-Za-z_][\w]*/.exec(src.slice(i)); key = m[0]; i += key.length; }
          ws(); let val = { t: 'path', base: { t: 'id' }, keys: [{ k: key }] };
          if (src[i] === ':') { i++; val = alt(); }
          fields.push({ key, val }); ws(); if (src[i] === ',') i++;
        }
        node = { t: 'obj', fields };
      } else if (src[i] === '"') { const j = src.indexOf('"', i + 1); node = { t: 'lit', v: src.slice(i + 1, j) }; i = j + 1; }
      else if (src[i] === '$') { const m = /^\$[A-Za-z_]\w*/.exec(src.slice(i)); node = { t: 'var', v: m[0].slice(1) }; i += m[0].length; }
      else if (src[i] === '(') { i++; node = pipe(); ws(); i++; }
      else if (/[0-9-]/.test(src[i])) { const m = /^-?\d+(\.\d+)?/.exec(src.slice(i)); node = { t: 'lit', v: Number(m[0]) }; i += m[0].length; }
      else {
        const m = /^[A-Za-z_][\w]*/.exec(src.slice(i));
        if (!m) throw new Error(`syntax error at "${src.slice(i)}"`);
        i += m[0].length; node = { t: 'fn', v: m[0] };
        if (m[0] === 'true' || m[0] === 'false' || m[0] === 'null') node = { t: 'lit', v: JSON.parse(m[0]) };
      }
      return postfix(node, false);
    }
    function postfix(base, afterDot) {
      const keys = [];
      while (true) {
        if (afterDot && /[A-Za-z_]/.test(src[i] || '')) { const m = /^[A-Za-z_][\w]*/.exec(src.slice(i)); keys.push({ k: m[0] }); i += m[0].length; afterDot = false; continue; }
        if (afterDot && src[i] === '"') { const j = src.indexOf('"', i + 1); keys.push({ k: src.slice(i + 1, j) }); i = j + 1; afterDot = false; continue; }
        if (src[i] === '[') { const j = src.indexOf(']', i); const inner = src.slice(i + 1, j).trim(); keys.push(inner === '' ? { each: true } : /^-?\d+$/.test(inner) ? { n: Number(inner) } : { k: inner.replace(/^"|"$/g, '') }); i = j + 1; afterDot = false; continue; }
        if (src[i] === '.' && /[A-Za-z_"\[]/.test(src[i + 1] || '')) { i++; afterDot = true; continue; }
        break;
      }
      return keys.length ? { t: 'path', base, keys } : base;
    }
    const ast = pipe(); ws();
    if (i < src.length) throw new Error(`syntax error at "${src.slice(i)}"`);
    return ast;
  }
  function jqEval(n, input, vars) {
    switch (n.t) {
      case 'id': return [input];
      case 'lit': return [n.v];
      case 'var': return [vars[n.v]];
      case 'pipe': return jqEval(n.a, input, vars).flatMap(x => jqEval(n.b, x, vars));
      case 'alt': { const a = jqEval(n.a, input, vars).filter(x => x !== null && x !== false && x !== undefined); return a.length ? a : jqEval(n.b, input, vars); }
      case 'cmp': { const a = jqEval(n.a, input, vars)[0], b = jqEval(n.b, input, vars)[0]; return [{ '==': a === b, '!=': a !== b, '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b }[n.op]]; }
      case 'path': return jqEval(n.base, input, vars).flatMap(v => walk(v, n.keys));
      case 'obj': { const o = {}; n.fields.forEach(f => { o[f.key] = jqEval(f.val, input, vars)[0]; }); return [o]; }
      case 'set': {
        const val = jqEval(n.b, input, vars)[0];
        const copy = JSON.parse(JSON.stringify(input));
        if (n.a.t !== 'path') throw new Error('unsupported assignment');
        let o = copy; const ks = n.a.keys;
        ks.slice(0, -1).forEach(k => { o = o[k.k ?? k.n]; });
        const lk = ks[ks.length - 1]; o[lk.k ?? lk.n] = val;
        return [copy];
      }
      case 'fn': {
        if (n.v === 'length') return [Array.isArray(input) ? input.length : input && typeof input === 'object' ? Object.keys(input).length : String(input ?? '').length];
        if (n.v === 'keys') return [Object.keys(input || {}).sort()];
        if (n.v === 'tonumber') return [Number(input)];
        if (n.v === 'tostring') return [String(input)];
        if (n.v === 'not') return [!input];
        throw new Error(`${n.v}/0 is not defined`);
      }
    }
    throw new Error('unsupported filter');
  }
  function walk(v, keys) {
    let cur = [v];
    keys.forEach(k => {
      cur = cur.flatMap(x => {
        if (k.each) return Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [];
        if (k.n !== undefined) return [Array.isArray(x) ? x[k.n < 0 ? x.length + k.n : k.n] ?? null : null];
        return [x && typeof x === 'object' ? (x[k.k] === undefined ? null : x[k.k]) : null];
      });
    });
    return cur;
  }
  S.jq = function (filter, text, opts = {}) {
    const ast = jqParse(filter || '.');
    const docs = [];
    const t = String(text).trim();
    if (!t) return '';
    try { docs.push(JSON.parse(t)); }
    catch (e) { t.split('\n').filter(Boolean).forEach(l => docs.push(JSON.parse(l))); }
    const out = docs.flatMap(d => jqEval(ast, d, opts.vars || {}));
    return out.map(v => (opts.raw && typeof v === 'string') ? v : JSON.stringify(v, null, opts.compact ? 0 : 2)).join('\n') + '\n';
  };
})(SIM);
