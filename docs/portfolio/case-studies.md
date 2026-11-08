# Case studies

Three engineering problems from building Toad Live, in more depth than fits in [`PORTFOLIO.md`](../../PORTFOLIO.md). Full reasoning for each lives in the linked ADR/commit.

## 1. A CI flake that was actually a database-connection bug

**Problem.** A docs-only commit — no code changed at all — failed CI seven times in a row, always `database is locked`, on a different decay test file each time. The failure rate was the real signal: seven consecutive failures on a change that touched zero code ruled out a one-off before any fix was attempted.

**Diagnosis.** The decay spec files each build their own throwaway in-memory database to test pure decay logic in isolation. But the room modules they imported for that logic had a static, top-level `import { db } from "./db.ts"` plus an unconditional self-seed call at module load. Static ES imports are eager and transitive — so merely importing a room module *for its logic* silently opened a second real connection to the app's own on-disk SQLite file, racing the already-running app's connection for the same file lock.

**Solution.** Split each room module in two: the logic module now takes a required `store`/`now` parameter and never imports the database layer at all, so importing it for its logic touches no real database. A new sibling `*-db.ts` module per facility owns the one real connection and re-exports the same functions bound to it, with the production call sites updated to import from there instead.

**Why it matters.** The fix wasn't a retry or a longer timeout — it was recognizing that an import graph had silently become a dependency graph nobody designed. Verified with 15 repeated full test runs locally, the decay specs run in parallel 15 more times, and every CI run since going green on the first try — the currently-verified suite covers all seven facilities across 264 tests.

→ [`91167bd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/91167bd2a833c4cbe9d9399e45d8299ea537d16e), [`PROCESS.md`](../../PROCESS.md)

## 2. Real-time multi-user state without last-write-wins

**Problem.** Multiple residents can report the same resource (a washer, a study room, a computer-lab seat) at nearly the same moment. A naive "last write wins" update silently discards whichever report lost the race, with no signal to either resident that anything went wrong.

**Diagnosis / decision.** Three transports were weighed against the actual write pattern: WebSockets add bidirectional plumbing nothing here needs, since writes already go over plain `PATCH`; polling means every open tab repeatedly re-asking "anything new?" on a timer — real request churn, and a direct latency/frequency trade-off that fights the app's own Fly.io scale-to-zero economics, where idle machines stopping is most of what keeps hosting cheap. Server-Sent Events fit the actual requirement (one-way, server-to-client push) without that repeated-request overhead. For conflicts, three options were considered: last-write-wins (loses a newer report silently), full conflict history (real complexity for a problem the app's scale doesn't have), and optimistic concurrency with a server-owned version counter. Before writing any code, a review also caught that the server's own lazy decay — a status quietly expiring to "unknown" — is *itself* a mutation that can race a stale client the same way two residents' reports can.

**Solution.** Every mutable resource carries a `version` a client can only echo back, never set. A `PATCH` includes the version the client last saw (`ifVersion`); a mismatch is rejected outright with `409` and the resource's actual current state — never a silent overwrite, never a guess at who's right.

**Why it matters.** The concurrency model covers *every* write path that can mutate a resource, including the one (background decay) that's easy to design around and forget about until it causes a real bug in production.

→ [`notes/adr/0001-realtime-and-concurrent-updates.md`](../../notes/adr/0001-realtime-and-concurrent-updates.md)

## 3. Rejecting a room-level model for a resource that isn't one room

**Problem.** Four of the five occupancy-model facilities before Rat Room (a shared computer lab) — Otter, Rabbit, Weasel, and Badger Room — all used the same shape: one row per room, `occupancy: empty | occupied | unknown`. Laundry and AA Room had already earned different models of their own (multiple machine resources, and a richer multi-activity model, respectively), but copying the four-room pattern for Rat Room's seventh facility would still have been the easy, consistent choice.

**Diagnosis / decision.** Rat Room's real question isn't "is anyone in the room" — with roughly ten seats, during normal hours that's almost always true, and the answer tells a resident nothing useful. The actual question is "is a seat free for me, specifically." A single room-level flag can't express that: it collapses one occupied seat and ten occupied seats into the same value, discarding exactly the information a resident needs. That's treated as a real information-loss bug the design shouldn't accept merely to stay pattern-consistent with the other rooms — not a style preference.

**Solution.** Ten independently-reportable seat resources (A–J), each with its own `occupancy`, `confirmedAt`, and `version` — deliberately modeled after how Laundry already treats ten machines as independent resources rather than one room-level flag, while keeping each seat's own state shape close to the other occupancy rooms' (no borrowed fields that don't apply, like `Machine`'s `out-of-order` status). The room-level summary a resident sees is derived fresh from the ten seats on every read, never persisted as a second fact that could drift from what the seats actually say. Later, the 3D scene was corrected to map each seat to one specific, fixed workstation, so an occupied seat shows a figure at exactly its own chair — reversing an earlier, more generic "fixed decorative figure count" design once it was clear residents wanted the 3D view itself to answer "which seats."

**Why it matters.** The same underlying shape (`empty`/`occupied`/`unknown`) was deliberately re-derived from Rat Room's own facts rather than assumed because four rooms in a row happened to share it — and when a later request asked for a stronger seat-to-visual mapping, the system had the right resource granularity already in place to support it without a data-model change.

→ [`notes/adr/0008-rat-room-live-state.md`](../../notes/adr/0008-rat-room-live-state.md) (Decision 1, Decision 4, and "Design correction, v3"), [`22f6502`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/22f6502) (backend), [`906eaa0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/906eaa0) (3D scene), [`310051f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-astra-erevos/commit/310051f) (seat-to-workstation mapping correction)
