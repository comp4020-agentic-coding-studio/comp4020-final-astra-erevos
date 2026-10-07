import { expect, inject, it } from "vitest";

// A resident pointed out that an in-use machine never stopped being in-use:
// once its expected_end_at (or, for an untimed report, a provisional
// window) passes, the report can no longer be trusted, so it must lazily
// decay to 'unknown' on the next read. out-of-order and available are
// untouched by this — see CLAUDE.md on out-of-order staying sticky, and
// PROCESS.md for why available/unknown lifetimes stay out of scope here.
const baseUrl = inject("baseUrl");

it("an in-use machine past its expected_end_at decays to unknown on read", async () => {
  const machineId = "c-washer";

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "in-use",
      startedAt: Date.now() - 60_000,
      expectedEndAt: Date.now() - 1_000, // already passed
    }),
  });
  expect(patch.status).toBe(200);

  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const body = await after.json();
  expect(body.status).toBe("unknown");
});

it("an in-use machine with no expected_end_at decays after the provisional untimed window", async () => {
  const machineId = "f-dryer";

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "in-use",
      startedAt: Date.now() - 13 * 60 * 60_000, // 13h ago, past the 12h window
    }),
  });
  expect(patch.status).toBe(200);

  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const body = await after.json();
  expect(body.status).toBe("unknown");
});

it("an in-use machine still inside its window stays in-use", async () => {
  const machineId = "e-washer";

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in-use", startedAt: Date.now(), expectedEndAt: Date.now() + 40 * 60_000 }),
  });
  expect(patch.status).toBe(200);

  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const body = await after.json();
  expect(body.status).toBe("in-use");
});

it("out-of-order never decays, however long ago it was confirmed", async () => {
  const machineId = "g-washer";

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "out-of-order" }),
  });
  expect(patch.status).toBe(200);

  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const body = await after.json();
  expect(body.status).toBe("out-of-order");
});
