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
- `defaultSize` is in **grid columns**, and the column count grows with screen
  width (a responsive ladder in `dashlayout.js`: 30 at `lg`, up to 128 on
  ultra-wide displays). So a width is a *proportion* — `w: 10` is ~⅓ at `lg` but
  narrower on a wide canvas, where the extra width becomes more columns rather
  than wider ones. Pick a `w` that reads well as a fraction, not a pixel size.

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
