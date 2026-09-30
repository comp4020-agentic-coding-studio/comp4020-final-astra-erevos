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

The exact identity and verification model is not fixed yet.

Possible approaches include resident accounts, invitation-based access, or another lightweight form of resident verification.

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
  - bookable.

- **Rabbit Room**
  - group study;
  - small gatherings / shared meals;
  - approximately twelve people;
  - bookable.

- **Badger Room**
  - formal meeting / interview room;
  - special study or organised activities.

- **Rat Room — Computer Room**
  - computers and printing;
  - primarily a study space.

- **Weasel Room — Music Room**
  - guitar and keyboard;
  - bookable for music practice.

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

The exact expiry rules are not decided yet.

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
- who/when last updated is stored (an opaque reporter id, no name/login yet);
- a simple way for a visitor to change one machine's state.

Explicitly deferred past Crit 8 — each a deliberate scope decision recorded
in PROCESS.md, not a gap:

- **real-time sync** between simultaneous sessions — the final-project brief
  places this at the next crit ("All at once"), and Crit 8's own spec says
  the real-time layer can wait;
- **decay/staleness thresholds** for available/in-use/unknown (when a report
  goes confirmed → stale → expired) — left open pending real machine
  cycle-time data, not guessed;
- verified resident identity — stays a lightweight anonymous/pseudonymous
  session for now, schema-compatible with adding verification later;
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

# 10. Decisions still open

The following should be interrogated before they are fixed:

- exact resident identity / verification model;
- whether non-residents can see any information;
- how updates are attributed;
- how conflicts between two simultaneous updates are handled;
- the lifetime of each ordinary, non-sticky status (out-of-order is now
  confirmed as non-expiring — see §3);
- whether historical state is useful or only the present matters;
- how many *non-laundry* rooms should exist in the first full version
  (laundry itself is now fully confirmed — five rooms, ten machines, §3);
- whether rooms are manually updated, timer-driven or both;
- the role of booking information, if any;
- the scope of community notes;
- how the 3D / animated layer should work;
- which claims about "good" should become automated checks.

These questions should be resolved from the needs of the Toad Hall community and the project's definition of good, rather than by copying patterns from generic social or booking apps.

---

# 11. Core direction

The project should remain centred on:

**shared live state + visible freshness + small-community co-presence**

The final application may grow substantially, but new features should strengthen this idea rather than replace it.