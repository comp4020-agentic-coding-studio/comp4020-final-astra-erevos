# ADR 0008: Rat Room's shared live state

**Status**: Decided — not yet implemented. This ADR fixes the state
model, statuses, and decay rules for Toad Live's seventh facility before
any schema, API, or UI work begins, the same order ADR
0001/0002/0003/0004/0005/0006/0007 each used (see `PROCESS.md`'s
"Rewritten each time the project's shape genuinely changed" convention).

**This ADR's conclusion looks structurally different from every room ADR
since AA Room (0003–0007), and that difference is the point.** Otter
Room, Rabbit Room, Weasel Room, and Badger Room are each a single shared
space with one occupancy fact — "is the room in use right now." Rat
Room's own stated facts ask a different question: not "is the room in
use," but **"how many of its ~10 seats are free right now."** That is
not a wording difference — it changes which resource this ADR's state
model actually attaches to. Resolved below (Decision 1) by re-deriving
from Rat Room's own facts, not by assuming the five-room pattern
automatically extends to a sixth live-state facility.

## Context

`FINAL_PROJECT_SOURCE_OF_TRUTH.md` §3 names Rat Room as a computer room —
computers and printing, primarily a study space. The real brief given for
this ADR adds the facts §3 doesn't yet carry: a horizontal (wide,
shallow) rectangular room; the door in the bottom-left corner; a printer
in the top-left corner; desks running along most of the remaining walls,
holding **approximately ten computers, corresponding to approximately
ten usable seats**; no window; no other confirmed furniture. No
reservation exists at all — not even a paper sign-up sheet the way
Otter/Rabbit/Weasel/Badger Room each have on their doors. A resident
simply walks in and finds an empty seat. The printer itself needs no
queue — nothing about it asks Toad Live to track availability or status
for it.

**Two distinct claims, kept deliberately separate rather than
conflated:** the *real-world observation* given for this room is
approximately ten computers, corresponding to approximately ten usable
seats — not the same exact, physically-recounted certainty `CLAUDE.md`
states for Laundry's five locations and ten machines. Separately, this
ADR makes its own **explicit product-model decision**: Toad Live models
**exactly ten fixed, reportable seat slots, labeled A through J**,
regardless of whether the room's real furniture count is exactly ten,
nine, or eleven on any given physical recount. This is not this ADR
claiming the physical inventory has been precisely verified — it hasn't,
and this ADR does not pretend otherwise. It is this ADR deciding that
"approximately ten" is close enough, and the ten-seat model useful
enough, that the product commits to a fixed ten-slot shape now rather
than leaving the seed data open pending a more exact physical count.
Seed data may be built directly against A–J on that basis — this is a
decision already made, not an open implementation blocker waiting on a
future recount.

**The deliberate, stated scope boundary** (unchanged from every prior
room ADR's own "what we chose not to build"): Toad Live does not digitize
a reservation mechanism and does not track printer availability or a
print queue. This ADR only concerns the room's **current live state** —
specifically, which of its seats are currently free.

What this ADR does **not** decide: anything about the 3D scene's
specific geometry, how ten seats map onto however many decorative
figures a later 3D stage shows, or the printer's own 3D representation —
that is implementation, following the existing room-building pattern
once the state shape below exists to drive it. Nothing about any
facility after Rat Room is decided here either.

## Decision 1 — per-seat resources, not a single room-level occupancy row

**Compared directly against the single-occupancy-row shape every room
ADR since 0003 has used, and rejected here — not because that shape is
wrong, but because Rat Room's own facts don't match the question it
answers.** A single `occupancy: empty | occupied | unknown` row answers
"is anyone in here" — the right question for Otter Room, Rabbit Room,
Weasel Room, and Badger Room, each a single shared space where *any*
presence is the decision-relevant fact. It is the wrong question for Rat
Room: a resident checking this room doesn't want to know whether anyone
at all is inside (with ten seats, that will almost always be true during
normal hours) — they want to know **whether a seat is free for them
specifically**. A single room-level flag would only ever tell a resident
that somebody is present — it cannot distinguish one occupied seat from
ten occupied seats, collapsing both into the same `occupied` value. It
therefore cannot answer the question that actually matters here: how
many confirmed-free seats remain. That is a real information loss — the
flag is the wrong resource granularity for this room's own question —
this ADR will not accept merely to stay pattern-consistent with the
prior five rooms.

**Chosen: ten independently-reportable seat resources, A through J, each
carrying its own `occupancy`/`expectedEndAt`/`confirmedAt`/`version`** —
structurally the same move Laundry already made for an analogous reason:
a `machines` table of ten independently-reportable resources, not one
row answering "is the laundry room in use." Rat Room is, in this specific
structural sense, **Laundry's sibling, not Otter/Rabbit/Weasel/Badger
Room's** — the first facility since Laundry itself where the
decision-relevant unit is one of several interchangeable resources a
resident picks from, not the room as a whole. This is the central
structural fact this ADR is built around, and it is why this ADR is
necessary at all rather than a formality: adopting the single-row shape
here would have been copying the wrong template.

**Not copied mechanically from `machines`, either — only the
multiplicity transfers, not the shape.** Decision 2 below keeps every
seat's own per-resource *state shape* close to Otter/Rabbit/Weasel/Badger
Room's (`occupancy`/`expectedEndAt`/`confirmedAt`/`version`, no
`startedAt`, no `out-of-order`), not `Machine`'s own four-status/
`startedAt` shape. Rat Room borrows Laundry's **multiplicity** (many
independent resources, each its own `version`, one SSE event name
carrying a resource-keyed payload — see Decision 6) without borrowing
Laundry's **per-resource state shape**, which was built for an
appliance's physical condition, not a seat's occupancy.

