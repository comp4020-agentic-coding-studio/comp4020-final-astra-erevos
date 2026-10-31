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

Weasel Room's own push (`40561533681`) went green on the first try too —
a third straight first-try pass since the fix, now with the suite grown
to 180 tests and a fourth decay spec file in the parallel mix.
`database is locked` still hasn't reappeared.

Badger Room's own push (`41079082720`) was first-try green again — a
fourth straight first-try pass since the fix, with the suite now grown to
212 tests across six live facilities and a fifth decay spec file in the
parallel mix. `database is locked` still hasn't recurred.

## Weasel Room: the same model again, and two recurring lessons applied on sight

Weasel Room's own ADR
([`notes/adr/0006-weasel-room-live-state.md`](notes/adr/0006-weasel-room-live-state.md))
landed on the same `occupancy` + optional `expectedEndAt`, 15-minute/
4-hour shape Otter Room and Rabbit Room each already use — but, same
discipline as both of those, re-derived independently from Weasel Room's
own facts, not assumed because it's now the third room to look this way.
Guitar and keyboard are two real, separately nameable uses — more
clearly distinct than Otter Room's "alone or in a small group," on par
with Rabbit Room's "study or shared meal" — but the room's own brief
states plainly that a resident checking the app only cares whether
someone's using the room and when they expect to finish, never which
instrument. No headcount, no booking calendar, no instrument-status field
were built, the same scope boundary every prior room drew for its own
version of this temptation (Otter Room's heater, Rabbit Room's kitchen
appliances, here the guitar and keyboard themselves). The 4-hour ceiling
is a real community norm confirmed for Weasel Room specifically, not
inherited from the other two rooms happening to share the number; the
15-minute `empty` decay is this room's own freshness judgement, arrived
at the same way Rabbit Room's was, not a transferred rule.

Two things this milestone didn't have to re-learn, because they were
already fixed infrastructure by the time it started:

- **The backend never risked reintroducing the SQLite-lock race.**
  `weasel-room.ts`/`weasel-room-db.ts` followed `91167bd`'s
  pure-logic/production-wiring split from the first line written, not as
  an afterthought — so becoming the *fourth* `*-decay.test.ts` file never
  came close to repeating the sqlite-lock incident Rabbit Room's own
  arrival caused. Verified directly: all four decay spec files run
  together, in parallel, repeatedly, zero lock errors.
