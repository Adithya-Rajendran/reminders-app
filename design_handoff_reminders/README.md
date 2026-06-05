# Handoff: Reminders — Self-Hosted Task + Calendar Dashboard

## Overview
**Reminders** is a personal, self-hosted task + calendar dashboard for a technical, privacy-minded power user. The core is a **draggable, resizable widget grid** where the user assembles widgets (project task lists, an Upcoming view, a live reminders feed, a CalDAV-synced tasks list, and a multi-view calendar). It authenticates via OIDC (SSO) and is intended to sync with a Vikunja backend plus CalDAV (Nextcloud / Apple iCloud / generic). Tone: calm, focused, premium — dark, glassy, modern; information-rich but breathable.

This package documents a complete, high-fidelity design covering the login screen, the dashboard, all five widget types (including every loading / empty / error state), and the CalDAV Sync settings modal, in both dark (default) and light themes.

## About the Design Files
The files in this bundle are **design references created in HTML/React (via in-browser Babel)** — runnable prototypes that demonstrate the intended look, layout, motion, and interaction. **They are not production code to copy verbatim.** The task is to **recreate these designs inside the target codebase's environment** using its established patterns and libraries.

The original spec called for **React (functional components + hooks) with CSS Modules or Tailwind**, semantic HTML, inline SVG icons (no icon fonts), and a `localStorage`-persisted light/dark theme. If a frontend environment already exists, conform to it; if not, React + CSS Modules (or Tailwind) with `react-grid-layout` for the widget grid is the recommended target. The prototype intentionally hand-rolls drag/resize so it can run from a single file — in production, prefer `react-grid-layout` as originally specified.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, shadows, motion, and component states are all specified exactly below and in the source files. Recreate the UI pixel-faithfully using the codebase's libraries, lifting the exact token values from the "Design Tokens" section (they are also defined as CSS variables in `styles.css`).

---

## Screens / Views

### 1. Login
- **Purpose:** Single SSO entry point (OIDC). No username/password fields.
- **Layout:** Full-viewport, content centered (`display:grid; place-items:center; padding:24px`) over the app background (two radial glows over `--bg`). A single glass card, `max-width:400px`, `border-radius:22px`, `padding:36px 32px 28px`, centered text.
- **Components:**
  - **Logo tile:** 58×58, `border-radius:16px`, fill = accent gradient (`linear-gradient(135deg,#6d6cf7,#a855f7)`), bell icon (28px) in white, `box-shadow:0 12px 30px -10px var(--accent)` + inset top highlight. Centered, 20px bottom margin.
  - **Heading:** "Sign in to Reminders" — 25px / weight 700 / letter-spacing -0.02em.
  - **Lede:** "Your self-hosted tasks & calendar, all in one calm dashboard." — 14px, `--muted`, 26px bottom margin.
  - **Primary button (block):** "Continue with SSO" with shield icon. Gradient fill, `padding:12px 16px`, font 14/600, full width. On click → shows spinner + "Redirecting…" for ~1.1s, then transitions to Dashboard.
  - **SSO detail line:** key icon + "Authenticated with OpenID Connect" — 12px, `--faint`.
  - **Footer note:** shield icon + "Self-hosted · syncs with Vikunja & CalDAV" — 12px, `--faint`.
  - **Entrance:** card animates in (`modalIn`, 360ms, ease-out cubic).

### 2. Dashboard (authenticated home)
Composed of Top bar → Toolbar → Widget grid.

**Top bar** (sticky, `top:0`, `z-index:50`, blurred): `padding:12px 24px`, background `color-mix(in oklab, var(--bg) 62%, transparent)` with `backdrop-filter:blur(12px) saturate(1.4)`, 1px bottom line.
- **Left — brand:** 34×34 gradient rounded-square (`border-radius:10px`) logo with bell icon; "Reminders" wordmark, 16px / 700.
- **Right:** signed-in email pill (28px gradient avatar with initials + email text, 13px `--muted`); theme toggle icon-button (sun in dark mode / moon in light); settings gear icon-button; logout icon-button (turns `--danger` red on hover).
- **Responsive:** ≤820px hides the email text (keeps avatar); ≤560px hides the email pill entirely and shows an avatar dropdown menu (theme toggle, settings, logout).

