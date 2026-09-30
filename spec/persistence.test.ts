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
