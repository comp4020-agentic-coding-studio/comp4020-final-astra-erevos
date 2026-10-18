import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  getAaRoom,
  migrateAaRoomActivitiesColumn,
  reportAaRoomStatus,
  seedAaRoomIfEmpty,
  type AaRoomStore,
} from "../src/lib/aa-room.ts";
import { AA_ROOM_EXPIRE_MS, AA_ROOM_FRESH_MS } from "../src/lib/freshness.ts";
import { subscribe, type BroadcastPayload } from "../src/lib/realtime.ts";

// AA Room's 45-minute decay transition can't be exercised the way
// spec/decay.test.ts exercises a machine's: a machine's own decay
// deadline (expected_end_at) is a value the reporting client sets
// per-request to anything it likes, so that test reports a real,
// short expected_end_at and polls until it actually passes. AA Room's
// threshold (src/lib/freshness.ts) is a fixed constant, not a per-report
// field — there is nothing to set short for a real-time test to wait out
// without either sleeping 45 real minutes or weakening the production
// constant for every environment.
//
// Instead, every read/report/decay function in src/lib/aa-room.ts takes
// an explicit, optional `now` (defaulting to the real clock — production
// never overrides it) and an explicit, optional `store` (defaulting to
// the app's one shared SQLite connection). This test builds its own
// throwaway in-memory database — never the app's DB_PATH, so there is no
// risk of racing any other spec file's connection to the same file, and
// no process-wide env mutation (see notes/adr/0003-aa-room-live-state.md,
// Mechanics, and src/lib/aa-room.ts's own note on why `store` exists) —
// and calls the REAL getAaRoom()/reportAaRoomStatus() against it with a
// constructed `now`, so the actual decay SQL runs, not a reimplementation
// of its logic in the test.
function freshTestStore(): AaRoomStore {
  const db = new DatabaseSync(":memory:");
  // The real schema, not a hand-copied subset of it — this also creates
  // `machines`/`sessions`, unused here but harmless, since the point is
  // to run the actual aa_room DDL this app ships, not a parallel one that
  // could silently drift from it.
  db.exec(readFileSync(join(process.cwd(), "db/schema.sql"), "utf8"));
  return { db };
}

it("a fresh database seeds AA Room as unknown with no freshness to grade", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const room = getAaRoom(now, store);
  expect(room.occupancy).toBe("unknown");
  expect(room.activities).toEqual([]);
  expect(room.confirmedAt).toBeNull();
  expect(room.freshness).toBeNull();
});

it("seeding is idempotent — calling it again against an already-seeded store changes nothing", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);
  seedAaRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const room = getAaRoom(now, store);
  expect(room.version).toBe(1);
});

