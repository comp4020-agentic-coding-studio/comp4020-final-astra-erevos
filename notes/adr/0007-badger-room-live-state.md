# ADR 0007: Badger Room's shared live state

**Status**: Decided — not yet implemented. This ADR fixes the state
model, statuses, and decay rules for Toad Live's sixth facility before
any schema, API, or UI work begins, the same order ADR
0001/0002/0003/0004/0005/0006 each used (see `PROCESS.md`'s "Rewritten
each time the project's shape genuinely changed" convention).

**This ADR's conclusion looks identical to ADR 0004's (Otter Room), ADR
0005's (Rabbit Room), and ADR 0006's (Weasel Room) — the same
`occupancy`/`expectedEndAt` shape, the same 4-hour/15-minute decay
shape.** That match is a result of checking Badger Room's own stated
facts independently, not a starting assumption. Badger Room is in fact
the sharpest test yet of whether this shape still holds: it has more
distinct, formally-named uses than any prior room, and — unlike every
prior room — it is explicitly *not* frequently used. Both facts are
checked on their own terms below (Decision 1 and Decision 2
respectively), and neither changes the conclusion, but for reasons this
ADR states directly rather than by resemblance to ADR 0004/0005/0006.

## Context

`FINAL_PROJECT_SOURCE_OF_TRUTH.md` §3 names Badger Room as a formal
meeting/interview room, also used for special study and organised
activities (e.g. "Toad's Table") — explicitly not an ordinary casual
gathering room the way AA Room is. The room itself: large, roughly
square. Thought of as four quadrants: a large conference table with
seating for roughly ten occupies one quadrant; a piano against one wall
and a large wall-mounted TV against an adjoining wall occupy a second;
several sofa groupings line the walls of the remaining two; the door sits
on the south wall, toward the quadrant with the sofas. No window,
whiteboard, heater, or other fixture was given, and none is assumed here
— see the note at the end of this section.

A paper sign-up sheet on the door works exactly like Otter Room's,
Rabbit Room's, and Weasel Room's: a resident may write an intended time
in advance, or, finding no reservation and nobody present, use the room
and write their own time on the spot. Unlike those three rooms, Badger
Room is **not frequently booked** — this is a real, stated fact about
this room specifically, not an assumption, and it is the one piece of
evidence that makes this room's re-derivation genuinely different from
its predecessors' (see Decision 2). There is no formal time limit, but
residents follow the same community norm the three prior rooms'
own briefs stated: a single use typically does not run past four hours
— confirmed as a real fact about Badger Room specifically, not assumed
by analogy (see Decision 2).

The deliberate, stated scope boundary (unchanged from
`FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s, `README.md`'s, and ADR
0004/0005/0006's "what we chose not to build"): Toad Live does not
digitize the paper sign-up sheet, does not build a booking calendar, and
does not track a future reservation. This ADR only concerns the room's
**current live state**.

**What is not given, and this ADR will not guess:** no window,
whiteboard, heater, or other fixture beyond the conference table and its
seating, the piano, the TV, and the sofas was stated. This ADR does not
invent one. The room's quadrant layout is recorded here only as a fact
useful to a later 3D implementation stage — it is explicitly **not**
read backward into any requirement in Decision 1 through 3 below;
nothing about where furniture sits in the room changes what state Toad
Live tracks.

What this ADR does **not** decide: anything about the 3D scene's
specific geometry or animation (the quadrant layout, the conference
table, the piano, the TV, the sofas) — that is implementation, following
the existing `room.ts`/`aa-room.ts`/`otter-room.ts`/`rabbit-room.ts`/
`weasel-room.ts` pattern once the state shape below exists to drive it.
Nothing about any facility after Badger Room is decided here either.

## Decision 1 — state model: occupancy only, no activity field

**Badger Room has several clearly distinct, separately nameable uses —
formal meetings, interviews, special study, and organised activities
like Toad's Table are each a real, different thing.** The test is the
same one every prior ADR applied, re-checked on this room's own terms:
does knowing *which* of these is happening tell a resident checking the
app anything they would act on differently? It does not. A resident
deciding whether to walk by only needs "is it in use right now" — and if
anything, the *formal* character of these uses (an interview, a formal
meeting) makes a resident even less inclined to treat "which one" as
useful information than a casual room would, since none of these uses
invites a passerby to join or peek in regardless of which one is
underway. `FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s own brief for this room
never asks which of Badger Room's uses is active — only whether the room
is available.

This also is not AA Room's situation (ADR 0003): AA Room's `activities`
exist because its real uses genuinely **co-occur** — someone watching TV
while others play pool, at the same time, in the same room. Nothing in
Badger Room's brief suggests an interview and a formal meeting happen
simultaneously in the same room; its one piano and one TV are named as
furniture a single occupying party might use, not as independent,
concurrently-active zones the way AA Room's pool table and TV are. There
is no "several things happening at once" question here for a field to
answer.

**Chosen: `occupancy` plus an optional `expectedEndAt`** — the same
required-primary-plus-optional-secondary pattern every facility in this
project follows, landed on independently for this room from its own
stated facts:

- `empty`
- `occupied`
- `unknown`

No `out-of-order`-equivalent status exists for Badger Room, same
reasoning as every prior facility: nothing in the given facts raises a
broken table, a broken piano, or a broken TV as a concern within this
facility's current live-state scope. The piano and the TV are named as
room contents, not as something Toad Live reports the condition of —
see Decision 3.

**`unknown` is not a reportable value**, for the same reason established
by AA Room (ADR 0003, Decision 2) and carried through every subsequent
facility (ADR 0004/0005/0006, Decision 1): a resident's `PATCH` may only
set `occupancy` to `empty` or `occupied`. `unknown` remains part of the
stored and public `BadgerRoomOccupancy` type (seed state, and what decay
transitions into — Decision 2), representing "no sufficiently fresh
observation," which only the absence of a report can produce.

## Decision 2 — decay: a 4-hour hard ceiling on `occupied`, a 15-minute ceiling on `empty`

**The two numbers below rest on different kinds of evidence, and one of
them required genuinely new reasoning for this room, not a restatement
of Otter/Rabbit/Weasel's.**

- The **4-hour ceiling** is confirmed as a **real-world, community fact**
  about Badger Room specifically: residents follow the same community
  norm stated for Otter Room, Rabbit Room, and Weasel Room — a single use
  typically doesn't run past four hours — and this has been confirmed as
  true of Badger Room's own uses as well, not inferred from "the other
  three rooms have this ceiling, so Badger Room probably does too." It is
  a fact about this room, given directly and confirmed on its own terms,
  that happens to share its value with the three prior rooms' own
  four-hour figures. Its epistemic status is identical to theirs (ADR
  0004/0005/0006, each Decision 2): a fact this ADR is recording, not
  producing, and not a universal rule this ADR is declaring for every
  future room — Badger Room's four hours is its own independently
  confirmed fact.
- The **15-minute `empty` ceiling** required actually re-examining the
  reasoning, not just the number, because Badger Room's own stated facts
  include something none of Otter Room's, Rabbit Room's, or Weasel
  Room's briefs did: this room is **not frequently booked**. Each prior
  room's own 15-minute figure (ADR 0004/0005/0006, each Decision 2) was
  reached from that room's *own* observation-volatility reasoning, not
  from one shared universal argument — but Badger Room cannot simply
  carry any of those forward unexamined, because "not frequently booked"
  is a genuinely different fact than any of those rooms stated about
  themselves, and this ADR has to judge what that fact actually implies
  here rather than assume it implies nothing.

  Re-derived on Badger Room's own terms: low booking frequency is
  evidence about the room's **prior probability of being occupied at any
  given moment** — it says a passerby is less likely, on average, to find
  Badger Room in use. It does not, by itself, determine **how long one
  point-in-time "confirmed empty" observation should remain
  authoritative**, because those are different questions. Badger Room
  uses the same paper sign-up/walk-in mechanism as every other room with
  a sign-up sheet, so the room's actual state can change with no Toad
  Live report of its own to say so, independent of how often the room is
  booked in aggregate — an "empty" report here still only ever means
  "someone just confirmed nobody is here *right now*," and low aggregate
  booking frequency doesn't make that moment-in-time claim durable for
  longer on its own. On this basis, this ADR reaches its own product
  freshness judgement for Badger Room and lands on the same 15-minute
  figure — reasoned through independently, not carried over from any
  prior room's own argument.

Badger Room sits in the same position as Otter Room, Rabbit Room, and
Weasel Room relative to Laundry's dryer: a resident **may** optionally
carry over a time written on the door's sign-up sheet as `expectedEndAt`,
a real but only sometimes available signal, never fabricated by the app
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
for `UNTIMED_IN_USE_DECAY_MS`. As with every prior room, the code
comments on `BADGER_ROOM_MAX_OCCUPIED_MS` and
`BADGER_ROOM_EMPTY_DECAY_MS` must say what each actually is, distinctly:
the 4-hour figure as a settled fact about how this room is used, the
15-minute figure as a settled product freshness judgement reached by this
room's own reasoning about report volatility — not identical language
implying both are the same kind of settled, and not a comment implying
the 15-minute figure was carried over from a frequently-used room's
argument.

**Enforced on the write path too, not only at decay time.** A `PATCH`
reporting `occupancy: "occupied"` with an `expectedEndAt` is only valid
when

```
now < expectedEndAt <= now + 4h
```

evaluated against the request's own server-side `now`. Both ends are
rejected `400`, not clamped — an end time already in the past isn't an
estimate of anything, and a resident's own estimate can narrow the
ceiling, never extend past it. This mirrors Otter Room's, Rabbit Room's,
and Weasel Room's own write-path enforcement (ADR 0004/0005/0006,
Decision 2) exactly, for the same reason: the 4-hour figure is a real
constraint on what a report may claim, not merely a cap on how long a
claim is believed after the fact.

**`expectedEndAt` is per-observation, never inherited across reports** —
the same discipline every prior room established, carried through
unchanged: every `PATCH` fully determines the next stored
`expected_end_at` from scratch. An `occupied` report that omits
`expectedEndAt` stores `NULL`, even if the row being overwritten currently
holds a value from an earlier report; an `empty` report always stores
`NULL`. A resident who doesn't provide an end time is not implicitly
re-asserting whatever the last person guessed — they're making a new
observation that happens to carry no estimate.

## Decision 3 — no `activities`, no headcount, no booking calendar, no piano/TV status

Restated plainly, since each is a real alternative this ADR is rejecting:

- **No activity taxonomy.** See Decision 1 — rejected on Badger Room's
  own terms (the room's uses, though more numerous and more formally
  distinct than any prior room's, still have no decision-relevant value
  and do not co-occur), not merely because prior rooms also lack one.
- **No headcount field.** The room's described seating (roughly ten at
  the conference table) implies a real capacity, but the app does not
  need to record how many are actually present. The 3D scene's figures
  (Mechanics, once built) are decorative, never a real headcount, the
  same rule every other facility's figures already follow.
