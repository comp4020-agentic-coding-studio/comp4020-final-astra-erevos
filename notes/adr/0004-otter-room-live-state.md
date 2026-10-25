# ADR 0004: Otter Room's shared live state

**Status**: Implemented and verified live. This ADR fixed the state
model, statuses, and decay rules for Toad Live's third facility before
any schema, API, or UI work began, the same order ADR 0001/0002/0003 each
used (see
`PROCESS.md`'s "Rewritten each time the project's shape genuinely changed"
convention). Everything below — Decisions 1 through 4, and Mechanics — was
built exactly as decided here; nothing in the implementation diverged from
this ADR. See Verification below for what was actually run, and
`PROCESS.md`'s Otter Room entry for the two real bugs a real browser check
caught that neither this ADR nor the automated test suite predicted.

## Context

`FINAL_PROJECT_SOURCE_OF_TRUTH.md` §3 names Otter Room as a small study
room — one table, a whiteboard, a window, a heater, holding at most around
six people. A paper sign-up sheet already exists on the door: someone who
wants the room writes down their intended time in advance, and someone who
walks in and finds no reservation and nobody there is expected to write
their own usage time on the same sheet. There is no formal time limit, but
residents follow an ordinary library-study-room norm: a single use
typically does not run past four hours. People study alone or in small
groups; this is a real distinction in how the room gets used, but it is
not one the app needs to capture — see Decision 1.

