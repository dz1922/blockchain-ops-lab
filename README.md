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
LANGX=en node test/play.js # plays every lab end to end in headless Chromium (LANGX=zh for Chinese, ONLY=solana for one network)
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
| `desc` | `S.LL(zh, en)`: one line under the module heading on the landing page. |
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
| `tick(w, dt)` | Optional. Runs after the network's own tick; use it for lab-specific checks, such as raising a trap flag when a threshold is crossed. |

## Three steps per network

Each network module on the landing page has three steps:

1. **Fundamentals** (`S.registerLesson`): interactive explanations with small widgets and quizzes. No terminal.
2. **Run a validator** (a scenario with `steps`): a guided lab that builds a validator from scratch in the simulator.
3. **Production challenges** (a scenario with `objectives`): labs that start with an alert firing.

### Lesson contract

`S.registerLesson({...})`, in `src/NN-learn-<chain>.js`:

| Field | Purpose |
|---|---|
| `id`, `network`, `title`, `tagline`, `minutes` | The step-1 card. `title` and `tagline` are `S.LL`. |
| `chapters` | `[{ title, body, widget?, after?, quiz? }]` |
| `chapter.body`, `chapter.after` | `S.LL` HTML, rendered before and after the widget. Use `<p>`, `<h3>`, `<ul>`, `<table>`, `<div class="note">` (or `note warn`), `<pre class="term-snip">`. |
| `chapter.widget(el)` | Builds an interactive widget inside `el`. Read text with `S.L(zh, en)`; the chapter re-mounts on a language change. Helpers in `S.wg`: `el`, `slider`, `buttons`, `stats`, `meter`, `loop` (requestAnimationFrame), `every`. Anything started with `loop`/`every` stops when the chapter closes. Start with `S.wg.el('div', 'wg-title', S.L('动手试试', 'Try it'))`. Inline SVG is fine; its `text` uses the mono font. |
| `chapter.quiz` | `[{ q, options: [S.LL…], answer, why }]`. A chapter with a quiz counts as done when every question is answered correctly; a chapter without one counts when opened. |

### Guided lab (step 2)

A scenario with `steps: [{ text, how, after?, check(w) }]` instead of `objectives`. It gets `track: 'run'` automatically.

- Steps complete in order, and a completed step stays completed.
- `how` is HTML shown under the current step in the goals box. Clicking a `<code>` there puts it into the terminal, so each `<code>` should be one complete command.
- `after` appears in the event log when the step completes and in the review, to explain what just happened.
- `hint` prints the current step's `how`.
- The lab finishes when the last step completes.
- `forbidden` traps still apply.

## Adding a network

Write `src/NN-net-<chain>.js`, its labs in `src/NN-scenarios-<chain>.js`, its fundamentals and guided lab in `src/NN-learn-<chain>.js`, and its test cases in `test/labs/<chain>.js`; nothing else needs to change. Every lab must be played by at least one test case. `test/play.js` opens every lesson chapter, checks that the widget renders, and answers every quiz. Source material:

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

The root `vercel.json` turns off Vercel's own Git deployments. Only the workflow deploys, from the tested and gated `dist/`. If the project is connected to the repository in the Vercel dashboard, those builds would skip the tests and the gate.

`site/middleware.js` is the password gate. It is Vercel Routing Middleware, which runs on every plan. Visitors without a valid cookie get a password page. A correct password sets an HttpOnly cookie for 30 days. `node test/gate.mjs` tests it.
