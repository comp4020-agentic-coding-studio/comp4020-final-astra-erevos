import { expect, inject, it } from "vitest";

// Crit 10: a server-issued pseudonymous session replaces the old
// client-generated, client-asserted reporterId. See
// notes/adr/0002-identity-and-permissions.md. Every request here manages
// its own Cookie header explicitly rather than relying on a shared cookie
// jar — that's what actually simulates two isolated browser profiles
// sharing no cookies or storage, the same isolation the crit's own
// two-Chrome-profile demo relies on.
const baseUrl = inject("baseUrl");

const COOKIE_NAME = "toadlive_session";

function cookieToken(setCookieHeaders: string[]): string {
  const own = setCookieHeaders.find((header) => header.startsWith(`${COOKIE_NAME}=`));
  if (!own) throw new Error(`no ${COOKIE_NAME} cookie in Set-Cookie headers: ${setCookieHeaders.join(" | ")}`);
  return own.split(";")[0]!.slice(`${COOKIE_NAME}=`.length);
}

function pseudonymFrom(html: string): string {
  const match = html.match(/Toad-[0-9A-F]{6}/);
  if (!match) throw new Error("no pseudonym found in page HTML");
  return match[0];
}

// A fresh, cookie-less visit — simulates a brand new browser profile
// opening Toad Live for the first time. Returns the token the server
// issued and the pseudonym rendered on the page for it.
async function freshVisit(): Promise<{ token: string; pseudonym: string }> {
  const res = await fetch(new URL("/", baseUrl));
  expect(res.status).toBe(200);
  const token = cookieToken(res.headers.getSetCookie());
  const pseudonym = pseudonymFrom(await res.text());
  return { token, pseudonym };
}

// A later visit using an already-issued token — simulates the same
// browser returning, cookie intact.
async function revisit(token: string): Promise<{ pseudonym: string; setNewCookie: boolean }> {
  const res = await fetch(new URL("/", baseUrl), {
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });
  expect(res.status).toBe(200);
  return {
    pseudonym: pseudonymFrom(await res.text()),
    setNewCookie: res.headers.getSetCookie().some((header) => header.startsWith(`${COOKIE_NAME}=`)),
  };
}

async function getMachine(machineId: string): Promise<Record<string, unknown>> {
  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl));
  return res.json();
}

it("two fresh, cookie-less browser visits get different sessions and pseudonyms", async () => {
  const a = await freshVisit();
  const b = await freshVisit();

  expect(a.token).not.toBe(b.token);
  expect(a.pseudonym).not.toBe(b.pseudonym);
});

it("the same valid cookie resolves to the same pseudonym on a later visit", async () => {
  const first = await freshVisit();
  const second = await revisit(first.token);

  expect(second.pseudonym).toBe(first.pseudonym);
  // An already-known session shouldn't be reissued a fresh cookie — only
  // a genuinely new session mints one.
  expect(second.setNewCookie).toBe(false);
});

// This machine carries no successful mutation from any other spec file —
// see spec/persistence.test.ts, which only ever rejects a PATCH against
// it with 400 before reaching reportStatus(). Using it here for the one
// real mutation below, plus every rejection case, can't race any other
// file's write.
const machineId = "ab-dryer";

it("a PATCH with no session cookie is rejected, and the machine is unchanged", async () => {
  const before = await getMachine(machineId);

  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "available", ifVersion: before.version }),
  });
  expect(res.status).toBe(401);

  const after = await getMachine(machineId);
  expect(after.version).toBe(before.version);
  expect(after.status).toBe(before.status);
});

it("a PATCH with an unknown session token is rejected, and the machine is unchanged", async () => {
  const before = await getMachine(machineId);

  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      // Well-formed (same shape a real token has) but never issued by
      // this server — no session's token_hash can match it.
      cookie: `${COOKIE_NAME}=not-a-real-session-token`,
    },
    body: JSON.stringify({ status: "available", ifVersion: before.version }),
  });
  expect(res.status).toBe(401);

  const after = await getMachine(machineId);
  expect(after.version).toBe(before.version);
  expect(after.status).toBe(before.status);
});

it("a PATCH with a valid session succeeds, and the response exposes no reporterId", async () => {
  const { token } = await freshVisit();
  const before = await getMachine(machineId);

  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: `${COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({ status: "out-of-order", ifVersion: before.version }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.version).toBe((before.version as number) + 1);
  expect(body.status).toBe("out-of-order");
  expect(body).not.toHaveProperty("reporterId");

  // Durable, not just echoed in the PATCH response: an independent later
  // GET agrees.
  const after = await getMachine(machineId);
  expect(after.version).toBe(body.version);
  expect(after).not.toHaveProperty("reporterId");
});

it("a PATCH body carrying reporterId is rejected with 400, and the machine is unchanged", async () => {
  const { token } = await freshVisit();
  const before = await getMachine(machineId);

  const res = await fetch(new URL(`/api/machines/${machineId}`, baseUrl), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: `${COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({
      status: "available",
      ifVersion: before.version,
      reporterId: "some-other-sessions-id",
    }),
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("reporterId is server-controlled");

  const after = await getMachine(machineId);
  expect(after.version).toBe(before.version);
  expect(after.status).toBe(before.status);
});