- **No booking/reservation persistence.** The formal character of this
  room's uses (interviews, formal meetings) does not change the
  mechanism of reservation: the brief states directly that it uses the
  same paper sign-up sheet as Otter Room, Rabbit Room, and Weasel Room,
  not a scheduling system. This is named directly, not left to be
  assumed, because "formal meeting room" is exactly the kind of framing
  that could otherwise make "shouldn't this have real booking" feel
  self-evidently correct — it isn't, on this room's own stated facts.
  `occupancy`/`expectedEndAt` describe the room's state *right now*, not
  a schedule of future or past uses.
- **No piano/TV status.** The piano and the large TV are named as real
  furniture this room has, the same way Otter Room's heater, Rabbit
  Room's kitchen appliances, and Weasel Room's guitar/keyboard are — but
  nothing in the given facts asks whether either is in use, working, or
  available. Naming this directly, not just omitting it, for the same
  reason ADR 0005 and ADR 0006 named their own rooms' named electronics/
  instruments: a room with two distinct named pieces of equipment is
  exactly the kind of facility where "is the TV on" or "is the piano
  available" could otherwise creep in unnoticed as a plausible-sounding
  addition nobody actually asked for.

## Decision 4 — inherited house-wide rules, not re-litigated here

The following apply to Badger Room exactly as already decided for
Laundry, AA Room, Otter Room, Rabbit Room, and Weasel Room, and this ADR
does not reopen them:

