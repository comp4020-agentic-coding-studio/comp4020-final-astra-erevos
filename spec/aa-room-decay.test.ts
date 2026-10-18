import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { getAaRoom, reportAaRoomStatus, seedAaRoomIfEmpty, type AaRoomStore } from "../src/lib/aa-room.ts";
import { AA_ROOM_EXPIRE_MS, AA_ROOM_FRESH_MS } from "../src/lib/freshness.ts";

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
  expect(room.activity).toBeNull();
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
    { occupancy: "occupied", activity: "pool", reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(result.ok).toBe(true);

  const shortlyAfter = reportedAt + 60_000; // 1 minute later — well under 15
  const room = getAaRoom(shortlyAfter, store);
  expect(room.occupancy).toBe("occupied");
  expect(room.activity).toBe("pool");
  expect(room.freshness).toBe("fresh");
});

it("a report read back past the fresh threshold but short of expiry reads as stale, with the stored occupancy untouched", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportAaRoomStatus(
    { occupancy: "occupied", activity: "tv", reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.room.version : -1;

  const midStale = reportedAt + AA_ROOM_FRESH_MS + 60_000; // 16 minutes later
  const room = getAaRoom(midStale, store);
  expect(room.occupancy).toBe("occupied"); // stale is presentation-only — nothing decayed yet
  expect(room.activity).toBe("tv");
  expect(room.freshness).toBe("stale");
  expect(room.version).toBe(versionAfterReport); // no mutation happened for "stale"
});

it("a report read back past the 45-minute expiry decays to unknown via the real decay code path, clearing activity and advancing version", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportAaRoomStatus(
    { occupancy: "occupied", activity: "table-tennis", reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.room.version : -1;

  const pastExpiry = reportedAt + AA_ROOM_EXPIRE_MS + 60_000; // 46 minutes later
  const decayed = getAaRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");
  expect(decayed.activity).toBeNull();
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
  const report = reportAaRoomStatus({ occupancy: "empty", activity: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const pastExpiry = reportedAt + AA_ROOM_EXPIRE_MS + 1;
  const decayed = getAaRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");
});

it("reporting against a stale ifVersion is rejected 409-equivalent (ok: false) without mutating the row", () => {
  const store = freshTestStore();
  seedAaRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const first = reportAaRoomStatus({ occupancy: "occupied", activity: "tv", reporterId: "a" }, 1, now, store);
  expect(first.ok).toBe(true);

  const stale = reportAaRoomStatus({ occupancy: "empty", activity: null, reporterId: "b" }, 1, now, store);
  expect(stale.ok).toBe(false);
  if (!stale.ok) {
    expect(stale.current.occupancy).toBe("occupied");
    expect(stale.current.activity).toBe("tv");
  }
});