**Toolbar:** `padding:18px 24px 8px`, flex row.
- **Left:** "Dashboard" title (22px / 700 / -0.02em) with a date subtitle below ("Friday, June 5" style, 13px `--muted`).
- **Right:** primary **"+ Add widget"** button (gradient) with a chevron. Opens a dropdown menu (`menuIn` 150ms):
  - Items: **Project task list** (chevron → submenu), **Upcoming**, **Reminders feed**, **CalDAV tasks**, **Calendar**, each with a leading icon.
  - "Project task list" swaps the menu to a back-row + "Choose a project" label + project rows (each with a colored priority-style dot). Selecting any item adds that widget to the grid (new widget enters in loading state, resolves to ready after ~750ms).
  - Menu closes on outside-click or Esc.

**Widget grid:** `grid-wrap` padding `8px 24px 40px`. CSS grid:
- `grid-template-columns: repeat(6, 1fr)` (desktop), `grid-auto-rows: calc(80px * var(--density))`, `grid-auto-flow: row dense`, `gap:16px`.
- Each widget sits in a grid item using `grid-column: span W` and `grid-row: span H`.
- **Default layout:** Task List (W2×H5), Upcoming (W2×H5), Calendar (W2×H5) on the first row; Reminders feed (W3×H4), CalDAV tasks (W3×H4) on the second row.
- **Drag to reorder:** pointer-down on the header grip starts a drag (the source widget drops to 35% opacity; the hovered target shows a 2px dashed accent outline with `--accent-soft` fill as a placeholder). Drop reorders the array.
- **Resize:** pointer-down on the bottom-right corner handle (revealed at 70% opacity on hover) adjusts W (clamp 1–6 cols) and H (clamp 3–12 rows) by snapping to grid cells.
- **Drag & resize are disabled on touch input and at ≤560px (single column).**
- **Empty grid state:** if all widgets are removed, a centered glass panel reads "Your dashboard is empty" + "Add a widget to start assembling your workspace." + an Add-widget button.
- **Responsive grid:** 6 cols → `≤1100px` 4 cols → `≤820px` 2 cols → `≤560px` 1 col.

### 3. Settings modal — CalDAV Sync
- **Purpose:** Manage connected CalDAV accounts and choose which discovered lists to sync.
- **Layout:** Fixed overlay `rgba(6,7,16,0.62)` + `backdrop-filter:blur(3px)`, content centered, `padding:24px`. Modal: `max-width:540px`, `max-height:calc(100vh - 48px)`, `border-radius:16px`, solid panel background, `box-shadow:0 10px 40px rgba(0,0,0,.45)`, header / scrollable body / footer regions. Entrance `modalIn` 200ms.
- **A11y:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap (Tab cycles within), Esc and overlay-click close, focus returns to the trigger on close.
- **Header:** cloud icon + "CalDAV Sync" (20px / 700) + a contextual subtitle that changes per step; close icon-button (×).
- **Body — four steps:**
  1. **Account list:** rows with provider icon tile (38×38), label + status line (status dot — green ok / amber syncing / red error — plus detail text), and refresh + delete icon-buttons. Refresh sets the row to "Syncing…" with a spinner for ~1.4s then back to ok. A full-width ghost "+ Add account" button sits below. If no accounts: empty state.
  2. **Provider picker:** 3-up grid of cards — **Nextcloud** (self-hosted), **Apple iCloud** (iCloud), **Generic CalDAV** (any server) — each with icon, name, sub-label. Hover = accent border + soft fill.
  3. **Connect form:** provider header + fields:
     - *Nextcloud:* Server URL, Username, App password (hint: generate under Settings → Security; never use login password).
     - *Apple iCloud:* Apple ID, App-specific password (hint: create at appleid.apple.com; CalDAV URL auto-discovered, no server URL).
     - *Generic CalDAV:* CalDAV URL, Username, Password.
     - "Connect" is disabled until all fields are non-empty; on click shows spinner + "Connecting…" for ~1.6s, then advances to discovery.
  4. **Discovered lists:** green "Connected — found N lists" line, then a bordered list of rows: color swatch + list name + task count + a **toggle switch** (`role="switch"`). Footer "Save N lists" adds the account and returns to the list view.
