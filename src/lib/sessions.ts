// Crit 10's identity layer. See
// notes/adr/0002-identity-and-permissions.md for the full decision:
// credential, internal actor id, and resident-facing pseudonym are three
// distinct values, not one id serving all three purposes.
//
// The browser only ever holds the raw secret token, in an HttpOnly cookie.
// The server stores only its hash (sessions.token_hash) and resolves a
// request by hashing the presented token and matching it — "authenticates
// possession of a server-issued credential," not "trusts a client-asserted
// identity." sessions.id (the internal actor id) and sessions.pseudonym
// are never derived from the token and never let the token be
// reconstructed from them.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { db } from "./db.ts";

export interface Session {
  id: string;
  pseudonym: string;
}

const COOKIE_NAME = "toadlive_session";
// One year: long enough that a resident's pseudonym survives a browser
// restart and a Fly redeploy (the record is durable in SQLite regardless —
// this is only the credential's lifetime), with no verified-identity
// reason to make it effectively permanent. Clearing cookies, or a fresh
// incognito profile, creates a new anonymous identity — intended, not a
// gap; it's exactly what the crit's two-Chrome-profile demo exercises.
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generatePseudonym(): string {
  // 6 hex chars, drawn independently of the token (its own randomBytes
  // call, never sliced out of or derived from the credential) — so a
  // pseudonym shown on the page or written to a log reveals nothing about
  // the secret that authenticates its session.
  const hex = randomBytes(3).toString("hex").toUpperCase();
  return `Toad-${hex}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_SQLITE_ERROR" &&
    error.message.includes("UNIQUE constraint failed")
  );
}

// Generates a fresh id, secret token, and pseudonym together, and retries
// the whole set together on any UNIQUE collision (id, token_hash, or
// pseudonym alike) rather than assuming only the pseudonym can collide —
// a stale id or token left over from a partial retry would be a bug, not
// a fix, for whichever constraint actually failed.
export function createSession(): { session: Session; token: string } {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const pseudonym = generatePseudonym();

    try {
      db.prepare(
        "INSERT INTO sessions (id, token_hash, pseudonym, created_at) VALUES (?, ?, ?, ?)",
      ).run(id, tokenHash, pseudonym, Date.now());
      return { session: { id, pseudonym }, token };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // collision on id, token_hash, or pseudonym — vanishingly unlikely
      // for the first two, practically reachable for the 6-hex-char
      // pseudonym at crit scale. Retry with an entirely fresh draw of all
      // three rather than reusing anything from this attempt.
    }
  }
  throw new Error("could not create a unique session after 5 attempts");
}

// Resolves a request's session from its cookie token. Never creates one —
// that only happens on a page visit (src/pages/index.astro); an API route
// with no/unknown session must reject, not silently mint a new identity
// for a write it's about to refuse anyway.
export function resolveSession(token: string | undefined): Session | null {
  if (!token) return null;
  const row = db
    .prepare("SELECT id, pseudonym FROM sessions WHERE token_hash = ?")
    .get(hashToken(token)) as Session | undefined;
  return row ?? null;
}

// isHttpsRequest() (the cookie-Secure decision) lives in its own module,
// src/lib/request-protocol.ts — it has nothing to do with sessions as
// such, and keeping it dependency-free there (no import of this module,
// which pulls in db.ts) lets it be unit-tested without opening a second
// SQLite connection to a file a running app already has open.
export { isHttpsRequest } from "./request-protocol.ts";

export { COOKIE_NAME, COOKIE_MAX_AGE_SECONDS };
