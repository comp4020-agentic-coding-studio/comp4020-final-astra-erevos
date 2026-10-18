import { expect, inject, it } from "vitest";
import { sessionCookie } from "./test-session.ts";

// AA Room: Toad Live's second facility. See
// notes/adr/0003-aa-room-live-state.md. A single shared row (no
// per-location split the way Laundry has five), so — unlike most other
// spec files — every test here reads the current version immediately
// before its own PATCH rather than assuming a version from an earlier
// test, the same defensive shape spec/concurrency.test.ts already uses
// for a machine two tests might otherwise race on.
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
    body: JSON.stringify({ occupancy: "occupied", activity: "pool", ifVersion }),
  });
  expect(patch.status).toBe(200);
  const patched = await patch.json();
  expect(patched.occupancy).toBe("occupied");
  expect(patched.activity).toBe("pool");
  expect(patched.freshness).toBe("fresh");

  const after = await fetch(new URL("/api/aa-room", baseUrl));
  expect(after.status).toBe(200);
  const body = await after.json();
  expect(body.occupancy).toBe("occupied");
  expect(body.activity).toBe("pool");
});

it("reporting empty clears any previously set activity", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", ifVersion }),
  });
  expect(patch.status).toBe(200);
  const body = await patch.json();
  expect(body.occupancy).toBe("empty");
  expect(body.activity).toBeNull();
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

it("rejects an activity tag outside the four named values", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "occupied", activity: "ping-pong", ifVersion }),
  });
  expect(patch.status).toBe(400);
});

it("rejects an activity tag reported alongside empty", async () => {
  const ifVersion = await currentVersion();
  const patch = await fetch(new URL("/api/aa-room", baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ occupancy: "empty", activity: "tv", ifVersion }),
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
    body: JSON.stringify({ occupancy: "occupied", activity: "tv", ifVersion: staleVersion }),
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
  expect(body.current.activity).toBe("tv");
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
