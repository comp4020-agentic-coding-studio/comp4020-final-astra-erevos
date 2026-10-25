// Wires src/lib/rabbit-room.ts's pure, store-agnostic functions to the
// app's one real, on-disk SQLite connection (db.ts) — and does so by
// importing db.ts itself, which rabbit-room.ts deliberately does not.
// This is the ONLY module that should ever call rabbit-room.ts's
// functions with the app's real database; production call sites
// (src/pages/api/rabbit-room.ts, src/pages/index.astro) import from here,
// never straight from rabbit-room.ts with a hand-built store.
//
// Why this split exists: spec/rabbit-room-decay.test.ts needs
// rabbit-room.ts's real decay logic, constants, and RabbitRoomStore type,
// but builds its own throwaway in-memory database for every test — it
// must never also open a second connection to the app's real on-disk
// file. A plain `import ... from "./rabbit-room.ts"` is a static ES
// import, which Node evaluates eagerly and transitively: if rabbit-room.ts
// itself imported db.ts (as it used to) and ran `new DatabaseSync(dbPath)`
// at module-load time, importing rabbit-room.ts for its types/logic alone
// would silently open that real connection too — racing the CI
// container's already-running app for the same file's lock
// ("database is locked", ERR_SQLITE_ERROR). Keeping that wiring here
// instead means a decay test's import of rabbit-room.ts never touches
// db.ts at all.
import { db } from "./db.ts";
import {
  getRabbitRoom as getRabbitRoomAgainstStore,
  reportRabbitRoomStatus as reportRabbitRoomStatusAgainstStore,
  seedRabbitRoomIfEmpty,
  type RabbitRoomReport,
  type RabbitRoomStore,
  type RabbitRoomUpdateResult,
} from "./rabbit-room.ts";
import type { RabbitRoomState } from "./types.ts";

export {
  RABBIT_ROOM_MAX_OCCUPIED_MS,
  RABBIT_ROOM_EMPTY_DECAY_MS,
  type RabbitRoomReport,
  type RabbitRoomStore,
  type RabbitRoomUpdateResult,
} from "./rabbit-room.ts";

const store: RabbitRoomStore = { db };

export function getRabbitRoom(now: number = Date.now()): RabbitRoomState {
  return getRabbitRoomAgainstStore(now, store);
}

export function reportRabbitRoomStatus(
  report: RabbitRoomReport,
  ifVersion: number,
  now: number = Date.now(),
): RabbitRoomUpdateResult {
  return reportRabbitRoomStatusAgainstStore(report, ifVersion, now, store);
}

// Self-seeds the app's one shared row against the app's one shared
// connection, the moment this module (not rabbit-room.ts itself) is first
// imported — same "seed at module load" shape as before, just relocated
// so only a real production import pays for it.
seedRabbitRoomIfEmpty(store);
