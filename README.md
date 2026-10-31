# Toad Live

Toad Live is a live status board for Toad Hall's shared spaces, kept
current by whoever last walked past, not sensors. Seven facilities
carry real shared state: Laundry (five locations, ten machines) and six
rooms — AA Room (common room), Otter Room (study), Rabbit Room (group
study/shared meals), Weasel Room (music), Badger Room (formal
meetings), and Rat Room (a computer room modeled as ten
independently-reportable seats, not one room-level flag, since "how
many seats are free" is the real question there). Laundry proved the
shape; every room since earned its own state model from what's actually
true about that room, never a template copied from Laundry's.

## Why this, and why for Toad Hall specifically

The obvious answer is generic facility-booking software. That's not the
bet. Clay Shirky's
[*Situated Software*](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
argues scalability is a choice, not a virtue; Robin Sloan's
[*An App Can Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/)
argues a small app for people you know is worth building, product or
not. Toad Live sits between them, sized to one bounded community that
already knows "Block C."

## Useful at a glance, or it's not useful at all

If checking the app takes longer than walking there, nobody uses it.
Pick a tab, see that room's current state and, where known, how long it
has left. Reporting needs no account: choose the facility, update the
relevant room or seat, and submit. The app becomes more useful when
several residents use it at the same time: one person's report becomes
another person's fresh context. Without that shared loop, it would be
closer to a private diary than a live community tool.

## Freshness is part of the information, not an afterthought

A resident's report is a claim about a moment, not a fact that stays
true. The OpenStreetMap wiki's
[`survey:date`](https://wiki.openstreetmap.org/wiki/Key:survey:date)
convention — tagging when a crowd-maintained fact was last checked — is
real precedent: data admitting its age beats data that merely looks
current, which is why every status shows "confirmed N min ago." Reports
expire back to unknown on their own schedule, decided per facility and
recorded in `notes/adr/`; out-of-order is the one sticky exception.

## Tells people apart, without making them prove who they are

A report needs *some* identity behind it, or there's no way to tell
whose view is fresher when two disagree. Toad Live's answer is a
server-issued pseudonym (`Toad-7F3A9C`), not an account: the server
hands a browser a credential it never asked for, and a report is
attributed to whichever credential the request carried. One resident,
two browsers, is two pseudonyms — the same way two people testing this
app from two separate sessions will see themselves told apart. See
`notes/adr/0002-identity-and-permissions.md`.

## What we chose not to build

Verified resident identity, and any booking or reservation system — a
status layer, not a scheduler. The paper sign-up sheets several rooms
already have on their doors are real-world artifacts this app
deliberately doesn't digitize. Presence stays out of scope.

## Enforced vs. judged

`spec/` enforces persistence, concurrency (a stale write gets 409, never
a silent overwrite), sub-second delivery to other open sessions, and
that a client can never assert someone else's identity. `CLAUDE.md`
records the facts the code must never contradict: Laundry's fixed
five-location/ten-machine layout, decay never touching out-of-order,
identity as server-verified possession of a credential. Left to a
person: whether the freshness language reads honest, and whether a
reader of `flyctl logs` alone can tell two residents apart — rehearsed
live.

---

*Published in full at `/readme/`.*
