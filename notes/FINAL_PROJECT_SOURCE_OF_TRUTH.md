# Final Project — Source of Truth

## Purpose

This file preserves the human-designed concept for the final project before further implementation and agent-driven design work.

It is a design anchor, not the final README, PROCESS.md, or CLAUDE.md.

Its purpose is to stop the core idea drifting during long Claude Code sessions while still allowing the implementation and details to evolve.

---

# 1. Working concept

## Working title

**Toad Live**

The name is provisional.

## One-sentence concept

A resident-maintained live view of what is happening across Toad Hall's shared facilities and communal spaces.

The app should help a resident answer simple questions such as:

- Is there a washing machine available?
- How long does a dryer have left?
- Is a study room currently quiet or occupied?
- Is a common area being used for eating, studying or socialising?
- Is reception currently staffed?
- What is happening around the Hall right now?

The core idea is not simply to list facilities.

The app should make Toad Hall feel **alive, shared and current**.

---

# 2. Intended community

The primary audience is people who currently live in Toad Hall.

This is deliberately a small community rather than a general public social network.

Residents contribute information about shared spaces, and other residents use that information to decide where to go and what is available.

**Decided for now, verification model still open (2026-10-14):** identity
is a server-issued pseudonymous browser session — see §9's Crit 10 entry
and `notes/adr/0002-identity-and-permissions.md`. This tells two people
apart and checks permissions server-side, which is what Crit 10 asked
for; it does not verify that a pseudonym is actually a Toad Hall
resident. Whether that verification is ever needed, and if so whether via
resident accounts, invitation-based access, or another lightweight form,
remains open.

---

# 3. Shared places

The current facility model includes:

## Laundry

**Confirmed layout (2026-10-01):** five laundry rooms, one per block-group —
**A/B** (A and B share a stairwell, treated as one location), **C**, **E**,
**F**, **G**. **D has no laundry room** — its ground floor is the Anton
Aalbers (AA) Room instead. Each of the five rooms has exactly **one washer
and one dryer**: 10 machines total, uniform across rooms.

Machine states (confirmed, not invented edge cases):

- **available**
- **in-use** — carries a start time and an optional expected end time
  (`expected_end_at`). A washer's own display shows its remaining time,
  which a resident reads and reports as an end time; a dryer has no such
  display, so its end time is only known if a resident chooses to estimate
  one. The field is the same and nullable for both machine types — when
  it's absent, the UI shows "in use — remaining time unknown" rather than
  guessing, and the app must never fabricate an end time from an assumed
  fixed cycle length for either type.
- **out-of-order** — laundry is free, so machines do break, and staff post a
  physical "OUT OF ORDER" notice when they do. This is not a freshness-decay
  state: it persists until a person explicitly changes or reconfirms it, and
  must never silently expire back to available/unknown the way an ordinary
  occupancy report can.
- **unknown** — no recent report, or an ordinary report has expired.

## Shared rooms

- **Anton Aalbers Room — Common Room**
  - large communal room;
  - television;
  - pool table;
  - table tennis;
  - books and sofas;
  - often used for Hall activities.

