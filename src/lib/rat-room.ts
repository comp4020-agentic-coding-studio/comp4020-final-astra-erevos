import type { DatabaseSync } from "node:sqlite";
import { broadcast } from "./realtime.ts";
import {
  RAT_ROOM_SEAT_IDS,
  type RatRoomSeatId,
  type RatRoomSeatOccupancy,
  type RatRoomSeatState,
  type ReportableRatRoomSeatOccupancy,
} from "./types.ts";

// Rat Room — Toad Live's seventh facility. See
// notes/adr/0008-rat-room-live-state.md for the full decision this
// module implements. UNLIKE every sibling module since aa-room.ts, this
// is a TEN-ROW facility, not one fixed row: the decision-relevant
// question here is "how many seats are free," not "is anyone in the
// room," so this module manages ten independently-reportable seat
// resources (A-J), each its own occupancy/expectedEndAt/confirmedAt/
// version — structurally Laundry's sibling, not
// otter-room.ts's/rabbit-room.ts's/weasel-room.ts's/badger-room.ts's own
// single-row shape (ADR 0008, Decision 1). Only the MULTIPLICITY is
// borrowed from db.ts's own machines handling — every function below
// still takes an explicit, required `store`/`now`, never imports db.ts
// itself, for the same reason every prior room module doesn't: this is
// what lets spec/rat-room-decay.test.ts import this module for its pure
// logic/constants/store type without transitively opening a second real
// SQLite connection (see src/lib/rat-room-db.ts, the one place that
// wires these functions to the app's real connection).
const RAT_ROOM_ID_PREFIX = "rat-room-";

function rowIdFor(seat: RatRoomSeatId): string {
  return `${RAT_ROOM_ID_PREFIX}${seat.toLowerCase()}`;
}

// Real-world community norm (FINAL_PROJECT_SOURCE_OF_TRUTH.md), confirmed
// for Rat Room specifically: a single seat's use typically doesn't run
// past four hours. Stated at the per-seat grain from the start (ADR
// 0008, Decision 3) — no room-level-to-seat-level re-derivation was
// needed the way Badger Room's own write-up had to separate "booking
// frequency" from "observation durability." Do NOT mark this
// PROVISIONAL or treat it like UNTIMED_IN_USE_DECAY_MS (src/lib/db.ts).
export const RAT_ROOM_SEAT_MAX_OCCUPIED_MS = 4 * 60 * 60 * 1000; // 4 hours

// Decided product freshness judgement, independently re-derived for this
// room (ADR 0008, Decision 3) — settled, not provisional. Rat Room has no
// reservation or sign-up mechanism of any kind (unlike every other
// occupancy room, which at least has a paper sign-up sheet): a seat is a
// walk-in resource, so an "empty" report only ever confirms that one
// seat at the one moment someone looked, with nothing else standing
// between that confirmation and the next resident sitting down. Lands on
// the same number as every other facility's own empty-decay figure, but
// by that independent argument, not because the value was copied.
export const RAT_ROOM_SEAT_EMPTY_DECAY_MS = 15 * 60 * 1000; // 15 minutes

interface RatRoomSeatRow {
  id: string;
  seat: RatRoomSeatId;
  occupancy: RatRoomSeatOccupancy;
  expected_end_at: number | null;
  confirmed_at: number | null;
  reporter_id: string | null;
  version: number;
}

// Every function below takes an explicit, required `store` — see the
// file's own top note.
export interface RatRoomStore {
  db: DatabaseSync;
}

// Exposed so a test building its own throwaway database can seed it the
// same way db.ts/every sibling room module seeds theirs. Inserts exactly
// one row per RAT_ROOM_SEAT_IDS entry if the table is currently empty —
// never reported yet, so confirmed_at stays null rather than claiming a
// confirmation that never happened (CLAUDE.md). Idempotent: a store that
// already has its ten rows is left untouched, not re-seeded or topped
// up — the schema's own `seat UNIQUE` constraint would reject a partial
// top-up attempt anyway, so this checks "any rows at all," the same
// all-or-nothing seeding shape db.ts's own seedIfEmpty() uses for its
// ten machines.
export function seedRatRoomSeatsIfEmpty(store: RatRoomStore): void {
  const { count } = store.db.prepare("SELECT COUNT(*) AS count FROM rat_room_seats").get() as {
    count: number;
  };
  if (count > 0) return;

  const insert = store.db.prepare("INSERT INTO rat_room_seats (id, seat) VALUES (?, ?)");
  for (const seat of RAT_ROOM_SEAT_IDS) {
    insert.run(rowIdFor(seat), seat);
  }
}

// The effective expiry moment for a row that isn't already "unknown" —
// identical formula to every sibling room's own expiresAt(), applied per
// seat row. See ADR 0008, Decision 3.
function expiresAt(row: RatRoomSeatRow, now: number): number {
  const confirmedAt = row.confirmed_at ?? now;
  if (row.occupancy === "empty") return confirmedAt + RAT_ROOM_SEAT_EMPTY_DECAY_MS;
  return Math.min(row.expected_end_at ?? Infinity, confirmedAt + RAT_ROOM_SEAT_MAX_OCCUPIED_MS);
}

