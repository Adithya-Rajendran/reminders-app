# Widget architecture audit

How widgets are built today, where they're still entangled with the app, and a
phased plan to finish separating the two. This is the companion to
[widget-connections.md](widget-connections.md) (the connection layer that began
the decoupling) and [adding-a-widget.md](adding-a-widget.md) (the current
author-facing contract).

**Status:** audit + implementation roadmap. The physical tier split now exists;
legacy root modules remain as compatibility shims while import sites migrate.

## Why this exists

The connection layer gave widgets *declared, validated, least-privilege* access
to app state — a widget can only read the interfaces it plugs into. That fixed
the "context bag" problem at the boundary, but most widgets still reach around it:
they import the shared task store, buses, the raw HTTP client, and app-level
components directly. The result is that a widget is not a self-contained unit you
can test, restyle, or change in isolation — touching shared infra silently breaks
widgets, and the logic worth testing is trapped inside JSX.

The goal is an **internal boundary**: a small, stable **widget SDK** that widgets
import from, a **host** they cannot import, data delivered **through the
connection layer**, co-located styles and tests per widget, and an
ESLint-enforced rule that keeps it that way. Not third-party plugins, not iframe
isolation — just a clean in-repo seam that makes widgets cheap to test and safe
to change.

## How a widget works today

A widget is two halves plus a render entry:

- a **pure descriptor** in `app/client/src/widgets/manifest.js` (`type`, `label`,
  `plugs`, sizing) — node-testable;
- a **renderer** in `app/client/src/widgets/registry.jsx` pairing the descriptor
  with an icon and a `render(w, ctx)`;
- a **component** in `app/client/src/widgets/<Name>Widget.jsx`.

`Dashboard.jsx` auto-connects each widget's `plugs` to the app's slots
(`resolveConnections` → `selectCtx`) and passes only the connected interfaces as
`ctx`. That part is clean. Everything below is what still leaks around it.

## Coupling inventory

| Coupling | Where | Detail |
|---|---|---|
| Shared task store / hook | every task widget | `useTaskList` imported directly from `useTasks.js`; `CuesWidget` and `CalendarWidget` reach further into `taskstore.js` (`patchTask` / `subscribe` / `ensureLoaded`), bypassing the hook. |
| Cross-widget buses | task + notes widgets | `tasksbus.js` (`emitTasksChanged`/`onTasksChanged`) and `notesbus.js` imported directly. |
| Raw HTTP client | Calendar, Notes, Reminders, Cues | `api.js` (`api` / `tk` / `notesApi` / `reminderGroups`) called directly — Calendar → `/api/caldav/*`, `/api/calendar/events`; Notes → 20+ `/api/notes*`; Reminders/Cues → `/api/reminder-groups`. |
| Per-widget localStorage, **not** instance-scoped | Reminders, Frog, Review, Notes | Global keys: `reminders-collapsed-groups`, `frog-pick`, `review-last-reviewed`, `notes-expanded-folders` / `notes-recent` / `notes-sort`. Two instances of the same widget share state. |
| Monolithic styles | all widgets | Every widget class (`.cal-*`, `.flow-*`, `.notes-*`, `.tree-*`, `.rv-*`, `.eq-*`, `.frog*`, `.tasklist`, `.habit-*`, `.rem-*`) lives in the 1,700-line `styles.css`. |
| Reaching "up" into app modules | several | Widgets import `../GroupPicker.jsx`, `../NoteEditor.jsx`, `../NoteContextMenu.jsx`, `../TrashView.jsx`, `../PromptModal.jsx`, `../usePopover.js`, `../useWidgetSize.js`, `../tasklib.js`, `../groups.js`, `../storage.js`, `../icons.jsx` — nothing constrains this. |

## Boundary gaps

Numbered for reference from issues.

1. **`tasks` is a declarative-only plug.** In `connections.js` it has `keys: []`
   and injects nothing; widgets consume it via direct `useTaskList` import. The
   plug documents intent but delivers no data. `reminder-groups` partially
   delivers (`onNewGroup`) but widgets still import the fetch + recents directly;
   notes has no interface at all.
2. **Settings can't be contributed by a widget.** `SettingsModal.jsx` hardcodes
   its sections (`ReminderGroupsSection`, `NotesFolderSection`,
   `ConnectionsSection`). A widget cannot add its own panel or declare
   per-instance config.
3. **manifest↔registry sync is a runtime throw only.** `registry.jsx` throws on
   load if a descriptor lacks a renderer — but there's no CI gate, because JSX
   can't be imported by the framework-free node tests.
4. **No module-level least-privilege.** The connection layer constrains what a
   widget *receives*, but a widget can still `import` anything in the tree
   regardless of its declared plugs.
5. **ctx-key collision risk.** `APP_INTERFACES` maps interfaces → `ctx` keys with
   no global key-uniqueness guard; two interfaces could claim the same key.
6. **No lifecycle / capability declaration.** A widget can't declare "needs
   CalDAV" / "needs Nextcloud", has no per-instance config schema, and no
   init/teardown hooks. The "unconfigured account" branches are ad-hoc per widget.