**The ten seats are fixed seed resources, not something residents create
or the app grows on its own** — the same rule `CLAUDE.md` already states
for Laundry's machine list. A, B, C, D, E, F, G, H, I, J exist from the
schema's own seed step; nothing in the app ever adds an eleventh seat or
removes one.

## Decision 2 — per-seat state shape: occupancy + optional `expectedEndAt`, no `out-of-order`, no `startedAt`

**Each seat's own state mirrors Otter/Rabbit/Weasel/Badger Room's shape,
not `Machine`'s** — re-derived from what a seat actually represents, not
assumed because Decision 1 made this room "Laundry-like" in its
multiplicity:

- `empty`
- `occupied`
- `unknown`

with an optional `expectedEndAt` a resident may supply when reporting a
seat `occupied` — the same never-fabricated, resident-estimated signal
every prior occupancy room uses, except that here it cannot be "carried
over from a sign-up sheet" the way Otter/Rabbit/Weasel/Badger Room's can,
because **Rat Room has no sign-up sheet at all** — not even a paper one
this app declines to digitize. A resident occupying a seat may simply
know roughly how long they intend to study and choose to report it; the
estimate's *origin* differs from the other rooms' (a resident's own
sense of their session length, not a number copied off a door), but its
*treatment* is identical: optional, per-observation, never fabricated by
the app, and capped by the same real ceiling as the room's own norm
(Decision 3).

**No `out-of-order`-equivalent status.** Considered directly, not merely
omitted: a computer room is exactly the kind of facility where "is this
computer actually working" feels like an obviously relevant question, the
same way Rabbit Room's kitchen appliances or Badger Room's piano/TV each
tempted an equipment-status field this ADR's predecessors explicitly
declined. The given facts name no confirmed concern about broken
computers the way Laundry's own `out-of-order` answers a real, stated
concern about broken washers/dryers. Nothing here forecloses adding it
later if that fact turns out to be real and stated — it would be a new
decision with its own evidence, not a default this ADR quietly assumes
by resemblance to Laundry's own four-status shape.

**No `startedAt`.** `Machine` carries a `startedAt` distinct from
`confirmedAt` (in practice, since no UI ever supplies a different value,
the two end up equal on every real report — but the field exists as its
own concept). Nothing about a seat's own life cycle calls for a
separately-tracked start time distinct from the moment it was last
confirmed: `confirmedAt` alone is already "the moment someone looked,"
exactly the reasoning Otter Room's ADR gave for omitting the equivalent
field (ADR 0004, Mechanics). Adding it here would be copying `Machine`'s
shape because Decision 1 made this room multi-resource, not because any
seat-specific fact calls for it — precisely the mechanical-copying
mistake this ADR was asked to avoid.

