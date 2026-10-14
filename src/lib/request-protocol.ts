// Deliberately its own module, with no import of src/lib/db.ts or
// anything else that opens a database connection as a side effect of
// being imported. spec/sessions.test.ts needs to unit-test this decision
// in-process; importing it from src/lib/sessions.ts (which pulls in
// db.ts, and so opens a second SQLite connection to the same file a
// running dev server already has open) caused exactly that: an
// intermittent "database is locked" failure, not a real product bug —
// moving the function here instead of just testing it via sessions.ts
// removes the cause rather than working around the symptom.

// Decides whether to mark the session cookie Secure. `requestUrl` is the
// app's own view of the request — correct for a direct HTTPS connection,
// but Fly's proxy terminates TLS in front of the app and forwards the
// request to this Node process over plain HTTP (see fly.toml's own
// comment: "the app itself sees plain http"), so `requestUrl.protocol`
// alone reads "http:" even on the live HTTPS site. Fly's proxy sets
// X-Forwarded-Proto to what the browser actually connected with, so a
// request is HTTPS if *either* signal says so.
//
// `forwardedProto` may be a comma-separated list if more than one proxy
// hop set it (`"https, http"` — the original client's protocol, leftmost,
// per the X-Forwarded-* convention); only the first value is read, case-
// insensitively, and trimmed.
//
// http://localhost:8080 (local `pnpm dev`/`pnpm check`) has neither
// signal, so this correctly stays false there — Secure would otherwise
// stop the browser (or a test's fetch) from sending the cookie back at
// all over plain HTTP.
export function isHttpsRequest(requestUrl: URL, forwardedProto: string | null): boolean {
  if (requestUrl.protocol === "https:") return true;
  const first = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  return first === "https";
}