- **Footer:** right-aligned buttons whose set depends on the step (Done / Back / Connect / Cancel + Save).

---

## Interactions & Behavior
- **Auth flow:** Login button → ~1.1s fake redirect → Dashboard. Auth persisted in `localStorage["reminders-authed"]="1"`. Logout clears it and returns to Login.
- **Theme:** toggle in top bar; persisted in `localStorage["reminders-theme"]` (`"dark"` default | `"light"`), applied via `data-theme` on `<html>`.
- **Task checkboxes:** toggle done state; completed tasks show strike-through + faint color (they remain in the list).
- **Inline add-task row:** a dashed "+ Add a task…" row at the bottom of task lists; Enter or blur commits a new task.
- **Live reminders feed (simulated SSE):** a new item is prepended every ~9–12s (capped at 40). Newest item gets a one-shot `feedIn` slide-in (360ms) and a brief `--accent-soft` "fresh" highlight. Relative timestamps ("just now", "5m ago") re-render on a timer. Container is `aria-live="polite"`.
- **Calendar view switcher:** segmented control [Month][Week][Day][Agenda] + prev / Today / next controls and a current-period label.
  - *Month:* 6×7 grid, out-of-month days at 40% opacity, today highlighted with accent border + soft fill, up to 3 event pills per day then "+N more".
  - *Week / Day:* time grid (7 AM–11 PM, 44px/hour), events absolutely positioned by start/end time, colored by category.
  - *Agenda:* chronological list grouped by day (next ~3 weeks, up to 8 days with events).
- **Widget remove:** × button in the header, revealed on hover/focus-within.
- **Motion:** 150ms ease on hover; ~200ms on grid item transforms; buttons translate `translateY(1px)` on active; modal fade + scale-in; menu slide-in. All gated by `@media (prefers-reduced-motion: reduce)` which collapses durations.

## State Management
Local component state (no backend in the prototype):
- `authed: boolean` (persisted), `theme: "dark"|"light"` (persisted), `settingsOpen: boolean`.
- `tasks: Task[]` — `{id, title, done, priority(1–4), due:Date|null, project}`. Handlers: `toggleTask`, `addTask(project, title)`.
- `caldav: CalDavTask[]` — `{id, title, list, due, done}`; handler `toggleCaldav`.
- `feed: FeedItem[]` — `{id, type:"due"|"done"|"add"|"sync", html, at:Date, _new}`; appended on a timer.
- `widgets: Widget[]` — `{uid, type, projectId?, w, h, _state:"loading"|"ready"|"error"}`. Handlers: `addWidget`, `removeWidget`, `retryWidget`, plus drag-reorder and resize.
- Settings modal local state: `accounts`, `mode:"list"|"pick"|"form"|"discover"`, `provider`, `form`, `connecting`, `lists`.
- **Data fetching (production):** replace the timers/mock arrays with real OIDC auth, Vikunja API calls (projects, tasks), and CalDAV sync (account discovery, list enumeration, task fetch). Each widget should drive its own `loading/ready/error` from its request lifecycle; `retryWidget` should re-issue the request.

## Per-component states (required)
Define **default / hover / active / focus-visible / disabled** for buttons, icon-buttons, toggles, menu items, and checkboxes (see `styles.css`). Button variants: `.primary` (gradient), `.ghost` (outline), `.danger`. Every widget must implement:
- **Loading:** shimmer skeleton rows (`.skeleton` with a moving gradient).
- **Empty:** centered icon tile + title + sub-copy (per-widget copy in the source).
- **Error:** red-tinted icon + "Couldn't load" + contextual sub + a "Retry" ghost button.
Focus rings: 2px `--accent` outline with 2px offset, visible in both themes.

## Design Tokens
All tokens are defined as CSS variables in `styles.css` (`:root`/`[data-theme="dark"]` and `[data-theme="light"]`).