**`unknown` is not a reportable value**, for the same reason as every
prior facility (ADR 0003, Decision 2, carried through 0004/0005/0006/
0007): a resident's `PATCH` may only set a seat's `occupancy` to `empty`
or `occupied`. `unknown` remains part of the stored and public
`RatRoomSeatOccupancy` type (seed state, and what decay transitions
into — Decision 3), representing "no sufficiently fresh observation,"
which only the absence of a report can produce.

## Decision 3 — per-seat decay: a 4-hour ceiling on `occupied`, a 15-minute ceiling on `empty`, re-derived from Rat Room's own facts

**Both numbers land on the same values Otter/Rabbit/Weasel/Badger Room
use, and both are re-argued here from Rat Room's own facts, not carried
over by pattern.**

- The **4-hour ceiling** is confirmed, directly, as a real community norm
  about Rat Room specifically: a single seat's use typically doesn't run
  past four hours. This is given the same epistemic status as every
  prior room's own 4-hour figure — a fact this ADR is recording about
  this room, not inferring from four other rooms happening to share it.
  Unlike Otter/Rabbit/Weasel/Badger Room, where the norm is stated at
  room level ("a single *use of the room* doesn't run past four hours"),
  here the norm is naturally a **per-seat** fact from the start — a
  single person's occupation of a single seat/computer is already the
  unit the norm describes, so no re-derivation from room-level to
  seat-level was needed; the given fact already speaks at the right
  grain.
- The **15-minute `empty` ceiling** is, again, a product freshness
  judgement this ADR makes about this room specifically, not a number
  copied because four other rooms use it. The reasoning, kept to what
  Rat Room's own facts actually support: Rat Room has **no reservation
  or sign-up mechanism of any kind** — not even the paper sign-up sheet
  every other occupancy room's brief names. Each seat is a walk-in
  resource: a resident simply sits down at whichever seat is free, with
  no sheet, record, or norm standing between "confirmed empty" and
  "occupied." An `empty` report here, exactly like every prior room's
  own `empty` report, only ever confirms that one seat at the one moment
  someone looked — that seat can become occupied afterward with no
  reservation record and no Toad Live report of its own to say so. On
  this basis, this ADR chooses 15 minutes as Rat Room's own product
  freshness judgement for how long one such confirmation should remain
  authoritative.

**This re-derivation is the one place this ADR makes an inference rather
than transcribing a given fact, and that inference should be named
plainly: no measured seat-turnover rate was supplied.** The "walk-up, no
reservation" fact supports treating one `empty` confirmation as
perishable, but the 15-minute figure itself remains this ADR's own
judgement call, not a number Rat Room's brief states numerically — same
honest status every prior room's own 15-minute figure already carries.

**Decided formula**, evaluated lazily on every ordinary read of a given
seat (never a timer, never an SSE connection event), applied
independently per seat:

- `occupancy: "empty"` expires to `unknown` **15 minutes** after that
  seat's own `confirmedAt`.
- `occupancy: "occupied"`, no `expectedEndAt`: expires to `unknown` **4
  hours** after `confirmedAt`.
- `occupancy: "occupied"`, `expectedEndAt` present: expires to `unknown`
  at **`min(expectedEndAt, confirmedAt + 4h)`** — whichever comes first.

**Enforced on the write path too**, identically to every prior occupancy
room: a `PATCH` reporting a seat `occupied` with an `expectedEndAt` is
only valid when `now < expectedEndAt <= now + 4h`, evaluated against the
request's own server-side `now`. Both ends rejected `400`, not clamped.

**`expectedEndAt` is per-observation, never inherited across reports**,
the same discipline every prior room enforces: a seat's `occupied`
report that omits `expectedEndAt` stores `NULL` for that write, even if
the row being overwritten currently holds a value from an earlier
report on that same seat; an `empty` report always stores `NULL`.

**Neither number is provisional** in `CLAUDE.md`'s `UNTIMED_IN_USE_DECAY_MS`
sense. Both are settled, independently-reasoned figures for this room —
the 4-hour figure a transcribed real-world norm, the 15-minute figure a
settled product freshness judgement — and the code comments on
`RAT_ROOM_SEAT_MAX_OCCUPIED_MS`/`RAT_ROOM_SEAT_EMPTY_DECAY_MS` must keep
that same distinction visible every prior room's own pair of comments
already draws, not collapse into identical language.

## Decision 4 — room-level visual/summary: purely derived, never persisted, never a second source of truth