- **identity**: the actor is the server-resolved session
  (`sessions.id`/pseudonym), never a client-supplied field — ADR 0002,
  unchanged.
- **concurrency**: optimistic concurrency via `version`/`ifVersion`, `409`
  with current canonical state on a stale write — ADR 0001, Decision 2,
  unchanged. Badger Room's row gets its own `version` column, starting at
  1, under the exact same rules `CLAUDE.md` already states.
- **decay trigger**: lazy, read-triggered only — never a timer, never an
  SSE connection event. Decision 2 above only changes *what* decays and
  *how long it takes*, never *when* decay is evaluated.
- **transport**: the one existing SSE connection
  (`GET /api/stream`, `src/lib/realtime.ts`) carries Badger Room's
  updates too — no second `EventSource`, no second subscriber list.
  `BroadcastPayload` gains a sixth variant, `{ kind: "badger-room"; room:
  BadgerRoomState }`, and `src/pages/api/stream.ts` dispatches a sixth
  named SSE event, `event: badger-room`, over the same connection.
- **logging**: every Badger Room report attempt — accepted or rejected —
  gets a `[toadlive]` log line in `src/lib/log.ts`'s existing format,
  naming the actor pseudonym, outcome, and resulting state, mirroring
  `formatWeaselRoomReportOutcome`/`formatWeaselRoomReportRejected`.
