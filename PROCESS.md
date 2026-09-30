# Process overview

## How to read this

This file grows across the project as decisions get made and commits land.
Each entry is a decision, not a task on a list — where it matters, it says
what the alternative was and why it lost. Commit links get added once
there's a commit to point at; the entries below are the decisions made
before any app code exists yet.

The project is Toad Live: a resident-maintained live status board for Toad
Hall's shared laundry. `README.md` and `notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md`
carry the concept; this file carries the reasoning behind how it's built.

## Decision record

### Stack: Astro

The course default from C2 onward, and there's no reason for this project to
be the exception: it keeps mostly-static pages cheap while still allowing a
handful of server-rendered API routes for the small dynamic surface this app
actually needs (reading and writing machine status). That fits the fixed
deploy shape — one shared-cpu-1x machine, 256MB — far more comfortably than a
heavier full SSR framework would, and it means the spec harness, CI and
Dockerfile conventions the template already assumes don't need reinventing.

The alternative considered was a bare Node server with hand-written routing.
Rejected for now: it would save little at this scale and cost the Astro
tooling the rest of the course specs assume. If the app's server-side needs
grow past what Astro's routes comfortably do (the real-time layer at the next
crit is the likely test of this), that's a new decision record, not a silent
drift.

### Storage: SQLite on `/data`

The fixed infrastructure gives exactly one thing that survives a restart or
redeploy: the `/data` volume. There's no separate database server in the
course setup, and running one would be its own app outside this one. SQLite
is a single file on that volume, has no server process to fit into the
256MB budget, and is more than enough for a resident community of this size
reading and writing machine status. It also gives the freshness/decay logic
(still being designed — see below) a natural place to compute from stored
timestamps rather than needing an external scheduler.

A flat JSON file on the same volume was the other option, and would have
worked for Crit 8's schema alone. SQLite was chosen anyway because the
schema is already known to grow (history, other shared spaces, verified
identity), and a real query layer earns its cost sooner rather than later.

### Crit 8 scope: persistence, not real-time

The final-project brief places the real-time requirement at the next crit
("All at once"), and Crit 8's own spec says explicitly that "the feature
list, the real-time layer and the polish can all wait." Building real-time
sync now would be building ahead of what's being marked this week, at the
cost of time better spent on the one thing Crit 8 actually checks: that a
stranger's change to a machine's status is still there when they, or anyone
else, come back. So Crit 8 ships with no WebSocket/SSE layer at all — the
page reflects current state on load, full stop — and that absence is a
decision, not an oversight.

### Crit 8 scope: all five laundry rooms, not one

The original plan was a single laundry room as the smallest possible slice.
That changed once the layout was confirmed: all five rooms (A/B, C, E, F, G)
have the identical shape — one washer, one dryer each — so building one room
and building all five costs almost the same amount of schema and UI work,
and five rooms make a far more honest demonstration that this is a real
status layer rather than a one-room toy. The interaction model doesn't
broaden: it's still one system, seeded with its real, already-known data.

### Decay thresholds: deliberately left unresolved

The confirmed → stale → expired model is settled (see README's "honest about
age" claim), but the actual minute thresholds are not, on purpose. Neither machine type has a fixed cycle
length to ground a threshold in: a washer displays its own remaining time
each cycle (read and reported by a resident), and a dryer has no display at
all, so its timing is only ever a resident's estimate when one is given. So
the threshold has to come from direct observation of how long a report
stays useful to residents, not a machine specification. Picking numbers
now, before that information exists, would
be guessing at exactly the kind of over-claimed certainty this app's own
definition of good argues against. Crit 8 therefore shows raw elapsed time
without committing to stale/expired bands; the schema stores what a future
decay function needs so adding it later isn't a schema change.

### Identity: session pseudonym now, shaped to grow into verified accounts

Crit 8 doesn't require telling two people apart — its one proof is a single
stranger's report surviving their own return visit. So identity for now is a
bare anonymous session token, generated client-side, attached to each report
so a change has *some* attribution without a login flow. The final vision
(see `notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md`, §2) is invite/admin-verified
residents shown under a pseudonym in the interface — the session-token field
is deliberately shaped so that later becomes "swap what populates this field"
rather than a schema migration.
