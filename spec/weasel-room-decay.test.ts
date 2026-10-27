import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  getWeaselRoom,
  WEASEL_ROOM_EMPTY_DECAY_MS,
  WEASEL_ROOM_MAX_OCCUPIED_MS,
  reportWeaselRoomStatus,
  seedWeaselRoomIfEmpty,
  type WeaselRoomStore,
} from "../src/lib/weasel-room.ts";
import { subscribe, type BroadcastPayload } from "../src/lib/realtime.ts";

// Weasel Room's decay thresholds (src/lib/weasel-room.ts) are fixed
// constants, not a per-report field — mirrors spec/rabbit-room-decay.test.ts's
// own reasoning for why this can't be exercised the way
// spec/decay.test.ts exercises a machine's (a machine's own
// expected_end_at is a value the reporting client sets per-request to
// anything it likes; Weasel Room's 15-minute/4-hour thresholds are not).
//
// Every read/report/decay function in src/lib/weasel-room.ts takes an
// explicit, required `now` and an explicit, required `store` — this
// module never imports src/lib/db.ts itself (see src/lib/weasel-room-db.ts
// for that wiring), which is what lets this test build its own throwaway
// in-memory database and call the REAL getWeaselRoom()/
// reportWeaselRoomStatus() against it with a constructed `now`, without
// ever touching the app's real on-disk SQLite connection — the exact
// isolation `91167bd` established for AA/Otter/Rabbit Room (see
// PROCESS.md).
function freshTestStore(): WeaselRoomStore {
  const db = new DatabaseSync(":memory:");
  // The real schema, not a hand-copied subset of it.
  db.exec(readFileSync(join(process.cwd(), "db/schema.sql"), "utf8"));
  return { db };
}

it("a fresh database seeds Weasel Room as unknown with no expectedEndAt", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const room = getWeaselRoom(now, store);
  expect(room.occupancy).toBe("unknown");
  expect(room.expectedEndAt).toBeNull();
  expect(room.confirmedAt).toBeNull();
});

it("seeding is idempotent — calling it again against an already-seeded store changes nothing", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);
  seedWeaselRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const room = getWeaselRoom(now, store);
  expect(room.version).toBe(1);
});

// --- empty: 15-minute decay (ADR 0006, Decision 2 — a product freshness
// judgement re-derived for Weasel Room, not a pre-existing community
// norm, and not assumed to transfer from Otter Room/Rabbit Room) ---

