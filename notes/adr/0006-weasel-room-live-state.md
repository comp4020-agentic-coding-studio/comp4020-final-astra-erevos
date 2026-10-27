# ADR 0006: Weasel Room's shared live state

**Status**: Implemented and verified locally — production verification
pending. This ADR fixed the state model, statuses, and decay rules for
Toad Live's fifth facility before any schema, API, or UI work began, the
same order ADR 0001/0002/0003/0004/0005 each used (see `PROCESS.md`'s
"Rewritten each time the project's shape genuinely changed" convention).
An earlier draft of this ADR left the `occupied` ceiling explicitly open
pending confirmation of a real Weasel Room usage norm; that norm was
confirmed (see Decision 2) before any implementation began, and every
number below was decided, not provisional, from backend through 3D.
Backend, practical panel, and 3D scene are all built and locally verified
per the Verification section below; this status moves to "verified live"
only after a post-deploy production smoke check, the same gate ADR
0004/0005 used for Otter Room and Rabbit Room.

**This ADR's conclusion looks identical to ADR 0004's (Otter Room) and
ADR 0005's (Rabbit Room) — the same `occupancy`/`expectedEndAt` shape,
the same 4-hour/15-minute decay shape.** That match is a result of
checking Weasel Room's own stated facts independently, not a starting
assumption — see Decision 1 and Decision 2 for the reasoning behind each
piece. Where a rule really does carry over unchanged, this ADR says so
and says why (usually: it's a house-wide contract, not an
Otter-Room-or-Rabbit-Room-specific choice). Where a rule looks the same
but rests on evidence specific to this room, this ADR re-derives it
rather than citing ADR 0004/0005 and stopping there.

## Context

`FINAL_PROJECT_SOURCE_OF_TRUTH.md` §3 names Weasel Room only briefly: "a
Music Room — guitar and keyboard; bookable for music practice." The
richer real-world facts this ADR reasons from were given directly for
this decision: a small square room; a door on the south wall; a window on
the north wall, directly opposite the door; a whiteboard on the west
wall; a guitar in a corner; a keyboard against the east wall, with its
own bench; two ordinary chairs; a heater in the southwest corner. A paper
sign-up sheet on the door works exactly like Otter Room's and Rabbit
Room's: a resident may write an intended time in advance, or, finding no
reservation and nobody present, use the room and write their own time on
the spot. For a resident checking the app, only two things matter: is
someone using the room right now, and, optionally, when are they expected
to finish — not which instrument, and not how many people are in there.

