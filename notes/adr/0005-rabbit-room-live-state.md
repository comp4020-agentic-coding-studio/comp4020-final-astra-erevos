# ADR 0005: Rabbit Room's shared live state

**Status**: Implemented and verified locally — production verification
pending. This ADR fixed the state model, statuses, and decay rules for
Toad Live's fourth facility before any schema, API, or UI work began, the
same order ADR 0001/0002/0003/0004 each used (see `PROCESS.md`'s
"Rewritten each time the project's shape genuinely changed" convention).
Backend, practical panel, and 3D scene are all built and locally verified
per the Verification section below; this status moves to "verified live"
only after a post-deploy production smoke check, the same gate ADR 0004
used for Otter Room.

**This ADR's conclusion looks identical to ADR 0004's (Otter Room) — the
same three-value `occupancy`, the same optional `expectedEndAt`, the same
4-hour/15-minute decay shape.** That similarity is a result, not a
starting assumption: every decision below was checked against Rabbit
Room's own real facts independently, the same discipline ADR 0003's
Context section states ("each facility gets its own interrogation against
its own real facts, not a template stamped out from this one"). Where a
rule really does carry over unchanged, this ADR says so and says why
(usually: it's a house-wide contract, not an Otter-Room-specific choice).
Where a rule looks the same but rests on different evidence for this
room, this ADR re-derives it rather than citing ADR 0004 and stopping
there.

## Context

`FINAL_PROJECT_SOURCE_OF_TRUTH.md` §3 names Rabbit Room as a group-study /
shared-meal space holding approximately twelve people. The room itself:
long and narrow; two windows and a whiteboard; two rectangular desks
pushed together down the middle with many chairs around them; a kitchen
area at the far end — stove, sink, microwave, kettle, cabinets. Its two
ordinary uses, group study and shared meals, **typically do not happen at
the same time** — unlike AA Room, where TV/pool/table-tennis genuinely
overlap (ADR 0003's whole reason for `activities`). A paper sign-up sheet
on the door works exactly like Otter Room's: a resident may write an
intended time in advance, or, finding no reservation and nobody present,
use the room and write their own time on the spot. There is no formal
time limit, but residents follow the same community norm Otter Room's own
brief stated: a single use typically does not run past four hours — this
is confirmed as a real fact about Rabbit Room specifically, not assumed
by analogy to Otter Room (see Decision 2).

The deliberate, stated scope boundary (unchanged from
`FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s, `README.md`'s, and ADR 0004's "what
we chose not to build"): Toad Live does not digitize the paper sign-up
sheet, does not build a booking calendar, and does not track a future
reservation. This ADR only concerns the room's **current live state**.

What this ADR does **not** decide: anything about the 3D scene's specific
geometry or animation (the long room, the joined desks, the kitchen
corner, chair/figure placement) — that is implementation, following the
existing `room.ts`/`aa-room.ts`/`otter-room.ts` pattern once the state
shape below exists to drive it, and must not be read backward into a
data-model requirement. Nothing about any facility after Rabbit Room is
decided here either.

## Decision 1 — state model: occupancy only, no activity field

**Rabbit Room's situation is not the same as Otter Room's, even though
the conclusion matches.** Otter Room is genuinely used in different ways
too — someone studying alone, a small group discussing together — but
those different uses have no decision-relevant distinction worth
recording: neither tells a resident checking the app anything they'd act
on differently, so there was never a real reason to name them separately
in the first place. Rabbit Room is a sharper case: group study and shared
meals are two clearly distinct, separately nameable uses, not shades of
the same activity the way Otter Room's are. The reason this still doesn't
need an `activities` field is not "the uses aren't distinct enough to
bother naming" (Otter Room's situation) and not "these activities
genuinely overlap so a single field can't represent them" (AA Room's
reason for needing one) — it's a direct, separate value judgement for
this room: `FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s own brief states plainly
that knowing *which* of the two activities is happening has no
decision-relevant value to a resident checking the app, and the two
activities typically don't happen at the same time, so there is no
"several independent things happening at once" question for a field to
answer either. Both AA Room's model (independent, co-occurring
activities) and the reasoning behind Otter Room's "nothing distinct
enough to name" are the wrong fit here; this room earns its own "no
activity field" conclusion from its own two stated facts — no
decision-relevant value, and no co-occurrence — not by resembling either
precedent.

**Chosen: `occupancy` plus an optional `expectedEndAt`, the same shape
Otter Room uses** — and, more broadly, the same pattern every facility in
this project follows: a required primary state, narrowed by only as much
optional secondary detail as the room's own real facts call for (AA Room
needed `activities` as that detail; Otter Room and Rabbit Room both need
only `expectedEndAt`). A required primary `occupancy`, with one optional
secondary `expectedEndAt` that narrows, never replaces, the primary fact:

- `empty`
- `occupied`
- `unknown`

No `out-of-order`-equivalent status exists for Rabbit Room, same reasoning
as Otter Room and AA Room: nothing in the given facts raises broken
furniture, or a broken stove/microwave/kettle, as a concern within this
facility's current live-state scope. The kitchen appliances are named as
room contents, not as something Toad Live reports the condition of —
see Decision 3.

**`unknown` is not a reportable value**, for the same reason established
by AA Room (ADR 0003, Decision 2) and carried through Otter Room (ADR
0004, Decision 1): a resident's `PATCH` may only set `occupancy` to
`empty` or `occupied`. `unknown` remains part of the stored and public
`RabbitRoomOccupancy` type (seed state, and what decay transitions into —
Decision 2), representing "no sufficiently fresh observation," which only
the absence of a report can produce.

## Decision 2 — decay: a 4-hour hard ceiling on `occupied`, a 15-minute ceiling on `empty`

**The two numbers below are not both the same kind of fact for Rabbit
Room, for the same reason ADR 0004 drew this distinction for Otter
Room — and each must be re-checked on Rabbit Room's own terms, not
assumed to transfer.**

- The **4-hour ceiling** is confirmed as a **real-world, community fact**
  about Rabbit Room specifically: the brief for this facility states
  directly that it follows "the same community habit" Otter Room's own
  norm came from — a single use typically doesn't run past four hours.
  This is not an inference from "Otter Room has this ceiling, and Rabbit
  Room looks similar"; it is a fact given directly about this room,
  independently confirmed, that happens to share its value with Otter
  Room's. Its epistemic status is identical to Otter Room's own 4-hour
  figure (ADR 0004, Decision 2): a fact this ADR is recording, not
  producing.
- The **15-minute `empty` ceiling** is, as it was for Otter Room, a
  **product freshness judgement about this specific room**, not a
  pre-existing Rabbit Room norm and not a universal rule this ADR is
  declaring for every similar room — nothing in the given facts says
  residents already think of an empty-room sighting as expiring after
  fifteen minutes specifically, and this ADR does not claim any other
  facility would have to land on the same number. Re-judged for Rabbit
  Room on its own terms: an "empty" report here only ever means "someone
  just confirmed nobody is here," and Rabbit Room has no fixed schedule —
  a group arriving for a sign-up-sheet session, or the next residents
  simply walking in because the room happened to be free, can fill it
  within minutes with no report of its own to say so. Weighed against
  Rabbit Room's larger capacity (~12 vs. Otter Room's ~6) and different
  shape, this ADR judges that neither changes how quickly an "empty"
  claim here stops being trustworthy, so the same 15-minute figure is
  chosen again — a fresh product decision for this room that happens to
  agree with Otter Room's, not a transferred rule.

Rabbit Room sits in the same position as Otter Room relative to Laundry's
dryer: a resident **may** optionally carry over a time written on the
door's sign-up sheet as `expectedEndAt`, a real but only sometimes
available signal, never fabricated by the app (`CLAUDE.md`). The 4-hour
ceiling is a second, independent fact that applies **whether or not** a
resident supplied an estimate — and, per the rule ADR 0004 added to
`CLAUDE.md` specifically to prevent this mistake, this is **not** the
Laundry dryer's if/else fallback shape (exact signal, else a provisional
placeholder). It is one real ceiling that always applies, optionally
sharpened by a tighter resident estimate — confirmed to still hold for
this room, not re-argued from scratch, since ADR 0004 already settled
*why* that shape is correct for this kind of field.

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
for `UNTIMED_IN_USE_DECAY_MS`. As with Otter Room, the code comments on
`RABBIT_ROOM_MAX_OCCUPIED_MS` and `RABBIT_ROOM_EMPTY_DECAY_MS` must say
what each actually is, distinctly: the 4-hour figure as a settled fact
about how this room is used, the 15-minute figure as a settled product
freshness judgement — not identical language implying both are the same
kind of settled.

