import type { DatabaseSync } from "node:sqlite";
import { broadcast } from "./realtime.ts";
import type { BadgerRoomOccupancy, BadgerRoomState, ReportableBadgerRoomOccupancy } from "./types.ts";

// Badger Room — Toad Live's sixth facility. See
// notes/adr/0007-badger-room-live-state.md for the full decision this
// module implements. A single row (id is a fixed constant — the room has
// no sub-locations), seeded once at startup by this module the same way
// machines/aa_room/otter_room/rabbit_room/weasel_room are seeded.
const BADGER_ROOM_ID = "badger-room";

// Real-world community norm (FINAL_PROJECT_SOURCE_OF_TRUTH.md), confirmed
// for Badger Room specifically, not inferred from any other room's own
// figures: a single Badger Room use typically doesn't run past four
// hours. Do NOT mark this PROVISIONAL or treat it like
// UNTIMED_IN_USE_DECAY_MS (src/lib/db.ts). It applies whether or not a
// resident supplied an expectedEndAt — see ADR 0007, Decision 2.
export const BADGER_ROOM_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, independently re-derived for this
// room (ADR 0007, Decision 2) — settled, not provisional. Unlike every
// prior room, Badger Room is explicitly NOT frequently booked, a
// different fact than any of those rooms' own briefs stated, so this
// number was reasoned through fresh rather than carried over: low
// booking frequency bears on prior occupancy probability, not on how
// long one "confirmed empty" sighting stays authoritative for a room
// with no fixed schedule. Lands on the same number as every other
// facility's own empty-decay figure, but by that independent argument,
// not because the value was copied.
export const BADGER_ROOM_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes

interface BadgerRoomRow {
  id: string;
  occupancy: BadgerRoomOccupancy;
  expected_end_at: number | null;
  confirmed_at: number | null;
  reporter_id: string | null;
  version: number;
}

// Every function below takes an explicit, required `store` — this module
// never imports src/lib/db.ts itself, deliberately: that's what lets
// spec/badger-room-decay.test.ts import this module for its pure
// logic/constants/store type without transitively opening a second real
// SQLite connection to the app's own on-disk database (see
// src/lib/badger-room-db.ts, the one place that wires these functions to
// that shared connection — only it, and real production call sites that
// import from it, ever touch db.ts). Mirrors src/lib/weasel-room.ts's own
// WeaselRoomStore split the same way.
export interface BadgerRoomStore {
  db: DatabaseSync;
}

// Exposed so a test building its own throwaway database can seed it the
// same way db.ts/otter-room.ts/rabbit-room.ts/weasel-room.ts seed
// theirs — never reported yet, so confirmed_at stays null rather than
// claiming a confirmation that never happened (CLAUDE.md). Idempotent:
// safe to call against a database that already has the row.
export function seedBadgerRoomIfEmpty(store: BadgerRoomStore): void {
  const existing = store.db.prepare("SELECT 1 FROM badger_room WHERE id = ?").get(BADGER_ROOM_ID);
  if (existing) return;
  store.db.prepare("INSERT INTO badger_room (id) VALUES (?)").run(BADGER_ROOM_ID);
}

// The effective expiry moment for a row that isn't already "unknown" — see
// ADR 0007, Decision 2's decided formula:
//  - "empty" expires confirmedAt + 15 minutes after confirmation, full
//    stop — a product freshness judgement, not a community norm.
//  - "occupied" expires at min(expectedEndAt, confirmedAt + 4h): a
//    resident's own estimate can end the report earlier than the 4-hour
//    ceiling, but can never extend it past the ceiling.
// confirmed_at is only ever null here for a row the first `occupancy !==
// "unknown"` guard in decayedBadgerRoom() already excludes — the `?? now`
// fallback exists purely so this function stays total, mirroring
// src/lib/weasel-room.ts's own expiresAt().
function expiresAt(row: BadgerRoomRow, now: number): number {
  const confirmedAt = row.confirmed_at ?? now;
  if (row.occupancy === "empty") return confirmedAt + BADGER_ROOM_EMPTY_DECAY_MS;
  return Math.min(row.expected_end_at ?? Infinity, confirmedAt + BADGER_ROOM_MAX_OCCUPIED_MS);
}