- **no client-asserted identity**: a request body naming an actor for a
  Badger Room report is rejected exactly like elsewhere — `400`, not
  silently dropped.
- **freshness display**: Laundry's plain "confirmed N minutes ago" label,
  not AA Room's derived `fresh`/`stale`/`null` three-way split. Badger
  Room's `BadgerRoomState` has **no `freshness` field**, same as Otter
  Room's, Rabbit Room's, and Weasel Room's — `confirmedAt` alone is
  enough for the UI to compute the same plain elapsed-time label.

## Mechanics (data model and API only — 3D is explicitly deferred)

**Schema** — `badger_room`, a single row (no sub-locations), same shape
as `otter_room`/`rabbit_room`/`weasel_room`:

```sql
CREATE TABLE IF NOT EXISTS badger_room (
  id              TEXT PRIMARY KEY DEFAULT 'badger-room',
  occupancy       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  expected_end_at INTEGER,
  confirmed_at    INTEGER,
  reporter_id     TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
```

No `activities` column, no `started_at` column — same reasoning as every
prior single-occupancy room's schema. Seeded once: `occupancy =
'unknown'`, `expected_end_at = NULL`, `confirmed_at = NULL` — never
reported yet.

**Types** (`src/lib/types.ts`, additive):

```ts
export type BadgerRoomOccupancy = "empty" | "occupied" | "unknown";
export const VALID_BADGER_ROOM_OCCUPANCIES: readonly BadgerRoomOccupancy[] = [
  "empty",
  "occupied",
  "unknown",
];

export type ReportableBadgerRoomOccupancy = Extract<BadgerRoomOccupancy, "empty" | "occupied">;
export const VALID_REPORTABLE_BADGER_ROOM_OCCUPANCIES: readonly ReportableBadgerRoomOccupancy[] = [
  "empty",
  "occupied",
];

export interface BadgerRoomState {
  occupancy: BadgerRoomOccupancy;
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
`OTTER_ROOM_EMPTY_DECAY_MS`, `RABBIT_ROOM_MAX_OCCUPIED_MS`/
`RABBIT_ROOM_EMPTY_DECAY_MS`, and `WEASEL_ROOM_MAX_OCCUPIED_MS`/
`WEASEL_ROOM_EMPTY_DECAY_MS`, commented per their distinct evidence — see
Decision 2):

```ts
// Real-world community norm (confirmed directly for Badger Room, the
// same way it was independently confirmed for Otter Room, Rabbit Room,
// and Weasel Room), not inferred from any of those rooms' own figures —
// do NOT mark this PROVISIONAL.
export const BADGER_ROOM_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, independently re-derived for this
// room (see Decision 2) — settled, not provisional. This room is
// explicitly NOT frequently booked, a different fact than any prior
// room's own brief stated, so this number was reasoned through fresh
// rather than carried over: low booking frequency bears on prior
// occupancy probability, not on how long one "confirmed empty" sighting
// stays authoritative for a room with no fixed schedule — see Decision
// 2's full reasoning before assuming this constant can be copied again.
export const BADGER_ROOM_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes
```

