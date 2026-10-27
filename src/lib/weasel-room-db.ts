// Wires src/lib/weasel-room.ts's pure, store-agnostic functions to the
// app's one real, on-disk SQLite connection (db.ts) — and does so by
// importing db.ts itself, which weasel-room.ts deliberately does not.
// This is the ONLY module that should ever call weasel-room.ts's
// functions with the app's real database; production call sites
// (src/pages/api/weasel-room.ts, src/pages/index.astro) import from here,
// never straight from weasel-room.ts with a hand-built store.
//
// Why this split exists: spec/weasel-room-decay.test.ts needs
// weasel-room.ts's real decay logic, constants, and WeaselRoomStore type,
// but builds its own throwaway in-memory database for every test — it
// must never also open a second connection to the app's real on-disk
// file. A plain `import ... from "./weasel-room.ts"` is a static ES
// import, which Node evaluates eagerly and transitively: if
// weasel-room.ts itself imported db.ts and ran `new DatabaseSync(dbPath)`
// at module-load time, importing weasel-room.ts for its types/logic alone
// would silently open that real connection too — racing the CI
// container's already-running app for the same file's lock
// ("database is locked", ERR_SQLITE_ERROR) — exactly the incident
// `91167bd` fixed for AA/Otter/Rabbit Room (see PROCESS.md). Keeping that
// wiring here instead means a decay test's import of weasel-room.ts never
// touches db.ts at all.
import { db } from "./db.ts";
import {
  getWeaselRoom as getWeaselRoomAgainstStore,
  reportWeaselRoomStatus as reportWeaselRoomStatusAgainstStore,
  seedWeaselRoomIfEmpty,
  type WeaselRoomReport,
  type WeaselRoomStore,
  type WeaselRoomUpdateResult,
} from "./weasel-room.ts";
import type { WeaselRoomState } from "./types.ts";

export {
  WEASEL_ROOM_MAX_OCCUPIED_MS,
  WEASEL_ROOM_EMPTY_DECAY_MS,
  type WeaselRoomReport,
  type WeaselRoomStore,
  type WeaselRoomUpdateResult,
} from "./weasel-room.ts";

const store: WeaselRoomStore = { db };

export function getWeaselRoom(now: number = Date.now()): WeaselRoomState {
  return getWeaselRoomAgainstStore(now, store);
}

export function reportWeaselRoomStatus(
  report: WeaselRoomReport,
  ifVersion: number,
  now: number = Date.now(),
): WeaselRoomUpdateResult {
  return reportWeaselRoomStatusAgainstStore(report, ifVersion, now, store);
}

// Self-seeds the app's one shared row against the app's one shared
// connection, the moment this module (not weasel-room.ts itself) is first
// imported — same "seed at module load" shape as every other facility,
// just relocated so only a real production import pays for it.
seedWeaselRoomIfEmpty(store);
