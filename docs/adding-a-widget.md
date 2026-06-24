# Adding a dashboard widget

Widgets are self-contained: the dashboard (`app/client/src/Dashboard.jsx`) is
generic and learns about widgets only through the registry at
`app/client/src/widgets/registry.jsx`. Adding a widget is **one component file
plus one registry entry** — no dashboard changes.

> **Read `docs/widget-sdk.md` first** — it's the authoritative contract. In short:
> a widget imports **only** from `../widget-sdk` (+ `react` + its own siblings),
> and gets all app data through `ctx` capabilities (`ctx.tasks`, `ctx.groups`,
> `ctx.notes`, `ctx.calendar`, `ctx.events`, `ctx.projects`, `ctx.onOpenSettings`)
> — **not** by importing `api.js`/the store/the buses. ESLint enforces this. The
> snippets below predate the SDK; treat them as illustrative and prefer the SDK
> imports + ctx capabilities shown in `docs/widget-sdk.md`.

## 1. Create the component

Add `app/client/src/widgets/MyWidget.jsx`. A minimal client-only widget:

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

Conventions worth reusing:

- **Loading / empty / error states** — `widgets/parts.jsx` exports
  `SkeletonRows`, `EmptyState`, `ErrorState`, and `UndoBar` so every widget
  feels consistent.
- **API calls** — use the helpers in `api.js` (`api()` for `/api/*`, `tk()` for
  task routes). They handle JSON and redirect to login on a 401.
- **Task lists** — `useTasks.js` (`useTaskList(loader)`) gives you load state,
  optimistic toggle/delete/schedule, and undo for free; render rows with
  `widgets/TaskRow.jsx`.
- **Cross-widget refresh** — if your widget mutates tasks, emit
  `emitTasksChanged()` from `tasksbus.js` and subscribe with `onTasksChanged()`
  so other widgets stay in sync.
- **Icons & styling** — icons are inline SVG components in `icons.jsx` (add one
  there if needed). Use the CSS variables from `styles.css`
  (`var(--muted)`, `var(--accent)`, …) so light/dark themes and accents work.
  The widget body scrolls on its own; don't fight the frame.

## Make it size-responsive (optional but encouraged)

Like Apple/Android home-screen widgets, a widget should change *what it shows* —
not just scale — as it grows or shrinks. The frame measures every widget body
once (a single `ResizeObserver`) and broadcasts a size class; a widget opts in
with one hook call. Ignore it and the widget renders the same at every size.

```jsx
import { useWidgetSize } from '../useWidgetSize.js'
import { atLeastW } from '../widgetsize.js'

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

- **Tiers** (`widgetsize.js`): width `w` is `xs < sm < md < lg < xl`, height `h`
  is `xs < sm < md < lg`. `name` is a friendly 1-D label (`mini`/`compact`/
  `standard`/`wide`/`tall`/`large`) for coarse branches; `width`/`height` are the
  raw px for the rare case you need them.
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

**a. Add a descriptor** to `WIDGET_MANIFEST` in `widgets/manifest.js`:

```js
{
  type: 'clock',            // stable id, persisted in layouts — never rename/reuse
  label: 'Clock',           // shown in the "Add widget" menu
  // optional:
  // plugs: ['tasks'],              // app interfaces this widget connects to (see below)
  // defaultSize: { w: 5, h: 5 },   // grid units when first added (default 10×9)
  // minSize: { w: 4, h: 4 },       // resize floor (default 4×4)
  // maxSize: { w: 24, h: 22 },     // resize ceiling (default: none)
  // aspect: { min: 0.9, max: 1.4 },// width/height ratio band in grid cells (see "Size hints")
  // resizable: false,              // lock the size (no resize handles)
  // resizeHandles: ['se'],         // restrict which edges/corners resize this type
  // pickGroup: true,               // "Add widget" asks for a reminder group -> w.group
}
```

**b. Add a renderer** to `RENDERERS` in `widgets/registry.jsx` (same `type` key):

```jsx
const ClockWidget = lazy(() => import('./ClockWidget.jsx')) // next to the other lazy() lines
// ...
clock: {
  icon: IconClock,                 // menu + frame icon
  render: () => <ClockWidget />,
  // title: (w) => 'Custom header text',  // optional frame header override
},
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
  options on it, like the reminders widget's `w.group`) and a **connected
  context** `ctx` — see "Connect it to the app (plugs)" below. `ctx` holds **only**
  the interfaces this widget declared in `plugs`, nothing more.
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

## Connect it to the app (plugs)

Widgets get app data through **connections** — a Snap/Juju-style interface layer
(`app/client/src/connections.js`, full reference in
[`widget-connections.md`](./widget-connections.md)). The app provides named
interfaces ("slots"); a widget declares the ones it needs in `plugs`; the
dashboard **auto-connects** them and passes **only** those into `ctx`.

| interface | what you get | `ctx` key |
|---|---|---|
| `tasks` | the shared task store (use the `useTaskList` hook) | — (ambient) |
| `reminder-events` | live reminder/overdue SSE events | `ctx.events` |
| `projects` | the user's task projects/lists | `ctx.projects` |
| `reminder-groups` | the "new group" affordance | `ctx.onNewGroup` |
| `settings` | open the Settings panel | `ctx.onOpenSettings` |

```jsx
{ type: 'clock', label: 'Clock', icon: IconClock,
  plugs: ['reminder-events'],                       // auto-connected to ctx.events
  render: (_w, ctx) => <ClockWidget events={ctx.events} /> }
```

Rules of thumb:

- **Declare every interface whose `ctx` key you read.** Omit it and the key is
  simply absent (`undefined`) — least privilege, like a Snap that didn't plug an
  interface. Reading the shared task store via `useTaskList` works without a plug,
  but declare `tasks` anyway so the dependency shows up in **Settings →
  Connections**.
- A plug can be **optional**: `plugs: [{ interface: 'projects', optional: true }]`.
- A typo'd / retired interface name shows as **unknown** in the connections viewer
  and logs a dev `console.warn` on load.
- Widget→widget connections use the same model and are coming — see
  [`widget-connections.md`](./widget-connections.md).

## 3. If it needs server data

The BFF keeps one module per feature in `app/server/` (see `notes.js`,
`reminder_groups.js`). Follow that pattern:

1. Add `app/server/myfeature.js` exporting plain async functions or handlers.
2. Mount routes in `app/server/index.js` under `/api/...`, always behind
   `requireAuth`, with the `try { ... } catch (e) { next(e) }` shape the other
   routes use.
3. Add a client helper in `api.js` if the calls are more than one-liners.
4. Per-user persistence belongs in SQLite via `config.js` **only if it's cheap
   to recreate** (layouts, account config). User content (tasks, notes, events)
   lives in the user's own CalDAV/WebDAV server — keep it there.

## 4. Verify

```bash
cd app
npm run lint     # ESLint (client + server)
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
