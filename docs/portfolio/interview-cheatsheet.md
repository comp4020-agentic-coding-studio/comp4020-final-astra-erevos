# Toad Live — Interview Cheat Sheet

Quick-reference only. Full reasoning, follow-ups, and evidence live in
`docs/portfolio/interview-pack.md` — this is what to skim 10–15 minutes
before walking in.

---

## 1. 30-second project pitch

"Toad Live is a status board for a shared student residence — whether a
washer's free, or a study room's in use, based on what residents report,
not sensors. The interesting problem isn't the CRUD part, it's that the
information is always a little stale, and more than one person can report
the same resource at once. So the real work went into making that
honest: real-time updates over server-sent events, optimistic concurrency
so two people can't silently overwrite each other, and a decay rule so an
old report eventually says 'unknown' instead of lying forever."

---

## 2. Ten answers I need to know cold

**1. Hardest bug — the SQLite lock race**
*Q: "Tell me about a difficult bug you diagnosed."*
A docs-only commit failed CI seven times straight, always `database is
locked`, a different test file each time. A decay spec file imported a
room module just to reuse its pure logic — but that module had an eager,
top-level import of the real database, so importing it for logic silently
opened a second live SQLite connection that raced the app's own. Fix:
split every room module into a pure half (no DB import, `store`/`now` as
parameters) and a thin wrapper that's the only place allowed to import the
real database. Zero lock errors since, verified across 15 full runs.
**Anchor:** commit `91167bd` — "test: isolate decay specs from shared SQLite"; `aa-room.ts` vs `aa-room-db.ts`.

**2. Why SSE, not WebSockets or polling**
*Q: "Why did you use SSE instead of WebSockets or polling?"*
The client only ever reads live updates — writes already go through an
ordinary PATCH — so I never needed WebSockets' two-way channel. Polling
was the real alternative, and I rejected it because the app runs on one
Fly machine that scales to zero when idle; constant polling fights that
economics. SSE gives one-directional push over plain HTTP. Not free —
it holds an open connection — but the comparison was request volume,
not zero cost.
**Anchor:** `src/lib/realtime.ts`'s in-process `Set`; ADR 0001, Decision 1.

**3. Concurrency — version + ifVersion + 409**
*Q: "How do you stop two users overwriting each other?"*
Every mutable resource carries a server-owned `version`, incremented on
every write. A client sends back the version it last saw as `ifVersion`;
the server only applies the write if that still matches — one guarded
SQL `UPDATE ... WHERE id = ? AND version = ?`. A mismatch returns 409
with the actual current state, not just an error. The server's own lazy
decay transition goes through the same guard, so a stale report can't
silently resurrect a status decay already invalidated.
**Anchor:** `src/pages/api/machines/[id].ts` — the PATCH handler and its 409 branch.

