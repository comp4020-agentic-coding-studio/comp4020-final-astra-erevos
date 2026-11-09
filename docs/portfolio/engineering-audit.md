# Toad Live — Engineering Audit

**Framing question:** if Toad Live stopped being a course project today and
became software intended to run and be maintained for another year, what
would actually be worth investing in next?

This audit is read-only. It reconstructs the architecture from source,
inspects security/reliability/performance/maintainability/observability/
test-gap/dependency surfaces, and classifies every finding into one of:
**P0** (a real correctness/security problem today), **P1** (not broken,
but meaningfully improves resilience/maintainability/confidence), **P2**
(worthwhile polish), **Future-scale** (correctly unnecessary today, becomes
necessary if deployment assumptions change), or **No action** (a tempting
idea investigated and rejected).

Baseline facts used throughout: 7 facilities, 10 laundry machines, 10 Rat
Room seats, 264 tests across 22 spec files, one Fly machine (shared-cpu-1x,
256MB), one SQLite file on one persistent volume, one Node process.

---

## Executive summary

The system is small, coherent, and well-matched to its actual deployment
shape. No P0s were found — nothing currently produces wrong data, a
security breach, or a production failure under realistic use. The
strongest findings are:

1. The production Docker image ships the *full* `node_modules`, including
   devDependencies (`vitest`, `jsdom`, `typescript`) and their vulnerable
   transitive dependencies (`vite`, `undici`, `zod`, `source-map-js`),
   despite the Dockerfile's own comment claiming "prod deps" (P1).
2. The `sessions` table has no TTL, expiry, or cleanup path anywhere in
   the codebase — an anonymous visitor hitting `GET /` repeatedly grows it
   forever (P1, a genuine gap, not a deliberate product choice).
3. `broadcast()` has no per-subscriber error isolation. Every open SSE
   connection installs its own callback via `subscribe()`, so multiple
   simultaneously-open browser sessions mean multiple live entries in
   the subscriber `Set` today — this is not a one-subscriber system.
   An unhandled exception in any one of them would propagate back
   through a mutation that has already committed (P1).
4. No startup-time handling for a corrupted/inaccessible SQLite file —
   the process would crash-loop with no distinguishing log message (P1).
5. The single highest-value test gap: `persistence.test.ts` never
   restarts the process or reopens the database file — it proves
   same-process durability, not the actual "survives a restart" claim
   Crit 8 grades (P1).

Equally important: several things that look like they should be fixed were
investigated and are **sound as built** — concurrent writes to the same
resource are safe primarily because each write is one atomic,
version-guarded SQL statement (`UPDATE ... WHERE id = ? AND version = ?`),
with the current single-process, synchronous runtime further ruling out
any JS-level interleaving around that statement; lazy-decay-vs-user-write
races are already guarded; 409 recovery is complete; and the four
single-row occupancy rooms' apparent duplication encodes a genuine,
separately-confirmed fact (the 4-hour ceiling) rather than copy-paste
laziness.

---

## Architecture reviewed

**Request lifecycle.** Astro in `server` mode (`astro.config.ts`,
`@astrojs/node` standalone adapter) compiles to one Node process reading
`HOST`/`PORT` from the environment — matching `fly.toml`'s one
`shared-cpu-1x` machine, one volume at `/data`, no separate database
server. `index.astro` resolves or creates a session from the request
cookie (`src/lib/sessions.ts`), reads all seven facilities' state via a
handful of single-query reads, and renders the full page server-side with
no client-side re-fetch needed on first load.

**Session issuance and lookup.** `createSession()` generates an internal
UUID actor id, a 32-byte random token, and an independently-random
6-hex-char pseudonym together, retrying all three on any `UNIQUE`
collision. Only the token's SHA-256 hash is ever stored
(`sessions.token_hash`); the raw token lives only in an `HttpOnly`,
`SameSite=Lax` cookie. `resolveSession()` looks up by hash and never
creates — only a page load (`index.astro`) mints a new session; API
routes reject a missing/unknown session with 401 before parsing the body.

**SQLite connection lifecycle.** One shared `DatabaseSync` handle
(`src/lib/db.ts:45`), opened once at module load, used synchronously for
every read and write across every facility's `*-db.ts` wrapper module.
`sessions.ts` deliberately imports this same connection rather than
opening a second one — `node:sqlite` is synchronous and single-process,
so sharing is correct, not a shortcut.

**Schema and persistence.** `db/schema.sql` defines `machines` (5
locations × 2 types), `sessions`, and one table per single-row facility
(`aa_room`, `otter_room`, `rabbit_room`, `weasel_room`, `badger_room`),
plus `rat_room_seats` (10 rows, `seat` `UNIQUE`). Every mutable table
carries `version INTEGER NOT NULL DEFAULT 1`. `CREATE TABLE IF NOT EXISTS`
only shapes a fresh database; `db.ts`'s `migrateVersionColumn()` and
`aa-room.ts`'s `migrateAaRoomActivitiesColumn()` handle forward migration
of an already-deployed `/data` volume.

**GET/read path.** Every `get*()` function (`getMachine`, `getAaRoom`,
`getRatRoomSeat`, etc.) runs a single `SELECT`, then passes the row
through that facility's `decayed*()` function before converting to the
public shape. `listMachines()`/`listRatRoomSeats()` are each a single
`SELECT ... ORDER BY` — not N+1 per-row queries (confirmed by the
performance fork).

**Lazy decay path.** Decay never runs on a timer — only inside an ordinary
read. `decayed()` (`db.ts:118-154`) is the canonical shape every
per-room equivalent follows: `if (row.status !== "in-use") return row`
(machines) / `if (row.occupancy === "unknown") return row` (single-row
rooms) short-circuits untouched statuses, including out-of-order's
stickiness, directly from control flow rather than a special case. A
qualifying decay is itself a real write — guarded `UPDATE ... WHERE ...`,
version bump, broadcast — exactly like a resident's own report.

