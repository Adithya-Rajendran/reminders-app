# Screenshot harness (`test/e2e/shots/`)

Standalone visual-verification harness for the reminders-app polish overhaul
(see the plan doc's "Verification backbone"). **Not wired into CI** — run it
by hand (or from the manager side of the PR loop) to shoot the app at three
viewports x two themes x three seeded boards, then pixel-diff two shoots to
see exactly what a change moved.

Everything here is an *adapted copy* of `test/e2e/{setup-backends.sh,
start-bff.sh,provision.mjs,lib.mjs,playwright.config.mjs}` — same Radicale +
wsgidav config, same non-loopback-IP convention, same dev-bypass auth — but
running entirely in Docker containers instead of a host venv/host node, with
its own throwaway `shots-*` backends/BFF so it never touches `test/e2e/`'s own
`.state/`. **`test/e2e/` itself is never modified.**

## Why Docker for everything

The host's `node` is v24 (ABI-mismatched with this repo's native deps) and
`app/node_modules`/`app/public` are root-owned in some checkouts — so nothing
here ever runs `npm`/`node` directly against the repo checkout. Every step
(backends, BFF, seeding, capture, diff) runs inside a container:

- **Backends** (`shots-radicale`, `shots-wsgidav`): one image
  (`docker/backends.Dockerfile`, `python:3-slim` + `pip install radicale
  wsgidav cheroot` at *build* time), run twice with different `CMD` args.
- **BFF** (`shots-bff`): `app/Dockerfile`'s `runtime` stage (already has the
  built SPA + server + pruned prod `node_modules` — no build tools needed at
  run time), started with `NODE_ENV=development ALLOW_DEV_BYPASS=1
  COOKIE_INSECURE=1` so Playwright/seeds authenticate via the `x-dev-user`
  header instead of standing up OIDC.
- **Seeding** (`seed-*.mjs`): plain `node:22-bookworm-slim`, talks to the BFF
  purely over `fetch()`. The repo is bind-mounted **read-only** at `/repo` so
  the showcase layout can import the app's own pure grid module
  (`app/client/src/dashlayout.js` — `repack`/`COLS`/`GRID_V`, no deps) instead
  of hand-copying its math (which would silently drift once PR 1 changes the
  breakpoints).
- **Capture/diff** (`capture.mjs`, `diff.mjs`): `mcr.microsoft.com/playwright:v<version>-noble`,
  where `<version>` is **derived at every `run.sh` invocation** from
  `test/e2e/package-lock.json`'s resolved `@playwright/test` version (currently
  `1.61.0`) — never hardcoded, so a Playwright bump in `test/e2e/` is picked up
  automatically. `capture.mjs` also imports `BREAKPOINTS`/`COLS`/`WIDGET_MANIFEST`
  from `/repo` for the same drift-proofing reason.

All containers run `--network host` (so they share the sandbox's real
non-loopback IP the way `test/e2e/` does — `app/server/caldav.js` blocks
`127.x`/`169.254.x` unconditionally, so `localhost` is a dead end on purpose)
and are named `shots-*` so `teardown.sh` can find and remove them by name.
Every container that writes host-visible files runs `--user "$(id -u):$(id
-g)"` so nothing ends up root-owned (`.state/`, `output/`, `node_modules/` —
all gitignored).