7. **Shared infra has no stable, documented API contract.** `usePopover`,
   `GroupPicker`, `TaskRow`, the buses, and `taskstore` are imported widely with
   no documented surface — a refactor silently breaks widgets.

## Testing & CI gaps

- **No component render tests.** 32 framework-free node tests cover pure `.js`
  modules well (`taskviews`, `tasklib`, `habitstats`, `reviewstats`, `notetree`,
  `dashlayout`, `widgetsize`, `connections`, `widget-contract`). Everything that
  lives in JSX is untested at the unit level.
- **High-risk logic trapped in JSX:** Calendar event marshaling (`loadEvents`
  merge/skip/tag), Notes tree DND state machine + autosave/etag, Cues canvas
  pointer math (`toContent` / `targetAt` / `edgePath`) + flow persistence. Medium
  risk: Reminders optimistic edits/undo + quick-add parsing.
- **e2e is the only integration coverage** (Playwright + Radicale + wsgidav, 8
  serial specs, happy-path only).
- **No type checking** (plain JS), and the **`/api/*` contract is implicit** —
  undocumented request/response shapes that every widget couples to.

CI (`.github/workflows/ci.yml`) runs `lint-build` (lint, build, syntax check,
`npm test`), `docker` (same in the image `test` stage), and `e2e`. Any new check
must keep all of these green.

## Target architecture

A three-tier split under `app/client/src/`, reached incrementally via re-export
barrels so current import paths keep working during the transition.

```
host/         app shell + canvas (Dashboard, App, SettingsModal, settings/*) — widgets may NOT import this
widget-sdk/   the ONLY surface widgets may import (besides their own folder + domain/)
domain/       pure JS, no React/DOM (tasklib helpers, taskviews, habitstats, notetree, widgetsize, dashlayout, groups)
data/         shared single-fetch stores + buses + HTTP client (api, taskstore, useTasks, tasksbus, notesbus, savequeue) — host-owned
connections.js  the boundary contract (stays; pure, node-tested)
widgets/<name>/  WidgetX.jsx + widgetx.css + WidgetX.test.jsx, co-located
```

As of 2026-07-04, the `host/`, `widget-sdk/`, `domain/`, and `data/` tiers are
present in source. Root-level module paths are compatibility shims that preserve
existing exports for tests and external import sites during the transition.

### Module classification

| Module(s) | Tier | Notes |
|---|---|---|
| `api.js`, `taskstore.js`, `tasksbus.js`, `notesbus.js`, `savequeue.js` | **data (host)** | Widgets reach these only through `ctx` capabilities. |
| `useTasks.js` (`useTaskList`) | **data → SDK bridge** | Exposed to widgets only as `ctx.tasks.useTaskList` (hook-reference pattern). |
| `tasklib.js` | **split** | Pure helpers (`dueChip`, `pdotClass`, `parseQuickAdd`, `PRIORITIES`, `ZERO_DATE`, `isRealDate`, `timeLabel`) → `domain`; mutating `updateTask`/`createTask`/`deleteTask` (call `tk`) → `data`, exposed via the `tasks` capability. |
| `taskviews.js`, `habitstats.js`, `reviewstats.js`, `notetree.js`, `widgetsize.js`, `dashlayout.js`, `groups.js` | **domain** | Pure; already (mostly) node-tested. |
| `storage.js` | **SDK** | Re-export + new `widgetStorage(instanceId)` helper. |
| `useWidgetSize.js` | **split** | `useWidgetSize` consumer hook → SDK; `useElementSize` + provider → host (Dashboard owns the observer). |
| `usePopover.js`, `icons.jsx`, `GroupPicker.jsx`, `TaskRow.jsx`, `parts.jsx`, `DateTimePicker.jsx` | **SDK** | Shared widget UI + hooks. |
| `connections.js` | **boundary** | Stays put; pure. |

### Widget-SDK public surface

`widget-sdk/index.js` re-exports the *only* things a widget may import (besides
its own folder and `domain/`): UI primitives (`TaskRow`, `DateTimePicker`,
`GroupPicker`, `SkeletonRows`, `EmptyState`, `ErrorState`, `UndoBar`, `icons`),
hooks (`useWidgetSize`, `usePopover`), size comparators, storage helpers
(including `widgetStorage(instanceId)`), and commonly-needed pure helpers. **Data
and server access come exclusively through `ctx`** — never by importing
`api`/`taskstore`/`tasksbus`/`useTasks`.

### Delivering data through `ctx` (closes gap #1)

`useTaskList` is a React hook, so it can't be passed as a value and called
conditionally. The clean pattern is a **hook reference** on a frozen capability
object, which widgets call at the top level (rules-of-hooks satisfied because the
reference is stable):

```js
// connections.js — give the interface real keys
'tasks': { scope: 'app', summary: '…', keys: ['tasks'] }

// Dashboard.jsx — appCtx supplies a frozen capability (single shared store preserved)
const tasks = Object.freeze({
  useTaskList,                          // hook reference
  onChanged: onTasksChanged, emitChanged: emitTasksChanged,
  ensureLoaded, subscribe, patch: patchTask,   // for Calendar / Cues
  update: updateTask, create: createTask, del: deleteTask,
})

// widget — consume from ctx, import nothing from data/
export default function UpcomingWidget({ tasks: T }) {
  const { state, onToggle } = T.useTaskList(selector)
}
```

