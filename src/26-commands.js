/* ============================================================
   Generic commands available on every host.
   Network plugins add their own (avalanchego, solana, staking…).
   ============================================================ */
(function (S) {
  'use strict';
  const C = S.C, K = S.commands;
  const err = (out, code = 1) => ({ out: out.endsWith('\n') ? out : out + '\n', code });
  const lines = s => String(s ?? '').replace(/\n$/, '').split('\n');

  function readInput(ctx, files) {
    if (!files.length) return { text: ctx.stdin };
    let text = '';
    for (const f of files) {
      const p = ctx.resolve(f);
      if (S.fsIsDir(ctx.host, p) && !S.fsGet(ctx.host, p)) return { error: `${ctx.argv0}: ${f}: Is a directory` };
      const c = S.fsRead(ctx.w, ctx.host, p);
      if (c === null) return { error: `${ctx.argv0}: ${f}: No such file or directory` };
      if (!ctx.sh.canRead(p)) return { error: `${ctx.argv0}: ${f}: Permission denied` };
      text += c.endsWith('\n') ? c : c + '\n';
    }
    return { text };
  }
  const positional = (args, valueFlags = []) => {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      if (valueFlags.includes(args[i])) { i++; continue; }
      if (args[i].startsWith('-') && args[i] !== '-') continue;
      out.push(args[i]);
    }
    return out;
  };

  /* ---------- node fallbacks: used on a node only when the network defines nothing ---------- */
  // The aws CLI is installed on cloud nodes, but the instance role is deliberately narrow:
  // EC2 and EBS changes are made from the workstation with the operator's own role.
  S.nodeFallback = {
    aws: ctx => {
      const h = ctx.host, role = `${h.moniker || h.id}-instance-role`, inst = h.instanceId || 'i-0000000000example';
      const p = positional(ctx.args, ['--region', '--output', '--filters', '--query', '--volume-id', '--size', '--instance-id', '--instance-ids', '--profile']);
      if (!p.length) return { code: 252, out: 'usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\naws: error: the following arguments are required: command\n' };
      if (p[0] === 'sts' && p[1] === 'get-caller-identity') return JSON.stringify({ UserId: `AROAEXAMPLEINSTANCE:${inst}`, Account: '111122223333', Arn: `arn:aws:sts::111122223333:assumed-role/${role}/${inst}` }, null, 4) + '\n';
      const op = (p[1] || '').split('-').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join('');
      const svc = p[0];
      const msg = svc === 's3'
        ? `An error occurred (AccessDenied) when calling the ${p[1] === 'ls' ? 'ListObjectsV2' : 'PutObject'} operation: Access Denied`
        : `An error occurred (UnauthorizedOperation) when calling the ${op} operation: You are not authorized to perform this operation. User: arn:aws:sts::111122223333:assumed-role/${role}/${inst} is not authorized to perform: ${svc}:${op} because no identity-based policy allows the ${svc}:${op} action`;
      return { code: 254, out: `\n${msg}\n${C.gray(S.L('（节点上的实例角色只有最小权限。EC2、EBS 这类操作用你自己的角色在工作电脑上执行：exit 回到工作电脑）', '(the instance role on a node is deliberately narrow. Run EC2 and EBS operations from your workstation with your own role: type exit to go back)'))}\n` };
    },
  };

  /* ---------- meta ---------- */
  K.help = ctx => {
    const h = ctx.host, w = ctx.w;
    const net = h.kind === 'laptop' ? w.net.laptopCommands : w.net.nodeCommands;
    const names = o => Object.keys(o || {}).filter(k => !o[k].hidden).sort().join('  ');
    let out = `${C.bold(S.L('练习', 'Lab'))}      hint  objectives  help\n`;
    out += `${C.bold(h.kind === 'laptop' ? S.L('工作电脑', 'Workstation') : S.L('本节点', 'This node'))}  ${names(net)}${h.kind === 'laptop' && w.scn.laptopCommands ? '  ' + names(w.scn.laptopCommands) : ''}\n`;
    out += `${C.bold(S.L('通用', 'General'))}      ${names(K).replace(/\bhelp\b|\bhint\b|\bobjectives\b/g, '').replace(/\s+/g, '  ').trim()}\n`;
    out += C.gray(S.L('支持管道 |、&& || ;、> 重定向、$VAR 和 $(...)。Tab 补全，↑↓ 翻历史，Ctrl+C 中断，Ctrl+L 清屏。\n', 'Pipes |, && || ;, > redirection, $VAR and $(...) work. Tab completes, ↑↓ browse history, Ctrl+C interrupts, Ctrl+L clears.\n'));
    out += C.gray(h.kind === 'laptop' ? S.L('登录节点：ssm <节点名>，或 aws ssm start-session --region <区域> --target <实例 ID>。\n', 'Log in to a node: ssm <node>, or aws ssm start-session --region <region> --target <instance-id>.\n') : S.L('回到工作电脑：exit。\n', 'Back to the workstation: exit.\n'));
    return out;
  };
  // A hint (ops labs) or a step (guided labs) has two parts: what to do, and the exact commands.
  // { text: LL, cmds: ['…'], wait?: seconds }. Older plain-LL hints still print as text.
  S.hintParts = h => (h && (h.cmds || h.text) && !h.zh) ? { text: h.text, cmds: h.cmds || [], wait: h.wait || 0 } : { text: h, cmds: [], wait: 0 };
  const plainHtml = x => S.stripAnsi(S.tr(x || '').replace(/<\/?code>/g, '`').replace(/<[^>]+>/g, '')).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const waitNote = sec => sec ? C.gray(S.L(`  然后让时钟走大约 ${S.fmtDur(sec)}（右上角可以加速）`, `  then let the clock run for about ${S.fmtDur(sec)} (speed it up at the top right)`)) + '\n' : '';
  const cmdLines = cmds => cmds.map(c => `  ${C.gray('$')} ${C.cyan(c)}\n`).join('');
  K.hint = ctx => {
    const w = ctx.w, hs = w.scn.hints || [];
    if (w.scn.steps) {
      const st = w.scn.steps[w.stepIdx || 0];
      if (!st) return C.gray(S.L('所有步骤都已完成。\n', 'All steps are done.\n'));
      return `${C.yellow(S.L(`第 ${(w.stepIdx || 0) + 1}/${w.scn.steps.length} 步`, `Step ${(w.stepIdx || 0) + 1}/${w.scn.steps.length}`))}  ${C.bold(S.tr(st.text))}\n${plainHtml(st.how)}\n${cmdLines(st.cmds || [])}${waitNote(st.wait)}`;
    }
    if (w.hintIdx >= hs.length) return C.gray(S.L('提示已经用完。可以看看 objectives，或者回顾右侧的事件记录。\n', 'No more hints. Check objectives, or read back through the event log on the right.\n'));
    w.stats.hints++;
    const p = S.hintParts(hs[w.hintIdx++]);
    S.emit('hint', w);
    return `${C.yellow(S.L(`提示 ${w.hintIdx}/${hs.length}`, `Hint ${w.hintIdx}/${hs.length}`))}  ${plainHtml(p.text)}\n${cmdLines(p.cmds)}${waitNote(p.wait)}`;
  };
  // Same as the Acknowledge button on an alert card.
  K.ack = ctx => {
    const w = ctx.w, open = Object.values(w.groups).filter(g => !g.resolved && g.sev === 'critical');
    if (!ctx.args[0]) {
      if (!open.length) return C.gray(S.L('没有需要确认的 critical 告警。\n', 'No critical alerts to acknowledge.\n'));
      return open.map(g => `${g.acked ? C.green('acked  ') : C.red('firing ')} ${g.name}`).join('\n') + '\n' + C.gray(S.L('用法：ack <告警名>，和告警卡片上的“确认”按钮作用相同。\n', 'Usage: ack <AlertName>, the same as the Acknowledge button on the alert card.\n'));
    }
    const g = w.groups[ctx.args[0]];
    // a hint may say to acknowledge an alert that has not fired yet or has already cleared: say so, do not fail
    if (!g || g.resolved) return S.L(`${ctx.args[0]} 现在没有在告警，不需要确认。\n`, `${ctx.args[0]} is not firing right now; nothing to acknowledge.\n`);
    if (g.acked) return S.L(`${g.name} 已经确认过了。\n`, `${g.name} is already acknowledged.\n`);
    S.ack(w, g.name);
    return S.L(`已确认 ${g.name}。\n`, `Acknowledged ${g.name}.\n`);
  };
  K.objectives = ctx => {
    const w = ctx.w;
    let out = C.bold(S.L('目标', 'Goals')) + '\n';
    w.scn.objectives.forEach((o, i) => { out += `  ${w.objState[i] ? C.green('✔') : C.gray('○')} ${S.tr(o.text)}\n`; });
    if ((w.scn.forbidden || []).length) {
      out += C.bold(S.L('不要做', 'Do not')) + '\n';
      w.scn.forbidden.forEach(f => { out += `  ${w.violations[f.flag] !== undefined ? C.red('✕') : C.gray('·')} ${S.tr(f.text)}\n`; });
    }
    return out;
  };
  K.clear = ctx => { ctx.sh.term.clear(); };
  K.history = ctx => ctx.sh.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n') + '\n';

  /* ---------- shell & navigation ---------- */
  K.echo = ctx => {
    let a = ctx.args, nl = true;
    if (a[0] === '-n') { nl = false; a = a.slice(1); }
    if (a[0] === '-e') a = a.slice(1);
    return a.join(' ') + (nl ? '\n' : '');
  };
  K.pwd = ctx => ctx.sess.cwd + '\n';
  K.cd = ctx => {
    const p = ctx.resolve(ctx.args[0] || '~');
    if (!S.fsIsDir(ctx.host, p)) return err(`bash: cd: ${ctx.args[0]}: No such file or directory`);
    ctx.sess.cwd = p;
  };
  K.whoami = ctx => ctx.sess.user + '\n';
  K.id = ctx => ctx.sess.user === 'root' ? 'uid=0(root) gid=0(root) groups=0(root)\n' : `uid=1001(${ctx.sess.user}) gid=1001(${ctx.sess.user}) groups=1001(${ctx.sess.user})\n`;
  K.hostname = ctx => ctx.host.hostname + '\n';
  K.date = ctx => S.fmtDate(ctx.w.now()) + '\n';
  K.true = () => ({ code: 0 });
  K.false = () => ({ code: 1 });
  K.env = ctx => Object.entries(ctx.sess.env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  K.export = ctx => { ctx.args.forEach(a => { const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a); if (m) ctx.sess.env[m[1]] = m[2]; }); };
  K.unset = ctx => { ctx.args.forEach(a => delete ctx.sess.env[a]); };
  K.which = ctx => {
    const out = ctx.args.map(a => ctx.sh.lookup(a) ? `/usr/bin/${a}` : null);
    return out.every(Boolean) ? out.join('\n') + '\n' : err(ctx.args.filter((a, i) => !out[i]).map(a => `which: no ${a} in (/usr/local/bin:/usr/bin)`).join('\n'));
  };
  K.sleep = async ctx => { await ctx.sleep(parseFloat(ctx.args[0] || '1')); };
  K.exit = ctx => {
    if (ctx.sh.stack.length === 1) return C.gray(S.L('你已经在工作电脑上了。\n', 'You are already on your workstation.\n'));
    const leaving = ctx.sess;
    ctx.sh.pop();
    if (leaving.user === 'root' && ctx.sh.sess.host === leaving.host) return 'logout\n';
    return leaving.host.kind === 'laptop' ? '' : `\n${C.gray(`Exiting session with sessionId: ops-${leaving.host.id}-0a1b2c3d.`)}\n`;
  };
  K.logout = K.exit;
  K.sudo = async ctx => {
    const a = ctx.args;
    if (!a.length) return err('usage: sudo -i | sudo <command>');
    if (a[0] === '-i' || (a[0] === 'su' && (a[1] === '-' || !a[1])) || a[0] === '-s') {
      ctx.sh.push({ host: ctx.host, user: 'root', cwd: '/root', env: Object.assign({}, ctx.sess.env, { HOME: '/root', USER: 'root' }) });
      ctx.host.dirs.add('/root');
      return;
    }
    let rest = a;
    if (rest[0] === '-E' || rest[0] === '-n') rest = rest.slice(1);
    if (rest[0] === '-u') rest = rest.slice(2);
    const sess = ctx.sess, prev = sess.user;
    sess.user = 'root';
    try { const r = await ctx.sh.exec(rest[0], rest.slice(1), ctx.stdin, ctx.write, ctx.interactive); return r; }
    finally { sess.user = prev; }
  };
  K.su = ctx => ctx.args[0] === '-' || !ctx.args.length ? K.sudo(Object.assign({}, ctx, { args: ['-i'] })) : err(S.L('su: 本练习只支持 sudo -i', 'su: use sudo -i in this lab'));
  ['vim', 'vi', 'nano', 'emacs', 'less', 'more', 'top', 'htop', 'watch'].forEach(n => {
    K[n] = () => err(`${n}: ` + S.L("这个终端不支持全屏程序。编辑文件用 sed -i 's/旧/新/' 文件 或 jq … > 新文件，查看用 cat、head、tail。", "full-screen programs are not available here. Edit with sed -i 's/old/new/' FILE or jq … > NEWFILE; read with cat, head, tail."), 1);
    K[n].hidden = true;
  });

  /* ---------- files ---------- */
  K.ls = ctx => {
    const long = S.hasFlag(ctx.args, '-l'), all = S.hasFlag(ctx.args, '-a');
    const targets = positional(ctx.args); if (!targets.length) targets.push('.');
    let out = '';
    for (const t of targets) {
      const p = ctx.resolve(t);
      const isFile = !!S.fsGet(ctx.host, p);
      if (!isFile && !S.fsIsDir(ctx.host, p)) { out += `ls: cannot access '${t}': No such file or directory\n`; continue; }
      if (!isFile && p.startsWith('/home/ubuntu/.avalanchego/staking') && !ctx.isRoot && ctx.sess.user !== 'ubuntu') { out += `ls: cannot open directory '${t}': Permission denied\n`; continue; }
      const names = isFile ? [p.slice(p.lastIndexOf('/') + 1)] : S.fsList(ctx.host, p).filter(n => all || !n.startsWith('.'));
      if (targets.length > 1 && !isFile) out += `${t}:\n`;
      if (!long) { out += names.map(n => S.fsIsDir(ctx.host, (isFile ? p.slice(0, p.lastIndexOf('/')) : p) + '/' + n) && !S.fsGet(ctx.host, (isFile ? '' : p) + '/' + n) ? C.blue(n) : n).join('  ') + (names.length ? '\n' : ''); continue; }
      out += `total ${names.length * 4}\n`;
      names.forEach(n => {
        const fp = isFile ? p : S.norm(p + '/' + n), f = S.fsGet(ctx.host, fp);
        if (!f) { out += `drwxr-xr-x 2 root   root       4096 Sep 22 14:20 ${C.blue(n)}\n`; return; }
        const c = S.fsRead(ctx.w, ctx.host, fp) || '';
        const size = f.size || c.length;
        const mode = { '400': '-r--------', '600': '-rw-------', '644': '-rw-r--r--', '755': '-rwxr-xr-x' }[f.mode] || '-rw-r--r--';
        out += `${mode} 1 ${S.pad(f.owner || 'root', 6)} ${S.pad(f.owner || 'root', 6)} ${String(size).padStart(10)} Sep 22 14:20 ${f.mode === '755' ? C.green(n) : n}\n`;
      });
    }
    return out;
  };
  K.cat = ctx => { const r = readInput(ctx, positional(ctx.args)); return r.error ? err(r.error) : r.text; };
  const headTail = which => ctx => {
    const n = parseInt(S.opt(ctx.args, ['-n']) || (ctx.args.find(a => /^-\d+$/.test(a)) || '-10').slice(1), 10);
    const files = positional(ctx.args, ['-n']);
    const r = readInput(ctx, files); if (r.error) return err(r.error);
    const ls = r.text.replace(/\n$/, '').split('\n');
    const sel = which === 'head' ? ls.slice(0, n) : ls.slice(-n);
    return r.text ? sel.join('\n') + '\n' : '';
  };
  K.head = headTail('head'); K.tail = headTail('tail');
  K.grep = ctx => {
    const flags = ctx.args.filter(a => /^-[a-zA-Z]+$/.test(a)).join('');
    const rest = ctx.args.filter(a => !/^-[a-zA-Z]+$/.test(a));
    let pat = rest.shift(); if (pat === undefined) return err('usage: grep [-ivcnE] PATTERN [FILE]', 2);
    const r = readInput(ctx, rest); if (r.error) return err(r.error, 2);
    let re;
    try { re = new RegExp(flags.includes('E') || /[|()+?]/.test(pat) ? pat : pat.replace(/[.*+?^${}()|[\]\\]/g, m => m === '.' || m === '*' || m === '^' || m === '$' || m === '[' || m === ']' ? m : '\\' + m), flags.includes('i') ? 'i' : ''); }
    catch (e) { return err(`grep: invalid regex: ${pat}`, 2); }
    const inv = flags.includes('v');
    const hits = lines(r.text).map((l, i) => ({ l, i })).filter(x => r.text && (re.test(S.stripAnsi(x.l)) !== inv));
    if (flags.includes('c')) return hits.length + '\n';
    if (!hits.length) return { code: 1, out: '' };
    return hits.map(x => (flags.includes('n') ? `${x.i + 1}:` : '') + (inv ? x.l : x.l.replace(new RegExp(re.source, re.flags + 'g'), m => C.red(m)))).join('\n') + '\n';
  };
  K.wc = ctx => {
    const r = readInput(ctx, positional(ctx.args)); if (r.error) return err(r.error);
    const n = r.text ? r.text.replace(/\n$/, '').split('\n').length : 0;
    return S.hasFlag(ctx.args, '-l') ? n + '\n' : `${n} ${r.text.split(/\s+/).filter(Boolean).length} ${r.text.length}\n`;
  };
  K.sort = ctx => { const r = readInput(ctx, positional(ctx.args)); if (r.error) return err(r.error); let ls = lines(r.text).sort(); if (S.hasFlag(ctx.args, '-r')) ls.reverse(); return r.text ? ls.join('\n') + '\n' : ''; };
  K.uniq = ctx => { const r = readInput(ctx, positional(ctx.args)); const ls = lines(r.text).filter((l, i, a) => i === 0 || a[i - 1] !== l); return r.text ? ls.join('\n') + '\n' : ''; };
  K.jq = ctx => {
    const a = ctx.args.slice(); const opts = { vars: {} }; let filter = null; const files = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-r') opts.raw = true;
      else if (a[i] === '-c') opts.compact = true;
      else if (a[i] === '-rc' || a[i] === '-cr') { opts.raw = true; opts.compact = true; }
      else if (a[i] === '--arg') { opts.vars[a[i + 1]] = a[i + 2]; i += 2; }
      else if (a[i] === '--argjson') { opts.vars[a[i + 1]] = JSON.parse(a[i + 2]); i += 2; }
      else if (a[i].startsWith('-') && a[i].length > 1) continue;
      else if (filter === null) filter = a[i];
      else files.push(a[i]);
    }
    const r = readInput(ctx, files); if (r.error) return err(r.error, 2);
    try { return S.jq(filter, r.text, opts); }
    catch (e) { return err(`jq: error: ${e.message}`, 5); }
  };
  K.sed = ctx => {
    const inPlace = ctx.args.includes('-i');
    const rest = ctx.args.filter(a => a !== '-i' && a !== '-e');
    const expr = rest[0], files = rest.slice(1);
    const m = expr && /^s(.)(.*?)\1(.*?)\1(g?)$/.exec(expr);
    if (!m) return err(S.L(`sed: 本练习只支持 s/旧/新/[g]：${expr || ''}`, `sed: only s/old/new/[g] is supported here: ${expr || ''}`));
    let re; try { re = new RegExp(m[2], m[4]); } catch (e) { return err(`sed: -e expression #1: ${e.message}`); }
    const repl = m[3].replace(/\\\//g, '/').replace(/&/g, '$&');
    if (!files.length) return ctx.stdin.replace(re, repl);
    let out = '';
    for (const f of files) {
      const p = ctx.resolve(f), c = S.fsRead(ctx.w, ctx.host, p);
      if (c === null) return err(`sed: can't read ${f}: No such file or directory`, 2);
      const nc = c.replace(re, repl);
      if (inPlace) {
        if (!ctx.sh.canWrite(p)) return err(`sed: couldn't open temporary file ${p.slice(0, p.lastIndexOf('/'))}/sedXyZ12: Permission denied`, 4);
        S.fsWrite(ctx.host, p, nc, { by: 'user', at: ctx.w.t });
        if (ctx.w.net.onFileChanged) ctx.w.net.onFileChanged(ctx.w, ctx.host, p, ctx);
      } else out += nc;
    }
    return out;
  };
  function copyLike(ctx, move) {
    const files = positional(ctx.args, ['-m', '-o', '-g']);
    if (files.length < 2) return err(`${ctx.argv0}: missing file operand`);
    const dstArg = files.pop(); let dst = ctx.resolve(dstArg);
    let code = 0, out = '';
    for (const src of files) {
      const sp = ctx.resolve(src), f = S.fsGet(ctx.host, sp);
      if (!f) { out += `${ctx.argv0}: cannot stat '${src}': No such file or directory\n`; code = 1; continue; }
      let target = S.fsIsDir(ctx.host, dst) && !S.fsGet(ctx.host, dst) ? S.norm(dst + '/' + sp.slice(sp.lastIndexOf('/') + 1)) : dst;
      if (!ctx.sh.canWrite(target)) { out += `${ctx.argv0}: cannot create regular file '${dstArg}': Permission denied\n`; code = 1; continue; }
      if (!move && ctx.argv0 === 'cp' && ctx.host.isBusy && ctx.host.isBusy(ctx.w, target)) { out += `cp: cannot create regular file '${dstArg}': Text file busy\n`; code = 1; continue; }
      const mode = S.opt(ctx.args, ['-m']);
      S.fsWrite(ctx.host, target, f.c, { mode: mode ? mode.replace(/^0/, '') : f.mode, owner: ctx.argv0 === 'install' ? (S.opt(ctx.args, ['-o']) || 'root') : f.owner, by: 'user', at: ctx.w.t, size: f.size });
      if (move) S.fsRemove(ctx.host, sp);
      if (ctx.w.net.onFileChanged) ctx.w.net.onFileChanged(ctx.w, ctx.host, target, ctx);
    }
    return { code, out };
  }
  K.cp = ctx => copyLike(ctx, false);
  K.install = ctx => copyLike(ctx, false);
  K.mv = ctx => copyLike(ctx, true);
  K.rm = ctx => {
    const rec = S.hasFlag(ctx.args, '-r', '-R'), force = S.hasFlag(ctx.args, '-f');
    let out = '', code = 0;
    for (const t of positional(ctx.args)) {
      const p = ctx.resolve(t.replace(/\/\*$/, ''));
      const wildcard = t.endsWith('/*');
      if (!ctx.sh.canWrite(p)) { out += `rm: cannot remove '${t}': Permission denied\n`; code = 1; continue; }
      if (S.fsIsDir(ctx.host, p) && !S.fsGet(ctx.host, p) && !rec) { out += `rm: cannot remove '${t}': Is a directory\n`; code = 1; continue; }
      const n = S.fsRemove(ctx.host, p, rec || wildcard);
      if (wildcard) ctx.host.dirs.add(p);
      if (!n && !force) { out += `rm: cannot remove '${t}': No such file or directory\n`; code = 1; }
      if (ctx.w.net.onRemoved) ctx.w.net.onRemoved(ctx.w, ctx.host, p, ctx);
    }
    return { code, out };
  };
  K.mkdir = ctx => { positional(ctx.args).forEach(d => ctx.host.dirs.add(ctx.resolve(d))); };
  K.touch = ctx => { positional(ctx.args).forEach(f => { const p = ctx.resolve(f); if (!S.fsGet(ctx.host, p)) S.fsWrite(ctx.host, p, ''); }); };
  K.chown = ctx => ctx.isRoot ? undefined : err('chown: changing ownership: Operation not permitted');
  K.chmod = ctx => { const [m, ...fs] = positional(ctx.args); fs.forEach(f => { const g = S.fsGet(ctx.host, ctx.resolve(f)); if (g) g.mode = m.replace(/^0/, ''); }); };
  K.tar = async ctx => {
    const a = ctx.args.join(' ');
    if (!/x/.test(ctx.args[0] || '')) return err(S.L('tar: 本练习只支持解压：tar xzf 文件 [-C 目录]', 'tar: only extraction is supported here: tar xzf FILE [-C DIR]'));
    const file = ctx.args.find((x, i) => i > 0 && !x.startsWith('-') && ctx.args[i - 1] !== '-C') || ctx.args[1];
    const dir = ctx.resolve(S.opt(ctx.args, ['-C']) || '.');
    const c = S.fsRead(ctx.w, ctx.host, ctx.resolve(file || ''));
    if (c === null) return err(`tar: ${file}: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now`, 2);
    if (!c.startsWith('TARBALL:')) return err('tar: This does not look like a tar archive', 2);
    const spec = JSON.parse(c.slice(8));
    await ctx.sleep(3);
    Object.entries(spec.files).forEach(([rel, body]) => S.fsWrite(ctx.host, S.norm(dir + '/' + rel), body.c, { mode: body.mode || '755', owner: ctx.sess.user === 'root' ? 'root' : ctx.sess.user }));
    if (a.includes('v')) return Object.keys(spec.files).join('\n') + '\n';
  };

  /* ---------- system ---------- */
  K.df = ctx => {
    const d = ctx.host.disk, h = S.hasFlag(ctx.args, '-h');
    const f = v => h ? (v >= 1000 ? (v / 1024).toFixed(1) + 'T' : v + 'G') : String(v * 1024 * 1024);
    return S.table([[d.dev || '/dev/root', f(d.size), f(d.used), f(d.size - d.used), Math.round(d.used / d.size * 100) + '%', '/'],
      ['tmpfs', h ? '7.7G' : '8031012', '0', h ? '7.7G' : '8031012', '0%', '/dev/shm']],
    ['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on']) + '\n';
  };
  K.free = ctx => {
    const m = ctx.host.mem, g = v => (v / 1024).toFixed(1) + 'Gi';
    return S.table([['Mem:', g(m.total), g(m.used), g(m.total - m.used - 300), '2.0Mi', g(300), g(m.total - m.used)], ['Swap:', '0B', '0B', '0B']],
      ['', 'total', 'used', 'free', 'shared', 'buff/cache', 'available']) + '\n';
  };
  K.uptime = ctx => { const up = ctx.host.bootAt !== undefined ? ctx.w.t - ctx.host.bootAt + (ctx.host.upBase || 0) : 86400 * 12; return ` ${S.fmtClock(ctx.w.now()).slice(11, 19)} up ${S.fmtDur(up)},  1 user,  load average: ${ctx.host.load.join(', ')}\n`; };
  K.ps = ctx => {
    const procs = (ctx.host.procs ? ctx.host.procs(ctx.w) : []).concat([{ user: 'root', pid: 1, cmd: '/usr/lib/systemd/systemd --switched-root --system' }, { user: 'root', pid: 812, cmd: '/usr/bin/amazon-ssm-agent' }]);
    return S.table(procs.map(p => [p.user, p.pid, p.cpu || '0.0', p.mem || '0.1', p.cmd]), ['USER', 'PID', '%CPU', '%MEM', 'COMMAND']) + '\n';
  };
  K.timedatectl = ctx => `               Local time: ${S.fmtDate(ctx.w.now())}\n           Universal time: ${S.fmtDate(ctx.w.now())}\n                Time zone: Etc/UTC (UTC, +0000)\nSystem clock synchronized: ${ctx.host.clockSkew ? C.red('no') : 'yes'}\n              NTP service: active\n`;
  K.ss = ctx => {
    const l = ctx.host.listening ? ctx.host.listening(ctx.w) : [];
    return S.table(l.map(x => ['LISTEN', '0', '4096', x.addr, '0.0.0.0:*', `users:(("${x.proc}",pid=${x.pid},fd=${x.fd || 12}))`]), ['State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port', 'Process']) + '\n';
  };

  /* ---------- systemd ---------- */
  const unitName = n => (n || '').replace(/\.service$/, '');
  function findSvc(ctx, n) { return ctx.host.services[unitName(n)]; }
  function svcStatus(ctx, s) {
    const w = ctx.w, since = w.base + s.since * 1000, ago = S.fmtDur(w.t - s.since) + ' ago';
    const dot = { active: C.green('●'), failed: C.red('×'), activating: C.yellow('●'), inactive: '○' }[s.state] || '○';
    const act = {
      active: C.green('active (running)'),
      activating: C.yellow('activating (auto-restart)') + ' (Result: exit-code)',
      failed: C.red('failed') + ' (Result: exit-code)',
      inactive: 'inactive (dead)',
    }[s.state];
    let out = `${dot} ${s.name}.service - ${s.desc}\n`;
    out += `     Loaded: loaded (${s.unitPath}; ${s.enabled === false ? 'disabled' : 'enabled'}; preset: disabled)\n`;
    out += `     Active: ${act} since ${S.fmtDate(new Date(since))}; ${ago}\n`;
    if (s.state === 'active') {
      out += `   Main PID: ${s.pid} (${s.name.split('-')[0]})\n      Tasks: ${s.tasks || 31} (limit: 18843)\n     Memory: ${s.memStr ? s.memStr(w) : '1.2G'}\n     CGroup: /system.slice/${s.name}.service\n             └─${s.pid} ${s.exec}\n`;
    } else if (s.state === 'activating' || s.state === 'failed') {
      out += `    Process: ${s.pid} ExecStart=${s.exec} ${C.red(`(code=exited, status=${s.exitStatus || 1}/FAILURE)`)}\n   Main PID: ${s.pid} (code=exited, status=${s.exitStatus || 1}/FAILURE)\n`;
    }
    const j = (ctx.host.journal[s.name] || []).slice(-6);
    if (j.length) out += '\n' + j.map(e => fmtEntry(w, ctx.host, s.name, e)).join('\n') + '\n';
    return out;
  }
  K.systemctl = async ctx => {
    const a = S.parseFlags(ctx.args)._;
    const sub = a[0], names = a.slice(1);
    const needRoot = ['start', 'stop', 'restart', 'enable', 'disable', 'reload', 'daemon-reload', 'kill', 'reset-failed'];
    if (!sub) return err(S.L('systemctl: 需要子命令，例如 systemctl status <unit>', 'systemctl: a subcommand is required, for example systemctl status <unit>'));
    if (needRoot.includes(sub) && !ctx.isRoot) return err(`Failed to ${sub} ${names[0] || ''}: Access denied ${C.gray(S.L('（需要 root：先 sudo -i，或在命令前加 sudo）', '(needs root: sudo -i first, or prefix with sudo)'))}`);
    if (sub === 'daemon-reload') return;
    if (sub === 'list-units') return Object.values(ctx.host.services).map(s => `  ${s.name}.service  loaded ${s.state} ${s.state === 'active' ? 'running' : 'dead'} ${s.desc}`).join('\n') + '\n';
    if (!names.length) return err(`Too few arguments.`);
    let out = '', code = 0;
    for (const n of names) {
      const s = findSvc(ctx, n);
      if (!s) { out += `Unit ${unitName(n)}.service could not be found.\n`; code = sub === 'status' ? 4 : 5; continue; }
      if (sub === 'status') { out += svcStatus(ctx, s); code = s.state === 'active' ? 0 : 3; continue; }
      if (sub === 'is-active') { out += (s.state === 'activating' ? 'activating' : s.state) + '\n'; code = s.state === 'active' ? 0 : 3; continue; }
      if (sub === 'is-enabled') { out += (s.enabled === false ? 'disabled' : 'enabled') + '\n'; continue; }
      if (sub === 'show') { out += `NRestarts=${s.restarts || 0}\nActiveEnterTimestamp=${S.fmtDate(new Date(ctx.w.base + s.since * 1000))}\nActiveState=${s.state}\n`; continue; }
      if (sub === 'cat') { out += `# ${s.unitPath}\n${S.fsRead(ctx.w, ctx.host, s.unitPath) || ''}\n`; continue; }
      if (sub === 'enable') { s.enabled = true; continue; }
      if (sub === 'disable') { s.enabled = false; continue; }
      const r = ctx.w.net.serviceAction(ctx.w, ctx.host, s, sub, ctx);
      if (r && r.then) await r;
    }
    return { code, out };
  };
  function fmtEntry(w, h, unit, e) {
    const d = new Date(w.base + e.t * 1000);
    let msg = `${S.fmtLogTime(d)} ${h.hostname} ${unit}[${(h.services[unit] || {}).pid || 1}]: ${e.msg}`;
    if (e.level === 'ERROR' || e.level === 'FATAL') msg = C.red(msg);
    else if (e.level === 'WARN') msg = C.yellow(msg);
    return msg;
  }
  S.fmtEntry = fmtEntry;
  K.journalctl = async ctx => {
    const unit = unitName(S.opt(ctx.args, ['-u', '--unit']) || (S.hasFlag(ctx.args, '-k') ? 'kernel' : ''));
    const n = parseInt(S.opt(ctx.args, ['-n', '--lines']) || (S.hasFlag(ctx.args, '-f') ? '10' : '40'), 10);
    const follow = S.hasFlag(ctx.args, '-f') || ctx.args.includes('--follow');
    const sinceArg = S.opt(ctx.args, ['--since']);
    const h = ctx.host;
    if (!unit) return err(S.L('journalctl: 用 -u <unit> 指定服务（例如 journalctl -u avalanchego -n 50 --no-pager），或用 -k 看内核日志', 'journalctl: pick a unit with -u <unit> (for example journalctl -u avalanchego -n 50 --no-pager), or -k for kernel messages'));
    if (unit !== 'kernel' && !h.services[unit] && !h.journal[unit]) return `-- No entries --\n`;
    let entries = (h.journal[unit] || []);
    if (sinceArg) { const m = /(\d+)\s*(min|minute|hour|h|m)/.exec(sinceArg); if (m) { const sec = +m[1] * (/h/.test(m[2]) ? 3600 : 60); entries = entries.filter(e => e.t >= ctx.w.t - sec); } }
    const shown = entries.slice(-n);
    let out = shown.map(e => fmtEntry(ctx.w, h, unit, e)).join('\n');
    if (!follow) return (out || '-- No entries --') + '\n';
    if (!ctx.interactive) return out + '\n';
    ctx.write(out ? out + '\n' : '');
    let lastId = shown.length ? shown[shown.length - 1].id : (entries.length ? entries[entries.length - 1].id : 0);
    ctx.write(C.gray(S.L('（跟随日志中，Ctrl+C 退出。新日志跟随模拟时钟产生，时钟暂停时不会有输出）', '(following; Ctrl+C to stop. New lines arrive on the simulated clock, so nothing appears while it is paused)')) + '\n');
    while (!ctx.sig.aborted) {
      await ctx.sleep(1);
      const fresh = (h.journal[unit] || []).filter(e => e.id > lastId);
      if (fresh.length) { lastId = fresh[fresh.length - 1].id; ctx.write(fresh.slice(-40).map(e => fmtEntry(ctx.w, h, unit, e)).join('\n') + '\n'); }
    }
  };
  K.dmesg = ctx => K.journalctl(Object.assign({}, ctx, { args: ['-k', '-n', '30'] }));

  /* ---------- network ---------- */
  K.curl = async ctx => {
    const a = ctx.args; let method = null, body = null, out = null, url = null, fail = false, silent = false, showErr = false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === '-X' || x === '--request') method = a[++i];
      else if (x === '-d' || x === '--data' || x === '--data-binary' || x === '--data-raw') body = a[++i];
      else if (x === '-o' || x === '--output') out = a[++i];
      else if (x === '-H' || x === '--header' || x === '-w' || x === '-m' || x === '--max-time' || x === '--retry' || x === '--retry-delay' || x === '--aws-sigv4' || x === '--user' || x === '-u') i++;
      else if (/^-[a-zA-Z]+$/.test(x)) { if (x.includes('f')) fail = true; if (x.includes('s')) silent = true; if (x.includes('S')) showErr = true; }
      else if (x.startsWith('--')) { /* ignore */ }
      else url = x;
    }
    if (!url) return err('curl: no URL specified!', 2);
    if (!/^https?:\/\//.test(url)) url = 'http://' + url;
    method = method || (body ? 'POST' : 'GET');
    let json = null; if (body) { try { json = JSON.parse(body); } catch (e) { json = null; } }
    const u = new URL(url);
    const req = { method, url, host: u.hostname, port: u.port, path: u.pathname, query: u.searchParams, body, json };
    await ctx.sleep(0.2);
    const res = ctx.w.net.http ? await ctx.w.net.http(ctx.w, ctx.host, req, ctx) : null;
    if (!res) return err(silent && !showErr ? '' : `curl: (6) Could not resolve host: ${u.hostname}`, 6);
    if (res.error) return err(silent && !showErr ? '' : `curl: (${res.error}) ${res.msg}`, res.error);
    if (fail && res.status >= 400) return err(silent && !showErr ? '' : `curl: (22) The requested URL returned error: ${res.status}`, 22);
    if (out) {
      const p = ctx.resolve(out);
      if (!ctx.sh.canWrite(p)) return err(`curl: (23) Failure writing output to destination`, 23);
      if (res.wait) await ctx.sleep(res.wait);
      S.fsWrite(ctx.host, p, res.body, { size: res.size, owner: ctx.sess.user === 'root' ? 'root' : ctx.sess.user });
      return silent ? '' : `  % Total    % Received % Xferd  Average Speed   Time\n100 ${((res.size || 1e6) / 1e6).toFixed(0)}M  100 ${((res.size || 1e6) / 1e6).toFixed(0)}M    0     0  48.2M      0  0:00:01\n`;
    }
    return typeof res.body === 'string' ? res.body + (res.body.endsWith('\n') ? '' : '') : JSON.stringify(res.body);
  };
})(SIM);
