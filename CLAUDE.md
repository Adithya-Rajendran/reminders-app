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
for t in test/*.test.mjs; do node "$t"; done   # unit tests (plain node, no framework)
for f in server/*.js; do node --check "$f"; done  # server syntax check
```

CI (`.github/workflows/ci.yml`) runs exactly these: lint, build, syntax check,
tests. Keep all four green. Lint is warning-free — don't add new warnings.

## Map

```
app/client/src/
  main.jsx, App.jsx        # bootstrap, auth gate, top bar, dashboard tabs
  Dashboard.jsx            # generic widget grid (react-grid-layout) — widget-agnostic
  widgets/registry.jsx     # THE widget registry: every widget is declared here
  widgets/*.jsx            # one file per widget + shared parts (TaskRow, parts.jsx)
  api.js                   # fetch helpers (api/tk/notesApi), 401 -> login redirect
  useTasks.js, tasklib.js  # task-list hook (optimistic updates + undo), task utils
  tasksbus.js              # cross-widget "tasks changed" event bus
  icons.jsx, styles.css    # inline SVG icons; theme tokens (light/dark + accents)
  SettingsModal.jsx        # CalDAV accounts, notes config, reminder groups
app/server/
  index.js                 # Express app: session, auth guard, route mounting
  config.js                # SQLite (layouts, dashboards, encrypted account config)
  tasks_caldav.js, caldav.js, recurrence_caldav.js  # CalDAV VTODO/VEVENT layer
  notes.js, webdav.js      # Markdown notes over WebDAV
  reminder_groups.js       # group <-> calendar mapping
  valarm-poller.js, events.js  # VALARM poll -> per-user SSE feed
app/test/                  # *.test.mjs, run with plain `node` (no JSX imports)
k8s/                       # example manifests; docs/ has screenshots + guides
```

## Conventions

- Plain ESM JavaScript everywhere (no TypeScript); React 18 function components.
- **Adding a widget = one component file + one registry entry** — see
  `docs/adding-a-widget.md`. Never rename/reuse a widget `type`: it's persisted
  in user layouts (unknown types are silently dropped on load, by design).
- Server: one module per feature, mounted in `server/index.js`, every `/api/*`
  route behind `requireAuth`, errors via `next(e)` to the JSON error handler.
- Comments explain *why* (constraints, footguns), not *what*.
- Logic worth testing goes in plain `.js` modules so the framework-free node
  tests can import it.