**PATCH/report path.** Every API route (`machines/[id].ts`,
`aa-room.ts`, `rat-room/[seat].ts`, etc.) follows the same shape:
resolve session from cookie → reject 401 before parsing body if absent →
parse and validate body → reject 400 on a client-supplied `reporterId` →
validate numeric fields via `isSafePositiveInteger()` → call the
store-layer report function with the session's internal id, never a
client-supplied one.

**`ifVersion` concurrency path.** One atomic, guarded SQL statement per
write: `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND
version = ?`. Zero rows changed is disambiguated by a re-read into
"not found" (404) vs. "stale" (409, with current canonical state
returned in the body).

**SSE subscription/broadcast/reconnect path.** `src/lib/realtime.ts`
holds one in-process `Set<Subscriber>`; `broadcast()` is called only
after a mutation actually commits. `src/pages/api/stream.ts` is the one
SSE endpoint, sending an immediate `: connected` comment to force header
flush, switching on the broadcast payload's `kind` to emit a named SSE
event per facility. No event replay/history — a (re)connecting client
re-fetches current state itself.

**Client-side live-state handling.** `src/lib/live-stream.ts` is a
module-singleton wrapper around one shared `EventSource`, fired once per
page (not per facility script block) via ES-module caching. `onOpen()`
fires once per connect/reconnect; 14 registered listeners across 7
facilities each independently re-fetch their own current state — 10
individual calls for Laundry, 10 for Rat Room's seats, 1 each for the
five single-row rooms (25 total on a full reconnect, confirmed by the
performance fork).

**Three.js renderer/scene lifecycle.** `src/lib/hall-view/scene.ts`
(1,168 lines) holds one shared `WebGLRenderer` and a `mountedScenes`
registry, so switching facility tabs mounts/updates the relevant scene
rather than tearing down and rebuilding a renderer. All seven facilities'
scene code ships in one 637KB JS chunk (`scene.*.js`), loaded upfront on
first visit regardless of which tab a visitor actually opens (confirmed
by the performance fork; static imports throughout, no dynamic `import()`
anywhere in `index.astro`).

**Fly runtime/deployment shape.** One `shared-cpu-1x` machine, 256MB, one
volume at `/data`, `auto_stop_machines`/`min_machines_running = 0` for
scale-to-zero economics. `DB_PATH=/data/toadlive.db` in production.

**CI/test architecture.** `.github/workflows/checks.yml` builds the real
Dockerfile image, runs it with `--tmpfs /data`, then runs `pnpm check`
(typecheck + the full Vitest suite) against it over real HTTP before any
deploy. A separate `deploy` job only runs for pushes to `main`.

**GitHub Pages portfolio deployment (separate).** `.github/workflows/
portfolio-pages.yml` builds `src/pages/portfolio.astro` statically via a
second Astro config (`astro.config.pages.ts`), gated to the `portfolio`
branch only, with no access to `FLY_API_TOKEN` and no `flyctl` calls —
confirmed structurally isolated from the submitted app's own deploy path.

---

## Security

### Session security — sound, no new findings beyond what's documented

Credential/actor-id/pseudonym separation, hash-only storage, `HttpOnly`
cookie, and the corrected `Secure`-flag logic (`isHttpsRequest()`
checking both direct protocol and `X-Forwarded-Proto`, fixing a real
production incident) are all verified directly from source and are
sound. Anti-impersonation is an explicit 400 rejection of any
client-supplied `reporterId`, not a silent ignore. `SameSite=Lax` is an
appropriate choice for this app's shape — it blocks cross-site POST/PATCH
forgery in most contexts while still letting a resident follow a link
into the app.

