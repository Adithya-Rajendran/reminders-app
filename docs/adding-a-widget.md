# Adding a dashboard widget

Widgets are self-contained: the dashboard (`app/client/src/host/Dashboard.jsx`)
is generic and learns about widgets only through the registry at
`app/client/src/widgets/registry.jsx`. Adding a small widget can still be one
component file plus one registry entry. For any widget with meaningful state,
layout tiers, drag/drop, or more than one child component, use a folder under
`app/client/src/widgets/<widget-name>/` so multiple people can work on different
widgets without touching the host app or each other's files.

> **Read [`docs/widget-sdk.md`](./widget-sdk.md) first** — it's the authoritative
> surface reference. In short: a top-level widget imports **only** from
> `../widget-sdk` (or `../../widget-sdk` from a nested widget folder) plus
> `react` and its own siblings, and gets all app data through `ctx` capabilities
> (`ctx.tasks`, `ctx.groups`, `ctx.notes`, `ctx.calendar`, `ctx.events`,
> `ctx.projects`, `ctx.plan`, `ctx.onOpenSettings`) — **not** by importing
> `api.js`, the task store, or the buses. ESLint enforces the boundary. The
> snippets below use those SDK imports throughout.

## 1. Create the component

For a small widget, add `app/client/src/widgets/MyWidget.jsx`. A minimal
client-only widget:

```jsx
import React, { useEffect, useState } from 'react'

export default function ClockWidget() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <div style={{ fontSize: 32, textAlign: 'center' }}>{now.toLocaleTimeString()}</div>
}
```

For a larger widget, prefer:

```text
app/client/src/widgets/my-widget/
  MyWidget.jsx
  layout.js
  MyWidget.css
  ChildPart.jsx
  README.md
app/client/src/widgets/MyWidget.jsx  # compatibility shim if this replaces an old file
```

Point the registry loader at the folder implementation. Keep pure sizing/layout
decisions in `.js` modules so component tests can cover them without rendering
the whole widget.

Conventions worth reusing — **all from the widget SDK path for your folder**
(`../widget-sdk` or `../../widget-sdk`; the barrel re-exports the shared UI,
hooks, pure helpers, icons, and per-instance storage; see
[`docs/widget-sdk.md`](./widget-sdk.md) for the full export list):

- **Loading / empty / error states** — the SDK exports `SkeletonRows`,
  `EmptyState`, `ErrorState`, `ReconnectBanner`, and `UndoBar` so every widget
  feels consistent.
  ```jsx
  import { SkeletonRows, EmptyState } from '../widget-sdk'
  ```
- **App data** — reach it through `ctx`, never `api.js`. `ctx.tasks` is the
  shared task store, `ctx.notes` the notes client, `ctx.calendar` the event CRUD,
  `ctx.groups`/`ctx.projects`/`ctx.events`/`ctx.plan` the rest. A widget receives
  **only** the capabilities it declared in `plugs` (see "Connect it to the app"),
  so read `ctx.foo` only if you plugged `foo`. The request/response shapes behind
  these capabilities are documented in [`docs/api.md`](./api.md).
- **Task lists** — the SDK's `useTaskList(ctx.tasks, selector)` hook gives you
  the shared store's tasks (filtered by your `selector`), load state, optimistic
  toggle/delete/schedule/priority, and Undo for free; render rows with the
  exported `TaskRow`. (See the task-list section below.)
- **Cross-widget refresh** — task mutations through `ctx.tasks` already broadcast
  on the shared bus, so sibling widgets update instantly. If you mutate tasks by a
  path that bypasses the hook, call `ctx.tasks.emitChanged()`; subscribe with
  `ctx.tasks.onChanged(fn)`.
- **Icons & styling** — icons are inline SVG components re-exported from the SDK
  (`import { IconBell } from '../widget-sdk'`; add new ones in `icons.jsx`). Use
  the CSS variables from `styles.css` (`var(--muted)`, `var(--accent)`, …) so
  light/dark themes and accents work. The widget body scrolls on its own; don't
  fight the frame.
