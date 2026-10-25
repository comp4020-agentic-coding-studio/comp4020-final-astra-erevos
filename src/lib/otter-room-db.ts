// Wires src/lib/otter-room.ts's pure, store-agnostic functions to the
// app's one real, on-disk SQLite connection (db.ts) — and does so by
// importing db.ts itself, which otter-room.ts deliberately does not.
// This is the ONLY module that should ever call otter-room.ts's functions
// with the app's real database; production call sites
// (src/pages/api/otter-room.ts, src/pages/index.astro) import from here,
// never straight from otter-room.ts with a hand-built store.
//
// Why this split exists — see src/lib/rabbit-room-db.ts's own note for the
// full reasoning, which applies identically here: a plain
// `import ... from "./otter-room.ts"` is a static ES import, evaluated
// eagerly and transitively, so if otter-room.ts itself imported db.ts (as
// it used to) and opened a real `DatabaseSync` connection at module-load
// time, spec/otter-room-decay.test.ts importing otter-room.ts for its pure
// logic/constants alone would silently open that real connection too —
// racing the CI container's already-running app for the same file's lock
// ("database is locked", ERR_SQLITE_ERROR). Keeping that wiring here
// instead means a decay test's import of otter-room.ts never touches
// db.ts at all.
import { db } from "./db.ts";
import {
  getOtterRoom as getOtterRoomAgainstStore,
  reportOtterRoomStatus as reportOtterRoomStatusAgainstStore,
  seedOtterRoomIfEmpty,
  type OtterRoomReport,
  type OtterRoomStore,
  type OtterRoomUpdateResult,
} from "./otter-room.ts";
import type { OtterRoomState } from "./types.ts";

export {
  OTTER_ROOM_MAX_OCCUPIED_MS,
  OTTER_ROOM_EMPTY_DECAY_MS,
  type OtterRoomReport,
  type OtterRoomStore,
  type OtterRoomUpdateResult,
} from "./otter-room.ts";

const store: OtterRoomStore = { db };

export function getOtterRoom(now: number = Date.now()): OtterRoomState {
  return getOtterRoomAgainstStore(now, store);
}

export function reportOtterRoomStatus(
  report: OtterRoomReport,
  ifVersion: number,
  now: number = Date.now(),
): OtterRoomUpdateResult {
  return reportOtterRoomStatusAgainstStore(report, ifVersion, now, store);
}

// Self-seeds the app's one shared row against the app's one shared
// connection, the moment this module (not otter-room.ts itself) is first
// imported — same "seed at module load" shape as before, just relocated
// so only a real production import pays for it.
seedOtterRoomIfEmpty(store);
