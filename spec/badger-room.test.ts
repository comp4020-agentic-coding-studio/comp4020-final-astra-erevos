import { expect, inject, it } from "vitest";
import { sessionCookie } from "./test-session.ts";

// Badger Room: Toad Live's sixth facility. See
// notes/adr/0007-badger-room-live-state.md. A single shared row (no
// per-location split the way Laundry has five), so — mirroring
// spec/weasel-room.test.ts's own reasoning — every test here reads the
// current version immediately before its own PATCH rather than assuming
// a version from an earlier test, and realtime coverage lives in THIS
// file rather than a separate one, since two files both mutating the one
// shared Badger Room row would race the same way AA Room's/Otter Room's/
// Rabbit Room's/Weasel Room's did.
//
// Every PATCH here carries a valid Crit 10 session cookie (see
// spec/test-session.ts), so these tests keep checking Badger Room's own
// contract, not authentication — the one exception is the no-session test
// below, which checks authentication directly.
const baseUrl = inject("baseUrl");
const cookie = await sessionCookie(baseUrl);

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

async function currentVersion(): Promise<number> {
  const res = await fetch(new URL("/api/badger-room", baseUrl));
  const body = await res.json();
  return body.version;
}

it("a GET with no prior report returns a valid occupancy and no freshness field", async () => {
  // This only asserts shape, not that the room has never been reported —
  // other tests in this file may have already run.
  const res = await fetch(new URL("/api/badger-room", baseUrl));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(["empty", "occupied", "unknown"]).toContain(body.occupancy);
  expect(typeof body.version).toBe("number");
  // ADR 0007, Decision 4: no freshness field at all, unlike AA Room.
  expect(body).not.toHaveProperty("freshness");
});

it("an occupied report with no expectedEndAt persists across an independent later request", async () => {
  const ifVersion = await currentVersion();

  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion }),
  });
  expect(patch.status).toBe(200);
  const patched = await patch.json();
  expect(patched.occupancy).toBe("occupied");
  expect(patched.expectedEndAt).toBeNull();

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  expect(after.status).toBe(200);
  const body = await after.json();
  expect(body.occupancy).toBe("occupied");
  expect(body.expectedEndAt).toBeNull();
});

it("an occupied report with a valid expectedEndAt persists it", async () => {
  const ifVersion = await currentVersion();
  const expectedEndAt = Date.now() + 30 * 60 * 1000; // 30 minutes out — well within the 4h ceiling

  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt, ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.occupancy).toBe("occupied");
  expect(body.expectedEndAt).toBe(expectedEndAt);

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  expect((await after.json()).expectedEndAt).toBe(expectedEndAt);
});

it("reporting empty clears any previously set expectedEndAt", async () => {
  // Set a real expectedEndAt first so there is something to clear.
  const ifVersion1 = await currentVersion();
  const occupy = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: Date.now() + 60_000, ifVersion: ifVersion1 }),
  });
  expect(occupy.status).toBe(200);

  const ifVersion2 = (await occupy.json()).version;
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: ifVersion2 }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.occupancy).toBe("empty");
  expect(body.expectedEndAt).toBeNull();
});

// ADR 0007, Decision 2: expectedEndAt is per-observation, never inherited
// across reports — an occupied report that omits it must store null, even
// though the row being overwritten currently holds a value from an
// earlier report.
it("an occupied report that omits expectedEndAt does not inherit a previous report's value", async () => {
  const ifVersion1 = await currentVersion();
  const first = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: Date.now() + 90_000, ifVersion: ifVersion1 }),
  });
  expect(first.status).toBe(200);
  expect((await first.json()).expectedEndAt).not.toBeNull();

  const ifVersion2 = await currentVersion();
  const second = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: ifVersion2 }),
  });
  expect(second.status).toBe(200);
  const body = await second.json();
  expect(body.expectedEndAt).toBeNull();

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  expect((await after.json()).expectedEndAt).toBeNull();
});

it("rejects an expectedEndAt alongside empty occupancy", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", expectedEndAt: Date.now() + 60_000, ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects an expectedEndAt more than 4 hours from now", async () => {
  const ifVersion = await currentVersion();
  const tooFar = Date.now() + FOUR_HOURS_MS + 60_000;
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: tooFar, ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects an expectedEndAt already in the past", async () => {
  const ifVersion = await currentVersion();
  const inPast = Date.now() - 60_000;
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: inPast, ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects an expectedEndAt that is exactly now (not strictly in the future)", async () => {
  const ifVersion = await currentVersion();
  const now = Date.now();
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", expectedEndAt: now, ifVersion }),
  });
  expect(patch.status).toBe(400);
});

it("rejects an occupancy value outside empty/occupied/unknown", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "busy", ifVersion }),
  });
  expect(patch.status).toBe(400);
});

// The ADR's central rule: unknown is a real stored/public value, but never
// one a client may report directly — it only ever arrives via seed or
// decay. See notes/adr/0007-badger-room-live-state.md, Decision 1.
it("rejects a client reporting occupancy unknown, even though it's a valid stored value", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "unknown", ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects a non-integer ifVersion rather than writing against it", async () => {
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: 1.5 }),
  });
  expect(patch.status).toBe(400);
});

