import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  getRatRoomSeat,
  listRatRoomSeats,
  RAT_ROOM_SEAT_EMPTY_DECAY_MS,
  RAT_ROOM_SEAT_MAX_OCCUPIED_MS,
  reportRatRoomSeatStatus,
  seedRatRoomSeatsIfEmpty,
  type RatRoomStore,
} from "../src/lib/rat-room.ts";
import { subscribe, type BroadcastPayload } from "../src/lib/realtime.ts";

// Rat Room's decay thresholds (src/lib/rat-room.ts) are fixed constants,
// applied independently per seat — mirrors every sibling room's own
// decay spec's reasoning for why this can't be exercised the way
// spec/decay.test.ts exercises a machine's own expected_end_at (a
// resident-set value, not a fixed constant).
//
// Every read/report/decay function in src/lib/rat-room.ts takes an
// explicit, required `now` and an explicit, required `store` — this
// module never imports src/lib/db.ts itself (see src/lib/rat-room-db.ts
// for that wiring), which is what lets this test build its own throwaway
// in-memory database and call the REAL getRatRoomSeat()/
// listRatRoomSeats()/reportRatRoomSeatStatus() against it with a
// constructed `now`, without ever touching the app's real on-disk SQLite
// connection — the exact isolation `91167bd` established for
// AA/Otter/Rabbit Room (see PROCESS.md), continued unchanged for this
// sixth consecutive decay spec file.
function freshTestStore(): RatRoomStore {
  const db = new DatabaseSync(":memory:");
  // The real schema, not a hand-copied subset of it.
  db.exec(readFileSync(join(process.cwd(), "db/schema.sql"), "utf8"));
  return { db };
}

it("a fresh database seeds exactly ten seats, A through J, each unknown with no expectedEndAt", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const now = 1_700_000_000_000;
  const seats = listRatRoomSeats(now, store);
  expect(seats).toHaveLength(10);
  expect(seats.map((s) => s.seat)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  for (const seat of seats) {
    expect(seat.occupancy).toBe("unknown");
    expect(seat.expectedEndAt).toBeNull();
    expect(seat.confirmedAt).toBeNull();
    expect(seat.version).toBe(1);
  }
});

it("seeding is idempotent — calling it again against an already-seeded store changes nothing", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);
  seedRatRoomSeatsIfEmpty(store);

  const now = 1_700_000_000_000;
  const seats = listRatRoomSeats(now, store);
  expect(seats).toHaveLength(10);
  expect(seats.every((s) => s.version === 1)).toBe(true);
});

it("getRatRoomSeat returns undefined for a seat identifier that was never seeded", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);
  // @ts-expect-error — deliberately an invalid seat id, to confirm the
  // store-level function itself (not just the API route) refuses to
  // fabricate a row for one.
  const result = getRatRoomSeat("Z", 1_700_000_000_000, store);
  expect(result).toBeUndefined();
});

// --- empty: 15-minute decay (ADR 0008, Decision 3 — a product freshness
// judgement independently re-derived for Rat Room from its own walk-up,
// no-reservation facts) ---

