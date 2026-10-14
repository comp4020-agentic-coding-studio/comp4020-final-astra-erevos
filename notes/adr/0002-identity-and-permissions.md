# ADR 0002: Server-issued pseudonymous identity and permissions

**Status**: Implemented (Crit 10) — identity/authorization in
[`a87c7c3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/a87c7c3),
logging in
[`347e5c1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/347e5c1),
a production cookie fix in
[`d7d0cd7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d7d0cd7),
verified live against the deployed Fly app — see Verification below.

## Context

Crit 10 ("All at once" ... "Fly by instruments") requires three things of
Toad Live: the app must be multi-user — two or more people, each in their
own browser, act on shared state, and the app tells them apart; what each
person may see and change must be checked on the server; and every
mutation must be durably, server-side logged, legible during a live
`flyctl logs` narration and useful after the crit ends, not a demo-only
code path.

Today's actual behaviour falls short of the second requirement.
`src/pages/index.astro`'s client script holds a `sessionId()` that reads
or creates a UUID in `localStorage` and sends it as `reporterId` in every
`PATCH` body; `src/pages/api/machines/[id].ts` accepts that field and
writes whatever string arrives straight to `machines.reporter_id`
(`src/lib/db.ts`). Two Chrome profiles *happen* to get different ids today
only because `localStorage` is profile-scoped — the server never verifies
that the `reporterId` in a request body is the one the connection it
arrived on actually belongs to. Any browser can `PATCH` with any
`reporterId`, including one copied from another resident's session, and
the server would accept it. "Checked on the server" is not met.

## Decision 1 — identity: server-issued pseudonymous session

A server-issued session, authenticated by possession of a high-entropy
credential, replaces the client-asserted `reporterId`.

**Compared against two alternatives:**

- **Client-generated pseudonym (today's behaviour)** — rejected. It gives
  the server no way to verify a `reporterId` belongs to the connection
  presenting it; the "checked on the server" requirement has no mechanism
  to attach to. Two profiles differing by `localStorage` accident is not
  the same claim as the server telling them apart.
- **Full accounts / login** — rejected for this crit. The brief states
  explicitly that "what counts as a person is your call (an account, a
  pseudonym, an anonymous browser)"; nothing in the spec asks for verified
  identity. `CLAUDE.md`'s existing rule also requires a new decision
  record before building account creation, passwords, or verification —
  this ADR is not that record. A verified-identity upgrade remains
  possible later without re-architecting the session table (`sessions.id`
  could gain a nullable link to a future `residents` row); nothing here
  forecloses it.
- **Chosen: server-issued pseudonymous session.** The server generates a
  high-entropy secret token on first visit, stores only its hash, and
  issues the raw token to the browser as an `HttpOnly` cookie. Every
  subsequent request is authenticated by hashing the presented token and
  matching it against the stored hash — not by trusting any value the
  client claims in a request body.

**Credential, actor id, and pseudonym are three distinct values**, each
with a different trust boundary, rather than overloading one id for all
three:

- the **credential** (raw token) lives only in the browser's cookie and
  in no server-side store — the server keeps only its hash, so a leaked
  database never discloses a replayable credential;
- the **internal actor id** (`sessions.id`) is what `machines.reporter_id`
  references — it is never sent to a client and never appears in a public
  API response, SSE event, or log line;
- the **pseudonym** (`Toad-7F3A9C`) is the only one of the three ever
  shown to a person or written to a log — generated independently of the
  token (its own random draw, not derived from or truncated out of it),
  so reading a pseudonym in `flyctl logs` reveals nothing about the
  credential that authenticates that session.

**What this claims, precisely, and what it does not:** the security
property is that the server no longer trusts a client-asserted actor
field in the request body — it authenticates *possession of a
server-issued secret* instead. `HttpOnly` narrows how that secret could
leak (it blocks page-JavaScript/XSS access to the cookie); it does not,
and this ADR does not claim it does, prevent the browser's own user from
copying or replaying their own cookie elsewhere. Session-credential theft
or replay by the legitimate holder is explicitly outside this ADR's
threat boundary — the boundary drawn here is "client-body-assertion" vs.
"server-verified-possession," not general session-fixation hardening.

**Public exposure:** the current `Machine` type's `reporterId` field is
removed from every response that carries it (`GET`, the `PATCH` success
body, the SSE `machine` event). Nothing in the client reads it today —
confirmed by inspection, nothing in `src/pages/index.astro`'s rendering or
live-update code or in `spec/*.test.ts` touches `machine.reporterId` — so
removing it costs the UI nothing and closes an otherwise-needless leak of
an internal identifier. If a later crit wants to display "last reported
by Toad-7F3A9C," that is a new, deliberate field carrying the pseudonym,
not this one reinstated.

## Decision 2 — permissions: no invented ownership

- every visitor, with or without a session, may **read** all ten
  machines — unchanged from today;
- any request carrying a valid, server-issued session may **report** any
  machine — checked against the actual schema and concept, not assumed:
  `machines` has no owner column, `FINAL_PROJECT_SOURCE_OF_TRUTH.md`'s
  whole model is shared state anyone may read and contribute to, and
  nothing in the app today resembles "my washer." Inventing per-machine
  ownership this week would contradict the project's own definition of
  good, not extend it;
- a request with **no session cookie, or a cookie whose hash matches no
  stored session, cannot mutate state** and is rejected with `401` before
  the request body is parsed at all. This is the one behavioural change
  on the write path: today a `PATCH` with no `reporterId` still succeeds.
- Crit 9's optimistic concurrency (`ifVersion`, the `WHERE id = ? AND
  version = ?` guard) is unaffected — it already doesn't care who the
  writer is, only what version they last saw, so two valid sessions
  racing on the same machine still resolves exactly as it does today: the
  second writer gets `409` with the current canonical state.

**Anti-impersonation is an explicit rejection, not a silent ignore.** A
`PATCH` body that includes a `reporterId` field is not merely disregarded
in favour of the resolved session — it is refused outright with `400` and
the message `reporterId is server-controlled`, and the machine row is left
unchanged. The contract this draws is direct: a client is not allowed to
*claim* an actor at all, not just prevented from having that claim
believed.

## Decision 3 — logging: pseudonym-only, stdout, durable by virtue of running

One line per real event, written to stdout (captured by `flyctl logs`
with no extra infrastructure, and durable in the sense that the deployed
process emits it on every real request, not a demo-only path):

- `session_created` — fires once, the moment a new session row is
  inserted. This is what makes two fresh Chrome profiles visible as two
  distinct pseudonymous actors in the log stream before either one
  reports anything.
- a line for every `PATCH /api/machines/:id` attempt, authenticated or
  not, naming the actor pseudonym (or `(none)` if there is no session),
  the machine, and the outcome.

**Rejected requests are not over-reported.** If a session is missing or
invalid, the request is rejected before the body is ever parsed — the log
line for that case names no `status`, because the server never parsed one
to name. A `status` field only appears once authentication and body
parsing have both actually succeeded. See the exact line shapes in
`PROCESS.md`'s Crit 10 section (added as part of this ADR) and the
implementation notes below.

No raw token or token hash is ever logged — only the pseudonym, which by
construction (independent randomness, not derived from the token) reveals
nothing about the credential.

## Mechanics

**Schema** — one new table, `sessions`, kept deliberately minimal for
Crit 10:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  pseudonym   TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);
```

No `last_seen_at`. It would only record the timestamp of the last
authenticated request, not prove a session is currently "active," and
presence — who else has the app open right now — is deliberately out of
scope (`README.md`, `FINAL_PROJECT_SOURCE_OF_TRUTH.md` §10). Adding a
write on every session resolution to populate a field nothing reads yet
is cost without a corresponding decision behind it. If presence is
designed later, it gets its own ADR and its own field, rather than growing
accidentally out of a column added for an unrelated reason this week.

**Unlike Crit 9's `version` column, `sessions` is a wholly new table, not
a new column on an existing one.** `CREATE TABLE IF NOT EXISTS` is
sufficient on its own against the real `/data` database exactly as it is
against a fresh one — it creates the table on first run, no-ops on every
run after. No `ALTER TABLE`, no `sqlite_master` check, and no startup
migration function are needed, unlike `migrateVersionColumn()` in
`src/lib/db.ts`, which existed specifically because a new *column* on an
existing table is something `CREATE TABLE IF NOT EXISTS` cannot retrofit.

**`machines.reporter_id`** keeps its existing `TEXT` column and nullable
shape; its meaning changes to "references `sessions.id`," recorded as a
schema comment. No `FOREIGN KEY` constraint is added — SQLite foreign
keys require `PRAGMA foreign_keys = ON`, not set anywhere in this
codebase, and turning it on is a separate decision this ADR doesn't make.

**Session creation** generates the internal id, the secret token, and the
pseudonym together, and retries the *entire* set together on any `UNIQUE`
violation — not just the pseudonym's. `sessions.id` comes from
`crypto.randomUUID()` and the token from 32 bytes of `crypto.randomBytes`,
both astronomically unlikely to collide; the pseudonym (6 random hex
characters) is the one practically reachable collision at crit scale. A
retry loop that only regenerated the pseudonym while reusing a colliding
token or id would be solving the wrong problem for the case it actually
hits, and would leave a stale credential behind in the case it doesn't.
Regenerating all three together is simpler and correct for every
constraint failure, not just the common one.

**Cookie**: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` of one year
(`365 * 24 * 60 * 60` seconds) — long enough that a resident's pseudonym
survives a browser restart and a Fly redeploy (the session record is
durable in SQLite regardless; the cookie is only the credential, not the
record), with no verified-identity reason to make it effectively
permanent. Clearing cookies, or opening a fresh incognito profile —
exactly what the crit's two-Chrome-profile demo does — creates a new
anonymous identity, which is the intended behaviour, not something to
engineer around.

`Secure` is meant to be set whenever the request arrived over HTTPS, and
not otherwise — so the cookie still works against
`http://localhost:8080` in local development and in `spec/`'s tests. The
first implementation got this wrong in a way only the live deployment
exposed: it decided `Secure` from the app's own request URL
(`Astro.url.protocol`) alone. Fly's proxy terminates TLS in front of the
app and forwards every request to the Node process over plain HTTP
(`fly.toml`'s own comment: "the app itself sees plain http"), so that
check read `"http:"` even on the live HTTPS site, and `Secure` was
silently never set in production — the opposite of the intent. `curl`
against the real `https://…fly.dev` URL during the Crit 10 rehearsal
check caught this directly, in the `Set-Cookie` header itself; nothing
in local testing could have, since `localhost` has no TLS-terminating
proxy standing in front of it to hide this distinction behind.
[`d7d0cd7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/d7d0cd7)
fixed it: a request counts as HTTPS if either signal says so — the
app's own URL, or Fly's trusted `X-Forwarded-Proto` header, read via
`Astro.request.headers` and handled safely (first value only,
case-insensitive, tolerant of a multi-hop comma-separated form). The
decision was extracted into its own dependency-free module
(`src/lib/request-protocol.ts`) specifically so it could be unit-tested
without pulling in the database module as a side effect, with
regression coverage for both the direct-HTTPS and internal-HTTP-plus-
forwarded-header cases. Re-checking the live `Set-Cookie` header after
the fix confirmed `Secure` present.

**API**: `PATCH /api/machines/:id` resolves the session from the request
cookie before parsing the body. No session, or a token hashing to no
stored row, returns `401` and logs the rejection (§ Decision 3). A `PATCH`
body containing `reporterId` returns `400` with `reporterId is
server-controlled` and leaves the row unchanged. Otherwise the resolved
session's internal id is what gets passed to `reportStatus()` — never a
value read from the request body.

## Consequences

The public `Machine` shape loses `reporterId`; nothing in the existing
client or `spec/*.test.ts` referenced it, so this is a pure reduction in
exposed surface. The client's `sessionId()`/`localStorage` logic is
deleted entirely — identity is no longer something the client computes or
carries. The server gains one new table and one hash-lookup per
authenticated request. A resident who clears cookies, or who opens the
app in a fresh profile, becomes a new pseudonym with no history — accepted
as correct, not a gap: it is exactly the behaviour the brief's
two-separate-Chrome-profiles demo exercises. A forged `reporterId` is no
longer silently dropped but explicitly rejected, giving a direct,
testable anti-impersonation contract instead of an implicit one.

## Verification

Automated: `spec/identity.test.ts` — two cookie-less requests to `/`
receive different session cookies and different rendered pseudonyms; a
`PATCH` with no cookie, or with an unissued token, is rejected `401`
with the machine row unchanged; a `PATCH` body carrying `reporterId` is
rejected `400` with the row unchanged; a valid session's `PATCH`
succeeds and a later independent `GET` confirms the write persisted
(with no `reporterId` in the response); the same cookie resolves to the
same pseudonym across repeat requests. `spec/log.test.ts` checks the
exact `[toadlive]` line shapes for `session_created` and all three
`PATCH` outcomes. `spec/request-protocol.test.ts` covers the `Secure`
decision directly: a direct HTTP request with no forwarded header is
not HTTPS; a direct HTTPS request is; an internal HTTP request carrying
`X-Forwarded-Proto: https` — the exact shape Fly's proxy produces — is;
only the first value of a multi-hop header is read; the decision is
case- and whitespace-tolerant.

Manual, against the real deployed app, not a local stand-in: two
isolated Chrome profiles opened `https://comp4020-final-astra-erevos.fly.dev`
directly, no cookies or storage shared between them, with one person
narrating entirely from `mise exec -- flyctl logs -a
comp4020-final-astra-erevos` and never touching the app. The two
profiles appeared as distinct pseudonyms (`Toad-30F342`, `Toad-EA3A0F`),
each with its own `session_created` line. `Toad-30F342` reporting
`e-dryer` as `in-use` and `Toad-EA3A0F` reporting `c-washer` as
`available` both appeared as `result=ok`, naming their own actor and
machine. `Toad-EA3A0F` was then deliberately forced to report
`e-dryer` on a stale version: the log showed `result=conflict` against
the current version, and once that profile reconfirmed against the
canonical state, the same actor's second attempt appeared as
`result=ok` with the version advanced again — the full
report/conflict/reconfirm/success loop, readable from the log stream
alone, with no need to look at either browser. Ordinary `GET`/SSE
traffic produced no `[toadlive]` lines throughout. The live
`Set-Cookie` header was checked directly (`curl -sD-`) both before and
after the `d7d0cd7` proxy fix — confirmed missing `Secure` beforehand,
confirmed present after.
