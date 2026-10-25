import type { DatabaseSync } from "node:sqlite";
import { broadcast } from "./realtime.ts";
import type { RabbitRoomOccupancy, RabbitRoomState, ReportableRabbitRoomOccupancy } from "./types.ts";

// Rabbit Room — Toad Live's fourth facility. See
// notes/adr/0005-rabbit-room-live-state.md for the full decision this
// module implements. A single row (id is a fixed constant — the room has
// no sub-locations), seeded once at startup by this module the same way
// machines/aa_room/otter_room are seeded.
const RABBIT_ROOM_ID = "rabbit-room";

// Real-world community norm (FINAL_PROJECT_SOURCE_OF_TRUTH.md), confirmed
// for Rabbit Room specifically, not inferred from Otter Room's own figure:
// a single Rabbit Room use typically doesn't run past four hours. Do NOT
// mark this PROVISIONAL or treat it like UNTIMED_IN_USE_DECAY_MS
// (src/lib/db.ts). It applies whether or not a resident supplied an
// expectedEndAt — see ADR 0005, Decision 2.
export const RABBIT_ROOM_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, re-derived for Rabbit Room's own
// volatility (ADR 0005, Decision 2) — settled, not provisional, but not a
// pre-existing Rabbit Room norm either. Lands on the same number as Otter
// Room's OTTER_ROOM_EMPTY_DECAY_MS because the reasoning (an empty report
// can be overtaken by the next residents walking in at any moment) was
// independently judged to apply here too, not because this value was
// copied.
export const RABBIT_ROOM_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes

interface RabbitRoomRow {
  id: string;
  occupancy: RabbitRoomOccupancy;
  expected_end_at: number | null;
  confirmed_at: number | null;
  reporter_id: string | null;
  version: number;
}

// Every function below takes an explicit, required `store` — this module
// never imports src/lib/db.ts itself, deliberately: that's what lets
// spec/rabbit-room-decay.test.ts import this module for its pure
// logic/constants/store type without transitively opening a second real
// SQLite connection to the app's own on-disk database (see
// src/lib/rabbit-room-db.ts, the one place that wires these functions to
// that shared connection — only it, and real production call sites that
// import from it, ever touch db.ts). Mirrors src/lib/otter-room.ts's own
// OtterRoomStore split the same way.
export interface RabbitRoomStore {
  db: DatabaseSync;
}

// Exposed so a test building its own throwaway database can seed it the
// same way db.ts/otter-room.ts seed theirs — never reported yet, so
// confirmed_at stays null rather than claiming a confirmation that never
// happened (CLAUDE.md). Idempotent: safe to call against a database that
// already has the row.
export function seedRabbitRoomIfEmpty(store: RabbitRoomStore): void {
  const existing = store.db.prepare("SELECT 1 FROM rabbit_room WHERE id = ?").get(RABBIT_ROOM_ID);
  if (existing) return;
  store.db.prepare("INSERT INTO rabbit_room (id) VALUES (?)").run(RABBIT_ROOM_ID);
}

// The effective expiry moment for a row that isn't already "unknown" — see
// ADR 0005, Decision 2's decided formula:
//  - "empty" expires confirmedAt + 15 minutes after confirmation, full
//    stop — a product freshness judgement, not a community norm.
//  - "occupied" expires at min(expectedEndAt, confirmedAt + 4h): a
//    resident's own estimate can end the report earlier than the 4-hour
//    ceiling, but can never extend it past the ceiling.
// confirmed_at is only ever null here for a row the first `occupancy !==
// "unknown"` guard in decayedRabbitRoom() already excludes — the `?? now`
// fallback exists purely so this function stays total, mirroring
// src/lib/otter-room.ts's own expiresAt().
function expiresAt(row: RabbitRoomRow, now: number): number {
  const confirmedAt = row.confirmed_at ?? now;
  if (row.occupancy === "empty") return confirmedAt + RABBIT_ROOM_EMPTY_DECAY_MS;
  return Math.min(row.expected_end_at ?? Infinity, confirmedAt + RABBIT_ROOM_MAX_OCCUPIED_MS);
}