The deliberate, stated scope boundary (carried over unchanged from
`FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s and `README.md`'s "what we chose not
to build"): Toad Live does not replicate the paper sign-up sheet, does not
build a booking calendar, and does not track a future reservation. This
ADR only concerns the room's **current live state** — what a resident sees
right now, the same "useful at a glance" question Laundry and AA Room both
answer for their own facilities.

Otter Room is close to Laundry's dryer in one specific way AA Room is not:
an occupied dryer has no display to read an end time off, but a resident
can still choose to estimate one; Otter Room is the same — a resident who
reports the room occupied may optionally carry over the time written on
the door's sign-up sheet as an expected end time. This is a real,
occasionally-available signal, unlike AA Room, which this ADR's Decision 1
argues has no equivalent signal at all for any of its activities.

What this ADR did **not** decide: anything about the 3D scene's specific
geometry or animation — that was left as implementation, following the
existing `room.ts`/`aa-room.ts`/`aa-room-figures.ts` pattern once the
state shape below existed to drive it. It was since built
(`src/lib/hall-view/otter-room.ts`/`otter-room-status-look.ts`/
`otter-room-figures.ts`) in a way that stayed inside this ADR's own
constraints without needing to revisit any of them — occupied shows
figures and occupied-only activity props, empty/unknown show neither, and
`expectedEndAt` never changes the scene, exactly as this ADR already
required for the state model itself. This ADR still says nothing about
any facility after Otter Room.

## Decision 1 — state model: occupancy only, no activity field

**Compared against AA Room's model, and rejected as a template here:**
AA Room needed `activities` because its single real complication —
television, pool, and table tennis are genuinely independent, simultaneous
uses of one large room by different people — is a fact about *that* room,
not a pattern to stamp onto every future facility. Otter Room has no
equivalent fact: `FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s own brief for this
room is explicit that "we don't need to distinguish activity" and "don't
record headcount." Someone studying alone and a small group discussing
together are both just "the room is in use" from this app's point of
view — there is nothing here resembling AA Room's "TV on while a different
group plays pool" scenario, and inventing an `activities` field to look
consistent with AA Room would be exactly the kind of overly complicated
taxonomy `FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10 already warns against.

**Chosen: a single required primary field, `occupancy`, with one optional
secondary field, `expectedEndAt`** — structurally the same shape Laundry
already proved (a required primary status plus an optional field that
narrows, never replaces, the primary fact), and the same shape AA Room
used for `occupancy` alone before activities layered on top of it.

- `empty`
- `occupied`
- `unknown`

No `out-of-order`-equivalent status exists for Otter Room, same reasoning
as AA Room (ADR 0003, Decision 2): nothing in the given facts raises
broken furniture as a concern within this facility's current live-state
scope.

**`unknown` is not a reportable value**, for the same reason as AA Room's
`occupancy` (ADR 0003, Decision 2): a resident's `PATCH` may only set
`occupancy` to `empty` or `occupied`. `unknown` remains part of the stored
and public `OtterRoomOccupancy` type (seed state, and what decay
transitions into — Decision 2), but it represents "there is currently no
sufficiently fresh observation," which only the absence of a report
(time passing) can produce, never an act of reporting itself.

## Decision 2 — decay: a 4-hour hard ceiling on `occupied`, a 15-minute ceiling on `empty`

**The two numbers below rest on different kinds of evidence, and this ADR
keeps that distinction visible rather than flattening both into "decided,
so equally settled."**

- The **4-hour ceiling** is a **real-world, community fact**: Toad Hall
  residents already follow a shared library-study-room norm that a single
  Otter Room use doesn't run past four hours, stated directly in
  `FINAL_PROJECT_SOURCE_OF_TRUTH.md`. This app didn't invent it — it is
  transcribing an existing social norm into a stored ceiling, the same
  epistemic status as the five laundry locations or the one-washer-one-dryer
  count: a fact about Toad Hall this ADR is recording, not producing.
- The **15-minute `empty` ceiling** is a **product freshness judgement**
  this ADR is making, not a pre-existing Otter Room norm — nothing in
  `FINAL_PROJECT_SOURCE_OF_TRUTH.md` says residents already think of an
  empty-room sighting as expiring after fifteen minutes specifically. The
  reasoning behind it (an empty-room claim is one of the most perishable
  observations this app makes, and a small, frequently-used room can fill
  again within minutes with no report of its own to say so) is sound and
  this ADR is deciding it now, the same way ADR 0003 decided AA Room's
  15/45-minute thresholds — but it is a judgement call about how this app
  should talk about freshness, not a fact Toad Hall already held about
  itself before this ADR existed.

Unlike AA Room, which has no objective end-time signal at all for any of
its activities, Otter Room sits closer to Laundry: a resident **may**
optionally carry over a time written on the door's paper sign-up sheet as
`expectedEndAt`, the same way a dryer's end time is only ever a resident's
own estimate, never fabricated by the app (`CLAUDE.md`). But unlike a
dryer, the 4-hour ceiling is a second, independent, real-world fact behind
it, not a guess standing in for missing data the way
`UNTIMED_IN_USE_DECAY_MS` is for an untimed dryer. It is a decided ceiling
that applies **whether or not** a resident supplied an estimate.

**This is why Otter Room's decay is not simply "Laundry's dryer pattern
copied over."** The dryer model has two mutually exclusive branches — an
exact signal if present, otherwise a provisional fallback window, with the
fallback only there because nothing better exists yet. Otter Room has one
real ceiling that always applies, optionally sharpened by a tighter
resident estimate. A future implementer reaching for the dryer's
if/else-branch shape here would get the model wrong — see `CLAUDE.md` for
the rule this ADR adds to make that mistake harder to make by accident.

**Decided formula**, evaluated lazily on every ordinary read, exactly like
Laundry's and AA Room's own decay (never a timer, never an SSE connection
event):

- `occupancy: "empty"` expires to `unknown` **15 minutes** after
  `confirmedAt` — this app's own freshness judgement, not a pre-existing
  Otter Room norm (see above). `empty` only ever means "someone just
  confirmed nobody is here" — a room this small and this frequently used
  can fill in the next few minutes with no report of its own to say so, so
  this observation's honest lifetime is short. This mirrors AA Room's
  "`empty` is not sticky" departure from Laundry's `out-of-order`
  convention (ADR 0003, Decision 3), for the same underlying reason: an
  empty-room claim is one of the most perishable observations this app
  makes, and letting it stand unchallenged for hours would misrepresent
  the room the longer nobody corrects it.
- `occupancy: "occupied"`, no `expectedEndAt`: expires to `unknown` **4
  hours** after `confirmedAt`.
- `occupancy: "occupied"`, `expectedEndAt` present: expires to `unknown`
  at **`min(expectedEndAt, confirmedAt + 4h)`** — whichever comes first.
  A resident's own estimate can end the report *earlier* than the 4-hour
  ceiling (most of the time, since most study sessions are shorter than
  the ceiling itself), but can never extend it *past* the ceiling: the
  ceiling is a real community norm, not a default that a sufficiently
  generous self-report can override.

**Neither number is provisional** in the sense `CLAUDE.md` uses that word
for `UNTIMED_IN_USE_DECAY_MS` — neither is a placeholder standing in for
missing data, and neither is expected to be revisited the way the laundry
fallback window explicitly is. But "decided" is not "the same kind of
fact" for both, and the code comments attached to each constant must say
so distinctly, not use identical language that implies otherwise:

- `OTTER_ROOM_MAX_OCCUPIED_MS` (4 hours) is a **settled fact about how this
  room is actually used** — a community norm this ADR transcribed, not
  invented.
- `OTTER_ROOM_EMPTY_DECAY_MS` (15 minutes) is a **settled product
  freshness judgement** — a decision this ADR made about how quickly an
  empty-room claim should stop being trusted, grounded in reasoning about
  observation volatility, not in an existing Toad Hall norm about the
  number fifteen specifically.

Marking either `PROVISIONAL` would misstate its status and risk a future
agent "fixing" it under the mistaken belief it is a placeholder the way
`UNTIMED_IN_USE_DECAY_MS` genuinely is — but collapsing the two into one
undifferentiated "settled fact" comment would misstate the 15-minute
figure in the other direction, overstating it as a real-world fact Toad
Hall already held rather than a product call this ADR is the origin of.

**Enforced on the write path too, not only at decay time.** A `PATCH`
reporting `occupancy: "occupied"` with an `expectedEndAt` is only valid
when

```
now < expectedEndAt <= now + 4h
```

evaluated against the request's own server-side `now`, not a client-
supplied one. Both ends are rejected `400`, not clamped:

- `expectedEndAt <= now` (a time already in the past, or exactly now) is
  rejected — an end time that has already passed isn't an estimate of
  anything, so there is nothing to carry over.
- `expectedEndAt > now + 4h` is rejected — the same ceiling enforcement as
  before: a resident's own estimate can narrow the 4-hour ceiling, never
  extend past it.

This keeps the 4-hour ceiling an actual constraint on what a report may
claim, not merely a cap on how long a claim is believed after the fact —
the same spirit as `CLAUDE.md`'s existing requirement that
`startedAt`/`expectedEndAt` be validated as safe positive integers before
they ever reach SQLite, extended here to a facility-specific bound on top
of that existing safety check, not a replacement for it.

**`expectedEndAt` is per-observation, never inherited across reports.**
Every `PATCH` fully determines the next stored `expected_end_at` from
scratch — it is never a partial update that can leave a previous report's
value in place:

- an `occupied` report that omits `expectedEndAt` stores
  `expected_end_at = NULL` for this write, even if the row being
  overwritten currently holds a non-null value from an earlier report.
  A resident who doesn't provide an end time is not implicitly
  re-asserting whatever the last person guessed — they're making a new
  observation that happens to carry no estimate.
- an `empty` report always stores `expected_end_at = NULL` — Decision 1
  already requires `empty` to carry no `expectedEndAt` in the request
  body (`400` if one is sent), and this is the corresponding storage
  guarantee: no code path may skip clearing the column when occupancy
  moves to `empty`.
- in request-body terms, this follows the same absent-vs-explicit
  convention `src/pages/api/machines/[id].ts` already uses for
  `startedAt`/`expectedEndAt` on a Laundry report: an absent field in the
  JSON body is treated as "no estimate for this report" (→ stored as
  `NULL`), not as "leave whatever was there before." Otter Room's route
  does not need a client to send an explicit `null` to clear a prior
  value — omitting the field is already sufficient, because every report
  fully replaces this field rather than merging into the existing row.

## Decision 3 — no `activities`, no headcount, no booking calendar

Restated plainly, since each is a real alternative this ADR is rejecting,
not merely an omission:

- **No activity taxonomy.** See Decision 1. Adding one later would need
  its own ADR and its own argument from a fact about the room this one
  doesn't have, the same discipline AA Room's v1→v2 correction (ADR 0003)
  used when it discovered a real fact it had wrongly scoped out.
- **No headcount field.** `FINAL_PROJECT_SOURCE_OF_TRUTH.md` is explicit
  that the room holds "approximately six people" but that the app does not
  need to record how many are actually present. The 3D scene's figures
  (Decision 4 / Mechanics) are decorative, never a real headcount, the
  same rule AA Room's figures already follow.
- **No booking/reservation persistence.** The paper sign-up sheet is a
  real-world artifact this app does not digitize. `occupancy`/
  `expectedEndAt` describe the room's state *right now*, not a schedule of
  future or past uses. This is restated here, not just in the source of
  truth, because it's the single most likely scope-creep direction for
  this specific facility (a study room with a literal sign-up sheet
  practically invites "why not just build the booking calendar") and is
  worth naming directly as something this ADR declines, not merely
  something nobody happened to build yet.

## Decision 4 — inherited house-wide rules, not re-litigated here

The following apply to Otter Room exactly as already decided for Laundry
and AA Room, and this ADR does not reopen them:

- **identity**: the actor is the server-resolved session
  (`sessions.id`/pseudonym), never a client-supplied field — ADR 0002,
  unchanged.
- **concurrency**: optimistic concurrency via `version`/`ifVersion`, `409`
  with current canonical state on a stale write — ADR 0001, Decision 2,
  unchanged. Otter Room's row gets its own `version` column, starting at
  1, under the exact same rules `CLAUDE.md` already states.
- **decay trigger**: lazy, read-triggered only — never a timer, never an
  SSE connection event. Decision 2 above only changes *what* decays and
  *how long it takes*, never *when* decay is evaluated.
- **transport**: the one existing SSE connection
  (`GET /api/stream`, `src/lib/realtime.ts`) carries Otter Room's updates
  too — no second `EventSource`, no second subscriber list.
  `BroadcastPayload` gains a third variant, `{ kind: "otter-room"; room:
  OtterRoomState }`, and `src/pages/api/stream.ts` dispatches a third named
  SSE event, `event: otter-room`, over the same connection — the same
  reasoning ADR 0003 gave for widening `realtime.ts` from a `Machine`-only
  callback to a discriminated union applies again here, one variant wider.
- **logging**: every Otter Room report attempt — accepted or rejected —
  gets a `[toadlive]` log line in `src/lib/log.ts`'s existing format,
  naming the actor pseudonym, outcome, and resulting state, mirroring
  `formatAaRoomReportOutcome`/`formatAaRoomReportRejected`. A lazy decay
  transition is not separately logged, matching both existing facilities.
- **no client-asserted identity**: a request body naming an actor for an
  Otter Room report is rejected exactly like a `reporterId` elsewhere —
  `400`, not silently dropped.
- **freshness display**: Laundry's plain "confirmed N minutes ago" label
  (`confirmedLabel()` in `src/pages/index.astro`), not AA Room's derived
  `fresh`/`stale`/`null` three-way split. Otter Room's `OtterRoomState`
  therefore has **no `freshness` field** — `confirmedAt` alone is enough
  for the UI to compute the same plain elapsed-time label Laundry already
  uses, and introducing a graded freshness concept here would be new
  complexity this facility's own facts don't call for (no multi-tier
  judgment call is being asked of a reporter the way AA Room's "is this
  room busy" question was).

## Mechanics

**Schema** — `otter_room`, a single row (the room has no sub-locations the
way Laundry has five, same shape as `aa_room`):

```sql
CREATE TABLE IF NOT EXISTS otter_room (
  id              TEXT PRIMARY KEY DEFAULT 'otter-room',
  occupancy       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  expected_end_at INTEGER,
  confirmed_at    INTEGER,
  reporter_id     TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
```

No `activities` column, no `started_at` column (nothing here needs an
analogue of a wash cycle's start time — a report's own `confirmedAt` is
already the moment someone looked). `expected_end_at` is nullable, same
"don't fabricate one" rule as `Machine.expectedEndAt`.

Seeded once, like `machines`/`aa_room`: `occupancy = 'unknown'`,
`expected_end_at = NULL`, `confirmed_at = NULL` — never reported yet, same
"don't default `confirmed_at` to now at seed time" rule `CLAUDE.md`
already states.

**Types** (`src/lib/types.ts`, additive, no changes to existing exports):

```ts
export type OtterRoomOccupancy = "empty" | "occupied" | "unknown";
export const VALID_OTTER_ROOM_OCCUPANCIES: readonly OtterRoomOccupancy[] = [
  "empty",
  "occupied",
  "unknown",
];

// "unknown" is never a value a client's PATCH may send — see Decision 1.
export type ReportableOtterRoomOccupancy = Extract<OtterRoomOccupancy, "empty" | "occupied">;
export const VALID_REPORTABLE_OTTER_ROOM_OCCUPANCIES: readonly ReportableOtterRoomOccupancy[] = [
  "empty",
  "occupied",
];

export interface OtterRoomState {
  occupancy: OtterRoomOccupancy;
  // Only ever non-null alongside occupancy "occupied" — a resident's own
  // carried-over estimate from the door's paper sign-up sheet, never
  // fabricated from an assumed session length (CLAUDE.md). Capped at
  // confirmedAt + 4h on write — see Decision 2 — so a stored value is
  // never itself proof the 4-hour ceiling was bypassed.
  expectedEndAt: number | null;
  confirmedAt: number | null;
  // Server-owned, starts at 1 — same contract as Machine.version /
  // AaRoomState.version.
  version: number;
}
```

No `freshness` field — see Decision 4.

**Decay constants** (beside `UNTIMED_IN_USE_DECAY_MS` and
`AA_ROOM_FRESH_MS`/`AA_ROOM_EXPIRE_MS`, but commented as decided, not
provisional — see Decision 2's distinction between the two constants'
evidence, which these two comments must keep visibly different, not
collapse into one "settled fact" phrasing):

```ts
// Real-world community norm (FINAL_PROJECT_SOURCE_OF_TRUTH.md): Toad Hall
// residents already treat a single Otter Room use as not running past
// four hours. This ADR transcribes that existing norm, not a provisional
// guess awaiting real usage data — do NOT mark this PROVISIONAL or treat
// it like UNTIMED_IN_USE_DECAY_MS.
export const OTTER_ROOM_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, not a pre-existing Toad Hall norm
// about the number fifteen: an "empty" report is one of the most
// perishable observations this app makes, so this app decided it should
// stop being trusted after 15 minutes. Settled, not provisional — do not
// treat it like UNTIMED_IN_USE_DECAY_MS — but also not a community fact
// this app merely transcribed the way OTTER_ROOM_MAX_OCCUPIED_MS is.
export const OTTER_ROOM_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes
```

**Decay function** — parallel to `decayed()` in `src/lib/db.ts`, but with
its own two-branch shape per Decision 2 (not a copy of either Laundry's or
AA Room's existing decay function, both of which solve a different
problem):

```ts
function decayedOtterRoom(row: OtterRoomRow, now: number, store: OtterRoomStore): OtterRoomRow {
  if (row.occupancy === "unknown") return row;

  const expiresAt =
    row.occupancy === "empty"
      ? (row.confirmed_at ?? now) + OTTER_ROOM_EMPTY_DECAY_MS
      : Math.min(
          row.expected_end_at ?? Infinity,
          (row.confirmed_at ?? now) + OTTER_ROOM_MAX_OCCUPIED_MS,
        );

  if (now <= expiresAt) return row;

  // ... UPDATE occupancy = 'unknown', expected_end_at = NULL,
  // version = version + 1 WHERE id = ? AND occupancy != 'unknown',
  // broadcast on changes === 1, re-read on changes === 0 — identical
  // shape to decayed()/decayedAaRoom().
}
```

**API** — mirrors `src/pages/api/aa-room.ts`'s shape as a single fixed
resource (no `:id` segment):

- `GET /api/otter-room` → the current `OtterRoomState`, decay applied
  lazily on read.
- `PATCH /api/otter-room` → body `{ occupancy, expectedEndAt?, ifVersion
  }`. Validation, in order:
  1. a valid session is required → `401` before the body is parsed;
  2. `occupancy` must be `"empty"` or `"occupied"` — `400` otherwise;
  3. a body carrying any actor-identifying field → `400`;
  4. `occupancy: "empty"` requires `expectedEndAt` to be absent — `400` if
     present (mirrors AA Room's "activities must be empty when empty");
  5. if present (only possible when `occupancy: "occupied"`),
     `expectedEndAt` must pass `isSafePositiveInteger` (the same shared
     guard `startedAt`/`expectedEndAt` already use — `CLAUDE.md`) **and**
     satisfy `now < expectedEndAt <= now + OTTER_ROOM_MAX_OCCUPIED_MS` —
     `400` ("expectedEndAt must be in the future and no more than 4 hours
     from now") otherwise — see Decision 2's write-path enforcement;
  6. `ifVersion` validated by the same `isSafePositiveInteger` guard.

  A stale `ifVersion` → `409` with the current canonical `OtterRoomState`.

  `reportOtterRoomStatus()` (the `src/lib/otter-room.ts` function this
  route calls into, mirroring `reportAaRoomStatus()`) writes
  `expected_end_at` from the body's value when `occupancy: "occupied"` and
  `expectedEndAt` was sent, and as `NULL` in every other case — an
  omitted `expectedEndAt` on an `occupied` report, or any `empty` report —
  never by reading or preserving whatever the row previously held. Every
  report is a full replacement of this field, not a merge into the
  existing row; see Decision 2's "per-observation, never inherited" rule.

**SSE** — `event: otter-room`, third named event on the existing stream,
per Decision 4.

**Logging** — `formatOtterRoomReportOutcome`/`formatOtterRoomReportRejected`
in `src/lib/log.ts`, same shape as the AA Room pair, naming `facility:
"otter-room"`.

## Consequences

Otter Room gets its own table, route, and SSE event name, same pattern as
AA Room — a second state shape to keep in sync with the server, not a
drop-in reuse of either existing `applyMachineUpdate()`-style client
helper. Unlike AA Room, its shape is close enough to `Machine`'s
(`occupancy`/`expectedEndAt`/`confirmedAt`/`version`, no activities) that
the panel's rendering code can likely share more structure with Laundry's
cards than with AA Room's activity checkboxes. The 4-hour ceiling applying
even to a resident's own optimistic estimate means a report of
`expectedEndAt` five hours out is rejected outright rather than silently
clamped — a deliberate choice to make the ceiling visible as a rejection,
not a silent truncation a resident might not notice. The 15-minute
`empty` decay means Otter Room's `unknown` state will appear often,
proportionally more than Laundry's `available`, for the same reason AA
Room's `unknown` does (ADR 0003's Consequences) — judged correct given the
room's real volatility, not a flaw to tune away.

## Verification (run — implementation complete)

Delivered in three staged commits (backend slice, practical panel,
3D scene — see `PROCESS.md`), each checked before the next began:

**Automated** (`spec/otter-room.test.ts`, `spec/otter-room-decay.test.ts` —
32 tests, all passing alongside the existing suite): a persistence test (a
report survives an independent later `GET`); `ifVersion`/409 conflict
coverage identical in shape to `spec/concurrency.test.ts`; a `PATCH`
rejection test for `occupancy: "unknown"`; a `PATCH` rejection test for
`expectedEndAt` beyond 4 hours from now; a `PATCH` rejection test for
`expectedEndAt` at or before `now` (the lower bound, not just the
ceiling); a `PATCH` rejection test for `expectedEndAt` present alongside
`occupancy: "empty"`; a no-inheritance test confirming a second `occupied`
report that omits `expectedEndAt` returns `null`, not the first report's
value; unit tests for the decay function's three branches (`empty` past
15 min, `occupied` with no `expectedEndAt` past 4h, `occupied` with an
`expectedEndAt` inside 4h that still passes before the 4h ceiling would)
against constructed timestamps, following `spec/aa-room-decay.test.ts`'s
own throwaway-database technique; identity/permission tests mirroring
`spec/identity.test.ts`; an SSE test confirming an already-open stream
receives `event: otter-room` on a resident report.

**Manual, real browser** (Playwright + headless Chromium, not jsdom or
static analysis — the same discipline AA Room's own Stage 2/4
verification used): two separate sessions/contexts confirming a report in
one reaches the other via SSE with no reload; Empty/Occupied toggle
correctly enabling/disabling the optional minutes input; 409 and the
unknown-is-not-reportable 400 behaving as designed; facility switching
(Laundry → AA Room → Otter Room → Laundry → Otter Room, both directions)
leaving every facility's own 3D canvas intact; zero console errors across
all of the above; desktop and mobile layouts rendering correctly.

**Two real 3D-rendering bugs were found this way, not by the automated
suite, and both are recorded in `PROCESS.md` in full because they
generalize beyond this one facility**: the occupied-only activity props
(book, laptop, whiteboard marker strokes) were originally built as
permanent fixtures and stayed visible after a report back to `empty`
until a real screenshot caught it; and the window was originally mounted
on the room's camera-near wall, which this app's "cutaway dollhouse"
technique relies on backface culling to hide, so it rendered as an
unanchored floating frame until a real screenshot of the *whole room* (not
a tight crop) caught that too. Both are now correct: activity props track
`occupancy` exactly like the figures do, and the window is mounted on the
left wall (the one that's actually camera-facing), same side as the
heater.

**Production** (`d824aec` deployed to Fly): CI's `check` job green against
the containerized build, then its `deploy` job green (`flyctl deploy`,
production version 34). A post-deploy smoke check against the live URL
(`https://comp4020-final-astra-erevos.fly.dev`), not just the local dev
server, confirmed: Laundry, AA Room, and Otter Room all render correctly,
panel and 3D canvas alike; an Otter Room `occupied` report with
`expectedEndAt` and a subsequent `empty` report both round-tripped
correctly; two independent browser sessions saw each other's report over
SSE with no reload; facility switching (Laundry/AA Room/Otter Room, both
directions) left every canvas intact; both sessions produced zero browser
console errors; `flyctl logs` showed each session's own distinct
pseudonym (`Toad-79D6CF`, `Toad-860755`) against its own `report
facility=otter-room ... result=ok` line, matching the browser that sent
it; and `/readme/` returned `200`.
