import { expect, inject, it } from "vitest";
import { sessionCookie } from "./test-session.ts";

// A resident pointed out that an in-use machine never stopped being in-use:
// once its expected_end_at (or, for an untimed report, a provisional
// window) passes, the report can no longer be trusted, so it must lazily
// decay to 'unknown' on the next read. out-of-order and available are
// untouched by this — see CLAUDE.md on out-of-order staying sticky, and
// PROCESS.md for why available/unknown lifetimes stay out of scope here.
//
// Every PATCH here carries a valid Crit 10 session cookie (see
// spec/test-session.ts) — decay itself needs no identity, but a resident's
// report does, and these tests set one up via a report.
const baseUrl = inject("baseUrl");
const cookie = await sessionCookie(baseUrl);

async function currentVersion(machineId: string): Promise<number> {
  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const body = await res.json();
  return body.version;
}

it("an in-use machine past its expected_end_at decays to unknown on read, advancing its version", async () => {
  const machineId = "c-washer";

  // Report with expectedEndAt a short, safe interval in the *future* —
  // not already past. reportStatus()'s own success path re-reads through
  // getMachine(), which runs decayed(): an already-expired expectedEndAt
  // at PATCH time would decay immediately, so the PATCH response would
  // already show the post-decay version with no later jump to observe.
  // See notes/adr/0001-realtime-and-concurrent-updates.md.
  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "in-use",
      startedAt: Date.now(),
      expectedEndAt: Date.now() + 150,
      ifVersion: await currentVersion(machineId),
    }),
  });
  expect(patch.status).toBe(200);
  const patched = await patch.json();
  expect(patched.status).toBe("in-use");

  // Wait past expectedEndAt, with a small CI margin, then make the
  // ordinary read that triggers the lazy decay.
  await new Promise((resolve) => setTimeout(resolve, 400));

  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const body = await after.json();
  expect(body.status).toBe("unknown");
  // Decay is a real, canonical mutation, not just a display fix on read —
  // it must advance `version` exactly like a resident's report does, so a
  // stale client can't silently resurrect the state it just invalidated.
  expect(body.version).toBeGreaterThan(patched.version);
});

it("an in-use machine with no expected_end_at decays after the provisional untimed window", async () => {
  const machineId = "f-dryer";

  const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "in-use",
      startedAt: Date.now() - 13 * 60 * 60_000, // 13h ago, past the 12h window
      ifVersion: await currentVersion(machineId),
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
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "in-use",
      startedAt: Date.now(),
      expectedEndAt: Date.now() + 40 * 60_000,
      ifVersion: await currentVersion(machineId),
    }),
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
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "out-of-order", ifVersion: await currentVersion(machineId) }),
  });
  expect(patch.status).toBe(200);

  const after = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  const body = await after.json();
  expect(body.status).toBe("out-of-order");
});
