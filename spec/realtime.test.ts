import { expect, inject, it } from "vitest";
import { sessionCookie } from "./test-session.ts";

// Crit 9's core promise: a change one resident makes — directly, or via a
// server-driven decay — reaches every other open session within about a
// second, with no reload. Read over a raw fetch rather than the
// EventSource global: EventSource sits behind an experimental Node flag
// this test run doesn't set, and reading the wire format directly checks
// the actual contract (one `event: machine` / `data: <json>` block per
// mutation) rather than a particular client. See
// notes/adr/0001-realtime-and-concurrent-updates.md.
//
// Every PATCH here carries a valid Crit 10 session cookie (see
// spec/test-session.ts), so these tests keep checking realtime delivery,
// not authentication.
//
// Machine ids here are not shared with any other spec file's *successful*
// mutations: Vitest runs test files in parallel, and a version-matched
// write means two files racing on the same machine could make an
// otherwise-correct result flaky, not a real bug. (c-dryer is also used by
// spec/concurrency.test.ts, but only for a request that 400s before ever
// reaching the database — no mutation, no race.)
const baseUrl = inject("baseUrl");
const cookie = await sessionCookie(baseUrl);

// A small CI margin around the product's "about a second" target — a
// loaded test runner shouldn't flake a passing implementation.
const DELIVERY_MARGIN_MS = 1_300;

// Both of these are test-harness timing tolerances for proving a real
// elapsed-time condition against a real network, not product decay
// semantics (CLAUDE.md's "do not invent decay/staleness thresholds" is
// about the confirmed → stale → expired model's actual minute values,
// which this doesn't touch): the decay test below needs an expectedEndAt
// far enough out that the in-use report itself doesn't race its own
// decay over a real round trip, then waits for the *server's own echoed*
// expectedEndAt to actually pass before treating a read as "triggering".
const IN_USE_REPORT_WINDOW_MS = 2_500;
const DECAY_TRIGGER_MARGIN_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MachineEvent {
  id: string;
  status: string;
  version: number;
}

// A connected, already-confirmed SSE session. "Confirmed" matters: fetch()
// resolving only means a Response object exists, not that Node has
// actually flushed headers/first bytes to the client (see
// src/pages/api/stream.ts and notes/adr/0001-realtime-and-concurrent-updates.md)
// — on a real network, firing a mutation right after fetch() resolves can
// race the connection's own establishment. connect() blocks on actually
// receiving the leading `: connected` comment stream.ts sends on open,
// so every caller here only ever mutates *after* the stream can prove it's
// listening.
class MachineEventStream {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  private constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  static async connect(baseUrl: string): Promise<MachineEventStream> {
    const res = await fetch(new URL("/api/stream", baseUrl));
    const session = new MachineEventStream(res.body!.getReader());
    const block = await session.readBlock(DELIVERY_MARGIN_MS);
    if (block === null) {
      throw new Error("SSE stream closed before sending its leading connect comment");
    }
    if (block.startsWith("data:") || block.split("\n").some((line) => line.startsWith("data:"))) {
      // The very first block was already a machine event, not the connect
      // comment — some mutation landed before this test's own connect
      // confirmation, which would make "already connected" a lie. Treat
      // it as a setup failure rather than silently eating a real event.
      throw new Error(`expected the leading SSE connect comment, got a machine event: ${block}`);
    }
    return session;
  }

