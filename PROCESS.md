# Process overview

This file records the decisions and events that shaped Toad Live — one
entry per decision or incident, saying what the alternative was or what
broke and how it got fixed. Rewritten each time the project's shape
genuinely changed, to stay inside its own length target; detail trimmed
from here still lives in the commits and ADRs it cites.

## Concept and stack

Toad Live began from a real complaint: no shared view of which laundry
machine is free, and a report is only trustworthy while it stays fresh.
The audience, the five real locations (A/B, C, E, F, G — D has none),
the four machine states, out-of-order's stickiness, and the
washer-display-vs-dryer-estimate distinction for remaining time were
interrogated in conversation and landed in
[`4028255`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/4028255).
Astro was chosen the same session: cheap mostly-static pages, enough
dynamic surface for status, and a fit for the fixed 256MB/one-machine
Fly shape. Storage is SQLite via `node:sqlite` on `/data`, the one thing
Fly persists.

## Crit 8: persistence, then a bug that mattered

[`6ffddd8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/6ffddd8)
made the app an app: server-mode Astro, `machines` seeded with all ten
real machines, `GET`/`PATCH /api/machines/:id`, and a persistence test.
A real Fly redeploy surfaced a real incident: a malformed timestamp got
written unvalidated into `started_at`, and `node:sqlite` throws rather
than truncate reading an `INTEGER` past `Number.MAX_SAFE_INTEGER` — that
row 500'd on every subsequent request.
[`3c0b63f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/3c0b63f)
fixed it durably: `PATCH` rejects any unsafe `startedAt`/`expectedEndAt`
before it reaches SQLite, with a regression test and a `CLAUDE.md` rule.
[`f9ed19c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/f9ed19c)
then closed a reported leak — an in-use machine that never stopped being
in-use — with lazy, read-triggered decay.

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
added SSE. Verified live with two browsers: a report in one reached the
other within about a second, no reload; a forced stale version produced
the conflict message, and a re-confirmed report succeeded.

## Correction: SSE connections sat unestablished until something else broadcast

Preflight for Crit 10 found `pnpm check` red on the live deploy's decay
test. Live instrumentation found two real problems, not a flaky
assertion: `/api/stream`'s `ReadableStream` never flushed headers until
its first real `enqueue()`, so a quiet `EventSource` could sit
unresponded for seconds, woken only by an unrelated broadcast; and the
decay test opened its stream *after* an `in-use` report with only a
150ms window, so real latency let decay fire before any listener
existed.
[`885da13`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/885da13)
fixed both: an immediate `: connected` SSE comment on connect (ignored
by `EventSource`, forces the flush), and tests restructured so the
stream is confirmed open before any mutation — decay reordered to
connect, report, then trigger. Verified locally and live: 31 of 31,
with both a report and a decay transition arriving on an already-open
stream.

## Crit 10: identity, permissions, and logging — shipped and verified live

Crit 10 requires the app to be multi-user with the distinction checked
on the server, plus durable server-side logging. Interrogating the app
found a real gap: `reporterId` arrived in the `PATCH` body,
client-generated in `localStorage`, unchecked against the request
presenting it. The full decision is
[`notes/adr/0002-identity-and-permissions.md`](notes/adr/0002-identity-and-permissions.md):
a server-issued pseudonymous session, over client-generated pseudonyms
(no trust boundary) and full verified accounts (not asked for, blocked
by `CLAUDE.md` without its own decision record). Credential, actor id,
and pseudonym stay three distinct values so the API, SSE stream, and
logs never expose anything that could reconstruct the credential.
Permissions stay a stress-tested "no" to inventing ownership: every
visitor reads everything, any valid session may report any machine, a
request without one is rejected before mutation, and a client-asserted
`reporterId` is rejected outright.

[`a87c7c3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/a87c7c3)
shipped the `sessions` table and cookie flow;
[`347e5c1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/347e5c1)
added logging — `session_created` and every `PATCH` outcome
(`result=ok`/`conflict`/`rejected`), pseudonym-only. Deploying to Fly
surfaced a second real incident, the same shape as Crit 8's timestamp
bug: Fly's proxy terminates TLS and forwards plain HTTP, so
`Astro.url.protocol` read `"http:"` on the live HTTPS site, silently
dropping the cookie's `Secure` attribute in production — found only by
checking the live `Set-Cookie` header.
[`d7d0cd7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d7d0cd7)
fixed it by trusting Fly's `X-Forwarded-Proto` header too.

Verified live: two Chrome profiles from the deployed URL alone,
narrating from `flyctl logs`. Two distinct pseudonyms appeared, each
profile's report naming its own actor, a forced stale version producing
a conflict, and a re-confirmed report succeeding. The live `Set-Cookie`
header carried `Secure`.

## Giving the Hall a visible body