`reminder-groups` extends the same way (deliver fetch + recents + `onNewGroup`); a
new `notes` capability wraps `notesApi` + the notes bus so `NotesWidget` stops
importing `api.js`/`notesbus.js`. This routes access through the connection
*without* losing the single-fetch shared store, and makes the data layer mockable
in component tests.

## Roadmap

Each phase keeps all CI checks green (`lint`, `build`, `npm run check`,
`npm test`, e2e).

| Phase | Goal | Representative files | Verify |
|---|---|---|---|
| **0 — SDK seam** | Create `widget-sdk/index.js` as a pure re-export barrel (zero file moves). Add an ESLint `widgets/**` block using `no-restricted-imports` at `warn` to forbid reaching `api`/`taskstore`/`tasksbus`/`useTasks`/host internals. | `widget-sdk/index.js`, `eslint.config.js` | lint (warnings only — CI green), build, `npm test` |
| **1 — data via ctx** | Route `tasks`, `reminder-groups`, `notes` through `connections.js` capabilities; widgets drop direct `data/` imports. | `connections.js`, `Dashboard.jsx`, `registry.jsx`, task widgets, `NotesWidget.jsx`, `connections.test.mjs` | `npm test` (contract + connections), build, e2e |
| **2 — component harness** | Add vitest + jsdom + Testing Library as a separate `*.test.jsx` suite (`npm run test:component`); cover Calendar/Notes/Cues/Reminders; `registry.test.jsx` turns gap #3 into a CI gate. | `package.json`, `vitest.config.js`, `test/setup.vitest.js`, `*.test.jsx`, `ci.yml`, `Dockerfile` | `npm run test:component`, CI |
| **3 — co-locate styles** | Move per-widget classes to co-located `.css` (Cues → Review → Frog → Calendar → Notes → Reminders), one widget per PR; shared primitives + theme vars stay global. | `widgets/<name>/<name>.css`, trimmed `styles.css` | build, per-widget e2e, manual light/dark |
| **4 — relocate + harden** | Physically move modules into `host`/`widget-sdk`/`domain`/`data` behind barrels; flip boundary lint to `error`; add `widgetStorage`; manifest `requires`/`settingsPanel`/`config`; SDK contract doc + surface tripwire test. | bulk moves, `SettingsModal.jsx`, `manifest.js`, `registry.jsx`, `storage.js` | all CI checks |

## Flags / prerequisites

- **Network installs (Phase 2):** `vitest`, `jsdom`, `@testing-library/*` are new
  devDependencies — `npm i -D` needs network and updates `package-lock.json`. Do
  it once as a fix-phase prerequisite and commit the lockfile so CI / `npm ci` /
  the Docker `deps` stage pick them up. The optional `eslint-plugin-boundaries`
  (Phase 4) is likewise a network install; `no-restricted-imports` avoids it for
  Phases 0–3.
- **Filename split:** the node runner globs `*.test.mjs`; vitest globs
  `*.test.{js,jsx}`. Use `.test.jsx` for component tests so the two runners never
  collide and `test/run.mjs` needs no change.
- **jsdom has no `ResizeObserver`:** `useWidgetSize` already degrades to the
  `md/md` tier, so tests render the standard layout — assert against that, or stub
  the observer in the setup file to exercise other tiers.
- **localStorage key migration (Phase 4):** namespacing changes the key, so add a
  one-time read-old/write-new shim per widget or document a one-time reset of
  collapsed-section / frog / review / notes state.
- **Boundary lint at `error`:** only CI-green after Phases 1–3 remove every
  offending import; keep it `warn` until then.

## Tracked work

One GitHub issue per item below (severity / phase), collected under an umbrella
tracking issue.

| Title | Severity | Phase |
|---|---|---|
| Add widget-SDK barrel (`widget-sdk/index.js`) | high | 0 |
| Enforce widget import boundaries via ESLint | high | 0 |
| Deliver `tasks` through the connection layer | high | 1 |
| Route `reminder-groups` through `ctx` | med | 1 |
| Add a `notes` capability | med | 1 |
| Add vitest + jsdom + Testing Library harness | high | 2 |
| Component-test Calendar event marshaling | high | 2 |
| Component-test Notes tree DND + autosave wiring | high | 2 |
| Component-test Cues pointer/canvas math | high | 2 |
| Component-test Reminders optimistic edits/undo + quick-add | med | 2 |
| CI gate for manifest↔registry sync | med | 2 |
| Co-locate widget CSS (incremental) | med | 3 |
| Per-instance localStorage namespacing | med | 4 |
| Relocate modules into host/sdk/domain/data + harden boundaries | med | 4 |
| Widget-SDK API contract doc + surface tripwire test | med | 4 |
| Manifest extensions: `requires` / `settingsPanel` / per-instance `config` | low | 4 |
| Widget lifecycle hooks (`init` / `teardown`) | low | 4 |
| Document `/api/*` contract + JSDoc typedefs | low | 4 |
