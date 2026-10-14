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

// A comfortably safe margin, not a narrow one, for the one test below
// that reports a timed in-use status and then waits for it to decay:
// this only needs to still be in the future by the time the PATCH
// reaches reportStatus()'s own re-read — one HTTP round trip plus a
// SQLite write, reliably well under a second even on a loaded CI
// runner. See notes/adr/0001-realtime-and-concurrent-updates.md on why
// an already-expired expectedEndAt at PATCH time decays immediately.
const SAFE_FUTURE_MS = 1_000;
// The poll bound (below) needs room beyond SAFE_FUTURE_MS for decay to
// even become possible; this test's own timeout (vitest's `it(name, fn,
// timeout)` third argument) needs to be comfortably longer again than
// the poll bound, so a genuine decay-didn't-happen failure surfaces as
// this test's own clean assertion rather than vitest's generic 5000ms
// default per-test timeout.
const POLL_BOUND_MS = SAFE_FUTURE_MS + 3_000;
const TEST_TIMEOUT_MS = POLL_BOUND_MS + 3_000;

// Polls with ordinary reads — exactly decay's real, lazy, read-triggered
// production trigger — until the machine reads as decayed, rather than
// guessing a single fixed sleep is "long enough": a flake traced across
// several checkpoints (see PROCESS.md) turned out to be a test-construction
// bug, not a production race, but a fixed-sleep-then-one-read pattern is
// inherently a bet on timing either way. Polling for the actual observable
// condition removes that bet entirely; a real regression still fails
// loudly via the timeout below rather than hanging.
async function pollUntilDecayed(
  machineId: string,
  timeoutMs: number,
): Promise<{ status: string; version: number } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
    const body = await res.json();
    if (body.status === "unknown") return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

it(
  "an in-use machine past its expected_end_at decays to unknown on read, advancing its version",
  async () => {
    const machineId = "c-washer";

    // ifVersion is fetched in its own awaited statement, deliberately
    // BEFORE expectedEndAt is captured below — not inlined as a property
    // inside the PATCH body's object literal. Object literal properties
    // evaluate left-to-right, including any `await` inside them: an
    // inline `ifVersion: await currentVersion(machineId)` placed after
    // `expectedEndAt: Date.now() + …` in the same literal would let that
    // call's own network round trip elapse *after* the deadline was
    // fixed but *before* the PATCH carrying it was even sent — silently
    // eating into whatever margin expectedEndAt was given. That hidden
    // gap, combined with the previous 150ms margin, is exactly what
    // caused this test to occasionally fail across several checkpoints
    // (see PROCESS.md): under load, that gap plus the PATCH's own round
    // trip could exceed 150ms, so expectedEndAt had already passed by
    // the time reportStatus()'s own re-read checked it, and the PATCH
    // response came back already decayed instead of "in-use". Fixed
    // here by (1) removing the hidden gap and (2) widening the margin
    // generously regardless.
    const ifVersion = await currentVersion(machineId);

    const patch = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        status: "in-use",
        startedAt: Date.now(),
        expectedEndAt: Date.now() + SAFE_FUTURE_MS,
        ifVersion,
      }),
    });
    expect(patch.status).toBe(200);
    const patched = await patch.json();
    expect(patched.status).toBe("in-use");

    // Wait for the actual observable condition (decayed, via an
    // ordinary read) rather than a fixed sleep guessed to be "long
    // enough" — see pollUntilDecayed() and the constants above.
    const decayed = await pollUntilDecayed(machineId, POLL_BOUND_MS);
    expect(decayed).not.toBeNull();
    expect(decayed!.status).toBe("unknown");
    // Decay is a real, canonical mutation, not just a display fix on
    // read — it must advance `version` exactly like a resident's report
    // does, so a stale client can't silently resurrect the state it
    // just invalidated.
    expect(decayed!.version).toBeGreaterThan(patched.version);
  },
  TEST_TIMEOUT_MS,
);

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
