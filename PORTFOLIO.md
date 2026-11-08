# Toad Live

**A real-time, multi-user status board for a shared residential building — seven facilities' worth of live state (ten laundry machines, study rooms, a music room, a computer lab's ten individual seats) kept accurate by whoever last reported, not by sensors.**

**Live demo:** https://comp4020-final-astra-erevos.fly.dev
**Repository:** https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos

## The problem

In a shared residential building, "is the washer free?" or "is the study room in use?" is usually answered by walking there and looking. Toad Live replaces that walk with a live, resident-reported status board: pick a facility, see its current state and (where known) how long it has left, and report a change in a few seconds. There's no account to create and no sensor hardware — identity is a server-issued pseudonymous session, and ordinary time-sensitive status (occupied, in-use) decays back to "unknown" rather than being trusted forever, while a small number of sticky states (an out-of-order machine) hold until someone explicitly changes them. The interesting engineering problem isn't the CRUD surface; it's making human-reported, inherently stale information behave honestly under concurrent multi-user writes.

## Stack

- **Astro** (server-rendered pages + islands) on **Node**, deployed as a single container
- **SQLite** (`node:sqlite`) on a Fly.io persistent volume — no separate database server
- **Server-Sent Events** for real-time push to every connected session
- **Three.js**, one shared `WebGLRenderer` across seven live 3D scenes
- **Vitest** (264 tests) + **Playwright** for browser verification
- Deployed on **Fly.io** (one `shared-cpu-1x` machine, 256MB), CI on GitHub Actions

## How it works

A resident opens the app and picks a facility tab. The server reads current state straight from SQLite for the first paint — no client-side fetch needed to see where things stand. From there, an open `EventSource` connection receives every other session's reports live, and the resident's own reports go out as a `PATCH` carrying the `version` they last saw. If someone else wrote to the same resource in between, the server rejects the write with `409` and the current canonical state, rather than silently overwriting it or guessing who's right. Ordinary time-sensitive reports have a lifespan: if nobody re-confirms one, it lazily decays to "unknown" the next time anyone reads it — never on a timer, never pretending a five-minute-old report is still true an hour later. A sticky state like out-of-order is the deliberate exception: it holds until a new report explicitly changes it.

See [`docs/portfolio/architecture.md`](docs/portfolio/architecture.md) for the full request/write/broadcast flow with a diagram.

## Engineering highlights

**A CI flake that turned out to be a real architectural bug.** A docs-only commit — no code changed — failed CI seven times running, always `database is locked`, on a different test file each time. The seven-times-on-a-no-code-change pattern ruled out a one-off before any fix was attempted. The real cause: a test importing a room module for its pure decay logic was *also*, transitively, opening a second live SQLite connection to the app's own on-disk file, racing it for the same lock. The fix was an architectural split, not a retry — each room module now takes an injected `store`/`now` and never imports the database layer directly; one sibling module per facility owns the one real connection. Verified with 15 repeated full test runs and the decay specs running in parallel 15 more times, zero lock errors since. ([`91167bd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/91167bd2a833c4cbe9d9399e45d8299ea537d16e))

**Catching a silent-overwrite hole before writing any code.** Optimistic concurrency (a `version` column, reject stale writes with 409) was first designed to cover resident reports only. Before implementation, a review caught that the server's own background decay — a status quietly expiring to "unknown" — is *also* a canonical mutation: a stale report resurrecting a state the server had already invalidated would have been exactly the silent-overwrite bug the versioning was meant to prevent, just one layer further down. Catching that at design time, not after shipping, is what makes the concurrency model actually hold for every write path, not just the obvious one.

**A production incident that became a durable rule, not a one-off patch.** During a real Fly redeploy check, a malformed client timestamp (past `Number.MAX_SAFE_INTEGER`) got written to a row unvalidated. `node:sqlite` throws rather than truncates when it reads an oversized integer back out — so that one bad write 500'd the row on *every subsequent* request against it, not just the original one. The fix rejects unsafe timestamps at the API boundary before they reach SQLite, ships with a regression test reproducing the exact failure, repairs the live corrupted row, and adds a standing rule so any future client-supplied number gets the same guard. ([`3c0b63f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/3c0b63f0a73d01dae71d7fa1f9e6fe4d31057a32))

More case studies, including a deliberate resource-modeling decision for the computer-lab facility (ten independently-reportable seats instead of one room-level flag), are in [`docs/portfolio/case-studies.md`](docs/portfolio/case-studies.md).

## Testing and production evidence

- **264 automated tests** (Vitest) across 22 spec files, run against the same Docker image Fly deploys — not a separate "test build"
- CI (`check` workflow) builds the production container, boots it, runs the full spec suite against it, and scans for committed secrets before any deploy
- Deployed and verified live at the demo URL above, including real multi-session SSE checks (two independent browser sessions, no reload, cross-session updates land within about a second) and a genuine server-restart reconnect test, not just a local dev-server check
- Eight architecture decision records in [`notes/adr/`](notes/adr/) — two cross-cutting (real-time/concurrency, identity) plus one per facility from AA Room through Rat Room (Laundry predates the ADR practice) — each documenting the actual tradeoffs considered, not just the final shape

## Further reading

- [`docs/portfolio/architecture.md`](docs/portfolio/architecture.md) — system diagram and the reasoning behind the real-time/persistence/concurrency design
- [`docs/portfolio/case-studies.md`](docs/portfolio/case-studies.md) — three engineering problems in more depth
- [`notes/adr/`](notes/adr/) — the full decision records, written as the project was built
- [`PROCESS.md`](PROCESS.md) — the development process and two incidents that changed how the project was built

---

*Toad Live was built as the final project for COMP8020 (Agentic Coding Studio, ANU). The brief set the premise (a status board for a residential community); the architecture, the engineering decisions, and the incidents above are the actual work.*
