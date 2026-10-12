# ADR 0001: Real-time transport and concurrent-update handling

**Status**: Implemented (Crit 9) — versioning in
[`9c99f73`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/9c99f73),
SSE in
[`85f31d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/85f31d0),
verified both locally and against the live Fly deployment — see
Verification below.

## Context

Crit 9 ("All at once") requires two things of Toad Live: a change one
resident makes reaches every other open session within about a second, with
no reload; and one decided, justified call about what happens when several
residents use the app at once. `CLAUDE.md` had deliberately kept real-time
transport out of scope until this crit; this ADR is that decision landing.

The app runs as a single Node process on a single Fly machine (`fly.toml` —
no horizontal scaling, `min_machines_running = 0`), writes already go
through `PATCH /api/machines/:id`, and machine rows already carry a lazy
decay (`src/lib/db.ts`, `decayed()`, landed in `f9ed19c`): a timed `in-use`
report expires to `unknown` the moment its `expected_end_at` passes; an
untimed one falls back to a provisional 12-hour window; `available` never
decays; `out-of-order` is sticky. None of that changes here — decay stays
read-triggered, lazy, and exact where a real end time exists.

## Decision 1 — transport: server-sent events

Chosen over WebSocket and polling.

- WebSocket's bidirectionality isn't used: the client never needs to push
  anything over the live channel, since writes already go through `PATCH`.
  SSE is the narrower tool for a one-directional push.
- Fast polling can hit "about a second," but only by polling often, which
  fights `fly.toml`'s own `auto_stop_machines`/`min_machines_running = 0`
  economics — its comment is explicit that stopping idle machines is "most
  of why the app costs cents, not dollars."
- One Fly machine means one Node process at any time the app is up, so an
  in-process subscriber list is correct, not a shortcut — there's no
  second instance to reconcile broadcasts with.

## Decision 2 — concurrency: optimistic concurrency over last-write-wins

Three options were considered:

- **Last-write-wins** (today's actual behaviour — `reportStatus()` has no
  read-before-write): rejected. It can silently discard a newer canonical
  state with no sign anything was lost. Two concrete failure shapes exist
  in this app specifically: a stale resident report can overwrite a
  fresher resident report (e.g. a stale "available" view overwriting a
  newer out-of-order report); and, because decay is a real write to the
  row too, a stale report can silently resurrect a state the server's own
  lazy decay already invalidated, with nothing telling anyone it happened.
  Both are exactly the kind of silent staleness README's freshness
  argument says is worse than data that visibly admits its own age.
- **Preserve every conflicting report** (an append-only log instead of
  overwriting the row): rejected for this crit. It's the most honest model
  of "a report is a claim, not a fact," but it costs the "useful at a
  glance" property directly — a resident glancing at a card for a few
  seconds shouldn't have to adjudicate two disagreeing claims — and it
  solves a problem (needing report history) nobody's hit yet.
- **Optimistic concurrency / stale-write rejection**: chosen.

## Mechanics

- `machines` gains `version INTEGER NOT NULL DEFAULT 1` — server-owned,
  starting at 1 (not 0, to stay consistent with the existing "safe
  positive integer" validation style already used for timestamps).
- Every persisted mutation increments it atomically in the same
  statement: `UPDATE machines SET ..., version = version + 1 WHERE id = ?
  AND version = ?` for a resident's report, and the equivalent guarded
  update inside `decayed()` for a decay transition. Zero rows affected
  means the write didn't apply — distinguished afterward as "no such
  machine" (404) or "stale version" (409), never conflated.
- A `PATCH` carries `ifVersion`, the version its client last saw, and
  never sets `version` directly. `ifVersion` is validated as a safe,
  non-negative integer before use — the same shape as the
  `startedAt`/`expectedEndAt` guard `CLAUDE.md` already requires, applied
  to a new client-supplied number, not a new category of rule.
- A stale write returns 409 with the current canonical machine state in
  the body, so the client can reconcile without a second round trip.
- Decay keeps its existing trigger exactly as it is — still lazy, still
  only evaluated inside `decayed()` on an ordinary read. A reconnecting
  client's re-fetch of current state is itself that read, so a decay that
  was due while nobody was looking gets picked up the normal way, with no
  new "connecting triggers a read" rule needed.

## Implementation notes, pinned ahead of coding

- The `Machine` type moves out of `src/lib/db.ts` into a neutral
  `src/lib/types.ts`, imported by both `db.ts` (which calls `broadcast()`)
  and the new `src/lib/realtime.ts` (which needs the `Machine` shape for
  its subscriber callback type) — avoids a cycle between the two.
- The DB layer's update functions return an explicit tagged result (e.g.
  `{ ok: true, machine }`, `{ ok: false, reason: "not-found" }`,
  `{ ok: false, reason: "stale", current }`) rather than overloading
  `undefined` for both "no such machine" and "stale version" — the two
  need different HTTP statuses and the route handler shouldn't have to
  re-derive which one happened.
- The decay-broadcast test cannot rely on an already-expired
  `expected_end_at` at `PATCH` time, because `reportStatus()` returns
  through `getMachine()`, which itself runs `decayed()` — the row would
  already read as decayed before the SSE subscription even exists. The
  test instead: `PATCH`es `in-use` with a short-but-safe future
  `expectedEndAt`, opens the SSE subscription, waits past that time, then
  issues the ordinary `GET` that triggers the lazy decay, and asserts the
  open session receives the resulting `unknown` state. A small CI timing
  margin applies to the wait/assert window, same as the delivery test;
  "about a second" stays the product contract.

## Consequences

A resident's report usually costs nothing extra (no conflict, same cost as
today); the rare genuine conflict costs one reconfirm step instead of a
silent, invisible loss. `version` and `ifVersion` are new surface the
client has to carry and the server has to validate, and the real deployed
`/data` volume needs an explicit
`ALTER TABLE machines ADD COLUMN version INTEGER NOT NULL DEFAULT 1`
migration — `db/schema.sql`'s `CREATE TABLE IF NOT EXISTS` won't retrofit
rows that already exist there.

## Verification

Automated: `spec/concurrency.test.ts` (missing `ifVersion` rejected, a
matching version succeeding and advancing, a stale version rejected with
409 and the newer state left intact), `spec/realtime.test.ts` (a resident
report and a read-triggered decay each reaching another open SSE session
within a small margin around the ~1s target), and an added assertion in
`spec/decay.test.ts` that a real decay advances `version`. The migration
was verified against a hand-built pre-version database shape, not just a
fresh one — existing rows kept their data and gained `version: 1`, and
re-running it against an already-migrated file was a no-op.

Manual, two independent browser sessions open together, run twice —
against the local dev server and again against the live Fly deployment
after CI shipped `85f31d0`: a report in one browser reached the other
within about a second, card and summary counts both, no reload on either
side. A stale version forced into the second browser's form produced the
conflict message, left the newer canonical state untouched, refreshed the
card to it, and a second, re-confirmed report then succeeded normally —
the full conflict → refresh → re-confirm → success loop, not just its
individual pieces, live.
