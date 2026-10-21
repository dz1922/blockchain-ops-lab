# Validator Operations Lab

Hands-on labs for running blockchain validators, in the browser. Each lab provides a simulated shell, simulated hosts and a simulated chain, with production-style alert rules. Everything ships as one static file, `dist/index.html`, with no backend.

The course is public-facing. All hosts, IPs, instance IDs, accounts and identities are fictional. Labs are based on real incidents, described without naming the operator.

## Languages

The UI and all teaching text are bilingual (zh / en). Real tool output in the terminal stays in English, as it is in production.

| Helper | Use |
|---|---|
| `S.L(zh, en)` | Text written once, such as terminal coaching notes. |
| `S.LL(zh, en)` | Text that is stored and rendered later: events, lessons, lab data. |
| `S.tr(x)` | Resolves either kind. |

- Interface strings live in `T` in `src/60-ui.js`.
- The language comes from `?lang=zh|en`, then the saved choice, then defaults to English.
- Lab fields (`title`, `tagline`, `brief`, `learn`, `hints`, objective and forbidden `text`, `debrief`, score labels) must all be `S.LL(...)`.

## Writing style

Write like course material:
- Short declarative sentences in a plain instructor voice.
- No marketing tone, rhetorical questions or emoji.
- Never write "we". Refer to "the operator", "your nodes" and so on.

```
npm ci && npx playwright install chromium   # once
npm run check              # syntax check
./build.sh                 # src/* → dist/index.html
LANGX=en node test/play.js # plays every lab end to end in headless Chromium (LANGX=zh for Chinese)
node test/shots.js         # desktop + mobile screenshots to /tmp/vsim-*.png
```

## Layout

| File | Role |
|---|---|
| `src/20-core.js` | Engine. It owns:<br>• the world and the simulated clock (`S.tick`, `S.sleep`)<br>• the virtual filesystem and journal<br>• alert evaluation (pending → firing)<br>• Alertmanager-style groups, Ack and phone escalation (10 min, then 90 s × 9)<br>• objectives and scoring<br><br>It knows nothing about any chain. |
| `src/25-shell.js` | A bash subset: pipes, `&& \|\| ;`, `> >>`, `$VAR`, `$(…)`, quotes, `~`. It also includes a small `jq`. |
| `src/26-commands.js` | Commands that exist on every host: files, `grep`/`sed`/`jq`, `systemctl`, `journalctl -f`, `curl`, `tar`/`install` (`cp` onto a running binary reports "Text file busy"), `sudo`. |
| `src/30-net-avalanche.js` | Avalanche network plugin. |
| `src/40-net-solana.js` | Solana network plugin. |
| `src/50-scenarios.js` | Scenarios. These are pure data plus predicates. |
| `src/60-ui.js` | Landing page, terminal, side panels, briefing and debrief. |

## Network plugin contract

`SIM.registerNetwork({...})`

| Field | Purpose |
|---|---|
| `id`, `name`, `color` | Identity, used on cards and in the UI. |
| `logo` | The network's mark as an SVG string with a square viewBox, or `id => svg` when it needs a unique gradient id. Shown on module headers, lab cards, the top bar and the mechanism panel. |
| `init(w, cfg)` | Builds `w.chain` (protocol state) and `w.nodes`. Create hosts with `S.makeHost`, files with `S.fsWrite`, and fill `services`. |
| `tick(w, dt)` | Advances the mechanism: replay, voting, balance burn, uptime accrual, log lines (`S.log`). Can emit `S.lesson(w, key, title, html)`. |
| `serviceAction(w, host, svc, action)` | Gives meaning to `systemctl start\|stop\|restart`. |
| `http(w, host, req)` | Answers `curl`. Return `{status, body}`, `{error, msg}`, or `null` for an unknown host. |
| `nodeCommands`, `laptopCommands` | Chain CLIs (`avalanchego`, `solana`, `staking`, `gh`…). Each is `async ctx => string \| {code, out}`. |
| `rules` | Alerts: `[{name, severity, for, check(w) → [{instance, summary}]}]`. Use the alert names and thresholds that operators run in production. |
| `panel.mount(el, w)` / `panel.update(el, w)` | The "链上机制" view. |
| `onFileChanged`, `onRemoved` | Optional hooks, for example flagging a deleted database. |

## Scenario contract

`SIM.registerScenario({...})`

| Field | Purpose |
|---|---|
| `id`, `network`, `title`, `tagline`, `brief` (HTML), `difficulty` (1–3), `minutes` | Card and briefing text. |
| `startAt` | ISO time. |
| `config` | Passed to the plugin's `init`. |
| `setup(w)` | Optional. |
| `alertAge` | Seconds that alerts true at t=0 have already been firing. |
| `objectives` | `[{text, check(w)}]`. All must hold for `holdFor` simulated seconds. |
| `forbidden` | `[{flag, text}]`. Plugins raise these with `S.flag(w, name)`. |
| `hints` | `[html]`. |
| `limit` | Simulated seconds. |
| `score(w)` | Returns `[[label, value, 'good'\|'mid'\|'bad']]`. |
| `debrief` | HTML. |
| `laptopCommands`, `extraRules` | Optional. |

## Adding a network

Write `src/NN-net-<chain>.js`. Source material:

- The client's own documentation gives paths, systemd units, users and identity files.
- Production alert rules give the alert names and thresholds.
- Incident write-ups and runbooks give the failure modes.

Model only what operators actually type, and give sensible errors for everything else.

## Deployment

`.github/workflows/deploy.yml` runs on every push and pull request:

1. It syntax-checks and builds the site.
2. It plays every lab in both languages. A failing lab, a missed trap or a page error fails the run.
3. It deploys `dist/` to Vercel. Pushes to `main` go to production; same-repo pull requests get a preview URL, shown in the job summary.

One-time setup:

| What | Where |
|---|---|
| `VERCEL_TOKEN` | Repository secret. Create the token at vercel.com/account/tokens. |
| `SITE_PASSWORD` | Repository secret. The site password. The deploy job writes its SHA-256 into `middleware.js`; the password is never committed. |
| `VERCEL_SCOPE` | Repository variable, optional. Set it only when deploying into a Vercel team; leave it unset for a personal account. |

The first run creates the Vercel project `blockchain-ops-lab` if it does not exist. Turn off Vercel's own Deployment Protection for production; access is controlled by the password gate instead.

`site/middleware.js` is the password gate. It is Vercel Routing Middleware, which runs on every plan. Visitors without a valid cookie get a password page. A correct password sets an HttpOnly cookie for 30 days. `node test/gate.mjs` tests it.