A status board of text rows doesn't feel like a place — residents
should see the rooms, not just read their states.
[`591363a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/591363a)
added a Three.js diorama whose material, spin, and hazard tape are
driven by the same `MachineStatus` the dashboard renders.
[`f17deba`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/f17deba)
matters most: the 3D view subscribes to the exact function the
dashboard's SSE handler already calls, not a second `EventSource` or
copy of state. Two real bugs surfaced on their own evidence: a
hand-tuned focus camera clipped the machine from some angles until
[`d500e97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d500e97)
replaced it with framing from the mesh's real bounds; and
[`626029d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/626029d),
extending to all five rooms, found a focused room could be occluded by
a neighbour — fixed by hiding every other room. Interaction and palette
polish followed, both cosmetic.

## Laundry as the first facility, not the whole product

Toad Live's working title was always the laundry app, but the standing
argument — a status board sized to one bounded community — was never
laundry-specific. [`ac6e952`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/ac6e952)
reshaped the page into a facility workbench: tabs for every shared space
the Hall has, with Laundry the one real tab and the other six visibly
disabled, no placeholder or invented data. The point wasn't new scope —
it was making room for scope the product's own framing already
implied, so a later facility is a tab's worth of server-backed state,
not a redesign. The dashboard markup, summary counts, and
`applyMachineUpdate()` are reused unchanged; the only new wiring is a
block filter and a callback so clicking a machine in 3D selects its
block and highlights its card.

## Otter Room: modeled from real house rules first, not guessed

Unlike AA Room's v1, which guessed a model and corrected it later, Otter
Room's actual house rules — the paper sign-up sheet, the unwritten
four-hour norm, "don't distinguish activity," "don't record headcount" —
were interrogated before any schema or code, landing as
[`notes/adr/0004-otter-room-live-state.md`](notes/adr/0004-otter-room-live-state.md).
Three commits followed in sequence (`fa57902` backend, `4a42172` panel,
`8e903b3` 3D scene), each checked — `pnpm check`, then a real browser —
before the next began.

The ADR keeps two similar-looking decay numbers deliberately distinct:
occupied's ceiling (`min(expectedEndAt, confirmedAt + 4h)`) transcribes a
real Toad Hall norm, while empty's 15-minute decay is this app's own
freshness judgement, not a pre-existing house rule — the code comments on
each constant say so differently, not identically, since only one of them
is a fact a future agent could actually go verify against real usage data.
`expectedEndAt` is enforced as per-observation, never inherited — an
`occupied` report that omits an estimate stores `NULL` even over a row
holding a sharper one from an earlier report, covered by a dedicated test.
Activity taxonomy, headcount, and a booking calendar were all declined by
name, not merely left unbuilt — a study room with a literal sign-up sheet
is exactly where "why not digitize it" creeps in unnoticed.

The 3D stage repeated AA Room's own lesson that `pnpm check` cannot
replace a real screenshot, twice: occupied-only activity props (a book, a
laptop, whiteboard marker strokes) were first built as permanent fixtures
and stayed visible after a report back to `empty` until a real browser
check caught it — fixed by toggling them from the same `applyState()`
call that already toggles the figures. Separately, the window was first
mounted on the room's camera-near wall, the one this "cutaway dollhouse"
technique relies on backface culling to hide — it rendered as a frame
floating with no wall behind it, a bug two wrong-theory material fixes
missed before a screenshot of the *whole room* (not a tight crop) showed
the real cause and it was moved to the camera-facing wall instead.

`d824aec` shipped this to Fly (CI green, production version 34); a
post-deploy smoke check against the live URL confirmed all three
facilities, Otter Room's report flow, and cross-session SSE sync all work
in production, not just locally — see the ADR's own Verification section
for the full detail.

## Rabbit Room: same conclusion, independently earned

Rabbit Room's live state ended up structurally identical to Otter Room's —
`occupancy` plus optional `expectedEndAt`, the same 4-hour/15-minute decay
shape — but
[`notes/adr/0005-rabbit-room-live-state.md`](notes/adr/0005-rabbit-room-live-state.md)
re-derived each piece from Rabbit Room's own facts rather than copying
ADR 0004. That mattered in practice, not just as a formality: Otter Room
genuinely is used in different ways too — someone studying alone, a small
group discussing together — but neither distinction has decision-relevant
value to a resident checking the app, so there was never a reason to name
them separately. Rabbit Room's two uses, group study and a shared meal,
are a sharper case — clearly distinct and separately nameable — but the
same decision-relevant-value test still comes out the same way: knowing
*which* of the two is happening tells a resident nothing they'd act on
differently, and the two don't typically co-occur, so there's no "several
things happening at once" question for a field to answer either. Both
rooms land on "no `activities` field," but for their own reasons, not by
one resembling the other. Activity taxonomy, headcount, a booking
calendar, and kitchen-appliance status were all declined by name for
Rabbit Room — a room with a real stove and sink in it is exactly where "is
the stove free" could otherwise creep in unnoticed as a plausible-sounding
addition nobody asked for.

The two decay numbers landing on the same values as Otter Room's is a
coincidence of evidence, not a rule being reused: the 4-hour ceiling is a
real community norm confirmed about Rabbit Room specifically, independent
of Otter Room's own 4-hour fact; the 15-minute `empty` decay is a fresh
product freshness judgement made for this room's own volatility (larger
capacity, no fixed schedule), not a universal rule for "rooms like this."

Implementation deliberately did not extract a generic occupancy-room store
shared between Otter Room and Rabbit Room, even though the two are
byte-for-byte the same shape. The abstraction's cost — indirection in two
already-stable, independently-verified modules, for a project with no
third facility of this exact shape yet — outweighed the benefit of
avoiding one small duplicated file. Backend tests did catch the same SSE
test-helper gap Otter Room's arrival once caused for AA Room:
`spec/aa-room.test.ts`'s stream helper assumed any event that wasn't
`machine` or `otter-room` must be `aa-room`, which broke once a fourth
event name (`rabbit-room`) could appear on the same shared stream during
parallel test runs — fixed by widening the helper to recognize both
sibling event names, not by special-casing Rabbit Room into it.

The 3D stage changed its own order on purpose, learning from Otter Room's
two bugs (an occupied-only prop left stuck after reporting back to empty;
a window mounted on a backface-culled wall). Rabbit Room's static Empty
shell was built, screenshotted, and reviewed for room structure alone
*before* any occupancy-driven layer existed, and wall-facing was reasoned
through up front — back and left walls are camera-visible under the fixed
isometric view, right wall is culled — so both windows and the whiteboard
went straight onto visible walls with no trial-and-error. The occupied
state adds a small fixed set of figures around the shared table, but
deliberately in a neutral pose (level head, forearms resting on the
table) that reads as either "studying" or "eating" — unlike Otter Room's
"desk" pose, which is intentionally built to look like reading. The scene
never infers or decides which of the two real activities is happening; it
expresses `occupied` and nothing more, the same boundary Decision 1 of
ADR 0005 draws in the data model.

`91167bd` shipped to Fly on the first try CI had seen all week (check and
deploy both green, zero reruns) — production version 36. A post-deploy
smoke check against the live URL confirmed all four facilities, both of
Rabbit Room's report shapes (an `expectedEndAt` estimate shown correctly;
no estimate showing "remaining time unknown," not a guess), and
cross-session SSE sync driving the panel and the 3D figures together with
zero residue — see the ADR's own Verification section for the full
detail.

### A known flake becomes a deterministic blocker: SQLite test isolation

Adding Rabbit Room's backend meant a third `*-decay.test.ts` file, and
that pushed an old, merely-annoying flake into an actual release blocker:
the push carrying ADR 0005's status update failed CI seven times in a
row, every time with the identical `database is locked`
(`ERR_SQLITE_ERROR errcode 5`), landing on a different one of the three
decay spec files each time. Seven consecutive identical failures on a
docs-only commit ruled out a one-off fluke before any code was touched.

The cause was never a Rabbit Room product bug: `aa-room.ts`/
`otter-room.ts`/`rabbit-room.ts` each imported `db.ts` and self-seeded at
module load, so a decay spec's static `import` — written only to reach
the pure decay logic and a throwaway in-memory store — transitively
opened a second real connection to the same on-disk file the CI
container's own running app already held, racing it for the same lock.
Two such files made this an occasional flake; three made it close to
certain.

The fix deliberately wasn't a retry, a busy-timeout, or forcing Vitest
serial — any of those would have masked the race rather than removed it.
`91167bd` split each room module in two: the facility module now takes a
required `store`/`now` with no default and never imports `db.ts`, and a
new sibling `*-db.ts` module is the only place that wires it to the
app's real connection and performs the self-seed. A decay spec's import
of the facility module now touches no real database at all. Verified
before shipping: `pnpm check` fifteen times straight at 148/148; the
three decay specs run together, in parallel, fifteen more times with zero
lock errors; and the next real CI run (`40219117879`) went green on the
first try — the first first-try pass this project had seen on a commit
touching more than one decay spec file, which is itself the evidence the
race, not luck, had been the problem.

## What's still ahead

The broader freshness policy — `available`/`unknown` lifetimes, the
provisional 12-hour window — stays open pending real cycle-time data,
tracked in `notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10. Verified
resident identity is a possible later upgrade, not a current gap.
Presence remains out of scope. Badger, Rat, and Weasel Rooms remain
unimplemented and open for later Final Project scope decisions — not
permanently out of scope, just not yet interrogated.