**No CSRF token exists.** `SameSite=Lax` cookies are not sent on
cross-site `PATCH`/`POST` requests from most contexts (though `Lax`'s
exact cross-site-form behavior has had browser inconsistencies
historically) — this is a reasonable mitigation for the threat this app
actually has (anonymous, no financial/irreversible action, low-stakes
status reports), not a complete CSRF defense. **Classification: No
action** — a dedicated CSRF token would be meaningfully more defense than
the actual risk (someone's washer status getting forged) justifies, and
`SameSite=Lax` already covers the realistic case.

### Input validation — sound, confirmed end-to-end

`isSafePositiveInteger()` guards every client-supplied numeric field
(`startedAt`, `expectedEndAt`, `ifVersion`) before it reaches SQLite —
directly traceable to the real "ab-washer" corruption incident
(CLAUDE.md's own rule). Status/occupancy enums are checked against
`VALID_STATUSES`/`VALID_REPORTABLE_*_OCCUPANCIES` arrays in
`types.ts`. Malformed JSON is caught via `.catch(() => null)`. Rat
Room's `expectedEndAt` is additionally bounded to the future and capped
at 4 hours ahead (`rat-room/[seat].ts:111`). No gaps found.

### HTTP/security behaviour

- **No CORS headers anywhere** — correct for this app's shape: it's a
  same-origin page with no API consumed cross-origin. **No action.**
- **No custom error page; Astro's default production 500 behavior
  verified directly** (reliability fork): an uncaught exception returns
  a static "Internal Server Error" body with no stack trace — confirmed
  via the built `entry.mjs`, not assumed. **No action.**
- **No API response ever echoes raw user input** — confirmed by reading
  every `src/pages/api/**/*.ts` error message; all are static
  developer-authored strings. **No action.**
- **No security headers** (CSP, X-Frame-Options, etc.) — the app has no
  third-party embeds, no user-generated HTML rendering, and isn't
  designed to be iframed. **P2** — cheap to add (`X-Content-Type-Options:
  nosniff`, a basic CSP) as defense-in-depth, but no realistic attack
  this app faces today depends on their absence.

### Abuse surface

| Concern | Classification | Finding |
|---|---|---|
| Report spam (unlimited PATCH loop on one resource) | Scaling-concern | Cheap today — sub-ms SQLite writes, `broadcast()` is O(subscribers) per write, not O(resources). Negligible at realistic (tens of tabs) scale. **Future-scale.** |
| **Session creation flooding** | **Security weakness** | **Confirmed real gap** — `sessions` has no TTL, no cleanup job, no cap anywhere (grepped: zero hits for cleanup/expire/TTL/`DELETE FROM sessions`). A `UNIQUE` index keeps lookups O(log n) even as the table grows, so this isn't a latency problem — it's unbounded row/disk growth from anonymous repeat visits with no cookie. Not a deliberate product decision (no ADR/CLAUDE.md discussion of table growth). **P1.** |
| SSE connection exhaustion | Scaling-concern | No cap on concurrent `/api/stream` connections; each is tens of KB (socket + stream machinery). Immaterial at today's scale; would matter only at thousands of concurrent connections. **Future-scale.** |
| Log flooding (rejected-PATCH logging) | Product choice | Standard web-app behavior; Fly's log volume isn't metered at this app's scale. **No action.** |

### Secrets / repository hygiene

No committed secrets found. `FLY_API_TOKEN` is a GitHub Actions secret,
never in the repo; `checks.yml` runs `trufflehog` (pinned action SHA and
scanner version) against verified secrets and a course-key-shaped custom
regex on every CI run. Workflow permissions are minimal and explicit
(`contents: read`, `pages: write`/`id-token: write` only where needed).
The portfolio-pages workflow has no `env` block referencing
`FLY_API_TOKEN` and never calls `flyctl` — structurally, not just by
convention, incapable of deploying to Fly.

**One real hygiene finding, found via direct Dockerfile inspection**: the
Dockerfile's `COPY --from=build /app/node_modules ./node_modules` copies
the *entire* `node_modules` (241MB) into the final production image —
including `vitest`, `jsdom`, and `typescript` (devDependencies) and their
transitive dependencies. Confirmed that `zod` is actually imported by
Astro's own bundled runtime (`dist/server/chunks/server_D3SqUK5C.mjs`,
reachable code) while `vite`/`undici`/`source-map-js`/`@vitest/mocker`
are *not* imported anywhere in `entry.mjs`'s import graph — they ship as
dead weight, not active runtime surface, but they do inflate the image
and nominally widen what `pnpm audit` flags against this deployment. See
Dependencies section below. **P1.**

---

## Reliability

Full failure-mode trace (13 scenarios investigated):

| # | Failure mode | Verdict |
|---|---|---|
| 1 | SQLite write failure (disk full, CHECK violation) | No try/catch around any `.run()` call anywhere; unreachable via the API today since app-level validation guards every write, but not defended at the DB layer itself. **P2.** |
| 2 | **DB mutation succeeds, a subscriber's `broadcast()` callback throws** | `broadcast()` has no try/catch around each subscriber call. Each open SSE connection installs its own callback via `subscribe()` (`stream.ts:48`), so multiple concurrently-open browser sessions already mean multiple entries in the subscriber `Set` — this is not a single-subscriber system today. The existing callback already catches `controller.enqueue()` failures internally (`stream.ts:49-56`), which is why an ordinary disconnected-client error is already contained — but `broadcast()` itself has no isolation around *each* subscriber call, so an unexpected exception in any one callback (current or future) would propagate back through a mutation that has already committed, potentially before later subscribers in the same `for` loop are notified. **P1 — central per-subscriber isolation would remove this regardless of how many subscribers exist today.** |
| 3 | Broadcast occurs, client already disconnected | Already defended — `stream.ts`'s try/catch around `controller.enqueue` plus the `abort` listener. **No action.** |
| 4 | Fly machine restart / volume reattachment | Sound — `mkdirSync` + reopening the same `/data` file; no special recovery logic needed because SQLite's own durability covers it. **No action.** |
| 5 | **Corrupted/inaccessible SQLite file at startup** | No try/catch around `new DatabaseSync(dbPath)` or the initial `db.exec(schema)`. A corrupted file throws at module load — the whole process fails to boot, crash-looping with whatever raw SQLite error happens to surface in `flyctl logs`. **P1 — cheap win: catch and log a clear, distinguishable message.** |
| 6 | Malformed persisted rows (CHECK-violating data from manual DB tampering) | Unchecked `as MachineRow` casts exist, but the only path to such a row is bypassing the app entirely — out of this app's threat model. **No action.** |
| 7 | `createSession()` exhausts its 5 retry attempts | Uncaught throw surfaces as an Astro 500 for that one request. Vanishingly unlikely at this collision probability (6-hex pseudonym space, cryptographic token/UUID). **No action — revisit only at much higher scale.** |
| 8 | EventSource reconnect loops during an extended outage | Native browser behavior (~3s retry, no backoff by spec) — trivial load at this community's scale. **No action**, worth naming in a scaling discussion. |
| 9 | Stale client state between decay firing and next read | Sound by design — every read (including reconnect re-fetch) is itself decay-qualifying. **No action.** |
| 10 | 409 recovery | Sound, complete — current canonical state returned in the same response. **No action.** |
| 11 | **Truly simultaneous (not sequential) concurrent writes** | Investigated directly. The primary correctness guarantee is the atomic, version-guarded SQL statement itself: `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = ?` performs the compare-and-mutate in one database statement, so whichever request's write actually lands first, the second one's `WHERE` clause no longer matches and it correctly affects zero rows — this holds regardless of what runtime is driving the requests. The current deployment adds a second, reinforcing layer on top of that: `node:sqlite` is fully synchronous and there is no `await` between the version read and the guarded `UPDATE` in `reportStatus()`, so Node's single-threaded event loop cannot interleave two requests' JS around that statement either. Sequential and "simultaneous" requests behave identically here, and a new same-row concurrent-write test would have relatively low marginal value today — but the reason writes are safe is the SQL-level guard, not the event loop; the event loop's synchronicity is a secondary property of today's single-process runtime, not the fundamental concurrency-control mechanism. **No action — worth stating explicitly since it's a common unwarranted worry.** |
| 12 | Lazy decay racing a user write | Sound — the guarded `UPDATE ... WHERE status = 'in-use'` is a no-op if a user's write already landed first. **No action.** |
| 13 | Server shutdown while SSE connections are open (SIGTERM during deploy) | No graceful-shutdown handling anywhere (app or `@astrojs/node` itself) — connections are hard-killed, clients auto-reconnect via the same path already verified for crashes. No data loss possible (writes are already committed before broadcast). **No action — the existing reconnect design already absorbs this.** |

---

## Performance

All measurements below are **local, this machine, single-run, no load** —
not benchmarks, not production-scale claims.

1. **`pnpm build` output**: `dist/client` totals 4.0MB. Largest chunk:
   `scene.*.js` at **637,337 bytes** — all seven facilities' Three.js
   scene code in one bundle, exceeding Vite's 500KB size-warning
   threshold. `index.*.css` is 21,566 bytes; the separate
   `portfolio.*.css` is 8,388 bytes (confirmed fully isolated from the
   main app).
2. **No code-splitting by facility tab** — confirmed via grep, all 14
   facility script blocks use static imports from `scene.ts`, zero
   dynamic `import()` anywhere. The 637KB chunk loads on every visit
   regardless of which tab a visitor opens. One shared `WebGLRenderer`
   means the Three.js *runtime* instantiates once; the *code* for all
   seven scenes still ships upfront either way.
3. **Local server timing** (throwaway DB, no load): `GET /` (full page,
   all 7 facilities embedded) — 42ms, 58,931 bytes. `GET
   /api/machines/ab-washer` — 4ms, 139 bytes. `GET /api/rat-room/A` —
   3ms, 104 bytes. `GET /api/aa-room` — 3ms, 87 bytes.
4. **Initial page load makes zero additional client GET requests** — all
   facility state is embedded server-side at render time.
5. **SSE reconnect fires 25 individual GET requests in parallel**: 10 for
   Laundry's machines, 10 for Rat Room's seats (no batch "all seats"
   endpoint exists), 1 each for the five single-row rooms. Each
   completes in single-digit milliseconds locally.
6. **`listMachines()`/`listRatRoomSeats()` are single queries**, not N+1
   — confirmed directly from source, not assumed.
7. **Lazy decay's conditional `UPDATE` vs. a plain `SELECT`**: negligible
   difference at measured local timings; not a performance concern at
   this scale.
8. **Portfolio assets (3.2MB `public/portfolio`, 3.7MB
   `docs/portfolio`) are referenced only by `portfolio.astro`** —
   confirmed via grep, zero references in `index.astro`, which uses its
   own separate `public/favicon.svg`. Fully isolated; no portfolio
   weight loads on the main app.

**Classifications:**
- No facility-tab code-splitting of the 637KB scene bundle — **P2**,
  low impact today (one-time load), would matter more if facility count
  or scene complexity grows substantially.
- No batch "all seats"/"all machines" reconnect endpoint — **P2 at
  most, arguably No-action** given measured per-request cost is trivial
  and all 25 requests fire in parallel.
- Lazy decay's write-path overhead — **No action**, not worth optimizing
  against measured timings.
- Portfolio/app asset isolation — **No action**, already correctly
  separated.

---

## Maintainability

1. **The four single-row occupancy rooms (`otter-room.ts`,
   `rabbit-room.ts`, `weasel-room.ts`, `badger-room.ts`) are ~90%
   structurally identical** — same row interface shape, same
   `seed*IfEmpty`/`decayed*Room`/`to*State`/`get*Room`/`report*Status`
   functions, differing only in the room id string, the two exported
   constant names, and the broadcast `kind`. The 4-hour ceiling's
   *value* is identical across all four — but each is independently
   confirmed per-room by its own ADR (0004–0007, Decision 2) as a real,
   separately-verified community fact, not inherited from the others. A
   shared factory could plausibly collapse ~150 of each file's ~200
   lines, **but this is exactly the "genericize for its own sake"
   pattern CLAUDE.md warns against** unless the factory still takes each
   room's own constant and ADR-citing comment as an explicit parameter,
   never hard-coding the shared value once. **No action now** — no bug
   history here (unlike the pure/DB-wrapper split, which exists because
   of a real incident); worth doing only if an eighth single-row room is
   ever added. **Future-scale.**
2. **`src/lib/log.ts`'s six duplicated `format*ReportOutcome`/
   `format*ReportRejected` pairs** (lines 81–354) are byte-identical in
   shape, differing only in the `facility` string literal — zero
   semantic distinction is at stake here, unlike the room logic above.
   Smallest fix: one `formatRoomReportOutcome(facility, params)` taking
   `facility` as a parameter, replacing ~140 of the 354 lines; keep
   machines'/Rat Room's own formatters separate since they carry an
   extra id/seat field. **P2** — low risk, `log.test.ts` checks line
   shape, not which function produced it.
3. **`src/pages/index.astro` at 4,601 lines** is a real onboarding-cost
   concern — markup and client script for all 7 facility panels in one
   file. Smallest sensible slice: extract each facility's panel markup
   into its own Astro component (pure template extraction, no behavior
   change) without touching the shared-EventSource/`mountedScenes`
   client architecture. **P1** — not urgent (no bug traced to this
   size), but genuine for year-long maintainability.
4. **Historical "Crit N"/"Stage N"/"ADR NNNN" narration in comments** —
   present throughout (`realtime.ts:17`, `aa-room-db.ts:9`,
   `schema.sql:202`) but each carries real technical content (import-
   cycle reasoning, schema invariants) beyond the course-stage framing.
   **P2/No-action** — polish, not a defect; stripping the course-specific
   labels while keeping the reasoning would help a future non-course
   maintainer, but nothing here is actually wrong.
5. **`docs/portfolio/` vs `public/portfolio/` — intentional split, not a
   drift hazard.** Confirmed via `scripts/portfolio/` and the Pages
   workflow: `public/portfolio/` is Astro's actual build input for both
   targets; `docs/portfolio/` holds Markdown plus its own copies of some
   binaries for GitHub's own in-repo rendering. Different consumers, not
   duplicated source of truth. **No action** — worth one documentation
   line noting nothing keeps them in sync automatically, not a
   structural fix.

---

## Observability

Current baseline: `src/lib/log.ts` deliberately logs only
`session_created` and PATCH outcomes (ok/conflict/rejected), one line to
stdout per event, pseudonym-only (never a raw token/hash/internal id).
No ordinary-GET logging, no SSE connect/disconnect logging, no request
correlation id, no startup/shutdown logging beyond whatever Node/Astro
print by default.

| Signal | Usefulness | Reasoning |
|---|---|---|
| **Request rate / error (500) rate** | **Useful now** | Genuinely missing — a silent total failure (an uncaught exception) is currently invisible unless someone is watching `flyctl logs` at the exact moment. This is the one gap current logging structurally cannot surface. |
| 409 conflict rate | Already available, informally | `grep result=conflict` over `flyctl logs` gives this today with zero new code — useful as a manual check, not worth a dashboard until volume makes manual reading impractical. |
| Decay-trigger count | Probably unnecessary | Decay firing is expected, routine behavior, not a signal of a problem. |
| Active SSE connection count | Only if usage grows | Matters once the connection-exhaustion scenario above becomes plausible. |
| DB write failures | Covered by the request/error-rate gap above | Would surface as an uncaught 500 once that signal exists; no separate instrumentation needed beyond it. |
| Reconnect rate | Only if usage grows | Reconnects are expected/benign on a scale-to-zero single machine (a machine restart causes exactly this); low value today. |

---

## Test gaps

1. **Simultaneous (not sequential) concurrent writes** — `concurrency.
   test.ts` only awaits one request before sending the next;
   `rat-room.test.ts`'s `Promise.all` test covers two *different* seats
   (independence), not real interleaving on one row. Given the
   reliability section's confirmed finding (synchronous SQLite + no
   `await` between check and write makes real interleaving provably
   impossible today), **adding this test would assert a condition the
   runtime already guarantees — not worth it.** **No action** (Future-
   scale note only, relevant if the app ever goes multi-process).
