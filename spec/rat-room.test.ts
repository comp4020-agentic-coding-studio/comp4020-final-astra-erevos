import { expect, inject, it } from "vitest";
import { sessionCookie } from "./test-session.ts";

// Rat Room: Toad Live's seventh facility. See
// notes/adr/0008-rat-room-live-state.md. UNLIKE every room since AA
// Room, this is TEN independently-reportable seat resources (A-J), not
// one shared row — so, unlike those rooms' own spec files, this file
// must also cover cross-seat independence (two different seats never
// conflict with each other; a report/decay on one seat never touches
// any of the other nine) on top of the usual persistence/concurrency/
// rejection/SSE coverage every occupancy facility's own spec file has.
//
// Seats used by DIFFERENT tests below are chosen to avoid overlap where a
// stale-version race between two tests in this same (sequentially-run)
// file would matter — same defensive reasoning
// spec/concurrency.test.ts/spec/aa-room.test.ts already document — but
// every test still reads its own seat's current version immediately
// before its own PATCH rather than assuming one, since this file's tests
// still share the one running app with every other parallel spec file
// (and, for seat-independence tests specifically, with each other's own
// use of OTHER seats on purpose).
//
// Every PATCH here carries a valid Crit 10 session cookie (see
// spec/test-session.ts), so these tests keep checking Rat Room's own
// contract, not authentication — the one exception is the no-session
// test below, which checks authentication directly.
const baseUrl = inject("baseUrl");
const cookie = await sessionCookie(baseUrl);

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

async function currentVersion(seat: string): Promise<number> {
  const res = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  const body = await res.json();
  return body.version;
}

it("a GET for a valid seat returns a valid occupancy, the correct seat id, and no freshness field", async () => {
  // This only asserts shape, not that this seat has never been reported —
  // other tests in this file may have already run.
  const res = await fetch(new URL("/api/rat-room/A", baseUrl));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.seat).toBe("A");
  expect(["empty", "occupied", "unknown"]).toContain(body.occupancy);
  expect(typeof body.version).toBe("number");
  // ADR 0008, Decision 6: no freshness field at all, unlike AA Room.
  expect(body).not.toHaveProperty("freshness");
});

it("a GET for an invalid seat identifier is rejected 404", async () => {
  const res = await fetch(new URL("/api/rat-room/Z", baseUrl));
  expect(res.status).toBe(404);
});

it("a GET for the composite row id, not the logical seat letter, is rejected 404", async () => {
  // ADR 0008's own frozen route contract: :seat is always the bare
  // logical letter (A-J), never the composite storage id — a client
  // trying the internal id shape must not accidentally work.
  const res = await fetch(new URL("/api/rat-room/rat-room-a", baseUrl));
  expect(res.status).toBe(404);
});

it("an occupied report with no expectedEndAt persists across an independent later request", async () => {
  const seat = "B";
  const ifVersion = await currentVersion(seat);

  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion }),
  });
  expect(patch.status).toBe(200);
  const patched = await patch.json();
  expect(patched.seat).toBe(seat);
  expect(patched.occupancy).toBe("occupied");
  expect(patched.expectedEndAt).toBeNull();

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  expect(after.status).toBe(200);
  const body = await after.json();
  expect(body.occupancy).toBe("occupied");
  expect(body.expectedEndAt).toBeNull();
});

it("an occupied report with a valid expectedEndAt persists it", async () => {
  const seat = "C";
  const ifVersion = await currentVersion(seat);
  const expectedEndAt = Date.now() + 30 * 60 * 1000; // 30 minutes out — well within the 4h ceiling

  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt, ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.occupancy).toBe("occupied");
  expect(body.expectedEndAt).toBe(expectedEndAt);

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  expect((await after.json()).expectedEndAt).toBe(expectedEndAt);
});

it("reporting empty clears any previously set expectedEndAt", async () => {
  const seat = "D";
  const ifVersion1 = await currentVersion(seat);
  const occupy = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: Date.now() + 60_000, ifVersion: ifVersion1 }),
  });
  expect(occupy.status).toBe(200);

  const ifVersion2 = (await occupy.json()).version;
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: ifVersion2 }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.occupancy).toBe("empty");
  expect(body.expectedEndAt).toBeNull();
});

