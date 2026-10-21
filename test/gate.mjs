// Unit test for site/middleware.js, the password gate in front of the hosted site.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../site/middleware.js'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'gate-'));
const load = async (name, body) => { const f = join(dir, name); writeFileSync(f, body); return (await import(f)).default; };
const sha = s => createHash('sha256').update(s).digest('hex');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const B = 'https://lab.example';
const post = (fields, cookie) => new Request(B + '/__auth', { method: 'POST', body: new URLSearchParams(fields), headers: cookie ? { cookie } : {} });

const unset = await load('unset.mjs', src);
ok((await unset(new Request(B + '/'))).status === 503, 'fails closed when the password was not injected');

const mw = await load('set.mjs', src.replace('__SITE_PASSWORD_SHA256__', sha('test-pw')));
let r = await mw(new Request(B + '/?lang=zh'));
ok(r.status === 401 && (await r.text()).includes('name="next" value="/?lang=zh"'), 'no cookie: password page, keeps the path');
r = await mw(post({ password: 'wrong', next: '/' }));
ok(r.status === 401 && (await r.text()).includes('Incorrect password'), 'wrong password: page again with an error');
r = await mw(post({ password: 'test-pw', next: '/?lang=en#s=avax-ip' }));
const set = r.headers.get('set-cookie') || '';
ok(r.status === 303 && r.headers.get('location') === '/?lang=en#s=avax-ip', 'right password: redirect back to the page');
ok(/HttpOnly/.test(set) && /Secure/.test(set) && !set.includes(sha('test-pw')), 'cookie is HttpOnly, Secure, and not the password hash');
const cookie = set.split(';')[0];
ok((await mw(new Request(B + '/', { headers: { cookie } }))) === undefined, 'with the cookie: request passes through');
ok((await mw(new Request(B + '/', { headers: { cookie: 'bol_auth=' + sha('x') } }))).status === 401, 'forged cookie is rejected');
for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
  r = await mw(post({ password: 'test-pw', next: evil }));
  ok(r.headers.get('location') === '/', `open redirect blocked: ${evil}`);
}
r = await mw(new Request(B + '/"><script>x</script>'));
ok(!(await r.text()).includes('<script>x'), 'path is escaped on the page');

console.log(fails ? `${fails} GATE CHECK(S) FAILED` : 'GATE CHECKS PASSED');
process.exit(fails ? 1 : 0);