2. **DB mutation → SSE broadcast relationship** — well covered.
   `realtime.test.ts` opens a real SSE connection, triggers a real PATCH,
   and asserts the actual wire event matches the write, including a
   decay-triggered case. **No action.**
3. **EventSource reconnect** — a real, if modest, gap. No automated test
   exercises reconnect; only the manually-verified Fly-restart account
   exists (ADR 0008). `realtime.test.ts` already reads the raw SSE
   stream manually (not via the browser `EventSource` global), so
   testing a mid-stream disconnect-and-reconnect, asserting the new
   connection's re-fetch path, is plausible without new infrastructure.
   **P1** — moderate value (catches a regression in `stream.ts`'s
   abort/cleanup path), moderate cost; the one explicitly-only-manually-
   verified behavior in the real-time story.
4. **Rat Room's per-seat independent versioning** — well covered.
   `rat-room-decay.test.ts` and `rat-room.test.ts` directly assert
   cross-seat version/state independence at both the store and HTTP
   level. **No action — a model case, not a gap.**
5. **Persistence across an actual process restart** — the single
   highest-value gap found. `persistence.test.ts` only checks that a
   value written by one request is readable by a later request against
   the *same running process*; it never restarts the server or reopens
   the SQLite file from a cold process. This doesn't test what Crit 8
   actually grades ("survives a restart or redeploy") — today that's
   proven only by manual deploy verification, not CI. A test that
   kills/respawns the built Docker container (or reopens a fresh
   `DatabaseSync` against the same file path) between write and read
   would directly validate the literal persisted-on-disk guarantee.
   **P1 — worth adding; tests the exact thing this deployment is graded
   on.**
