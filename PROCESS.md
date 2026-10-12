# Process overview

This file records the decisions and events that shaped Toad Live — one
entry per decision or incident, not a task list, saying what the
alternative was or what broke and how it got fixed. Rewritten again at the
end of Crit 9, once real-time was actually implemented and verified, to
stay inside the project's own length target; detail trimmed from here
still lives in the commits and the ADR it cites.

## Concept and stack

Toad Live began from a real complaint: no shared view of which Toad Hall
laundry machine is free, and a human report is only trustworthy while it
stays fresh. The audience, the five real locations (A/B, C, E, F, G — D has
none), the four machine states, out-of-order's stickiness, and the
washer-display-vs-dryer-estimate distinction for remaining time were
interrogated in conversation and landed as the design anchor in
[`4028255`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/4028255).
Astro was chosen the same session — cheap mostly-static pages, enough
dynamic surface for reading/writing machine status, and a comfortable fit
for the fixed 256MB/one-machine Fly shape. Storage is SQLite via
`node:sqlite` on the one thing Fly actually persists, `/data`.

## Crit 8: persistence, then a bug that mattered

[`6ffddd8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/6ffddd8)
is where the app became an app: server-mode Astro, the `machines` table
seeded with all ten real machines, `GET`/`PATCH /api/machines/:id`, and a
persistence test covering Crit 8's actual proof — a status update checked
by an independent later request. Two manual visual passes followed, landed
together in
[`ce3c5aa`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/ce3c5aa).

Verifying persistence against a real Fly redeploy surfaced a real
incident: a malformed timestamp got written unvalidated into `started_at`,
and `node:sqlite` throws rather than truncate when it later reads an
`INTEGER` past `Number.MAX_SAFE_INTEGER` — that row 500'd on every
subsequent request. The durable fix, in
[`3c0b63f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/3c0b63f):
`PATCH` rejects any unsafe `startedAt`/`expectedEndAt` before it reaches
SQLite, with a regression test and a general `CLAUDE.md` rule.

## Closing the in-use leak

A resident reported, after Crit 8, that an in-use machine never stopped
being in-use.
[`f9ed19c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/f9ed19c)
added lazy decay, computed on an ordinary read, never pushed: a timed
report expires to `unknown` exactly when `expected_end_at` passes; an
untimed one falls back to a **provisional** 12-hour window
(`UNTIMED_IN_USE_DECAY_MS`). `available` and `out-of-order` stay untouched.

## Crit 9: deciding real-time and concurrency

The brief's demand: a change reaches every other open session within about
a second, no reload, plus one decided and justified call about
simultaneous use. The full decision record is
[`notes/adr/0001-realtime-and-concurrent-updates.md`](notes/adr/0001-realtime-and-concurrent-updates.md),
landed in [`d76e62b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d76e62b):
**SSE** over WebSocket (never needs to push back — writes stay `PATCH`) and
polling (fights `fly.toml`'s auto-stop economics); **optimistic
concurrency** over last-write-wins, which can silently discard a newer
state — including resurrecting a report the server's own lazy decay
already invalidated — and over preserving every conflicting report, which
costs "useful at a glance" for a problem nobody had hit yet.

## Crit 9: versioned updates, then real-time

[`9c99f73`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/9c99f73)
gave `machines` a server-owned `version`, starting at 1, with an explicit
`ALTER TABLE` migration for the database that already existed on the real
`/data` volume — verified against a hand-built pre-version database, not
just a fresh one, before it shipped. Every persisted mutation, a resident's
report or a decay transition alike, increments it atomically
(`WHERE id = ? AND version = ?`); a stale write gets 409 with the current
canonical state, never a silent overwrite. `reportStatus()` now returns an
explicit tagged result instead of overloading `undefined` for two
different failures, and the `Machine` type moved into `src/lib/types.ts` to
keep the database layer and the realtime module from needing each other.

[`85f31d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/85f31d0)
added the transport: an in-process broadcast module, a `GET /api/stream`
SSE route with no snapshot or event history (a reconnecting client just
re-fetches current state), and client-side handling that patches a
machine's card and the summary counts in place. The one existing write
interaction — the report form — now carries the version it was rendered
with and gets live-updated by its own broadcast; a 409 shows a plain
message, applies the server's actual state, and leaves the resident to
re-confirm, rather than reloading silently or at all.

## Verifying it for real

Two bugs surfaced in the tests themselves, both the same shape: a PATCH
whose `expectedEndAt` was already past decays immediately inside
`reportStatus()`'s own re-read, so a test expecting a later, separate jump
in version or a separate broadcast was wrong to assume one — fixed by
using a short *future* end time and waiting past it instead, once for the
version assertion and once for the SSE decay test. Running every spec file
in parallel (Vitest's default) also meant two files could race on the same
machine id once writes were version-matched; mutating tests were
re-assigned to dedicated ids.

With `pnpm check` and `pnpm check:evidence` green, the real check was
manual: two independent browser sessions, open together. Locally, and then
again against the live Fly deployment after CI shipped
[`85f31d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/85f31d0) —
a report in one browser reached the other within about a second, card and
summary both, no reload on either side. Forcing a stale version in the
second browser produced the conflict message, left the newer state
untouched, refreshed the card to it, and a second, re-confirmed report
then succeeded normally — the whole loop the ADR promised, not just its
pieces.

## What's still ahead

The broader freshness policy beyond the in-use window above —
`available`/`unknown` lifetimes, the provisional 12-hour value itself —
stays open pending real cycle-time data, tracked in
`notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10. Verified resident identity,
presence/"who else is here", and every non-laundry space remain
deliberately out of scope.
