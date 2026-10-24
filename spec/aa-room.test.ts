import { expect, inject, it } from "vitest";
import { sessionCookie } from "./test-session.ts";

// AA Room: Toad Live's second facility. See
// notes/adr/0003-aa-room-live-state.md. A single shared row (no
// per-location split the way Laundry has five), so — unlike most other
// spec files — every test here reads the current version immediately
// before its own PATCH rather than assuming a version from an earlier
// test, the same defensive shape spec/concurrency.test.ts already uses
// for a machine two tests might otherwise race on. This is also why
// Stage 3's realtime tests live in THIS file rather than their own:
// Vitest parallelizes separate test files against each other, and two
// files both mutating the one shared AA Room row raced in practice
// (confirmed directly — spec/aa-room-realtime.test.ts alone was stable,
// but failed intermittently once run alongside this file). Tests within
// one file run sequentially by default, which is what the whole suite
// needs for a single-row resource like this one.
//
// Every PATCH here carries a valid Crit 10 session cookie (see
// spec/test-session.ts), so these tests keep checking AA Room's own
// contract, not authentication — the one exception is the no-session
// test below, which checks authentication directly.
const baseUrl = inject("baseUrl");
const cookie = await sessionCookie(baseUrl);

async function currentVersion(): Promise<number> {
  const res = await fetch(new URL("/api/aa-room", baseUrl));
  const body = await res.json();
  return body.version;
}

it("a GET with no prior report returns unknown with no freshness", async () => {
  // This only asserts shape, not that the room has never been reported —
  // other tests in this file may have already run. The seed/decayed
  // "unknown, no freshness" shape is covered more precisely by
  // spec/aa-room-decay.test.ts, which controls its own fresh database.
  const res = await fetch(new URL("/api/aa-room", baseUrl));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(["empty", "occupied", "unknown"]).toContain(body.occupancy);
  expect(typeof body.version).toBe("number");
});

it("an occupancy report persists across an independent later request", async () => {
  const ifVersion = await currentVersion();

  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["pool"], ifVersion }),
  });
  expect(patch.status).toBe(200);
  const patched = await patch.json();
  expect(patched.occupancy).toBe("occupied");
  expect(patched.activities).toEqual(["pool"]);
  expect(patched.freshness).toBe("fresh");

  const after = await fetch(new URL("/api/aa-room", baseUrl));
  expect(after.status).toBe(200);
  const body = await after.json();
  expect(body.occupancy).toBe("occupied");
  expect(body.activities).toEqual(["pool"]);
});

it("reporting empty clears any previously set activities", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.occupancy).toBe("empty");
  expect(body.activities).toEqual([]);
});

// v2 (notes/adr/0003-aa-room-live-state.md, "Design correction, v2"):
// tv/pool/table-tennis/hanging-out are independent and can co-occur —
// this is the central fact the correction exists to represent.
it("accepts and round-trips multiple simultaneous non-event activities", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["table-tennis", "tv", "hanging-out"], ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  // Canonical order (tv, pool, table-tennis, hanging-out, event) — not
  // the order submitted.
  expect(body.activities).toEqual(["tv", "table-tennis", "hanging-out"]);

  const after = await fetch(new URL("/api/aa-room", baseUrl));
  expect((await after.json()).activities).toEqual(["tv", "table-tennis", "hanging-out"]);
});

it("deduplicates a repeated activity and canonically orders the result", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["pool", "tv", "pool", "tv"], ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.activities).toEqual(["tv", "pool"]);
});

it("rejects occupied with an empty activities array — at least one activity is required", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: [], ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/aa-room", baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("rejects empty occupancy carrying a non-empty activities array", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", activities: ["hanging-out"], ifVersion }),
  });
  expect(patch.status).toBe(400);
});

it("rejects event combined with another activity, even after dedup", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["event", "pool"], ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/aa-room", baseUrl));
  expect((await after.json()).version).toBe(ifVersion);
});

it("accepts event alone", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["event"], ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.activities).toEqual(["event"]);
});

it("accepts a duplicated event entry as the valid exclusive set, not a rejection", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["event", "event"], ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.activities).toEqual(["event"]);
});

it("rejects an occupancy value outside empty/occupied/unknown", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "busy", ifVersion }),
  });
  expect(patch.status).toBe(400);
});

// The ADR's central rule: unknown is a real stored/public value, but
// never one a client may report directly — it only ever arrives via seed
// or decay. See notes/adr/0003-aa-room-live-state.md, Decision 2.
it("rejects a client reporting occupancy unknown, even though it's a valid stored value", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "unknown", ifVersion }),
  });
  expect(patch.status).toBe(400);

  // Rejected, not silently coerced — the row must be unchanged.
  const after = await fetch(new URL("/api/aa-room", baseUrl));
  const body = await after.json();
  expect(body.version).toBe(ifVersion);
});