**Decay function** — identical shape to `decayedOtterRoom()`/
`decayedRabbitRoom()`/`decayedWeaselRoom()`:

```ts
function decayedBadgerRoom(row: BadgerRoomRow, now: number, store: BadgerRoomStore): BadgerRoomRow {
  if (row.occupancy === "unknown") return row;

  const expiresAt =
    row.occupancy === "empty"
      ? (row.confirmed_at ?? now) + BADGER_ROOM_EMPTY_DECAY_MS
      : Math.min(
          row.expected_end_at ?? Infinity,
          (row.confirmed_at ?? now) + BADGER_ROOM_MAX_OCCUPIED_MS,
        );

  if (now <= expiresAt) return row;

  // ... UPDATE occupancy = 'unknown', expected_end_at = NULL,
  // version = version + 1 WHERE id = ? AND occupancy != 'unknown',
  // broadcast on changes === 1, re-read on changes === 0.
}
```

**API** — mirrors `src/pages/api/weasel-room.ts`'s shape as a single
fixed resource:

- `GET /api/badger-room` → the current `BadgerRoomState`, decay applied
  lazily on read.
- `PATCH /api/badger-room` → body `{ occupancy, expectedEndAt?, ifVersion
  }`, same validation order as Otter Room's, Rabbit Room's, and Weasel
  Room's routes: session required → `occupancy` must be reportable → no
  client-asserted actor field → `empty` requires no `expectedEndAt` →
  `expectedEndAt` (if present) must be a safe positive integer satisfying
  `now < expectedEndAt <= now + BADGER_ROOM_MAX_OCCUPIED_MS` → `ifVersion`
  validated. A stale `ifVersion` → `409` with the current canonical
  state.

**SSE** — `event: badger-room`, sixth named event on the existing
stream, per Decision 4.

**Logging** — `formatBadgerRoomReportOutcome`/
`formatBadgerRoomReportRejected` in `src/lib/log.ts`, same shape as the
Weasel Room pair, naming `facility: "badger-room"`.

## Consequences

Badger Room gets its own table, route, and SSE event name, same pattern
as every prior facility — a sixth state shape to keep in sync with the
server. Because its shape is structurally identical to `WeaselRoomState`/
`RabbitRoomState`/`OtterRoomState`, the panel's rendering code can likely
be generalized further rather than copied a fifth time — a refactor to
consider at implementation time, not decided here (the same "not yet,
cost exceeds benefit for now" call `PROCESS.md` records for every prior
pair of these rooms). Choosing not to record which of Badger Room's
several real uses is happening is a deliberate information loss accepted
for this room, the same kind of choice AA Room's single-activity v1 once
made for a different reason — if that ever needs to change, it's a new
decision with its own ADR, not a default this one quietly assumes.

**The 15-minute `empty` figure rests on its own argument for this room,
which is worth remembering if a future agent revisits it.** Unlike every
prior room, Badger Room's own figure had to answer a real objection its
"not frequently booked" fact raises — this ADR's position is that low
booking frequency bears on prior occupancy probability, not on how long
one point-in-time empty observation stays authoritative. If real usage
data ever shows Badger Room's infrequent bookings actually do make empty
reports trustworthy for longer, that would be a new decision with its own
evidence — not something this ADR's current reasoning already accounts
for.

## Verification plan (not yet run — nothing is implemented)

Mirroring ADR 0004/0005/0006's own verification plans:

- automated: a persistence test; `ifVersion`/409 conflict coverage; a
  `PATCH` rejection test for `occupancy: "unknown"`; rejection tests for
  `expectedEndAt` beyond 4 hours and at-or-before `now`; a rejection test
  for `expectedEndAt` alongside `occupancy: "empty"`; a no-inheritance
  test; unit tests for the decay function's three branches against
  constructed timestamps, following
  `spec/weasel-room-decay.test.ts`'s throwaway-database technique;
  identity/permission tests; an SSE test confirming an already-open
  stream receives `event: badger-room`.
- manual, real browser: the same Playwright-based verification Otter
  Room's, Rabbit Room's, and Weasel Room's backend/panel/3D stages each
  used, including a post-deploy production smoke check before this ADR's
  status moves to "verified live."