- **Design tokens** — `styles.css`'s `:root` block also has type (`--fs-*`),
  macro-spacing (`--sp-*`), radius (`--r-*`), and z-index (`--z-*`) scales.
  New widget CSS should consume these instead of picking new px literals —
  they exist so hand-authored one-off sizes don't keep multiplying.

### Read the shared task store

`useTaskList(ctx.tasks, selector)` is the standard way to render a task view. It
subscribes to the single shared store (one `/api/tasks` fetch per board, shared
across every task widget), derives your slice via the memoized `selector`, and
hands back optimistic mutations + a 6-second Undo:

```jsx
import { useCallback } from 'react'
import { useTaskList, TaskRow, SkeletonRows, UndoBar } from '../widget-sdk'

export default function TodayWidget(_w, /* ctx passed by render */) { /* see registry */ }

function TodayList({ tasks }) {
  // A stable selector — pass one identity so the derived view memoizes.
  const selectToday = useCallback((all) => all.filter((t) => !t.done && isToday(t.due_date)), [])
  const { tasks: view, state, onToggle, onDelete, onSchedule, undo, dismissUndo } =
    useTaskList(tasks, selectToday)

  if (state === 'loading') return <SkeletonRows n={4} />
  return (
    <>
      {view.map((t) => <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} />)}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </>
  )
}
```

- `tasks` here is **`ctx.tasks`** — the capability the app injects when you plug
  `tasks`. The hook never imports the store directly; it's fully driven by that
  capability object (so a widget stays testable with a fake `ctx.tasks`).
- The `selector` runs against the whole task list; keep its identity stable
  (`useCallback`) so the derived view only recomputes when tasks actually change.
- Returned mutations (`onToggle`, `onDelete`, `onSchedule`, `onSetPriority`,
  `onSetCue`, `onPatch`) hit the shared store optimistically and reconcile with
  the server on the tasks bus. `undo`/`dismissUndo` feed the `UndoBar`.
- The `Task` shape these emit (id, title, done, due_date, priority, reminders,
  labels, recurrence, …) is documented as a JSDoc `@typedef` in `api.js` and in
  [`docs/api.md`](./api.md).

### Per-instance device-local storage

Two copies of the same widget type (e.g. a Reminders widget per board) must keep
independent UI state (collapsed sections, sort, recent picks). Use
`widgetStore(instanceId)` from the SDK — it namespaces `localStorage` under the
widget instance id so the copies don't clobber a shared global key:

```jsx
import { widgetStore } from '../widget-sdk'

function useSort(instanceId) {
  const store = widgetStore(instanceId)          // w.i, passed to render (see below)
  const initial = store.loadJson('sort', 'due')  // falls back once to the pre-namespacing global key
  // ... store.saveJson('sort', next) on change
}
```

Reach state written by **another** widget type only through the shared
`appSharedStore` (also SDK-exported) — a stable namespace regardless of which
instance last wrote it. The raw `loadJson`/`saveJson`/`loadStringSet`/
`saveStringSet` helpers are exported too, for genuinely global app preferences.

## Make it size-responsive (optional but encouraged)

Like Apple/Android home-screen widgets, a widget should change *what it shows* —
not just scale — as it grows or shrinks. The frame measures every widget body
once (a single `ResizeObserver`) and broadcasts a size class; a widget opts in
with one hook call. Ignore it and the widget renders the same at every size.

```jsx
import { useWidgetSize, atLeastW } from '../widget-sdk'

export default function StatWidget() {
  const sz = useWidgetSize()                 // { w, h, name, width, height }
  return (
    <div className="stat">
      <div className="stat-big">42</div>
      {atLeastW(sz, 'md') && <div className="stat-label">tasks done this week</div>}
      {atLeastW(sz, 'lg') && <Sparkline />}
    </div>
  )
}
```

- **`useWidgetSize` and the comparators come from `../widget-sdk`** (which
  re-exports them from `useWidgetSize.js` / `widgetsize.js`). Never reach past the
  barrel.
- **Tiers**: width `w` is `xs < sm < md < lg < xl`, height `h` is
  `xs < sm < md < lg`. `name` is a friendly 1-D label (`mini`/`compact`/
  `standard`/`wide`/`tall`/`large`) for coarse branches; `width`/`height` are the
  raw px for the rare case you need them. `DEFAULT_WIDGET_SIZE` is exported for a
  sane fallback when a widget renders outside a measured frame (e.g. a test).
