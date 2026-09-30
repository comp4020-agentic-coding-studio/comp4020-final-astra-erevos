# Process overview

This file grows across the project as decisions get made and commits land.
Each entry is a decision or an event, not a task list — where it matters, it
says what the alternative was, or what went wrong and how it got fixed. This
update covers the whole run so far, initial concept through the crit 8 deploy.

## The project

Toad Live is a resident-maintained live status board for Toad Hall's shared
laundry: five real rooms (A/B, C, E, F, G — D has none; its ground floor is
the Anton Aalbers Room instead), one washer and one dryer each, ten machines
total. It started from a real, personal complaint: there's no shared view of
which machine is free, and a human report is only trustworthy for as long as
it stays fresh. The audience (current Toad Hall residents, not a generic
public), the laundry facts, the four real machine states (available, in-use,
out-of-order, unknown), out-of-order's stickiness, and the
washer-display-vs-dryer-estimate distinction for remaining time were all
interrogated in conversation and landed as the project's design anchor and
first decision record in
[`4028255`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/4028255).

## Stack, and why crit 8 is persistence-only

Astro was chosen as the stack
([`4028255`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/4028255)):
it keeps mostly-static pages cheap while still allowing the small dynamic
surface this app needs — reading and writing machine status — and it fits
the fixed 256MB/one-machine shape far more comfortably than a heavier SSR
framework. Storage is SQLite, via Node's built-in `node:sqlite`, on the one
thing the Fly setup actually persists: the `/data` volume. That avoids a
native dependency and a separate database server the course setup doesn't
provide.

Crit 8's own spec says the real-time layer can wait until "All at once" at
the next crit, so real-time was deliberately not built this week — the one
thing crit 8 proves is that a stranger's report to a machine survives their
own return visit. Building it now would have spent the week on something
that isn't part of crit 8's proof-of-life target. The five-room, ten-machine scope was a later
refinement of the original plan (a single room): since the layout turned out
fully uniform and already known, building all five cost barely more than
building one, and demonstrates a real status layer rather than a
one-room toy.

## The first persistence slice

[`6ffddd8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/6ffddd8)
is where the app became an app: Astro in server mode via `@astrojs/node`, a
`machines` table seeded with the ten real machines, a `GET`/`PATCH
/api/machines/:id` route, and a persistence test covering crit 8's core
mechanically checkable persistence interaction — a status update checked by
two independent HTTP requests, the same shape a stranger's return visit
takes. The busybox placeholder was replaced entirely; nothing
from it survives except the fixed Dockerfile/fly.toml contract it was
proving.

## From engineering prototype to a dashboard, in two passes

The first working version was, by design, a stack of raw `<select>`s and
buttons — functionality before form. Once I'd manually tested it end to end
(all five rooms, a washer and a dryer update, reload-persistence) and
confirmed the interaction worked, I asked for a first visual pass: a warm,
communal identity rather than a generic admin panel, colour-coded status
badges with redundant icon+text (in-use reads as a neutral occupied blue,
not an alarming amber — nothing's wrong when a machine is just running),
prominent remaining time, and reporting moved behind a disclosure so the
default view reads rather than edits.

After manually reviewing that pass I asked for a second, narrower refinement
rather than a further redesign: more deliberate use of desktop width with
the five blocks centred as a balanced 3+2 rather than grid-stretched, a
consistent inline-SVG icon pair for washer/dryer, "Block" demoted from a
card to a zone label so only the machine itself reads as a card, a more
obviously tappable "Update status" chip, and a distinctive stamped
hazard-stripe treatment for out-of-order, evoking the real taped-up notices
at Toad Hall. Both passes, once manually approved, landed together in
[`ce3c5aa`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/ce3c5aa) —
no schema or persistence change in either.

## Verifying persistence for real, and the incident that came with it

Local tests proving persistence are one thing; the brief's actual promise is
that it survives a real restart or redeploy on Fly. Verifying that meant:
deploy, `PATCH` a machine to a known state, redeploy again, and check the
exact same fields come back.

The first attempt surfaced a real bug, not a hypothetical one: a malformed
timestamp — a shell date-formatting mistake on my end, not something the UI
itself can send — got written to `started_at` unvalidated. `node:sqlite`
throws rather than silently truncate when it reads an `INTEGER` back that's
larger than `Number.MAX_SAFE_INTEGER`, so that one row started 500ing on
*every* subsequent `GET` or `PATCH`, not just the request that caused it.
Diagnosing it meant reading the live `flyctl logs` trace back to the exact
line, confirming the cause by reproducing it locally, and repairing the live
row directly via `flyctl ssh console`, since the volume itself, not just the
code, needed fixing.

The durable fix, in
[`3c0b63f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/3c0b63f),
is the actual lesson: `PATCH` now rejects any `startedAt`/`expectedEndAt`
that isn't a safe, positive integer with a 400 before it reaches SQLite, a
regression test asserts exactly this case, and `CLAUDE.md` carries the rule
generally — any future numeric field from a client needs the same guard, not
a try/catch after the fact. This is what this file is supposed to hold: an
agent-directed system hit a real failure in the field, and the fix is
durable — code, test, and rule — not a retry.

With that fix deployed, the redeploy check ran clean: a known report to
`g-dryer` came back byte-identical — `startedAt`, `expectedEndAt`,
`confirmedAt`, `reporterId` all unchanged — after a real image redeploy (the
machine's version number moved), which is the actual proof the `/data`
volume does what `fly.toml` claims it does.

## What's still ahead

Real-time sync (crit 9), decay/staleness thresholds (pending real
cycle-time data, not guessed), verified resident identity, and every
non-laundry space stay deliberately out of scope — see
`notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` for the fuller list. README's own
citations for its definition of good are the next piece of process still
missing.
