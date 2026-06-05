# Prompt: Front-End Design for "Reminders" — a Self-Hosted Task + Calendar Dashboard

You are a senior product designer and front-end engineer. Design and build a **production-quality, beautiful, fully responsive UI** for an app called **Reminders**. Output **React (functional components + hooks)** with **CSS Modules or Tailwind**, semantic HTML, inline SVG icons (no icon-font dependencies), and a working light/dark theme toggle persisted to `localStorage`. Use realistic mock data and local component state — no backend. Ship-quality means real empty/loading/error states, smooth motion, and pixel-clean spacing. Deliver well-structured, commented code with theme tokens as CSS variables.

## 1) Product, User, Tone
**Reminders** is a personal, self-hosted task + calendar dashboard. Its core is a **draggable, resizable widget grid** (assume `react-grid-layout`) where users assemble widgets: project task lists, an "Upcoming" view, a live reminders feed, a CalDAV-synced tasks widget, and a multi-view calendar. It authenticates via OIDC and syncs with a Vikunja backend plus CalDAV (Nextcloud / Apple iCloud / generic). **Target user:** a technical, privacy-minded power user running their own stack. **Tone:** calm, focused, premium-software confident — dark, glassy, modern; never toy-like or cluttered. Density is moderate: information-rich but breathable.

## 2) Screens & Components (build all)
**Top bar** (sticky, blurred): gradient rounded-square logo + "Reminders" wordmark on the left; right side shows the signed-in email (`user@example.com`), a theme toggle, a settings gear icon-button, and a logout icon-button (red on hover).

**Toolbar:** a primary **"+ Add widget"** button opening a dropdown: *Project task list* (submenu of projects), *Upcoming*, *Reminders feed*, *CalDAV tasks*, *Calendar*.

**Dashboard widget grid:** responsive draggable/resizable cards. Each is a **WidgetFrame**: header with title, drag affordance, and a remove (×) button revealed on hover; scrollable body; corner resize handle. Show a translucent gradient placeholder while dragging. Widget types:
- **Task List** — project-name header, tasks with checkboxes, priority dots, due chips, inline "+ add task" row.
- **Upcoming** — tasks grouped under Today / Tomorrow / This week with date labels.
- **Reminders feed** — live event stream (simulate SSE with a timed mock), newest on top, relative timestamps, subtle "new item" slide-in.
- **CalDAV tasks** — tasks from synced lists, each tagged with source-list color + account.
- **Calendar** — segmented **view switcher** (Month / Week / Day / Agenda); Month = grid with event pills, Week/Day = time-gridded columns, Agenda = chronological list. Include prev/next + "Today" controls and a current-period label.

**Settings modal (CalDAV Sync):** centered glass modal over a dimmed overlay. Header "CalDAV Sync" + close. Lists connected accounts (provider icon, label, status, refresh + delete). **"Add account"** flow with provider presets: *Nextcloud* (base URL + app-password hint), *Apple iCloud* (Apple ID + app-specific password, no URL), *Generic CalDAV* (full URL). After connect, show **discovered lists with toggle switches** and color swatches to enable/disable each.

**Login screen:** centered card on the gradient-glow background; logo, "Sign in to Reminders", a single primary **"Continue with SSO"** (OIDC) button, and a subtle self-hosting footer note.

## 3) Design System (be exact)
**Dark theme (default):** `--bg:#0a0b14`, `--bg2:#0e1020`; app background uses two radial glows (indigo top-left, violet top-right) over `--bg`. Panels: `--panel:rgba(26,29,48,.72)` with `backdrop-filter:blur(12px)`, `--panel-solid:#161a2e`, `--panel2:#1d2138`. Lines: `--line:rgba(120,130,170,.16)`. Text: `--text:#eef0fa`, `--muted:#9099bd`, `--faint:#6b73a0`. Accents: `--accent:#6d6cf7` → `--accent2:#a855f7` (use as `linear-gradient(135deg,...)`), `--accent-soft:rgba(109,108,247,.16)`. Status: green `#34d399`, danger `#f4577a`, warn `#fbbf24`.

**Light theme:** `--bg:#f6f7fb`, panels `#ffffff`, `--text:#1a1d2e`, `--muted:#5b6480`, `--line:rgba(20,24,50,.10)`; same indigo→violet accents, softer glows.

**Typography:** `ui-sans-serif, system-ui, "Segoe UI", Roboto, Inter, sans-serif`; base 14px/1.5. Scale: 12 (meta), 13 (body/controls), 14 (base), 16 (widget/section title), 20 (modal title), 24–28 (login heading). Weights 400/600/700.

**Spacing:** 4px base (4/8/12/16/20/24). **Radius:** cards 16px, buttons/inputs 10px, chips/pills 8px, menus 14px. **Shadows:** `0 10px 40px rgba(0,0,0,.45)` (dark), softer for light. **Icons:** thin 1.75px-stroke inline SVG (gear, plus, x, trash, refresh, cloud, check, calendar, bell, spinner), ~15–20px. **Motion:** 150ms ease on hover/color, 200ms on grid transforms, button active `translateY(1px)`, modal fade + scale-in; honor `prefers-reduced-motion`.

## 4) Component States
Define **default / hover / active / focus-visible / disabled** for buttons, icon-buttons, toggles, menu items, and checkboxes. Button variants: `.primary` (gradient), `.ghost` (outline), `.danger`. Provide per-widget **empty** ("No widgets yet — use + Add widget"; light per-widget illustrations), **loading** (spinner + shimmer skeleton rows), and **error** (inline red message + retry) states. Focus rings: 2px accent ring with offset, visible in both themes.

## 5) Responsive + Accessibility
Grid reflows: multi-column desktop → 2-col tablet → single-column stacked mobile (drag disabled on touch; cards full-width). On mobile the top bar collapses the email into an avatar menu. **A11y:** full keyboard support (logical tab order, Esc closes modal/menus, arrow-key menu nav, focus trap in modal), ARIA (`role="dialog"` + `aria-modal`, `aria-label` on icon buttons, `role="switch"` toggles, `aria-live="polite"` on the reminders feed), WCAG AA contrast (verify muted text in both themes), and 44px minimum touch targets.

## 6) Layout Mockup
```
┌──────────────────────────────────────────────────────────┐
│ ◆ Reminders        user@example.com   [☾] [⚙] [⏻]        │
├──────────────────────────────────────────────────────────┤
│  [ + Add widget ▾ ]                                       │
│ ┌───────────────┐ ┌───────────────┐ ┌──────────────────┐ │
│ │ Inbox      ⋮ ✕│ │ Upcoming   ⋮ ✕│ │ Calendar   ⋮ ✕   │ │
│ │ ☑ Pay invoice │ │ Today         │ │ [M][W][D][Agenda]│ │
│ │ ☐ Email Sam ●│ │  • Standup 9a │ │  Jun 2026  ‹ › ◉ │ │
│ │ ☐ Renew cert  │ │ Tomorrow      │ │ ▦ month grid w/  │ │
│ │ + add task    │ │  • Ship build │ │   event pills    │ │
│ └───────────────┘ └───────────────┘ └──────────────────┘ │
│ ┌───────────────┐ ┌──────────────────────────────────────┐│
│ │ Reminders  ⋮ ✕│ │ CalDAV tasks                    ⋮ ✕  ││
│ │ 🔔 Build done │ │ ▢ Groceries  · iCloud · Personal     ││
│ │ 🔔 2 due soon │ │ ▢ Deploy     · Nextcloud · Work      ││
│ └───────────────┘ └──────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

Prioritize visual craft and consistency across every screen and state.