it("rejects an activities array containing a tag outside the five named values", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["ping-pong"], ifVersion }),
  });
  expect(patch.status).toBe(400);
});

it("rejects activities that isn't an array", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: "tv", ifVersion }),
  });
  expect(patch.status).toBe(400);
});

it("rejects an activity tag reported alongside empty", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", activities: ["tv"], ifVersion }),
  });
  expect(patch.status).toBe(400);
});

it("rejects a non-integer ifVersion rather than writing against it", async () => {
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", ifVersion: 1.5 }),
  });
  expect(patch.status).toBe(400);
});

it("a stale ifVersion is rejected 409 with the current canonical state, not silently applied", async () => {
  const staleVersion = await currentVersion();

  // Move the real version forward first, exactly like
  // spec/concurrency.test.ts's own shape for machines.
  const bump = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["tv"], ifVersion: staleVersion }),
  });
  expect(bump.status).toBe(200);

  const conflicting = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: staleVersion }),
  });
  expect(conflicting.status).toBe(409);
  const body = await conflicting.json();
  expect(body.current.occupancy).toBe("occupied");
  expect(body.current.activities).toEqual(["tv"]);
});

it("rejects a PATCH with no session before the body is even parsed", async () => {
  const res = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ occupancy: "occupied" }),
  });
  expect(res.status).toBe(401);
});

// Mirrors notes/adr/0002-identity-and-permissions.md's anti-impersonation
// contract for machines: a client may not claim an actor at all, not just
// be prevented from having that claim believed.
it("rejects a PATCH body that names an actor, rather than silently dropping it", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", reporterId: "someone-else", ifVersion }),
  });
  expect(patch.status).toBe(400);

  const after = await fetch(new URL("/api/aa-room", baseUrl));
  const body = await after.json();
  expect(body.version).toBe(ifVersion);
});

// --- Stage 3: realtime (notes/adr/0003-aa-room-live-state.md) ---
//
// Mirrors spec/realtime.test.ts's own shape — connect-before-mutate,
// predicate-filtered event reading — but reads `event: aa-room` instead
// of `event: machine`, and asserts the two never get confused with each
// other. Kept in THIS file, not a separate one, for the parallel-file
// race reason explained at the top of this file.

const DELIVERY_MARGIN_MS = 1_300;

interface AaRoomEvent {
  occupancy: string;
  activities: string[];
  confirmedAt: number | null;
  version: number;
  freshness: string | null;
}

// A connected, already-confirmed SSE session reading BOTH event types —
// same connect-confirmation discipline as spec/realtime.test.ts's
// MachineEventStream (block on the leading `: connected` comment before
// any caller mutates anything), generalized to also recognize
// `event: aa-room` blocks and to assert `event: machine` blocks never
// leak into an aa-room read or vice versa.
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

  // Parses one SSE block into its event name + JSON payload, or null for
  // a comment (no `event:`/`data:` line) — never guesses a type from
  // shape alone, since that's exactly the "listener has to sniff the
  // payload" the discriminated-union design in src/lib/realtime.ts exists
  // to avoid.
  private parseEvent(block: string): { name: string; data: unknown } | null {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!eventLine || !dataLine) return null;
    return { name: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) };
  }

  // Reads blocks until one is an `aa-room` event matching `predicate` (or
  // the deadline passes). A `machine` or `otter-room` event seen along the
  // way — this stream is shared with every other spec file running in
  // parallel, including spec/otter-room.test.ts (ADR 0004) — is asserted
  // to actually be that kind of payload (never something that merely
  // looks like one), then skipped.
  async nextAaRoomEvent(
    timeoutMs: number,
    predicate: (event: AaRoomEvent) => boolean = () => true,
  ): Promise<AaRoomEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readRawBlock(deadline - Date.now());
      if (block === null) return null;
      const parsed = this.parseEvent(block);
      if (!parsed) continue; // a comment
      if (parsed.name === "machine") {
        // Confirm this is genuinely a machine payload (has an `id`), not
        // an aa-room payload mislabeled — if the wire contract ever broke
        // this way, this assertion is what would catch it.
        expect(parsed.data).toHaveProperty("id");
        continue;
      }
      if (parsed.name === "otter-room") {
        // Confirm this is genuinely an otter-room payload (no
        // activities), not an aa-room payload mislabeled.
        expect(parsed.data).not.toHaveProperty("activities");
        continue;
      }
      expect(parsed.name).toBe("aa-room");
      const event = parsed.data as AaRoomEvent;
      // An aa-room event must never carry a machine-shaped `id` field —
      // confirms the event types stay structurally distinct on the wire,
      // not just differently named.
      expect(event).not.toHaveProperty("id");
      if (predicate(event)) return event;
    }
    return null;
  }

  // Reads for `timeoutMs` and returns every aa-room event seen, rather
  // than stopping at the first — used by the "rejected/409 produce no
  // event" tests, which need to prove an ABSENCE over a real window, not
  // just fail to find one specific event.
  async collectAaRoomEvents(timeoutMs: number): Promise<AaRoomEvent[]> {
    const events: AaRoomEvent[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readRawBlock(deadline - Date.now());
      if (block === null) break;
      const parsed = this.parseEvent(block);
      if (parsed?.name === "aa-room") events.push(parsed.data as AaRoomEvent);
    }
    return events;
  }

  // Reads blocks until one is a `machine` event for `machineId` (or the
  // deadline passes) — used by the one test below that needs to inspect
  // a raw `event: machine` block's exact shape directly, rather than
  // through nextAaRoomEvent()'s own machine-skip logic.
  async nextMachineEvent(machineId: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readRawBlock(deadline - Date.now());
      if (block === null) return null;
      const parsed = this.parseEvent(block);
      if (parsed?.name !== "machine") continue;
      const event = parsed.data as Record<string, unknown>;
      if (event.id === machineId) return event;
    }
    return null;
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }
}

