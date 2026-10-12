# Toad Live

Toad Live is a live status board for Toad Hall's shared laundry — five real
rooms, ten machines — kept current by whoever last walked past and looked,
not by sensors.

## Why this, and why for Toad Hall specifically

The obvious answer is generic laundry software, scaled to any hall. That's
not the bet. Clay Shirky's
[*Situated Software*](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
argues scalability is a choice, not a virtue; Robin Sloan's
[*An App Can Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/)
argues a small app for people you know is worth building,
product or not. Toad Live sits between them — bigger than Sloan's
four-person app, smaller than a platform for any resident anywhere — sized
to one bounded community: people who live here now and already know
"Block C" — skipping onboarding, a general facility taxonomy, and
accounts, since it answers a question one known group already has.

## Useful at a glance, or it's not useful at all

If checking the app takes longer than walking to the laundry room, nobody
uses it. The default view answers one question first: which machines are
available, in use, out of order or unknown, and, where known, how long an
in-use machine has left. When it was last confirmed is secondary, but
still visible.

## Freshness is part of the information, not an afterthought

A resident's report is a claim about a moment, not a fact that stays true.
The OpenStreetMap wiki's
[`survey:date`](https://wiki.openstreetmap.org/wiki/Key:survey:date)
convention — tagging when a crowd-maintained fact was last checked — is
real precedent: data that looks current but isn't is worse than data that
admits its age, which is why every machine shows "confirmed N min ago." A
timed in-use report already lives by it, expiring to unknown the instant
its end time passes; out-of-order is the exception, staying until a
person says otherwise — it won't fix itself on a timer; available doesn't
expire yet. The broader model — whether available should age out, and the
remaining thresholds — is still unresolved; see `PROCESS.md`.

## Reporting has to take seconds

A report should take only a few seconds and require no account setup. Any
more friction and residents stop reporting, and the shared view stops
being shared.

## It gets better because other people use it

Toad Live gets more useful as more residents participate — one person
reporting to nobody is a diary, not a status board. Your reports help
only because others read them, theirs only because you do too.

## What we chose not to build

Every non-laundry space, verified accounts (a session pseudonym for now),
and any booking or reservation system — a status layer, not a scheduler.
Real-time delivery is different: decided and built at Crit 9
(`notes/adr/0001-realtime-and-concurrent-updates.md`) — a report or decay
reaches every open session within about a second, no reload, verified
live. Presence — who else has the app open — stays out of scope.

## Enforced vs. judged

`spec/` enforces that a report survives an independent later request, a
malformed timestamp or stale `ifVersion` is rejected (409, newer state
intact) rather than corrupting or overwriting a row, and a report or decay
reaches another open session within about a second, no reload. `CLAUDE.md`
records the standing rules: the fixed five-room, four-state model, that
decay must never expire out-of-order, and that `version` is server-owned
and validated like any client number. Left to a person: whether the
freshness language reads honest, whether decay thresholds match real use,
and whether the conflict message reads clear, not just correct.

---

*Published in full at `/readme/`. First version, expected to change.*
