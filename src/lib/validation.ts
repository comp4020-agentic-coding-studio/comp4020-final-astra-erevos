// Shared request-body validation. Extracted from
// src/pages/api/machines/[id].ts so AA Room's API route (and any future
// one) uses the exact same guard, not a copy of it.
//
// node:sqlite throws rather than silently truncate when a stored INTEGER
// exceeds Number.MAX_SAFE_INTEGER, so an unvalidated client number can
// corrupt a row into one that errors on every future read — not
// hypothetical: this is exactly how ab-washer broke during the crit 8
// redeploy check. Reject anything that isn't a real, safe, positive
// integer before it ever reaches SQLite. See CLAUDE.md: "any new field
// that stores a client-provided number needs the same guard."
export function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
