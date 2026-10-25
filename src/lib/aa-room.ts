import type { DatabaseSync } from "node:sqlite";
import { broadcast } from "./realtime.ts";
import { computeFreshness } from "./freshness.ts";
import {
  VALID_AA_ROOM_ACTIVITIES,
  type AaRoomActivity,
  type AaRoomOccupancy,
  type AaRoomState,
  type ReportableAaRoomOccupancy,
} from "./types.ts";

// AA Room — Toad Live's second facility. See
// notes/adr/0003-aa-room-live-state.md for the full decision this module
// implements. A single row (id is a fixed constant — the room has no
// sub-locations the way machines.ts has five), seeded once at startup by
// db.ts the same way machines are.
const AA_ROOM_ID = "aa-room";

// The raw stored row carries `activities` as a JSON TEXT blob (see
// db/schema.sql) — parsed into AaRoomActivity[] only at the toAaRoomState()
// boundary, same "parse at the edge" shape the rest of this module already
// uses for timestamps.
interface AaRoomRow {
  id: string;
  occupancy: AaRoomOccupancy;
  activities: string;
  confirmed_at: number | null;
  reporter_id: string | null;
  version: number;
}

// Dedup + canonical ordering (notes/adr/0003-aa-room-live-state.md,
// "Validity constraints"): every stored and returned `activities` array
// is normalized through this exact function — seed, report, decay, and
// every read alike — so two reports of the same set never look like a
// change, and nothing downstream (panel, 3D scene, tests, SSE/409
// payloads) ever has to compare arrays as sets instead of positionally.
// Exported so the API route can canonicalize a client's submitted array
// BEFORE running its own occupied/event-exclusivity validation — those
// checks must judge the deduped set, not the client's raw array (e.g.
// `["event", "event"]` should be judged as the valid exclusive set
// `["event"]`, not rejected for "looking like" two activities).
export function canonicalizeActivities(activities: readonly AaRoomActivity[]): AaRoomActivity[] {
  const present = new Set(activities);
  return VALID_AA_ROOM_ACTIVITIES.filter((activity) => present.has(activity));
}

function parseActivities(raw: string): AaRoomActivity[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return canonicalizeActivities(parsed.filter((value): value is AaRoomActivity =>
      (VALID_AA_ROOM_ACTIVITIES as readonly string[]).includes(value),
    ));
  } catch {
    return [];
  }
}

// Brings an already-deployed pre-v2 /data volume forward — see
// notes/adr/0003-aa-room-live-state.md, "Migrating the already-deployed
// v1 row." Mirrors db.ts's migrateVersionColumn() (PRAGMA table_info +
// conditional ALTER TABLE), but with a second, independent step: adding
// the column and backfilling it from the legacy `activity` column are two
// separate writes, and a process can restart between them, so "the column
// exists" is never treated as proof backfill already ran — only the
// row's own content (still at the column default while occupied) is.
// Safe to call unconditionally on every startup, including against a
// fresh database that never had an `activity` column at all (PRAGMA
// table_info then simply has nothing to add, and the row — not yet
// seeded — makes this a no-op until seedAaRoomIfEmpty() runs after it).
// The legacy `activity` column is deliberately left in place, not
// dropped — see the ADR: this keeps the migration reversible rather than
// destroying the pre-correction data in the same step that reinterprets
// it. New code never reads or writes it again.
export function migrateAaRoomActivitiesColumn(store: AaRoomStore): void {
  const columns = store.db.prepare("PRAGMA table_info(aa_room)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "activities")) {
    store.db.exec("ALTER TABLE aa_room ADD COLUMN activities TEXT NOT NULL DEFAULT '[]'");
  }

  const hasLegacyActivityColumn = (
    store.db.prepare("PRAGMA table_info(aa_room)").all() as Array<{ name: string }>
  ).some((column) => column.name === "activity");
  if (!hasLegacyActivityColumn) return; // fresh database — nothing to backfill from

  const row = store.db
    .prepare("SELECT occupancy, activity, activities FROM aa_room WHERE id = ?")
    .get(AA_ROOM_ID) as { occupancy: string; activity: string | null; activities: string } | undefined;
  if (!row) return; // not seeded yet — seedAaRoomIfEmpty() runs after this

  // A row only needs backfilling when it's occupied but activities is
  // still at the column default: empty/unknown rows always already
  // satisfy activities = '[]' under v1's own invariant (activity was
  // only ever set alongside occupancy = 'occupied'), so there is nothing
  // for those to backfill, and an already-backfilled occupied row has a
  // non-default activities value this check correctly leaves alone.
  if (row.occupancy !== "occupied" || row.activities !== "[]") return;

  const activities: AaRoomActivity[] =
    row.activity === "tv"
      ? ["tv"]
      : row.activity === "pool"
        ? ["pool"]
        : row.activity === "table-tennis"
          ? ["table-tennis"]
          : row.activity === "event"
            ? ["event"]
            : ["hanging-out"]; // occupied + activity NULL under v1 meant exactly this

  store.db
    .prepare("UPDATE aa_room SET activities = ? WHERE id = ?")
    .run(JSON.stringify(activities), AA_ROOM_ID);
}

