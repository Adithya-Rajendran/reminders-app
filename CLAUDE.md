# reminders-app — repo guide

Self-hosted task + calendar dashboard. React SPA + Node/Express BFF; tasks,
reminders, and events live in the user's own CalDAV server, notes in their
WebDAV (Nextcloud). A small SQLite file holds only what's cheap to recreate
(layouts, encrypted account config, sessions).

## Commands (run from `app/`)

```bash
npm run dev      # Vite dev server (proxies /api & /auth to a running BFF)
npm run build    # build the SPA into app/public
npm run lint     # ESLint over client + server
npm start        # run the BFF (needs SESSION_SECRET; serves app/public)
npm test         # unit tests — runs every test/*.test.mjs (plain node, no framework)
npm run check    # server syntax check (node --check over server/*.js)

# CI parity in a container (no local toolchain needed): lint + build + syntax + tests
docker build --target test app/
```

`npm test` (test/run.mjs) discovers and runs all `test/*.test.mjs` and aggregates
the result, so a new test file is picked up with no wiring. Add `-- <substr>` to
filter (e.g. `npm test -- connections`).

CI (`.github/workflows/ci.yml`) runs: lint, build, syntax check, unit tests,
component tests, the same checks in the image's `test` stage + a boot smoke of
the production image (`app/scripts/smoke-image.sh`), and the Playwright e2e
suite (`test/e2e/`, real Radicale + wsgidav backends — fully on GitHub-hosted
runners). Keep ALL of them green. Lint is warning-free — don't add new warnings.

## Map

```
app/client/src/
  main.jsx, App.jsx        # bootstrap, auth gate, top bar, dashboard tabs
  Dashboard.jsx            # generic widget grid (react-grid-layout) — widget-agnostic
  dashlayout.js            # pure grid math (cols, scaling, placement) — node-tested
  widgets/manifest.js      # pure widget metadata (type/label/plugs/sizing) — node-tested
  widgets/registry.jsx     # the render layer: pairs each manifest entry with its icon + render
  widgets/*.jsx            # one file per widget + shared parts (TaskRow, parts.jsx)
  connections.js           # widget↔app interface layer (Snap/Juju-style plugs/slots) — node-tested
  usePopover.js            # shared outside-click/Esc popover hook
  notetree.js, savequeue.js, notepaths.js, storage.js  # pure logic (node-tested)
  api.js                   # fetch helpers (api/tk/notesApi), 401 -> login redirect
  fetchcache.js            # shared TTL+coalescing cache for cheap reads (projects/accounts/groups) — node-tested
  calevents.js             # task -> FullCalendar event mapping (calendar's task overlay) — node-tested
  useTasks.js, tasklib.js  # task-list hook (optimistic updates + undo), task utils
  tasksbus.js              # cross-widget "tasks changed" event bus
  icons.jsx, styles.css    # inline SVG icons; theme tokens (light/dark + accents)
  SettingsModal.jsx        # modal shell + CalDAV account flow
  settings/*.jsx           # one file per settings section (notes folder, groups, providers)
app/server/
  index.js                 # Express app: session, auth guard, route mounting
  config.js                # SQLite (layouts, dashboards, encrypted account config)
  tasks_caldav.js, caldav.js, recurrence_caldav.js  # CalDAV VTODO/VEVENT layer
  readcache.js             # read-path primitives: request coalescing + fresh/ctag/report decision — node-tested
  daily_plan.js            # server-stored daily plan (GET/PUT /api/daily-plan) — node-tested
  mcp.js, mcp_tools.js     # embedded MCP server (/mcp, bearer auth) + per-widget tool registry (docs/mcp.md)
  mcp_token.js, mcp_validate.js  # token hash + input validator (pure, node-tested)
  vtodo.js, util.js        # shared ICS parsing + tiny helpers (node-tested)
  notes.js, webdav.js      # Markdown notes over WebDAV
  reminder_groups.js       # group <-> calendar mapping
  valarm-poller.js, events.js  # VALARM poll -> per-user SSE feed
app/test/                  # *.test.mjs, run with plain `node` (no JSX imports)
k8s/                       # example manifests; docs/ has screenshots + guides
```

## Conventions

- Plain ESM JavaScript everywhere (no TypeScript); React 19 function components.
- **Adding a widget = one component file + one registry entry** — see
  `docs/adding-a-widget.md`. Never rename/reuse a widget `type`: it's persisted
  in user layouts (unknown types are silently dropped on load, by design).
- Server: one module per feature, mounted in `server/index.js`, every `/api/*`
  route behind `requireAuth`, errors via `next(e)` to the JSON error handler.
- Comments explain *why* (constraints, footguns), not *what*.
- Logic worth testing goes in plain `.js` modules so the framework-free node
  tests can import it.
