# Adding a dashboard widget

Widgets are self-contained: the dashboard (`app/client/src/Dashboard.jsx`) is
generic and learns about widgets only through the registry at
`app/client/src/widgets/registry.jsx`. Adding a widget is **one component file
plus one registry entry** — no dashboard changes.

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
- **Floors** — set `minSize: { w, h }` on the registry entry (next to
  `defaultSize`) so a user can't shrink the widget below its smallest legible
  tier. Default floor is 4×4.

Re-renders fire only when a *tier* changes (not per pixel), so branching freely
is cheap. Put any non-trivial size→content mapping in a plain `.js` helper if
it's worth a node test (see `widgetsize.js` itself).

## 2. Register it

Append an entry to `WIDGETS` in `app/client/src/widgets/registry.jsx`:

```jsx
const ClockWidget = lazy(() => import('./ClockWidget.jsx')) // next to the other lazy() lines
// ...
{
  type: 'clock',            // stable id, persisted in layouts — never rename/reuse
  label: 'Clock',           // shown in the "Add widget" menu
  icon: IconClock,          // menu + frame icon
  render: () => <ClockWidget />,
  // optional:
  // title: (w) => 'Custom header text',
  // defaultSize: { w: 5, h: 5 },   // grid units when first added (default 10×9)
  // pickGroup: true,               // "Add widget" asks for a reminder group -> w.group
}
```

That's it — the widget appears in the "Add widget" menu, renders in the grid,
persists in saved layouts, and gets a frame with your icon and title.

The `lazy()` import makes the widget its own build chunk, fetched the first
time it's on a board — heavy dependencies don't bloat the initial bundle. The
widget frame provides the `<Suspense>` boundary (a skeleton shows while the
chunk loads), so there's nothing extra to do.

Notes on the entry:

- `render(w, ctx)` receives the **saved widget instance** `w` (put per-instance
  options on it, like the reminders widget's `w.group`) and the **shared
  context** `ctx = { events, projects, onNewGroup, onOpenSettings }`
  (live SSE reminder events, the task projects list, and settings callbacks).
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
for t in test/*.test.mjs; do node "$t"; done   # unit tests, plain node
```

Tests are framework-free `node` scripts and can't import JSX — put any logic
worth testing in a plain `.js` module (like `tasklib.js`) and test that.
CI (`.github/workflows/ci.yml`) runs the same steps on every push/PR.
