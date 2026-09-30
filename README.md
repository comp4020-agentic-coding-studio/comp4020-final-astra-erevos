# Toad Live

## What this is

Toad Live is a resident-maintained live status board for Toad Hall's shared
laundry: five rooms, ten machines, kept current not by sensors but by
whoever last walked past and looked.

## What good means here (v0.1 — rough, and expected to change)

Good does **not** mean complete. This is a first draft of what good means for
this app, written before most of it exists, and it's meant to change as the
app meets real residents.

For a resident-maintained status board, good means:

- **Honest about age, not just state.** A "washer free" reported 40 minutes
  ago is a different fact from one reported 40 seconds ago, even though both
  currently say "free." The app should never present an old human report as
  if it were fresh. Exactly how old is "too old" is still an open question —
  see `PROCESS.md` — because it should come from real cycle-time data, not a
  guess.
- **Honest about certainty, not just freshness.** A broken machine is a
  different kind of fact from a stale occupancy report: it doesn't decay
  with time, and shouldn't be treated as if it might quietly fix itself.
  Out of order stays out of order until a person says otherwise.
- **Cheap to contribute to.** If reporting a machine's state takes longer
  than walking down to look at it yourself, nobody will do it, and the whole
  premise fails. A report should take a few seconds.
- **Scoped to what's actually broken, not what's generically missing.** Toad
  Hall doesn't have a laundry problem because it lacks a booking system or
  accounts — it has one because there's no shared view at all. This app adds
  a view, not a reservation queue.

## What I read or looked at while deciding this

*(To fill in before submission — this needs real, specific sources, not this
placeholder. The final-project brief points at writing on the small web,
games built for a handful of friends, and tools built for one workshop as a
starting genre; the citations that actually shaped this app's definition of
good, and what was taken from each, belong here.)*

## What I chose not to build (for now)

- **Verified resident accounts.** Reports are anonymous/pseudonymous for now.
  The eventual plan is invite-based verification with reports still shown
  under a pseudonym rather than a real name — but that's future work, not
  this version.
- **Every shared space in the Hall.** Common rooms, study rooms, reception
  and courtyards are all real candidates later; this version is laundry
  only, because it's the sharpest, most concrete version of the same
  problem, and the layout is fully known.
- **Real-time updates between open sessions.** The next stage of this
  project adds it; this version proves persistence first.
- **Booking, reservations or notifications.** This is a status layer, not a
  scheduling system — deliberately, because the problem is "what's true
  right now," not "who gets it next."

---

*This document is published in full at `/readme/`. It's a first version,
expected to be wrong in places — that's the point of writing it now rather
than at the end.*