it("an empty report read back well within 15 minutes stays empty", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportRatRoomSeatStatus("A", { occupancy: "empty", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const shortlyAfter = reportedAt + 60_000; // 1 minute later — well under 15
  const seat = getRatRoomSeat("A", shortlyAfter, store);
  expect(seat?.occupancy).toBe("empty");
});

it("an empty report decays to unknown past 15 minutes via the real decay code path", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportRatRoomSeatStatus("B", { occupancy: "empty", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.seat.version : -1;

  const pastExpiry = reportedAt + RAT_ROOM_SEAT_EMPTY_DECAY_MS + 1_000;
  const decayed = getRatRoomSeat("B", pastExpiry, store);
  expect(decayed?.occupancy).toBe("unknown");
  expect(decayed?.expectedEndAt).toBeNull();
  // Decay is a real, canonical mutation — it must advance version exactly
  // like a resident's report does.
  expect(decayed!.version).toBeGreaterThan(versionAfterReport);

  // Persisted, not just reflected in this one read's return value.
  const again = getRatRoomSeat("B", pastExpiry + 1000, store);
  expect(again?.occupancy).toBe("unknown");
  expect(again?.version).toBe(decayed!.version);
});

// --- occupied, no expectedEndAt: 4-hour decay (ADR 0008, Decision 3 — a
// real community norm confirmed for Rat Room specifically, stated at the
// per-seat grain from the start) ---

it("an occupied report with no expectedEndAt stays occupied well within 4 hours", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportRatRoomSeatStatus("C", { occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const oneHourLater = reportedAt + 60 * 60 * 1000;
  const seat = getRatRoomSeat("C", oneHourLater, store);
  expect(seat?.occupancy).toBe("occupied");
});

it("an occupied report with no expectedEndAt decays to unknown past 4 hours", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportRatRoomSeatStatus("D", { occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);
  const versionAfterReport = report.ok ? report.seat.version : -1;

  const pastExpiry = reportedAt + RAT_ROOM_SEAT_MAX_OCCUPIED_MS + 1_000;
  const decayed = getRatRoomSeat("D", pastExpiry, store);
  expect(decayed?.occupancy).toBe("unknown");
  expect(decayed?.expectedEndAt).toBeNull();
  expect(decayed!.version).toBeGreaterThan(versionAfterReport);
});

// --- occupied with expectedEndAt: min(expectedEndAt, confirmedAt + 4h) ---

it("an occupied report with an expectedEndAt inside the 4h ceiling decays exactly at that expectedEndAt, not at 4h", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const expectedEndAt = reportedAt + 30 * 60 * 1000; // 30 minutes — well inside the 4h ceiling
  const report = reportRatRoomSeatStatus(
    "E",
    { occupancy: "occupied", expectedEndAt, reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);

  // Still before its own expectedEndAt — must not have decayed yet.
  const justBefore = getRatRoomSeat("E", expectedEndAt - 1_000, store);
  expect(justBefore?.occupancy).toBe("occupied");

  // Past its own expectedEndAt, but nowhere near the 4h ceiling — must
  // already have decayed, proving the estimate (not the 4h ceiling) is
  // what fired.
  const justAfter = getRatRoomSeat("E", expectedEndAt + 1_000, store);
  expect(justAfter?.occupancy).toBe("unknown");
});

it("an occupied report's expectedEndAt can never extend decay past the 4-hour ceiling", () => {
  // The API route (src/pages/api/rat-room/[seat].ts) already rejects an
  // expectedEndAt beyond now + 4h on write — this test exercises the
  // store-level decay formula directly, independent of that write-path
  // guard, to prove decayedRatRoomSeat()'s own min() enforces the ceiling
  // even if an out-of-range value somehow reached storage.
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const beyondCeiling = reportedAt + RAT_ROOM_SEAT_MAX_OCCUPIED_MS + 60 * 60 * 1000; // 5 hours out
  const report = reportRatRoomSeatStatus(
    "F",
    { occupancy: "occupied", expectedEndAt: beyondCeiling, reporterId: "test-actor" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);

  const justPastCeiling = getRatRoomSeat("F", reportedAt + RAT_ROOM_SEAT_MAX_OCCUPIED_MS + 1_000, store);
  expect(justPastCeiling?.occupancy).toBe("unknown");
});

// --- per-observation expectedEndAt: never inherited across reports ---

it("a report that omits expectedEndAt does not inherit a previous report's value at the store level", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const first = reportRatRoomSeatStatus(
    "G",
    { occupancy: "occupied", expectedEndAt: reportedAt + 60_000, reporterId: "a" },
    1,
    reportedAt,
    store,
  );
  expect(first.ok).toBe(true);
  const versionAfterFirst = first.ok ? first.seat.version : -1;

  const second = reportRatRoomSeatStatus(
    "G",
    { occupancy: "occupied", expectedEndAt: null, reporterId: "b" },
    versionAfterFirst,
    reportedAt + 1_000,
    store,
  );
  expect(second.ok).toBe(true);
  expect(second.ok && second.seat.expectedEndAt).toBeNull();

  const seat = getRatRoomSeat("G", reportedAt + 2_000, store);
  expect(seat?.expectedEndAt).toBeNull();
});

it("an empty report always stores expectedEndAt as null, even forcing it past validation", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportRatRoomSeatStatus(
    "H",
    { occupancy: "empty", expectedEndAt: reportedAt + 60_000, reporterId: "a" },
    1,
    reportedAt,
    store,
  );
  expect(report.ok).toBe(true);
  expect(report.ok && report.seat.expectedEndAt).toBeNull();
});

// --- cross-seat independence: the central NEW behavior this facility's
// own decay spec must cover that no single-row room ever needed to ---

it("decaying one seat never touches any other seat's own row", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  // Seat A: will decay past its own 15-minute empty ceiling.
  const reportA = reportRatRoomSeatStatus("A", { occupancy: "empty", expectedEndAt: null, reporterId: "a" }, 1, reportedAt, store);
  expect(reportA.ok).toBe(true);
  // Seat B: occupied, well within its own 4-hour ceiling — must stay
  // exactly as reported when seat A's own row decays.
  const reportB = reportRatRoomSeatStatus("B", { occupancy: "occupied", expectedEndAt: null, reporterId: "b" }, 1, reportedAt, store);
  expect(reportB.ok).toBe(true);
  const versionBBeforeADecay = reportB.ok ? reportB.seat.version : -1;

  const pastASeatExpiry = reportedAt + RAT_ROOM_SEAT_EMPTY_DECAY_MS + 1_000;
  const decayedA = getRatRoomSeat("A", pastASeatExpiry, store);
  expect(decayedA?.occupancy).toBe("unknown");

  // Seat B must be completely unaffected by seat A's own decay read.
  const seatBAfter = getRatRoomSeat("B", pastASeatExpiry, store);
  expect(seatBAfter?.occupancy).toBe("occupied");
  expect(seatBAfter?.version).toBe(versionBBeforeADecay);
});

it("reading all ten seats via listRatRoomSeats applies decay independently per seat, not as one combined operation", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  // Seat C: empty, past its own 15-minute ceiling by the time we list.
  reportRatRoomSeatStatus("C", { occupancy: "empty", expectedEndAt: null, reporterId: "a" }, 1, reportedAt, store);
  // Seat D: occupied, well within its own 4-hour ceiling.
  reportRatRoomSeatStatus("D", { occupancy: "occupied", expectedEndAt: null, reporterId: "b" }, 1, reportedAt, store);

  const readAt = reportedAt + RAT_ROOM_SEAT_EMPTY_DECAY_MS + 1_000;
  const seats = listRatRoomSeats(readAt, store);
  const seatC = seats.find((s) => s.seat === "C")!;
  const seatD = seats.find((s) => s.seat === "D")!;
  expect(seatC.occupancy).toBe("unknown"); // decayed
  expect(seatD.occupancy).toBe("occupied"); // untouched by C's own decay
});

