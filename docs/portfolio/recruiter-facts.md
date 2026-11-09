# Toad Live — Recruiter Facts

A single, verified source of truth for writing a resume, LinkedIn entry, or
cover letter about this project. This is not marketing copy and not another
interview pack — every claim below is directly supported by the current
repository or verified deployment history.

## Product

Toad Live is a real-time, multi-user status board for a shared student
residence: residents report whether a washing machine, study room, common
room, or computer-lab seat is free, in use, or out of order, and every
other connected session sees that update live, without refreshing.

Built for a bounded residential community (not the general public), with
no accounts — identity is a server-issued pseudonymous session, not a
login.

**Seven facilities**: laundry (ten machines across five locations), AA
Room (a common room where occupancy can coexist with more than one
activity — e.g. TV and pool at once), Otter/Rabbit/Weasel/Badger Rooms
(four single-occupancy rooms), and Rat Room (a ten-seat computer lab
modeled as ten independently-reportable seats).

Key behavior: status is always based on a human report, never a sensor;
a report can go stale, so the app lazily decays an old "in-use" status to
"unknown" the next time anyone reads it; and two people reporting the
same resource near-simultaneously never silently overwrite each other.

## Stack

- **Astro** — server-rendered pages and API routes, compiled to a single
  Node server (`@astrojs/node`, standalone mode).
- **Node** — the one runtime process serving pages and API routes.
- **SQLite via `node:sqlite`** — the only persistence layer; one file on
  one Fly volume, no separate database server.
- **Server-Sent Events (SSE)** — one-directional, push-only real-time
  transport from server to every connected session.
- **Three.js** — renders each facility's 3D scene; one shared
  `WebGLRenderer` drives all seven facilities' scenes.
- **Fly.io** — hosts the live product: one `shared-cpu-1x` machine, 256MB
  memory, one persistent volume, scale-to-zero when idle.
- **GitHub Actions** — CI (builds/tests the real Docker image before
  every deploy) plus a separate deploy workflow for the case study.
- **Vitest** — the test runner for the full `spec/` suite (264 tests,
  real Node + `node:sqlite`, no mocking framework).
- **Playwright** — used in standalone tooling (`scripts/portfolio/`) for
  demo-video capture and visual-review verification; not part of the
  app's own `spec/` suite.

## Engineering highlights

- **Optimistic concurrency via `ifVersion` and HTTP 409.** Every mutable
  resource (machine, room, seat) carries a server-owned `version`
  counter. A write is accepted only if the client's `ifVersion` still
  matches the current version; a mismatch returns `409` and the actual
  current state, never a silent overwrite.
- **Lazy, read-triggered freshness decay.** Staleness is checked only
  when a resource is read — never on a timer. An old "in-use" report
  decays to "unknown" as part of an ordinary read; a sticky status like
  out-of-order never decays.
- **Server-issued pseudonymous sessions.** The server generates a
  high-entropy credential, stores only its SHA-256 hash, and issues the
  raw token as an `HttpOnly` cookie. No account creation; a client can
  never assert its own identity in a request body.
- **Rat Room's ten-resource model.** Instead of one room-level occupancy
  flag, Rat Room's ten seats (A–J) are each independently reportable,
  with their own status, confirmation time, and version — so the app can
  say "six seats free" instead of just "occupied."
- **One shared `WebGLRenderer`.** All seven facilities' 3D scenes share a
  single renderer instance and scene-mounting registry, not one renderer
  per facility.
- **SQLite persistence on a single Fly volume.** All durable state —
  every facility's status rows and the session table — lives in one
  SQLite file on the one volume that survives a restart or redeploy.
- **Real-time SSE with reconnect recovery.** The browser's `EventSource`
  reconnects on its own after a dropped connection; a registered
  `onOpen()` handler re-fetches canonical state on every (re)connect,
  with no page reload and no event-replay log.

## Testing / verification

- **264 automated tests across 22 spec files** (Vitest), confirmed by a
  fresh local run.
