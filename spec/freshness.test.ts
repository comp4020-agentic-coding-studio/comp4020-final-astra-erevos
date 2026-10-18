import { expect, it } from "vitest";
import { AA_ROOM_EXPIRE_MS, AA_ROOM_FRESH_MS, computeFreshness } from "../src/lib/freshness.ts";

// Pure logic, tested with constructed timestamps rather than real elapsed
// time — see notes/adr/0003-aa-room-live-state.md, Decision 3, and
// src/lib/freshness.ts's own note on why now is always a parameter here.
// These run in-process (import the function directly), the same choice
// spec/request-protocol.test.ts makes for the same reason: the point is
// the decision function itself, not an HTTP round trip.
const BASE = 1_700_000_000_000; // an arbitrary fixed "now" to anchor every case on

it("just under the fresh threshold is fresh", () => {
  const confirmedAt = BASE - (AA_ROOM_FRESH_MS - 60_000); // 14:00 ago, with margin to land clearly under 15:00
  expect(computeFreshness("occupied", confirmedAt, BASE)).toBe("fresh");
});

it("exactly 14:59 old is fresh", () => {
  const confirmedAt = BASE - (15 * 60_000 - 1000);
  expect(computeFreshness("occupied", confirmedAt, BASE)).toBe("fresh");
});

it("exactly 15:00 old is stale", () => {
  const confirmedAt = BASE - 15 * 60_000;
  expect(computeFreshness("occupied", confirmedAt, BASE)).toBe("stale");
});

it("exactly 44:59 old is stale", () => {
  const confirmedAt = BASE - (45 * 60_000 - 1000);
  expect(computeFreshness("occupied", confirmedAt, BASE)).toBe("stale");
});

it("exactly 45:00 old is expired (null), not stale", () => {
  const confirmedAt = BASE - 45 * 60_000;
  expect(computeFreshness("occupied", confirmedAt, BASE)).toBeNull();
});

it("well past 45:00 is also expired (null)", () => {
  const confirmedAt = BASE - AA_ROOM_EXPIRE_MS - 60_000;
  expect(computeFreshness("empty", confirmedAt, BASE)).toBeNull();
});

it("empty ages exactly the same way occupied does", () => {
  const confirmedAt = BASE - (AA_ROOM_FRESH_MS + 60_000);
  expect(computeFreshness("empty", confirmedAt, BASE)).toBe("stale");
});

it("occupancy unknown is always null, regardless of confirmedAt", () => {
  expect(computeFreshness("unknown", BASE - 1000, BASE)).toBeNull();
  expect(computeFreshness("unknown", null, BASE)).toBeNull();
});

it("a null confirmedAt is always null, regardless of occupancy", () => {
  expect(computeFreshness("empty", null, BASE)).toBeNull();
  expect(computeFreshness("occupied", null, BASE)).toBeNull();
});
