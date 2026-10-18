import type { DatabaseSync } from "node:sqlite";
import { db } from "./db.ts";
import { broadcast } from "./realtime.ts";
import { computeFreshness } from "./freshness.ts";
import type { AaRoomActivity, AaRoomOccupancy, AaRoomState, ReportableAaRoomOccupancy } from "./types.ts";

// AA Room — Toad Live's second facility. See
// notes/adr/0003-aa-room-live-state.md for the full decision this module
// implements. A single row (id is a fixed constant — the room has no
// sub-locations the way machines.ts has five), seeded once at startup by
// db.ts the same way machines are.
const AA_ROOM_ID = "aa-room";

interface AaRoomRow {
  id: string;
  occupancy: AaRoomOccupancy;
  activity: AaRoomActivity | null;
  confirmed_at: number | null;
  reporter_id: string | null;
  version: number;
}

// Every function below takes an explicit `store` — defaulting to the
// app's one shared connection (db.ts) — rather than importing `db`
// directly at call sites. This is what lets a decay test build its own
// throwaway database (an in-memory node:sqlite instance, no file, no
// coordination with any other spec file's connection) and exercise the
// REAL decayedAaRoom()/getAaRoom() code path against it, instead of
// either mutating a process-wide DB_PATH (which Vitest's parallel test
// files would race on) or re-implementing the decay SQL a second time
// just for the test. Production call sites (src/pages/api/aa-room.ts)
// never pass `store` — the default parameter is the only thing they see,
// so this costs them nothing.
export interface AaRoomStore {
  db: DatabaseSync;
}

function defaultStore(): AaRoomStore {
  return { db };
}

// Exposed so a test building its own throwaway database can seed it the
// same way db.ts's own seedIfEmpty() does for machines — never reported
// yet, so confirmed_at stays null rather than claiming a confirmation
// that never happened (same rule CLAUDE.md already states for machines).
// Idempotent: safe to call against a database that already has the row.
export function seedAaRoomIfEmpty(store: AaRoomStore = defaultStore()): void {
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
       SET occupancy = 'unknown', activity = NULL, version = version + 1
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

  const updated: AaRoomRow = { ...row, occupancy: "unknown", activity: null, version: row.version + 1 };
  broadcast({ kind: "aa-room", room: toAaRoomState(updated, now) });
  return updated;
}

function toAaRoomState(row: AaRoomRow, now: number): AaRoomState {
  return {
    occupancy: row.occupancy,
    activity: row.activity,
    confirmedAt: row.confirmed_at,
    version: row.version,
    freshness: computeFreshness(row.occupancy, row.confirmed_at, now),
  };
}

export function getAaRoom(now: number = Date.now(), store: AaRoomStore = defaultStore()): AaRoomState {
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
  activity: AaRoomActivity | null;
  reporterId: string | null;
}

// Mirrors machines.ts's UpdateResult: an explicit tagged result rather
// than overloading undefined, since "no such row" and "your view was
// stale" need different HTTP responses.
export type AaRoomUpdateResult =
  | { ok: true; room: AaRoomState }
  | { ok: false; reason: "stale"; current: AaRoomState };

// A report is a confirmation event: confirmed_at moves to `now`. Activity
// is only ever written alongside "occupied" — the API route enforces this
// before calling here (mirrors machines.ts's reportStatus(), where
// startedAt/expectedEndAt only mean anything for "in-use"), but this
// function also clears activity itself whenever occupancy isn't
// "occupied", so a caller can never persist an inconsistent row even by
// mistake.
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
  now: number = Date.now(),
  store: AaRoomStore = defaultStore(),
): AaRoomUpdateResult {
  const activity = report.occupancy === "occupied" ? report.activity : null;

  const { changes } = store.db
    .prepare(
      `UPDATE aa_room
       SET occupancy = ?, activity = ?, confirmed_at = ?, reporter_id = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    )
    .run(report.occupancy, activity, now, report.reporterId, AA_ROOM_ID, ifVersion);

  if (changes === 1) {
    const written = store.db.prepare("SELECT * FROM aa_room WHERE id = ?").get(AA_ROOM_ID) as unknown as AaRoomRow;
    const state = toAaRoomState(written, now);
    broadcast({ kind: "aa-room", room: state });
    return { ok: true, room: state };
  }

  return { ok: false, reason: "stale", current: getAaRoom(now, store) };
}

// Self-seeds the app's one shared row against the app's one shared
// connection (db.ts), the moment this module is first imported — the
// same "seed at module load" shape db.ts itself uses for machines,
// placed here rather than in db.ts to avoid a db.ts -> aa-room.ts ->
// db.ts import cycle (db.ts has no reason to know about AA Room; this
// module already depends on db.ts one-way). A throwaway test store built
// by a test is never touched by this — it calls seedAaRoomIfEmpty(store)
// itself, explicitly, against its own database.
seedAaRoomIfEmpty();
