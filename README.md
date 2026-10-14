# Toad Live

Toad Live is a live status board for Toad Hall's shared laundry — five
rooms, ten machines — kept current by whoever last walked past, not by
sensors.

## Why this, and why for Toad Hall specifically

The obvious answer is generic laundry software. That's not the bet. Clay
Shirky's
[*Situated Software*](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
argues scalability is a choice, not a virtue; Robin Sloan's
[*An App Can Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/)
argues a small app for people you know is worth building, product or not.
Toad Live sits between them, sized to one bounded community that already
knows "Block C," skipping onboarding and a general facility taxonomy.

## Useful at a glance, or it's not useful at all

If checking the app takes longer than walking to the laundry room, nobody
uses it. The default view answers one question first: which machines are
available, in use, out of order or unknown, and, where known, how long an
in-use machine has left.

## Freshness is part of the information, not an afterthought

A resident's report is a claim about a moment, not a fact that stays true.
The OpenStreetMap wiki's
[`survey:date`](https://wiki.openstreetmap.org/wiki/Key:survey:date)
convention — tagging when a crowd-maintained fact was last checked — is
real precedent: data that looks current but isn't is worse than data that
admits its age, which is why every machine shows "confirmed N min ago." A
timed in-use report expires to unknown the instant its end time passes;
out-of-order is the exception. The broader model — whether available
should age out — is still unresolved; see `PROCESS.md`.

## Reporting has to take seconds

A report should take only a few seconds and need no account setup —
opening the page is enough.

## It gets better because other people use it

Toad Live gets more useful as more residents participate — one person
reporting to nobody is a diary, not a status board.

## Tells people apart, without making them prove who they are

A report needs *some* identity behind it, or there's no way to tell whose
view is fresher when two disagree. Toad Live's answer is a server-issued
pseudonym (`Toad-7F3A9C`), not an account: on first visit the server hands
a browser a credential it never asked for, and a report is attributed to
whichever credential the request carried — never to what a browser
claims about itself. One resident, two browsers, is two pseudonyms;
that's correct, not a gap. Any valid pseudonym may report any machine —
laundry is shared, not owned — but without one, nothing changes. See
`notes/adr/0002-identity-and-permissions.md`.

## What we chose not to build

Every non-laundry space, verified resident accounts, and any booking or
reservation system — a status layer, not a scheduler. Real-time delivery
and concurrency were decided at Crit 9, identity at Crit 10, both
verified live. Presence — who else has the app open — stays out of scope.

## Enforced vs. judged

`spec/` enforces that a report survives an independent later request, a
malformed timestamp or stale `ifVersion` is rejected (409) rather than
corrupting a row, a report reaches another open session within a second,
and a report with no valid session or a forged actor claim is rejected
server-side. `CLAUDE.md` records the standing rules: the fixed five-room,
four-state model, decay never touching out-of-order, and identity as
server-verified possession of a credential, never a client's own claim.
Left to a person: whether the freshness language reads honest, and
whether a tutor reading `flyctl logs` alone can tell two residents
apart — rehearsed live, not just asserted.

---

*Published in full at `/readme/`. First version, expected to change.*
