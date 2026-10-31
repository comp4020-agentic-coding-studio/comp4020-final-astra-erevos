# Process overview

Toad Live is a resident-maintained live status board for seven of Toad
Hall's shared facilities — Laundry, AA Room, Otter Room, Rabbit Room,
Weasel Room, Badger Room, and Rat Room — kept current by whoever last
walked past, not sensors. This file argues the project's current shape
and how it was built, not a chronological log; the incident-by-incident
record lives in the commit history and the eight ADRs in `notes/adr/`,
which this file links to rather than restates.

## Stack and architecture

Astro was chosen for a concrete constraint: Fly's one shared-cpu-1x
machine, 256MB of memory, one persistent volume at `/data`, no separate
database server. Astro's server mode gives cheap, mostly-static pages
with just enough dynamic surface for live status; SQLite via
`node:sqlite` is the one storage option that fits that shape with
nothing external to provision.

The three fixed requirements map onto
[ADR 0001](notes/adr/0001-realtime-and-concurrent-updates.md) and
[ADR 0002](notes/adr/0002-identity-and-permissions.md). Real-time
delivery is SSE, push-only — over WebSockets (no bidirectional need) and
polling (wastes a resident's data for no latency gain). Concurrency is
optimistic: a server-owned `version` rejects a stale write with 409 and
the canonical state, over last-write-wins (silently loses a newer
report) and over preserving every conflict (costs "useful at a glance"
for a problem nobody had hit). Identity is a server-issued pseudonymous
session — a high-entropy credential the server generates and hashes,
never a client's own claim — over client-generated pseudonyms (no real
trust boundary) and full verified accounts (not asked for).

Every facility since Laundry earns its own state model from its own
stated facts rather than inheriting one by resemblance. Otter, Rabbit,
Weasel, and Badger Room all land on the same `occupancy` plus optional
`expectedEndAt` shape, but ADRs 0004–0007 each re-derive it
independently, since a prior room's reasoning doesn't transfer just
because the shape looks the same. Rat Room (ADR 0008) breaks that shape
on purpose: its real question is "how many of ten seats are free," not
"is anyone here," so it models ten independently-reportable seats rather
than one room-level flag — a genuine change in resource granularity, not
a style choice.

Turning this brief into a buildable workflow took three documents, each
doing a different job: an ADR fixes the state model a later change is
allowed to build against; `CLAUDE.md` holds the standing rules a later
change must never violate (Laundry's fixed five-location/ten-machine
layout, `out-of-order`'s stickiness, identity never trusting a client
claim);
`spec/` enforces both against the running app over HTTP. Once the ADR
practice was established, facility implementation did not begin until
its decision record was frozen; nothing merged until `spec/` was green.

## Agent workflow: why so staged

Every facility after AA Room went through the same narrow pipeline: ADR
first, no code → backend, reviewed and committed on its own → practical
panel, reviewed and committed → 3D scene, reviewed and committed →
production deploy and live smoke test. Rat Room's own three commits —
[`22f6502`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/22f6502)
(backend),
[`43e9c87`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/43e9c87)
(panel),
[`906eaa0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/906eaa0)
(3D) — are one instance; every facility since Otter Room shows the same
shape in the log. I had the agent stop and wait for my review at each
boundary rather than building a facility end-to-end in one pass.

The reason is cost containment, not caution for its own sake. A wrong
state-model decision caught at the ADR stage costs nothing — no code
exists to unwind. The same mistake caught after backend, panel, and 3D
are already interleaved costs a much larger revert, and risks dragging
already-verified sibling facilities down with it. Six facilities had
already shipped to production by the time Rat Room started; nothing
about a seventh could put that proven code at risk. Staging review at
the seams where a mistake is cheapest to catch kept every commit small
enough to actually review.

The real cost is time: several checkpoints per facility is slower than
one combined pass, and it only pays off if the reviewer actually reads
each stage. It paid off concretely during Rat Room's 3D work, where a
real-person review of the Stage 2 occupied-state screenshots — not an
automated check — caught the decorative figures standing in open floor
space instead of at a workstation, a defect no test could have named
since nothing about it was functionally wrong.

## Two corrections that changed how the project is built

**SQLite test isolation.** Adding Rabbit Room's own `*-decay.test.ts`
pushed a previously harmless flake into a real release blocker: a
docs-only commit failed CI seven times running, always
`database is locked`, on a different decay spec file each time — seven
identical failures on a commit that changed no code ruled out a one-off
before any fix was attempted. The real cause was import-time coupling:
each room module imported `db.ts` and self-seeded at module load, so a
decay spec's own static import — meant only to reach pure logic against
a throwaway in-memory store — transitively opened a second real
connection to the same on-disk file the running app already held,
racing it for the lock. The fix,
[`91167bd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/91167bd),
was an architectural split, not a retry: each room module now takes a
required `store`/`now` and never imports `db.ts`; a sibling `-db.ts`
module is the only thing wired to the real connection. Verified fifteen
`pnpm check` runs straight, the decay spec files running in parallel
fifteen more times with zero lock errors, and every CI run since —
including the final seven-facility, 261-test scale — going first-try
green.

**A site-wide styling scare that wasn't a code bug.** After
[`9a2461e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/9a2461e)
(the Rat Room scroll fix), a real-person review reported the entire site
rendering unstyled — default fonts, native buttons, the layout gone.
Rather than assume the new CSS was the cause, the diagnosis ran a fresh
`astro dev` server, a fresh production build, and an isolation test
reverting the CSS block — all three rendered correctly. The real cause
sat outside the source: a leftover local server process from earlier
testing was serving an old build's HTML, referencing a CSS filename a
later rebuild had since hashed differently. There was no code fix; the
lesson is that a serious-looking regression was run to ground by
eliminating real hypotheses in order, not by guessing at the newest
change and reverting it on suspicion.

## Current state

All seven facilities are implemented and verified live in production.
Each has its own `spec/` coverage and a confirmed post-deploy smoke
check. Their decisions are documented across eight ADRs — two
cross-cutting (real-time/concurrency and identity) and one per facility
from AA Room on, since Laundry precedes the ADR practice. What remains
is polish and presentation, not further facility work.