// Every function below takes an explicit, required `store` — this module
// never imports src/lib/db.ts itself, deliberately: that's what lets
// spec/aa-room-decay.test.ts import this module for its pure
// logic/constants/store type (and the migration helper) without
// transitively opening a second real SQLite connection to the app's own
// on-disk database (see src/lib/aa-room-db.ts, the one place that wires
// these functions to that shared connection — only it, and real
// production call sites that import from it, ever touch db.ts). This is
// what lets a decay test build its own throwaway database (an in-memory
// node:sqlite instance, no file, no coordination with any other spec
// file's connection) and exercise the REAL decayedAaRoom()/getAaRoom()
// code path against it, instead of either mutating a process-wide DB_PATH
// (which Vitest's parallel test files would race on) or re-implementing
// the decay SQL a second time just for the test.
export interface AaRoomStore {
  db: DatabaseSync;
}

// Exposed so a test building its own throwaway database can seed it the
// same way db.ts's own seedIfEmpty() does for machines — never reported
// yet, so confirmed_at stays null rather than claiming a confirmation
// that never happened (same rule CLAUDE.md already states for machines).
// Idempotent: safe to call against a database that already has the row.
export function seedAaRoomIfEmpty(store: AaRoomStore): void {
  const existing = store.db.prepare("SELECT 1 FROM aa_room WHERE id = ?").get(AA_ROOM_ID);
  if (existing) return;
  store.db.prepare("INSERT INTO aa_room (id) VALUES (?)").run(AA_ROOM_ID);
}

// Lazily expire a stale observation — see the ADR, Decision 3. Unlike
// machines.ts's decayed(), there is no expected_end_at branch at all:
// nothing about AA Room gives any report an objective end time, so this
// is pure elapsed-time-since-confirmed_at for every occupancy value,
// "empty" included (machines.ts's out-of-order is sticky; AA Room has no
// sticky status at all — every value ages the same way).
//
// `now` defaults to the real clock — production never overrides it. A
// test passes a constructed `now` far enough past a real (but recent)
// confirmed_at to exercise this exact code path without waiting out the
// real 45-minute window and without touching the threshold constants
// themselves.
//
// Mirrors machines.ts's decayed(), broadcast included as of Stage 3: a
// decay transition is a real, canonical mutation — it increments
// `version` exactly like a resident's report does, and every other open
// session needs to see it too, not just whoever happened to trigger the
// read. See notes/adr/0003-aa-room-live-state.md and
// notes/adr/0001-realtime-and-concurrent-updates.md. Broadcasting against
// `store.db` directly (not the module's default `db`) means a test's own
// throwaway store never reaches the real app's subscriber list — there's
// nothing listening in that process either way, but this keeps a test
// store's mutations from ever being observable outside the store it
// actually wrote to, in principle as well as in practice.
function decayedAaRoom(
  row: AaRoomRow,
  now: number,
  store: AaRoomStore,
): AaRoomRow {
  if (row.occupancy === "unknown") return row;
  if (computeFreshness(row.occupancy, row.confirmed_at, now) !== null) return row;

  const { changes } = store.db
    .prepare(
      `UPDATE aa_room
       SET occupancy = 'unknown', activities = '[]', version = version + 1
       WHERE id = ? AND occupancy != 'unknown'`,
    )
    .run(row.id);

  // changes === 0 means something else already moved this row since it
  // was read (unreachable in a single synchronous process today, same
  // reasoning as machines.ts's decayed()) — re-read rather than assume a
  // stale view, and don't broadcast: nothing actually changed as a result
  // of this call.
  if (changes === 0) {
    return store.db.prepare("SELECT * FROM aa_room WHERE id = ?").get(row.id) as unknown as AaRoomRow;
  }

  const updated: AaRoomRow = { ...row, occupancy: "unknown", activities: "[]", version: row.version + 1 };
  broadcast({ kind: "aa-room", room: toAaRoomState(updated, now) });
  return updated;
}

