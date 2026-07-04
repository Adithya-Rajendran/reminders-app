# Widget SDK

The widget SDK is the **only** surface a widget may import. Everything a widget
needs — shared UI, hooks, pure helpers, the task-list hook, per-instance storage,
icons — is re-exported from `client/src/widget-sdk`. Application data is delivered
**through `ctx`** (the connection layer), never imported directly.

This boundary is what makes widgets testable and the app refactorable in
isolation: a widget can't reach into the store, the API client, or the buses, so
those can change without touching widgets, and a widget can be rendered in a test
with fake capabilities (no server, no globals).

## The rule (enforced by ESLint)

A file under `client/src/widgets/**` may import only:

- `react` (and other npm packages, e.g. `@fullcalendar/*`),
- its own siblings (`./TaskRow.jsx`, `./manifest.js`, …),
- the SDK: `../widget-sdk`, `../widget-sdk/notes`, `../widget-sdk/panels`.

Any other parent import (`../api.js`, `../taskstore.js`, `../tasksbus.js`,
`../Dashboard.jsx`, …) is an ESLint **error** (`no-restricted-imports` in
`eslint.config.js`). Reach that data through `ctx` instead.

## The SDK surface

`import { … } from '../widget-sdk'`

- **UI**: `SkeletonRows`, `EmptyState`, `ErrorState`, `UndoBar`, `TaskRow`,
  `DateTimePicker`, `GroupPicker`, `GroupList`
- **hooks**: `useWidgetSize`, `useElementSize`, `WidgetSizeContext`, `usePopover`,
  `useTaskList`
- **sizing**: `atLeastW`, `atMostW`, `atLeastH`, `atMostH`, `DEFAULT_WIDGET_SIZE`
- **storage**: `widgetStore(instanceId)` (per-instance — preferred), plus the raw
  `loadJson`/`saveJson`/`loadStringSet`/`saveStringSet`
- **pure domain helpers**: task views/selectors (`selectUpcoming`, `selectMostImportant`,
  `selectFlowSource`, `selectHabits`, `dueBucket`, …), `tasklib` helpers
  (`dueChip`, `timeLabel`, `pdotClass`, `PRIORITIES`, `parseQuickAdd`, `ZERO_DATE`,
  `isRealDate`), `habitstats`, `reviewstats`, note helpers (`buildTree`,
  `sortNotes`, `ancestorsOf`, `pushRecent`, …)
- **icons**: all `Icon*`

Heavy / niche entries live off the main barrel so it stays light for tests:

- `../widget-sdk/notes` — the Notes editor stack (`NoteEditor`, `NoteContextMenu`,
  `TrashView`, `PromptModal`); pulls tiptap, so only the Notes widget imports it.
- `../widget-sdk/panels` — widget-contributed Settings panels (`NotesFolderPanel`).

The public surface is pinned by `test/component/sdk-surface.test.jsx` — change it
on purpose, and update that tripwire in the same commit.

## ctx capabilities

A widget declares the interfaces it needs in its manifest `plugs`; the dashboard
auto-connects them and passes **only** those into the widget (least privilege).
Capability shapes are typed in `widget-sdk/types.js`.

| interface (plug) | ctx key | what it gives the widget |
|---|---|---|
| `tasks` | `ctx.tasks` | shared task store + mutations + change bus |
| `reminder-events` | `ctx.events` | live reminder/overdue SSE feed |
| `projects` | `ctx.projects` | CalDAV task projects/lists |
| `reminder-groups` | `ctx.groups` | groups: `fetch`/`recent`/`pushRecent`/`onNewGroup` |
| `notes` | `ctx.notes` | notes client (`notesApi` methods) + open-note bus |
| `calendar` | `ctx.calendar` | CalDAV events: `listEvents`/`create`/`update`/`delete`/`accounts` |
| `settings` | `ctx.onOpenSettings` | open the Settings modal |

Reading tasks:

```jsx
import { useTaskList, selectUpcoming } from '../widget-sdk'

export default function UpcomingWidget({ tasks }) {
  const { tasks: rows, state, onToggle, undo, dismissUndo } =
    useTaskList(tasks, selectUpcoming)        // tasks === ctx.tasks
  // …
}
```

The store stays a single shared singleton, so a board still fetches `/api/tasks`
once regardless of how many task widgets are on it.

## Per-instance storage

`widgetStore(instanceId)` namespaces device-local UI state under the widget
instance, so two instances of the same widget keep independent state. The host
passes `instanceId={w.i}`; reads fall back once to the old global key so existing
state survives the upgrade.

```jsx
const store = useMemo(() => widgetStore(instanceId), [instanceId])
const [collapsed, setCollapsed] = useState(() => store.loadStringSet('collapsed'))
```

## Adding a widget

1. A component file in `widgets/` importing only from `../widget-sdk`.
2. A descriptor in `widgets/manifest.js` (`type`, `label`, `plugs`, optional
   `requires`/sizing).
3. A renderer in `widgets/registry.jsx` (`icon` + `render(w, ctx)`, optional
   `title`/`settingsPanel`/`lifecycle`).

`registry.jsx` throws if a descriptor has no renderer; the parity is a CI gate
(`test/component/registry.test.jsx`). Never rename/reuse a widget `type` — it's
persisted in saved layouts.

Optional registry/manifest extras: `requires` (capability prerequisites the host
gates on, e.g. `['caldav']`), `settingsPanel` (a panel contributed to Settings),
`lifecycle: { onMount(w, ctx), onUnmount(w) }` (run per instance).
