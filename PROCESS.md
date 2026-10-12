# Process overview

This file records the decisions and events that shaped Toad Live — one
entry per decision or incident, not a task list, saying what the
alternative was or what broke and how it got fixed. Rewritten at Crit 9 to
stay inside the project's own length target; detail trimmed from here still
lives in the commits it cites.

## Concept and stack

Toad Live began from a real complaint: no shared view of which Toad Hall
laundry machine is free, and a human report is only trustworthy while it
stays fresh. The audience (current residents, not a generic public), the
five real locations (A/B, C, E, F, G — D has none), the four machine
states, out-of-order's stickiness, and the washer-display-vs-dryer-estimate
distinction for remaining time were interrogated in conversation and
landed as the design anchor in
[`4028255`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/4028255).
Astro was chosen the same session: it keeps mostly-static pages cheap while
allowing the small dynamic surface the app needs, and fits the fixed
256MB/one-machine Fly shape more comfortably than a heavier SSR framework.
Storage is SQLite via `node:sqlite` on the one thing Fly actually persists,
`/data` — no native dependency, no separate database server.

## Crit 8: persistence, then a bug that mattered

[`6ffddd8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/6ffddd8)
is where the app became an app: Astro in server mode, the `machines` table
seeded with all ten real machines, `GET`/`PATCH /api/machines/:id`, and a
persistence test covering Crit 8's actual proof — a status update checked
by an independent later request, the same shape a stranger's return visit
takes. Crit 8 covered all five rooms, not one: the layout was uniform and
already known, so building all five cost barely more than one and proved a
real status layer rather than a toy.

The prototype then got two manual visual passes: once end-to-end tested, a
warm communal identity and redundant icon+text status badges (in-use reads
as neutral occupied blue, not an alarming amber), reporting moved behind a
disclosure; then a narrower refinement for desktop balance, a consistent
washer/dryer icon pair, and a stamped hazard-stripe treatment evoking Toad
Hall's real out-of-order notices. Both landed together in
[`ce3c5aa`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/ce3c5aa),
no schema change in either.

Verifying persistence meant a real Fly redeploy check, not a local restart,
and it surfaced a real incident: a malformed timestamp, sent by accident,
got written unvalidated into `started_at`. `node:sqlite` throws rather than
truncate when it later reads an `INTEGER` past `Number.MAX_SAFE_INTEGER`,
so that row 500'd on every subsequent request, not just the one that
caused it. Diagnosing it meant reading live `flyctl logs` back to the
failing line, reproducing it locally, and repairing the live row via
`flyctl ssh console`. The durable fix, in
[`3c0b63f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/3c0b63f):
`PATCH` rejects any `startedAt`/`expectedEndAt` that isn't a safe positive
integer before it reaches SQLite, a regression test asserts it, and
`CLAUDE.md` carries the rule generally. With that deployed, the redeploy
check ran clean — a known report came back byte-identical after a real
image redeploy.

## Closing the in-use leak

A resident reported, after Crit 8, that an in-use machine never stopped
being in-use — a dryer nobody estimated an end time for had no path off
"in-use" at all.
[`f9ed19c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/f9ed19c)
added lazy decay, computed on an ordinary read, never pushed: with
`expected_end_at` set, the machine decays to `unknown` the instant it
passes, exact, no threshold guessed; with it unset, a fixed window since
`started_at` — currently a **provisional** 12 hours
(`UNTIMED_IN_USE_DECAY_MS` in `src/lib/db.ts`), picked to be clearly longer
than any real cycle, not measured. `available` and `out-of-order` are
untouched — out-of-order stays sticky as `CLAUDE.md` requires, and the
resident's own report confirmed `available` shouldn't auto-expire either.
Covered by `spec/decay.test.ts`.

## Crit 9: real-time, and the concurrency decision

The brief's demand: a change one resident makes reaches every other open
session within about a second, with no reload, plus one decided and
justified call about simultaneous use. Both are recorded in full in
[`notes/adr/0001-realtime-and-concurrent-updates.md`](notes/adr/0001-realtime-and-concurrent-updates.md);
summarised here.

**Transport**: server-sent events, over WebSocket (the app never needs to
push anything back over the live channel — writes stay `PATCH`) and over
polling (fights the auto-stop-to-zero economics `fly.toml` is built
around). One Fly machine, one Node process, so there's no cross-instance
broadcast problem to solve.

**Concurrency**: optimistic concurrency over last-write-wins. Plain LWW can
silently discard a newer state with no sign anything was lost — including
resurrecting a report the server's own lazy decay already invalidated,
since decay is a real write to the row too. Preserving every conflicting
report instead was considered and rejected: it costs the "useful at a
glance" property README asks for, for a problem this app hasn't hit yet.
`machines` gains a server-owned `version`, starting at 1, incremented
atomically on every persisted mutation — a resident's report or a decay
transition alike. A `PATCH` echoes the version it last saw; a mismatch is
rejected with 409 and the current canonical state, never silently applied.
Decay's own trigger is unchanged: still lazy, still only evaluated on an
ordinary read; a reconnecting client's re-fetch is itself that read, so
nothing needed inventing there. Landing this on the real `/data` volume
needs an explicit `ALTER TABLE` migration, since `db/schema.sql`'s
`CREATE TABLE IF NOT EXISTS` won't touch rows that already exist there —
the same kind of gap the timestamp incident above taught to check for
rather than assume.

Three contract tests land with the implementation, starting red: a
resident report reaching another open session without reload, a stale
`ifVersion` rejected with 409 while the newer state stays untouched, and a
read-triggered decay reaching another open session as `unknown`. The
existing decay test also gains an assertion that a real decay advances
`version`, not just the status.

## What's still ahead

The broader freshness policy beyond the in-use window above —
`available`/`unknown` lifetimes, the provisional 12-hour value itself —
stays open pending real cycle-time data, tracked in
`notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10. Verified resident identity
and every non-laundry space remain deliberately out of scope.