// ADR 0008, Decision 2: expectedEndAt is per-observation, never inherited
// across reports — an occupied report that omits it must store null,
// even though the row being overwritten currently holds a value from an
// earlier report.
it("an occupied report that omits expectedEndAt does not inherit a previous report's value", async () => {
  const seat = "E";
  const ifVersion1 = await currentVersion(seat);
  const first = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: Date.now() + 90_000, ifVersion: ifVersion1 }),
  });
  expect(first.status).toBe(200);
  expect((await first.json()).expectedEndAt).not.toBeNull();

  const ifVersion2 = await currentVersion(seat);
  const second = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: ifVersion2 }),
  });
  expect(second.status).toBe(200);
  const body = await second.json();
  expect(body.expectedEndAt).toBeNull();

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  expect((await after.json()).expectedEndAt).toBeNull();
});

it("rejects an expectedEndAt alongside empty occupancy", async () => {
  const seat = "F";
  const ifVersion = await currentVersion(seat);
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", expectedEndAt: Date.now() + 60_000, ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects an expectedEndAt more than 4 hours from now", async () => {
  const seat = "G";
  const ifVersion = await currentVersion(seat);
  const tooFar = Date.now() + FOUR_HOURS_MS + 60_000;
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: tooFar, ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects an expectedEndAt already in the past", async () => {
  const seat = "H";
  const ifVersion = await currentVersion(seat);
  const inPast = Date.now() - 60_000;
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: inPast, ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects an expectedEndAt that is exactly now (not strictly in the future)", async () => {
  const seat = "I";
  const ifVersion = await currentVersion(seat);
  const now = Date.now();
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: now, ifVersion }),
  });
  expect(patch.status).toBe(400);
});

it("rejects an occupancy value outside empty/occupied/unknown", async () => {
  const seat = "J";
  const ifVersion = await currentVersion(seat);
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "busy", ifVersion }),
  });
  expect(patch.status).toBe(400);
});

// The ADR's central rule: unknown is a real stored/public value, but
// never one a client may report directly — it only ever arrives via seed
// or decay. See notes/adr/0008-rat-room-live-state.md, Decision 2.
it("rejects a client reporting occupancy unknown, even though it's a valid stored value", async () => {
  const seat = "A";
  const ifVersion = await currentVersion(seat);
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "unknown", ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects a non-integer ifVersion rather than writing against it", async () => {
  const patch = await fetch(new URL("/api/rat-room/B", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: 1.5 }),
  });
  expect(patch.status).toBe(400);
});

it("a PATCH to an invalid seat identifier is rejected 404, not treated as any real seat", async () => {
  const patch = await fetch(new URL("/api/rat-room/Z", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: 1 }),
  });
  expect(patch.status).toBe(404);
});

it("a stale ifVersion is rejected 409 with the current canonical state for that seat, not silently applied", async () => {
  const seat = "C";
  const staleVersion = await currentVersion(seat);

  const bump = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: staleVersion }),
  });
  expect(bump.status).toBe(200);

  const conflicting = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: staleVersion }),
  });
  expect(conflicting.status).toBe(409);
  const body = await conflicting.json();
  expect(body.current.seat).toBe(seat);
  expect(body.current.occupancy).toBe("occupied");
});

// ADR 0008, Decision 6: each seat gets its own independent version
// counter — this is the central new behavior this facility's own spec
// file must cover that no single-row room ever needed to.
it("two different seats' reports never conflict with each other", async () => {
  const seatOne = "D";
  const seatTwo = "E";
  const ifVersionOne = await currentVersion(seatOne);
  const ifVersionTwo = await currentVersion(seatTwo);

  const [resOne, resTwo] = await Promise.all([
    fetch(new URL(`/api/rat-room/${seatOne}`, baseUrl), {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ occupancy: "occupied", ifVersion: ifVersionOne }),
    }),
    fetch(new URL(`/api/rat-room/${seatTwo}`, baseUrl), {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ occupancy: "empty", ifVersion: ifVersionTwo }),
    }),
  ]);
  expect(resOne.status).toBe(200);
  expect(resTwo.status).toBe(200);
});