**Enforced on the write path too, not only at decay time.** A `PATCH`
reporting `occupancy: "occupied"` with an `expectedEndAt` is only valid
when

```
now < expectedEndAt <= now + 4h
```

evaluated against the request's own server-side `now`. Both ends are
rejected `400`, not clamped — an end time already in the past isn't an
estimate of anything, and a resident's own estimate can narrow the
ceiling, never extend past it. This mirrors Otter Room's own write-path
enforcement (ADR 0004, Decision 2) exactly, for the same reason: the
4-hour figure is a real constraint on what a report may claim, not merely
a cap on how long a claim is believed after the fact.

**`expectedEndAt` is per-observation, never inherited across reports** —
the same discipline Otter Room established (ADR 0004, Decision 2), carried
through unchanged: every `PATCH` fully determines the next stored
`expected_end_at` from scratch. An `occupied` report that omits
`expectedEndAt` stores `NULL`, even if the row being overwritten currently
holds a value from an earlier report; an `empty` report always stores
`NULL`. A resident who doesn't provide an end time is not implicitly
re-asserting whatever the last person guessed — they're making a new
observation that happens to carry no estimate.

## Decision 3 — no `activities`, no headcount, no booking calendar, no kitchen-appliance status

Restated plainly, since each is a real alternative this ADR is rejecting:

