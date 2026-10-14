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