// Lazily expire a stale observation — see the ADR, Decision 2. Mirrors
// decayedWeaselRoom()'s shape: a decay transition is a real, canonical
// mutation, so it increments `version` and broadcasts exactly like a
// resident's report does. Runs on ordinary reads only — never a timer,
// never a connection event (ADR 0007, Decision 4).
//
// `now` defaults to the real clock — production never overrides it. A
// test passes a constructed `now` to exercise this code path without
// waiting out the real thresholds.
function decayedBadgerRoom(row: BadgerRoomRow, now: number, store: BadgerRoomStore): BadgerRoomRow {
  if (row.occupancy === "unknown") return row;
  if (now <= expiresAt(row, now)) return row;

  const { changes } = store.db
    .prepare(
      `UPDATE badger_room
       SET occupancy = 'unknown', expected_end_at = NULL, version = version + 1
       WHERE id = ? AND occupancy != 'unknown'`,
    )
    .run(row.id);

  // changes === 0 means something else already moved this row since it
  // was read (unreachable in a single synchronous process today, same
  // reasoning as weasel-room.ts's own decay function) — re-read rather
  // than assume a stale view, and don't broadcast: nothing actually
  // changed as a result of this call.
  if (changes === 0) {
    return store.db.prepare("SELECT * FROM badger_room WHERE id = ?").get(row.id) as unknown as BadgerRoomRow;
  }

  const updated: BadgerRoomRow = { ...row, occupancy: "unknown", expected_end_at: null, version: row.version + 1 };
  broadcast({ kind: "badger-room", room: toBadgerRoomState(updated) });
  return updated;
}

function toBadgerRoomState(row: BadgerRoomRow): BadgerRoomState {
  return {
    occupancy: row.occupancy,
    expectedEndAt: row.expected_end_at,
    confirmedAt: row.confirmed_at,
    version: row.version,
  };
}

export function getBadgerRoom(now: number, store: BadgerRoomStore): BadgerRoomState {
  const row = store.db.prepare("SELECT * FROM badger_room WHERE id = ?").get(BADGER_ROOM_ID) as
    | BadgerRoomRow
    | undefined;
  if (!row) {
    // Should never happen in production — this module seeds this row at
    // startup — but a throwaway test store that forgot to seed should
    // fail loudly here, not return a fabricated state.
    throw new Error("badger_room row not seeded");
  }
  return toBadgerRoomState(decayedBadgerRoom(row, now, store));
}

export interface BadgerRoomReport {
  occupancy: ReportableBadgerRoomOccupancy;
  // Already validated by the API route before this is called (range,
  // safe-integer-ness) — see src/pages/api/badger-room.ts and ADR 0007,
  // Decision 2. This function still independently forces expectedEndAt to
  // null whenever occupancy isn't "occupied" (below), so a caller can
  // never persist an inconsistent row even by mistake.
  expectedEndAt: number | null;
  reporterId: string | null;
}

// Mirrors weasel-room.ts's WeaselRoomUpdateResult: an explicit tagged
// result rather than overloading undefined, since "your view was stale"
// needs a distinct HTTP response.
export type BadgerRoomUpdateResult =
  | { ok: true; room: BadgerRoomState }
  | { ok: false; reason: "stale"; current: BadgerRoomState };

// A report is a confirmation event: confirmed_at moves to `now`.
// expectedEndAt is per-observation, never inherited across reports (ADR
// 0007, Decision 2) — every report fully replaces the stored
// expected_end_at from the values passed in, never by reading or
// preserving whatever the row previously held. It is only ever written
// non-null when occupancy is "occupied" and the caller supplied one;
// every other case (an "empty" report, or an "occupied" report with no
// estimate) stores NULL, even if the row being overwritten currently
// holds a value from an earlier report.
//
// ifVersion-conditioned exactly like weasel-room.ts's own report
// function: the UPDATE's WHERE guard makes the write atomic against both
// another resident's report and the server's own lazy decay landing in
// between.
//
// Broadcasts exactly what this write just set, straight off the row —
// not through getBadgerRoom(), which would fold in any immediate decay
// before this report's own state ever got announced. Only on
// changes === 1: a stale write (changes === 0, the `ok: false` branch
// below) made no real mutation, so there is nothing to tell anyone about.
export function reportBadgerRoomStatus(
  report: BadgerRoomReport,
  ifVersion: number,
  now: number,
  store: BadgerRoomStore,
): BadgerRoomUpdateResult {
  const expectedEndAt = report.occupancy === "occupied" ? (report.expectedEndAt ?? null) : null;

  const { changes } = store.db
    .prepare(
      `UPDATE badger_room
       SET occupancy = ?, expected_end_at = ?, confirmed_at = ?, reporter_id = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    )
    .run(report.occupancy, expectedEndAt, now, report.reporterId, BADGER_ROOM_ID, ifVersion);

  if (changes === 1) {
    const written = store.db.prepare("SELECT * FROM badger_room WHERE id = ?").get(BADGER_ROOM_ID) as unknown as BadgerRoomRow;
    const state = toBadgerRoomState(written);
    broadcast({ kind: "badger-room", room: state });
    return { ok: true, room: state };
  }

  return { ok: false, reason: "stale", current: getBadgerRoom(now, store) };
}
