# Process overview

This file records the decisions and events that shaped Toad Live — one
entry per decision or incident, not a task list, saying what the
alternative was or what broke and how it got fixed. Rewritten each time
the project's shape genuinely changed, to stay inside its own length
target; detail trimmed from here still lives in the commits and ADRs it
cites.

## Concept and stack

Toad Live began from a real complaint: no shared view of which laundry
machine is free, and a report is only trustworthy while it stays fresh.
The audience, the five real locations (A/B, C, E, F, G — D has none),
the four machine states, out-of-order's stickiness, and the
washer-display-vs-dryer-estimate distinction for remaining time were
interrogated in conversation and landed in
[`4028255`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/4028255).
Astro was chosen the same session — cheap mostly-static pages, enough
dynamic surface for status, and a fit for the fixed 256MB/one-machine Fly
shape. Storage is SQLite via `node:sqlite` on the one thing Fly actually
persists, `/data`.

## Crit 8: persistence, then a bug that mattered

[`6ffddd8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/6ffddd8)
made the app an app: server-mode Astro, `machines` seeded with all ten
real machines, `GET`/`PATCH /api/machines/:id`, and a persistence test —
a status update checked by an independent later request. A real Fly
redeploy surfaced a real incident: a malformed timestamp got written
unvalidated into `started_at`, and `node:sqlite` throws rather than
truncate when it later reads an `INTEGER` past
`Number.MAX_SAFE_INTEGER` — that row 500'd on every subsequent request.
[`3c0b63f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/3c0b63f)
fixed it durably: `PATCH` rejects any unsafe `startedAt`/`expectedEndAt`
before it reaches SQLite, with a regression test and a `CLAUDE.md` rule.
[`f9ed19c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/f9ed19c)
then closed a reported leak — an in-use machine that never stopped being
in-use — with lazy, read-triggered decay; `available` and `out-of-order`
stay untouched.

## Crit 9: real-time and concurrency

The brief's demand: a change reaches every other open session within
about a second, no reload, plus one decided call about simultaneous use.
The full record is
[`notes/adr/0001-realtime-and-concurrent-updates.md`](notes/adr/0001-realtime-and-concurrent-updates.md):
**SSE** over WebSocket and polling; **optimistic concurrency** over
last-write-wins, which can silently discard a newer state, and over
preserving every conflicting report, which costs "useful at a glance"
for a problem nobody had hit yet.
[`9c99f73`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/9c99f73)
gave `machines` a server-owned `version`; [`85f31d0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/85f31d0)
added the SSE transport. Verified against the live deployment with two
independent browsers: a report in one reached the other within about a
second, no reload; a forced stale version produced the conflict
message, and a re-confirmed report then succeeded.

## Crit 10: identity, permissions, and logging — shipped and verified live

Crit 10 requires the app to be multi-user with the distinction checked
on the server, and durable server-side logging. Interrogating the app
found a real gap: `reporterId` arrived in the `PATCH` body,
client-generated in `localStorage`, with no check that it belonged to
the request presenting it. The full decision is
[`notes/adr/0002-identity-and-permissions.md`](notes/adr/0002-identity-and-permissions.md):
a server-issued pseudonymous session, over client-generated pseudonyms
(no server-side trust boundary) and full verified accounts (not asked
for, blocked by `CLAUDE.md` without its own decision record). Credential,
internal actor id, and pseudonym are kept as three distinct values so
the API, SSE stream, and logs never expose anything that would let a
reader reconstruct the credential. Permissions stay a stress-tested "no"
to inventing ownership: every visitor reads everything, any valid
session may report any machine, and a request without one is rejected
before mutation. A client-asserted `reporterId` is rejected outright
(`400 reporterId is server-controlled`), not silently dropped.

[`a87c7c3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/a87c7c3)
shipped the `sessions` table and cookie flow;
[`347e5c1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/347e5c1)
added logging — `session_created` and every `PATCH` outcome
(`result=ok`/`conflict`/`rejected`), pseudonym-only. Deploying to Fly
surfaced a second real incident, the same shape as Crit 8's timestamp
bug: Fly's proxy terminates TLS and forwards the request over plain
HTTP, so `Astro.url.protocol` read `"http:"` even on the live HTTPS
site, and the cookie's `Secure` attribute was silently never set in
production — found only by checking the live `Set-Cookie` header.
[`d7d0cd7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d7d0cd7)
fixed it: treat a request as HTTPS if either the URL or Fly's trusted
`X-Forwarded-Proto` header says so.

Verified live: two Chrome profiles from the deployed URL alone,
narrating from `mise exec -- flyctl logs`. Two distinct pseudonyms
appeared, each profile's report as `result=ok` naming its own actor, a
forced stale version as `result=conflict`, and a re-confirmed report
then succeeded. The live `Set-Cookie` header was re-checked and
confirmed carrying `Secure`.

## Giving the Hall a visible body

A status board that only shows text rows doesn't feel like a place —
"the Hall feels alive" meant a resident should see the rooms, not just
read their states. [`591363a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/591363a)
added a Three.js diorama — fixed isometric camera, washer/dryer meshes
whose material, spin, and hazard tape are driven by the same
`MachineStatus` the dashboard renders — a visual layer on the existing
model, never a second one. [`f17deba`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/f17deba)
matters most: the 3D view subscribes to the exact function the
dashboard's SSE handler already calls on every push, conflict, and
reconnect, rather than a second `EventSource` or copy of machine state.
Two real bugs surfaced and got fixed on their own evidence: a
hand-tuned focus camera clipped the machine from some angles until
[`d500e97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d500e97)
replaced it with framing computed from the mesh's real bounds; and
[`626029d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/626029d),
extending the diorama to all five rooms, found a focused room could be
occluded by a neighbour — fixed by hiding every room but the focused
one, confirmed by screenshot. [`6ed5143`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/6ed5143)
and
[`e1d2d8b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/e1d2d8b)
followed with interaction polish and a status palette pass, both
cosmetic.

## Laundry as the first facility, not the whole product

Toad Live's working title was always the laundry app, but the standing
argument — a status board sized to one bounded community — was never
laundry-specific. [`ac6e952`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/ac6e952)
reshaped the page into a facility workbench: tabs for every shared space
the Hall has, with Laundry the one real tab and the other six left
visibly disabled, no placeholder page or invented data behind them. The
point wasn't new scope this week — it was making room for scope the
product's own framing already implied, so a later facility is a tab's
worth of server-backed state, not a redesign. The dashboard markup,
summary counts, and `applyMachineUpdate()` as the one UI writer are
reused unchanged; the only new wiring is a block filter and a callback
so clicking a machine in 3D selects its block and highlights its card.

## What's still ahead

The broader freshness policy — `available`/`unknown` lifetimes, the
provisional 12-hour window — stays open pending real cycle-time data,
tracked in `notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10. Verified
resident identity remains a possible later upgrade, not a current gap.
Presence and every non-laundry facility's actual implementation stay
out of scope for now.