- **The AA Room SSE helper broke the same way twice, and the second fix
  was the right one.** `spec/aa-room.test.ts`'s stream helper had already
  been patched once, for Rabbit Room, by adding `rabbit-room` to a list of
  named sibling events it specifically recognized and skipped — which
  broke again the moment Weasel Room introduced a fifth name, for the
  exact same reason. The helper is now generic (skip any block whose
  event name isn't `aa-room`, full stop), the same shape every sibling
  facility's own stream helper already used — no future facility's
  arrival should require touching this file again.

The 3D stage kept the order Rabbit Room's own work established — a static
Empty shell, reviewed for room structure before any occupancy layer
exists — and it caught something on the first try because of that order:
the whiteboard's face and frame, built from the same offset numbers
Otter Room's and Rabbit Room's already-shipped whiteboards use, z-fought
into a flickering diagonal tear. Checking showed both of those
already-shipped rooms carry the same latent z-fighting, just never
caught because nobody had screenshotted a whiteboard that close — this
milestone fixed only Weasel Room's own copy, left Otter Room's and Rabbit
Room's untouched, and is naming the cross-room fix here as a deliberate
deferral to a later final-polish pass, not an oversight. A second,
smaller bug — the keyboard's bench sitting close enough to read as
swallowed by the keyboard's own silhouette — was caught the same way and
fixed by widening the gap after a temporary red-highlight screenshot
located it precisely.

The occupied-state figures stay as deliberately neutral as Rabbit Room's
own — arms resting down, nothing raised to playing height, no
instrument-shaped prop — so the scene only ever says "occupied," never
"playing guitar" or "playing keyboard," the same boundary ADR 0006's
Decision 1 draws in the data model itself.

Shipped to Fly on production version 38, CI green on the first try. A
post-deploy smoke check against the live URL confirmed all five
facilities' panel and 3D, both of Weasel Room's report shapes, two-session
SSE sync driving the panel and 3D figures together, and a clean
`flyctl logs` trace — no production-only product bug surfaced. See the
ADR's own Verification section for the full detail.

## Badger Room: the same shape again, but the 15-minute figure needed a real argument this time

Badger Room's own ADR
([`notes/adr/0007-badger-room-live-state.md`](notes/adr/0007-badger-room-live-state.md))
lands on the same `occupancy` + optional `expectedEndAt` shape Otter
Room, Rabbit Room, and Weasel Room each already use — again re-derived
independently from Badger Room's own stated facts, not assumed because
it's now the fourth room to look this way. Formal meetings, interviews,
special study, and organised activities like Toad's Table are genuinely
more numerous and more formally distinct uses than any prior room's own
brief named, which made this room the sharpest test yet of whether "does
knowing *which* use is active tell a resident anything they'd act on
differently" still holds — it does not, and if anything the formal
character of these uses makes "which one" feel even less relevant to a
passerby than a casual room would.

**The real argumentative difference from Otter/Rabbit/Weasel Room is a
fact none of those three rooms' own briefs stated: Badger Room is
explicitly *not* frequently booked.** That single fact forced the
15-minute `empty` decay figure to be re-derived from scratch rather than
carried forward by resemblance, because each prior room's own 15-minute
figure came from that room's own observation-volatility reasoning, not
from one shared universal argument that would automatically transfer.
The resolution: low booking frequency is evidence about the room's
*prior probability* of being occupied at any given moment — a passerby
is less likely, on average, to find it in use — but that's a different
question from how long one *already-confirmed* "empty" observation
should stay authoritative. Badger Room uses the same paper sign-up/
walk-in mechanism as every other room with a sign-up sheet, so its actual
state can change with no new Toad Live report regardless of how often the
room gets booked in aggregate; an "empty" report still only ever means
"someone just confirmed nobody is here right now," and infrequent booking
doesn't make that moment-in-time claim durable for longer on its own.
That independent re-derivation lands on the same 15-minute number every
prior room uses — not because the number was assumed to transfer, but
because the underlying freshness judgement, worked through on this
room's own terms, happens to agree. The 4-hour `occupied` ceiling is,
same as every prior room, its own independently confirmed real-world
community norm for Badger Room specifically, not inferred from the other
three rooms sharing the figure. No activity taxonomy, no headcount
field, no booking calendar, and no piano/TV status were built — the
conference table's seating, the piano, and the large TV are named
furniture this room has, never something Toad Live reports the condition
of, the same scope boundary Otter Room's heater, Rabbit Room's kitchen
appliances, and Weasel Room's guitar/keyboard each already drew.

Two things this milestone didn't have to re-learn, because they were
already fixed infrastructure by the time it started:

- **The backend never risked reintroducing the SQLite-lock race.**
  `badger-room.ts`/`badger-room-db.ts` followed `91167bd`'s pure-logic/
  production-wiring split from the first line written — so becoming the
  *fifth* `*-decay.test.ts` file never came close to repeating the
  sqlite-lock incident Rabbit Room's own arrival originally caused.
  Verified directly: all five decay spec files (`aa-room-decay`,
  `otter-room-decay`, `rabbit-room-decay`, `weasel-room-decay`,
  `badger-room-decay`) run together, in parallel, repeatedly, zero lock
  errors.
- **Adding a sixth SSE event required touching zero sibling test
  files.** A dedicated investigation before any code was written
  confirmed every existing facility's own SSE stream helper already used
  the generic "skip any block whose event name isn't `event: <own>`"
  pattern Weasel Room's own milestone fixed `spec/aa-room.test.ts` to use
  — so unlike Rabbit Room's and Weasel Room's own arrivals (each of which
  needed a fix to that one helper), Badger Room's sixth named event,
  `event: badger-room`, needed no change anywhere outside its own new
  files. The two successive fixes to that one recurring assumption are
  what made this one a non-event.

The 3D stage kept the order Weasel Room's own work established — a
static Empty shell, reviewed for room structure before any occupancy
layer exists — and, same as before, a real screenshot caught something a
plan alone wouldn't have: the piano's taller cabinet occluded its own
shorter keybed from this app's fixed isometric camera, reading as one
undifferentiated dark box rather than a recognizable instrument, fixed by
swapping which element sits nearer the camera. A second correction came
from the user's own real-person review of the Stage 1 screenshots after
the first fix: the piano's keys initially faced the camera/open front,
not the room's own west wall as the brief actually describes, and were
rotated -90 degrees in place to face west with the cabinet backing onto
the east side — a reminder that a geometrically-valid, non-buggy build
can still be wrong relative to the room's real layout, and that
screenshot review catches that class of error differently than a
rendering-bug check does. The large TV was built as a real, freestanding
solid with genuine thickness (a stand, a body, a screen box) rather than
a thin wall-mounted panel, specifically because the south side of every
room in this app is the open front with no wall at all — a flat panel
placed there would have floated with nothing behind it the moment the
cutaway hid that side, the same class of mistake Otter Room's own window
bug once was, caught here before it ever reached a screenshot by
reasoning from the existing wall-visibility rule rather than after the
fact.

The occupied-state figures stay as deliberately neutral as Rabbit Room's
and Weasel Room's own — level head, hands resting, nothing raised to
playing height or directed at the TV — so the scene only ever says
"occupied," never "in a meeting," "being interviewed," "at Toad's Table,"
or "playing piano/watching TV," the same boundary ADR 0007's Decision 1
draws in the data model itself. Three of the four figures reuse real
conference-table chair slots rather than inventing furniture-free
standing room, so a seated figure always reads as sitting at the table,
not floating in open floor space.

Not yet shipped to Fly — this milestone stops at local verification (see
the ADR's own Verification section for the full automated/manual detail)
with production smoke testing deliberately deferred to its own close-out
step, the same staged-commit discipline every prior facility's milestone
followed.

Shipped to Fly on production version 40, CI green on the first try (run
`41079082720`). A post-deploy smoke check against the live URL confirmed
all six facilities' panel and 3D, two-session SSE sync driving Badger
Room's panel and 3D figures together, and a clean `flyctl logs` trace;
the Otter Room/Rabbit Room whiteboard z-fighting fix was separately
confirmed live. No production-only product bug surfaced. See the ADR's
own Verification section for the full detail.

## Rat Room: the resource granularity question comes back, and figures need a place to sit

Rat Room's own ADR
([`notes/adr/0008-rat-room-live-state.md`](notes/adr/0008-rat-room-live-state.md))
is the first facility since Laundry to change *what kind of resource*
this app's state model attaches to, and the milestone's real lessons are
mostly about that change, not another re-derived decay number.

**1. Resource granularity changed again, for a reason distinct from
Laundry's own.** Otter, Rabbit, Weasel, and Badger Room are each one
shared space with one occupancy fact. Rat Room's own question isn't "is
anyone in here" — with ten seats, that's almost always true during
normal hours and tells a resident nothing useful. It's "how many of the
ten seats are free for me, specifically." A single room-level `occupied`
flag cannot distinguish one occupied seat from ten, so it cannot answer
that question at all — a real information loss, not a style preference.
The fix is ten independent seat resources, each its own
`occupancy`/`expectedEndAt`/`confirmedAt`/`version` — structurally
Laundry's sibling in multiplicity, but not in shape: no `out-of-order`,
no `startedAt`, since a seat's occupancy, not an appliance's physical
condition, is the fact that matters here.

**2. Approximate reality, exact product model, and the two were never
conflated.** The real-world fact given for this room is *approximately*
ten computers/seats — not the same recounted certainty `CLAUDE.md` states
for Laundry's five locations. Toad Live's own product decision is still
exactly ten fixed, reportable slots, A through J. The ADR says this
plainly rather than dressing up a product choice as a more precise
physical fact than was ever actually confirmed.

**3. One source of truth, derived, never doubled.** The room's own 3D
visual and the panel's headline both come from the same
`summarizeRatRoomSeats()`: any seat occupied → `occupied`; all ten
`empty` → `empty`; otherwise → `unknown`. Nothing about this is stored a
second time at the room level — a second stored flag could drift from
what the ten seats actually say, the exact two-sources-of-truth problem
every derived value in this app exists to avoid.

**4. Summary honesty, sharpened by having real counts to work with.**
Only confirmed-`empty` seats count as free; `unknown` seats are named
alongside the free count ("6 seats confirmed free · 2 unknown"), never
silently folded into either bucket. Seat occupancy also still isn't a
headcount — one occupied seat says nothing about how many people are
using it.

**5. Infrastructure maturity showed up as the absence of a repeat
incident, not a new fix.** `rat-room.ts`/`rat-room-db.ts` followed
`91167bd`'s pure-logic/`-db.ts` split from the first line, so becoming
the *sixth* `*-decay.test.ts` file never came close to reintroducing the
SQLite-lock race Rabbit Room's own arrival once caused — verified
directly, all six decay specs run in parallel repeatedly with zero lock
errors, and CI's own run against the final scale (seven facilities, 261
tests, six decay specs) went first-try green with the race still absent.
The seventh SSE event needed a genuine, new piece of code,
though, not just another name: every prior event payload carried either
a `machine` or a `room`, so `src/pages/api/stream.ts`'s dispatch logic
went from a two-way to a real three-way distinction
(`machine`/`rat-room`-`seat`/`room`) — a real shape difference in the
discriminated union, not another facility-count patch to an existing
pattern.

**6. A visual polish request surfaced a real SSR/client-render
consistency bug, not just a CSS problem.** The summary headline wrapped
mid-phrase instead of between whole phrases. The server-rendered markup
already used a two-span structure so each span could carry its own
`white-space: nowrap` — but the client's original `summaryLabel()`
replaced the entire headline via `textContent` on the very first
SSE-driven update (which fires immediately, for all ten seats, on every
page load), destroying that structure before a resident ever saw it
survive. Rebuilding the two spans dynamically via `document.createElement`
still wasn't enough on its own: Astro's scoped CSS only applies to
elements present in the template at *build* time, so freshly-created
spans never receive the `data-astro-cid-*` attribute the original
build-time spans had — the same bug class this codebase had already
documented for `overlay.ts`'s `hall-hover-card`/`hall-focus-panel`. The
fix, `renderSummary()` rebuilding a stable two-span structure every call
plus a small dedicated `is:global` rule for those two span classes, is a
structural fix, not a styling tweak — worth remembering the next time a
"just fix the wrapping" request turns out to be a markup-lifecycle bug
in disguise.

**7. The 3D aggregate boundary held, but needed a real-person
correction.** The ten decorative workstations built in Stage 1 are a
decorative approximation of "approximately ten computers," never a
rendering of the product's A–J seat slots — no workstation is ever
labelled or indexed to a seat. Stage 2's occupied-state figures (a fixed
2 seated + 1 standing) never vary in count with how many seats are
actually occupied — confirmed by screenshotting "only seat A occupied,"
"only seat H occupied," and "five seats occupied" and finding them
visually identical. The boundary held throughout, but the first
implementation of where those figures physically sat was still wrong:
they were placed in the room's genuinely-open central floor area,
correct by the "never implies a specific seat" rule but read, on a real
screenshot, as people standing on open floor rather than using a
computer lab. The fix placed the same fixed, anonymous figures at (or
just beside) two specific, already-built workstations instead — still no
seat-to-workstation mapping, since no workstation is ever labelled, just
a visually grounded version of the same decorative aggregate. The
lesson repeats Otter Room's and Badger Room's own: a geometrically
correct, rule-following scene can still look wrong in a way only a real
screenshot catches, and the fix here was a placement correction, not a
rule change.

