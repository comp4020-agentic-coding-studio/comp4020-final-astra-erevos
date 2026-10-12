import { expect, inject, it } from "vitest";

// Crit 9's concurrency decision: a resident's report must match the
// version their own view last saw. A client whose view is behind — because
// another resident's report landed first, or because a lazy decay already
// moved the row — gets 409 and the actual canonical state back, never a
// silent overwrite. See notes/adr/0001-realtime-and-concurrent-updates.md.
//
// Machine ids here are not shared with any other spec file: Vitest runs
// test files in parallel, and a version-matched write means two files
// racing on the same machine could make an otherwise-correct PATCH 409 as
// a false failure rather than a real bug.
const baseUrl = inject("baseUrl");

async function getMachine(machineId: string): Promise<{ status: string; version: number }> {
  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  return res.json();
}

it("a PATCH without ifVersion is rejected", async () => {
  const res = await fetch(new URL("/api/machines/c-dryer", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "available" }),
  });
  expect(res.status).toBe(400);
});

it("a report carrying the current version succeeds and advances it", async () => {
  const machineId = "f-washer";
  const before = await getMachine(machineId);

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "available", ifVersion: before.version }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.version).toBe(before.version + 1);
});

it("a stale ifVersion is rejected with 409, and the newer state stays untouched", async () => {
  const machineId = "g-dryer";
  const stale = await getMachine(machineId);

  // The first report, using the version everyone currently agrees on,
  // succeeds and moves the machine on.
  const first = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "out-of-order", ifVersion: stale.version }),
  });
  expect(first.status).toBe(200);
  const afterFirst = await first.json();

  // A second report reusing that same now-stale version — as if it had
  // been composed from the page before the first report landed — must not
  // silently overwrite what the first report just set.
  const second = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "available", ifVersion: stale.version }),
  });
  expect(second.status).toBe(409);
  const conflict = await second.json();
  expect(conflict.current.status).toBe("out-of-order");
  expect(conflict.current.version).toBe(afterFirst.version);

  // The row itself must still show the first report, not a trace of the
  // rejected second one.
  const confirmed = await getMachine(machineId);
  expect(confirmed.status).toBe("out-of-order");
  expect(confirmed.version).toBe(afterFirst.version);
});