it("a stale write to one seat does not become valid just because a different seat's version advanced", async () => {
  const targetSeat = "F";
  const otherSeat = "G";

  const targetStaleVersion = await currentVersion(targetSeat);

  // Advance the target seat's own version once, making targetStaleVersion
  // genuinely stale for it.
  const bumpTarget = await fetch(new URL(`/api/rat-room/${targetSeat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: targetStaleVersion }),
  });
  expect(bumpTarget.status).toBe(200);

  // Advance an unrelated seat's own version too, so if versions were ever
  // accidentally shared at the room level, this might coincidentally
  // "fix up" the stale write below — it must not.
  const otherVersion = await currentVersion(otherSeat);
  const bumpOther = await fetch(new URL(`/api/rat-room/${otherSeat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: otherVersion }),
  });
  expect(bumpOther.status).toBe(200);

  // The original, now-stale version against the TARGET seat must still
  // be rejected — seat G's own version having moved is irrelevant to
  // seat F's own concurrency.
  const staleRetry = await fetch(new URL(`/api/rat-room/${targetSeat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: targetStaleVersion }),
  });
  expect(staleRetry.status).toBe(409);
  const conflict = await staleRetry.json();
  expect(conflict.current.seat).toBe(targetSeat);
});

it("reporting one seat never changes any other seat's own state", async () => {
  const targetSeat = "H";
  const untouchedSeat = "I";

  const beforeUntouched = await fetch(new URL(`/api/rat-room/${untouchedSeat}`, baseUrl));
  const beforeUntouchedBody = await beforeUntouched.json();

  const ifVersion = await currentVersion(targetSeat);
  const patch = await fetch(new URL(`/api/rat-room/${targetSeat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: Date.now() + 60_000, ifVersion }),
  });
  expect(patch.status).toBe(200);

  const afterUntouched = await fetch(new URL(`/api/rat-room/${untouchedSeat}`, baseUrl));
  const afterUntouchedBody = await afterUntouched.json();
  expect(afterUntouchedBody.occupancy).toBe(beforeUntouchedBody.occupancy);
  expect(afterUntouchedBody.expectedEndAt).toBe(beforeUntouchedBody.expectedEndAt);
  expect(afterUntouchedBody.version).toBe(beforeUntouchedBody.version);
});

it("rejects a PATCH with no session before the body is even parsed", async () => {
  const res = await fetch(new URL("/api/rat-room/A", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ occupancy: "occupied" }),
  });
  expect(res.status).toBe(401);
});

// Mirrors notes/adr/0002-identity-and-permissions.md's anti-impersonation
// contract for every other facility: a client may not claim an actor at
// all, not just be prevented from having that claim believed.
it("rejects a PATCH body that names an actor, rather than silently dropping it", async () => {
  const seat = "J";
  const ifVersion = await currentVersion(seat);
  const patch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", reporterId: "someone-else", ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl));
  const body = await after.json();
  expect(body.version).toBe(ifVersion);
});

// --- realtime (notes/adr/0008-rat-room-live-state.md, Decision 6) ---
//
// Mirrors spec/badger-room.test.ts's own LiveStream shape, but a Rat Room
// event's payload carries `seat`/`id` fields (RatRoomSeatState), not the
// single-row rooms' own shape — and, uniquely among this app's occupancy
// facilities, a report to one seat must NOT be confused with — or leak
// into — a different seat's own event.

const DELIVERY_MARGIN_MS = 1_300;

interface RatRoomSeatEvent {
  id: string;
  seat: string;
  occupancy: string;
  expectedEndAt: number | null;
  confirmedAt: number | null;
  version: number;
}

class LiveStream {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  private constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  static async connect(baseUrl: string): Promise<LiveStream> {
    const res = await fetch(new URL("/api/stream", baseUrl));
    const session = new LiveStream(res.body!.getReader());
    const block = await session.readRawBlock(DELIVERY_MARGIN_MS);
    if (block === null) {
      throw new Error("SSE stream closed before sending its leading connect comment");
    }
    if (block.includes("data:")) {
      throw new Error(`expected the leading SSE connect comment, got an event: ${block}`);
    }
    return session;
  }