// Lazily expire a stale observation — see the ADR, Decision 2. Mirrors
// decayedOtterRoom()'s shape: a decay transition is a real, canonical
// mutation, so it increments `version` and broadcasts exactly like a
// resident's report does. Runs on ordinary reads only — never a timer,
// never a connection event (ADR 0005, Decision 4).
//
// `now` defaults to the real clock — production never overrides it. A
// test passes a constructed `now` to exercise this code path without
// waiting out the real thresholds.
function decayedRabbitRoom(row: RabbitRoomRow, now: number, store: RabbitRoomStore): RabbitRoomRow {
  if (row.occupancy === "unknown") return row;
  if (now <= expiresAt(row, now)) return row;

  const { changes } = store.db
    .prepare(
      `UPDATE rabbit_room
       SET occupancy = 'unknown', expected_end_at = NULL, version = version + 1
       WHERE id = ? AND occupancy != 'unknown'`,
    )
    .run(row.id);

  // changes === 0 means something else already moved this row since it
  // was read (unreachable in a single synchronous process today, same
  // reasoning as otter-room.ts's own decay function) — re-read rather
  // than assume a stale view, and don't broadcast: nothing actually
  // changed as a result of this call.
  if (changes === 0) {
    return store.db.prepare("SELECT * FROM rabbit_room WHERE id = ?").get(row.id) as unknown as RabbitRoomRow;
  }

  const updated: RabbitRoomRow = { ...row, occupancy: "unknown", expected_end_at: null, version: row.version + 1 };
  broadcast({ kind: "rabbit-room", room: toRabbitRoomState(updated) });
  return updated;
}

function toRabbitRoomState(row: RabbitRoomRow): RabbitRoomState {
  return {
    occupancy: row.occupancy,
    expectedEndAt: row.expected_end_at,
    confirmedAt: row.confirmed_at,
    version: row.version,
  };
}

export function getRabbitRoom(now: number, store: RabbitRoomStore): RabbitRoomState {
  const row = store.db.prepare("SELECT * FROM rabbit_room WHERE id = ?").get(RABBIT_ROOM_ID) as
    | RabbitRoomRow
    | undefined;
  if (!row) {
    // Should never happen in production — this module seeds this row at
    // startup — but a throwaway test store that forgot to seed should
    // fail loudly here, not return a fabricated state.
    throw new Error("rabbit_room row not seeded");
  }
  return toRabbitRoomState(decayedRabbitRoom(row, now, store));
}

export interface RabbitRoomReport {
  occupancy: ReportableRabbitRoomOccupancy;
  // Already validated by the API route before this is called (range,
  // safe-integer-ness) — see src/pages/api/rabbit-room.ts and ADR 0005,
  // Decision 2. This function still independently forces expectedEndAt to
  // null whenever occupancy isn't "occupied" (below), so a caller can
  // never persist an inconsistent row even by mistake.
  expectedEndAt: number | null;
  reporterId: string | null;
}

// Mirrors otter-room.ts's OtterRoomUpdateResult: an explicit tagged
// result rather than overloading undefined, since "your view was stale"
// needs a distinct HTTP response.
export type RabbitRoomUpdateResult =
  | { ok: true; room: RabbitRoomState }
  | { ok: false; reason: "stale"; current: RabbitRoomState };

// A report is a confirmation event: confirmed_at moves to `now`.
// expectedEndAt is per-observation, never inherited across reports (ADR
// 0005, Decision 2) — every report fully replaces the stored
// expected_end_at from the values passed in, never by reading or
// preserving whatever the row previously held. It is only ever written
// non-null when occupancy is "occupied" and the caller supplied one;
// every other case (an "empty" report, or an "occupied" report with no
// estimate) stores NULL, even if the row being overwritten currently
// holds a value from an earlier report.
//
// ifVersion-conditioned exactly like otter-room.ts's own report function:
// the UPDATE's WHERE guard makes the write atomic against both another
// resident's report and the server's own lazy decay landing in between.
//
// Broadcasts exactly what this write just set, straight off the row —
// not through getRabbitRoom(), which would fold in any immediate decay
// before this report's own state ever got announced. Only on
// changes === 1: a stale write (changes === 0, the `ok: false` branch
// below) made no real mutation, so there is nothing to tell anyone about.
export function reportRabbitRoomStatus(
  report: RabbitRoomReport,
  ifVersion: number,
  now: number,
  store: RabbitRoomStore,
): RabbitRoomUpdateResult {
  const expectedEndAt = report.occupancy === "occupied" ? (report.expectedEndAt ?? null) : null;

  const { changes } = store.db
    .prepare(
      `UPDATE rabbit_room
       SET occupancy = ?, expected_end_at = ?, confirmed_at = ?, reporter_id = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    )
    .run(report.occupancy, expectedEndAt, now, report.reporterId, RABBIT_ROOM_ID, ifVersion);

  if (changes === 1) {
    const written = store.db.prepare("SELECT * FROM rabbit_room WHERE id = ?").get(RABBIT_ROOM_ID) as unknown as RabbitRoomRow;
    const state = toRabbitRoomState(written);
    broadcast({ kind: "rabbit-room", room: state });
    return { ok: true, room: state };
  }

  return { ok: false, reason: "stale", current: getRabbitRoom(now, store) };
}