- **Otter Room — Study Room**
  - small study / discussion space;
  - approximately six people;
  - a paper sign-up sheet on the door, not a digital booking system.

  **Confirmed and implemented (2026-10-25):** Toad Live's third live-state
  facility, after Laundry and AA Room — see
  `notes/adr/0004-otter-room-live-state.md`. Live state is `empty` /
  `occupied` / `unknown`, with an optional `expectedEndAt` a resident may
  carry over from the door's sign-up sheet — the same kind of
  never-fabricated, resident-estimated signal as a dryer's end time (§3
  Laundry), not an activity taxonomy or a headcount (neither is tracked;
  §10). `empty` decays to `unknown` after 15 minutes (a product freshness
  judgement, since this room's own occupancy can turn over quickly);
  `occupied` decays at `min(expectedEndAt, confirmedAt + 4h)` — the
  4-hour figure is a real, already-existing Toad Hall norm (residents
  already don't use the room past four hours), not a guess. No booking
  calendar, no future reservation: Toad Live shows the room's state right
  now, the same scope boundary Laundry and AA Room both keep.

- **Rabbit Room**
  - group study;
  - small gatherings / shared meals;
  - approximately twelve people;
  - a paper sign-up sheet on the door, not a digital booking system.

  **Confirmed and implemented (2026-10-26):** Toad Live's fourth
  live-state facility, after Laundry, AA Room, and Otter Room — see
  `notes/adr/0005-rabbit-room-live-state.md`. Live state is `empty` /
  `occupied` / `unknown`, with the same kind of optional,
  resident-estimated `expectedEndAt` Otter Room uses, never an activity
  taxonomy, headcount, digital booking, or kitchen-appliance status —
  group study and shared meals are two real, distinct uses of this room,
  but knowing which one is happening has no decision-relevant value to a
  resident checking the app, and the two typically don't co-occur.
  `empty` decays to `unknown` after 15 minutes, a fresh product freshness
  judgement made for this room's own volatility, not a transferred rule;
  `occupied` decays at `min(expectedEndAt, confirmedAt + 4h)`, the same
  4-hour figure confirmed as a real, already-existing Toad Hall norm for
  this room specifically. No booking calendar, no future reservation —
  the same scope boundary Laundry, AA Room, and Otter Room all keep.

- **Badger Room**
  - formal meeting / interview room;
  - special study or organised activities.

  **Confirmed and implemented (2026-10-31):** Toad Live's sixth
  live-state facility, after Laundry, AA Room, Otter Room, Rabbit Room,
  and Weasel Room — see
  `notes/adr/0007-badger-room-live-state.md`. Live state is `empty` /
  `occupied` / `unknown`, with the same kind of optional,
  resident-estimated `expectedEndAt` every other occupancy-only room
  uses, never an activity taxonomy, headcount, digital booking, or
  piano/TV-status field — formal meetings, interviews, special study, and
  organised activities like Toad's Table are several real, distinct uses
  of this room, but knowing which one is happening has no
  decision-relevant value to a resident checking the app, and this room's
  own brief is explicit that a passerby only cares whether it's in use.
  `empty` decays to `unknown` after 15 minutes — independently re-derived
  for this room specifically because, unlike every prior occupancy room,
  Badger Room is explicitly **not frequently booked**: low booking
  frequency affects the room's *prior probability* of being occupied, not
  how long one already-confirmed empty observation stays authoritative,
  so the 15-minute figure still applies even though the usual "this room
  turns over quickly" argument doesn't. `occupied` decays at
  `min(expectedEndAt, confirmedAt + 4h)`, the same 4-hour figure
  confirmed as a real, already-existing Toad Hall norm for this room
  specifically. No booking calendar, no future reservation — the same
  scope boundary every other implemented facility keeps.

- **Rat Room — Computer Room**
  - computers and printing;
  - primarily a study space.

- **Weasel Room — Music Room**
  - guitar and keyboard;
  - a paper sign-up sheet on the door, not a digital booking system.

  **Confirmed and implemented (2026-10-28):** Toad Live's fifth
  live-state facility, after Laundry, AA Room, Otter Room, and Rabbit
  Room — see `notes/adr/0006-weasel-room-live-state.md`. Live state is
  `empty` / `occupied` / `unknown`, with the same kind of optional,
  resident-estimated `expectedEndAt` Otter Room's and Rabbit Room's own
  states use, never an activity taxonomy, headcount, digital booking, or
  instrument-status field — guitar and keyboard are two real, distinct
  uses of this room, but knowing which one is happening has no
  decision-relevant value to a resident checking the app. `empty` decays
  to `unknown` after 15 minutes, a fresh product freshness judgement made
  for this room's own volatility, not a transferred rule; `occupied`
  decays at `min(expectedEndAt, confirmedAt + 4h)`, the same 4-hour
  figure confirmed as a real, already-existing Toad Hall norm for this
  room specifically. No booking calendar, no future reservation — the
  same scope boundary every other implemented facility keeps.

## Other communal areas

- the shared common area beside each residential block kitchen;
- east and west courtyards;
- BBQ / outdoor table area;
- reception.

These do not all need to exist in the first implementation.

---

# 4. Core interaction

A resident should be able to look at a shared facility or space and quickly understand its current state.

A resident should also be able to contribute a small update in seconds.

Examples:

- mark a washing machine as running and give its remaining cycle time;
- mark a common area as being used for studying, eating or chatting;
- report whether a study space appears occupied;
- confirm that reception is staffed;
- leave a small community note.

The resulting information is shared state.

Another resident should benefit from the contribution.

---

# 5. Freshness is part of the information

A human-reported status should not pretend to remain true forever.

Every live observation should make its age visible.

For example:

> Group studying  
> updated 6 minutes ago

or:

> Staff present  
> last confirmed 12 minutes ago

Old observations may gradually become uncertain or expire.

Different kinds of information may deserve different lifetimes.

For example:

- machine cycle state may be tied to a timer;
- room occupancy may expire relatively quickly;
- reception status may need frequent confirmation;
- community notes may last much longer;
- facility names and locations are stable information.

Several facility-specific expiry rules are now decided — AA Room, Otter
Room, Rabbit Room, Weasel Room, and Badger Room each have their own
confirmed decay model (see §3 and §10). The broader freshness policy
remains partially open: in particular, Laundry's own `available`/
`unknown` lifetimes and its provisional untimed in-use window are not yet
finalized (§3, §10).

A major design question for the project is therefore:

**How can a small residential community share useful live information without pretending that human-reported information remains true forever?**

---

# 6. Two layers of the experience

## Layer 1 — useful at a glance

The main interface should prioritise practical information.

A resident who only wants to know whether a washer, room or common area is available should be able to find that answer quickly.

## Layer 2 — the Hall feels alive

Individual facilities may also have a richer visual representation.

The current idea is to experiment with small 3D or animated scenes, for example:

- a washing machine visibly spinning while running;
- students studying in a study room;
- people eating or talking in a common area;
- people playing in the Anton Aalbers Room;
- someone practising music in the Weasel Room;
- a staff member appearing at reception.

These visuals should respond to the same shared state as the practical interface.

They are intended to make Toad Hall feel inhabited and alive rather than acting as unrelated decoration.

This richer layer is part of the final-project vision, not a Crit 8 requirement.

---

# 7. Community traces

Residents may eventually be able to leave small notes or other lightweight traces in shared spaces.

The intention is not to create a conventional social feed.

The useful shared state remains the centre of the project.

Community traces should make the Hall feel lived-in without overwhelming the practical information.

The exact form of these interactions is still open.

---

# 8. What "good" is beginning to mean

This is provisional and will become the argument in README.md.

A good version of this project should be:

### Useful at a glance

A resident should be able to understand the important state of a facility quickly.

### Freshness-aware

The interface should make clear how recent a human-reported observation is rather than presenting stale information as fact.

### Easy to contribute to

Updating a shared status should take only a few seconds.

### Better because other residents use it

The app should gain value through shared participation rather than merely supporting many independent users.

### Alive

Changes made by other residents should visibly affect the shared Hall.

The practical dashboard and richer visual representations should describe the same underlying world.

---

# 9. Crit 8 — smallest proof of life

**Confirmed scope (2026-10-01):** since the five-room layout is uniform and
already fully known, Crit 8 covers **all five laundry rooms (10 machines)**
rather than a single room. This doesn't broaden the interaction model — it's
still one laundry-status system, repeated across five real locations, not a
second facility type. The proof of life still only needs **one** trace to
persist.

Crit 8 build:

- all 10 machines seeded with their real locations and types;
- persistent status (available / in-use / out-of-order / unknown) in SQLite
  on `/data`;
- in-use carries an optional expected end time (`expected_end_at`),
  populated from a washer's own display or a dryer user's estimate — shown
  as remaining time when present, otherwise "remaining time unknown"
  (see §3);
- out-of-order is sticky — no time-based expiry;
- who/when last updated is stored (an opaque reporter id, no name/login
  yet — since Crit 10, that id is a server-issued session, not a
  client-asserted one; see the Crit 10 entry below);
- a simple way for a visitor to change one machine's state.

Explicitly deferred past Crit 8 — each a deliberate scope decision recorded
in PROCESS.md, not a gap:

- **real-time sync** between simultaneous sessions — the final-project brief
  places this at the next crit ("All at once"), and Crit 8's own spec says
  the real-time layer can wait. **Built at Crit 9** — see PROCESS.md and
  `notes/adr/0001-realtime-and-concurrent-updates.md`;
- **decay/staleness thresholds** — partially settled since this was
  written (2026-10-01). A timed in-use report (`expected_end_at` set) now
  expires to `unknown` exactly when that time passes, no threshold
  needed — see PROCESS.md, "Closing the in-use leak." An untimed in-use
  report falls back to an explicitly **provisional** 12-hour window
  (`UNTIMED_IN_USE_DECAY_MS` in `src/lib/db.ts`). `available` does not
  decay. `out-of-order` remains sticky, never time-based. The broader
  freshness policy beyond this — available/unknown lifetimes, the
  provisional window's real value — is still open, pending real
  cycle-time data, not guessed;
- verified resident identity — stays open; what's decided and shipped
  (Crit 10) is server-issued pseudonymous session identity, not
  verification of who a person actually is. See the Crit 10 entry below;
- every other shared space (study/common rooms, reception, courtyards).

The Crit 8 proof-of-life path:

1. a visitor opens the app;
2. they inspect the laundry across all five rooms;
3. they change one machine's status;
4. the change is stored in SQLite on the `/data` volume;
5. they leave or reload;
6. they return (or a fresh HTTP request stands in for a stranger's return)
   and find their trace still there.

---

# 9a. Crit 10 — identity, permissions, and logging

**Decided and implemented (2026-10-14):** the final project must be
multi-user, with the server — not the client — telling people apart and
checking what each may do. Interrogated against three options (keeping
the existing client-generated, client-asserted reporter id; a
server-issued pseudonymous session; full verified accounts) and decided
on the second: see `notes/adr/0002-identity-and-permissions.md` for the
full comparison, mechanics, and live verification. In short — a
high-entropy credential the server issues and hashes, never a client
claim; no invented per-machine ownership, since laundry is shared state
with no "whose washer" concept in this app; every mutation attempt
logged server-side, pseudonym-only, readable from `flyctl logs` alone.
Verified live against the deployed Fly app: two isolated Chrome profiles
produced two distinct, log-visible pseudonyms, and a tutor narrated a
report/conflict/reconfirm/success sequence entirely from the log stream
without touching the app. A related production-only bug (the session
cookie's `Secure` attribute silently not being set behind Fly's
TLS-terminating proxy) was caught by this same live check and fixed in
`d7d0cd7` — see PROCESS.md.

---

# 10. Decisions still open

The following should be interrogated before they are fixed:

- verified resident identity — **partially decided**: server-issued
  pseudonymous session identity is implemented and verified (Crit 10,
  §9a); whether a pseudonym should ever be tied to a real, verified
  resident remains open;
- whether non-residents can see any information;
- how updates are attributed — **decided and implemented** for Crit 10:
  a server-resolved session id, never a client-supplied value — see §9a;
- how conflicts between two simultaneous updates are handled — **decided
  and implemented** for Crit 9 (optimistic concurrency / stale-write
  rejection): see `notes/adr/0001-realtime-and-concurrent-updates.md`,
  verified both locally and against the live deployment;
- the lifetime of each ordinary, non-sticky status (out-of-order is now
  confirmed as non-expiring — see §3);
- whether historical state is useful or only the present matters;
- how many *non-laundry* rooms should exist in the first full version —
  **partially decided**: AA Room, Otter Room, Rabbit Room, Weasel Room,
  and Badger Room are all now confirmed and implemented (§3); Rat remains
  open;
- whether rooms are manually updated, timer-driven or both — **decided
  for every implemented facility so far**: manually reported, with lazy
  read-triggered decay back toward `unknown` (never a timer or a
  connection event) — see §3's Laundry/AA Room/Otter Room/Rabbit Room/
  Weasel Room/Badger Room entries;
- the role of booking information, if any — **decided for Otter Room,
  Rabbit Room, Weasel Room, and Badger Room**: none. Live state only, no
  booking calendar, no future reservation (§3). Still open for any room
  not yet implemented;
- the scope of community notes;
- how the 3D / animated layer should work;
- which claims about "good" should become automated checks.

These questions should be resolved from the needs of the Toad Hall community and the project's definition of good, rather than by copying patterns from generic social or booking apps.

---

# 11. Core direction

The project should remain centred on:

**shared live state + visible freshness + small-community co-presence**

The final application may grow substantially, but new features should strengthen this idea rather than replace it.