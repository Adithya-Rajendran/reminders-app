# Widget connections

The dashboard wires widgets to the application through an explicit **connection
layer**, modeled on [Canonical Snap connections][snap] and [Juju relations][juju].
It replaces the old "pass every widget the same context bag" approach with
declared, validated, visible data dependencies.

[snap]: https://snapcraft.io/docs/interface-management
[juju]: https://juju.is/docs/juju/relation

## The model

- The **app / canvas provides slots** — named *interfaces* it can supply
  (`tasks`, `reminder-events`, …). The catalog lives in
  `app/client/src/connections.js` (`APP_INTERFACES`).
- A **widget declares plugs** — the interfaces it needs — in its registry entry
  (`app/client/src/widgets/registry.jsx`):

  ```js
  { type: 'reminders', /* … */ plugs: ['tasks', 'reminder-events', 'projects', 'reminder-groups'] }
  ```

- The **dashboard auto-connects** each plug to the matching slot (no user wiring,
  like Snap auto-connection) and hands the widget's `render(w, ctx)` **only** the
  connected interfaces' values. A widget literally cannot read app state it didn't
  plug into — **least privilege**.

This is enforced in `Dashboard.jsx`: for each widget it calls
`resolveConnections(spec.plugs, slots)` then `selectCtx(appCtx, connections)`, and
passes that subset as `ctx`.

## App interface catalog

Each interface maps to the `ctx` prop names it injects (`keys`), so widget
`render()` signatures don't change when a widget opts into the system.

| interface | scope | `ctx` key(s) | summary |
|---|---|---|---|
| `tasks` | app | — | Shared task store (one `/api/tasks` fetch per board, optimistic edits + undo). Ambient via the `useTaskList` hook, so it injects no `ctx` key — declaring it documents the dependency and lists it in the viewer. |
| `reminder-events` | app | `events` | Live reminder/overdue events from the in-app scheduler (SSE feed). |
| `projects` | app | `projects` | The user's CalDAV task projects/lists (inbox is `projects[0]`). |
| `reminder-groups` | app | `onNewGroup` | Reminder groups + the "new group" affordance (opens Settings prefilled). |
| `settings` | app | `onOpenSettings` | Open the Settings panel (e.g. to connect a CalDAV / Nextcloud account). |

## Settings → Connections

Settings shows a read-only viewer (`settings/ConnectionsSection.jsx`), like
`snap connections`: the interfaces the app provides, and every widget type with
its plugs and a status badge:

- **connected** — the interface is provided and wired up.
- **unavailable** — a known interface with no provider on this board (can't happen
  for app interfaces today; reserved for widget→widget).
- **unknown** — the plug names an interface that isn't in the catalog (a typo or a
  retired interface). Also logged as a dev `console.warn` on load.

Note that `settings` is itself an interface: the Notes widget plugs into it to
offer "Open Settings", so the settings page is both a *consumer surface* (the
viewer) and a *provided interface*.

## Adding / changing an interface

1. Add an entry to `APP_INTERFACES` in `connections.js` with a `scope`, a
   `summary`, and the `keys` it injects into `ctx`.
2. Supply its value in `Dashboard.jsx`'s `appCtx` (so `appSlots` sees it).
3. Add the interface name to the relevant widgets' `plugs`.

The pure logic (`connections.js`) is covered by `test/connections.test.mjs`.

## Widget → widget (the future)

The same plug/slot model extends to widgets *providing* interfaces that sibling
widgets consume (e.g. a Notes widget exposing its `note-selection`, a calendar
reacting to it). Nothing cross-widget is wired today, but the layer is built for
it with **zero rework**:

- `resolveConnections(plugs, available, catalog)`, `selectCtx`, and
  `describeConnections` are **generic** over the catalog and the set of available
  provider names — they don't assume "app".
- Interfaces carry a `scope` (`'app'` today; `'widget'` later). `appSlots()` only
  reports `scope: 'app'` interfaces.

The extension path: let registry entries declare `provides: [...]`, have the
dashboard union widget-provided interface names into the `available` set passed to
`resolveConnections`, and route a provider widget's exported value into the
consumer's `ctx`. The resolution/auto-connect/validation logic stays exactly as it
is — only the *source* of slots grows.
