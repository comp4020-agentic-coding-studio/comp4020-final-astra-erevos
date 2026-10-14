# Process overview

This file records the decisions and events that shaped Toad Live — one
entry per decision or incident, not a task list, saying what the
alternative was or what broke and how it got fixed. Rewritten again at the
start of Crit 10, to make room for this week's design while staying
inside the project's own length target; detail trimmed from here still
lives in the commits and the ADRs they cite.

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
made the app an app: server-mode Astro, `machines` seeded with all ten
real machines, `GET`/`PATCH /api/machines/:id`, and a persistence test
covering Crit 8's actual proof — a status update checked by an
independent later request. Verifying it against a real Fly redeploy
surfaced a real incident: a malformed timestamp got written unvalidated
into `started_at`, and `node:sqlite` throws rather than truncate when it
later reads an `INTEGER` past `Number.MAX_SAFE_INTEGER` — that row 500'd
on every subsequent request. The durable fix, in
[`3c0b63f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/3c0b63f):
`PATCH` rejects any unsafe `startedAt`/`expectedEndAt` before it reaches
SQLite, with a regression test and a general `CLAUDE.md` rule. Shortly
after, [`f9ed19c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/f9ed19c)
closed a reported leak — an in-use machine that never stopped being
in-use — with lazy, read-triggered decay: a timed report expires to
`unknown` exactly when `expected_end_at` passes; an untimed one falls
back to a **provisional** 12-hour window. `available` and `out-of-order`
stay untouched.

## Crit 9: real-time and concurrency

The brief's demand: a change reaches every other open session within
about a second, no reload, plus one decided and justified call about
simultaneous use. The full record is
[`notes/adr/0001-realtime-and-concurrent-updates.md`](notes/adr/0001-realtime-and-concurrent-updates.md):
**SSE** over WebSocket (never needs to push back — writes stay `PATCH`)
and polling (fights `fly.toml`'s auto-stop economics); **optimistic
concurrency** over last-write-wins, which can silently discard a newer
state — including resurrecting a report the server's own lazy decay
already invalidated — and over preserving every conflicting report, which
costs "useful at a glance" for a problem nobody had hit yet.

[`9c99f73`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/9c99f73)
gave `machines` a server-owned `version`, with an explicit `ALTER TABLE`
migration verified against a hand-built pre-version database, not just a
fresh one. Every persisted mutation increments it atomically
(`WHERE id = ? AND version = ?`); a stale write gets 409 with the current
canonical state, never a silent overwrite.
[`85f31d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/85f31d0)
added the transport: an in-process broadcast module, a snapshot-free
`GET /api/stream` SSE route, and client-side handling that patches a
card and the summary counts in place. Verified both locally and against
the live Fly deployment, two independent browsers open together: a
report in one reached the other within about a second, no reload; a
forced stale version produced the conflict message, left the newer state
untouched, and a re-confirmed report then succeeded normally.

## Crit 10: identity and permissions, designed

Crit 10 requires the app to be multi-user with the distinction checked on
the server, and durable server-side logging. Interrogating today's actual
behaviour against that bar found a real gap: `reporterId` arrives in the
`PATCH` body, client-generated and client-asserted
(`src/pages/index.astro`'s `sessionId()`/`localStorage`), and the server
writes whatever string it's handed straight to `reporter_id` with no
check that it belongs to the request presenting it. Two Chrome profiles
differ today only by `localStorage` accident, not by anything the server
verifies.

The design, recorded in full in
[`notes/adr/0002-identity-and-permissions.md`](notes/adr/0002-identity-and-permissions.md):
a server-issued pseudonymous session, compared against keeping
client-generated pseudonyms (rejected — no server-side trust boundary to
check) and against full verified accounts (rejected — not asked for by
the brief, and blocked by `CLAUDE.md` without its own decision record).
The session's credential, internal actor id, and resident-facing
pseudonym are kept as three distinct values rather than one id serving
all three purposes, so the public API, SSE stream, and logs never expose
anything that would let a reader reconstruct or replay the credential
itself. The permission policy stays a stress-tested "no" to inventing
ownership: every visitor reads everything, any valid session may report
any machine — `machines` has no owner column and the project's own
concept is shared state, not per-resident property — and a request
without a valid session is rejected before mutation, not merely ignored.
A client-asserted `reporterId` in a request body is now explicitly
rejected rather than silently dropped, giving anti-impersonation a direct
contract. Logging is pseudonym-only, stdout, readable during a live
`flyctl logs` narration, and durable by virtue of running on every real
request rather than a demo-only path; a rejected request is logged
without inventing a status the server never parsed.

## What's still ahead

The broader freshness policy beyond the in-use window — `available`/
`unknown` lifetimes, the provisional 12-hour value itself — stays open
pending real cycle-time data, tracked in
`notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10. Verified resident identity
remains a possible later upgrade, not a current gap — see ADR 0002.
Presence ("who else has the app open") and every non-laundry space
remain deliberately out of scope.