- **Comparators** read as intent: `atLeastW(sz,'lg')`, `atMostW(sz,'sm')`,
  `atLeastH(sz,'md')`, `atMostH(sz,'xs')`. Branch your render on these — the
  default widget (~10×9) sits around `md`/`md`, so build "standard" for that and
  add detail above / shed it below.
- **CSS escape hatch** — the body carries `data-wsize` / `data-hsize`, so purely
  cosmetic tweaks need no JS or re-render:
  `.widget-body[data-wsize="xs"] .stat-label { display: none }`.
Re-renders fire only when a *tier* changes (not per pixel), so branching freely
is cheap. Put any non-trivial size→content mapping in a plain `.js` helper if
it's worth a node test (see `widgetsize.js` itself).

### Size hints (min / max / aspect / resize policy)

A widget **declares** how it wants to be sized; the dashboard (the "compositor")
**enforces** it — the same split as Wayland `xdg_toplevel` / X11 ICCCM
`WM_NORMAL_HINTS`, where a client declares min/max/aspect and the window manager
honors them. All hints are optional, pure data on the manifest descriptor, and
are re-derived at render (never persisted), so adding or tightening one needs no
layout migration.

| hint | shape | effect |
|---|---|---|
| `minSize` | `{ w, h }` | resize floor (default `4×4`) — content never renders below its smallest legible tier |
| `maxSize` | `{ w, h }` | resize ceiling (default: none). A saved item already larger is never force-shrunk; it just can't grow further |
| `aspect` | `{ min, max }` | allowed **width/height ratio band** in grid cells. Enforced live on resize — the widget snaps to its shape as you drag |
| `resizable` | `boolean` | `false` locks the size (no handles) |
| `resizeHandles` | subset of `['s','w','e','n','sw','nw','se','ne']` | restrict which edges/corners resize this widget type |

- **Aspect is a band, not a single ratio.** A fixed ratio is just the degenerate
  band `{ min: r, max: r }`; a real band lets the widget breathe and only corrects
  when you push outside it. The ratio is **width/height in grid cells**, so it's
  deterministic and breakpoint-independent.
- **Cell ratio ≠ pixel ratio.** A grid cell is ~40px wide × 30px tall, so a
  *visual* square is about `aspect: { min: 0.75, max: 0.75 }`, not `1.0`. Pick the
  cell ratio that yields the look you want at `lg`.
- **`defaultSize` must already satisfy every hint** (the contract test enforces
  this). Aspect is only corrected on a *user* resize, so a widget must be **born**
  inside its band — `test/widget-contract.test.mjs` fails CI otherwise.
- Examples in the manifest: `calendar` (near-square band + ceiling) and `focus`
  (tall, narrow band). The pure helpers live in `dashlayout.js`
  (`applyConstraints`, `clampAspect`) and are node-tested.

## 2. Register it

A widget is declared in two halves, keyed by the same `type`: its **pure
metadata** (node-testable, no JSX) in `app/client/src/widgets/manifest.js`, and
its **render half** (icon + `render`) in `app/client/src/widgets/registry.jsx`.
The split keeps the widget↔app connection contract testable without a renderer
(see [`widget-connections.md`](./widget-connections.md)).

**a. Add a descriptor** to `WIDGET_MANIFEST` in `widgets/manifest.js`. The full
descriptor shape (all fields optional except `type` + `label`):

```js
{
  type: 'clock',            // stable id, persisted in layouts — never rename/reuse
  label: 'Clock',           // shown in the "Add widget" menu
  desc: 'A live clock.',    // optional one-line purpose shown under the label in the menu
  // plugs: ['reminder-events'],    // app interfaces to auto-connect into ctx (see below)
  // pickGroup: true,               // "Add widget" asks for a reminder group -> w.group
  // defaultSize: { w: 5, h: 5 },   // grid units when first added (default 10×9)
  // minSize: { w: 4, h: 4 },       // resize floor (default 4×4)
  // maxSize: { w: 24, h: 22 },     // resize ceiling (default: none)
  // aspect: { min: 0.9, max: 1.4 },// width/height ratio band in grid cells (see "Size hints")
  // resizable: false,              // lock the size (no resize handles)
  // resizeHandles: ['se'],         // restrict which edges/corners resize this type
  // requires: ['caldav'],          // host-gated prerequisites (see below)
  // config: { … },                 // per-instance default config (data only; read via widgetStore)
  // mcp: { summary, tools: ['clock_…'] },  // MCP toolset names (see docs/mcp.md)
}
```