  // Reads one `\n\n`-delimited SSE block, whatever it is (comment or
  // event), blocking on the underlying stream as needed.
  private async readBlock(timeoutMs: number): Promise<string | null> {
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

  // Reads blocks until one is a `machine` event for `machineId` matching
  // `predicate` (or the deadline passes). The stream is shared by every
  // spec file running in parallel, so other machines' broadcasts are
  // expected along the way and just skipped; a connection already open
  // before its own mutating PATCH also sees that PATCH's own broadcast for
  // the same machineId (e.g. the "in-use" report before its later
  // "unknown" decay), so callers that care which one they're waiting for
  // pass a predicate rather than taking the first id match.
  async nextMachineEvent(
    machineId: string,
    timeoutMs: number,
    predicate: (event: MachineEvent) => boolean = () => true,
  ): Promise<MachineEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const block = await this.readBlock(deadline - Date.now());
      if (block === null) return null;
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue; // a comment — not a machine event
      const event = JSON.parse(dataLine.slice(5).trim()) as MachineEvent;
      if (event.id === machineId && predicate(event)) return event;
    }
    return null;
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }
}

async function currentVersion(machineId: string): Promise<number> {
  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  return (await res.json()).version;
}

it("a resident report reaches another open SSE session without reload", async () => {
  const machineId = "c-dryer";

  const stream = await MachineEventStream.connect(baseUrl);

  const ifVersion = await currentVersion(machineId);
  const patch = fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "out-of-order", ifVersion }),
  });

  const event = await stream.nextMachineEvent(machineId, DELIVERY_MARGIN_MS);
  expect(event).not.toBeNull();
  expect(event!.status).toBe("out-of-order");

  expect((await patch).status).toBe(200);
  await stream.cancel();
});

it("a read-triggered decay reaches an already-open SSE session as 'unknown'", async () => {
  const machineId = "e-dryer";

  // Connect — and confirm the connection — before anything that could
  // cause a decay exists at all. The whole point of this test is that a
  // session already listening catches the decay transition in real time;
  // opening the stream after the report (the old order) could let decay
  // fire and broadcast before any listener existed to see it.
  const stream = await MachineEventStream.connect(baseUrl);

  // Report in-use with a future expectedEndAt wide enough that the write
  // itself can't race its own immediate decay over a real network
  // round-trip (reportStatus's own re-read in src/lib/db.ts would otherwise
  // find it already expired and the report and decay broadcasts would
  // collapse into one, as happened against the deployed app — see
  // PROCESS.md). ifVersion is read *after* connecting, not before, so the
  // version this PATCH is conditioned on reflects the stream being live.
  const ifVersion = await currentVersion(machineId);
  const patchRes = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "in-use",
      startedAt: Date.now(),
      expectedEndAt: Date.now() + IN_USE_REPORT_WINDOW_MS,
      ifVersion,
    }),
  });
  expect(patchRes.status).toBe(200);
  const patchBody = await patchRes.json();
  // If this fails, IN_USE_REPORT_WINDOW_MS is too small for this
  // environment's round-trip time, not a product bug — the report landed
  // after its own expectedEndAt had already passed.
  expect(patchBody.status).toBe("in-use");

  // Wait for the server's own echoed expectedEndAt to actually pass, with
  // a margin — computed from what the server confirmed it stored, not
  // re-guessed client-side, so this is robust to whatever the round trip
  // above actually cost.
  const waitMs = patchBody.expectedEndAt - Date.now() + DECAY_TRIGGER_MARGIN_MS;
  if (waitMs > 0) await sleep(waitMs);

  // The ordinary read that triggers the lazy decay — its trigger is
  // unchanged by any of this; see CLAUDE.md and the ADR.
  const triggeringRead = fetch(new URL(`/api/machines/${machineId}`, baseUrl));

  // The stream was already open for this machine's own "in-use" report
  // broadcast too, so wait specifically for the decay transition rather
  // than the first event matching this machine's id.
  const event = await stream.nextMachineEvent(
    machineId,
    DELIVERY_MARGIN_MS,
    (e) => e.status === "unknown",
  );
  expect(event).not.toBeNull();
  expect(event!.version).toBe(patchBody.version + 1);

  const after = await triggeringRead;
  const afterBody = await after.json();
  expect(afterBody.status).toBe("unknown");
  expect(afterBody.version).toBe(patchBody.version + 1);

  await stream.cancel();
});
