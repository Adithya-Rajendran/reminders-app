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
- ✅ **Task widgets** backed by Vikunja's REST API — project lists and an **Upcoming** view grouped by Today / Tomorrow / This week.
- ⚡ **Interactive tasks** (influenced by Todoist / TickTick / Things) — **natural-language quick-add** (`report tomorrow !2 *work` → due date + priority + label), one-click **scheduling** (Today / Tomorrow / Weekend / Next week / clear) and **priority** menus, **recurring-aware** completion with a satisfying pop + **Undo**, **drag tasks on the calendar** to reschedule, and an **actionable reminders feed** (complete / snooze).
- 📅 **Multi-view calendar** ([FullCalendar](https://fullcalendar.io)) — month / week / day / agenda; create, drag-reschedule, edit & delete events; tasks overlay automatically.
- ☁️ **CalDAV sync** — connect **Nextcloud**, **Apple iCloud**, or any **generic CalDAV** server; discover task lists, toggle which to sync, read & complete tasks, two-way calendar **events** (VEVENT) write-back.
- 🔔 **Live reminders feed** — Vikunja webhooks → server → SSE → instant in-app updates.
- 🔐 **OIDC single sign-on** (Authentik / Keycloak / any OpenID Connect provider) via a backend-for-frontend; sessions persisted in Postgres.
- 🌗 **Light & dark themes** with a one-click toggle.

## How it works

```
Browser ──TLS──▶ Gateway/Ingress ──▶ Reminders (Node BFF + React SPA)
                                         │  OIDC (PKCE) ──▶ your IdP
                                         │  /api/vikunja/* ─▶ Vikunja (tasks, recurrence, reminders, webhooks)
                                         │  /api/caldav/*, /api/calendar/* ─▶ CalDAV (Nextcloud/iCloud/…)
                                         │  /api/layouts, sessions ─▶ Postgres
                                         ▼
                              SSE reminders ◀─ Vikunja webhooks
```

The **BFF** (`app/server`, Node + Express) does server-side OIDC, keeps an HttpOnly Postgres-backed session, reverse-proxies the Vikunja API with a service account, talks CalDAV (via [tsdav](https://github.com/natelindev/tsdav) + [ical.js](https://github.com/kewisch/ical.js)), persists per-user dashboard layouts, and relays reminder webhooks to the browser over SSE. The **SPA** (`app/client`, React 18 + Vite) is the dashboard.

## Quick start (container image)

The image is published to GHCR by CI:

```bash
docker run -p 8080:8080 \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e DATABASE_URL="postgres://user:pass@host:5432/app" \
  -e OIDC_ISSUER="https://idp.example.com/application/o/reminders/" \
  -e OIDC_CLIENT_ID=... -e OIDC_CLIENT_SECRET=... \
  -e OIDC_REDIRECT_URI="https://reminders.example.com/auth/callback" \
  -e APP_BASE_URL="https://reminders.example.com" \
  -e VIKUNJA_URL="http://vikunja:3456" \
  -e VIKUNJA_USERNAME=... -e VIKUNJA_PASSWORD=... \
  -e WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  -e CALDAV_ENC_KEY="$(openssl rand -hex 32)" \
  ghcr.io/adithya-rajendran/reminders-app:latest
```

Needs a **Vikunja** instance, a **Postgres** database, and an **OIDC** provider. You also need to register the OAuth2 redirect URI with your IdP and a Vikunja webhook → `…/api/webhooks/vikunja`.

### Kubernetes

Manifests are under [`k8s/`](k8s/) (namespace, Postgres, Vikunja, the app + HTTPRoute, NetworkPolicy). They were written for an K8s 1.35 + Cilium Gateway API + cert-manager cluster with PodSecurity `restricted` enforced — adapt the ingress/StorageClass/hostnames for yours. Point the app Deployment at `ghcr.io/adithya-rajendran/reminders-app:latest`.

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

For **personal, single-user self-hosting** the practical obligations are near zero. Components are FOSS — permissive (MIT/Apache/MPL: React, FullCalendar, tsdav, Express, pg…) or copyleft (AGPL: Vikunja/Nextcloud — running upstream images for yourself doesn't trigger the network-source-offer). Not legal advice. Don't run this as a multi-tenant/commercial service without reviewing each component's license.

## Acknowledgements

[Vikunja](https://vikunja.io) · [FullCalendar](https://fullcalendar.io) · [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) · [tsdav](https://github.com/natelindev/tsdav) · [ical.js](https://github.com/kewisch/ical.js) · [Authentik](https://goauthentik.io) · [Nextcloud](https://nextcloud.com).
