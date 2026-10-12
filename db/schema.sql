-- Initial schema. See CLAUDE.md for the rules this shape is required to
-- hold (fixed locations/types, the four statuses, out-of-order stickiness,
-- expected_end_at's nullable-for-both-types meaning, confirmed_at nullable
-- until first report, version starting at 1 and server-owned).
--
-- `version` here only covers a fresh database: CREATE TABLE IF NOT EXISTS
-- is a no-op against a table that already exists, so it does not retrofit
-- a pre-Crit-9 deployed row. src/lib/db.ts runs an explicit ALTER TABLE
-- migration at startup for that case — see notes/adr/0001-realtime-and-concurrent-updates.md.
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