- **No activity taxonomy.** See Decision 1 — rejected on its own terms for
  this room (a direct value judgement plus the fact the two activities
  don't co-occur), not merely because Otter Room also lacks one.
- **No headcount field.** `FINAL_PROJECT_SOURCE_OF_TRUTH.md` names
  "approximately twelve people" as the room's real capacity, but the app
  does not need to record how many are actually present. The 3D scene's
  figures (Mechanics, once built) are decorative, never a real headcount,
  the same rule AA Room's and Otter Room's figures already follow.
- **No booking/reservation persistence.** The paper sign-up sheet is a
  real-world artifact this app does not digitize, exactly as for Otter
  Room. `occupancy`/`expectedEndAt` describe the room's state *right
  now*, not a schedule of future or past uses.
- **No kitchen-appliance status.** The stove, sink, microwave, kettle, and
  cabinets are named as real furniture this room has, the same way AA
  Room's pool table and Otter Room's heater are — but nothing in the
  given facts asks whether any of them is in use, working, or available.
  Naming this directly, not just omitting it, because a room with a
  kitchen in it is exactly the kind of facility where "is the stove free"
  could otherwise creep in unnoticed as a plausible-sounding addition
  nobody actually asked for.

## Decision 4 — inherited house-wide rules, not re-litigated here

The following apply to Rabbit Room exactly as already decided for
Laundry, AA Room, and Otter Room, and this ADR does not reopen them:

- **identity**: the actor is the server-resolved session
  (`sessions.id`/pseudonym), never a client-supplied field — ADR 0002,
  unchanged.
- **concurrency**: optimistic concurrency via `version`/`ifVersion`, `409`
  with current canonical state on a stale write — ADR 0001, Decision 2,
  unchanged. Rabbit Room's row gets its own `version` column, starting at
  1, under the exact same rules `CLAUDE.md` already states.
- **decay trigger**: lazy, read-triggered only — never a timer, never an
  SSE connection event. Decision 2 above only changes *what* decays and
  *how long it takes*, never *when* decay is evaluated.
- **transport**: the one existing SSE connection
  (`GET /api/stream`, `src/lib/realtime.ts`) carries Rabbit Room's updates
  too — no second `EventSource`, no second subscriber list.
  `BroadcastPayload` gains a fourth variant, `{ kind: "rabbit-room"; room:
  RabbitRoomState }`, and `src/pages/api/stream.ts` dispatches a fourth
  named SSE event, `event: rabbit-room`, over the same connection.
- **logging**: every Rabbit Room report attempt — accepted or rejected —
  gets a `[toadlive]` log line in `src/lib/log.ts`'s existing format,
  naming the actor pseudonym, outcome, and resulting state, mirroring
  `formatOtterRoomReportOutcome`/`formatOtterRoomReportRejected`.
- **no client-asserted identity**: a request body naming an actor for a
  Rabbit Room report is rejected exactly like elsewhere — `400`, not
  silently dropped.
- **freshness display**: Laundry's plain "confirmed N minutes ago" label,
  not AA Room's derived `fresh`/`stale`/`null` three-way split. Rabbit
  Room's `RabbitRoomState` has **no `freshness` field**, same as Otter
  Room's — `confirmedAt` alone is enough for the UI to compute the same
  plain elapsed-time label.

## Mechanics (data model and API only — 3D is explicitly deferred)

**Schema** — `rabbit_room`, a single row (no sub-locations), same shape
as `otter_room`:

```sql
CREATE TABLE IF NOT EXISTS rabbit_room (
  id              TEXT PRIMARY KEY DEFAULT 'rabbit-room',
  occupancy       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  expected_end_at INTEGER,
  confirmed_at    INTEGER,
  reporter_id     TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
```

No `activities` column, no `started_at` column — same reasoning as Otter
Room's schema. Seeded once: `occupancy = 'unknown'`, `expected_end_at =
NULL`, `confirmed_at = NULL` — never reported yet.

**Types** (`src/lib/types.ts`, additive):

```ts
export type RabbitRoomOccupancy = "empty" | "occupied" | "unknown";
export const VALID_RABBIT_ROOM_OCCUPANCIES: readonly RabbitRoomOccupancy[] = [
  "empty",
  "occupied",
  "unknown",
];

export type ReportableRabbitRoomOccupancy = Extract<RabbitRoomOccupancy, "empty" | "occupied">;
export const VALID_REPORTABLE_RABBIT_ROOM_OCCUPANCIES: readonly ReportableRabbitRoomOccupancy[] = [
  "empty",
  "occupied",
];

export interface RabbitRoomState {
  occupancy: RabbitRoomOccupancy;
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
`OTTER_ROOM_EMPTY_DECAY_MS`, commented per their distinct evidence — see
Decision 2):

```ts
// Real-world community norm (FINAL_PROJECT_SOURCE_OF_TRUTH.md), confirmed
// for Rabbit Room specifically, not inferred from Otter Room's own figure
// — do NOT mark this PROVISIONAL.
export const RABBIT_ROOM_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, re-derived for this room's own
// volatility (see Decision 2) — settled, not provisional, but not a
// pre-existing Rabbit Room norm either.
export const RABBIT_ROOM_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes
```

**Decay function** — identical shape to `decayedOtterRoom()`:

```ts
function decayedRabbitRoom(row: RabbitRoomRow, now: number, store: RabbitRoomStore): RabbitRoomRow {
  if (row.occupancy === "unknown") return row;

  const expiresAt =
    row.occupancy === "empty"
      ? (row.confirmed_at ?? now) + RABBIT_ROOM_EMPTY_DECAY_MS
      : Math.min(
          row.expected_end_at ?? Infinity,
          (row.confirmed_at ?? now) + RABBIT_ROOM_MAX_OCCUPIED_MS,
        );

  if (now <= expiresAt) return row;

  // ... UPDATE occupancy = 'unknown', expected_end_at = NULL,
  // version = version + 1 WHERE id = ? AND occupancy != 'unknown',
  // broadcast on changes === 1, re-read on changes === 0.
}
```

**API** — mirrors `src/pages/api/otter-room.ts`'s shape as a single fixed
resource:

- `GET /api/rabbit-room` → the current `RabbitRoomState`, decay applied
  lazily on read.
- `PATCH /api/rabbit-room` → body `{ occupancy, expectedEndAt?, ifVersion
  }`, same validation order as Otter Room's route: session required →
  `occupancy` must be reportable → no client-asserted actor field →
  `empty` requires no `expectedEndAt` → `expectedEndAt` (if present) must
  be a safe positive integer satisfying `now < expectedEndAt <= now +
  RABBIT_ROOM_MAX_OCCUPIED_MS` → `ifVersion` validated. A stale
  `ifVersion` → `409` with the current canonical state.

**SSE** — `event: rabbit-room`, fourth named event on the existing
stream, per Decision 4.

**Logging** — `formatRabbitRoomReportOutcome`/
`formatRabbitRoomReportRejected` in `src/lib/log.ts`, same shape as the
Otter Room pair, naming `facility: "rabbit-room"`.

## Consequences

Rabbit Room gets its own table, route, and SSE event name, same pattern
as Otter Room — a fourth state shape to keep in sync with the server.
Because its shape is structurally identical to `OtterRoomState`
(`occupancy`/`expectedEndAt`/`confirmedAt`/`version`), the panel's
rendering code can likely be generalized across both facilities rather
than copied a third time — a refactor to consider at implementation time,
not decided here. The 15-minute `empty` decay means Rabbit Room's
`unknown` state will appear often, for the same reason it does for Otter
Room — judged correct given the room's real volatility, not a flaw to
tune away. Choosing not to record which of the two real activities is
happening is a deliberate information loss accepted for this room,
exactly as AA Room's single-activity v1 once was for a different reason —
if Rabbit Room's actual use ever turns out to need that distinction
(e.g. residents routinely needing to know specifically whether food is
involved), that would be a new decision with its own ADR, not a default
this one quietly assumes.

## Verification (run; see status line for what's still outstanding)

Mirroring ADR 0004's own verification plan, and now its actual execution
for Rabbit Room:

- **automated — 32 new tests, 148/148 total across the suite.**
  `spec/rabbit-room.test.ts` (18 tests): HTTP-level persistence; `GET`
  shape confirming no `freshness`/`activities` field; occupied with and
  without `expectedEndAt`; empty always clearing `expectedEndAt`;
  per-observation non-inheritance; rejection of `expectedEndAt` alongside
  `empty`; rejection beyond the 4-hour ceiling and at-or-before `now`;
  rejection of `occupancy: "unknown"` as a reported value; rejection of a
  non-integer `ifVersion`; a stale `ifVersion` returning `409` with
  current canonical state and no mutation; `401` with no session; `400` on
  a client-asserted actor field; SSE coverage confirming an already-open
  stream receives `event: rabbit-room` on both an accepted report and
  not on a `409`/`400`. `spec/rabbit-room-decay.test.ts` (14 tests):
  store-level coverage of fresh-seed and idempotent-seed behavior; `empty`
  staying put within 15 minutes and decaying past it; `occupied` with no
  `expectedEndAt` staying put within 4 hours and decaying past it;
  `occupied` with `expectedEndAt` decaying at the estimate, never at the
  4-hour mark, when the estimate is earlier; the 4-hour ceiling capping an
  estimate that would otherwise run longer; non-inheritance enforced at
  the store layer independent of the API route; a decay transition
  broadcasting exactly once and not broadcasting when nothing is stale;
  a stale `ifVersion` write rejected with no mutation and no broadcast.
  Running the full suite also caught and fixed a stale assumption in
  `spec/aa-room.test.ts`'s SSE test helper (it assumed any event on the
  shared stream that wasn't `machine` or `otter-room` must be `aa-room`) —
  see `PROCESS.md`.
- **manual, real browser — practical panel.** Two independent browser
  sessions against the dev server confirmed a report in one reaches the
  other within about a second with no reload; Empty/Occupied toggling
  with and without a minutes estimate was exercised directly through the
  form, including the minutes input's 240-minute (4h) cap; a forced stale
  `ifVersion` produced the conflict path in the UI, not a silent
  overwrite.
- **manual, real browser — 3D scene, in two stages.** Stage 1 (static
  Empty shell, no figures) was screenshotted and reviewed for room
  structure alone before any occupancy layer was added — see
  `PROCESS.md` for why this was done as its own stage. Stage 2 confirmed,
  via screenshots and a continuous `occupied → empty → occupied →
  unknown` cycle: Empty shows the static room with no figures or props;
  Occupied shows a small fixed set of neutral seated/standing figures with
  zero residue carried over between cycles; Unknown shows the full room
  structure desaturated and dimmed (confirmed numerically via pixel
  sampling, not just by eye) with no figures; an `expectedEndAt` estimate
  never changes the 3D state beyond plain `occupied`; reduced motion was
  confirmed to still render a static occupied pose rather than losing
  state information. Facility switching (Laundry → AA Room → Otter Room →
  Rabbit Room → Laundry) was confirmed to tear down and remount cleanly
  through the existing shared renderer, with zero console/page errors
  throughout.
- **still outstanding:** a post-deploy production smoke check against the
  live Fly URL, the same gate ADR 0004 applied to Otter Room before moving
  its status to "verified live." This ADR's status does not move to
  "verified live" until that check actually runs.
