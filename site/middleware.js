// Password gate for the hosted site (Vercel Routing Middleware, all plans).
// The deploy job replaces the placeholder below with the SHA-256 of the
// SITE_PASSWORD secret, so the password itself never enters the repository.
const PASSWORD_SHA256 = '__SITE_PASSWORD_SHA256__';
const COOKIE = 'bol_auth';
const MAX_AGE = 60 * 60 * 24 * 30;

const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const readCookie = (req, name) => {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(req.headers.get('cookie') || '');
  return m ? m[1] : '';
};
// Only same-site paths, so the form cannot be used as an open redirect.
const safeNext = p => (typeof p === 'string' && /^\/(?![/\\])/.test(p) && !p.startsWith('/__auth')) ? p : '/';
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function gate(next, failed) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Validator Operations Lab</title>
<style>
*{box-sizing:border-box;margin:0}
body{min-height:100vh;display:grid;place-items:center;background:#0b0f0d;color:#e8f0e4;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;padding:1.5rem}
form{width:100%;max-width:360px;display:grid;gap:.9rem}
.k{font:600 .72rem ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#b6f23a}
h1{font-size:1.6rem;line-height:1.2}
p{color:#b9c7b4;font-size:.92rem}
input{width:100%;padding:.75rem .9rem;border-radius:10px;border:1px solid #34413a;background:#111714;color:#e8f0e4;font:inherit}
input:focus{outline:none;border-color:#b6f23a}
button{padding:.75rem;border:0;border-radius:10px;background:#b6f23a;color:#0b0f0d;font:inherit;font-weight:700;cursor:pointer}
.err{color:#ff6b57;font-size:.88rem}
</style></head><body>
<form method="post" action="/__auth">
<span class="k">Validator Operations Lab</span>
<h1 data-zh="请输入访问密码">Enter the access password</h1>
<p data-zh="这门课程仅限受邀访问。">This course is shared by invitation.</p>
${failed ? '<p class="err" data-zh="密码错误。">Incorrect password.</p>' : ''}
<input type="password" name="password" autocomplete="current-password" placeholder="Password" data-zh-ph="密码" autofocus required>
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit" data-zh="进入">Continue</button>
</form>
<script>
document.querySelector('form').addEventListener('submit',function(){this.next.value+=location.hash});
// English by default; Chinese only when the visitor chose it before (?lang=zh or the saved choice)
var zh=/[?&]lang=zh/.test(location.search)||(function(){try{return localStorage.getItem('vsim.lang')==='zh'}catch(e){return false}})();
if(zh){document.documentElement.lang='zh-CN';document.querySelectorAll('[data-zh]').forEach(function(e){e.textContent=e.getAttribute('data-zh')});document.querySelectorAll('[data-zh-ph]').forEach(function(e){e.placeholder=e.getAttribute('data-zh-ph')});}
</script>
</body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY' },
  });
}

export default async function middleware(request) {
  if (!/^[0-9a-f]{64}$/.test(PASSWORD_SHA256)) {
    return new Response('Site password is not configured.\n', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const url = new URL(request.url);
  const token = await hex('session:' + PASSWORD_SHA256);

  if (url.pathname === '/__auth') {
    if (request.method !== 'POST') return gate('/', false);
    const form = await request.formData().catch(() => null);
    const next = safeNext(form && form.get('next'));
    if (same(await hex(String((form && form.get('password')) || '')), PASSWORD_SHA256)) {
      return new Response(null, {
        status: 303,
        headers: { location: next, 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    return gate(next, true);
  }

  if (same(readCookie(request, COOKIE), token)) return; // signed in: serve the static file
  return gate(safeNext(url.pathname + url.search), false);
}
