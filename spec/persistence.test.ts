import { expect, inject, it } from "vitest";

// Crit 8's one proof: a stranger's change to a machine's status is still
// there when they, or anyone else, come back. Checked as two independent
// HTTP requests against the running app — no shared client state between
// them — which is the same shape a real return visit takes.
const baseUrl = inject("baseUrl");

it("a machine status update persists across an independent later request", async () => {
  const machineId = "ab-washer";

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in-use", startedAt: Date.now(), expectedEndAt: Date.now() + 40 * 60_000 }),
  });
  expect(patch.status).toBe(200);

  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  expect(after.status).toBe(200);
  const body = await after.json();
  expect(body.status).toBe("in-use");
  expect(typeof body.expectedEndAt).toBe("number");
});

// A real incident during the crit 8 redeploy check: an unvalidated timestamp
// too large for node:sqlite to read back corrupted a row into one that
// errored on every future GET/PATCH — a status update surviving is no good
// if a bad one can permanently break the row it lands on.
it("rejects a timestamp too large to store safely, rather than corrupting the row", async () => {
  const machineId = "g-washer";

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in-use", startedAt: 1_790_783_554_649_972_224 }),
  });
  expect(patch.status).toBe(400);

  // The row must still be readable afterwards — rejection, not corruption.
  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  expect(after.status).toBe(200);
});
