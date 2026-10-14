# Process overview

This file records the decisions and events that shaped Toad Live — one
entry per decision or incident, not a task list, saying what the
alternative was or what broke and how it got fixed. Rewritten again at
the end of Crit 10, once identity, permissions, and logging actually
shipped and were verified live, to stay inside the project's own length
target; detail trimmed from here still lives in the commits and the ADRs
they cite.

## Concept and stack

Toad Live began from a real complaint: no shared view of which Toad Hall
laundry machine is free, and a human report is only trustworthy while it
stays fresh. The audience, the five real locations (A/B, C, E, F, G — D
has none), the four machine states, out-of-order's stickiness, and the
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
in-use — with lazy, read-triggered decay. `available` and `out-of-order`
stay untouched.

## Crit 9: real-time and concurrency

The brief's demand: a change reaches every other open session within
about a second, no reload, plus one decided and justified call about
simultaneous use. The full record is
[`notes/adr/0001-realtime-and-concurrent-updates.md`](notes/adr/0001-realtime-and-concurrent-updates.md):
**SSE** over WebSocket and polling; **optimistic concurrency** over
last-write-wins, which can silently discard a newer state, and over
preserving every conflicting report, which costs "useful at a glance"
for a problem nobody had hit yet.
[`9c99f73`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/9c99f73)
gave `machines` a server-owned `version`, with an explicit `ALTER TABLE`
migration verified against a hand-built pre-version database;
[`85f31d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/85f31d0)
added the SSE transport. Verified both locally and against the live Fly
deployment, two independent browsers open together: a report in one
reached the other within about a second, no reload; a forced stale
version produced the conflict message and a re-confirmed report then
succeeded normally.

## Crit 10: identity, permissions, and logging — shipped and verified live

Crit 10 requires the app to be multi-user with the distinction checked
on the server, and durable server-side logging. Interrogating the
app found a real gap: `reporterId` arrived in the `PATCH` body,
client-generated in `localStorage`, and the server wrote whatever string
it was handed straight to `reporter_id` with no check that it belonged
to the request presenting it — two Chrome profiles differed only by
`localStorage` accident, not by anything the server verified. The full
decision is
[`notes/adr/0002-identity-and-permissions.md`](notes/adr/0002-identity-and-permissions.md):
a server-issued pseudonymous session, compared against client-generated
pseudonyms (no server-side trust boundary) and full verified accounts
(not asked for by the brief, blocked by `CLAUDE.md` without its own
decision record). Credential, internal actor id, and resident-facing
pseudonym are kept as three distinct values so the public API, SSE
stream, and logs never expose anything that would let a reader
reconstruct the credential. Permissions stay a stress-tested "no" to
inventing ownership: every visitor reads everything, any valid session
may report any machine, and a request without one is rejected before
mutation — `machines` has no owner column, and the project's own concept
is shared state, not per-resident property. A client-asserted
`reporterId` is rejected outright (`400 reporterId is server-controlled`),
not silently dropped, giving anti-impersonation a direct contract.

[`a87c7c3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/a87c7c3)
shipped the `sessions` table and the cookie/resolve/create flow;
[`347e5c1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/347e5c1)
added the logging layer — `session_created`, and every `PATCH` outcome
(`result=ok`/`conflict`/`rejected`), pseudonym-only, stdout, no new
table. Deploying to the live Fly app surfaced a second real incident,
the same shape as Crit 8's timestamp bug: Fly's proxy terminates TLS in
front of the app and forwards the request over plain HTTP, so the app's
own `Astro.url.protocol` read `"http:"` even on the live HTTPS site, and
the session cookie's `Secure` attribute was silently never set in
production — found only by checking the actual live `Set-Cookie` header,
not by local testing, where `localhost` has no proxy to hide this
behind. The fix,
[`d7d0cd7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d7d0cd7):
treat a request as HTTPS if either the app's own URL or Fly's trusted
`X-Forwarded-Proto` header says so, extracted into a small
dependency-free helper with regression tests for both signals.

Verified live, not just locally: two separate Chrome profiles from the
deployed URL alone, one tutor narrating from `mise exec -- flyctl logs`
without touching the app. Two distinct pseudonyms appeared, one
`session_created` line each; each profile's report appeared as
`result=ok` naming its own actor and machine; a deliberately forced
stale version produced `result=conflict` naming the current version,
and the same actor's re-confirmed report then succeeded as `result=ok`
with the version advanced again; ordinary `GET`/SSE traffic produced no
`[toadlive]` lines at all. The live `Set-Cookie` header was re-checked
after the proxy fix and confirmed carrying `Secure`.

## What's still ahead

The broader freshness policy — `available`/`unknown` lifetimes, the
provisional 12-hour window — stays open pending real cycle-time data,
tracked in `notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10. Verified
resident identity remains a possible later upgrade, not a current gap.
Presence ("who else has the app open") and every non-laundry space
remain deliberately out of scope.