The deliberate, stated scope boundary (unchanged from
`FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s, `README.md`'s, and ADR 0004/0005's
"what we chose not to build"): Toad Live does not digitize the paper
sign-up sheet, does not build a booking calendar, and does not track a
future reservation. This ADR only concerns the room's **current live
state**.

There is no formal time limit, but residents follow the same community
norm Otter Room's and Rabbit Room's own briefs stated: a single use
typically does not run past four hours. This is confirmed as a real fact
about Weasel Room specifically — practice sessions, like Otter Room's
study sessions and Rabbit Room's group-study/shared-meal sessions,
default to not running past around four hours as an actual community
habit — not assumed by analogy to either of those rooms (see Decision
2).

What this ADR does **not** decide: anything about the 3D scene's specific
geometry or animation (the square room, the door/window/whiteboard
placement, the guitar corner, the keyboard-and-bench, the two chairs, the
heater) — that is implementation, following the existing
`room.ts`/`aa-room.ts`/`otter-room.ts`/`rabbit-room.ts` pattern once the
state shape below exists to drive it, and must not be read backward into
a data-model requirement. Nothing about any facility after Weasel Room is
decided here either.

## Decision 1 — state model: occupancy only, no activity field

**Weasel Room's own stated requirement settles this directly, without
needing to argue from either Otter Room's or Rabbit Room's precedent:**
the brief for this room states plainly that a resident only needs to know
whether the room is in use and, optionally, when it's expected to free
up — explicitly **not** which instrument is being played. Otter Room's
ADR applied this same decision-relevant-value test to its own different
uses — someone studying alone, a small group discussing together — and
found no distinction worth recording. Weasel Room's own two nameable
uses, guitar and keyboard, tell a resident nothing they'd act on
differently either, but this ADR does not need Otter Room's own argument
to reach that conclusion: this room's own brief already states it
outright.

This is also a structurally simpler case than Rabbit Room's. Rabbit
Room's ADR had to additionally establish that its two uses don't
typically co-occur, because it was weighing a single-value field against
an array-of-independent-activities model (AA Room's shape) — the two
uses' co-occurrence mattered to that choice. Weasel Room needs no such
argument: since no activity field is being added at all, whether a
guitarist and a keyboardist could in principle be in the room
simultaneously is irrelevant to this decision either way. There is no
field for that fact to need to represent or fail to represent.

**Chosen: `occupancy` plus an optional `expectedEndAt`** — the same
required-primary-plus-optional-secondary pattern every facility in this
project follows (AA Room's `activities`, Otter Room's and Rabbit Room's
`expectedEndAt` are each that room's own answer to "how much optional
detail does this room's own facts call for"; Weasel Room's answer, per
its own brief, is the same amount Otter Room's and Rabbit Room's needed —
exactly one optional field, carrying a time estimate, nothing else):

- `empty`
- `occupied`
- `unknown`

No `out-of-order`-equivalent status exists for Weasel Room, same
reasoning as every prior facility: nothing in the given facts raises a
broken guitar, a broken keyboard, or a broken heater as a concern within
this facility's current live-state scope. The instruments and the heater
are named as room contents, not as something Toad Live reports the
condition of — see Decision 3.

**`unknown` is not a reportable value**, for the same reason established
by AA Room (ADR 0003, Decision 2) and carried through Otter Room and
Rabbit Room (ADR 0004/0005, Decision 1): a resident's `PATCH` may only set
`occupancy` to `empty` or `occupied`. `unknown` remains part of the
stored and public `WeaselRoomOccupancy` type (seed state, and what decay
transitions into — Decision 2), representing "no sufficiently fresh
observation," which only the absence of a report can produce.

## Decision 2 — decay: a 4-hour hard ceiling on `occupied`, a 15-minute ceiling on `empty`

**The two numbers below are not both the same kind of fact for Weasel
Room, for the same reason ADR 0004 drew this distinction for Otter Room
and ADR 0005 re-drew it for Rabbit Room — and each has been checked on
Weasel Room's own terms, not assumed to transfer.**

- The **4-hour ceiling** is confirmed as a **real-world, community fact**
  about Weasel Room specifically: residents follow the same community
  norm stated for Otter Room and independently confirmed for Rabbit
  Room — a single use typically doesn't run past four hours — and this
  has now been confirmed as true of Weasel Room's own practice sessions
  as well, not inferred from "the other two rooms have this ceiling, so
  Weasel Room probably does too." It is a fact about this room, given
  directly and confirmed on its own terms, that happens to share its
  value with Otter Room's and Rabbit Room's own four-hour figures. Its
  epistemic status is identical to theirs (ADR 0004, Decision 2; ADR
  0005, Decision 2): a fact this ADR is recording, not producing, and not
  a universal rule this ADR is declaring for every future room —
  Weasel Room's four hours is its own independently-confirmed fact, not
  an inheritance from Otter Room or Rabbit Room.
- The **15-minute `empty` ceiling** is, as it was for Otter Room and
  Rabbit Room, a **product freshness judgement about this specific
  room**, not a pre-existing Weasel Room norm and not a universal rule
  this ADR is declaring for every similar room. Re-judged for Weasel Room
  on its own terms: an "empty" report here only ever means "someone just
  confirmed nobody is here," and the sign-up process is identical to
  Otter Room's and Rabbit Room's own — a resident finding the room empty
  and unreserved may walk in and register their own time on the spot,
  with no report of its own marking the moment this happens. This ADR
  judges that Weasel Room's own volatility calls for the same 15-minute
  figure — a fresh product decision for this room that happens to agree
  with Otter Room's and Rabbit Room's, not a transferred rule.

Weasel Room sits in the same position as Otter Room and Rabbit Room
relative to Laundry's dryer: a resident **may** optionally carry over a
time written on the door's sign-up sheet as `expectedEndAt`, a real but
only sometimes available signal, never fabricated by the app
(`CLAUDE.md`). The 4-hour ceiling is a second, independent fact that
applies **whether or not** a resident supplied an estimate — and, per the
rule ADR 0004 added to `CLAUDE.md` specifically to prevent this mistake,
this is **not** the Laundry dryer's if/else fallback shape (exact signal,
else a provisional placeholder). It is one real ceiling that always
applies, optionally sharpened by a tighter resident estimate — confirmed
to still hold for this room, not re-argued from scratch, since ADR 0004
already settled *why* that shape is correct for this kind of field.

**Decided formula**, evaluated lazily on every ordinary read (never a
timer, never an SSE connection event):

- `occupancy: "empty"` expires to `unknown` **15 minutes** after
  `confirmedAt`.
- `occupancy: "occupied"`, no `expectedEndAt`: expires to `unknown` **4
  hours** after `confirmedAt`.
- `occupancy: "occupied"`, `expectedEndAt` present: expires to `unknown`
  at **`min(expectedEndAt, confirmedAt + 4h)`** — whichever comes first.
  A resident's own estimate can end the report *earlier* than the
  4-hour ceiling, but can never extend it *past* the ceiling.

**Neither number is provisional** in the sense `CLAUDE.md` uses that word
for `UNTIMED_IN_USE_DECAY_MS`. As with Otter Room and Rabbit Room, the
code comments on `WEASEL_ROOM_MAX_OCCUPIED_MS` and
`WEASEL_ROOM_EMPTY_DECAY_MS` must say what each actually is, distinctly:
the 4-hour figure as a settled fact about how this room is used, the
15-minute figure as a settled product freshness judgement — not identical
language implying both are the same kind of settled.

**Enforced on the write path too, not only at decay time.** A `PATCH`
reporting `occupancy: "occupied"` with an `expectedEndAt` is only valid
when

```
now < expectedEndAt <= now + 4h
```

evaluated against the request's own server-side `now`. Both ends are
rejected `400`, not clamped — an end time already in the past isn't an
estimate of anything, and a resident's own estimate can narrow the
ceiling, never extend past it. This mirrors Otter Room's and Rabbit
Room's own write-path enforcement (ADR 0004/0005, Decision 2) exactly,
for the same reason: the 4-hour figure is a real constraint on what a
report may claim, not merely a cap on how long a claim is believed after
the fact.

**`expectedEndAt` is per-observation, never inherited across reports** —
the same discipline Otter Room and Rabbit Room both established, carried
through unchanged: every `PATCH` fully determines the next stored
`expected_end_at` from scratch. An `occupied` report that omits
`expectedEndAt` stores `NULL`, even if the row being overwritten currently
holds a value from an earlier report; an `empty` report always stores
`NULL`. A resident who doesn't provide an end time is not implicitly
re-asserting whatever the last person guessed — they're making a new
observation that happens to carry no estimate.

## Decision 3 — no `activities`, no headcount, no booking calendar, no instrument-appliance status

Restated plainly, since each is a real alternative this ADR is rejecting:

- **No activity taxonomy.** See Decision 1 — rejected on Weasel Room's
  own stated terms (the brief itself says which instrument has no
  decision-relevant value), not merely because Otter Room also lacks one.
- **No headcount field.** The room's described furniture (two ordinary
  chairs, a keyboard with its own bench) implies a small capacity, but no
  figure was given and the app does not need one. The 3D scene's figures
  (Mechanics, once built) are decorative, never a real headcount, the
  same rule every other facility's figures already follow.
- **No booking/reservation persistence.** The paper sign-up sheet is a
  real-world artifact this app does not digitize, exactly as for Otter
  Room and Rabbit Room. `occupancy`/`expectedEndAt` describe the room's
  state *right now*, not a schedule of future or past uses.
- **No instrument-appliance status.** The guitar, the keyboard, and the
  heater are named as real furniture this room has, the same way AA
  Room's pool table, Otter Room's heater, and Rabbit Room's kitchen
  appliances are — but nothing in the given facts asks whether any of
  them is in tune, working, or available. Naming this directly, not just
  omitting it, for the same reason ADR 0005 named Rabbit Room's kitchen
  appliances: a room with named physical instruments is exactly the kind
  of facility where "is the guitar in good condition" could otherwise
  creep in unnoticed as a plausible-sounding addition nobody actually
  asked for.

## Decision 4 — inherited house-wide rules, not re-litigated here

The following apply to Weasel Room exactly as already decided for
Laundry, AA Room, Otter Room, and Rabbit Room, and this ADR does not
reopen them:

- **identity**: the actor is the server-resolved session
  (`sessions.id`/pseudonym), never a client-supplied field — ADR 0002,
  unchanged.
- **concurrency**: optimistic concurrency via `version`/`ifVersion`, `409`
  with current canonical state on a stale write — ADR 0001, Decision 2,
  unchanged. Weasel Room's row gets its own `version` column, starting at
  1, under the exact same rules `CLAUDE.md` already states.
- **decay trigger**: lazy, read-triggered only — never a timer, never an
  SSE connection event. Decision 2 above only changes *what* decays and
  *how long it takes*, never *when* decay is evaluated.
- **transport**: the one existing SSE connection
  (`GET /api/stream`, `src/lib/realtime.ts`) carries Weasel Room's
  updates too — no second `EventSource`, no second subscriber list.
  `BroadcastPayload` gains a fifth variant, `{ kind: "weasel-room"; room:
  WeaselRoomState }`, and `src/pages/api/stream.ts` dispatches a fifth
  named SSE event, `event: weasel-room`, over the same connection.
- **logging**: every Weasel Room report attempt — accepted or rejected —
  gets a `[toadlive]` log line in `src/lib/log.ts`'s existing format,
  naming the actor pseudonym, outcome, and resulting state, mirroring
  `formatRabbitRoomReportOutcome`/`formatRabbitRoomReportRejected`.
- **no client-asserted identity**: a request body naming an actor for a
  Weasel Room report is rejected exactly like elsewhere — `400`, not
  silently dropped.
- **freshness display**: Laundry's plain "confirmed N minutes ago" label,
  not AA Room's derived `fresh`/`stale`/`null` three-way split. Weasel
  Room's `WeaselRoomState` has **no `freshness` field**, same as Otter
  Room's and Rabbit Room's — `confirmedAt` alone is enough for the UI to
  compute the same plain elapsed-time label.

## Mechanics (data model and API only — 3D is explicitly deferred)

**Schema** — `weasel_room`, a single row (no sub-locations), same shape
as `otter_room`/`rabbit_room`:

```sql
CREATE TABLE IF NOT EXISTS weasel_room (
  id              TEXT PRIMARY KEY DEFAULT 'weasel-room',
  occupancy       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  expected_end_at INTEGER,
  confirmed_at    INTEGER,
  reporter_id     TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
```

No `activities` column, no `started_at` column — same reasoning as Otter
Room's and Rabbit Room's schemas. Seeded once: `occupancy = 'unknown'`,
`expected_end_at = NULL`, `confirmed_at = NULL` — never reported yet.

**Types** (`src/lib/types.ts`, additive):

```ts
export type WeaselRoomOccupancy = "empty" | "occupied" | "unknown";
export const VALID_WEASEL_ROOM_OCCUPANCIES: readonly WeaselRoomOccupancy[] = [
  "empty",
  "occupied",
  "unknown",
];

export type ReportableWeaselRoomOccupancy = Extract<WeaselRoomOccupancy, "empty" | "occupied">;
export const VALID_REPORTABLE_WEASEL_ROOM_OCCUPANCIES: readonly ReportableWeaselRoomOccupancy[] = [
  "empty",
  "occupied",
];

export interface WeaselRoomState {
  occupancy: WeaselRoomOccupancy;
  // Only ever non-null alongside occupancy "occupied" — a resident's own
  // carried-over estimate from the door's sign-up sheet. Capped at
  // confirmedAt + 4h on write — see Decision 2.
  expectedEndAt: number | null;
  confirmedAt: number | null;
  version: number;
}
```

No `freshness` field — see Decision 4.

**Decay constants** (beside `OTTER_ROOM_MAX_OCCUPIED_MS`/
`OTTER_ROOM_EMPTY_DECAY_MS` and `RABBIT_ROOM_MAX_OCCUPIED_MS`/
`RABBIT_ROOM_EMPTY_DECAY_MS`, commented per their distinct evidence — see
Decision 2):

```ts
// Real-world community norm (confirmed directly for Weasel Room, the
// same way it was independently confirmed for Otter Room and Rabbit
// Room), not inferred from either of those rooms' own figures — do NOT
// mark this PROVISIONAL.
export const WEASEL_ROOM_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, re-derived for this room's own
// volatility (see Decision 2) — settled, not provisional, but not a
// pre-existing Weasel Room norm either.
export const WEASEL_ROOM_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes
```

**Decay function** — identical shape to `decayedOtterRoom()`/
`decayedRabbitRoom()`:

```ts
function decayedWeaselRoom(row: WeaselRoomRow, now: number, store: WeaselRoomStore): WeaselRoomRow {
  if (row.occupancy === "unknown") return row;

  const expiresAt =
    row.occupancy === "empty"
      ? (row.confirmed_at ?? now) + WEASEL_ROOM_EMPTY_DECAY_MS
      : Math.min(
          row.expected_end_at ?? Infinity,
          (row.confirmed_at ?? now) + WEASEL_ROOM_MAX_OCCUPIED_MS,
        );

  if (now <= expiresAt) return row;

  // ... UPDATE occupancy = 'unknown', expected_end_at = NULL,
  // version = version + 1 WHERE id = ? AND occupancy != 'unknown',
  // broadcast on changes === 1, re-read on changes === 0.
}
```

**API** — mirrors `src/pages/api/rabbit-room.ts`'s shape as a single
fixed resource:

- `GET /api/weasel-room` → the current `WeaselRoomState`, decay applied
  lazily on read.
- `PATCH /api/weasel-room` → body `{ occupancy, expectedEndAt?, ifVersion
  }`, same validation order as Otter Room's and Rabbit Room's routes:
  session required → `occupancy` must be reportable → no
  client-asserted actor field → `empty` requires no `expectedEndAt` →
  `expectedEndAt` (if present) must be a safe positive integer satisfying
  `now < expectedEndAt <= now + WEASEL_ROOM_MAX_OCCUPIED_MS` → `ifVersion`
  validated. A stale `ifVersion` → `409` with the current canonical
  state.

**SSE** — `event: weasel-room`, fifth named event on the existing
stream, per Decision 4.

**Logging** — `formatWeaselRoomReportOutcome`/
`formatWeaselRoomReportRejected` in `src/lib/log.ts`, same shape as the
Rabbit Room pair, naming `facility: "weasel-room"`.

## Consequences

Weasel Room gets its own table, route, and SSE event name, same pattern
as every prior facility — a fifth state shape to keep in sync with the
server. Because its shape is structurally identical to `RabbitRoomState`/
`OtterRoomState`, the panel's rendering code can likely be generalized
further rather than copied a fourth time — a refactor to consider at
implementation time, not decided here (the same "not yet, cost exceeds
benefit for now" call `PROCESS.md` records for Otter Room and Rabbit
Room). Choosing not to record which instrument is in use is a deliberate
information loss accepted for this room, the same kind of choice AA
Room's single-activity v1 once made for a different reason — if that ever
needs to change, it's a new decision with its own ADR, not a default this
one quietly assumes.

## Verification

Mirroring ADR 0004/0005's own verification plans, and now their actual
execution for Weasel Room:

- **automated — 32 new tests, 180/180 total across the suite.**
  `spec/weasel-room.test.ts` (18 tests): HTTP-level persistence; `GET`
  shape confirming no `freshness`/`activities` field; occupied with and
  without `expectedEndAt`; empty always clearing `expectedEndAt`;
  per-observation non-inheritance; rejection of `expectedEndAt` alongside
  `empty`; rejection beyond the 4-hour ceiling and at-or-before `now`;
  rejection of `occupancy: "unknown"` as a reported value; rejection of a
  non-integer `ifVersion`; a stale `ifVersion` returning `409` with
  current canonical state and no mutation; `401` with no session; `400` on
  a client-asserted actor field; SSE coverage confirming an already-open
  stream receives `event: weasel-room` on both an accepted report and not
  on a `409`/`400`. `spec/weasel-room-decay.test.ts` (14 tests):
  store-level coverage of fresh-seed and idempotent-seed behavior; `empty`
  staying put within 15 minutes and decaying past it; `occupied` with no
  `expectedEndAt` staying put within 4 hours and decaying past it;
  `occupied` with `expectedEndAt` decaying at the estimate, never at the
  4-hour mark, when the estimate is earlier; the 4-hour ceiling capping an
  estimate that would otherwise run longer; non-inheritance enforced at
  the store layer independent of the API route; a decay transition
  broadcasting exactly once and not broadcasting when nothing is stale; a
  stale `ifVersion` write rejected with no mutation and no broadcast.
  `weasel-room.ts`/`weasel-room-db.ts` followed the same pure-store-logic
  plus production-wiring split `91167bd` established for AA/Otter/Rabbit
  Room from the start (see `PROCESS.md`), so adding this fourth
  `*-decay.test.ts` file did not reintroduce the SQLite-lock race that
  split was built to eliminate — confirmed by running all four decay spec
  files (`aa-room-decay`, `otter-room-decay`, `rabbit-room-decay`,
  `weasel-room-decay`) together, in parallel, repeatedly, with zero
  `database is locked` errors. Running the full suite also caught and
  fixed, for a second time, a stale assumption in
  `spec/aa-room.test.ts`'s SSE test helper — it had already been patched
  once for Rabbit Room's arrival by enumerating sibling event names, which
  broke the same way again once Weasel Room added a fifth; this time
  fixed generically (skip anything that isn't `event: aa-room`, rather
  than naming every sibling), so no future facility's arrival requires
  editing this helper again — see `PROCESS.md`.
- **manual, real browser — practical panel.** Two independent browser
  sessions against the dev server confirmed a report in one reaches the
  other within about a second with no reload, and that each session's
  initial `GET` reflects the other's last report correctly; Empty/Occupied
  toggling with and without a minutes estimate was exercised directly
  through the form, including the minutes input's 240-minute (4h) cap; a
  forced stale `ifVersion` produced the conflict path in the UI, not a
  silent overwrite; a direct `PATCH` of `occupancy: "unknown"` was
  confirmed rejected `400`, with no UI path ever offering it.
- **manual, real browser — 3D scene, in two stages.** Stage 1 (static
  Empty shell, no figures) was screenshotted and reviewed for room
  structure alone before any occupancy layer was added — see
  `PROCESS.md` for why this was done as its own stage, and for the two
  real rendering bugs (whiteboard z-fighting, a bench visually swallowed
  by the keyboard) a real screenshot caught and this stage fixed before
  review. Stage 2 confirmed, via screenshots and a continuous `occupied →
  empty → occupied → unknown` cycle: Empty shows the static room with no
  figures or props; Occupied shows two neutral seated/standing figures
  with zero residue carried over between cycles; Unknown shows the full
  room structure desaturated and dimmed (confirmed numerically via pixel
  sampling, not just by eye) with no figures; an `expectedEndAt` estimate
  never changes the 3D state beyond plain `occupied` (confirmed
  screenshots with and without an estimate render identically); reduced
  motion was confirmed to render a single static occupied pose, byte-
  identical across a 1.5-second gap, rather than losing state information.
  Facility switching (Laundry → AA Room → Otter Room → Rabbit Room →
  Weasel Room → Laundry) was confirmed to tear down and remount cleanly
  through the existing shared renderer, with zero console/page errors
  throughout.
- **still outstanding:** a post-deploy production smoke check against the
  live Fly URL, the same gate ADR 0004/0005 applied to Otter Room and
  Rabbit Room before moving their status to "verified live." This ADR's
  status does not move to "verified live" until that check actually runs.
