-- Initial schema. See CLAUDE.md for the rules this shape is required to
-- hold (fixed locations/types, the four statuses, out-of-order stickiness,
-- expected_end_at's nullable-for-both-types meaning, confirmed_at nullable
-- until first report, version starting at 1 and server-owned).
--
-- `version` here only covers a fresh database: CREATE TABLE IF NOT EXISTS
-- is a no-op against a table that already exists, so it does not retrofit
-- a pre-Crit-9 deployed row. src/lib/db.ts runs an explicit ALTER TABLE
-- migration at startup for that case — see notes/adr/0001-realtime-and-concurrent-updates.md.
-- reporter_id (below) references sessions.id (the internal actor id) as of
-- Crit 10 — never a client-asserted string. See
-- notes/adr/0002-identity-and-permissions.md. No FOREIGN KEY: this
-- codebase never sets PRAGMA foreign_keys = ON, so one isn't enforced here
-- either; that's a separate decision this schema doesn't make.
CREATE TABLE IF NOT EXISTS machines (
  id               TEXT PRIMARY KEY,
  location         TEXT NOT NULL CHECK (location IN ('A/B', 'C', 'E', 'F', 'G')),
  type             TEXT NOT NULL CHECK (type IN ('washer', 'dryer')),
  status           TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (status IN ('available', 'in-use', 'out-of-order', 'unknown')),
  started_at       INTEGER,
  expected_end_at  INTEGER,
  confirmed_at     INTEGER,
  reporter_id      TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);

-- Crit 10: server-issued pseudonymous browser sessions. See
-- notes/adr/0002-identity-and-permissions.md.
--
-- Unlike `version` above, this is a wholly new table, not a new column on
-- one that already exists elsewhere — CREATE TABLE IF NOT EXISTS is
-- sufficient on its own against the real /data database exactly as it is
-- against a fresh one. No ALTER TABLE / sqlite_master migration needed,
-- unlike migrateVersionColumn() in src/lib/db.ts.
--
-- token_hash: sha256 of the high-entropy secret token the browser's
-- cookie carries. The raw token itself is never stored — only its hash,
-- so a leaked database never discloses a replayable credential.
-- id: the internal actor id machines.reporter_id references — never sent
-- to a client, never exposed in a public API/SSE response, never logged.
-- pseudonym: the only one of the three a person or a log line ever sees
-- (e.g. "Toad-7F3A9C") — generated independently of token_hash, not
-- derived from or truncated out of it.
-- Deliberately minimal: no last_seen_at. It would only record the
-- timestamp of the last authenticated request, not prove a session is
-- currently "active," and presence ("who else is here") is out of scope
-- this crit — see the ADR. Adding a write on every request to populate a
-- field nothing reads yet is cost without a decision behind it.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  pseudonym   TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

-- AA Room: Toad Live's second facility. See
-- notes/adr/0003-aa-room-live-state.md. A single row (the room has no
-- sub-locations the way `machines` has five) — id is a fixed constant,
-- not something more than one row could ever carry. No started_at/
-- expected_end_at columns: unlike a washer/dryer, nothing about a common
-- room gives any report an objective end time, so those columns would
-- exist with no way to ever populate them honestly (see the ADR,
-- Decision 3). reporter_id references sessions.id, same meaning as
-- machines.reporter_id (ADR 0002) — never a client-asserted value.
--
-- activities (v2 — "Design correction, v2" in the ADR): a JSON-encoded
-- array of AaRoomActivity strings, replacing v1's single `activity`
-- column, because the room's real activities (tv/pool/table-tennis/
-- hanging-out) are independent and can co-occur. A JSON TEXT column
-- rather than a join table — this is one row with no relational query
-- need, so a second table would be pure plumbing. All of "non-empty iff
-- occupied," "event iff alone," and "deduplicated/canonically ordered"
-- live in src/lib/aa-room.ts, same as v1's "activity only set when
-- occupancy = 'occupied'" did — SQLite CHECK can't express any of this
-- against a JSON column either. A fresh database only ever sees this
-- column — the old `activity` column and its migration path
-- (migrateAaRoomActivitiesColumn() in src/lib/aa-room.ts) exist only to
-- bring an already-deployed pre-v2 /data volume forward; this
-- CREATE TABLE IF NOT EXISTS never creates that column at all.
CREATE TABLE IF NOT EXISTS aa_room (
  id            TEXT PRIMARY KEY DEFAULT 'aa-room',
  occupancy     TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  activities    TEXT NOT NULL DEFAULT '[]',
  confirmed_at  INTEGER,
  reporter_id   TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

-- Otter Room: Toad Live's third facility. See
-- notes/adr/0004-otter-room-live-state.md. A single row (the room has no
-- sub-locations the way `machines` has five), same shape as `aa_room`. No
-- `activities` column: unlike AA Room, nothing about this small study room
-- calls for an independent-simultaneous-activity taxonomy (ADR 0004,
-- Decision 1/3) — occupancy alone, plus an optional expected_end_at, is
-- the whole model. reporter_id references sessions.id, same meaning as
-- machines.reporter_id/aa_room.reporter_id (ADR 0002) — never a
-- client-asserted value.
--
-- expected_end_at is a resident's own optional carried-over estimate from
-- the door's paper sign-up sheet — never fabricated by the app (CLAUDE.md)
-- — and, unlike a dryer's, is capped on write at confirmed_at + 4 hours
-- (ADR 0004, Decision 2): the 4-hour figure is a real Toad Hall community
-- norm, not a provisional placeholder standing in for missing data.
CREATE TABLE IF NOT EXISTS otter_room (
  id              TEXT PRIMARY KEY DEFAULT 'otter-room',
  occupancy       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (occupancy IN ('empty', 'occupied', 'unknown')),
  expected_end_at INTEGER,
  confirmed_at    INTEGER,
  reporter_id     TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