// Lazily expire a stale observation for ONE seat — never touches any of
// the other nine rows. Runs on ordinary reads only — never a timer,
// never a connection event (ADR 0008, Decision 6).
function decayedRatRoomSeat(row: RatRoomSeatRow, now: number, store: RatRoomStore): RatRoomSeatRow {
  if (row.occupancy === "unknown") return row;
  if (now <= expiresAt(row, now)) return row;

  const { changes } = store.db
    .prepare(
      `UPDATE rat_room_seats
       SET occupancy = 'unknown', expected_end_at = NULL, version = version + 1
       WHERE id = ? AND occupancy != 'unknown'`,
    )
    .run(row.id);

  // changes === 0 means something else already moved this row since it
  // was read (unreachable in a single synchronous process today, same
  // reasoning as every sibling room's own decay function) — re-read
  // rather than assume a stale view, and don't broadcast: nothing
  // actually changed as a result of this call.
  if (changes === 0) {
    return store.db.prepare("SELECT * FROM rat_room_seats WHERE id = ?").get(row.id) as unknown as RatRoomSeatRow;
  }

  const updated: RatRoomSeatRow = { ...row, occupancy: "unknown", expected_end_at: null, version: row.version + 1 };
  broadcast({ kind: "rat-room", seat: toRatRoomSeatState(updated) });
  return updated;
}

function toRatRoomSeatState(row: RatRoomSeatRow): RatRoomSeatState {
  return {
    id: row.id,
    seat: row.seat,
    occupancy: row.occupancy,
    expectedEndAt: row.expected_end_at,
    confirmedAt: row.confirmed_at,
    version: row.version,
  };
}

function getRow(seat: RatRoomSeatId, store: RatRoomStore): RatRoomSeatRow | undefined {
  return store.db.prepare("SELECT * FROM rat_room_seats WHERE seat = ?").get(seat) as
    | RatRoomSeatRow
    | undefined;
}

// Returns undefined for any seat identifier not currently seeded — the
// caller (the API route) is responsible for turning that into a 404,
// the same "no such resource" shape db.ts's own getMachine() leaves to
// its caller.
export function getRatRoomSeat(seat: RatRoomSeatId, now: number, store: RatRoomStore): RatRoomSeatState | undefined {
  const row = getRow(seat, store);
  if (!row) return undefined;
  return toRatRoomSeatState(decayedRatRoomSeat(row, now, store));
}

// All ten seats, in A-J order — the page's own frontmatter reads this
// directly (mirroring listMachines()), never through the keyed API
// route. Decay is applied to each seat independently; reading seat A
// never decays or otherwise touches seat B's own row.
export function listRatRoomSeats(now: number, store: RatRoomStore): RatRoomSeatState[] {
  const rows = store.db.prepare("SELECT * FROM rat_room_seats ORDER BY seat").all() as unknown as RatRoomSeatRow[];
  return rows.map((row) => toRatRoomSeatState(decayedRatRoomSeat(row, now, store)));
}

export interface RatRoomSeatReport {
  occupancy: ReportableRatRoomSeatOccupancy;
  // Already validated by the API route before this is called (range,
  // safe-integer-ness) — see src/pages/api/rat-room/[seat].ts and ADR
  // 0008, Decision 3. This function still independently forces
  // expectedEndAt to null whenever occupancy isn't "occupied" (below),
  // so a caller can never persist an inconsistent row even by mistake.
  expectedEndAt: number | null;
  reporterId: string | null;
}

// Mirrors every sibling room's own *RoomUpdateResult: an explicit tagged
// result rather than overloading undefined, since "your view was stale"
// needs a distinct HTTP response. "not-found" exists here, unlike the
// single-row rooms, because a seat identifier is a real path parameter
// that can legitimately name no seat at all — the single-row rooms have
// no equivalent "which one" question a client's request could get wrong.
export type RatRoomSeatUpdateResult =
  | { ok: true; seat: RatRoomSeatState }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "stale"; current: RatRoomSeatState };

// A report is a confirmation event for exactly ONE seat: confirmed_at
// moves to `now` for that seat's own row only. expectedEndAt is
// per-observation, never inherited across reports (ADR 0008, Decision
// 2) — every report fully replaces the stored expected_end_at from the
// values passed in, never by reading or preserving whatever that seat's
// row previously held. It is only ever written non-null when occupancy
// is "occupied" and the caller supplied one; every other case ("empty",
// or "occupied" with no estimate) stores NULL.
//
// ifVersion-conditioned exactly like every sibling room's own report
// function, scoped to this one seat's own version column — a stale
// write against seat C can never be satisfied by seat F's version
// advancing, and vice versa, because the WHERE guard below matches on
// `seat = ? AND version = ?`, never a shared room-level counter.
export function reportRatRoomSeatStatus(
  seat: RatRoomSeatId,
  report: RatRoomSeatReport,
  ifVersion: number,
  now: number,
  store: RatRoomStore,
): RatRoomSeatUpdateResult {
  const existing = getRow(seat, store);
  if (!existing) return { ok: false, reason: "not-found" };

  const expectedEndAt = report.occupancy === "occupied" ? (report.expectedEndAt ?? null) : null;

  const { changes } = store.db
    .prepare(
      `UPDATE rat_room_seats
       SET occupancy = ?, expected_end_at = ?, confirmed_at = ?, reporter_id = ?, version = version + 1
       WHERE seat = ? AND version = ?`,
    )
    .run(report.occupancy, expectedEndAt, now, report.reporterId, seat, ifVersion);

  if (changes === 1) {
    const written = getRow(seat, store) as RatRoomSeatRow;
    const state = toRatRoomSeatState(written);
    broadcast({ kind: "rat-room", seat: state });
    return { ok: true, seat: state };
  }

  // changes === 0: either a stale version on this same seat, or (rare,
  // but checked rather than assumed) the seat vanished between the
  // existence check above and this write — re-read to tell the two
  // apart, same "don't assume which failure happened" discipline
  // db.ts's own reportStatus() already uses for machines.
  const current = getRatRoomSeat(seat, now, store);
  return current ? { ok: false, reason: "stale", current } : { ok: false, reason: "not-found" };
}
