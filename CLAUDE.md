# Rules for working on Toad Live

Derived from `README.md`'s definition of good and the decisions in
`PROCESS.md`. If a rule here stops matching those, fix the mismatch — don't
let this file, the README's argument, and the code drift apart.

## Laundry facts — fixed, do not "helpfully" change

- There are exactly five laundry locations: **A/B**, **C**, **E**, **F**,
  **G**. A and B share a stairwell and count as one location. **D has no
  laundry room.** Never add a sixth location, a D-block laundry room, or
  infer one from a "one per block" pattern — there isn't one.
- Each of the five locations has exactly **one washer and one dryer** — 10
  machines total. The machine list is fixed seed data, not something
  residents create or the app grows on its own.

## Machine state

- The only valid statuses are **available**, **in-use**, **out-of-order**,
  and **unknown**. Don't add a new status without updating this file, the
  schema, and `PROCESS.md` together.
- **out-of-order is sticky.** It must never be cleared by time-based decay
  logic — only by an explicit new report changing or reconfirming it. Any
  decay/expiry code must exclude out-of-order.
- **Remaining time comes from `expected_end_at`, never from an assumed
  cycle length.** Both washers and dryers use the same nullable field: a
  washer's is normally populated by reading its own display, a dryer's only
  if a resident chooses to estimate one. When it's null — for either type —
  the UI must show "in use — remaining time unknown," not a guessed number.
  Never derive an end time from elapsed time plus a hardcoded duration for
  either machine type.
- **`confirmed_at` may be null** — a machine that's never been reported has
  no confirmation to show. Don't default it to "now" at seed time or treat
  null as an error.

## Scope discipline (see PROCESS.md for the reasoning)

- **No real-time transport** (WebSocket, SSE, or push of any kind) until the
  real-time work explicitly begins at the next crit. Until then, status
  reflects on page load only — don't add "just a small" live-update path
  ahead of that decision.
- **Do not invent decay/staleness thresholds.** The confirmed → stale →
  expired model is settled; the actual minute values are an open question
  pending real cycle-time data. If a number is needed to make something
  runnable, it must be clearly marked provisional in code and called out in
  `PROCESS.md` — never landed as if it were settled.
- **No login/authentication system yet.** Identity stays an anonymous or
  pseudonymous session token attached to each report. Don't build account
  creation, passwords, or verification without a new decision record.

## Persistence

- All state that matters must live in SQLite on the `/data` volume. Nothing
  load-bearing may exist only in server memory — it has to survive a
  restart or redeploy, since that's the one thing Crit 8 is actually
  checked on.
- **Validate `startedAt`/`expectedEndAt` as safe, positive integers before
  writing them.** A real incident during the crit 8 redeploy check: an
  unvalidated, oversized client timestamp got written to SQLite and
  `node:sqlite` cannot read that value back — the row 500'd on every
  future GET/PATCH, not just that one bad request. Any new field that
  stores a client-provided number needs the same guard before it reaches
  the database, not a try/catch after the fact.

## Keeping README.md, this file, and spec/ in agreement

- A claim added to `README.md`'s definition of good should either show up
  as a rule here (if it constrains how the app is built) or a test in
  `spec/` (if it's mechanically checkable) — or be named in the README as
  something only a person can judge. Don't let a claim exist in only one of
  the three.