// --- broadcast behaviour, mirroring every sibling room's own decay spec —
// but the payload must carry the correct seat identity, never a different
// one. ---

it("a decay transition broadcasts the new 'unknown' state carrying the correct seat, exactly once", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const reportedAt = 1_700_000_000_000;
  const report = reportRatRoomSeatStatus("I", { occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ kind: "rat-room", seat: report.ok ? report.seat : undefined });
  expect(received[0]!.kind === "rat-room" && received[0]!.seat.seat).toBe("I");
  received.length = 0;

  const pastExpiry = reportedAt + RAT_ROOM_SEAT_MAX_OCCUPIED_MS + 60_000;
  const decayed = getRatRoomSeat("I", pastExpiry, store);
  expect(decayed?.occupancy).toBe("unknown");

  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ kind: "rat-room", seat: decayed });
  expect(received[0]!.kind === "rat-room" && received[0]!.seat.seat).toBe("I");

  // A second read, still past expiry, must NOT broadcast again.
  getRatRoomSeat("I", pastExpiry + 1000, store);
  expect(received).toHaveLength(1);

  unsubscribe();
});

it("an ordinary read that finds nothing stale broadcasts nothing", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const reportedAt = 1_700_000_000_000;
  const report = reportRatRoomSeatStatus("J", { occupancy: "occupied", expectedEndAt: null, reporterId: "test-actor" }, 1, reportedAt, store);
  expect(report.ok).toBe(true);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const shortlyAfter = reportedAt + 60_000; // well within either threshold
  const seat = getRatRoomSeat("J", shortlyAfter, store);
  expect(seat?.occupancy).toBe("occupied"); // nothing decayed

  expect(received).toEqual([]);
  unsubscribe();
});

it("reporting against a stale ifVersion is rejected (ok: false, reason stale) without mutating the row", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const now = 1_700_000_000_000;
  const first = reportRatRoomSeatStatus("A", { occupancy: "occupied", expectedEndAt: null, reporterId: "a" }, 1, now, store);
  expect(first.ok).toBe(true);

  const stale = reportRatRoomSeatStatus("A", { occupancy: "empty", expectedEndAt: null, reporterId: "b" }, 1, now, store);
  expect(stale.ok).toBe(false);
  if (!stale.ok && stale.reason === "stale") {
    expect(stale.current.occupancy).toBe("occupied");
    expect(stale.current.seat).toBe("A");
  } else {
    expect.fail("expected a stale rejection");
  }
});

it("a stale-ifVersion report that gets rejected broadcasts nothing", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const now = 1_700_000_000_000;
  const first = reportRatRoomSeatStatus("B", { occupancy: "occupied", expectedEndAt: null, reporterId: "a" }, 1, now, store);
  expect(first.ok).toBe(true);

  const received: BroadcastPayload[] = [];
  const unsubscribe = subscribe((payload) => received.push(payload));

  const stale = reportRatRoomSeatStatus("B", { occupancy: "empty", expectedEndAt: null, reporterId: "b" }, 1, now, store);
  expect(stale.ok).toBe(false);

  expect(received).toEqual([]);
  unsubscribe();
});

it("reporting a seat identifier that doesn't exist returns ok: false, reason not-found", () => {
  const store = freshTestStore();
  seedRatRoomSeatsIfEmpty(store);

  const now = 1_700_000_000_000;
  // @ts-expect-error — deliberately an invalid seat id.
  const result = reportRatRoomSeatStatus("Z", { occupancy: "occupied", expectedEndAt: null, reporterId: "a" }, 1, now, store);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("not-found");
});