it("an empty report read back well within 15 minutes stays empty", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportWeaselRoomStatus({ occupancy: "empty", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const shortlyAfter = reportedAt + 60_000; // 1 minute later — well under 15
  const room = getWeaselRoom(shortlyAfter, store);
  expect(room.occupancy).toBe("empty");
});

it("an empty report decays to unknown past 15 minutes via the real decay code path", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportWeaselRoomStatus({ occupancy: "empty", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.room.version : -1;

  const pastExpiry = reportedAt + WEASEL_ROOM_EMPTY_DECAY_MS + 1_000;
  const decayed = getWeaselRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");
  expect(decayed.expectedEndAt).toBeNull();
  // Decay is a real, canonical mutation — it must advance version exactly
  // like a resident's report does.
  expect(decayed.version).toBeGreaterThan(versionAfterReport);

  // Persisted, not just reflected in this one read's return value.
  const again = getWeaselRoom(pastExpiry + 1000, store);
  expect(again.occupancy).toBe("unknown");
  expect(again.version).toBe(decayed.version);
});

// --- occupied, no expectedEndAt: 4-hour decay (ADR 0006, Decision 2 — a
// real community norm confirmed for Weasel Room specifically) ---

it("an occupied report with no expectedEndAt stays occupied well within 4 hours", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportWeaselRoomStatus({ occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const oneHourLater = reportedAt + 60 * 60 * 1000;
  const room = getWeaselRoom(oneHourLater, store);
  expect(room.occupancy).toBe("occupied");
});

it("an occupied report with no expectedEndAt decays to unknown past 4 hours", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportWeaselRoomStatus({ occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.room.version : -1;

  const pastExpiry = reportedAt + WEASEL_ROOM_MAX_OCCUPIED_MS + 1_000;
  const decayed = getWeaselRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");
  expect(decayed.expectedEndAt).toBeNull();
  expect(decayed.version).toBeGreaterThan(versionAfterReport);
});

// --- occupied with expectedEndAt: min(expectedEndAt, confirmedAt + 4h) ---

it("an occupied report with an expectedEndAt inside the 4h ceiling decays exactly at that expectedEndAt, not at 4h", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const expectedEndAt = reportedAt + 30 * 60 * 1000; // 30 minutes — well inside the 4h ceiling
  const report = reportWeaselRoomStatus(
    { occupancy: "occupied", expectedEndAt, reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);

  // Still before its own expectedEndAt — must not have decayed yet.
  const justBefore = getWeaselRoom(expectedEndAt - 1_000, store);
  expect(justBefore.occupancy).toBe("occupied");

  // Past its own expectedEndAt, but nowhere near the 4h ceiling — must
  // already have decayed, proving the estimate (not the 4h ceiling) is
  // what fired.
  const justAfter = getWeaselRoom(expectedEndAt + 1_000, store);
  expect(justAfter.occupancy).toBe("unknown");
});

it("an occupied report's expectedEndAt can never extend decay past the 4-hour ceiling", () => {
  // The API route (src/pages/api/weasel-room.ts) already rejects an
  // expectedEndAt beyond now + 4h on write — this test exercises the
  // store-level decay formula directly, independent of that write-path
  // guard, to prove decayedWeaselRoom()'s own min() enforces the ceiling
  // even if an out-of-range value somehow reached storage.
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const beyondCeiling = reportedAt + WEASEL_ROOM_MAX_OCCUPIED_MS + 60 * 60 * 1000; // 5 hours out
  const report = reportWeaselRoomStatus(
    { occupancy: "occupied", expectedEndAt: beyondCeiling, reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);

  // Just past the 4-hour ceiling (still well short of the stored
  // expectedEndAt) — must already have decayed, proving the ceiling, not
  // the stored estimate, is what fired.
  const justPastCeiling = getWeaselRoom(reportedAt + WEASEL_ROOM_MAX_OCCUPIED_MS + 1_000, store);
  expect(justPastCeiling.occupancy).toBe("unknown");
});

// --- per-observation expectedEndAt: never inherited across reports ---

it("a report that omits expectedEndAt does not inherit a previous report's value at the store level", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const first = reportWeaselRoomStatus(
    { occupancy: "occupied", expectedEndAt: reportedAt + 60_000, reporterId: "a" },
    1,
    reportedAt,
    store,
  );
  expect(first.ok).toBe(true);
  const versionAfterFirst = first.ok ? first.room.version : -1;

  const second = reportWeaselRoomStatus(
    { occupancy: "occupied", expectedEndAt: null, reporterId: "b" },
    versionAfterFirst,
    reportedAt + 1_000,
    store,
  );
  expect(second.ok).toBe(true);
  expect(second.ok && second.room.expectedEndAt).toBeNull();

  const room = getWeaselRoom(reportedAt + 2_000, store);
  expect(room.expectedEndAt).toBeNull();
});

it("an empty report always stores expectedEndAt as null, even forcing it past validation", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  // Calls the store function directly with a non-null expectedEndAt
  // alongside "empty" — the API route already rejects this shape, but
  // reportWeaselRoomStatus() itself must still refuse to persist it,
  // exactly as ADR 0006 requires ("no code path may skip clearing the
  // column when occupancy moves to empty").
  const report = reportWeaselRoomStatus(
    { occupancy: "empty", expectedEndAt: reportedAt + 60_000, reporterId: "a" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);
  expect(report.ok && report.room.expectedEndAt).toBeNull();
});

// --- broadcast behaviour, mirroring spec/rabbit-room-decay.test.ts ---

it("a decay transition broadcasts the new 'unknown' state over realtime.ts, exactly once", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const reportedAt = 1_700_000_000_000;
  const report = reportWeaselRoomStatus({ occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ kind: "weasel-room", room: report.ok ? report.room : undefined });
  received.length = 0;

  const pastExpiry = reportedAt + WEASEL_ROOM_MAX_OCCUPIED_MS + 60_000;
  const decayed = getWeaselRoom(pastExpiry, store);
  expect(decayed.occupancy).toBe("unknown");

  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ kind: "weasel-room", room: decayed });

  // A second read, still past expiry, must NOT broadcast again.
  getWeaselRoom(pastExpiry + 1000, store);
  expect(received).toHaveLength(1);

  unsubscribe();
});

it("an ordinary read that finds nothing stale broadcasts nothing", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportWeaselRoomStatus({ occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const shortlyAfter = reportedAt + 60_000; // well within either threshold
  const room = getWeaselRoom(shortlyAfter, store);
  expect(room.occupancy).toBe("occupied"); // nothing decayed

  expect(received).toEqual([]);
  unsubscribe();
});

it("reporting against a stale ifVersion is rejected (ok: false) without mutating the row", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const first = reportWeaselRoomStatus({ occupancy: "occupied", expectedEndAt: null, reporterId: "a" }, 1, now, store);
  expect(first.ok).toBe(true);

  const stale = reportWeaselRoomStatus({ occupancy: "empty", expectedEndAt: null, reporterId: "b" }, 1, now, store);
  expect(stale.ok).toBe(false);
  if (!stale.ok) {
    expect(stale.current.occupancy).toBe("occupied");
  }
});

it("a stale-ifVersion report that gets rejected broadcasts nothing", () => {
  const store = freshTestStore();
  seedWeaselRoomIfEmpty(store);

  const now = 1_700_000_000_000;
  const first = reportWeaselRoomStatus({ occupancy: "occupied", expectedEndAt: null, reporterId: "a" }, 1, now, store);
  expect(first.ok).toBe(true);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const stale = reportWeaselRoomStatus({ occupancy: "empty", expectedEndAt: null, reporterId: "b" }, 1, now, store);
  expect(stale.ok).toBe(false);

  expect(received).toEqual([]);
  unsubscribe();
});
