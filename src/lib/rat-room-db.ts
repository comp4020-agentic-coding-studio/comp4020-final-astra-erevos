// Wires src/lib/rat-room.ts's pure, store-agnostic functions to the app's
// one real, on-disk SQLite connection (db.ts) — and does so by importing
// db.ts itself, which rat-room.ts deliberately does not. This is the ONLY
// module that should ever call rat-room.ts's functions with the app's
// real database; production call sites (src/pages/api/rat-room/[seat].ts,
// src/pages/index.astro) import from here, never straight from
// rat-room.ts with a hand-built store.
//
// Why this split exists: spec/rat-room-decay.test.ts needs rat-room.ts's
// real decay logic, constants, and RatRoomStore type, but builds its own
// throwaway in-memory database for every test — it must never also open
// a second connection to the app's real on-disk file. Keeping that wiring
// here instead means a decay test's import of rat-room.ts never touches
// db.ts at all — the exact isolation `91167bd` established for
// AA/Otter/Rabbit Room (see PROCESS.md), continued unchanged for this
// sixth consecutive decay spec.
import { db } from "./db.ts";
import {
  getRatRoomSeat as getRatRoomSeatAgainstStore,
  listRatRoomSeats as listRatRoomSeatsAgainstStore,
  reportRatRoomSeatStatus as reportRatRoomSeatStatusAgainstStore,
  seedRatRoomSeatsIfEmpty,
  type RatRoomSeatReport,
  type RatRoomSeatUpdateResult,
  type RatRoomStore,
} from "./rat-room.ts";
import type { RatRoomSeatId, RatRoomSeatState } from "./types.ts";

export {
  RAT_ROOM_SEAT_MAX_OCCUPIED_MS,
  RAT_ROOM_SEAT_EMPTY_DECAY_MS,
  type RatRoomSeatReport,
  type RatRoomSeatUpdateResult,
  type RatRoomStore,
} from "./rat-room.ts";

const store: RatRoomStore = { db };

export function getRatRoomSeat(seat: RatRoomSeatId, now: number = Date.now()): RatRoomSeatState | undefined {
  return getRatRoomSeatAgainstStore(seat, now, store);
}

export function listRatRoomSeats(now: number = Date.now()): RatRoomSeatState[] {
  return listRatRoomSeatsAgainstStore(now, store);
}

export function reportRatRoomSeatStatus(
  seat: RatRoomSeatId,
  report: RatRoomSeatReport,
  ifVersion: number,
  now: number = Date.now(),
): RatRoomSeatUpdateResult {
  return reportRatRoomSeatStatusAgainstStore(seat, report, ifVersion, now, store);
}

// Self-seeds the app's ten shared seat rows against the app's one shared
// connection, the moment this module (not rat-room.ts itself) is first
// imported — same "seed at module load" shape as every other facility,
// just relocated so only a real production import pays for it.
seedRatRoomSeatsIfEmpty(store);