**4. Lazy decay**
*Q: "How do you handle stale human-reported information?"*
Staleness is never checked on a timer — only the moment someone reads the
resource. `decayed()`'s first line is `if (row.status !== "in-use") return
row`, which is also why out-of-order and available never decay at all.
Timed reports decay exactly at their expected-end time; untimed in-use
reports fall back to a fixed, explicitly-provisional twelve-hour window.
Decay itself is a real write — it bumps `version` and broadcasts, same as
a resident's own report.
**Anchor:** `UNTIMED_IN_USE_DECAY_MS` in `src/lib/db.ts`, comment marks it provisional.

**5. Rat Room — per-seat modelling**
*Q: "Tell me about a modelling decision you changed."*
Rat Room is a ten-seat computer lab; one room-level flag would've
collapsed "one seat taken" and "room full" into the same "occupied"
value. I modeled it as ten independently-reportable seats instead — same
shape as laundry's machines — each with its own occupancy, confirmation
time, and version. The room-level summary is derived fresh from the ten
seats on every read, never stored, to avoid a drift/authority problem. I
later reversed an earlier call to keep occupied-seat figures decorative
and unmapped — after seeing it rendered, I mapped each seat to its own
fixed workstation instead.
**Anchor:** `summarizeRatRoomSeats()`; ADR 0008, Decision 1/4 and "Design correction, v3."

**6. Why SQLite, not Postgres**
*Q: "Why SQLite rather than PostgreSQL?"*
The deployment shape came first — one Fly machine, one volume, no
separate database server — and SQLite via `node:sqlite` fits that: no
network hop, one file that survives a restart. Not a claim SQLite is
faster than Postgres — a claim it fits this constraint. I'd migrate the
moment either changed: more than one app instance, or write volume
actually exceeding one writer — neither has happened.
**Anchor:** `fly.toml` — one `shared-cpu-1x` machine, one volume at `/data`.

**7. Why Astro**
*Q: "Why Astro?"*
Most of the app is server-rendered pages and a few API routes — only the
3D views need real client-side code. Astro's server mode with the Node
standalone adapter compiles to a single process matching exactly what Fly
and the Dockerfile expect. One shared `WebGLRenderer` drives all seven
live 3D scenes, and Astro doesn't force every page to carry that weight.
For a project that's mostly a rich single-page client, I'd lean toward
React or Next.js instead.
**Anchor:** `astro.config.ts` — `output: "server"`, `@astrojs/node` standalone adapter.

**8. Testing strategy**
*Q: "How did you test a real-time multi-user system?"*
264 tests across 22 spec files, three real categories. Behavior and
concurrency tests run as real HTTP requests against the actual production
Docker image in CI — not mocks. Each room's own decay test builds a real
in-memory SQLite database and calls the decay functions directly with a
constructed clock, bypassing HTTP so timing isn't a gamble. A smaller
group — freshness math, Rat Room's summary, request-protocol — are pure
function tests with no database at all.
**Anchor:** `.github/workflows/checks.yml` — `docker build`/`run --tmpfs /data`, then `pnpm check` over HTTP.

**9. Claude Code / agentic workflow**
*Q: "How did you use Claude Code / AI agents?"*
I made the architecture decisions myself, in writing, before any code
existed — each facility's state model was frozen in an ADR first (Laundry
is the one exception; it predates that practice). Implementation was
staged — backend, then a practical panel, then the 3D view, each reviewed
and committed on its own — so a wrong decision is cheapest to catch early,
not after the 3D work exists. CLAUDE.md and the ADRs are a harness the
agent works inside, and `spec/` is the enforced gate. I caught things that
were correct by every written rule but still visually wrong, like Rat
Room's figures-in-open-floor case.
**Anchor:** `PROCESS.md` — "Agent workflow: why so staged"; ADR 0008's figure-placement reversal.

**10. Scaling beyond one machine**
*Q: "What would change at 10,000 concurrent users?"*
A lot — built for one bounded community on one machine, not that scale.
The in-process SSE subscriber `Set` only works because there's exactly
one Node process; past one instance, a broadcast from instance A never
reaches a client on instance B, so I'd need a shared pub/sub layer like
Redis. SQLite's single-writer model is the other constraint — I'd move
to Postgres once write volume or instance count actually required
concurrent writers. No benchmark exists; it's reasoned from architecture,
not measured.
**Anchor:** `src/lib/realtime.ts` comment — correct only because it's one process, no second instance to reconcile.

---

## 3. Four STAR stories — memory prompts only

**Story 1 — SQLite lock race**
- Situation: docs-only commit failed CI 7x, same `database is locked` error, different file each time
- Action: traced it to an eager top-level DB import in a room module reused for pure logic; split into a pure module (`store`/`now` params) and a thin DB wrapper
- Result: zero lock errors since, verified across 15 repeated runs; same split reused for every facility added afterward

**Story 2 — Rat Room modelling change**
- Situation: ten-seat lab, natural instinct was one room-level occupancy flag like the other rooms
- Action: modeled it as ten independent seats instead (like laundry's machines); summary computed fresh on read, never stored
- Result: room can now say "six seats free, two unknown" — impossible with one flag, no drift risk since there's no second stored summary

**Story 3 — human visual review catch**
- Situation: Rat Room's first 3D build followed the written rule exactly — occupied figures decorative, unmapped, in open floor space
- Action: reviewed the actual rendered screenshots, judged it looked wrong for a computer lab even though nothing was technically false; reversed the rule
- Result: built a fixed seat-to-workstation map; recorded as a deliberate design correction, not a bug fix

**Story 4 — stale-server / missing-CSS investigation**
- Situation: right after a small CSS fix, review reported the whole site looking unstyled — looked like a big regression
- Action: instead of reverting on suspicion, ran a fresh dev server, fresh prod build, and an isolated test with the CSS reverted — all three rendered fine
- Result: real cause was a leftover local server process serving an old build referencing a stale CSS filename hash; restarted it, confirmed the CSS change was safe

---

## 4. If they ask me to show code

1. **`src/lib/realtime.ts`** (66 lines) — the whole real-time story in one small file: the in-process `Set`, `subscribe()`/`broadcast()`, and the comment admitting it's correct only because there's one process.
2. **`src/pages/api/machines/[id].ts`** — shows concurrency and identity together: session resolved before the body is parsed, `ifVersion` required and validated, 409 returns the current canonical state.
3. **`src/lib/db.ts`, lines 91–154** — `decayed()`'s `if (row.status !== "in-use") return row`, plus the explicit "this number is provisional" comment, both in one place.
4. **`src/lib/aa-room.ts` vs `src/lib/aa-room-db.ts`** — the lock-race fix itself: one has no `db.ts` import at all, the other is the only file that does.
5. **`.github/workflows/checks.yml`** (lines ~33–42) — proves tests run against the real built Docker image over HTTP, not mocks.

---

## 5. Facts I must not say wrong

- 7 facilities
- 10 laundry machines
- 10 Rat Room seats
- 264 tests across 22 spec files
- 8 ADRs total — 2 cross-cutting (real-time/concurrency, identity) + 6 facility-specific (AA Room through Rat Room); Laundry predates the ADR practice
- SSE is one-way push, not "free"
- Reconnect uses `EventSource` + `onOpen()` canonical re-fetch — no page reload
- Lazy decay — no background timer, ever
- Current deployment: one Fly machine, one SQLite volume, one Node process
- No measured 10,000-user benchmark exists
- Rat Room's room-level summary is derived on read, never persisted
- Per-room decay tests are not all HTTP integration tests — six of them use an in-memory SQLite database with a constructed clock instead

---

## 6. Dangerous interviewer traps

- **Do not say:** "SQLite is faster than Postgres." **Say instead:** it's a constraint-driven fit for one machine and one process, not a performance claim.
- **Do not say:** "SSE has zero overhead." **Say instead:** it avoids polling's wasted request volume against a scale-to-zero machine — it still holds an open connection.
- **Do not say:** "AI designed the architecture." **Say instead:** I made the decisions, in ADRs, before any code existed; the agent implemented them.
- **Do not say:** "264 tests means fully tested." **Say instead:** three different categories test different things — real HTTP, in-memory SQLite with a constructed clock, and pure functions.
- **Do not say:** "A database transaction alone solves lost updates." **Say instead:** the actual mechanism is a version-guarded conditional `UPDATE`, not transaction isolation.
- **Do not say:** "This architecture supports 10,000 users." **Say instead:** no load test exists; scaling claims are reasoned from the architecture, not measured.
- **Do not say:** "Twelve hours is the right number for untimed decay." **Say instead:** it's an explicitly provisional placeholder, not based on real cycle-time data.
- **Do not say:** "I reverted the CSS since the site looked broken." **Say instead:** I ran fresh builds to isolate the real cause — a stale server process, not the CSS change.

---

## 7. Last-minute mental model

```
Source of truth   → SQLite
Live transport    → SSE
Conflict control  → version + 409
Freshness         → lazy read-triggered decay
Agent workflow    → ADR → implementation stage → human review → tests → production verification
```
