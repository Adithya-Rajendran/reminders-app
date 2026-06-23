# Usability Test Kit

A reusable, evidence-based protocol for testing reminders-app **from a real user's perspective**. Built for a single operator/moderator to run on the real app, with a bias toward the **ultrawide 21:9 (2560×1080)** screen of record. Grounded in NN/g usability methodology and Sauro & Lewis (*Quantifying the User Experience*).

> The app's job is a self-hosted CalDAV/WebDAV task+calendar dashboard. The design north star for judging findings: **capture in ~3s & defer decisions** (Zeigarnik; Masicampo & Baumeister 2011), **recognition over recall** (NN/g #6), **respond <400ms / optimistic UI** (Doherty), **undo over confirm** (NN/g #3), **cap the measure not the canvas** on wide screens (WCAG 1.4.8), **calm & forgiving** (no guilt mechanics), **intentional > complete**.

## Personas
- **P1 — Self-host tinkerer (primary).** Runs their own Nextcloud, comfortable with CalDAV URLs / app-passwords, values keyboard speed and frictionless capture. *Recruit skewed toward P1.*
- **P2 — Pragmatic organizer (secondary).** Was handed an instance by a techy friend; doesn't know what CalDAV is; expects Apple-Reminders-like simplicity. *Run 3–5 — the connect-account flow is where the personas diverge most.*

## Sampling & rounds
- **5 users per round, qualitative** — ~85% of problems surface at 5 with a homogeneous audience (Nielsen/Landauer). 
- **Iterate:** three rounds of 5 beat one round of 15. Fix every severity 3–4, then retest. Keep the core task set + SUS constant across rounds so the numbers are comparable.
- **For defensible numbers** (success %, SUS, timings) you need ~20 (basic) / ~40 (stable). With 5, report **directional** intervals only.
- **Operator pre-pass first:** before any users, run a heuristic evaluation (all 10 Nielsen heuristics) of the maximized 21:9 board + a cognitive walkthrough (the 4 per-step questions) of the two riskiest flows: *connect-account* and *capture-then-find-it-again*.

## Task scenario bank
Goal-level wording — **no UI terms** ("reminder", "group", "triage", "quick-add"), no leading hints.

| # | Scenario (read to the user) | What it probes |
|---|---|---|
| T1 | "You just set this up — connect it to your own Nextcloud so your tasks show up." | Connect-account flow; app-password discovery. Likely **sev-4 for P2**. |
| T2 | "Set yourself a nudge to call the dentist tomorrow at 2pm." | Which quick-add (Reminders vs Upcoming)? Is the parsed date/time shown back? |
| T3 | "You only do work errands in work hours — make that dentist nudge a Work item." | Group picker vs `*label` ambiguity; hidden chip-filtering of tags. |
| T4 | "Add a checklist item under that reminder." | Subtask (`+ subtask`) discoverability. |
| T5 | "You've got 5 spare minutes — show only the things you can knock out fast." | The "2-min only" filter; mental model. |
| T6 | "Block out a 1-hour lunch on Thursday." | Calendar click-day → new event; calendar selection; all-day vs timed. |
| T7 | "Decide what's actually worth doing first this morning." | Triage; does the gamified layer read as serious or childish? |
| T8 | "See whether you got more done this week than last." | Review widget. |
| T9 | "Drag a 1-hour task onto your calendar, then let the time pass without doing it — is it still on your list?" | Time-block ≠ completion. |
| T10 | Fresh account, zero tasks/events, no Nextcloud. | Does each empty state name what's empty + the next action? |

## Protocol (per session, ~45 min)
1. 2-min pre-brief: "We're testing the app, not you. Please think aloud. I'll mostly stay quiet."
2. 8–10 scenarios, **concurrent think-aloud**, screen + audio recorded. The user drives the **maximized 2560×1080** window; the operator never points or helps.
3. **SEQ** (Single Ease Question, 7-pt) immediately after each task.
4. **SUS** (10-item) once at the end.
5. 3-min conversational debrief.
- Moderation: on silence wait 4–6s then "What are you thinking?"; redirect help requests with "If I weren't here, what would you do?". Use *retrospective* think-aloud only for any timed tasks (concurrent inflates time).

## Metrics to capture
- **First click per task** — log on a screenshot of the *full 2560px board taken before the user acts*. Right first widget ≈87% eventual success vs ≈46% (Bailey & Wolfson). On a 9-widget board this is the make-or-break discoverability signal.
- **Task success** — 3-level code (success / partial / fail) + the path taken. Use completion-rate for the linear connect-account wizard.
- **Adjusted-Wald 95% CI** on every rate (add 2 successes + 2 failures, then Wald). Report "4/5 = 36–98% (directional)", never a bare "80%".
- **Time-on-task** — compare like-with-like only (e.g. round-over-round), never against an invented benchmark.
- **SEQ** after each task; flag any mean < 5.3 (Sauro benchmark).
- **SUS** at session end (0–100; 68 = C average, >80.3 = A, <51 = F). Don't quote a precise number until ~12+ responses are pooled.
- **Ultrawide-specific:** does the >2000px sweep between where a task is captured (left) and where it appears (right) register as a status problem (do users re-add, thinking it failed)? Do long lists / Notes respect ~60–75ch? Does perceived response stay under ~400ms against real CalDAV latency?

## Severity scale (Nielsen, 0–4)
0 = not a problem · 1 = cosmetic (fix if time) · 2 = minor (low priority) · 3 = major (high priority) · 4 = catastrophe (fix before release).
Severity = **frequency × impact × persistence**. A solo operator approximates the 3-evaluator average by re-rating after watching *all* recordings, weighted by how many of the 5 hit each issue. Tag every finding with the Nielsen heuristic it violates. **Fix all sev 3–4 before the next round.**

## Round-over-round discipline
Keep the 8 core tasks + SUS identical between rounds so success rate, time, SEQ, and SUS are comparable — that's how you prove a redesign moved the numbers without introducing new sev-3+ problems.

---
*Sources: Nielsen Norman Group (how-many-test-users, severity ratings, think-aloud, scenarios, first-click); Bailey & Wolfson (first-click predictiveness); Sauro & Lewis, *Quantifying the User Experience* (SUS, SEQ, Adjusted-Wald); Cowan 2001; Doherty & Thadani (response time).*