it("a report well within the fresh window is read back as fresh", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const result = reportAaRoomStatus(
    { occupancy: "occupied", activities: ["pool"], reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(result.ok).toBe(true);

  const shortlyAfter = reportedAt + 60_000; // 1 minute later — well under 15
  const room = getAaRoom(shortlyAfter, store);
  expect(room.occupancy).toBe("occupied");
  expect(room.activities).toEqual(["pool"]);
  expect(room.freshness).toBe("fresh");
});

// v2 (notes/adr/0003-aa-room-live-state.md, "Design correction, v2"):
// tv/pool/table-tennis/hanging-out are independent and can co-occur —
// this is the persistence-layer version of the same round-trip
// spec/aa-room.test.ts checks over HTTP.
it("persists and canonically orders multiple simultaneous non-event activities", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const result = reportAaRoomStatus(
    { occupancy: "occupied", activities: ["hanging-out", "tv", "table-tennis", "tv"], reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(result.ok).toBe(true);
  expect(result.ok && result.room.activities).toEqual(["tv", "table-tennis", "hanging-out"]);

  const room = getAaRoom(reportedAt + 1000, store);
  expect(room.activities).toEqual(["tv", "table-tennis", "hanging-out"]);
});

it("a report read back past the fresh threshold but short of expiry reads as stale, with the stored occupancy untouched", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportAaRoomStatus(
    { occupancy: "occupied", activities: ["tv"], reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.room.version : -1;

  const midStale = reportedAt + AA_ROOM_FRESH_MS + 60_000; // 16 minutes later
  const room = getAaRoom(midStale, store);
  expect(room.occupancy).toBe("occupied"); // stale is presentation-only — nothing decayed yet
  expect(room.activities).toEqual(["tv"]);
  expect(room.freshness).toBe("stale");
  expect(room.version).toBe(versionAfterReport); // no mutation happened for "stale"
});

it("a report read back past the 45-minute expiry decays to unknown via the real decay code path, clearing activities and advancing version", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportAaRoomStatus(
    { occupancy: "occupied", activities: ["table-tennis"], reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.room.version : -1;

  const pastExpiry = reportedAt + AA_ROOM_EXPIRE_MS + 60_000; // 46 minutes later
  const decayed = getAaRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");
  expect(decayed.activities).toEqual([]);
  expect(decayed.freshness).toBeNull();
  // Decay is a real, canonical mutation — it must advance version exactly
  // like a resident's report does, so a stale client can't silently
  // resurrect the state it just invalidated. See
  // notes/adr/0003-aa-room-live-state.md, Decision 4.
  expect(decayed.version).toBeGreaterThan(versionAfterReport);

  // The decay is persisted, not just reflected in this one read's return
  // value — an independent later read (still past expiry) sees the same
  // already-decayed row, not a second decay transition.
  const again = getAaRoom(pastExpiry + 1000, store);
  expect(again.occupancy).toBe("unknown");
  expect(again.version).toBe(decayed.version);
});

it("empty decays to unknown exactly like occupied does — no stickiness for AA Room's occupancy", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportAaRoomStatus({ occupancy: "empty", activities: [], reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const pastExpiry = reportedAt + AA_ROOM_EXPIRE_MS + 1;
  const decayed = getAaRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");
});

// Stage 3: decay must broadcast exactly like a resident's report does —
// see notes/adr/0003-aa-room-live-state.md and src/lib/aa-room.ts's own
// decayedAaRoom(). Subscribes directly to src/lib/realtime.ts (imported
// within this same test file, so this is the same module instance
// src/lib/aa-room.ts's broadcast() calls go through here — Vitest gives
// each test FILE its own module registry, not each `it()`, so this
// subscription only ever sees broadcasts this file's own calls produce).
it("a decay transition broadcasts the new 'unknown' state over realtime.ts, exactly once", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const reportedAt = 1_700_000_000_000;
  const report = reportAaRoomStatus(
    { occupancy: "occupied", activities: ["event"], reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);
  // The report itself also broadcasts (same as a real resident report) —
  // expected, and not what this test is isolating; cleared below so the
  // decay assertion only looks at what decay itself produced.
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ kind: "aa-room", room: report.ok ? report.room : undefined });
  received.length = 0;

  const pastExpiry = reportedAt + AA_ROOM_EXPIRE_MS + 60_000;
  const decayed = getAaRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");

  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ kind: "aa-room", room: decayed });

  // A second read, still past expiry, must NOT broadcast again — nothing
  // actually changed this time (see decayedAaRoom()'s own "no mutation,
  // no broadcast" branch).
  getAaRoom(pastExpiry + 1000, store);
  expect(received).toHaveLength(1);

  unsubscribe();
});

// The ADR's own "do not fake updates" boundary: a read that finds nothing
// to decay (occupancy already fresh) must not broadcast. decayedAaRoom()
// returns early before ever reaching its UPDATE/broadcast when
// computeFreshness() isn't null — this proves that early return actually
// produces zero broadcasts over a real subscription, not just that the
// returned state looks unchanged.
it("an ordinary read that finds nothing stale broadcasts nothing", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportAaRoomStatus(
    { occupancy: "occupied", activities: ["tv"], reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const shortlyAfter = reportedAt + 60_000; // well within the fresh window
  const room = getAaRoom(shortlyAfter, store);
  expect(room.occupancy).toBe("occupied"); // nothing decayed

  expect(received).toEqual([]);
  unsubscribe();
});

it("reporting against a stale ifVersion is rejected 409-equivalent (ok: false) without mutating the row", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const first = reportAaRoomStatus({ occupancy: "occupied", activities: ["tv"], reporterId: "a" }, 1, now, store);
  expect(first.ok).toBe(true);

  const stale = reportAaRoomStatus({ occupancy: "empty", activities: [], reporterId: "b" }, 1, now, store);
  expect(stale.ok).toBe(false);
  if (!stale.ok) {
    expect(stale.current.occupancy).toBe("occupied");
    expect(stale.current.activities).toEqual(["tv"]);
  }
});

it("a stale-ifVersion report that gets rejected broadcasts nothing", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const first = reportAaRoomStatus({ occupancy: "occupied", activities: ["tv"], reporterId: "a" }, 1, now, store);
  expect(first.ok).toBe(true);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const stale = reportAaRoomStatus({ occupancy: "empty", activities: [], reporterId: "b" }, 1, now, store);
  expect(stale.ok).toBe(false);

  expect(received).toEqual([]);
  unsubscribe();
});

