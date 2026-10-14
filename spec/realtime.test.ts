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

// The running app is shared by every spec file, and Vitest runs files in
// parallel — this stream sees every machine's broadcasts, not just the one
// this test cares about. Reads events until one matches `machineId` (or
// the deadline passes), rather than assuming the very first event it sees
// is its own.
async function nextMachineEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  machineId: string,
  timeoutMs: number,
): Promise<{ id: string; status: string; version: number } | null> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const next = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(remaining, 0))),
    ]);
    if (next === null || next.done) return null;

    buffer += decoder.decode(next.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(5).trim());
      if (event.id === machineId) return event;
      // a concurrent spec file's own mutation — not what this test is
      // waiting for, keep reading.
    }
  }
  return null;
}

async function currentVersion(machineId: string): Promise<number> {
  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  return (await res.json()).version;
}

it("a resident report reaches another open SSE session without reload", async () => {
  const machineId = "c-dryer";

  const stream = await fetch(new URL("/api/stream", baseUrl));
  const reader = stream.body!.getReader();

  const ifVersion = await currentVersion(machineId);
  const patch = fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "out-of-order", ifVersion }),
  });

  const event = await nextMachineEvent(reader, machineId, DELIVERY_MARGIN_MS);
  expect(event).not.toBeNull();
  expect(event!.status).toBe("out-of-order");

  expect((await patch).status).toBe(200);
  await reader.cancel();
});

it("a read-triggered decay reaches another open SSE session as 'unknown'", async () => {
  const machineId = "e-dryer";

  // Report with a short, safe *future* expectedEndAt — not already past —
  // so the report's own broadcast ("in-use") and decay's later broadcast
  // ("unknown") are two distinct, observable events rather than one
  // immediate flip. See notes/adr/0001-realtime-and-concurrent-updates.md.
  const ifVersion = await currentVersion(machineId);
  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "in-use",
      startedAt: Date.now(),
      expectedEndAt: Date.now() + 150,
      ifVersion,
    }),
  });
  expect(patch.status).toBe(200);

  const stream = await fetch(new URL("/api/stream", baseUrl));
  const reader = stream.body!.getReader();

  // Wait past expectedEndAt, with a small margin, then make the ordinary
  // read that triggers the lazy decay — its trigger is unchanged by any of
  // this; see CLAUDE.md and the ADR.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const triggeringRead = fetch(new URL(`/api/machines/${machineId}`, baseUrl));

  const event = await nextMachineEvent(reader, machineId, DELIVERY_MARGIN_MS);
  expect(event).not.toBeNull();
  expect(event!.status).toBe("unknown");

  const after = await triggeringRead;
  expect((await after.json()).status).toBe("unknown");
  await reader.cancel();
});