function toAaRoomState(row: AaRoomRow, now: number): AaRoomState {
  return {
    occupancy: row.occupancy,
    activities: parseActivities(row.activities),
    confirmedAt: row.confirmed_at,
    version: row.version,
    freshness: computeFreshness(row.occupancy, row.confirmed_at, now),
  };
}

export function getAaRoom(now: number, store: AaRoomStore): AaRoomState {
  const row = store.db.prepare("SELECT * FROM aa_room WHERE id = ?").get(AA_ROOM_ID) as
    | AaRoomRow
    | undefined;
  if (!row) {
    // Should never happen in production — db.ts seeds this row at
    // startup — but a throwaway test store that forgot to seed should
    // fail loudly here, not return a fabricated state.
    throw new Error("aa_room row not seeded");
  }
  return toAaRoomState(decayedAaRoom(row, now, store), now);
}

export interface AaRoomReport {
  occupancy: ReportableAaRoomOccupancy;
  // Already validated and canonicalized (deduped, event-exclusivity,
  // occupied-requires-nonempty) by the API route before this is called —
  // see src/pages/api/aa-room.ts and notes/adr/0003-aa-room-live-state.md's
  // "Validity constraints." This function still independently forces
  // activities to [] whenever occupancy isn't "occupied" (below), so a
  // caller can never persist an inconsistent row even by mistake.
  activities: AaRoomActivity[];
  reporterId: string | null;
}

// Mirrors machines.ts's UpdateResult: an explicit tagged result rather
// than overloading undefined, since "no such row" and "your view was
// stale" need different HTTP responses.
export type AaRoomUpdateResult =
  | { ok: true; room: AaRoomState }
  | { ok: false; reason: "stale"; current: AaRoomState };

// A report is a confirmation event: confirmed_at moves to `now`.
// Activities are only ever written alongside "occupied" — the API route
// enforces this (and the full validity-constraint set) before calling
// here (mirrors machines.ts's reportStatus(), where startedAt/
// expectedEndAt only mean anything for "in-use"), but this function also
// forces activities to [] itself whenever occupancy isn't "occupied", so
// a caller can never persist an inconsistent row even by mistake.
//
// ifVersion-conditioned exactly like machines.ts's reportStatus(): the
// UPDATE's WHERE guard makes the write atomic against both another
// resident's report and the server's own lazy decay landing in between.
//
// Broadcasts exactly what this write just set, straight off the row —
// not through getAaRoom(), which would fold in any immediate decay
// before this report's own state ever got announced (mirrors
// machines.ts's reportStatus() on the same point). Only on changes === 1:
// a stale write (changes === 0, the `ok: false` branch below) made no
// real mutation, so there is nothing to tell anyone about.
export function reportAaRoomStatus(
  report: AaRoomReport,
  ifVersion: number,
  now: number,
  store: AaRoomStore,
): AaRoomUpdateResult {
  const activities = report.occupancy === "occupied" ? canonicalizeActivities(report.activities) : [];

  const { changes } = store.db
    .prepare(
      `UPDATE aa_room
       SET occupancy = ?, activities = ?, confirmed_at = ?, reporter_id = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    )
    .run(report.occupancy, JSON.stringify(activities), now, report.reporterId, AA_ROOM_ID, ifVersion);

  if (changes === 1) {
    const written = store.db.prepare("SELECT * FROM aa_room WHERE id = ?").get(AA_ROOM_ID) as unknown as AaRoomRow;
    const state = toAaRoomState(written, now);
    broadcast({ kind: "aa-room", room: state });
    return { ok: true, room: state };
  }

  return { ok: false, reason: "stale", current: getAaRoom(now, store) };
}