6. **Accessibility / mobile reachability** — no automated check, by
   deliberate design (left to human visual review since "looks right on
   a phone" isn't test-assertable). **No action — correctly a process
   decision, not an oversight.**
7. **Deployment configuration** — no test directly asserts `fly.toml`/
   Dockerfile contents; `checks.yml` building and running the real image
   indirectly proves it boots and serves, but a config regression (e.g.
   accidentally removing the volume mount) wouldn't necessarily be
   caught without gap #5 also being closed. **P2 — low priority
   without #5 first.**

---

## Dependencies

`pnpm audit`: 18 advisories (7 high, 10 moderate, 1 low), zero critical.
All trace to `vite`, `@vitest/mocker`, `source-map-js`, `undici`, `zod` —
transitive dependencies of `astro`/`vitest`/`jsdom`, not anything the
app's own code imports directly.

Confirmed via the built `dist/server/entry.mjs`'s actual import graph:
`vite`, `undici`, and `source-map-js` are **not reachable at runtime** —
they exist in the image only because the Dockerfile copies the full
`node_modules`. `zod` **is** reachable (Astro's own internal dependency,
not the app's). None of these are called by this app's own source.

**The real finding is the Dockerfile, not the advisories themselves**:
`RUN pnpm install --frozen-lockfile` installs all dependencies including
devDependencies, and `COPY --from=build /app/node_modules
./node_modules` copies the complete 241MB tree into the final image —
contradicting the file's own comment ("a slim image carrying only the
built output and prod deps"). **P1** — fix is a `pnpm install
--prod --frozen-lockfile` in a step that doesn't need devDependencies, or
pruning `node_modules` before the final `COPY`. This reduces image size
and nominal audit surface; it is not an active exploit path today since
none of the flagged packages are invoked by the app itself (`zod`
excepted, and `zod`'s flagged advisory — oversized constrained
collections — isn't reachable without the app itself calling into it).

Outdated-but-current packages (`pnpm outdated`): `@astrojs/node`
11.1.6→11.1.11, `astro` 7.3.5→7.4.7, `marked` 18.0.14→18.1.3, `vitest`
5.0.1→5.1.0, `three` 0.186.1→0.187.0, `typescript` 6.0.3→7.0.2 (major),
`jsdom` 30.1.0→31.0.0 (major). None flagged as urgent — these are normal
minor/patch drift, with the two major-version bumps (`typescript`,
`jsdom`) being dev-only and worth a deliberate, tested upgrade pass
rather than a blind bump. **P2** — routine maintenance, not urgent;
**do not auto-upgrade** per audit instructions.

---

## Prioritised findings

### P0 — none found

### P1 — high-value engineering improvements

1. **Production Docker image ships full `node_modules` including
   devDependencies and their vulnerable transitive deps.**
   Evidence: `Dockerfile:19-20`, confirmed via `pnpm audit` + runtime
   import-graph check. Impact: image bloat, nominal (not actual) audit
   surface, contradicts the file's own stated intent.
   Smallest fix: `pnpm install --prod --frozen-lockfile` in the final
   stage, or prune before copy. Files: `Dockerfile`. Risk: low — must
   verify the production entry point needs nothing from
   devDependencies (it doesn't; confirmed no runtime import of
   vitest/jsdom/typescript). Effort: **S**. → **Implement now.**

2. **`sessions` table has no TTL/cleanup — unbounded growth from
   anonymous repeat visits.**
   Evidence: `db/schema.sql:50-55`, confirmed by grep (zero hits for
   cleanup/expire/TTL logic anywhere). Impact: disk growth over a year
   of operation; not a lookup-latency problem (UNIQUE index keeps
   lookups fast), purely a storage-hygiene gap.
   Smallest fix: a periodic cleanup of sessions with no corresponding
   `reporter_id` reference past some age, or a simple age-based
   `DELETE FROM sessions WHERE created_at < ?` run opportunistically at
   startup. Files: `src/lib/sessions.ts`, `src/lib/db.ts`. Risk: low —
   must not delete a session whose cookie a browser still holds and
   intends to keep using (design the cutoff generously, e.g. well past
   the 1-year cookie `Max-Age`). Effort: **M**. → **Turn into a GitHub
   Issue** (not urgent for current traffic, but a real correctness-of-
   operations gap worth tracking).

3. **`broadcast()` has no per-subscriber error isolation.**
   Evidence: `src/lib/realtime.ts:64-66`. Each open SSE connection
   installs its own callback via `subscribe()` (`stream.ts:48`), so
   multiple concurrently-open browser sessions already mean multiple
   live entries in the subscriber `Set` — not a one-subscriber system.
   The SSE callback already catches `controller.enqueue()` failures
   internally, which is why an ordinary disconnected-client error is
   already contained. But `broadcast()`'s own `for` loop has no
   try/catch around each individual subscriber call, so an unexpected
   exception thrown by any one subscriber — current or future — would
   propagate back through a mutation that has already committed,
   turning a successful DB write into an apparent request failure and
   potentially skipping notification of later subscribers in the loop.
   Smallest fix: wrap each subscriber call in its own try/catch inside
   the loop. Files: `src/lib/realtime.ts`. Risk: negligible. Effort:
   **S**. → **Implement now** (trivial, removes a real landmine
   regardless of current subscriber count).

4. **No startup-time error handling for a corrupted/inaccessible SQLite
   file.**
   Evidence: `src/lib/db.ts:45-46`, confirmed no try/catch anywhere in
   the file. Impact: an unrecoverable startup crash with no
   distinguishing log message, crash-looping on Fly until manually
   investigated.
   Smallest fix: wrap the `new DatabaseSync(dbPath)` + initial
   `db.exec(schema)` in a try/catch that logs a clear "database file
   corrupt or inaccessible" message before re-throwing (still fails to
   boot — this is about diagnosis speed, not auto-repair). Files:
   `src/lib/db.ts`. Risk: low. Effort: **S**. → **Implement now.**

5. **`src/pages/index.astro` at 4,601 lines.**
   Evidence: line count, confirmed single-file structure for all 7
   facility panels. Impact: real onboarding/maintenance cost for a
   future maintainer, no current bug traced to it.
   Smallest fix: extract each facility's panel markup into its own
   Astro component — pure template extraction, no behavior change,
   doesn't touch the shared-EventSource/`mountedScenes` client
   architecture. Files: `src/pages/index.astro` (split), new files per
   facility. Risk: moderate — must verify no behavior regression across
   all 7 facilities' live-update wiring after extraction; needs the
   full spec suite green plus a manual smoke pass. Effort: **L**. →
   **Turn into a GitHub Issue** (valuable, not urgent, real risk of
   introducing a subtle regression if rushed).

6. **`persistence.test.ts` doesn't test an actual process/container
   restart.**
   Evidence: `spec/persistence.test.ts` (confirmed: same-process-only
   coverage). Impact: the literal "survives a restart or redeploy"
   claim this deployment is graded on is proven only by manual
   deploy-time verification, not CI.
   Smallest fix: a test that stops and restarts the built Docker
   container (or reopens a fresh `DatabaseSync` against the same file
   path in-process) between a write and a read. Files:
   `spec/persistence.test.ts`, possibly `.github/workflows/checks.yml`
   if container-level restart is chosen. Risk: low-moderate — a
   container-restart test adds CI time and complexity; an in-process
   fresh-connection test is cheaper but slightly weaker evidence.
   Effort: **M**. → **Turn into a GitHub Issue.**

7. **EventSource reconnect has no automated test.**
   Evidence: `realtime.test.ts` (manual stream reading, no disconnect/
   reconnect scenario); only manual Fly-restart verification exists
   (ADR 0008). Impact: the one explicitly-only-manually-verified
   behavior in the real-time story.
   Smallest fix: extend `realtime.test.ts` to close the response stream
   mid-test and assert a new connection's re-fetch path fires
   correctly. Files: `spec/realtime.test.ts`. Risk: low. Effort: **M**.
   → **Turn into a GitHub Issue.**

### P2 — worthwhile polish

8. `src/lib/log.ts`'s six duplicated format-function pairs → collapse to
   one parameterized formatter. Files: `src/lib/log.ts`. Effort: **S**.
   → Documentation only / low-priority issue.
9. No defensive catch around DB writes at the API boundary (currently
   unreachable via validated input, but not structurally guarded).
   Files: all `src/pages/api/**/*.ts`. Effort: **M**. → Documentation
   only for now.
10. No basic security headers (`X-Content-Type-Options`, a basic CSP).
    Files: likely a small Astro middleware. Effort: **S**. →
    Documentation only.
11. Routine dependency bumps (`@astrojs/node`, `astro`, `marked`,
    `vitest`, `three` — all minor/patch). Effort: **S**. → Documentation
    only; do when convenient, not urgent.
12. No batch "all seats"/"all machines" endpoint for SSE reconnect (25
    individual parallel requests, each cheap). Effort: **M**. →
    Documentation only; revisit only if reconnect frequency or resource
    count grows substantially.
13. No code-splitting of the 637KB Three.js scene bundle by facility
    tab. Effort: **L**. → Documentation only; revisit only if facility
    count/scene complexity grows substantially.

### Future-scale

- Migrating to Postgres (SQLite's single-writer model isn't a current
  bottleneck; would only matter past one app instance).
- Introducing Redis pub/sub for SSE broadcast (only needed past one
  process/instance).
- A shared factory for the four single-row occupancy rooms (worth doing
  only if an eighth similar room is ever added).
- Rate limiting on report/session-creation endpoints (negligible cost at
  current community scale).
- SSE connection capping (immaterial at realistic tab counts today).
- Observability dashboard/metrics pipeline (structured logs + manual
  grep suffice at current scale; build this when usage volume makes
  manual log-reading impractical).

### No-action decisions

1. **Migrating to Postgres today** — investigated: SQLite's single-
   writer model has never been a real bottleneck (writes are individual
   residents, not a high-frequency stream); the deployment constraint
   (one machine, one process, no separate DB server) is still true.
2. **Introducing Redis today** — investigated: the in-process SSE
   subscriber `Set` is correct specifically because there's exactly one
   process; adding Redis before there's a second instance would be
   solving a problem that doesn't exist yet.
3. **Replacing SSE with WebSockets** — investigated: the client never
   needs to send anything over the real-time channel; WebSockets'
   two-way channel would be unused complexity.
4. **Genericizing the four single-row rooms into one base class/table
   right now** — investigated directly, code compared line-by-line:
   each room's 4-hour ceiling is an independently re-confirmed fact per
   its own ADR, not inherited; collapsing now risks exactly the
   "simplify away a real semantic distinction" failure CLAUDE.md warns
   against. Revisit only if an eighth similar room is added.
5. **Adding a durable event-replay log for SSE** — investigated: a
   (re)connecting client already re-fetches canonical state, which is
   strictly sufficient since there's no append-only history to recover
   — building a replay log would add real complexity for a guarantee
   (not missing any intermediate event) this app has never needed.
6. **Adding Kubernetes/container orchestration** — investigated: the
   entire deployment is one Fly machine by design (256MB, scale-to-
   zero); orchestration solves a multi-instance problem this app
   doesn't have and wouldn't reduce this app's own operational burden.
7. **Adding background/timer-based decay jobs** — investigated: lazy,
   read-triggered decay is deliberate (CLAUDE.md, ADR 0001) specifically
   to avoid a second code path that could drift from the read path; a
   background job would add complexity for no behavioral gain.
8. **Testing truly-simultaneous (same-instant) concurrent writes** —
   investigated directly: the atomic, version-guarded `UPDATE ... WHERE
   id = ? AND version = ?` is what actually prevents a lost update,
   regardless of request ordering or runtime — the current
   single-process, synchronous `node:sqlite` runtime (no `await`
   between version-check and write) only adds a second, reinforcing
   layer by ruling out JS-level interleaving on top of that. A
   dedicated same-row "simultaneous requests" test would mostly
   re-assert a guarantee the SQL statement already provides by
   construction, so it has relatively low marginal value today.
9. **Hardening against malformed-row data from direct DB tampering** —
   investigated: the only path to a CHECK-violating row is bypassing
   the app's own write paths entirely (manual DB edits), which is
   outside this app's realistic threat model for a hobby-scale
   residential tool.
10. **Rate-limiting report/session endpoints today** — investigated:
    current abuse-surface cost (SQLite write cost, broadcast cost) is
    negligible at realistic community scale; premature at current
    traffic.

---

## Proposed backlog

| # | Title | Category | Effort | Disposition |
|---|---|---|---|---|
| 1 | Prune devDependencies from the production Docker image | P1 | S | Implement now |
| 2 | Add per-subscriber error isolation in `broadcast()` | P1 | S | Implement now |
| 3 | Add startup error handling for a corrupted/inaccessible DB file | P1 | S | Implement now |
| 4 | Add session-table cleanup/expiry | P1 | M | GitHub Issue |
| 5 | Add a real process-restart persistence test | P1 | M | GitHub Issue |
| 6 | Add an automated EventSource reconnect test | P1 | M | GitHub Issue |
| 7 | Split `index.astro` into per-facility components | P1 | L | GitHub Issue |
| 8 | Collapse `log.ts`'s 6 duplicated formatter pairs | P2 | S | Documentation only |
| 9 | Add defensive catch around DB writes at API boundary | P2 | M | Documentation only |
| 10 | Add basic security headers | P2 | S | Documentation only |
| 11 | Routine dependency bumps (astro, vitest, three, marked) | P2 | S | Documentation only |

---

## Interview-ready discussion points

The five findings/no-action decisions most useful for an interview
conversation, and why:

1. **"The Dockerfile ships the full dev toolchain into production."**
   Good for "what technical debt exists?" — it's a real, concrete,
   self-found issue with a one-line fix, and explaining *why* it
   happened (the comment claims prod-only, the actual command doesn't
   enforce that) shows the ability to catch a gap between stated intent
   and actual behavior.

2. **"Concurrent writes are safe because of the SQL statement, not the
   runtime."** Good for "how would this evolve at scale?" or a
   concurrency deep-dive — the real guarantee is the atomic
   version-guarded `UPDATE ... WHERE id = ? AND version = ?`, which
   holds regardless of request ordering; today's single-threaded,
   synchronous `node:sqlite` runtime only adds a second, reinforcing
   layer on top of that. Being able to name which layer is actually
   load-bearing (and which is incidental to the current deployment)
   demonstrates real reasoning about concurrency control, not
   pattern-matching "concurrency = needs a mutex."

3. **"The four single-row rooms look duplicated but aren't — and I
   decided not to fix that."** Good for "what did you deliberately
   choose not to build?" — shows restraint against premature
   abstraction, backed by a concrete, re-derivable reason (each room's
   4-hour figure is independently confirmed, not inherited) rather than
   just asserting "duplication is sometimes fine."

4. **"Session rows grow forever — a real gap I found, not a designed
   trade-off."** Good for "what technical debt exists?" — distinguishes
   a genuine oversight from a deliberate scope decision, and shows the
   discipline to say "this wasn't decided, it's just missing" rather
   than retroactively justifying every gap as intentional.

5. **"`persistence.test.ts` doesn't actually test what Crit 8 grades."**
   Good for "what would you improve next?" — a sharp, specific
   observation that a test's name and its actual guarantee have quietly
   drifted apart, and a concrete, buildable next step (restart the
   container, not just reuse the connection).

---

## Final report

1. **P0 count:** 0
2. **P1 count:** 7
3. **P2 count:** 6
4. **Future-scale count:** 6
5. **No-action decisions:** 10
6. **Top 5 recommended next actions:** (1) prune devDependencies from
   the production Docker image, (2) add per-subscriber error isolation
   in `broadcast()`, (3) add startup error handling for a corrupted DB
   file, (4) add session-table cleanup, (5) add a real process-restart
   persistence test.
7. **Measurements performed:** `pnpm audit` (18 advisories, severity
   breakdown, reachability-in-runtime check against the built
   `entry.mjs`); `pnpm outdated`; production build output sizes (`du`,
   chunk listing); local server timing via `curl` for 4 representative
   routes; reconnect request-count derivation from `live-stream.ts`'s
   registered listeners; `diff -rq` between `public/portfolio` and
   `docs/portfolio`; direct local reproduction of a SQLite CHECK-
   constraint error in an isolated throwaway directory (not the app's
   real DB).
8. **Files/areas reviewed:** `src/lib/db.ts`, `sessions.ts`,
   `request-protocol.ts`, `realtime.ts`, `validation.ts`, `log.ts`,
   `aa-room.ts`/`aa-room-db.ts` (and the five sibling room modules),
   `types.ts`; `src/pages/api/machines/[id].ts`,
   `src/pages/api/aa-room.ts`, `src/pages/api/rat-room/[seat].ts`,
   `src/pages/api/stream.ts`; `src/lib/live-stream.ts`; `src/pages/
   index.astro` (structure, not full 4,601 lines); `db/schema.sql`;
   `Dockerfile`; `fly.toml`; `astro.config.ts`; `.github/workflows/
   checks.yml` and `portfolio-pages.yml`; `notes/adr/0001`–`0002`; all
   22 `spec/*.test.ts` files (by name/line-count; several read in full
   by the research forks); `package.json`/`pnpm audit`/`pnpm outdated`
   output.
9. **Anything not verifiable:** true production-scale load behavior
   (explicitly out of scope — never pointed at the live Fly app or
   GitHub Pages site); `EventSource`'s exact backoff behavior under an
   extended real-world outage (standard spec behavior, not independently
   re-verified via a live kill-and-observe experiment in this pass);
   whether Astro's exact default 500 response body differs between
   versions beyond what was directly confirmed in the currently-built
   `entry.mjs`.
10. **Final audit file path and word count:** `docs/portfolio/
    engineering-audit.md`, approximately 5,700 words.
