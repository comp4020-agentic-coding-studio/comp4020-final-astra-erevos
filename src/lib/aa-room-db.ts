// Wires src/lib/aa-room.ts's pure, store-agnostic functions to the app's
// one real, on-disk SQLite connection (db.ts) — and does so by importing
// db.ts itself, which aa-room.ts deliberately does not. This is the ONLY
// module that should ever call aa-room.ts's functions with the app's real
// database; production call sites (src/pages/api/aa-room.ts,
// src/pages/index.astro) import from here, never straight from
// aa-room.ts with a hand-built store.
//
// Why this split exists — see src/lib/rabbit-room-db.ts's own note for the
// full reasoning, which applies identically here: a plain
// `import ... from "./aa-room.ts"` is a static ES import, evaluated
// eagerly and transitively, so if aa-room.ts itself imported db.ts (as it
// used to) and opened a real `DatabaseSync` connection at module-load
// time, spec/aa-room-decay.test.ts importing aa-room.ts for its pure
// logic/constants/migration-helper alone would silently open that real
// connection too — racing the CI container's already-running app for the
// same file's lock ("database is locked", ERR_SQLITE_ERROR). Keeping that
// wiring here instead means a decay test's import of aa-room.ts never
// touches db.ts at all.
import { db } from "./db.ts";
import {
  canonicalizeActivities,
  getAaRoom as getAaRoomAgainstStore,
  migrateAaRoomActivitiesColumn,
  reportAaRoomStatus as reportAaRoomStatusAgainstStore,
  seedAaRoomIfEmpty,
  type AaRoomReport,
  type AaRoomStore,
  type AaRoomUpdateResult,
} from "./aa-room.ts";
import type { AaRoomState } from "./types.ts";

export { canonicalizeActivities, type AaRoomReport, type AaRoomStore, type AaRoomUpdateResult } from "./aa-room.ts";

const store: AaRoomStore = { db };

export function getAaRoom(now: number = Date.now()): AaRoomState {
  return getAaRoomAgainstStore(now, store);
}

export function reportAaRoomStatus(
  report: AaRoomReport,
  ifVersion: number,
  now: number = Date.now(),
): AaRoomUpdateResult {
  return reportAaRoomStatusAgainstStore(report, ifVersion, now, store);
}

// Migrates, then self-seeds, the app's one shared row against the app's
// one shared connection, the moment this module (not aa-room.ts itself)
// is first imported — same "run DDL migrations, then seed, at module
// load" order as before (migration must run before seeding:
// seedAaRoomIfEmpty() is a no-op against an already-seeded row, so an
// already-deployed row is exactly the one this order protects — it gets
// migrated in place, never re-seeded over), just relocated so only a real
// production import pays for either.
migrateAaRoomActivitiesColumn(store);
seedAaRoomIfEmpty(store);