- Three real test categories: HTTP-integration tests (real `fetch()`
  against a running server), in-memory-SQLite direct-function tests (a
  real in-memory `node:sqlite` database, no HTTP), and pure-function
  tests (no database at all).
- CI builds the actual production Docker image, runs it with a throwaway
  `/data` volume, and runs the full suite against it over real HTTP
  before any deploy — the same image Fly deploys.
- Manual production/browser verification beyond the automated suite:
  two-browser-session checks for real-time SSE delivery and 409 conflict
  behavior, and a live server-restart check of SSE reconnect, observed
  directly against the deployed Fly app.

## Concrete engineering incidents

- **SQLite lock-race diagnosis.** A docs-only commit (no code changes)
  failed CI seven times in a row with `database is locked` errors. Root
  cause: a test importing a room module for its pure decay logic
  transitively opened a second real SQLite connection to the same file
  the running app already had open. Fixed by splitting each room module
  into a pure logic half and a thin database-wrapper half. Commit:
  `91167bd`.
- **Rat Room model/design correction.** Rat Room was first modeled with
  decorative, unmapped occupied-seat figures in open floor space. After
  reviewing the rendered 3D scene, this was deliberately reversed to map
  each of the ten seats to its own fixed workstation — a recorded design
  correction, not a bug fix.
- **Secure-cookie production issue.** The session cookie's `Secure` flag
  was computed from the app's own request URL alone, which always read
  as plain HTTP behind Fly's TLS-terminating proxy — so `Secure` was
  silently never set in production. Found via a direct `curl` check of
  the live deployed response, not local testing. Fixed by also checking
  the `X-Forwarded-Proto` header. Commit: `d7d0cd7`.
- **Stale-server/CSS investigation.** Right after an unrelated CSS fix, a
  review reported the entire site looking unstyled. Instead of reverting
  the CSS change on suspicion, a fresh dev server, a fresh production
  build, and an isolated test with the CSS reverted were all run — all
  three rendered correctly. The actual cause was a leftover local server
  process serving an old build whose HTML referenced a since-renamed CSS
  file. Trigger commit: `9a2461e`.

## Agentic development process

Built with Claude Code. Each facility's state model was decided and
written down in an ADR before any code for that facility existed — once
that practice was established (Laundry, the first facility, predates
it). Implementation then proceeded in stages — backend logic, then a
practical status panel, then the 3D scene, then production deployment
and live verification — each stage reviewed and committed on its own
before the next began. `CLAUDE.md` and the ADRs form a standing ruleset
the agent implements against; `spec/` is an enforced merge gate, not
optional documentation. Human review caught issues no automated test
could — including the Rat Room and stale-server cases above.

## Deployment / portfolio

- **Live product:** https://comp4020-final-astra-erevos.fly.dev
- **Recruiter case study:** https://comp4020-agentic-coding-studio.github.io/comp4020-final-astra-erevos/portfolio/
- **Public GitHub repository:** https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos
- **Portfolio branch (recruiter materials, deployment, case study):**
  `portfolio`
- **Frozen submission branch (the actual graded COMP8020 artifact):**
  `main`

## Facts that must not be overstated

- **No measured user or adoption numbers exist** — not deployed to real
  residents at scale; all usage described is development/demo/
  verification activity.
- **No load test proves a concurrency ceiling** — scaling claims are
  reasoned from the design, not measured under load.
- **SSE is not free** — it avoids polling's wasted request volume against
  a scale-to-zero machine, but an open connection still holds real
  resources; never claim zero overhead.
- **SQLite is not claimed universally better or faster than Postgres** —
  it fits this specific deployment shape (one machine, one process, no
  separate DB server), not a general performance claim.
- **AI did not independently design the architecture** — every state
  model and concurrency/decay decision was written in an ADR before
  implementation; the agent implemented decisions, it didn't make them.
- **Not every test is an HTTP integration test** — of the 264 tests, some
  are HTTP-integration, some are in-memory-SQLite with no HTTP, and some
  are pure-function tests with no database at all.