  private async readRawBlock(timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const block = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        return block;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const next = await Promise.race([
        this.reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
      ]);
      if (next === null || next.done) return null;
      this.buffer += this.decoder.decode(next.value, { stream: true });
    }
  }

  private parseEvent(block: string): { name: string; data: unknown } | null {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!eventLine || !dataLine) return null;
    return { name: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) };
  }

  // Reads blocks until one is a `rat-room` event matching `predicate` (or
  // the deadline passes). Any other facility's own event seen along the
  // way — this stream is shared with every other spec file running in
  // parallel — is skipped without being mistaken for a rat-room event.
  async nextRatRoomEvent(
    timeoutMs: number,
    predicate: (event: RatRoomSeatEvent) => boolean = () => true,
  ): Promise<RatRoomSeatEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readRawBlock(deadline - Date.now());
      if (block === null) return null;
      const parsed = this.parseEvent(block);
      if (!parsed) continue; // a comment
      if (parsed.name !== "rat-room") continue;
      const event = parsed.data as RatRoomSeatEvent;
      if (predicate(event)) return event;
    }
    return null;
  }

  async collectRatRoomEvents(timeoutMs: number): Promise<RatRoomSeatEvent[]> {
    const events: RatRoomSeatEvent[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readRawBlock(deadline - Date.now());
      if (block === null) break;
      const parsed = this.parseEvent(block);
      if (parsed?.name === "rat-room") events.push(parsed.data as RatRoomSeatEvent);
    }
    return events;
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }
}

it("a resident report reaches an already-open SSE session as event: rat-room, carrying the reported seat", async () => {
  const seat = "A";
  const stream = await LiveStream.connect(baseUrl);

  const ifVersion = await currentVersion(seat);
  const patch = fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion }),
  });

  const event = await stream.nextRatRoomEvent(DELIVERY_MARGIN_MS, (e) => e.seat === seat);
  expect(event).not.toBeNull();
  expect(event!.seat).toBe(seat);
  expect(event!.occupancy).toBe("occupied");
  expect(typeof event!.version).toBe("number");

  expect((await patch).status).toBe(200);
  await stream.cancel();
});

it("reporting one seat's SSE event never carries a different seat's identity", async () => {
  const reportedSeat = "B";
  const otherSeat = "C";
  const stream = await LiveStream.connect(baseUrl);

  const ifVersion = await currentVersion(reportedSeat);
  const patch = await fetch(new URL(`/api/rat-room/${reportedSeat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion }),
  });
  expect(patch.status).toBe(200);

  const event = await stream.nextRatRoomEvent(DELIVERY_MARGIN_MS, (e) => e.seat === reportedSeat || e.seat === otherSeat);
  expect(event).not.toBeNull();
  expect(event!.seat).toBe(reportedSeat);
  expect(event!.seat).not.toBe(otherSeat);

  await stream.cancel();
});

it("a rejected PATCH (stale ifVersion / 409) produces no rat-room event", async () => {
  const seat = "D";
  const stream = await LiveStream.connect(baseUrl);

  const beforeBump = await currentVersion(seat);
  const bump = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: beforeBump }),
  });
  expect(bump.status).toBe(200);

  // Drain the bump's own legitimate event first.
  await stream.nextRatRoomEvent(DELIVERY_MARGIN_MS, (e) => e.seat === seat);

  const conflictingPatch = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: beforeBump }), // already stale
  });
  expect(conflictingPatch.status).toBe(409);

  const events = (await stream.collectRatRoomEvents(DELIVERY_MARGIN_MS)).filter((e) => e.seat === seat);
  expect(events).toEqual([]);

  await stream.cancel();
});

it("a validation-rejected PATCH (400) produces no rat-room event", async () => {
  const seat = "E";
  const stream = await LiveStream.connect(baseUrl);

  const ifVersion = await currentVersion(seat);
  const rejected = await fetch(new URL(`/api/rat-room/${seat}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "unknown", ifVersion }), // unknown is never reportable
  });
  expect(rejected.status).toBe(400);

  const events = (await stream.collectRatRoomEvents(DELIVERY_MARGIN_MS)).filter((e) => e.seat === seat);
  expect(events).toEqual([]);

  await stream.cancel();
});