it("a stale ifVersion is rejected 409 with the current canonical state, not silently applied", async () => {
  const staleVersion = await currentVersion();

  const bump = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: staleVersion }),
  });
  expect(bump.status).toBe(200);

  const conflicting = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: staleVersion }),
  });
  expect(conflicting.status).toBe(409);
  const body = await conflicting.json();
  expect(body.current.occupancy).toBe("occupied");
});

it("rejects a PATCH with no session before the body is even parsed", async () => {
  const res = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ occupancy: "occupied" }),
  });
  expect(res.status).toBe(401);
});

// Mirrors notes/adr/0002-identity-and-permissions.md's anti-impersonation
// contract for machines/AA Room/Otter Room/Rabbit Room/Weasel Room: a
// client may not claim an actor at all, not just be prevented from having
// that claim believed.
it("rejects a PATCH body that names an actor, rather than silently dropping it", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", reporterId: "someone-else", ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/badger-room", baseUrl));
  const body = await after.json();
  expect(body.version).toBe(ifVersion);
});

// --- realtime (notes/adr/0007-badger-room-live-state.md, Decision 4) ---
//
// Mirrors spec/weasel-room.test.ts's own LiveStream shape — connect-before-
// mutate, predicate-filtered event reading — but reads `event: badger-room`
// instead of `event: weasel-room`, and asserts the event types never get
// confused with each other. Kept in THIS file for the same parallel-file
// race reason spec/aa-room.test.ts/spec/otter-room.test.ts/
// spec/rabbit-room.test.ts/spec/weasel-room.test.ts document.

const DELIVERY_MARGIN_MS = 1_300;

interface BadgerRoomEvent {
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

  // Reads blocks until one is a `badger-room` event matching `predicate`
  // (or the deadline passes). Any `machine`/`aa-room`/`otter-room`/
  // `rabbit-room`/`weasel-room` event seen along the way — this stream is
  // shared with every other spec file running in parallel — is skipped
  // without being mistaken for a badger-room event.
  async nextBadgerRoomEvent(
    timeoutMs: number,
    predicate: (event: BadgerRoomEvent) => boolean = () => true,
  ): Promise<BadgerRoomEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readRawBlock(deadline - Date.now());
      if (block === null) return null;
      const parsed = this.parseEvent(block);
      if (!parsed) continue; // a comment
      if (parsed.name !== "badger-room") continue;
      const event = parsed.data as BadgerRoomEvent;
      // A badger-room event must never carry a machine-shaped `id` field
      // or an aa-room-shaped `activities` field — confirms the event
      // types stay structurally distinct on the wire.
      expect(event).not.toHaveProperty("id");
      expect(event).not.toHaveProperty("activities");
      if (predicate(event)) return event;
    }
    return null;
  }

  async collectBadgerRoomEvents(timeoutMs: number): Promise<BadgerRoomEvent[]> {
    const events: BadgerRoomEvent[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readRawBlock(deadline - Date.now());
      if (block === null) break;
      const parsed = this.parseEvent(block);
      if (parsed?.name === "badger-room") events.push(parsed.data as BadgerRoomEvent);
    }
    return events;
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }
}

it("a resident report reaches an already-open SSE session as event: badger-room", async () => {
  const stream = await LiveStream.connect(baseUrl);

  const ifVersion = await currentVersion();
  const patch = fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion }),
  });

  const event = await stream.nextBadgerRoomEvent(DELIVERY_MARGIN_MS);
  expect(event).not.toBeNull();
  expect(event!.occupancy).toBe("occupied");
  expect(typeof event!.version).toBe("number");

  expect((await patch).status).toBe(200);
  await stream.cancel();
});

it("a rejected PATCH (stale ifVersion / 409) produces no badger-room event", async () => {
  const stream = await LiveStream.connect(baseUrl);

  const beforeBump = await currentVersion();
  const bump = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: beforeBump }),
  });
  expect(bump.status).toBe(200);

  // Drain the bump's own legitimate event first.
  await stream.nextBadgerRoomEvent(DELIVERY_MARGIN_MS);

  const conflictingPatch = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: beforeBump }), // already stale
  });
  expect(conflictingPatch.status).toBe(409);

  const events = await stream.collectBadgerRoomEvents(DELIVERY_MARGIN_MS);
  expect(events).toEqual([]);

  await stream.cancel();
});

it("a validation-rejected PATCH (400) produces no badger-room event", async () => {
  const stream = await LiveStream.connect(baseUrl);

  const ifVersion = await currentVersion();
  const rejected = await fetch(new URL("/api/badger-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "unknown", ifVersion }), // unknown is never reportable
  });
  expect(rejected.status).toBe(400);

  const events = await stream.collectBadgerRoomEvents(DELIVERY_MARGIN_MS);
  expect(events).toEqual([]);

  await stream.cancel();
});
