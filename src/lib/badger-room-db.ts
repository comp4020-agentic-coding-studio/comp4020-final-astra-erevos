// Wires src/lib/badger-room.ts's pure, store-agnostic functions to the
// app's one real, on-disk SQLite connection (db.ts) — and does so by
// importing db.ts itself, which badger-room.ts deliberately does not.
// This is the ONLY module that should ever call badger-room.ts's
// functions with the app's real database; production call sites
// (src/pages/api/badger-room.ts, src/pages/index.astro) import from here,
// never straight from badger-room.ts with a hand-built store.
//
// Why this split exists: spec/badger-room-decay.test.ts needs
// badger-room.ts's real decay logic, constants, and BadgerRoomStore type,
// but builds its own throwaway in-memory database for every test — it
// must never also open a second connection to the app's real on-disk
// file. A plain `import ... from "./badger-room.ts"` is a static ES
// import, which Node evaluates eagerly and transitively: if
// badger-room.ts itself imported db.ts and ran `new DatabaseSync(dbPath)`
// at module-load time, importing badger-room.ts for its types/logic alone
// would silently open that real connection too — racing the CI
// container's already-running app for the same file's lock
// ("database is locked", ERR_SQLITE_ERROR) — exactly the incident
// `91167bd` fixed for AA/Otter/Rabbit Room (see PROCESS.md). Keeping that
// wiring here instead means a decay test's import of badger-room.ts never
// touches db.ts at all.
import { db } from "./db.ts";
import {
  getBadgerRoom as getBadgerRoomAgainstStore,
  reportBadgerRoomStatus as reportBadgerRoomStatusAgainstStore,
  seedBadgerRoomIfEmpty,
  type BadgerRoomReport,
  type BadgerRoomStore,
  type BadgerRoomUpdateResult,
} from "./badger-room.ts";
import type { BadgerRoomState } from "./types.ts";

export {
  BADGER_ROOM_MAX_OCCUPIED_MS,
  BADGER_ROOM_EMPTY_DECAY_MS,
  type BadgerRoomReport,
  type BadgerRoomStore,
  type BadgerRoomUpdateResult,
} from "./badger-room.ts";

const store: BadgerRoomStore = { db };

export function getBadgerRoom(now: number = Date.now()): BadgerRoomState {
  return getBadgerRoomAgainstStore(now, store);
}

export function reportBadgerRoomStatus(
  report: BadgerRoomReport,
  ifVersion: number,
  now: number = Date.now(),
): BadgerRoomUpdateResult {
  return reportBadgerRoomStatusAgainstStore(report, ifVersion, now, store);
}

// Self-seeds the app's one shared row against the app's one shared
// connection, the moment this module (not badger-room.ts itself) is first
// imported — same "seed at module load" shape as every other facility,
// just relocated so only a real production import pays for it.
seedBadgerRoomIfEmpty(store);
