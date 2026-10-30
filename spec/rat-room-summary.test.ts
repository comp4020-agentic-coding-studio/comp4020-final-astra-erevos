import { expect, it } from "vitest";
import { summarizeRatRoomSeats } from "../src/lib/types.ts";
import type { RatRoomSeatId, RatRoomSeatOccupancy, RatRoomSeatState } from "../src/lib/types.ts";

// Pure logic, no HTTP, no database — summarizeRatRoomSeats() is a plain
// function of the ten seats' own occupancy values, never read from or
// written to anywhere (ADR 0008, Decision 4: "purely derived, never
// persisted, never a second source of truth"). Mirrors
// spec/freshness.test.ts's own "import the function directly" shape for
// the same reason: the point is the derivation itself, not a round trip.

const SEATS: readonly RatRoomSeatId[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

// Builds ten RatRoomSeatState rows from a shorthand occupancy list —
// expectedEndAt/confirmedAt/version are irrelevant to the summary (ADR
// 0008, Decision 4: "a pure function of the ten seats' own occupancy
// values alone"), so every seat here gets the same placeholder values to
// make that independence explicit, not just assumed.
function seatsWith(occupancies: readonly RatRoomSeatOccupancy[]): RatRoomSeatState[] {
  expect(occupancies).toHaveLength(10);
  return occupancies.map((occupancy, i) => ({
    id: `rat-room-${SEATS[i]!.toLowerCase()}`,
    seat: SEATS[i]!,
    occupancy,
    expectedEndAt: null,
    confirmedAt: null,
    version: 1,
  }));
}

it("one occupied + nine unknown -> visual is occupied, regardless of the rest", () => {
  const seats = seatsWith(["occupied", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  const summary = summarizeRatRoomSeats(seats);
  expect(summary.visual).toBe("occupied");
  expect(summary.occupiedCount).toBe(1);
  expect(summary.unknownCount).toBe(9);
  expect(summary.emptyCount).toBe(0);
});

it("all ten empty -> visual is empty", () => {
  const seats = seatsWith(Array(10).fill("empty"));
  const summary = summarizeRatRoomSeats(seats);
  expect(summary.visual).toBe("empty");
  expect(summary.emptyCount).toBe(10);
  expect(summary.occupiedCount).toBe(0);
  expect(summary.unknownCount).toBe(0);
});

it("nine empty + one unknown, no occupied -> visual is unknown (the honest middle case)", () => {
  const seats = seatsWith(["empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "unknown"]);
  const summary = summarizeRatRoomSeats(seats);
  expect(summary.visual).toBe("unknown");
  expect(summary.emptyCount).toBe(9);
  expect(summary.unknownCount).toBe(1);
  expect(summary.occupiedCount).toBe(0);
});

it("six empty + two occupied + two unknown -> exact counts, visual occupied (occupied always wins)", () => {
  const seats = seatsWith(["empty", "empty", "empty", "empty", "empty", "empty", "occupied", "occupied", "unknown", "unknown"]);
  const summary = summarizeRatRoomSeats(seats);
  expect(summary.emptyCount).toBe(6);
  expect(summary.occupiedCount).toBe(2);
  expect(summary.unknownCount).toBe(2);
  expect(summary.visual).toBe("occupied");
});

it("unknown seats are never counted as confirmed-free", () => {
  // Nine confirmed-free would be a very different (and wrong) answer
  // from the honest one: only the seats actually confirmed empty may
  // ever be presented as available (ADR 0008, Decision 4).
  const seats = seatsWith(["empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "unknown"]);
  const summary = summarizeRatRoomSeats(seats);
  expect(summary.emptyCount).toBe(9);
  expect(summary.emptyCount).not.toBe(10);
  expect(summary.unknownCount).toBe(1);
});

it("a single occupied seat among otherwise all-empty seats still reports visual occupied and the correct free count", () => {
  const seats = seatsWith(["empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "occupied"]);
  const summary = summarizeRatRoomSeats(seats);
  expect(summary.visual).toBe("occupied");
  expect(summary.emptyCount).toBe(9);
  expect(summary.occupiedCount).toBe(1);
});