it("a resident report reaches an already-open SSE session as event: aa-room", async () => {
  const stream = await LiveStream.connect(baseUrl);

  const ifVersion = await currentVersion();
  const patch = fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["pool"], ifVersion }),
  });

  const event = await stream.nextAaRoomEvent(DELIVERY_MARGIN_MS);
  expect(event).not.toBeNull();
  expect(event!.occupancy).toBe("occupied");
  expect(event!.activities).toEqual(["pool"]);
  expect(typeof event!.version).toBe("number");

  expect((await patch).status).toBe(200);
  await stream.cancel();
});

it("a rejected PATCH (stale ifVersion / 409) produces no aa-room event", async () => {
  const stream = await LiveStream.connect(baseUrl);

  // Force an actual conflict: bump the real version once (a legitimate
  // report, which does broadcast), then PATCH again against the
  // now-stale version from before that bump.
  const beforeBump = await currentVersion();
  const bump = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion: beforeBump }),
  });
  expect(bump.status).toBe(200);

  // Drain the bump's own legitimate event first, so it isn't mistaken for
  // a spurious event from the conflicting PATCH below.
  await stream.nextAaRoomEvent(DELIVERY_MARGIN_MS);

  const conflictingPatch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activities: ["tv"], ifVersion: beforeBump }), // already stale
  });
  expect(conflictingPatch.status).toBe(409);

  // No new event should arrive for this conflict — collect for a real
  // window and assert it's empty, rather than merely failing to find one
  // shape (which a differently-shaped spurious event could slip past).
  const events = await stream.collectAaRoomEvents(DELIVERY_MARGIN_MS);
  expect(events).toEqual([]);

  await stream.cancel();
});

it("a validation-rejected PATCH (400) produces no aa-room event", async () => {
  const stream = await LiveStream.connect(baseUrl);

  const ifVersion = await currentVersion();
  const rejected = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "unknown", ifVersion }), // unknown is never reportable
  });
  expect(rejected.status).toBe(400);

  const events = await stream.collectAaRoomEvents(DELIVERY_MARGIN_MS);
  expect(events).toEqual([]);

  await stream.cancel();
});

it("machine realtime events are unaffected: event: machine still carries the exact same shape", async () => {
  // Not a full re-test of spec/realtime.test.ts (that file already covers
  // this exhaustively) — just a direct confirmation that widening
  // src/lib/realtime.ts's Subscriber to a discriminated union, and
  // src/pages/api/stream.ts's dispatch on `kind`, didn't change the wire
  // shape of `event: machine` itself.
  const stream = await LiveStream.connect(baseUrl);

  const machineId = "g-washer";
  const verRes = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const ifVersion = (await verRes.json()).version;

  const patch = fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "out-of-order", ifVersion }),
  });

  const found = await stream.nextMachineEvent(machineId, DELIVERY_MARGIN_MS);
  expect(found).not.toBeNull();
  expect(found!.status).toBe("out-of-order");
  expect(found).not.toHaveProperty("occupancy"); // never an aa-room-shaped payload

  expect((await patch).status).toBe(200);
  await stream.cancel();
});