Shipped as three separate, independently-reviewed commits — backend,
practical panel, 3D scene — the same staged-commit discipline every
facility since Otter Room has used.

Shipped to Fly on production version 42, CI green on the first try
(run `41120102605`, 261/261 across all six decay spec files, zero
`database is locked`). A post-deploy smoke check against the live URL
confirmed all seven facilities' panel and 3D, both of Decision 4's
aggregate-precedence cases live (not just the all-empty/all-occupied
extremes), two-session per-seat SSE and concurrency, and a clean
`flyctl logs` trace with each seat's own `version` advancing
independently. The one real gap a page reload can't close — proving the
actual `EventSource` reconnect/`open` path recovers all ten seats, not
just that a fresh page load does — was closed by restarting the Fly
machine to force a genuine server-side disconnect and watching the
instrumented `EventSource` instance's own `readyState` transition
`OPEN → error → OPEN` with no page reload; a first attempt using
Playwright's offline emulation had looked like a pass but was a false
positive, since Chromium doesn't interrupt an already-open streaming
response with no periodic keep-alive to fail on. No production-only
product bug surfaced. See the ADR's own Verification section for the
full detail.

## What's still ahead

The broader freshness policy — `available`/`unknown` lifetimes, the
provisional 12-hour window — stays open pending real cycle-time data,
tracked in `notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10. Verified
resident identity is a possible later upgrade, not a current gap.
Presence remains out of scope. All seven facilities are now implemented
locally; Rat Room alone still awaits production shipping.
