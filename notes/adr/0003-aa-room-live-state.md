# ADR 0003: AA Room's shared live state

**Status**: Implemented and verified live, with one design correction
(see "Design correction, v2" below) made after Stage 4's 3D work exposed
that v1's single-activity model didn't match how the room is actually
used. Everything in Decision 2's occupancy rules, Decision 3's freshness
model, and Decision 4's inherited house-wide rules stands unchanged;
Decision 1 and part of Decision 2's activity list are superseded by the
correction. Verified live in the deployment headed by `d824aec` (CI
green, production version 34) — `PROCESS.md`'s own "Otter Room" entry,
which that commit closes out, records the post-deploy smoke check that
confirmed AA Room's report flow and cross-session SSE sync working live,
not just locally — and every facility-regression smoke check run for
each later facility (Rabbit Room through Rat Room) has continued to
re-confirm AA Room alongside the newer work — see each of those
milestones' own entries in `PROCESS.md`.

## Design correction, v2 — multiple simultaneous activities

v1 (below, kept for the record rather than silently rewritten — see
`PROCESS.md`'s "rewritten each time the project's shape genuinely
changed" convention) chose a single optional `activity` field and
explicitly rejected a "multi-activity checklist" alternative, reasoning
that it was the most accurate model of the room but too expensive to
report and render for v1's scope.

That rejection was a **mistake about the facts, not a tradeoff that aged
out**: AA Room is one large common room, and TV-watching, pool, table
tennis, and ordinary hanging-out are genuinely independent, simultaneous
uses by different people at the same time — the exact scenario Decision
1's "cost" section already named as the model's known gap, but treated as
an acceptable v1 loss rather than as something this common in practice.
Once that was clear, keeping a single-activity field wasn't "simpler,
sufficient for now" — it was actively wrong on the single most common
case (someone watching TV while two others play pool is not an edge
case in a shared common room; it's the default).

**Decision 1 is therefore reversed**, not narrowed: AA Room's `activity`
becomes `activities: AaRoomActivity[]`, with exactly one structural
exception carried over from the original design's instinct — **`event`**
(an organised, dorm-run activity) still exclusively occupies the whole
room, because that is a real, different fact about the room (a formal
event genuinely excludes incidental TV/pool/table-tennis/hanging-out
happening at the same time, unlike those four, which don't exclude each
other). So the model is now: an array of independent activity tags, with
`event` validated as mutually exclusive with everything else rather than
being "just a fifth tag."

**Decision 2's activity list** gains a fifth, newly-named value:
`hanging-out`. This is not a new concept — it is v1's unset/`null`
activity ("books-and-sofas passive use: present but nothing specific to
report") given an explicit name, because once activities can combine,
"no tag" can no longer mean "occupied, nothing to say": an occupied room
always needs **at least one** tag, and "ordinary presence, nothing
louder than chatting/sitting/reading" needs its own name to combine with
`tv`/`pool`/`table-tennis` the same way they combine with each other.

**Reporting cost**, the original rejection's stated concern, is accepted
as a real but worthwhile tradeoff now that the facts call for it: a
checkbox group is still a few taps, no new screen, no account step — it
does not compromise README's "a report should take seconds" the way the
original rejection worried a full checklist model might.

**Rendering cost**, the original rejection's other concern, turned out to
already be mostly paid for: Stage 4's 3D scene gives each activity its
own independent boolean flag (`tvOn`, `poolActive`, `tableTennisActive`)
precisely because each has its own animation loop that doesn't interact
with the others — showing several at once needed no new rendering model,
only new figure-placement bookkeeping so two simultaneously-active zones
don't place their figures on top of each other (see Mechanics, below,
and the 3D section's own note on the `hanging-out`/`tv` slot collision
this correction had to fix).

What follows is v1's original text, left as written, with a trailing
**"Superseded by the v2 correction above"** marker on anything the
correction actually changes, so the reasoning that led to v1 — and why it
was wrong — stays legible rather than disappearing.

**Status (v1)**: Decided — not yet implemented. This ADR fixes the state model,
statuses, and freshness rules for Toad Live's second facility before any
schema, API, or UI work begins, the same order Crit 9 and Crit 10 each
used (see ADR 0001, ADR 0002, and `PROCESS.md`'s "Rewritten each time the
project's shape genuinely changed" convention).

## Context

`FINAL_PROJECT_SOURCE_OF_TRUTH.md` §3 names the Anton Aalbers (AA) Room as
Toad Hall's large common room — television, pool table, table tennis,
books and sofas, "often used for Hall activities" — and §10 leaves "how
many non-laundry rooms" and "whether rooms are manually updated,
timer-driven or both" explicitly open. Laundry is Toad Live's only
facility with real shared state today (`README.md`); the other six,
including AA Room, are visible-but-disabled tabs in
`src/pages/index.astro` reserving their place, not shipped (see
PROCESS.md, "Laundry as the first facility, not the whole product").

AA Room is a materially different kind of thing than a washer or dryer,
and this ADR exists because that difference changes the model, not just
the data:

- a machine has one objective physical state a report merely transcribes;
  a common room's state is itself a social judgment call multiple people
  can read differently at the same moment;
- a machine's remaining time has an objective signal to read
  (`expected_end_at` from a washer's display, or a dryer owner's
  estimate — see `CLAUDE.md`); nothing about a common room gives any
  report an objective end time, so there is no equivalent field here at
  all — see Decision 3;
- a machine is used by one party at a time; a large common room can
  genuinely host more than one simultaneous use (someone watching
  television while two others play pool) — a constraint this ADR accepts
  rather than solves, see Decision 2's cost.

What this ADR does **not** decide: anything about the 3D scene's specific
geometry or animation (that's implementation, following the existing
`room.ts`/`camera-fit.ts`/`machine-mesh.ts` pattern once the state shape
below exists to drive it), and nothing about any facility after AA Room —
each gets its own interrogation against its own real facts, not a
template stamped out from this one.

## Decision 1 (v1, superseded by the v2 correction above) — state model: occupancy as primary, activity as optional enrichment

**Compared against three alternatives, all rejected:**

- **Occupancy only** (empty / occupied / unknown, no activity field at
  all). Rejected: it answers "worth walking over" but throws away exactly
  what `FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s own examples keep asking for —
  "is a common area being used for eating, studying or socialising,"
  "people playing in the Anton Aalbers Room." A resident who wants to join
  a pool game or avoid a loud TV crowd gets no signal to act on beyond
  "someone's there."
- **Activity only** (tv / pool / table-tennis / event / unspecified, no
  separate occupancy field — an unspecified activity standing in for
  "occupied, nothing particular to report"). Rejected: it conflates two
  different kinds of absence. "Nobody is here" and "people are here but
  there's nothing specific to report" are different facts a resident needs
  told apart, and collapsing them into one field means the fastest, most
  common report (the room is simply empty) has no honest value to select —
  a resident would have to pick a specific activity to say anything at
  all, which fights "easy to contribute to" (README.md) directly.
- **Multi-activity checklist** (a room can carry several simultaneous
  activity tags — e.g. `tv` and `pool` both set at once). Rejected for
  v1, not because it's a wrong model of the room's real nature — it's
  arguably the *most* accurate one, see this decision's cost below — but
  because it is the most expensive to report (a checklist, not one select,
  undermines "a report should take seconds, no account setup," README.md)
  and the most expensive to render consistently in both the panel and the
  3D scene (showing combinations, not one state, in a scene whose other
  facility — Laundry — has never needed to). `FINAL_PROJECT_SOURCE_OF_TRUTH.md`
  §10's "avoid an overly complicated taxonomy" instruction is explicit
  enough to treat this as the wrong place to start, not merely a
  nice-to-defer refinement.

**Chosen: occupancy is the required primary field; activity is a single
optional secondary field**, structurally the same shape Laundry already
proved — a required primary status (`available`/`in-use`/...) plus an
optional secondary enrichment (`expected_end_at`) that narrows, never
replaces, the primary fact. This is not an invented pattern for AA Room;
it's the existing one applied to a second facility, which keeps the panel,
the API shape, and the decay model all recognizable from Laundry's.

**Cost of this model, stated plainly, not discovered later:** a single
optional activity field cannot represent simultaneous uses of a large
common room. If the TV is on while a different group plays pool, only one
of those truths can be recorded at a time — whichever a resident last
reported overwrites the other, even though both remain physically true.
This is accepted as v1's deliberate scope boundary, the same way Laundry
accepted "report is a claim about a moment, not a ledger of all claims"
(ADR 0001, Decision 2) over an append-only model. If AA Room's actual use
turns out to need concurrent activities routinely, that's a v2 decision
with its own ADR and its own cost analysis — not a default this one
quietly assumes.

## Decision 2 — statuses: locked for v1

**Primary occupancy** — three values:

- `empty`
- `occupied`
- `unknown`

**Tri-level occupancy (`empty` / `some-people` / `busy`) was considered
and rejected for v1.** It would give a genuinely richer signal — how full
the room is changes whether it's worth going in a way a machine's binary
busy/free never needed to express — but it buys that richness at the cost
of subjective reporting disagreement a binary model doesn't have: two
residents glancing at the same room could reasonably disagree whether
three people reading on sofas counts as "some people" or "busy," and nothing
server-side can adjudicate a disagreement that's really about word choice,
not fact. `FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10's taxonomy caution and
README's "useful at a glance" both favor the model with the least room for
two honest reporters to produce conflicting-looking data about the same
real state. Nothing here forecloses a tri-level upgrade once real usage
shows binary is too coarse — it would be a straightforward additive
change to `VALID_OCCUPANCY_STATUSES`, not a redesign.

**`unknown` is not a reportable value.** A resident's `PATCH` may only set
`occupancy` to `empty` or `occupied` — `unknown` is rejected with `400` if
a client sends it. `unknown` remains part of the stored and public
`AaRoomOccupancy` type (seed state, and what a lazy decay transitions
into past 45 minutes — Decision 3), but it represents "there is currently
no sufficiently fresh observation," not an observation anyone makes. A
person cannot truthfully report "I don't know what this room looks like
right now" as an act of looking at the room — that's the absence of a
report, not a report, and letting a client `PATCH` it directly would let
a resident manufacture staleness instead of only ever being a product of
time passing without one. This mirrors `out-of-order`'s own asymmetry on
the machines side, in spirit if not in mechanics: there, a status exists
that only certain actions (not time) can produce; here, a status exists
that only the *absence* of action (time, specifically) can produce.

**Optional activity (v1, superseded — see the v2 correction at the top of
this ADR)** — four named values plus unset, each traced to one
of the room's given facts rather than invented:

- `tv` — television
- `pool` — pool table
- `table-tennis` — table tennis
- `event` — "often used for Hall activities": organised/group use,
  distinct from incidental lounging
- unset / `null` — covers books-and-sofas passive use: present but
  nothing specific to report, the activity field's actual default, not a
  gap in the taxonomy

Activity may only be set when occupancy is `occupied` — the API rejects
an `occupied: false`/`empty` report that also carries an activity tag,
the same shape Laundry already enforces for `startedAt`/`expectedEndAt`
only meaning anything when `status` is `in-use` (`src/lib/db.ts`,
`reportStatus()`). No `out-of-order`-equivalent status exists for AA
Room: nothing in the given facts raises broken furniture as a concern
this crit, and inventing an equipment-fault status here would be scope
`FINAL_PROJECT_SOURCE_OF_TRUTH.md` never asked for.

**Activities (v2 — current)** — five named values, `activities:
AaRoomActivity[]` on the state, replacing the single optional `activity`
above:

- `tv` — television
- `pool` — pool table
- `table-tennis` — table tennis
- `hanging-out` — ordinary presence: chatting, sitting, reading, eating,
  resting, general use with nothing louder going on. This is v1's
  unset/`null` meaning, now named rather than represented by an empty
  array, because `occupied` must always carry at least one tag (see
  below) — there is no longer a value-free way to mean "present, nothing
  specific."
- `event` — "often used for Hall activities": an organised, dorm-run
  activity that occupies the **entire room exclusively**. Unlike the
  other four, `event` cannot combine with anything else — when `event` is
  reported, none of `tv`/`pool`/`table-tennis`/`hanging-out` may also be
  true, because a formal event genuinely excludes incidental concurrent
  use the way the other four don't exclude each other.

**Validity constraints**, enforced server-side on every write (seed and
decay must also always produce a value obeying these, not just resident
reports):

- `occupancy: "empty"` → `activities` must be `[]`.
- `occupancy: "unknown"` → `activities` must be `[]` (decay's target,
  same as v1).
- `occupancy: "occupied"` → `activities` must be non-empty: at least one
  tag is always required once the room is reported occupied, since
  `hanging-out` now exists to name the "nothing specific" case explicitly
  rather than leaving it empty.
- `event` present → `activities` must be exactly `["event"]`; present
  alongside any other tag is rejected as a validation error, not silently
  resolved by dropping one side.
- `tv`, `pool`, `table-tennis`, `hanging-out` may appear together in any
  combination.
- `activities` is deduplicated and stored/returned in a fixed canonical
  order (`tv, pool, table-tennis, hanging-out, event`) regardless of the
  order a client submitted them in — so two reports of the same set never
  look like a change, and `version`/SSE/409 payloads are stable to
  compare.

No `out-of-order`-equivalent status exists for AA Room, same reasoning as
v1.

## Decision 3 — freshness: every report ages, including empty

Laundry's decay (`src/lib/db.ts`, `decayed()`) leans on an objective
signal — a washer's own display, or a dryer owner's deliberate estimate —
giving `expected_end_at` an exact expiry moment, with a provisional
12-hour fallback (`UNTIMED_IN_USE_DECAY_MS`) only for the untimed case.
**AA Room has no equivalent objective signal at all.** Nobody can read an
end time off a common-room hangout the way a washer's display gives one
off a wash cycle. This ADR does not try to invent one — AA Room's decay is
pure elapsed-time-since-`confirmed_at`, full stop, for every status.

This also breaks from Laundry's stickiness pattern in one specific way,
deliberately: **`empty` is not sticky.** Laundry's `out-of-order` persists
until an explicit new report because it models a real physical fact that
doesn't self-correct (a broken machine stays broken). An empty common room
models the opposite kind of fact — one of the most perishable observations
in the whole app, since a room can fill in the next five minutes with no
report of its own to say so. Treating `empty` as sticky would silently
misrepresent the room the longer nobody corrects it, exactly the kind of
unearned confidence README's freshness argument rejects. So every AA Room
status, `empty` included, ages and expires on the same clock — this ADR's
one explicit departure from a Laundry convention, stated here rather than
left to be noticed later.

**Thresholds — explicitly provisional, the same discipline as
`UNTIMED_IN_USE_DECAY_MS`** (`CLAUDE.md`: "do not invent decay/staleness
thresholds... if a number is needed to make something runnable, it must be
clearly marked provisional"):

- **under 15 minutes since `confirmed_at`**: `fresh` — shown plainly, no
  qualifier.
- **15–45 minutes**: `stale` — a derived **presentation** state, not a
  stored value (see below), shown with a visually distinct "probably still
  true, getting old" treatment in both the panel and the 3D scene.
- **over 45 minutes**: expired — the stored occupancy flips to `unknown`
  (and any activity tag is cleared with it) on the next ordinary read,
  exactly like Laundry's lazy, read-triggered decay: never a timer, never
  a connection event, only evaluated when `getAaRoom()`/`listAaRoom()`-
  equivalent runs.

`stale` is never written to the `occupancy` column and never appears as a
value the API accepts in a report — it is computed at read time from
`now - confirmed_at`, the same way `confirmedLabel()`/`remainingLabel()`
in `src/pages/index.astro` already compute "confirmed N min ago" purely
from a timestamp, never from a stored flag. This keeps the stored state
machine exactly the three/five values in Decision 2 while still
delivering `FINAL_PROJECT_SOURCE_OF_TRUTH.md` §5's "may gradually become
uncertain" idea — which Laundry's binary confirmed→unknown jump has never
actually implemented — as a display concern layered on existing data, not
a new stored status requiring its own decay logic.

**A two-value `fresh | stale` freshness type cannot represent "never
reported" or "already expired to `unknown`."** Both are real states —
the seed row, and any room past 45 minutes — and neither has a
meaningful age to grade as fresh or stale; forcing one onto them would be
inventing a judgment about data that doesn't exist. `freshness` is
therefore `"fresh" | "stale" | null`, where `null` means "there is
currently no fresh-enough observation to grade" — occupancy is `unknown`,
whether from the initial seed (`confirmed_at` is also `null` there, same
"don't default to now at seed time" rule as Laundry) or from decay having
already fired. `confirmed_at` is never cleared or overwritten to produce
this — it keeps recording the actual last-confirmation time (or stays
`null` if there never was one) regardless of what `freshness` reports;
`freshness` is purely a read-time function of `(occupancy, confirmed_at,
now)`, never a reason to touch the stored timestamp.

These three numbers (15 / 45) are a starting point only. They are not
derived from any AA Room usage data — none exists yet — and must be
revisited once real reports accumulate, exactly like
`UNTIMED_IN_USE_DECAY_MS`'s own provisional status. `PROCESS.md` will
record this ADR and flag these specific numbers the same way.

## Decision 4 — inherited house-wide rules, not re-litigated here

The following apply to AA Room exactly as already decided for Laundry,
and this ADR does not reopen them:

- **identity**: the actor is the server-resolved session
  (`sessions.id`/pseudonym), never a client-supplied field — ADR 0002,
  unchanged.
- **concurrency**: optimistic concurrency via `version`/`ifVersion`,
  `409` with current canonical state on a stale write — ADR 0001,
  Decision 2, unchanged. AA Room's row gets its own `version` column,
  starting at 1, under the exact same rules `CLAUDE.md` already states
  for `machines.version`.
- **decay trigger**: lazy, read-triggered only — never a timer, never an
  SSE connection event. Decision 3 above only changes *what* decays and
  *how long it takes*, never *when* decay is evaluated.
- **transport**: the one existing SSE connection
  (`GET /api/stream`, `src/lib/realtime.ts`) carries AA Room's updates
  too — no second `EventSource`, no second subscriber list. See Mechanics
  below for how the two facilities' events are told apart on the wire.
- **logging**: every AA Room report attempt — accepted or rejected — gets
  a `[toadlive]` log line in `src/lib/log.ts`'s existing format, naming the
  actor pseudonym, outcome, and resulting state, the same shape
  `formatReportOutcome`/`formatReportRejected` already produce for
  machines. A lazy decay transition is not separately logged, matching
  Laundry: `logReportOutcome`/`logReportRejected` only fire on an actual
  resident-initiated `PATCH`, and nothing in ADR 0002 logs a machine's own
  `decayed()` transition either.
- **no client-asserted identity**: a request body naming an actor for an
  AA Room report is rejected exactly like a `reporterId` in a machine
  `PATCH` — `400`, not silently dropped.

## Mechanics (v2 — current; v1's original proposal kept below for the record)

**Schema** — `aa_room`, a single row (the room has no sub-locations the
way Laundry has five):

```sql
CREATE TABLE IF NOT EXISTS aa_room (
  id            TEXT PRIMARY KEY DEFAULT 'aa-room',
  occupancy     TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  activities    TEXT NOT NULL DEFAULT '[]',
  confirmed_at  INTEGER,
  reporter_id   TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
```

`activities` is a JSON-encoded array of `AaRoomActivity` strings (e.g.
`'["tv","hanging-out"]'`), not a join table: AA Room is one row with no
need to query activities relationally, so a second table would be pure
plumbing. `CHECK` cannot express "non-empty iff occupied," "`event`
iff alone," or "deduplicated/canonically ordered" cleanly against a JSON
column, so — same as v1's choice for the single-`activity` version — all
of that lives in the application layer (`reportAaRoomStatus()`), not in
SQL.

No `started_at`/`expected_end_at` columns, same reasoning as v1 (Decision
3: no objective end-time signal for this facility).

**Migrating the already-deployed v1 row** — the production `/data`
SQLite file has an `aa_room` table with the old `activity TEXT` column
and real data in it, created before this correction existed. Mirrors
`migrateVersionColumn()` in `src/lib/db.ts` (`PRAGMA table_info` +
conditional `ALTER TABLE`), with one addition that plain
`migrateVersionColumn()` didn't need: a way to tell "column added" apart
from "column added **and** backfilled," since those are two separate
steps now and a process can restart between them.

```ts
function migrateAaRoomActivitiesColumn(store: AaRoomStore): void {
  const columns = store.db.prepare("PRAGMA table_info(aa_room)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "activities")) {
    store.db.exec("ALTER TABLE aa_room ADD COLUMN activities TEXT NOT NULL DEFAULT '[]'");
  }
  // Backfill is keyed off actual row content, not "the column exists" —
  // an ADD COLUMN that commits followed by a process crash before the
  // backfill UPDATE runs must not be mistaken for "already migrated."
  // A row is backfillable exactly when its legacy `activity` column
  // still holds a real value this logic hasn't translated yet, OR
  // `activities` is still at the column default `'[]'` while occupancy
  // is 'occupied' (the one case the old schema could represent that an
  // empty array cannot) — re-running this against an already-backfilled
  // row is a no-op either way, so it's safe to call unconditionally
  // every startup, not just once after the ALTER TABLE.
  const row = store.db.prepare("SELECT occupancy, activity, activities FROM aa_room WHERE id = 'aa-room'").get() as
    | { occupancy: string; activity: string | null; activities: string }
    | undefined;
  if (!row) return; // not seeded yet — seedAaRoomIfEmpty() runs after this
  const alreadyMigrated = row.activities !== "[]" || row.occupancy !== "occupied";
  if (alreadyMigrated) return;

  const activities =
    row.activity === "tv" ? ["tv"]
    : row.activity === "pool" ? ["pool"]
    : row.activity === "table-tennis" ? ["table-tennis"]
    : row.activity === "event" ? ["event"]
    : ["hanging-out"]; // occupied + activity NULL under v1 meant exactly this
  store.db
    .prepare("UPDATE aa_room SET activities = ? WHERE id = 'aa-room'")
    .run(JSON.stringify(activities));
}
```

The legacy `activity` column is **kept, not dropped**, this round: the
`ALTER TABLE ... DROP COLUMN` step is deliberately deferred so the
migration is reversible if anything about the backfill mapping turns out
wrong after a real deploy. New code never reads or writes `activity`
again — `empty`/`unknown` rows always already satisfy `activities =
'[]'` (v1 only ever set `activity` alongside `occupancy = 'occupied'`,
same as the `alreadyMigrated` check above assumes), so there is nothing
further to backfill for them. A fresh database (CI, a new deploy with no
prior `/data` volume) gets the schema above directly from `schema.sql`
and never has an `activity` column to migrate away from at all.

**Types** (`src/lib/types.ts`, additive, no changes to the existing
`Machine`/`MachineStatus` exports):

```ts
export type AaRoomOccupancy = "empty" | "occupied" | "unknown";
export type AaRoomActivity = "tv" | "pool" | "table-tennis" | "hanging-out" | "event";
export const VALID_AA_ROOM_OCCUPANCIES: readonly AaRoomOccupancy[] =
  ["empty", "occupied", "unknown"];
// Canonical order — also the order dedup/sort normalizes every stored
// and returned `activities` array into, so two reports of the same set
// never read as a change and every consumer (panel, 3D scene, tests) can
// compare arrays positionally instead of as sets.
export const VALID_AA_ROOM_ACTIVITIES: readonly AaRoomActivity[] =
  ["tv", "pool", "table-tennis", "hanging-out", "event"];

// Only empty/occupied are ever accepted from a client — see Decision 2's
// "unknown is not a reportable value." unknown stays in the type because
// it's a real stored/public value (seed state, and decay's target), just
// never one a PATCH body may name.
export type ReportableAaRoomOccupancy = Extract<AaRoomOccupancy, "empty" | "occupied">;

export interface AaRoomState {
  occupancy: AaRoomOccupancy;
  // Canonically deduplicated and ordered (see VALID_AA_ROOM_ACTIVITIES) —
  // never the raw, as-submitted order a client's PATCH body carried.
  activities: AaRoomActivity[];
  confirmedAt: number | null;
  version: number;
  // Derived at read time from (occupancy, confirmedAt, now) — never
  // stored, never accepted from a client. null means there is currently
  // no fresh-enough observation to grade (occupancy is "unknown", whether
  // from the initial seed or from decay). See Decision 3.
  freshness: "fresh" | "stale" | null;
}

// Pure, independent of the system clock — a deadline passed in, not read
// internally — specifically so both this logic and its tests can use
// constructed timestamps rather than real elapsed time. Mirrors how
// confirmedLabel()/remainingLabel() in src/pages/index.astro are already
// pure functions of (timestamp, now), not stateful.
export function computeFreshness(
  occupancy: AaRoomOccupancy,
  confirmedAt: number | null,
  now: number,
): "fresh" | "stale" | null {
  if (occupancy === "unknown" || confirmedAt === null) return null;
  const ageMs = now - confirmedAt;
  if (ageMs < AA_ROOM_FRESH_MS) return "fresh";
  if (ageMs < AA_ROOM_EXPIRE_MS) return "stale";
  return null; // past the expiry window — the next read's decay will
               // have already moved occupancy to "unknown" by the time
               // anything calls this on stored state; returning null
               // here too keeps the function correct even if called
               // against a not-yet-decayed row mid-transition.
}
```

(`reporterId` stays internal-only, exactly as `Machine` already omits it
from its public shape — ADR 0002.)

**API** — mirrors `src/pages/api/machines/[id].ts`'s existing shape, as a
new route rather than overloading the machines one (AA Room is not a
machine and has no `id` path segment to key off — it is the one row):

- `GET /api/aa-room` → the current `AaRoomState`, decay applied lazily on
  read exactly like `getMachine()`. `activities` is always canonically
  deduplicated/ordered (see Types above).
- `PATCH /api/aa-room` → body `{ occupancy, activities?, ifVersion }`.
  Validation, in order:
  1. a valid session is required → `401` before the body is parsed;
  2. `occupancy` must be `"empty"` or `"occupied"` — `"unknown"` (or
     anything else) is rejected `400`, per Decision 2's "unknown is not a
     reportable value";
  3. a body carrying any actor-identifying field → `400`, logged as a
     rejected client-actor-claim;
  4. `activities`, if present, must be an array whose every element is
     one of the five valid values — otherwise `400`;
  5. the array is deduplicated and canonically sorted (see Types above) —
     this happens before the next two checks, so a client sending
     `["event", "event"]` or out-of-order combinations is judged on its
     actual resulting set, not its literal submitted array;
  6. `occupancy: "empty"` requires the (deduped) array to be empty —
     `400` otherwise;
  7. `occupancy: "occupied"` requires the (deduped) array to be
     non-empty — `400` otherwise ("at least one activity is required
     when occupied" — `hanging-out` is always available as the "nothing
     specific" choice);
  8. if `"event"` is present, the array must be exactly `["event"]` —
     `400` ("event cannot be combined with other activities") otherwise;
  9. `ifVersion` validated by the exact same `isSafePositiveInteger`
     guard already shared by `startedAt`/`expectedEndAt` (`CLAUDE.md`:
     "any new field that stores a client-provided number needs the same
     guard").

  A stale `ifVersion` → `409` with the current canonical `AaRoomState`
  (activities canonically ordered, same as every other response).

**SSE** — the existing single stream (`GET /api/stream`) carries both
facilities. Two ways to tell AA Room's events apart from a machine's were
considered:

- **a tagged union inside the existing `event: machine` name** (e.g. a
  `kind: "machine" | "aa-room"` discriminator field on one broadcast
  payload shape). Rejected: it would force every existing listener
  (`src/pages/index.astro`'s `events.addEventListener("machine", ...)`,
  `spec/realtime.test.ts`'s event-reading helpers) to add a discriminator
  check it doesn't need today, for a case (AA Room state) it previously
  had no reason to see at all — a change to Laundry's own wire contract
  to make room for an unrelated facility.
- **Chosen: a second named SSE event, `event: aa-room`, over the same
  connection.** Checked directly against the current code rather than
  assumed: as it stands today, `src/lib/realtime.ts`'s `Subscriber` type
  and `broadcast()` are concretely typed to `Machine`, not
  payload-shape-agnostic —

  ```ts
  type Subscriber = (machine: Machine) => void;
  export function broadcast(machine: Machine): void { ... }
  ```

  so carrying a second payload shape over the same subscriber list
  requires widening this module first: `Subscriber` becomes
  `(payload: Machine | AaRoomState) => void` (or a small discriminated
  union, e.g. `{ kind: "machine"; machine: Machine } | { kind: "aa-room";
  room: AaRoomState }`, decided at implementation time by whichever reads
  more clearly at the two call sites), and `src/pages/api/stream.ts`'s one
  `subscribe()` callback dispatches to `event: machine` or `event: aa-room`
  based on the payload it receives. This is still one connection, one
  subscriber list, one `: connected` comment on connect (see `885da13`),
  and the wire-level `machine` event name and its JSON shape are
  unchanged — so every existing listener and test keyed on `event:
  machine` is unaffected — but it is a real, if small, change to
  `realtime.ts` itself, not a reuse of an already-generic interface.

**Decay** — a `decayedAaRoom()` function parallel to `decayed()` in
`src/lib/db.ts`, but keyed only to `confirmed_at` (no `expected_end_at`
branch at all, per Decision 3): past 45 minutes, `UPDATE aa_room SET
occupancy = 'unknown', activities = '[]', version = version + 1 WHERE id
= 'aa-room' AND occupancy != 'unknown'`, broadcasting the result exactly
like Laundry's decay broadcasts a machine transition. The 15/45-minute
constants live beside `UNTIMED_IN_USE_DECAY_MS`, marked provisional in
the same comment style.

**SSE/409 payload shape** — unchanged structurally from v1 below: still
one `event: aa-room` name on the existing connection, still the same
`BroadcastPayload` discriminated union in `src/lib/realtime.ts`. Only the
`AaRoomState` shape it carries changes (`activity` → `activities`), which
every existing listener already treats as an opaque JSON payload it
re-renders from, not a shape it pattern-matches structurally.

## v1's original Mechanics proposal (superseded by v2 above, kept for the record)

**Schema** — one new table, `aa_room`, a single row (the room has no
sub-locations the way Laundry has five), following `machines`' column
shape where the concepts line up:

```sql
CREATE TABLE IF NOT EXISTS aa_room (
  id            TEXT PRIMARY KEY DEFAULT 'aa-room',
  occupancy     TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  activity      TEXT
                  CHECK (activity IN ('tv', 'pool', 'table-tennis', 'event')),
  confirmed_at  INTEGER,
  reporter_id   TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
```

No `started_at`/`expected_end_at` columns at all — Decision 3 established
there is no objective end-time signal for this facility, unlike Laundry,
so these columns would exist with no way to ever populate them honestly.
A `CHECK` enforcing "activity only set when occupancy = 'occupied'" is
left to the application layer (`reportAaRoomStatus()`), the same place
Laundry enforces "`started_at`/`expected_end_at` only meaningful for
`in-use`" today — SQLite's `CHECK` syntax cannot easily express a
cross-column conditional constraint, and the existing codebase doesn't
reach for that device elsewhere either.

Seeded once, like `machines`: `occupancy = 'unknown'`, `activity = NULL`,
`confirmed_at = NULL` — never reported yet, same "don't default
`confirmed_at` to now at seed time" rule `CLAUDE.md` already states for
machines.

**Types** (`src/lib/types.ts`, additive, no changes to the existing
`Machine`/`MachineStatus` exports):

```ts
export type AaRoomOccupancy = "empty" | "occupied" | "unknown";
export type AaRoomActivity = "tv" | "pool" | "table-tennis" | "event";
export const VALID_AA_ROOM_OCCUPANCIES: readonly AaRoomOccupancy[] =
  ["empty", "occupied", "unknown"];
export const VALID_AA_ROOM_ACTIVITIES: readonly AaRoomActivity[] =
  ["tv", "pool", "table-tennis", "event"];

export type ReportableAaRoomOccupancy = Extract<AaRoomOccupancy, "empty" | "occupied">;

export interface AaRoomState {
  occupancy: AaRoomOccupancy;
  activity: AaRoomActivity | null;
  confirmedAt: number | null;
  version: number;
  freshness: "fresh" | "stale" | null;
}
```

**API** — `GET /api/aa-room` returns the current `AaRoomState`; `PATCH
/api/aa-room` body `{ occupancy, activity?, ifVersion }`, with `activity`
restricted to the four original values and only ever set alongside
`occupancy: "occupied"`.

**SSE** — a second named SSE event, `event: aa-room`, over the existing
`GET /api/stream` connection, via a discriminated `BroadcastPayload`
union in `src/lib/realtime.ts`.

**Decay** — `UPDATE aa_room SET occupancy = 'unknown', activity = NULL,
version = version + 1 WHERE id = 'aa-room' AND occupancy != 'unknown'`
past 45 minutes since `confirmed_at`.

## Consequences

AA Room gets its own table, route, and SSE event name rather than being
squeezed into the `machines` shape — the right call given Decision 1's
model is genuinely different (no per-location rows, no `expected_end_at`
concept), but it does mean the panel and 3D-scene code introduce a second
state shape to keep in sync with the server, not a drop-in reuse of
Laundry's `applyMachineUpdate()`. The binary occupancy choice (Decision
2) remains a deliberate simplification, trading away the richer "how
full" signal tri-level would give in exchange for reports that don't
require two honest residents to agree on a subjective word. Under the
current (v2) `activities: AaRoomActivity[]` model, multi-activity
reporting means a resident reporting `pool` while the TV is genuinely
also on no longer overwrites the TV report — the single-optional-activity
limitation v1 accepted as a real information loss is resolved, at the
cost of a slightly higher reporting cost: an occupied report now chooses
one or more activity tags rather than at most one. `event` remains the
one exception, still exclusive with everything else, because a formal,
dorm-run event is a genuinely different fact about the room than
incidental simultaneous TV/pool/table-tennis/hanging-out use (Design
correction, v2). Every report expiring, `empty` included (Decision 3),
means AA Room's `unknown` state will appear more often, proportionally,
than Laundry's — this is judged correct given the room's actual
volatility, not a flaw to tune away by making decay more lenient than the
facts warrant; this consequence is unchanged by the v2 correction.

## Verification (completed)

Coverage mirroring ADR 0001/0002's own verification, staged per
PROCESS.md's convention:

- automated: a persistence test (a report survives an independent later
  `GET`, mirroring Crit 8's own laundry check); `ifVersion`/409 conflict
  coverage identical in shape to `spec/concurrency.test.ts`; a `PATCH`
  rejection test for `occupancy: "unknown"` (Decision 2); unit tests for
  `computeFreshness()` as pure logic against constructed timestamps, no
  real waiting — `now - confirmedAt` at 14:59 → `"fresh"`, at 15:00 →
  `"stale"`, at 44:59 → `"stale"`, at 45:00+ → `null`, plus
  `occupancy: "unknown"` → `null` regardless of `confirmedAt`, and
  `confirmedAt: null` → `null` regardless of occupancy; identity/permission
  tests mirroring `spec/identity.test.ts` (no session → 401, forged actor
  field → 400).

  **The 45-minute decay transition itself was harder to test, and the
  question of how was worked through rather than glossed over.** Checked
  directly rather than assumed: `spec/decay.test.ts`'s existing decay test does
  **not** backdate a timestamp — it reports a *real*, short
  `expectedEndAt` (`SAFE_FUTURE_MS`, ~1 second) and polls with ordinary
  reads until decay actually fires, which works there only because a
  machine's own decay deadline (`expectedEndAt`) is a value the reporting
  client sets per-request to anything it likes. AA Room's 45-minute
  threshold (Decision 3) is a fixed constant, not a per-report field, so
  the same technique doesn't carry over, and `spec/`'s tests only ever
  talk HTTP to a running app (`spec/global-setup.ts`) with no existing
  path to write `confirmed_at` directly into the past —
  `spec/request-protocol.test.ts`'s own comment notes that importing
  `db.ts` from a spec file opens a second, independent SQLite connection,
  which is exactly the complication the current `spec/` tests avoid by
  staying HTTP-only. Two honest paths were open: (a) make the 15/45-minute
  constants overridable via an environment variable the way nothing in
  this codebase currently does, so a test can set a sub-second threshold
  and use `spec/decay.test.ts`'s own real-wait-and-poll pattern against
  it; or (b) keep the threshold fixed and test the decay *transition's*
  SQL logic directly against a throwaway `DatabaseSync` instance outside
  `spec/`'s HTTP-only convention (closer to a true unit test, further
  from how every existing spec file is structured). **Path (b) was taken:**
  `spec/aa-room-decay.test.ts` builds its own throwaway in-memory database
  and calls the real `getAaRoom()`/`reportAaRoomStatus()` against it with
  a constructed `now`, exercising the actual `decayedAaRoom()` code path
  directly rather than a reimplementation of its logic in the test — the
  same throwaway-store technique every later occupancy room's own
  `*-decay.test.ts` file has since used;
- an SSE test confirming an already-open stream receives `event: aa-room`
  on a resident report, using the same connect-before-mutate pattern
  `spec/realtime.test.ts` now uses (see `885da13`); the equivalent
  decay-delivery case exercises the same `spec/aa-room-decay.test.ts`
  throwaway-store technique resolved above;
- manual, live: two Chrome profiles reporting AA Room state and
  confirming each other's update arrives without reload, narrated from
  `flyctl logs` exactly as ADR 0002's Crit 10 verification was — part of
  the same post-deploy smoke check `PROCESS.md`'s "Otter Room" entry
  records for `d824aec`.