**Dark (default)**
- Background: `--bg:#0a0b14`, `--bg2:#0e1020`. App bg = two radial glows (indigo top-left `rgba(99,91,255,.22)`, violet top-right `rgba(168,85,247,.18)`) over `--bg`.
- Panels: `--panel:rgba(26,29,48,.72)` + `backdrop-filter:blur(12px)`; `--panel-solid:#161a2e`; `--panel2:#1d2138`.
- Lines: `--line:rgba(120,130,170,.16)`; `--line-strong:rgba(120,130,170,.28)`.
- Text: `--text:#eef0fa`; `--muted:#9099bd`; `--faint:#6b73a0`.
- Accent: `--accent:#6d6cf7` → `--accent2:#a855f7` (`linear-gradient(135deg, …)`); `--accent-soft:rgba(109,108,247,.16)`.
- Status: green `#34d399`, danger `#f4577a`, warn `#fbbf24` (each with a `-soft` tint).
- Shadow: `--shadow:0 10px 40px rgba(0,0,0,.45)`; `--shadow-sm:0 4px 16px rgba(0,0,0,.35)`.

**Light**
- `--bg:#f6f7fb`, `--bg2:#eef0f7`; panels `#ffffff` / `--panel:rgba(255,255,255,.74)` / `--panel2:#f1f3fa`.
- `--text:#1a1d2e`; `--muted:#5b6480`; `--faint:#8b93af`; `--line:rgba(20,24,50,.10)`.
- Same indigo→violet accents; softer glows; green `#16a571`, danger `#e23a60`, warn `#d99413`.

**Typography:** `ui-sans-serif, system-ui, "Segoe UI", Roboto, Inter, sans-serif`; base 14px / 1.5. Scale: 12 (meta), 13 (controls), 14 (base), 16 (widget title), 20 (modal title), 22 (page title), 25 (login heading). Weights 400 / 600 / 700.

**Spacing:** 4px base (4 / 8 / 12 / 16 / 20 / 24).

**Radius:** cards 16px, buttons/inputs 10px, chips 8px, menus 14px, login card 22px.

**Icons:** thin **1.75px-stroke** inline SVG, `currentColor`, ~15–20px. Set includes: gear, plus, x, trash, refresh, cloud, check, calendar, bell, spinner, inbox, clock, list, sun, moon, logout, chevrons, grip, resize, shield, key, link, sliders, flag, plus simple Nextcloud / Apple provider marks. Use the codebase's own icon library if one exists, matching stroke weight.

## Assets
No external image/font assets — all icons are inline SVG (in `icons.jsx`), all type is the system sans-serif stack. No third-party brand assets are used beyond simple original provider glyphs for Nextcloud/Apple; swap for the codebase's preferred icon set if desired.

## Files (in this bundle)
- `Reminders.html` — entry shell; loads React 18 + Babel and the modules below.
- `styles.css` — design tokens (both themes) + base element/control styles (buttons, inputs, checkbox, switch, menu, chips, skeleton, animations).
- `app.css` — layout & component styles (top bar, toolbar, grid, widget frame, widgets, calendar, modal, login, responsive).
- `icons.jsx` — inline SVG icon components.
- `data.jsx` — mock data + date/format helpers (projects, tasks, CalDAV lists/tasks, calendar events, feed templates, accounts, discovered lists, user).
- `widgets.jsx` — `WidgetFrame`, shared state components (skeleton/empty/error), Task List, Upcoming, Reminders feed, CalDAV widgets, and the demo-state context.
- `calendar.jsx` — Calendar widget with Month / Week / Day / Agenda views.
- `settings.jsx` — CalDAV Sync modal (focus trap, provider presets, discovery).
- `chrome.jsx` — Login screen, Top bar, theme toggle, Add-widget dropdown, Toolbar.
- `app.jsx` — App root: auth, theme, store, widget grid (drag + resize), feed timer, tweaks wiring.
- `tweaks-panel.jsx` — prototyping-only tweak panel (accent/glass/glow/density + a "showcase widget states" control). **Not part of the product** — ignore for implementation.

> Note: the prototype's drag/resize is hand-rolled to run standalone. For production, implement the grid with **`react-grid-layout`** (responsive breakpoints, drag handle on the header grip, resize handle bottom-right, drag disabled on touch) as the spec intends.