This package has its **own** `package.json`/`package-lock.json`
(`playwright-core` pinned to match the derived version, plus `pixelmatch` +
`pngjs` for `diff.mjs`) so `test/e2e/`'s CI-installed lockfile is never
touched. `node_modules/` is gitignored; `run.sh` installs it on first use
inside a `node:22-bookworm-slim` container (`npm ci`, host-owned). If you ever
need to regenerate `package-lock.json` by hand (e.g. after bumping
`playwright-core`'s pin to match a `test/e2e/` Playwright bump), do it the
same way instead of using host `npm` (which is v11 here and reformats the
lockfile):

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -v "$PWD:/work" -w /work node:22-bookworm-slim \
  npm install --package-lock-only --no-audit --no-fund
```

## Usage

```bash
# Shoot all three boards (showcase / empty / no-widgets) at every
# viewport x theme, tearing everything down afterward:
bash test/e2e/shots/run.sh --step baseline

# Just one board, and leave the backends/BFF running for a fast follow-up shoot:
bash test/e2e/shots/run.sh --step baseline --board showcase --keep-up

# Skip the (expensive) BFF image rebuild — reuses the shots-bff:local image
# from the previous run. Useful when only iterating on capture.mjs itself.
bash test/e2e/shots/run.sh --step wip --no-rebuild --keep-up

# Compare two steps (pixelmatch every matched PNG, write .diff.png + a JSON
# summary under output/diff-<A>-vs-<B>/, print a sorted table):
bash test/e2e/shots/run.sh --diff baseline wip
```

Output lands in `test/e2e/shots/output/<step>/<board>/`:

```
<viewport>-<theme>.png                       # full-page
widgets/<viewport>-<theme>-<type>.png        # one crop per widget type
```

`<viewport>` is one of `1512x982` / `2560x1440` / `5120x2160`; `<theme>` is
`dark` / `light`; `<type>` is a widget manifest type — currently 12 of them
(`overview`, `inbox`, `reminders`, `upcoming`, `calendar`, `notes`, `notepin`,
`review`, `cues`, `triage`, `daily`, `focus`), read from `WIDGET_MANIFEST` at
run time so a widget added to the app gets a crop with no harness change. The
`no-widgets` board has no per-widget crops (there are no widgets). There is no
extra `triage-matrix` crop anymore: the de-gamified Prioritize widget (still
type `triage` — persisted types never rename) renders its Eisenhower matrix
inline rather than behind a Matrix tab, so the plain frame crop already shows
it.

Each page load also prints a diagnostic line:

```
viewport=2560x1440 measured=2512px tier=xxl cols=64 actualCols≈64
```

`measured` is `.grid-wrap`'s real `clientWidth`; `tier`/`cols` are what the
app's *own* `BREAKPOINTS`/`COLS` (imported from the mounted `dashlayout.js`)
say that width should resolve to; `actualCols` is a cheap real-world check
(derived from the Reminders widget's actual rendered pixel width against its
grid `w` in the currently-saved layout). 2560 and 5120 used to resolve one
tier short of their nominal breakpoint (`.grid-wrap`'s ~48px padding pushes
the measured width just under the boundary) — the bug this harness was built
to catch, since fixed by offsetting the wide breakpoints 64px below their
nominal monitor widths (`dashlayout.js`). If the diagnostic ever shows a
2560/5120 viewport a tier short again, that's a regression — fix it in the
app's breakpoints, not by editing anything in this directory.

### Boards

- **showcase** — EVERY widget type in `WIDGET_MANIFEST` (built dynamically —
  currently 12), shelf-packed at their manifest default sizes, with real data
  in every one (tasks across overdue/today/this-week/undated/done buckets,
  labels, a `time_estimate`+`dread` pair, 3 cues with 2 placed + linked on
  the Cues canvas and 1 queued, 2 calendar events, a 2-task daily plan, 3
  notes including a markdown table+task-list note and a long no-linebreak
  paragraph for the measure-cap check). How the v2 widgets are fed:
  - **Inbox** shows open `clarified: false` tasks (`selectInbox`), and a task
    that never set the flag reads back unclarified — so every regular task is
    seeded `clarified: true` and exactly three raw captures are left
    unclarified. The Inbox thus shows its clarify card + "Up next" peek
    instead of swallowing the whole task list.
  - **Prioritize** (type `triage`) buckets its Eisenhower matrix by the
    EXPLICIT `important` flag (not priority) — three tasks carry it, spread
    so Q1 (important+urgent) gets two, Q2 (important+later) one, and the
    "Most important" callout names 'Prep board deck'. Overview's
    most-important line shares that same selector/pick.
  - **Overview** aggregates the seeded tasks/events (status line, overdue and
    due-today counts, next event/task, capture row) — nothing extra to seed.
  - **Note** (`notepin`) has no seedable config: WHICH note is pinned is
    per-instance UI state (localStorage via `widgetStore`, written when the
    user picks a note in the widget) — deliberately left unset rather than
    faking the app's internal storage. Unconfigured it falls back to the most
    recently edited note, so its crop is still non-empty: expect the
    last-seeded note ('Q3 planning recap'), not a hand-picked one. (The seed
    spaces the note saves >1s apart — WebDAV mtimes are second-granular, and
    a tie would make the fallback follow server listing order instead.)
- **empty** — the exact same layout, zero data (every widget's empty state;
  Note shows "No notes yet", Inbox shows "Inbox zero").
- **no-widgets** — an empty board (Dashboard's "add a widget" card).

### Port collision with `test/e2e/`

This harness and `test/e2e/` both bind `5232` (Radicale), `8081` (wsgidav) and
`8080` (BFF) on `--network host`. **Don't run `test/e2e/run.sh` and
`test/e2e/shots/run.sh` at the same time** — whichever starts second will fail
to bind. They use separate credentials/collection paths (`shots`/`shotspw` at
`/shots/...` here vs. `e2e`/`e2epw` at `/e2e/...` there) and separate
`.state/` directories, so there's no data collision — only a port one.

## Files

| File | Purpose |
| --- | --- |
| `docker/backends.Dockerfile` | Radicale + wsgidav, one image, two containers |
| `setup-backends.sh` | Build the backends image, start `shots-radicale`/`shots-wsgidav`, wait for both, seed the CalDAV calendar |
| `start-bff.sh` | Build (or reuse, `--no-rebuild`) `shots-bff:local` from `app/Dockerfile`'s `runtime` stage, start it, provision the CalDAV account + notes WebDAV account |
| `teardown.sh` | `docker rm -f` every `shots-*` container (idempotent) |
| `seedlib.mjs` | Shared seed helpers (fetch wrapper, task/notes/event/plan/layout builders) — imports the app's pure `dashlayout.js`/`manifest.js` from `/repo` |
| `seed-showcase.mjs` | Every manifest widget type + full data set |
| `seed-empty.mjs` | Same layout, zero data |
| `seed-no-widgets.mjs` | Empty widgets/layouts board |
| `capture.mjs` | Playwright capture: full-page + per-widget PNGs, the tier diagnostic |
| `diff.mjs` | Pixelmatch two `output/<step>` trees, write `.diff.png` + `summary.json` |
| `run.sh` | Orchestrates all of the above; `--diff` mode |
| `package.json`/`package-lock.json` | `playwright-core`/`pixelmatch`/`pngjs` only — separate from `test/e2e/`'s |

## Selftest

`bash test/e2e/shots/run.sh --step selftest` is a good smoke test: it should
seed all three boards without error, produce 3 viewports x 2 themes x
(1 full-page + one crop per manifest widget type — currently 12) PNGs for
showcase/empty (and just the full-page shot for no-widgets — 162 PNGs total
at 12 types), print the tier diagnostic for every page load, and
`node test/e2e/shots/diff.mjs selftest selftest` (or `run.sh --diff selftest
selftest`) should report 0% changed everywhere.
