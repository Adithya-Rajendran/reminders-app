# Reminders

A self-hosted, customizable **task + calendar dashboard** — a personal "command center" you actually own. Drag-and-drop resizable widgets over a [Vikunja](https://vikunja.io) backend, with **CalDAV sync** (Nextcloud / Apple iCloud / generic), a multi-view calendar, **OIDC single sign-on**, and a light/dark theme — all running on your own Kubernetes.

[![ci](https://github.com/Adithya-Rajendran/reminders-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Adithya-Rajendran/reminders-app/actions/workflows/ci.yml)
[![docker](https://github.com/Adithya-Rajendran/reminders-app/actions/workflows/docker.yml/badge.svg)](https://github.com/Adithya-Rajendran/reminders-app/actions/workflows/docker.yml)
![license](https://img.shields.io/badge/use-personal%20%2F%20FOSS-6d6cf7)

> Personal, non-commercial project. Built on FOSS; see [licensing](#licensing).

---

## Screenshots

|  |  |
|---|---|
| **Dashboard — dark** | **Dashboard — light** |
| ![dashboard dark](docs/screenshots/dashboard-dark.png) | ![dashboard light](docs/screenshots/dashboard-light.png) |

**Multi-view calendar** (month / week / agenda — events + tasks merged from Vikunja & CalDAV)

| Month | Week | Agenda |
|---|---|---|
| ![month](docs/screenshots/calendar-month.png) | ![week](docs/screenshots/calendar-week.png) | ![agenda](docs/screenshots/calendar-agenda.png) |

| **CalDAV Sync settings** | **SSO login** |
|---|---|
| ![settings](docs/screenshots/settings-caldav.png) | ![login](docs/screenshots/login.png) |

**Interactive tasks** — natural-language quick-add, one-click scheduling (popover open) & priority, recurring badges, grouped Upcoming, actionable reminders

![interactive tasks](docs/screenshots/interactive-tasks.png)

---

## Features

- 🧩 **Customizable dashboard** — draggable, resizable widget grid ([react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)); arrange it however you like, layout auto-saves per user.
- ✅ **Task widgets** backed by **CalDAV** — your tasks live as VTODOs in your own server (Nextcloud / iCloud / any CalDAV); projects are your task calendars and an **Upcoming** view groups by Today / Tomorrow / This week. Recurrence (RRULE) and reminders (VALARM) round-trip and sync to your devices.
- ⚡ **Interactive tasks** (influenced by Todoist / TickTick / Things) — **natural-language quick-add** (`report tomorrow !2 *work` → due date + priority + label), one-click **scheduling** (Today / Tomorrow / Weekend / Next week / clear) and **priority** menus, **recurring-aware** completion with a satisfying pop + **Undo**, **drag tasks on the calendar** to reschedule, and an **actionable reminders feed** (complete / snooze).
- 📅 **Multi-view calendar** ([FullCalendar](https://fullcalendar.io)) — month / week / day / agenda; create, drag-reschedule, edit & delete events; tasks overlay automatically.
- ☁️ **CalDAV sync** — connect **Nextcloud**, **Apple iCloud**, or any **generic CalDAV** server; discover task lists, toggle which to sync, read & complete tasks, two-way calendar **events** (VEVENT) write-back.
- 🔔 **Live reminders feed** — a poller over your CalDAV VALARMs → **per-user** SSE → instant in-app updates (the alarms also fire natively on your devices).
- 🔐 **OIDC single sign-on** (Authentik / Keycloak / any OpenID Connect provider) via a backend-for-frontend; sessions persisted in a small local SQLite file.
- 🎨 **Light & dark themes + selectable accents** — a one-click theme toggle and an 8-swatch **accent picker** in the top bar, both persisted per browser.

## How it works

```
Browser ──TLS──▶ Gateway/Ingress ──▶ Reminders (Node BFF + React SPA)
                                         │  OIDC (PKCE) ──▶ your IdP
                                         │  tasks/projects/labels/recurrence/reminders ─▶ CalDAV (Nextcloud/iCloud/…)
                                         │  calendar events (VEVENT) ─▶ CalDAV
                                         │  layouts + account config + sessions ─▶ SQLite (local file)
                                         ▼
                       VALARM poller ─▶ per-user SSE
```

The **BFF** (`app/server`, Node + Express) does server-side OIDC, keeps an HttpOnly session, and is a thin layer over **CalDAV**: tasks/projects/labels/recurrence/reminders are VTODOs in the user's own CalDAV server (via [tsdav](https://github.com/natelindev/tsdav) + [ical.js](https://github.com/kewisch/ical.js)), giving real multi-tenancy and device sync for free. A small **SQLite** file (WAL, on a block volume) holds only what's easy to recreate — dashboard layouts, encrypted CalDAV account config, and sessions. A **VALARM poller** pushes per-user SSE reminders. The **SPA** (`app/client`, React 18 + Vite) is the dashboard. See [`docs/CALDAV_REPLATFORM_PLAN.md`](docs/CALDAV_REPLATFORM_PLAN.md) for the design.

## Quick start (container image)

The image is published to GHCR by CI:

```bash
docker run -p 8080:8080 -v reminders-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e CONFIG_DB_PATH=/data/config.db \
  -e OIDC_ISSUER="https://idp.example.com/application/o/reminders/" \
  -e OIDC_CLIENT_ID=... -e OIDC_CLIENT_SECRET=... \
  -e OIDC_REDIRECT_URI="https://reminders.example.com/auth/callback" \
  -e APP_BASE_URL="https://reminders.example.com" \
  -e CALDAV_ENC_KEY="$(openssl rand -hex 32)" \
  ghcr.io/adithya-rajendran/reminders-app:latest
```

Needs only a writable volume for the SQLite config DB (`CONFIG_DB_PATH`) and an **OIDC** provider — no database server. Register the OAuth2 redirect URI with your IdP; each user links their own CalDAV account in-app (Settings). Optional: `REMINDER_POLL_MS` (VALARM poll interval, default 60000); `CALDAV_BLOCK_PRIVATE=1` to also block RFC1918 destinations for the CalDAV egress guard.

### Kubernetes

Manifests are under [`k8s/`](k8s/) (namespace, a 1Gi block-storage PVC for the SQLite config DB, the app + HTTPRoute). They were written for an K8s 1.35 + Cilium Gateway API + cert-manager cluster with PodSecurity `restricted` enforced — adapt the ingress/StorageClass/hostnames for yours. SQLite needs **block** storage (ceph-rbd / local-path), not a shared filesystem (CephFS/NFS), for safe WAL locking; the Deployment uses `Recreate` since the RWO volume can't be multi-attached. The app pulls **`ghcr.io/adithya-rajendran/reminders-app:latest`** (built & pushed by CI) — `kubectl apply -f k8s/` after creating the `reminders-app-env` secret.

## Development

```bash
cd app
npm install
npm run dev      # Vite dev server (proxies /api & /auth to a running BFF)
npm run build    # build the SPA into app/public
npm run lint     # ESLint
npm start        # run the BFF (serves app/public)
```

CI (`.github/workflows/ci.yml`) runs lint + build on every push/PR; `docker.yml` builds and pushes the image to GHCR on `main` and tags. Both use GitHub-hosted runners (free for public repos) — no self-hosted runner required, though one can be added on the cluster if desired.

## Design

The UI was generated from a reusable design prompt and ported into the app — see [`DESIGN_PROMPT.md`](DESIGN_PROMPT.md) and the handoff under [`design_handoff_reminders/`](design_handoff_reminders/). Theme tokens (both themes) live in `app/client/src/styles.css`.

## Licensing

The app's own components are FOSS and permissive (MIT/Apache/MPL: React, FullCalendar, react-grid-layout, tsdav, ical.js, Express, better-sqlite3…). Nextcloud (AGPL) is reached only as an external CalDAV server you run yourself. Not legal advice. Don't run this as a multi-tenant/commercial service without reviewing each component's license.

## Acknowledgements

[FullCalendar](https://fullcalendar.io) · [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) · [tsdav](https://github.com/natelindev/tsdav) · [ical.js](https://github.com/kewisch/ical.js) · [Authentik](https://goauthentik.io) · [Nextcloud](https://nextcloud.com).
