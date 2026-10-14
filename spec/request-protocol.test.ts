import { expect, it } from "vitest";
import { isHttpsRequest } from "../src/lib/request-protocol.ts";

// isHttpsRequest() decides the session cookie's Secure attribute. A real
// incident during the Crit 10 live rehearsal check: Fly's proxy
// terminates TLS in front of the app and forwards the request over plain
// HTTP, so Astro.url.protocol alone reads "http:" even on the live HTTPS
// site — Secure was silently never being set in production. See
// notes/adr/0002-identity-and-permissions.md and
// src/lib/request-protocol.ts. These tests run in-process (import the
// function directly) rather than against the running app, since the
// point is the decision function itself, not an HTTP round trip.
// Imported from request-protocol.ts directly, not sessions.ts: the
// latter imports db.ts, which opens its own SQLite connection as a side
// effect of module load, and a second connection racing a running dev
// server's/another spec file's connection to the same file produced an
// intermittent "database is locked" failure here — nothing to do with
// this function's own correctness.

it("a direct http:// request with no forwarded header is not treated as HTTPS", () => {
  expect(isHttpsRequest(new URL("http://localhost:8080/"), null)).toBe(false);
});

it("a direct https:// request is treated as HTTPS regardless of any forwarded header", () => {
  expect(isHttpsRequest(new URL("https://example.fly.dev/"), null)).toBe(true);
});

it("an internal http:// request with X-Forwarded-Proto: https is treated as HTTPS", () => {
  // The exact shape Fly's proxy produces: the app's own URL is plain
  // http (fly.toml's own comment: "the app itself sees plain http"), but
  // the proxy tells the app what the browser actually connected with.
  expect(isHttpsRequest(new URL("http://localhost:8080/"), "https")).toBe(true);
});

it("a forwarded header naming http is not treated as HTTPS", () => {
  expect(isHttpsRequest(new URL("http://localhost:8080/"), "http")).toBe(false);
});

it("reads only the first value of a comma-separated forwarded header", () => {
  // Multiple proxy hops append to X-Forwarded-Proto; the original
  // client's protocol is the leftmost value.
  expect(isHttpsRequest(new URL("http://localhost:8080/"), "https, http")).toBe(true);
  expect(isHttpsRequest(new URL("http://localhost:8080/"), "http, https")).toBe(false);
});

it("is case-insensitive and tolerant of surrounding whitespace", () => {
  expect(isHttpsRequest(new URL("http://localhost:8080/"), " HTTPS ")).toBe(true);
});