**b. Add a renderer** to `RENDERERS` in `widgets/registry.jsx` (same `type` key):

```jsx
const ClockWidget = lazy(() => import('./ClockWidget.jsx')) // next to the other lazy() lines
// ...
clock: {
  icon: IconClock,                 // menu + frame icon
  render: () => <ClockWidget />,
  // title: (w) => 'Custom header text',   // optional frame header override
  // lifecycle: { onMount(w, ctx) {…}, onUnmount(w) {…} },  // optional per-instance hooks (see below)
}
```

That's it — the widget appears in the "Add widget" menu, renders in the grid,
persists in saved layouts, and gets a frame with your icon and title. (A
descriptor with no matching renderer throws at load, so the two can't drift.)

The `lazy()` import makes the widget its own build chunk, fetched the first
time it's on a board — heavy dependencies don't bloat the initial bundle. The
widget frame provides the `<Suspense>` boundary (a skeleton shows while the
chunk loads), so there's nothing extra to do.

Notes on the entry:

- `render(w, ctx)` receives the **saved widget instance** `w` (put per-instance
  options on it, like the reminders widget's `w.group`, and pass `w.i` to
  `widgetStore(w.i)`) and a **connected context** `ctx` — see "Connect it to the
  app (plugs)" below. `ctx` holds **only** the interfaces this widget declared in
  `plugs`, nothing more.
- `type` is written into every user's persisted layout. Renaming or removing a
  type makes the dashboard silently drop those widgets on next load (that's the
  intended cleanup path for retired widgets — see `WIDGET_TYPES.has()` in
  `Dashboard.jsx`).
- `defaultSize` is in **grid columns**, on a responsive ladder in `dashlayout.js`
  (30 columns at `lg`, up to 128 on ultra-wide displays). Every tier holds a
  ~40px column pitch, so a given `w` is roughly a **constant pixel size** across
  breakpoints — `w: 10` is ~⅓ of an `lg` board and stays about that wide on an
  ultra-wide canvas. The extra width on wide screens fits *more widgets per row*
  (and lets lower widgets move up) rather than enlarging each one. Pick a `w`
  that reads well at `lg`.

### Lifecycle hooks (optional)

A renderer entry may carry a `lifecycle` object with `onMount(w, ctx)` /
`onUnmount(w)`. The dashboard runs them **once per widget instance** (keyed to
`w.i`, so re-memoizing a capability doesn't re-fire them) — the escape hatch for
per-instance setup/teardown that doesn't belong in the render tree (e.g.
registering an instance with an app-level service). No widget declares them
today; the host supports them so a future widget can opt in without a dashboard
change. Most widgets should just use React effects inside the component instead.

## Connect it to the app (plugs)

Widgets get app data through **connections** — a Snap/Juju-style interface layer
(`app/client/src/connections.js`, full reference in
[`widget-connections.md`](./widget-connections.md)). The app provides named
interfaces ("slots"); a widget declares the ones it needs in `plugs`; the
dashboard **auto-connects** them and passes **only** those into `ctx`. The
capability objects behind each slot are built once in `Dashboard.jsx` (they wrap
the app-owned singletons — the shared store, the buses, the API client), so a
widget reaches data only through what it plugged into.

| interface | `ctx` key | capability shape (what you get) |
|---|---|---|
| `tasks` | `ctx.tasks` | the shared task store + mutations for `useTaskList(ctx.tasks, selector)`: `{ subscribe, getTasks, getState, refresh, ensureLoaded, patchTask, removeTask, replaceTasks, update, create, del, attachLabels, emitChanged, onChanged, isRealDate }` |
| `reminder-groups` | `ctx.groups` | `{ fetch(), recent(), pushRecent(name), onNewGroup(name) }` — `fetch()` resolves `{ groups:[{name,listId,calendar,count}], calendars:[{id,name}] }` (cached); `onNewGroup` opens Settings prefilled |
| `notes` | `ctx.notes` | the `notesApi` client (`list`, `get`, `save`, `search`, `browse`, `create`, `trash`, …) plus the open-note bus (`onOpenNote`, `emitOpenNote`) |
| `calendar` | `ctx.calendar` | `{ listEvents(start, end), createEvent(body), updateEvent(body), deleteEvent(body), accounts() }` — CalDAV VEVENT CRUD + the enabled-account list |
| `projects` | `ctx.projects` | the user's CalDAV task projects/lists (array; the inbox is `projects[0]`) |
| `reminder-events` | `ctx.events` | live reminder/overdue events from the in-app scheduler (SSE), newest first |
| `daily-plan` | `ctx.plan` | `{ get(date), set(date, ids) }` — the server-stored daily plan; `date` is the client's local `YYYY-MM-DD` |
| `settings` | `ctx.onOpenSettings` | `onOpenSettings(opts?)` — open the Settings panel (e.g. to connect a CalDAV / Nextcloud account) |

```jsx
{ type: 'clock', label: 'Clock',
  plugs: ['reminder-events'] }                      // auto-connected → ctx.events
// registry.jsx:
clock: { icon: IconClock, render: (_w, ctx) => <ClockWidget events={ctx.events} /> }
```

Rules of thumb:

- **Declare every interface whose `ctx` key you read.** Omit it and the key is
  simply absent (`undefined`) — least privilege, like a Snap that didn't plug an
  interface. Reading the shared task store via `useTaskList` works only when you
  plugged `tasks` (that's how `ctx.tasks` gets injected), so always declare it.
- A plug can be **optional**: `plugs: [{ interface: 'projects', optional: true }]`.
  A required plug whose slot is missing shows the widget as unconnected in
  **Settings → Connections**; an optional one silently yields `undefined`.
- A typo'd / retired interface name shows as **unknown** in the connections viewer
  and logs a dev `console.warn` on load.
- Widget→widget connections use the same model and are coming — see
  [`widget-connections.md`](./widget-connections.md).

Payload shapes for every capability (the `/api/*` contract they wrap) live in
[`docs/api.md`](./api.md).

## 3. If it needs server data

The BFF keeps one module per feature in `app/server/` (see `notes.js`,
`reminder_groups.js`). Follow that pattern:

1. Add `app/server/myfeature.js` exporting plain async functions or handlers.
2. Mount routes in `app/server/index.js` under `/api/...`, always behind
   `requireAuth`, with the `try { ... } catch (e) { next(e) }` shape the other
   routes use.
3. Expose it to widgets as a **capability** (a new slot in `connections.js` +
   its value in `Dashboard.jsx`), not by letting the widget import `api.js` — the
   widget-SDK boundary forbids the direct import. Add the client helper to
   `api.js` (with a JSDoc `@returns` typedef) and wire it into the capability.
   Document the new routes + shapes in [`docs/api.md`](./api.md).
4. Per-user persistence belongs in SQLite via `config.js` **only if it's cheap
   to recreate** (layouts, account config). User content (tasks, notes, events)
   lives in the user's own CalDAV/WebDAV server — keep it there.

## 4. Verify

```bash
cd app
npm run lint     # ESLint (client + server) — includes the widget-boundary rule
npm run build    # Vite build catches bad imports/JSX
npm run check    # server syntax check
npm test         # unit tests (plain node) — includes the widget↔app contract
```

`npm test` runs the widget contract test (`test/widget-contract.test.mjs`), which
fails CI if your `plugs` name an interface the app doesn't provide — so a typo is
caught here, not at runtime. Tests are framework-free `node` scripts and can't
import JSX: put logic worth testing in a plain `.js` module (the manifest, or a
helper like `tasklib.js`) and test that. Or run the whole suite in a container
with `docker build --target test app/`. CI runs the same steps on every push/PR.