**No second, room-level occupancy row is stored alongside the ten
seats.** A separate stored room-level flag would create exactly the
two-sources-of-truth problem this ADR is explicitly asked to avoid: it
could drift from what the ten seats actually say, require its own
decay/version/concurrency machinery duplicating the seats' own, and raise
an unanswerable question ("which one is authoritative when they
disagree") that a purely derived value never can. **Both the panel's
summary line and the 3D scene's one visual state are computed at read
time from the current ten seat rows, every time, never read from a
stored value of their own.**

**Derivation rule, precedence order fixed and total over all
`3^10 = 59,049` possible occupancy combinations of ten independent
three-valued seats:**

1. **any seat `occupied`** → the derived visual is `occupied`. This wins
   regardless of how many other seats are `empty` or `unknown` — "someone
   is actually here right now" is never overridden by uncertainty about
   the rest of the room.
2. **else, all ten seats `empty`** → the derived visual is `empty`. A
   fully, currently confirmed-clear room.
3. **else** (no seat `occupied`, but at least one seat `unknown`) → the
   derived visual is `unknown`. This is the honest middle case: nobody
   is *confirmed* present, but the room cannot honestly be called
   confirmed-empty either while some seats carry no fresh observation.

This is a pure function of the ten seats' own `occupancy` values alone —
`expectedEndAt`/`confirmedAt`/`version` play no role in it, the same way
a resident's `expectedEndAt` estimate never changes any prior room's 3D
state beyond plain `occupied` (ADR 0004/0005/0006/0007, each Decision 2).
**The 3D scene needs only this one three-valued derived signal** — there
is no 3D requirement, and this ADR creates none, to show which specific
seats A–J are occupied. Figures are decorative, exactly like every prior
room's own occupied-state figures, and their count never attempts to
equal the number of actually-occupied seats.

**The panel's summary line must never let `unknown` pass as `empty`.**
The one number a resident actually wants — "how many seats can I use
right now" — is **the count of seats confirmed `empty`, and only
that.** `unknown` seats are not counted as free (an unconfirmed seat
might be empty, but asserting that would be exactly the kind of
unearned confidence `README.md`'s freshness argument rejects) and are
not counted as occupied either (nothing confirms that either). When any
seat is `unknown`, the panel names that count alongside the confirmed-
free count rather than silently folding it into either bucket — e.g. "6
seats confirmed free · 2 unknown" rather than either "6 free" (silently
hiding the two seats that just might also be free) or "8 free" (silently
promoting an absence of information into an answer). This is a direct,
load-bearing consequence of Decision 1: a single room-level flag could
never have expressed this distinction at all, only ever "some kind of
occupied" or "some kind of not."

## Decision 5 — explicit rejections, named directly

Restated plainly, since each is a real alternative this ADR is
rejecting, not merely an omission:

- **No printer availability or queue.** Named directly, not just left
  out, because a computer room with one visibly described printer is
  exactly the kind of fixture that invites "shouldn't residents see
  whether it's free" as a plausible-sounding addition nobody actually
  asked for — the same caution every prior room applied to its own named
  equipment (Rabbit Room's kitchen appliances, Weasel Room's instruments,
  Badger Room's piano/TV). The printer is real furniture this room has,
  never something this app reports the condition or queue state of.
- **No booking/reservation persistence**, stated even more directly here
  than for any prior room: Rat Room doesn't have a paper sign-up sheet to
  decline digitizing — it has **no reservation mechanism of any kind** to
  begin with. `occupancy`/`expectedEndAt` describe each seat's state
  *right now*, not a schedule.
- **No activity taxonomy.** Nothing in the brief suggests a seat's use
  (study, general computer use) is several independently-reportable
  things the way AA Room's common-room activities are — it's "someone is
  using this seat," full stop, the same single-fact conclusion every
  occupancy room since Otter Room has reached on its own terms.
- **No headcount.** Rat Room does not model how many people are
  actually present. The count of seats currently `occupied` is a
  resource-occupancy fact — how many of the ten reportable seats are
  presently unavailable — not a count of people, and must not be read or
  presented as one: a seat being `occupied` says nothing about whether
  exactly one person is using it, and the 3D scene's own decorative
  figure count (Decision 4) never attempts to equal, track, or stand in
  for the occupied-seat count either.
- **No exact A–J-to-figure mapping in the 3D scene.** Decision 4 already
  establishes the scene needs only the one derived three-valued signal;
  a future 3D stage choosing to show, say, two or three decorative
  figures for "occupied" is free to do so the same restrained,
  non-activity-specific way every prior room's figures already work, but
  this ADR does not ask for — and a later stage must not invent — any
  claim that figure N corresponds to seat N.

## Decision 6 — inherited house-wide rules, mostly from Laundry's own shape, not the single-row rooms'

Identity and concurrency inherit unchanged in substance from ADR
0001/0002, but **apply per seat**, not per room — the direct consequence
of Decision 1, stated explicitly so a future implementer doesn't default
to the single-row rooms' shape by habit:

- **identity**: the actor is the server-resolved session
  (`sessions.id`/pseudonym), never a client-supplied field — ADR 0002,
  unchanged.
- **concurrency**: optimistic concurrency via `version`/`ifVersion`,
  `409` with the current canonical state on a stale write — ADR 0001,
  Decision 2, unchanged **in mechanism**, but each of the ten seats gets
  its **own independent `version` column**, exactly like each of
  Laundry's ten machines does, not one shared room-level version the way
  every single-row room has. Two residents reporting two *different*
  seats never conflict with each other at all — only two reports
  targeting the *same* seat can race, the same granularity Laundry's own
  machines already have.
- **decay trigger**: lazy, read-triggered only, evaluated independently
  per seat whenever that seat is read — never a timer, never an SSE
  connection event, and never triggered for all ten seats by reading
  just one of them.
- **transport**: the one existing SSE connection
  (`GET /api/stream`, `src/lib/realtime.ts`) carries Rat Room's updates
  too — no second `EventSource`, no second subscriber list.
  `BroadcastPayload` gains a **seventh variant**, `{ kind: "rat-room";
  seat: RatRoomSeatState }` — **one variant carrying a seat-keyed
  payload**, the same shape `{ kind: "machine"; machine: Machine }`
  already uses to carry whichever one of ten machines just changed, not
  ten separate `kind` values. `src/pages/api/stream.ts` dispatches a
  seventh named SSE event, `event: rat-room`, over the same connection;
  telling which seat changed is the payload's own `seat.id` field, the
  same way a machine event's own `machine.id` already does this, not a
  per-seat event name.
- **logging**: every Rat Room report attempt — accepted or rejected —
  gets a `[toadlive]` log line in `src/lib/log.ts`'s existing format,
  naming the actor pseudonym, the specific seat, the outcome, and the
  resulting state — mirroring the existing room pairs' shape with one
  added field (`seat`) the single-row rooms never needed, since they have
  only one resource to name.
- **no client-asserted identity**: a request body naming an actor for a
  Rat Room seat report is rejected exactly like elsewhere — `400`, not
  silently dropped.
- **freshness display**: Laundry's plain "confirmed N minutes ago" label
  per seat, not AA Room's derived `fresh`/`stale`/`null` split. No
  `freshness` field on `RatRoomSeatState` — `confirmedAt` alone is
  enough, same reasoning as every prior occupancy room.

## Mechanics (data model and API only — 3D is explicitly deferred)

**Schema** — `rat_room_seats`, ten rows (not one, unlike every room
since AA Room — mirrors `machines`' per-resource shape, not
`otter_room`'s single-row shape):

```sql
CREATE TABLE IF NOT EXISTS rat_room_seats (
  id              TEXT PRIMARY KEY,
  seat            TEXT NOT NULL UNIQUE
                    CHECK (seat IN ('A','B','C','D','E','F','G','H','I','J')),
  occupancy       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  expected_end_at INTEGER,
  confirmed_at    INTEGER,
  reporter_id     TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
```

`seat UNIQUE` enforces Decision 1's own fixed-ten-resources invariant at
the schema level — exactly one row per logical seat A–J — rather than
relying on the seed step alone to never insert a duplicate. `id` follows
the existing `<slug>-<thing>` convention (`rat-room-a` through
`rat-room-j`), the same shape `machines.id` already uses (`ab-washer`,
`c-dryer`, ...) — `seat` is kept as its own column (the bare letter)
rather than parsed back out of `id` at every read, the same "store what
you need directly, don't re-derive it from a string every time" instinct
`machines.location`/`machines.type` already follow
alongside their own composite `id`.

Seeded once, ten rows: `occupancy = 'unknown'`, `expected_end_at = NULL`,
`confirmed_at = NULL` — never reported yet, same "don't default
`confirmed_at` to now at seed time" rule every prior facility follows.

**Types** (`src/lib/types.ts`, additive):

```ts
export const RAT_ROOM_SEAT_IDS = ["A","B","C","D","E","F","G","H","I","J"] as const;
export type RatRoomSeatId = (typeof RAT_ROOM_SEAT_IDS)[number];

export type RatRoomSeatOccupancy = "empty" | "occupied" | "unknown";
export const VALID_RAT_ROOM_SEAT_OCCUPANCIES: readonly RatRoomSeatOccupancy[] = [
  "empty",
  "occupied",
  "unknown",
];

export type ReportableRatRoomSeatOccupancy = Extract<RatRoomSeatOccupancy, "empty" | "occupied">;

export interface RatRoomSeatState {
  id: string; // "rat-room-a"
  seat: RatRoomSeatId; // "A"
  occupancy: RatRoomSeatOccupancy;
  expectedEndAt: number | null;
  confirmedAt: number | null;
  version: number;
}

// Decision 4 — purely derived, never stored, never has its own version.
export interface RatRoomSummary {
  visual: "empty" | "occupied" | "unknown";
  emptyCount: number;
  occupiedCount: number;
  unknownCount: number;
}

export function summarizeRatRoomSeats(seats: readonly RatRoomSeatState[]): RatRoomSummary {
  const emptyCount = seats.filter((s) => s.occupancy === "empty").length;
  const occupiedCount = seats.filter((s) => s.occupancy === "occupied").length;
  const unknownCount = seats.filter((s) => s.occupancy === "unknown").length;
  const visual =
    occupiedCount > 0 ? "occupied" : emptyCount === seats.length ? "empty" : "unknown";
  return { visual, emptyCount, occupiedCount, unknownCount };
}
```

**Decay constants** (beside every prior room's own pair, commented with
the same settled-but-distinct-evidence discipline — see Decision 3):

```ts
// Real-world community norm, confirmed directly for Rat Room: a single
// seat's use typically doesn't run past four hours. Do NOT mark this
// PROVISIONAL or treat it like UNTIMED_IN_USE_DECAY_MS.
export const RAT_ROOM_SEAT_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, re-derived for this room's own
// walk-up, no-reservation-at-all facts (see ADR 0008, Decision 3) —
// settled, not provisional, but not a pre-existing Rat Room norm about
// the number fifteen either.
export const RAT_ROOM_SEAT_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes
```

**Decay function** — identical shape to every prior room's own, applied
per seat row:

```ts
function decayedRatRoomSeat(row: RatRoomSeatRow, now: number, store: RatRoomStore): RatRoomSeatRow {
  if (row.occupancy === "unknown") return row;

  const expiresAt =
    row.occupancy === "empty"
      ? (row.confirmed_at ?? now) + RAT_ROOM_SEAT_EMPTY_DECAY_MS
      : Math.min(
          row.expected_end_at ?? Infinity,
          (row.confirmed_at ?? now) + RAT_ROOM_SEAT_MAX_OCCUPIED_MS,
        );

  if (now <= expiresAt) return row;

  // ... UPDATE occupancy = 'unknown', expected_end_at = NULL,
  // version = version + 1 WHERE id = ? AND occupancy != 'unknown',
  // broadcast { kind: "rat-room", seat: toRatRoomSeatState(updated) }
  // on changes === 1, re-read on changes === 0 — identical shape to
  // decayed()/decayedOtterRoom()/etc.
}
```

**API — route contract frozen here, not left for an implementer to
guess.** Mirrors `src/pages/api/machines/[id].ts`'s shape as a keyed
resource (ten seats, not one fixed row), but the path parameter is the
**logical seat identifier**, one of `A`–`J` — never the composite row
`id` (`rat-room-a`):

- `GET /api/rat-room/:seat` → the current `RatRoomSeatState` for that
  seat, decay applied lazily on read. `:seat` must be one of
  `RAT_ROOM_SEAT_IDS` (`A`–`J`); any other value is `404`. The page's own
  frontmatter reads all ten directly via a `listRatRoomSeats()`-style
  function (mirroring `listMachines()`), not through this route.
- `PATCH /api/rat-room/:seat` → body `{ occupancy, expectedEndAt?,
  ifVersion }`, the same validation order as every prior occupancy
  room's own route (session required → occupancy must be reportable →
  no client-asserted actor field → `empty` requires no `expectedEndAt` →
  `expectedEndAt` bounds → `ifVersion` validated), scoped to the one
  seat named in the path.

The route handler resolves `:seat` to the matching row internally (e.g.
`WHERE seat = ?`, not `WHERE id = ?`) — the composite `id` column
(Mechanics, Schema) is storage/seed convenience only and is never a
value a client supplies or a path segment ever carries. No separate
"list all seats" HTTP route is needed: the page's initial render reads
all ten server-side directly (exactly how Laundry's own page load reads
all ten machines via `listMachines()`, never through `/api/machines/:id`),
and the client's SSE-reconnect handler re-fetches all ten via ten
individual `GET /api/rat-room/:seat` calls (`:seat` iterating
`A`–`J`), the same pattern Laundry's own `onOpen()` handler already uses
for its ten machines.

**SSE** — `event: rat-room`, seventh named event on the existing stream,
carrying one seat's `RatRoomSeatState` per event, per Decision 6.

**Logging** — `formatRatRoomReportOutcome`/`formatRatRoomReportRejected`
in `src/lib/log.ts`, same shape as every prior room's own pair plus one
additional field naming which seat, e.g.:

```
[toadlive] actor=Toad-7F3A9C facility=rat-room seat=C action=report occupancy=occupied result=ok version=4
```

**Panel summary** — computed client-side from the ten seats' own states
exactly the way Laundry's existing `statusByMachine`/`updateSummary()`
already recomputes its four-way count on every incoming update (see
`src/pages/index.astro`): `summarizeRatRoomSeats()` runs over the current
client-held array of ten seat states on every SSE event, never a
separately-fetched or separately-stored count. The confirmed-free number
(`emptyCount`) is the one headline figure; `unknownCount`, when nonzero,
is shown alongside it, never folded into either bucket — per Decision 4.

## Consequences

Rat Room is the first facility since Laundry to need ten independent
rows, ten independent `version` counters, and a keyed API route rather
than a single fixed resource — real additional surface the panel and 3D
code must handle (ten report forms or one form with a seat selector,
ten SSE-driven DOM updates instead of one, a derived summary recomputed
from an array rather than read off one object) that every room since AA
Room has not needed. This is accepted as the correct shape for what this
room's own facts actually ask, not a complexity this ADR could have
avoided by forcing Decision 1 the other way. The fixed ten-seat,
A-through-J shape is a committed product-model decision (Context), not
an open question pending a more exact physical recount — implementation
may build seed data against it directly. Choosing not to track printer
status or any reservation mechanism is a
deliberate information-scope decision, the same kind of choice every
prior room's own Decision on rejected fields already made — if printer
queueing or seat booking ever becomes a real, stated need, that is a new
decision with its own ADR, not a default this one quietly assumes.

## Verification plan (not yet run — nothing is implemented)

Mirroring every prior room ADR's own verification plan, widened for
per-seat multiplicity:

- automated: a persistence test per seat; `ifVersion`/409 conflict
  coverage confirming two different seats' reports never conflict with
  each other while two reports to the *same* seat do; a `PATCH`
  rejection test for `occupancy: "unknown"`; rejection tests for
  `expectedEndAt` beyond 4 hours and at-or-before `now`; a rejection test
  for `expectedEndAt` alongside `occupancy: "empty"`; a no-inheritance
  test; unit tests for the decay function's three branches against
  constructed timestamps, following the established throwaway-database
  technique, run independently per seat; a unit test suite for
  `summarizeRatRoomSeats()` covering all three precedence branches
  (any-occupied wins regardless of other seats' states; all-empty; the
  no-occupied-some-unknown honest-middle case) and the exact
  confirmed-free-vs-unknown counting rule; identity/permission tests; an
  SSE test confirming an already-open stream receives `event: rat-room`
  carrying the correct seat's own id, for whichever single seat was
  reported, with the other nine seats' own state undisturbed.
- manual, real browser: the same Playwright-based verification every
  prior room's backend/panel/3D stages used, with extra attention to
  cross-seat independence (reporting seat C never visibly affects seat
  F's own card) and to the summary line's honesty under a deliberately
  constructed mixed empty/occupied/unknown combination across the ten
  seats, not just the all-empty or all-occupied extremes.
