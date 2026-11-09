# Toad Live — Interview Preparation Pack

Grounded in the actual repository: source files, ADRs, tests, commits, and
`PROCESS.md`. Every answer below is traceable to something that exists in
the code or docs — not reconstructed from memory. Where the repository
doesn't contain evidence for a stronger claim, that's said explicitly
rather than invented.

**Current facts used throughout** (re-verified by a fresh `pnpm test` run
during this pack's own preparation): 7 facilities, 10 laundry machines, 10
Rat Room seats, **264 automated tests across 22 spec files**, 8 ADRs.
`PROCESS.md` and ADR 0008 both quote **261** as the test count at the
moment Rat Room shipped — that's a real, correct historical snapshot, not
an error, but it's since grown to 264 after later fixes added a few more
tests. Say 264 as the current number; don't quote 261 as if it were still
current.

---

## 1. For each topic

### A. Project overview — "Tell me about Toad Live."

**30-second answer:**

"Toad Live is a status board for a shared student residence. It tracks
things like whether a washing machine is free, or whether a study room is
in use, based on what residents report — not sensors. The interesting
engineering problem isn't the CRUD part, it's that the information is
always a little bit stale, and more than one person can report the same
resource at nearly the same time. So most of the real work went into
making that honest: real-time updates over server-sent events, optimistic
concurrency so two people can't silently overwrite each other, and a
decay rule so an old report eventually says 'unknown' instead of lying
forever."

**2-minute answer:**

"It's built with Astro and Node, one server process, talking to SQLite on
a single persistent volume on Fly.io — there's no separate database
server. There are seven facilities: laundry, which has ten machines
across five physical locations, four single-state rooms like a study room
and a music room, and a computer lab called Rat Room that's modeled as
ten independently-reportable seats rather than one room-level flag.

The core design problem was this: a resident's report is the only source
of truth, and it goes stale. So every mutable resource — a machine, a
room, a seat — carries a server-owned version number. Whenever a resource
is read, the server first checks whether its last confirmed state has
decayed: if too much time has passed since the last confirmation, the
status quietly becomes 'unknown' as part of that same read, before
anyone even has to ask. And if two people try to write to the same
resource near-simultaneously, the second write gets rejected with a 409
and the actual current state, instead of silently clobbering the first
one.

On top of that, real-time updates go out over Server-Sent Events, so if
you're looking at a room and someone else reports a change, you see it
update live without reloading. Sessions are pseudonymous — the server
issues a random credential, hashes it, and never trusts anything the
client claims about who's reporting. The whole thing was built with
Claude Code, following an ADR-first process: decide the state model in
writing, then implement it in stages with a human review at each one."

**Likely interviewer follow-ups:**
- "Why not just use a simple boolean per resource?"
- "What was the hardest part of this project?"
- "How many people actually use this?"
- "What would you change if you rebuilt it?"
- "Walk me through what happens end-to-end when I report a machine as in-use."

---

### B. Hardest technical bug — "Tell me about a difficult bug you diagnosed."

**30-second answer:**

"A docs-only commit — no code changes at all — failed CI seven times in a
row, always with the same SQLite error, `database is locked`, and it hit
a different test file each time. The real cause turned out to be that a
test was importing a room module just to reuse its pure decay logic, but
that module also had a static import of the database layer at the top, so
importing it for logic silently opened a second real connection to the
same SQLite file the running app already had open. I fixed it by
splitting every room module in two: a pure logic half that takes the
store as a parameter, and a thin wrapper that's the only thing allowed to
touch the real database."

**2-minute answer:**

"The symptom was strange because the commit that failed didn't touch any
code — it was a docs-only commit. CI failed with `database is locked`
seven times running, each time pointing at a different decay spec file,
which made it look random. A quick fix would have been to add a retry
around the failing query, or increase SQLite's busy timeout — that would
have masked it without explaining why a brand-new test file kept
triggering it.

The actual cause was an eager, transitive import. Each room module, like
`aa-room.ts`, had a top-level `import { db } from './db.ts'` and an
unconditional self-seed call that ran the moment the module loaded. A
decay spec file would import that module only to reuse its pure decay
function and its constants — but because ES module imports are eager,
that single import silently opened a second, real `DatabaseSync`
connection to the on-disk database file, which raced the already-running
app's own connection for the same file lock. Adding a third affected spec
file pushed it from intermittent to a hundred percent reproduction.

The fix was architectural, not defensive: split each room module into a
pure half, with no database import at all, where every function takes an
explicit `store` and `now` parameter, and a thin `*-db.ts` wrapper that's
the only place that imports the real database and binds those functions
to it. A spec file testing pure logic now imports the pure module and
passes in its own in-memory store — there's no way for it to accidentally
open a second real connection anymore, because the import graph makes
that physically impossible, not just discouraged by convention.

I verified it by running the full check suite fifteen times in a row, and
running the three affected decay spec files together fifteen more times,
plus a built-and-served smoke test. Zero lock errors since, and the same
pattern was reused for every room added afterward, including Rat Room,
which has six decay spec files running in parallel today with zero
failures."

**Evidence in the repo:**
- Commit `91167bd2a833c4cbe9d9399e45d8299ea537d16e` — "test: isolate decay specs from shared SQLite" (10 files, +224/-96)
- `src/lib/aa-room.ts` (pure, no `db.ts` import) vs `src/lib/aa-room-db.ts` (the only place that imports `db.ts`)
- `docs/portfolio/case-studies.md` — Case A
- `PROCESS.md` — "Two corrections that changed how the project is built"
- Same lesson reapplied later: `src/lib/request-protocol.ts`'s own top comment explains it was pulled out of `sessions.ts` for exactly this reason

**Likely follow-ups:**
- "Why not just add a retry or a longer SQLite busy timeout?"
- "How did you confirm the root cause instead of guessing?"
- "Did this pattern come up again later in the project?"
- "What would have happened if you'd just added a mutex instead?"

**Strong follow-up answers:**
- "A retry would have hidden the symptom without explaining why a random docs commit triggered it — and it wouldn't have stopped a real two-connection race from happening, just made it less likely to be observed. I wanted to remove the second connection, not make it collide less often."
- "I confirmed it by finding that the failing file was always a newly-added decay spec, and checking what it imported. Once I saw the room module had a static top-level DB import, the mechanism was obvious — eager imports mean 'importing for logic' and 'importing for the database' aren't actually separable in that module."
- "Yes — when I built identity/session logic later, I hit the same shape of problem with a function that needed the request's protocol. I pulled it into its own zero-dependency module specifically because I'd already learned that lesson."
- "A mutex would have serialized the two connections instead of removing one of them — it solves the lock contention but leaves the actual bug, which is that a 'pure logic' import has a hidden side effect of opening a database connection."

**Weak answer to avoid:**

"I just added `PRAGMA busy_timeout` and the flakiness went away." — This
treats a real architectural coupling bug as a tuning problem. It would
likely have reduced the failure rate without fixing the actual cause, and
an interviewer who asks "why did the lock happen in the first place" would
expose that nothing was actually understood.

---

### C. Real-time architecture — "Why did you use SSE instead of WebSockets or polling?"

**30-second answer:**

"The client never needs to send anything over the real-time channel —
writes already go through an ordinary PATCH request. So I didn't need
WebSockets' two-way channel. And polling would mean every open tab
repeatedly hitting the server, which actively fights how this app is
deployed: it runs on a single Fly machine that's configured to stop
itself when nobody's using it. Frequent polling would keep that machine
awake for no reason. Server-Sent Events gave me one-way push, over plain
HTTP, with much less machinery than WebSockets."

**2-minute answer:**

"I compared three options against what this app actually needs. The
client only ever reads live updates — every write still goes through a
normal PATCH to an API route, so I never needed bidirectional messaging,
which is WebSockets' main advantage. That ruled it out as unnecessary
complexity for a capability I wasn't going to use.

Polling was the real alternative I took seriously, and I rejected it for
a deployment-specific reason, not a general one: this app runs on Fly.io
with `auto_stop_machines` and `min_machines_running = 0`, meaning the
single machine shuts down when nobody's using it and starts back up on
the next request — that's most of why it costs cents instead of dollars.
Fast polling from every open tab directly fights that economics model by
generating constant traffic even when nothing has changed.

SSE gave me one-directional push over a plain HTTP connection, which fits
naturally with everything else being plain HTTP already. The broadcast
side is a single in-process `Set` of subscriber callbacks — that's
correct specifically because this app runs as one Node process on one
Fly machine; there's no second instance to reconcile broadcasts with.
That subscriber list holds no fact about any machine's state — it's pure
transport plumbing, never written to SQLite, and gets fully rebuilt every
time a client reconnects.

I should be precise about what I'm not claiming: I'm not saying an open
SSE connection costs literally nothing. It does hold a live connection
and a callback in that subscriber set. What I compared was request
volume — SSE pushes an event only when a mutation actually happens,
versus polling making a request on a fixed interval regardless of whether
anything changed."

**Evidence in the repo:**
- `notes/adr/0001-realtime-and-concurrent-updates.md` — Decision 1 (WebSocket and polling rejection reasoning, quoted directly)
- `src/lib/realtime.ts` — in-process subscriber `Set`, `subscribe()`/`broadcast()`
- `src/pages/api/stream.ts` — the SSE endpoint, sends an immediate `: connected` comment to force header flush
- `fly.toml` — `auto_stop_machines = "stop"`, `min_machines_running = 0`
- `spec/realtime.test.ts` — SSE delivery tests

**Likely follow-ups:**
- "What happens if a client's SSE connection drops?"
- "How would this work with more than one server instance?"
- "Doesn't an open SSE connection still cost something?"
- "Why not just use a library like Socket.IO?"

**Strong follow-up answers:**
- "On reconnect, the client doesn't replay missed events — there's no event log. The page itself never reloads; the browser's `EventSource` reconnects on its own, and when the connection reopens, an `onOpen` handler on the client re-fetches current state from the normal GET endpoints. I actually verified this against a real disconnect — restarting the production Fly machine, which kills every open connection — and captured the `EventSource`'s own `readyState` going `OPEN → error/CONNECTING → OPEN`, with the page recovering the correct state afterward and no reload at any point. So a missed event is harmless: you're never shown stale data, because the reconnect path re-fetches the same canonical state a normal read would show anyway."
- "Honestly, it wouldn't, not as built. The subscriber list is in-process memory on one machine. If I ran two instances, a broadcast on instance A would never reach a client connected to instance B. That would need a shared layer — something like Redis pub/sub — so every instance could broadcast to every client, not just its own."
- "No, it doesn't cost nothing — it holds an open connection and a callback. What I avoided was the specific cost of polling: constant requests on a fixed timer regardless of whether anything changed, which fights a machine that's supposed to scale to zero."
- "A plain SSE endpoint was simpler for this app's actual need — one-directional push, no reconnection-with-backoff logic to reimplement myself, and no extra dependency. Socket.IO solves a more general problem than I had."

**Weak answer to avoid:**

"SSE has zero overhead compared to polling, so it's always the better
choice." — The ADR doesn't claim this, and neither should the interview
answer. The actual comparison made was about request volume against a
scale-to-zero deployment, not a blanket claim that one connection style
is free.

---

### D. Concurrent writes — "How do you stop two users overwriting each other?"

**30-second answer:**

"Every mutable resource — a machine, a room, a seat — carries a
server-owned version number that starts at 1 and increments on every
write. When a client reports a change, it has to send back the version
number it last saw, as `ifVersion`. The server only applies the write if
that still matches the current version. If someone else wrote in between,
the server rejects it with a 409 and sends back the actual current state,
instead of silently overwriting whatever the other person just wrote."

**2-minute answer:**

"I rejected last-write-wins early, because it can silently discard a
newer, correct state with no sign anything was lost — for example, a
stale 'available' view overwriting a report that the machine just broke,
or worse, a stale report accidentally resurrecting a status that the
server's own decay logic had already invalidated. Neither of those
failures would show up as an error to anyone; they'd just quietly produce
wrong data.

So every resource carries a `version` integer, server-owned, never set by
a client. The actual check happens as part of the same SQL statement that
performs the write — something like `UPDATE machines SET status = ?,
version = version + 1 WHERE id = ? AND version = ?`, where the last
condition is the client's `ifVersion`. If zero rows changed, the server
re-reads the row to tell apart 'no such machine' from 'wrong version,'
and if it was a version mismatch, it returns a 409 with the real current
state in the response body, not just an error message. That means a
client doesn't just learn it failed — it gets exactly what it needs to
retry correctly or show the resident what's actually true right now.

One detail that I think is the most interesting part: the server's own
lazy decay transition is implemented as exactly the same kind of write —
it also increments the version and goes through the same guarded update.
That was a deliberate design-time catch, not something I found by
accident: a stale client report that doesn't know the server already
decayed the resource to 'unknown' must not be able to silently resurrect
the old status. Since decay bumps the version too, that stale PATCH would
also just get rejected with a 409, the same as any other conflicting
write."

**Evidence in the repo:**
- `notes/adr/0001-realtime-and-concurrent-updates.md` — Decision 2 (last-write-wins and append-only rejection, quoted)
- `src/lib/db.ts` lines 118-154 (`decayed()`) and 215-244 (`reportStatus()`) — same atomic guard pattern in both
- `src/pages/api/machines/[id].ts` — the PATCH handler, `ifVersion` validation, the 409 response shape
- `spec/concurrency.test.ts` — three tests: missing `ifVersion` rejected, valid version advances, stale version 409s with canonical state preserved

**Likely follow-ups:**
- "Why not just lock the row while one request is in progress?"
- "What does the client do after getting a 409?"
- "Why does decay need the same protection as a real write?"
- "Did you consider keeping every conflicting write instead of rejecting one?"

**Strong follow-up answers:**
- "A lock would mean the second request has to wait, which adds latency and complexity for a case that's actually rare — two residents reporting the same machine within the same second. Rejecting with 409 and the current state is simpler and lets the second client just re-render with the real data immediately."
- "It gets the actual current state in the 409 body, so it can show the resident what's really true and let them decide whether to report again against the new version — it's not a dead end."
- "Because decay is still a write to that row — it changes `status` and bumps `version`. If it weren't covered by the same check, a stale client PATCH that hadn't seen the decay yet could silently undo it, which is exactly the silent-overwrite bug the versioning exists to prevent, just one layer further down."
- "I did consider it — an append-only model that keeps every conflicting report — but rejected it for this project specifically, because it actively works against the 'glance and know the current state' goal. It's not that the idea is wrong in general, it just solves a problem nobody had reported yet, for this app."

**Weak answer to avoid:**

"I used a database transaction to prevent conflicts." — A transaction
alone doesn't solve this problem; two sequential PATCH requests from two
different clients are two separate transactions, each of which would
succeed under ordinary isolation unless there's an explicit version check
in the WHERE clause. The actual mechanism is the version-guarded
conditional update, not transaction isolation.

---

### E. Lazy decay — "How do you handle stale human-reported information?"

**30-second answer:**

"Every report has a confirmed time, and depending on the facility, either
an exact expected-end time or, for an untimed case, a fixed fallback
window. Staleness is never checked on a timer — it's checked the moment
someone actually reads the resource. If too much time has passed, the
read itself flips the status to 'unknown' as part of that request, and
broadcasts the change. One status is sticky and never decays at all:
out-of-order, for laundry machines, which only changes when someone
explicitly reports it fixed or still broken."

**2-minute answer:**

"The core rule is that decay only ever happens inside an ordinary read —
there's no background timer anywhere checking staleness. The function
that does this, `decayed()`, runs inside the normal get-machine and
list-machines calls. Its very first check is `if (row.status !==
'in-use') return row` — which is also how out-of-order and available
rows never get touched by decay at all. That's not a special case
written elsewhere; it falls straight out of the fact that decay only
applies to the in-use branch.

For a timed report — a washer with a read expected-end time, or a dryer
where the resident gave an estimate — decay is exact: if `now` is past
`expectedEndAt`, it's stale. For an untimed in-use report, there's no
expected end time to compare against, so there's a fixed fallback window,
twelve hours. That number has a comment in the code explicitly marking it
provisional — it exists so an untimed report doesn't claim to run
forever, but it's not based on real usage data yet, and the comment says
so directly, citing the project's own rule against inventing settled
thresholds without evidence.

The detail I think is most interesting here is that the decay transition
itself is a real write, not just a read-time display trick. It bumps the
version number and broadcasts the change over SSE, exactly like a
resident's own report would. The reasoning is that a stale client PATCH
that doesn't know decay already fired shouldn't be able to silently
resurrect a status the server just invalidated — so decay has to go
through the exact same optimistic-concurrency guard as any other write.

And different facilities are allowed to have genuinely different decay
semantics, not one shared rule stretched to fit everything. Laundry's
dryer decay uses that provisional window because dryer cycle times aren't
settled data yet. But several other rooms — a study room, a music room,
a computer lab seat — have their own, separately-confirmed four-hour
ceiling that's a real, independently-verified community norm for that
specific room, not a stand-in for missing data. The project's own rules
are explicit that these look similar in shape but come from different
evidence, and shouldn't be collapsed into one generic formula just
because the code would be shorter."

**Evidence in the repo:**
- `src/lib/db.ts` lines 91-98 (provisional `UNTIMED_IN_USE_DECAY_MS` constant and its comment), lines 107-154 (`decayed()`)
- `notes/adr/0001-realtime-and-concurrent-updates.md` — Context and Mechanics sections
- `CLAUDE.md` — "Do not invent Laundry decay/staleness thresholds" rule, and the standing rule distinguishing Laundry's provisional window from the other rooms' independently-confirmed four-hour ceilings
- `spec/decay.test.ts` — four tests, including the sticky out-of-order test and the provisional-window test

**Likely follow-ups:**
- "Why not just run a background job every few minutes to expire old reports?"
- "Why is twelve hours the number, and why do you call it provisional?"
- "Why does out-of-order never decay?"
- "How would you pick a better number if you had real usage data?"

**Strong follow-up answers:**
- "A background job would mean the server does work even when nobody's looking, and it adds a second place staleness logic could live and drift out of sync with the read path. Doing it only on read means there's exactly one code path that can ever change a status for freshness reasons."
- "Twelve hours was a placeholder chosen so an untimed report doesn't last forever, not a number backed by real dryer-cycle data. I marked it provisional in the code specifically so a future me — or anyone else — knows not to treat it as settled."
- "Because a machine or room reported broken is a fact that needs an actual person to resolve, not time. If it silently decayed back to available after some fixed window, residents could show up expecting a working machine that's still broken."
- "I'd want real usage logs — how long dryer cycles actually run, how long residents actually occupy different rooms — and I'd replace the fixed window with something derived from that data, probably per-location rather than one global constant."

**Weak answer to avoid:**

"Twelve hours is the right number because that's how long things usually
take." — This isn't backed by anything in the project; the code itself
explicitly marks the number as provisional and not based on real data. An
interview answer claiming it as a researched, settled figure would
contradict the project's own documentation.

---

### F. Data modelling — "Tell me about a modelling decision you changed."

**30-second answer:**

"Rat Room is a ten-seat computer lab. My first instinct, same as the
other single-state rooms, would have been one room-level occupancy flag.
But that throws away the actual useful information: with ten seats, 'is
anyone in here' is almost always true during normal hours — what a
resident actually wants to know is whether a seat is free for them. So I
modeled it as ten independently-reportable seats instead, and the
room-level summary — like 'six seats confirmed free' — gets derived fresh
from those ten seats every time it's read, never stored as its own fact."

**2-minute answer:**

"The other four occupancy rooms — a study room, a shared-meals room, a
music room, a formal meeting room — are each genuinely one shared space,
so one occupancy flag per room is the right level of detail; 'is someone
using the music room' is actually the question residents want answered.
Rat Room looked the same on the surface, but it's structurally different:
there are ten separate computers, and a single flag can't distinguish one
person using one seat from the room being completely full. Both would
just read as 'occupied.'

So I modeled it like laundry's machines, not like the other four rooms: as
ten independent resources, A through J, each with its own occupancy,
confirmation time, and version number. That makes it directly reportable
and directly concurrency-safe per seat, the same mechanism as everything
else in the app, just applied ten times instead of once.

The room-level view still shows a summary — a 3D scene and a line like
'six seats confirmed free, two unknown' — but that summary is computed
fresh from the ten seats on every read. I deliberately didn't persist a
second, room-level occupancy row alongside them, because that would
create exactly the problem the per-seat model was meant to avoid: a
stored summary could drift from what the seats actually say, and there'd
be no way to tell which one was right if they disagreed.

The part I actually changed my mind on came later. I originally decided
the 3D figures representing occupied seats should be purely decorative —
explicitly not mapped to any specific seat, so nobody could misread a
figure's position as meaning something it didn't. After seeing it
rendered, a review decided that was actually the wrong call for this
specific room: residents would reasonably expect an occupied seat to show
a figure sitting at that exact seat's own workstation, not a generic
figure somewhere in open floor space. So I reversed that decision and
built a fixed map from each of the ten seats to one specific pre-built
workstation. That's a case where the first design was internally
consistent and well-reasoned, but wrong for what the room actually needed
to communicate."

**Evidence in the repo:**
- `notes/adr/0008-rat-room-live-state.md` — Decision 1 (room-level flag collapses information), Decision 4 (derived summary, never persisted), "Design correction, v3" (the figure-mapping reversal)
- `src/lib/hall-view/rat-room.ts` — `SEAT_WORKSTATIONS`, the fixed seat-to-geometry map
- `src/lib/types.ts` — `summarizeRatRoomSeats()`
- `spec/rat-room.test.ts`, `spec/rat-room-summary.test.ts` — including tests like "unknown seats are never counted as confirmed-free"

**Likely follow-ups:**
- "Why not just add a tenth 'how many occupied' field to a single room row?"
- "What would happen if the ten seats and a stored summary disagreed?"
- "Why does 'occupied' win over 'unknown' in the summary logic?"
- "Was reversing the figure-mapping decision difficult to justify?"

**Strong follow-up answers:**
- "That's really the same ten-independent-resources model with extra steps — you'd still need ten separate confirmation times and version numbers to make each seat concurrency-safe and independently stale-checkable, so you may as well model them as ten rows directly."
- "That's exactly the failure mode I avoided by not storing a second summary at all — there'd be no way to know which one was authoritative, so I made sure that question could never come up."
- "Because an occupied seat is a stronger, more specific signal than an unknown one — if even one seat is confirmed occupied, the room clearly isn't fully free, regardless of how many other seats haven't been checked recently."
- "Not really, because it wasn't a case of the first decision being wrong on its own terms — it was a genuine change in what residents actually wanted from this specific room, and the ADR records it as a deliberate scope change, not a bug fix."

**Weak answer to avoid:**

"I just added a boolean for each seat without really thinking about
whether the summary needed to be stored." — This understates the actual
reasoning: not persisting the summary was a deliberate choice to avoid a
two-sources-of-truth problem, not an oversight that happened to work out.

---

### G. Database choice — "Why SQLite rather than PostgreSQL?"

**30-second answer:**

"This app runs as a single Fly machine with one persistent volume and no
separate database server — that's a fixed constraint, not something I
chose independently. SQLite through Node's built-in `node:sqlite` fits
that shape exactly: no server process to provision, no network hop, the
whole database is one file on the volume that survives a restart. For
this workload — one app instance, modest write volume, residents
reporting statuses — that's a good fit, not a compromise."

**2-minute answer:**

"The deployment shape came first, and the database choice followed from
it: one `shared-cpu-1x` Fly machine, 256 megabytes of memory, one
persistent volume mounted at `/data`, explicitly no separate database
server in the setup. Given that, PostgreSQL would mean either running a
second process on the same tiny machine, competing for that 256
megabytes, or provisioning an entirely separate managed database — more
infrastructure than this workload justifies.

SQLite through `node:sqlite` fits that shape with nothing extra to
provision: it's a single file on the volume, so the data survives a
restart or a redeploy the same way the rest of the app's state does,
and there's no network round-trip between the app and its own data. For
the actual access pattern here — reads dominate, writes are individual
residents reporting one resource at a time — a single-writer embedded
database is not a limitation that shows up in practice.

I want to be clear this isn't a claim that SQLite is better than
Postgres in general — it's a claim that it's the right fit for this
specific constraint: one machine, one process, no separate database
server to run. The honest answer to 'when would you migrate away from
it' is: as soon as either of those constraints stops being true."

**When would you migrate away from SQLite:**

"Two triggers, both tied to the same underlying limit: SQLite allows many
concurrent readers but only one writer at a time. The first trigger is
needing more than one application instance — if this ever needed to run
on more than one machine for availability or load, I'd need a database
that multiple processes can write to concurrently, which means a real
client-server database like Postgres. The second trigger is write volume
genuinely exceeding what one writer can serialize, which hasn't happened
here — writes are one resident reporting one resource at a time, not a
high-frequency stream. I wouldn't migrate preemptively; I'd migrate when
either of those constraints actually stopped being true, and not before,
because that's complexity the current deployment doesn't need."

**Evidence in the repo:**
- `fly.toml` header comment — the fixed shape (one machine, one volume, no separate DB server) and the economic reasoning for scale-to-zero
- `PROCESS.md` — "Astro was chosen for a concrete constraint... SQLite via `node:sqlite` is the one storage option that fits that shape with nothing external to provision"
- `docs/portfolio/architecture.md` — persistence section

**Likely follow-ups:**
- "What happens to writes if two requests hit SQLite at the exact same time?"
- "Isn't SQLite risky for a 'production' app?"
- "How would you migrate the data if you did move to Postgres later?"
- "What's actually stored on the Fly volume?"

**Strong follow-up answers:**
- "SQLite serializes them — one succeeds, the other waits briefly or gets a 'database is locked' error if it times out. In this app's own history, that exact error surfaced not from real contention but from a test accidentally opening a second connection, which I fixed at the architecture level rather than by papering over lock contention."
- "It depends entirely on the actual load and availability needs. For one machine serving a bounded community, it's a sound choice, not a risk — the risk would be using it for something that needed horizontal scaling and expecting it to just work."
- "I'd export the SQLite file's rows, stand up Postgres, and write a one-time migration script — the schema here is simple enough that this wouldn't be a large effort, since there's no complex relational structure to remap."
- "Just the app's own SQLite file holding all the live status rows — no uploaded user content, no logs, nothing else persisted there."

**Weak answer to avoid:**

"SQLite is faster than Postgres so I used it." — Raw speed wasn't the
reason, and this framing invites an interviewer to ask "faster at what,
under what load," which this project has no evidence to answer. The real
reason was deployment constraints and the matching workload shape, not a
performance claim.

---

### H. Framework choice — "Why Astro?"

**30-second answer:**

"Most of this app is server-rendered pages and a handful of API routes —
there's very little that needs to run only in the browser, except the 3D
room views. Astro's server mode gives me cheap, mostly-static page
rendering with just enough dynamic surface for live status, and it
compiles down to a single Node server that matches exactly what the
Fly deployment expects: plain HTTP on one port, one process, no separate
frontend server."

**2-minute answer:**

"The deployment constraint again shaped this: one small Fly machine, one
process. Astro in server mode, with the Node standalone adapter,
compiles to a single `node ./dist/server/entry.mjs` that reads host and
port from the environment — which is exactly the shape `fly.toml` and the
Dockerfile already expect, no separate frontend build artifact to serve
differently from the backend.

Most of the UI genuinely doesn't need client-side interactivity beyond
what plain HTML forms and links already give you — picking a facility,
seeing its status, submitting a report. Astro's default is to ship
server-rendered HTML with minimal JavaScript, which fits that. The one
place that really does need real client-side code is the Three.js 3D
room views — a single shared `WebGLRenderer` drives all seven live
scenes — and Astro doesn't get in the way of that; it just doesn't force
every page to carry that overhead for pages that don't need it.

For a different kind of project — something that's mostly a rich,
single-page interactive client talking to a backend API, with much less
server-rendered content — I'd lean toward something like plain React or
Next.js instead, because the balance of 'mostly static, a little
dynamic' that made Astro a good fit here wouldn't hold."

**Evidence in the repo:**
- `astro.config.ts` — `output: "server"`, `@astrojs/node` standalone adapter, and its comment explaining the match to Fly's expected shape
- `Dockerfile` — `CMD ["node", "./dist/server/entry.mjs"]`
- `PORTFOLIO.md` / `docs/portfolio/architecture.md` — "one shared `WebGLRenderer` across seven live 3D scenes"
- `package.json` — `astro`, `@astrojs/node`, `three` dependencies

**Likely follow-ups:**
- "What would you lose if you used plain Express instead of Astro?"
- "How does the 3D rendering fit into a server-rendered page?"
- "Would you choose Astro again for a bigger project?"
- "What's the actual role of client-side JavaScript here?"

**Strong follow-up answers:**
- "Mostly convenience — routing, built-in dev server, and a clean way to mix server-rendered pages with islands of client JS. I could build the same thing on Express plus a templating engine, but I'd be rebuilding some of what Astro already gives me."
- "It's actually one main workbench page, not seven separate room pages — there's a set of facility tabs, and switching tabs shows a different facility's view within that same page. Each facility has its own Three.js scene, but they all share one `WebGLRenderer` and one mounted-scenes registry, so switching tabs mounts or updates the relevant scene rather than tearing down and rebuilding a whole renderer. The server-rendered part is the page shell and every facility's initial status; the client-side island is what mounts the active scene and subscribes to the one shared SSE connection to keep it live."
- "For something of a similar shape — mostly server-rendered, with a few interactive islands — yes. For a project that's fundamentally a rich single-page app, I'd reconsider, since Astro's strength is specifically the mostly-static-with-islands balance."
- "It's intentionally limited: form submissions, the SSE connection, and the Three.js scene rendering and interaction. The actual state and business logic all live server-side."

**Weak answer to avoid:**

"I used Astro because it's the newest, most modern framework." — This is
marketing language, not an engineering reason, and it doesn't survive a
follow-up asking what specifically it does better than the alternatives
for this app's shape.

---

### I. Testing strategy — "How did you test a real-time multi-user system?"

**30-second answer:**

"264 automated tests across 22 spec files. The behavior and concurrency
tests run as real HTTP requests against the actual production Docker
image — not mocks — the same image Fly deploys, booted with a throwaway
volume in CI. The per-room decay tests take a different, deliberately
isolated approach: they build a real in-memory SQLite database and call
the actual decay functions directly, bypassing HTTP entirely, so decay
timing can be tested with a constructed clock instead of waiting on a
real one. And a small handful — freshness math, Rat Room's summary logic,
the request-protocol check — are pure function tests with no database
involved at all. On top of that, I did manual two-browser checks for
things like 409 conflicts and real SSE delivery, since some real-time
behavior is easier to verify by actually watching two sessions than by
asserting it in code."

**2-minute answer:**

"The tests are organized per facility — behavior tests and decay tests
for each of the five occupancy-style rooms, plus three files for Rat
Room specifically, since it needed per-seat behavior, per-seat decay, and
a separate test for the derived room summary logic. On top of that there
are dedicated files for concurrency, session identity, SSE delivery,
basic route-level smoke checks, persistence, and structured log output.

The behavior tests and `spec/concurrency.test.ts`/`spec/decay.test.ts`
(Laundry's own generic decay) are integration tests: real HTTP requests
against the actual Docker image CI builds, the same image Fly deploys,
with `/data` mounted as a throwaway tmpfs instead of the real persistent
volume. So a passing concurrency test, or Laundry's decay test, means the
real production container actually behaves correctly over HTTP, not that
some simulated version of the logic does. For concurrency specifically,
the test sends two sequential PATCH requests with the same stale version
and checks that the second one gets a 409 with the first write's actual
state still intact — that's testing the real guarded SQL update over real
HTTP. For Laundry's decay test, instead of a fixed sleep, there's a
poll-until-decayed helper that repeatedly reads the resource the same way
a real client would, which tests the actual trigger mechanism — an
ordinary read — rather than betting on exact timing.

Each room's own decay test — AA, Otter, Rabbit, Weasel, Badger, Rat Room —
takes a different, deliberately isolated approach instead. These build a
real in-memory SQLite database using the project's actual schema, and
call the real decay functions directly against it with a constructed
clock, never going over HTTP at all. That's possible because each room's
pure logic module takes `store` and `now` as explicit, required
parameters and never imports the real database layer itself — only a
thin, separate wrapper module does that, for production use. This
separation is directly the lesson the hardest bug in this project taught
me: a 'pure logic' module that secretly imports the real database layer
is exactly what caused the SQLite lock-race bug, so keeping that logic
importable without ever touching the database became a deliberate
architectural goal afterward, not just a testing convenience.

A third, smaller group — freshness math, Rat Room's derived summary
logic, and the request-protocol check — are pure function tests with no
database at all, not even an in-memory one: they import a function
directly and assert on its return value.

What automated tests genuinely couldn't catch were things that are
correct by every rule but visually wrong — a figure standing in the
middle of an otherwise correct 3D scene, not clipped, not broken, just in
the wrong place for what the room is supposed to communicate. That's why
a staged human visual review step existed alongside the automated suite,
not instead of it."

**Evidence in the repo:**
- `.github/workflows/checks.yml` — `docker build`/`docker run --tmpfs /data`, then `pnpm check` against the real container over HTTP
- Integration tests (real HTTP, `fetch()` against `baseUrl`): `spec/concurrency.test.ts`, `spec/decay.test.ts`, `spec/identity.test.ts`, `spec/realtime.test.ts`, `spec/persistence.test.ts`, `spec/rat-room.test.ts`, and the per-facility behavior test files (`aa-room.test.ts`, `otter-room.test.ts`, etc.)
- In-memory-SQLite, direct-function decay tests (no HTTP, real schema): `spec/aa-room-decay.test.ts`, `spec/otter-room-decay.test.ts`, `spec/rabbit-room-decay.test.ts`, `spec/weasel-room-decay.test.ts`, `spec/badger-room-decay.test.ts`, `spec/rat-room-decay.test.ts`
- Pure function tests (no database at all): `spec/freshness.test.ts`, `spec/rat-room-summary.test.ts`, `spec/request-protocol.test.ts`
- `src/lib/aa-room.ts` (no `db.ts` import, takes `store`/`now` as parameters) vs `src/lib/aa-room-db.ts` (the only place that imports `db.ts`) — the architectural pattern that makes both the in-memory decay tests and the pure function tests possible, born directly from the SQLite lock-race fix
- `spec/decay.test.ts`'s `pollUntilDecayed()` helper

**Likely follow-ups:**
- "Why run some tests against a real Docker container and others in-memory?"
- "Why do the per-room decay tests use an in-memory database instead of a mocked store?"
- "How do you test something as timing-sensitive as decay without flaky tests?"
- "What's the actual difference between a 'behavior' test and a 'decay' test for a room?"
- "What would you still want to add to this test suite?"

**Strong follow-up answers:**
- "Behavior and concurrency tests go through real HTTP because the actual bug history here included a real SQLite file-lock race that a mocked database would never have exposed — testing against the real image and the real database engine catches exactly the class of bug that matters most. Decay tests are different: timing is the whole point, and real HTTP adds latency and flakiness to a test that's trying to assert something about elapsed time, so those run against a real in-memory database with a constructed clock instead."
- "Because the per-room decay logic is deliberately written to take `store` and `now` as parameters rather than reading the real database or the real clock directly — that's what makes it possible to build a throwaway in-memory database with the real schema and call the real decay function against it with any clock value I want, without ever touching the app's real on-disk SQLite connection."
- "By polling for the real trigger condition — an ordinary read — instead of sleeping a fixed amount of time and hoping decay has fired by then. That removes the bet on timing entirely."
- "A behavior test checks ordinary reporting and reading over real HTTP — valid statuses, required fields, persistence. A decay test checks the freshness boundary against a constructed clock in an in-memory database: still fresh right before the threshold, decayed right after, and that a sticky status like out-of-order never decays regardless of elapsed time."
- "More load-style testing — right now there's no test asserting what happens under genuinely concurrent (not just sequential) requests hitting the same resource at the same instant, which is a gap given that's the exact scenario the version check exists for."

**Weak answer to avoid:**

"All 264 tests run against the real production container, so the app is
fully tested." — This overstates it: the behavior and concurrency tests
do, but the per-room decay tests deliberately use an in-memory database
with a constructed clock instead, and a few more are pure function tests
with no database at all. Conflating all three loses the more interesting
point, which is that this separation was a direct, deliberate response to
the SQLite lock-race bug — not an oversight, and not uniform testing
applied the same way everywhere.

---

### J. Human review — "What did automated testing miss?"

**30-second answer:**

"Things that were correct by every written rule but still looked wrong.
The clearest example: Rat Room's first implementation put occupied-seat
figures in open floor space, deliberately not tied to any specific seat —
which followed the rule at the time exactly. A person looking at the
actual screenshot decided that read as wrong for a computer lab, even
though nothing was functionally broken. No test could have caught that,
because nothing it checked was false."

**2-minute answer:**

"The clearest case is Rat Room's figures. The original design rule
explicitly said occupied-seat figures should be decorative, not mapped to
any specific seat — partly to avoid implying a level of precision the
data didn't have. The first implementation followed that rule correctly:
figures appeared in open floor space, clear of the workstations. A real
person reviewing the actual rendered screenshots judged that this read as
wrong — in a room full of workstations, a floating figure in open space
looks like a mistake, not a deliberate abstraction. That's not a bug by
any rule that existed at the time; it was a genuine design correction, and
it's recorded as one, not quietly fixed as if it had always been the
plan.

A separate, non-visual example: after a small CSS change to make the
Rat Room seat panel scrollable, a review reported the entire site looking
unstyled. Instead of assuming the new CSS broke something and reverting
it, the actual diagnosis ran a fresh dev server, a fresh production
build, and an isolated test with that CSS change reverted — all three
rendered correctly. The real cause was a leftover local server process
from earlier testing, still serving an old build whose HTML referenced a
CSS filename a later rebuild had since hashed differently. The lesson
there wasn't about CSS at all — it was that a scary-looking regression
got run to ground by actually eliminating real hypotheses in order,
rather than reverting the most recent change on suspicion.

Both of these are reasons visual and process review stayed a required
step even with 264 automated tests: one caught something that was
correct by every written rule but wrong in practice, and the other caught
a false alarm that a less careful diagnosis would have blamed on the
wrong cause entirely."

**Evidence in the repo:**
- `PROCESS.md` — "Agent workflow: why so staged" (figures-in-open-floor example), "A site-wide styling scare that wasn't a code bug"
- `notes/adr/0008-rat-room-live-state.md` — the 3D verification subsection recording the figure-placement correction
- Commit `9a2461e` — "fix: make Rat Room seat panel scrollable" (the trigger for the stale-server investigation)

**Likely follow-ups:**
- "How do you decide what needs human visual review versus what a test can cover?"
- "Wasn't reverting the CSS the faster fix, even if it turned out not to be the cause?"
- "How often did review actually catch something real, versus just confirming things were fine?"
- "Isn't this a sign the automated test suite had a gap?"

**Strong follow-up answers:**
- "Roughly: if a rule can be stated as a fact about data — a status, a version, a timestamp — a test can check it. If the question is 'does this look right to a person who'd actually use the room,' that's a visual review question, because 'looks right' isn't something I can write an assertion for."
- "It would have been faster, but it would have taught me the wrong lesson — that the newest change is always the suspect — which would make me slower at diagnosing the next regression that really is caused by something else entirely."
- "I don't have an exact count, but the figure-placement case is the clearest instance where it caught something a passing test suite had no way to flag, since nothing it checked was actually false."
- "Not exactly a gap — it's more that some properties, like 'does this look like a computer lab,' aren't expressible as test assertions at all. The test suite covers correctness of data and behavior; visual review covers whether the correct data is being communicated well."

**Weak answer to avoid:**

"I just reverted the CSS change since the site looked broken right after
it." — This is the exact wrong move the project's own process avoided:
it would have fixed the symptom by coincidence (a fresh deploy would
serve the right CSS either way) while leaving the actual cause — a
leftover stale server process — completely undiagnosed and free to
confuse the next person who hit it.

---

### K. Agentic development workflow — "How did you use Claude Code / AI agents?"

**30-second answer:**

"I used Claude Code to implement the app, but I made the architecture
decisions myself, in writing, before any code existed. Laundry came
first, before I'd settled into that practice, but once the ADR practice
was established, every new facility's state model was frozen in an ADR
before implementation started. Implementation then went in stages:
backend first, then a practical panel, then the 3D view, each one
reviewed and committed on its own before moving to the next. I reviewed
the actual output at every stage, including screenshots of the 3D scenes,
and caught things that were technically correct but visually wrong before
they shipped."

**2-minute answer:**

"I didn't prompt 'build the whole app' and accept whatever came out. Once
the ADR practice was established, a facility's implementation didn't
start until its state-model decision record was frozen in writing first —
what statuses exist, what triggers decay, how concurrency is handled for
that resource. That record is what the agent implements against, not
something it's inventing as it goes.

Implementation itself was staged deliberately: backend logic first,
reviewed and committed on its own; then a practical status panel, reviewed
and committed; then the 3D scene, reviewed and committed; then an actual
production deploy and live smoke test. The reasoning for splitting it
this finely was cost containment, not caution for its own sake — a wrong
state-model decision caught at the ADR stage costs nothing, because no
code exists yet to unwind. The same mistake caught after the 3D work is
far more expensive to walk back.

CLAUDE.md and the ADRs function as a harness the agent has to work
inside — fixed facts that can't be casually changed, like the exact
laundry locations and machine count, the valid status values, and the
rule that decay is always lazy and read-triggered, never timer-based.
The test suite is the other half of that harness: nothing merges until
`spec/` is green against the real built image.

Where I came in directly was catching things that were correct by every
rule but still wrong — the Rat Room figures-in-open-floor case is the
clearest example: it followed the stated rule exactly, and I still judged
it wrong once I saw the actual screenshot, and reversed the earlier
decision. I also caught a production-only bug — a session cookie's
`Secure` flag silently never getting set — that neither local testing nor
the automated suite surfaced, because it only showed up once I actually
checked the live deployed response with `curl`.

The reason I didn't just ask for the whole app in one prompt is the same
reason I staged everything else: the earlier a wrong decision is caught,
the cheaper it is to fix, and a single big prompt collapses all of those
checkpoints into one, after a large amount of code already exists."

**Evidence in the repo:**
- `PROCESS.md` in full — "Agent workflow: why so staged," the ADR-first rule, the staged pipeline with real commit examples
- `CLAUDE.md` — the standing rules an agent must work inside (laundry facts, decay rules, scope discipline)
- `reflections/crit-8.md`, `crit-9.md`, `crit-10.md` — first-person accounts of specific catches (a production timestamp crash, decay-as-mutation caught before code, the `Secure` cookie bug)
- `notes/adr/0008-rat-room-live-state.md` — the figure-placement reversal, recorded as a deliberate design correction

**Likely follow-ups:**
- "Doesn't this mean the AI did most of the actual engineering?"
- "What's an example of something the agent got wrong that you had to catch?"
- "Why not just review the final output instead of staging every step?"
- "How do you know the ADRs and CLAUDE.md actually constrained the agent, rather than just being documentation nobody enforced?"

**Strong follow-up answers:**
- "The agent did most of the typing, but the actual engineering decisions — what the state model is, what counts as correct behavior, where the concurrency boundary is — were mine, written down before implementation started. The agent implements a decision; it doesn't make it."
- "The clearest one is the Rat Room figure placement — it followed the written rule exactly and I still judged the result wrong once I saw it rendered, and changed the rule. A more subtle one is the `Secure` cookie bug, which looked correct locally and only failed in the real deployed environment."
- "Because catching a wrong decision after all the code exists is much more expensive to unwind than catching it at the design stage, before any code exists — staging is specifically about making mistakes cheap to catch early."
- "Because `spec/` is what CI actually runs against the real built image before anything can merge — it's not just documentation, it's an enforced gate. The ADRs are 'soft' in that sense, but CLAUDE.md's rules are reinforced by the tests that check them directly, like the decay and sticky-status tests."

**Weak answer to avoid:**

"I just told Claude Code to build a status board app and it figured out
all the architecture." — This understates the actual process and would
likely not survive a specific follow-up question, since the real decisions
(state models, concurrency semantics, decay rules) are recorded in ADRs
written before implementation, not discovered by the agent independently.

---

### L. Scaling — "What would you change if this had 10,000 concurrent users?"

**30-second answer:**

"Honestly, a lot would need to change, and I want to be clear the current
system isn't built for that scale — it's built for one bounded community
on one machine. The two biggest constraints are SQLite's single-writer
model and the fact that real-time broadcast is an in-process list that
only works because there's exactly one server instance. At that scale
I'd move to a shared database like Postgres and add a pub/sub layer like
Redis so multiple app instances could broadcast to every connected
client, not just their own."

**2-minute answer:**

"I'd separate what exists today from what would actually need to change,
because they're different things. Today: one Fly machine, one SQLite
file on a persistent volume, and an in-process `Set` of SSE subscriber
callbacks that only works because there's exactly one Node process
holding all the live connections.

The first thing that breaks at real scale is that single-process
assumption. If I needed more than one app instance — for availability or
just to handle more simultaneous connections than one process can hold —
a broadcast from instance A would never reach a client connected to
instance B, since that subscriber list genuinely only exists in that
one process's memory. I'd need a shared broadcast layer, something like
Redis pub/sub, so every instance publishes to a shared channel and every
instance relays to its own locally-connected clients.

The second constraint is SQLite's single-writer model. For one
instance's worth of residents reporting statuses, that's never been a
real bottleneck — writes are individual people, not a high-frequency
stream. At genuinely high concurrent write volume across multiple
instances, I'd move to a real client-server database like Postgres,
which multiple processes can write to concurrently without one global
file lock.

I'd also want real observability at that scale — right now there isn't
dashboarded metrics or alerting, just structured log lines and CI
checks — and I'd think about rate limiting on the report endpoint, which
doesn't exist today because it's never been needed for this user base.

What I want to avoid saying is that the current architecture 'mostly
works' at that scale with minor tweaks — it doesn't. The single-process
in-memory subscriber list and the single SQLite writer are both correct,
deliberate choices for the actual deployment this app has, and both
would need to be replaced, not patched, for real horizontal scale."

**Evidence in the repo:**
- `src/lib/realtime.ts` — explicit comment: "correct because this app runs as one Node process on one Fly machine... no second instance to reconcile broadcasts with"
- `fly.toml` — single `shared-cpu-1x` machine, one volume, `min_machines_running = 0`
- No benchmarks, load tests, or measured concurrency ceilings exist anywhere in the repository — this is a reasoned-from-architecture answer, not a measured one, and the pack is explicit about that distinction

**Likely follow-ups:**
- "How would you handle a client that missed an event during the transition to multiple instances?"
- "Would you keep SQLite at all in a scaled-up version?"
- "What's the very first thing you'd change, given limited time?"
- "Have you actually load-tested the current system?"

**Strong follow-up answers:**
- "The same way it's handled today: a reconnecting or newly-connecting client does an ordinary read of current persisted state rather than replaying a missed event — so as long as the shared database stays the single source of truth, a missed broadcast is never actually harmful, just a slightly delayed update."
- "Not at that scale — SQLite's single-writer model is the more fundamental limit for a multi-instance deployment. I'd move to Postgres specifically because it supports concurrent writers across processes."
- "The single-process broadcast list, because it's the one piece that doesn't just get slower under load — it actively breaks correctness the moment there's more than one instance."
- "No — I haven't load-tested this, and I don't want to claim a specific number it can handle. Everything I've said about scaling limits comes from reasoning about the architecture, not from a measured benchmark."

**Weak answer to avoid:**

"This architecture would handle 10,000 users fine, it just might be a
little slower." — This directly contradicts what the architecture
actually guarantees: past one instance, the in-process subscriber list
doesn't degrade gracefully, it silently stops broadcasting to some
clients at all. That's a correctness failure, not a performance one, and
claiming otherwise would likely get caught by a follow-up question.

---

## 2. System-design challenge questions

### 1. How would SSE work across multiple server instances?

**Core reasoning:** The current in-process `Set` of subscribers only
holds callbacks for clients connected to that exact process. Across
multiple instances, a broadcast needs to reach clients regardless of
which instance they're connected to. The standard fix is a shared
pub/sub layer — Redis is the common choice — where every instance
publishes every broadcast to a shared channel, and every instance
subscribes to that channel and relays to its own locally-connected SSE
clients.

**Current vs. hypothetical:** Today, `broadcast()` in `src/lib/realtime.ts`
directly iterates an in-process `Set` — there is no publish step at all.
A multi-instance version would still keep that same in-process fan-out
for clients attached to that specific instance, but the thing being
iterated would be populated by messages arriving from the shared channel,
not only from that instance's own local writes.

### 2. What happens if a client misses an SSE event?

**Core reasoning:** There is deliberately no event log or replay buffer.
A (re)connecting client doesn't try to catch up on missed events — the
browser's `EventSource` reconnects on its own with no page reload, and the
client-side `onOpen()` handler re-fetches current state from the normal
GET endpoints the moment the connection reopens. Since that's the same
canonical source every write updates, a missed broadcast never leaves a
client looking at wrong data — only slightly stale data until the
reconnect's re-fetch catches it up.

**Current vs. hypothetical:** This already matches the actual
implementation — `src/lib/live-stream.ts`'s `onOpen()` and
`src/pages/api/stream.ts`'s own comment both state this explicitly, and
it was verified live against a genuine server-side disconnect (a Fly
machine restart), observing the real `EventSource` go `OPEN →
error/CONNECTING → OPEN` and recover full state with zero page reloads. A
system that did need to guarantee delivery of every intermediate event,
rather than just eventual consistency with current state, would need a
durable event log and a resume-from-sequence-number protocol —
meaningfully more complexity than this app's actual requirement
justifies.

### 3. Why is canonical-state recovery after 409 important?

**Core reasoning:** A 409 alone tells a client its write was rejected, but
not what's actually true now. Returning the current canonical state in
the same response means the client can immediately show the resident the
real status, or decide to retry with the correct version, without a
second round-trip just to find out what happened.

**Current vs. hypothetical:** This is already implemented — the PATCH
handler's 409 branch returns `{ error: "stale version", current:
result.current }`. A weaker design that returned only an error code would
force every client to issue a follow-up GET, doubling the requests needed
to recover from a conflict.

### 4. Why not persist the Rat Room summary?

**Core reasoning:** A persisted summary row would be a second fact
describing the same ten seats the actual seat rows already describe.
Any time they disagreed, there'd be no principled way to say which one
was right — exactly the kind of drift-prone duplicate state the ADR
explicitly rejected. Deriving it fresh on every read means there is
structurally only one source of truth, ever.

**Current vs. hypothetical:** `summarizeRatRoomSeats()` is a pure
function over the ten seats' current rows, called at read time — nothing
is written. A hypothetical alternative that cached the summary for
performance would need an invalidation strategy tied to every single-seat
write, which is exactly the synchronization problem avoided by not
caching it in the first place.

### 5. What failure modes exist if the Fly machine dies?

**Core reasoning:** SQLite's file lives on a persistent volume, not in
machine memory, so the actual status data survives a crash or restart —
Fly restarts the machine and it reattaches to the same volume. What
doesn't survive is anything held only in process memory: every open SSE
connection and the in-process subscriber list are lost and have to be
rebuilt from scratch by each client's next reconnect.

**Current vs. hypothetical:** This is the explicit, deliberate boundary
drawn in the project's own persistence rules — the subscriber list is
named as the one thing allowed to live only in memory, precisely because
it holds no fact of its own. A hypothetical multi-machine setup would add
a second failure mode: if the one machine holding the SQLite volume
specifically died in a way Fly couldn't restart cleanly, the volume
itself (not just the process) would need to be part of the recovery
story — something the current single-machine, single-volume setup
doesn't need to reason about today.

### 6. How would you support authenticated residents later?

**Core reasoning:** Today's session identity is deliberately scoped to be
an authentication boundary (proving possession of a server-issued secret)
without being an identity-verification boundary (proving who the person
actually is). Adding real accounts would mean layering a verified
identity on top of — not instead of — the existing pseudonymous session
mechanism, since the existing design already correctly resolves "the
server trusts who's making this request" without yet answering "and who
are they in real life."

**Current vs. hypothetical:** Right now there's no password, no account
creation, and no verification of a person's identity — the credential
just proves "whoever holds this cookie made this request." A real
implementation would need a verified identity step (email, student ID,
whatever's appropriate) issued once and then linked to the same kind of
server-side session already in place, rather than replacing the session
mechanism itself.

### 7. How would you add observability?

**Core reasoning:** Today there's structured log lines (confirmed by
`spec/log.test.ts`) and CI-level checks, but no aggregated metrics
dashboard or alerting. The next step would be emitting metrics — request
counts, 409 rates, decay-trigger frequency — to a time-series backend,
and setting alerts on concrete failure signals like a spike in 500s or
database errors, rather than relying on someone noticing a problem
manually.

**Current vs. hypothetical:** Structured logs exist and are tested for
shape today; there is no metrics pipeline or dashboard in the repository.
This would be new infrastructure, not an extension of something already
half-built.

### 8. How would you redesign freshness if real usage data became available?

**Core reasoning:** The project's own standing rule is explicit that
Laundry's untimed-dryer decay window is a provisional placeholder, not a
researched constant, specifically because real cycle-time data doesn't
exist yet. If it did, the fixed twelve-hour window could be replaced with
a derived value — per-location or per-machine-type average cycle time
plus some safety margin — rather than one global constant.

**Current vs. hypothetical:** Right now `UNTIMED_IN_USE_DECAY_MS` is a
single hardcoded constant in `src/lib/db.ts`, explicitly marked
provisional in its own comment. A data-informed redesign would replace
that constant with a computed or configurable value, while keeping the
actual trigger mechanism — decay checked lazily, only on read — unchanged,
since that part of the design isn't what the missing data would affect.

---

## 3. If the interviewer asks me to show the code

| Topic | File | What to point at | What it demonstrates |
|---|---|---|---|
| **SSE / real-time broadcast** | `src/lib/realtime.ts` (66 lines) | The in-process `Set<Subscriber>`, `subscribe()`/`broadcast()`, and the top comment explaining why it's correct only because there's one process | Small, complete story: push-only transport, no persisted fact, explicit single-instance assumption stated in the code itself |
| **Concurrency + session identity together** | `src/pages/api/machines/[id].ts` (110 lines) | The PATCH handler: session resolved from cookie before the body is even parsed, `reporterId` in the body rejected outright, `ifVersion` required and validated, the 409 branch returning `current` | One file shows both guardrails at once — actor resolution and version-guarded writes — in real request-handling code, not abstracted away |
| **Lazy decay + sticky status** | `src/lib/db.ts`, lines 91–154 | The provisional-constant comment, and `decayed()`'s first line (`if (row.status !== "in-use") return row`) | Shows sticky out-of-order falls out of the code structure itself, not a special-cased branch, plus the explicit "this number is provisional" comment |
| **Rat Room per-seat modeling** | `src/lib/hall-view/rat-room.ts` (449 lines — point at `SEAT_WORKSTATIONS` specifically, not the whole file) | The fixed seat-letter-to-workstation map | Concrete evidence of the seat-to-geometry mapping decision, without needing to read the whole 3D scene file |
| **Derived summary, never persisted** | `spec/rat-room-summary.test.ts` (85 lines) | The "unknown seats are never counted as confirmed-free" test | A small, fully self-contained test file that proves the derivation logic is pure and tested in isolation from HTTP or the database |
| **Test design against a real image** | `.github/workflows/checks.yml`, lines 33–42 | `docker build`/`docker run --tmpfs /data`, then `pnpm check` against it over HTTP | Proves tests run against the real production container, not mocks — the single strongest piece of evidence for the testing-strategy answer |
| **The SQLite lock-race fix itself** | `src/lib/aa-room.ts` vs `src/lib/aa-room-db.ts` | Point out `aa-room.ts` has no `db.ts` import at all; `aa-room-db.ts` is the only file that does | Directly shows the architectural fix — pure logic and database wiring physically separated by the import graph, not by convention |

I'd avoid opening `src/pages/index.astro` (221KB, one monolithic page) or
the full `rat-room.ts` file live — both are real and correct, but neither
tells a focused story quickly; the smaller files above make the same
points faster and more clearly.

---

## 4. STAR stories

### Story 1 — SQLite lock-race diagnosis

**Situation:** A docs-only commit, with no code changes, failed CI seven
times in a row, always with a `database is locked` SQLite error, hitting
a different test file each time.

**Task:** Find the actual cause rather than suppressing the symptom with
a retry or a longer busy-timeout.

**Action:** I traced the failing test files and found each one imported a
room module only to reuse its pure decay logic — but that module had a
static, eager import of the real database layer at its top, plus an
unconditional self-seed on load. Importing it for logic alone silently
opened a second real connection to the same on-disk file the running app
already had open, racing it for the file lock. I split every room module
into a pure half, with no database import and explicit `store`/`now`
parameters, and a thin wrapper that's the only place allowed to import
the real database.

**Result:** Zero lock errors since, verified across fifteen repeated full
test runs plus fifteen more runs of just the affected files together. The
same split pattern was reused for every facility added afterward.

### Story 2 — Rat Room state-model redesign

**Situation:** Rat Room is a ten-seat computer lab. The natural first
instinct, matching the other occupancy rooms, would be one room-level
occupancy flag.

**Task:** Decide whether that actually answers the question a resident
has — "is there a free seat for me" — rather than just matching the
existing pattern for convenience.

**Action:** I modeled Rat Room as ten independently-reportable seats
instead, matching laundry's machine-per-resource shape rather than the
other rooms' single-flag shape, and made the room-level summary a derived
read-time calculation over those ten seats rather than a second stored
fact.

**Result:** The room can now honestly report "six seats confirmed free,
two unknown," which a single flag could never express, and there's no
possibility of a stored summary drifting from what the seats actually
say, because there isn't a second stored summary at all.

### Story 3 — visual bug found only through human review

**Situation:** Rat Room's first 3D implementation followed its own
design rule exactly: occupied-seat figures were deliberately decorative,
placed in open floor space, not tied to any specific seat.

**Task:** Evaluate whether the result actually looked right, which no
automated test could judge, since nothing it checked was technically
false.

**Action:** I reviewed the actual rendered screenshots and judged that a
figure standing in open floor space, in a room full of workstations,
read as a visual mistake rather than a deliberate abstraction — even
though it matched the written rule precisely. I reversed the rule and
built a fixed map from each seat to its own specific workstation.

**Result:** Occupied seats now show a figure seated at exactly that
seat's own chair, which is recorded explicitly as a deliberate design
correction, not a bug fix for something that was broken by any prior
definition.

### Story 4 — stale-server / missing-CSS investigation

**Situation:** Right after a small, unrelated CSS fix to make a seat
panel scrollable, a review reported the entire site rendering unstyled —
looking like a serious, wide regression.

**Task:** Find the actual cause rather than assuming the most recent
change was responsible and reverting it on suspicion.

**Action:** Instead of reverting, I ran a fresh dev server, a fresh
production build, and an isolated test with the CSS change reverted —
all three rendered correctly, which ruled out the CSS change as the
cause. The actual problem was a leftover local server process from
earlier testing, still serving an old build whose HTML referenced a CSS
filename a newer rebuild had since hashed differently.

**Result:** The real cause — a stale background process, not a code
regression — was found and the server was restarted, with the CSS change
confirmed safe. The broader lesson was about diagnosing by eliminating
real hypotheses in order, rather than reverting the newest change on
suspicion alone.

---

## 5. Preparation notes

**Word count:** approximately 12,460 words.

**Topics covered:** all 12 requested interview questions (A–L), 8
system-design challenge questions, a code-navigation table covering 7
engineering points across 6 files, and 4 STAR stories.

**Evidence used:**
- **Commits:** `91167bd2a833c4cbe9d9399e45d8299ea537d16e` (SQLite lock-race fix), `9a2461e` (Rat Room seat panel scroll fix, trigger for the stale-server investigation), `d7d0cd7` (referenced for the `Secure` cookie fix, via `reflections/crit-10.md`)
- **ADRs:** `0001-realtime-and-concurrent-updates.md`, `0002-identity-and-permissions.md`, `0008-rat-room-live-state.md`
- **Source files:** `src/lib/realtime.ts`, `src/lib/db.ts`, `src/lib/sessions.ts`, `src/lib/aa-room.ts` / `aa-room-db.ts`, `src/lib/hall-view/rat-room.ts`, `src/lib/types.ts`, `src/pages/api/machines/[id].ts`, `src/pages/api/stream.ts`, `astro.config.ts`, `fly.toml`, `Dockerfile`, `.github/workflows/checks.yml`
- **Tests:** `spec/concurrency.test.ts`, `spec/decay.test.ts`, `spec/freshness.test.ts`, `spec/identity.test.ts`, `spec/realtime.test.ts`, `spec/rat-room.test.ts`, `spec/rat-room-decay.test.ts`, `spec/rat-room-summary.test.ts`, `spec/request-protocol.test.ts`, plus the other five per-room `*-decay.test.ts` files (confirmed via direct grep for `fetch(` vs. `DatabaseSync` to establish which tests are HTTP-based, in-memory-SQLite, or pure-function)
- **Process docs:** `PROCESS.md` (read in full), `CLAUDE.md`, `reflections/crit-8.md`, `crit-9.md`, `crit-10.md`, `docs/portfolio/case-studies.md`
- **Client-side SSE:** `src/lib/live-stream.ts` (`onOpen()`), `src/pages/index.astro` (facility tabs, `mountedScenes` sharing), `notes/adr/0008-rat-room-live-state.md` (the Fly-machine-restart `EventSource` reconnect verification, `OPEN → error/CONNECTING → OPEN`)

**Where evidence was insufficient and a stronger claim was avoided:**
- **Scaling (topic L) and system-design questions 1, 5, 7:** no load tests, benchmarks, or measured concurrency ceilings exist anywhere in the repository. Every scaling answer is explicitly framed as reasoned from the architecture, not measured — and says so directly, rather than implying a tested number.
- **"Why SQLite" (topic G):** the repository gives a constraint-driven justification (deployment shape, workload pattern) but never a general "SQLite vs. Postgres" performance comparison — the answer avoids claiming SQLite is faster or better in general.
- **SSE cost (topic C):** ADR 0001 never claims SSE has zero idle cost — only that it avoids polling's wasted-request volume against a scale-to-zero machine. The answer is written to preserve that exact distinction rather than rounding it up to "SSE is free."
- **"Rat Room scroll reachability"** (as a named project term): this exact phrase doesn't appear anywhere in the repository. The underlying fact — a commit making the seat panel scrollable, which triggered the stale-server investigation — is real and is described factually in Story 4, without quoting a project term that doesn't exist.
- **Test count:** `PROCESS.md` and ADR 0008 both quote 261 as the test count at the specific moment Rat Room shipped — this is a correct historical snapshot, not a stale error, but it's lower than the current, freshly-verified 264. The pack uses 264 throughout and flags the 261 figure's context rather than treating either number as simply wrong.

**Documentation-safe checks run:** none required — this phase creates one
new Markdown file and reads existing repository state; no application
code, schema, or build configuration was touched.

**Correction pass (post-initial-draft):** five factual issues from a
targeted review were fixed, each verified against source before editing:
(1) SSE reconnect was overstated as "an ordinary page load" — corrected
to the actual client-side `onOpen()` re-fetch with no page reload,
grounded in `src/lib/live-stream.ts` and the Fly-restart `EventSource`
verification in ADR 0008; (2) "all 264 tests... real HTTP... not mocks"
was too broad — corrected to distinguish three real categories
(HTTP-integration, in-memory-SQLite-with-constructed-clock for per-room
decay, and pure-function), confirmed by grepping every spec file for
`fetch(` vs. `DatabaseSync`; (3) "Each room page loads its own client-side
script" incorrectly implied separate pages — corrected to the actual
single-workbench-with-facility-tabs structure, confirmed in
`src/pages/index.astro` and `src/lib/hall-view/scene.ts`'s shared
`mountedScenes` registry; (4) Topic K's 30-second answer implied an ADR
existed for every facility including Laundry — corrected to name
Laundry's exception explicitly, confirmed against `PORTFOLIO.md`/
`PROCESS.md`'s "Laundry precedes the ADR practice"; (5) Topic A's 2-minute
answer blurred write and read semantics for decay — corrected to "whenever
a resource is read, the server first checks whether its last confirmed
state has decayed," matching `decayed()`'s actual read-triggered
implementation in `src/lib/db.ts`.