// --- v2 migration: bringing an already-deployed v1 row forward ---
// (notes/adr/0003-aa-room-live-state.md, "Migrating the already-deployed
// v1 row"). These build a throwaway database carrying the OLD (v1)
// `aa_room` schema directly — not db/schema.sql, which already ships the
// v2 `activities` column — so migrateAaRoomActivitiesColumn() is actually
// exercised against the exact shape a pre-correction production /data
// volume has, not a schema that already matches the target.
function legacyV1Store(): AaRoomStore {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE aa_room (
      id            TEXT PRIMARY KEY DEFAULT 'aa-room',
      occupancy     TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
      activity      TEXT
                      CHECK (activity IN ('tv', 'pool', 'table-tennis', 'event')),
      confirmed_at  INTEGER,
      reporter_id   TEXT,
      version       INTEGER NOT NULL DEFAULT 1
    );
  `);
  return { db };
}

it.each([
  ["tv", ["tv"]],
  ["pool", ["pool"]],
  ["table-tennis", ["table-tennis"]],
  ["event", ["event"]],
  [null, ["hanging-out"]], // occupied + activity NULL under v1 meant exactly this
] as const)(
  "migrates an already-deployed occupied v1 row with activity=%s to activities=%j",
  (legacyActivity, expectedActivities) => {
    const store = legacyV1Store();
    store.db
      .prepare(
        "INSERT INTO aa_room (id, occupancy, activity, confirmed_at, reporter_id, version) VALUES ('aa-room', 'occupied', ?, 1700000000000, 'someone', 3)",
      )
      .run(legacyActivity);

    migrateAaRoomActivitiesColumn(store);

    const row = store.db.prepare("SELECT occupancy, activities, activity, version FROM aa_room WHERE id = 'aa-room'").get() as {
      occupancy: string;
      activities: string;
      activity: string | null;
      version: number;
    };
    expect(JSON.parse(row.activities)).toEqual(expectedActivities);
    // Migrating is not itself a report — it must not touch occupancy,
    // version, or the legacy column's own value (kept, not dropped, per
    // the ADR: reversible rather than destructive).
    expect(row.occupancy).toBe("occupied");
    expect(row.activity).toBe(legacyActivity);
    expect(row.version).toBe(3);

    // The real getAaRoom()/reportAaRoomStatus() code path reads the
    // migrated row correctly, not just the raw column.
    const state = getAaRoom(1_700_000_001_000, store);
    expect(state.activities).toEqual(expectedActivities);
  },
);

it("migrates an already-deployed empty v1 row to an empty activities array", () => {
  const store = legacyV1Store();
  store.db
    .prepare(
      "INSERT INTO aa_room (id, occupancy, activity, confirmed_at, reporter_id, version) VALUES ('aa-room', 'empty', NULL, 1700000000000, 'someone', 2)",
    )
    .run();

  migrateAaRoomActivitiesColumn(store);

  const state = getAaRoom(1_700_000_001_000, store);
  expect(state.occupancy).toBe("empty");
  expect(state.activities).toEqual([]);
});

it("migrates an already-deployed unknown (never-reported) v1 row to an empty activities array", () => {
  const store = legacyV1Store();
  // No INSERT at all — mirrors a freshly-deployed-but-never-seeded v1
  // row's absence; migrateAaRoomActivitiesColumn() must tolerate this
  // (seedAaRoomIfEmpty() runs after it) rather than throwing.
  expect(() => migrateAaRoomActivitiesColumn(store)).not.toThrow();

  seedAaRoomIfEmpty(store);
  const state = getAaRoom(1_700_000_001_000, store);
  expect(state.occupancy).toBe("unknown");
  expect(state.activities).toEqual([]);
});

// The exact scenario the user's migration plan specifically called out:
// an ADD COLUMN that commits, followed by a process restart BEFORE the
// backfill UPDATE runs — "the column exists" must never be mistaken for
// "backfill already happened."
it("recovers correctly if a prior run added the activities column but crashed before backfilling it", () => {
  const store = legacyV1Store();
  store.db
    .prepare(
      "INSERT INTO aa_room (id, occupancy, activity, confirmed_at, reporter_id, version) VALUES ('aa-room', 'occupied', 'pool', 1700000000000, 'someone', 5)",
    )
    .run();
  // Simulate exactly the ALTER TABLE half of a prior, interrupted
  // migration run — column added, still at its default, backfill never
  // ran.
  store.db.exec("ALTER TABLE aa_room ADD COLUMN activities TEXT NOT NULL DEFAULT '[]'");

  migrateAaRoomActivitiesColumn(store);

  const state = getAaRoom(1_700_000_001_000, store);
  expect(state.activities).toEqual(["pool"]);
});

it("is idempotent — running it again after a successful migration changes nothing further", () => {
  const store = legacyV1Store();
  store.db
    .prepare(
      "INSERT INTO aa_room (id, occupancy, activity, confirmed_at, reporter_id, version) VALUES ('aa-room', 'occupied', 'event', 1700000000000, 'someone', 7)",
    )
    .run();

  migrateAaRoomActivitiesColumn(store);
  migrateAaRoomActivitiesColumn(store);
  migrateAaRoomActivitiesColumn(store);

  const state = getAaRoom(1_700_000_001_000, store);
  expect(state.activities).toEqual(["event"]);

  const row = store.db.prepare("SELECT version FROM aa_room WHERE id = 'aa-room'").get() as { version: number };
  expect(row.version).toBe(7); // never bumped by the migration itself
});

it("a fresh v2 database (already shipped with the activities column) is left untouched by the migration", () => {
  const store = freshTestStore(); // db/schema.sql — the current, v2 schema
  seedAaRoomIfEmpty(store);

  expect(() => migrateAaRoomActivitiesColumn(store)).not.toThrow();

  const state = getAaRoom(1_700_000_000_000, store);
  expect(state.occupancy).toBe("unknown");
  expect(state.activities).toEqual([]);
});
