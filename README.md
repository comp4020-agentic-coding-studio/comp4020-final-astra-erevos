# Toad Live

Toad Live is a live status board for Toad Hall's shared laundry — five real
rooms, ten machines — kept current by whoever last walked past and looked,
not by sensors.

## Why this, and why for Toad Hall specifically

The obvious answer to this brief is generic laundry software, built to
scale to any hall. That's not the bet here. Clay Shirky's
[*Situated Software*](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
argues that scalability and generality are choices, not automatic virtues —
his example is an app built for one specific schoolteacher, not
"schoolteachers everywhere." Robin Sloan makes a related but different case
in [*An App Can Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/):
a small app made for people you actually know can be worth building even
though it will never be a product. Toad Live sits between their two
examples — bigger than
Sloan's four-person family app, smaller than a platform meant for any
resident anywhere — sized to one bounded community: the people who live
here now.

That's a real constraint, not just a motivation: the app assumes a reader
already knows what "Block C" means, and skips onboarding, a general
facility taxonomy, and accounts, because it's answering a question one
known group already has.

## Useful at a glance, or it's not useful at all

If checking the app takes longer than walking to the laundry room, nobody
uses it. So the default view answers one question — which machines are
available, in use, out of order or unknown, and, where known, how long an
in-use machine has left — before anything else. When it was last confirmed
is secondary, but still visible.

## Freshness is part of the information, not an afterthought

A resident's report is a claim about a moment, not a fact that stays true.
The OpenStreetMap wiki's
[`survey:date`](https://wiki.openstreetmap.org/wiki/Key:survey:date)
convention — tagging when a crowd-maintained fact was last actually checked
— is a real precedent for
exactly this: data that looks current but isn't is worse than data that
visibly admits its own age. Every machine shows "confirmed N min ago" for
the same reason, and the confirmed → stale → expired model it's building
toward — thresholds still unresolved; see `PROCESS.md` — exists so an old
"free" report eventually stops reading as current fact.

## Reporting has to take seconds

A report should take only a few seconds and require no account setup. Any
more friction and residents stop reporting, and the shared view stops
being shared.

## It gets better because other people use it

Toad Live becomes more useful as more residents participate — a single
person reporting statuses nobody else reads is a diary, not a status
board. Your reports are only useful because others read them, and theirs
are only useful because you do too.

## What we chose not to build

Every non-laundry space, verified resident accounts (a session pseudonym
for now), real-time updates between open sessions, and any booking or
reservation system — this is a status layer, not a scheduler.

## Enforced vs. judged

`spec/` enforces that a report survives an independent later request, and
that a malformed timestamp is rejected rather than corrupting a row.
`CLAUDE.md` records the standing rules the agent must preserve: the fixed
five-room, four-state model, and that any future decay logic must not
silently expire out-of-order. Left to a person: whether the freshness
language reads as honest rather than alarmist, and whether the still-open
decay thresholds end up matching how long a report actually stays useful.

---

*Published in full at `/readme/`. First version, expected to change.*
