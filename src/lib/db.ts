import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  LOCATIONS,
  VALID_STATUSES,
  type Location,
  type Machine,
  type MachineStatus,
  type MachineType,
} from "./types.ts";

// Re-exported for every existing call site (index.astro, the API route) —
// the types/constants themselves live in types.ts now so a future realtime
// module can depend on the Machine shape without importing this module and
// creating a cycle with it. See notes/adr/0001-realtime-and-concurrent-updates.md.
export { LOCATIONS, VALID_STATUSES };
export type { Location, Machine, MachineStatus, MachineType };

interface MachineRow {
  id: string;
  location: Location;
  type: MachineType;
  status: MachineStatus;
  started_at: number | null;
  expected_end_at: number | null;
  confirmed_at: number | null;
  reporter_id: string | null;
  version: number;
}

// /data is the one thing the fixed Fly setup persists across a restart or
// redeploy (see fly.toml); DB_PATH points there in production and falls back
// to a local dev file otherwise.
const dbPath = process.env.DB_PATH ?? "./data/toadlive.db";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(readFileSync(join(process.cwd(), "db/schema.sql"), "utf8"));
migrateVersionColumn();
seedIfEmpty();

function slug(location: Location): string {
  return location.toLowerCase().replace("/", "");
}

// CREATE TABLE IF NOT EXISTS (db/schema.sql) only shapes a fresh database —
// it's a no-op against the `machines` table a pre-Crit-9 deploy already
// created on the real /data volume, which has no `version` column at all.
// Checked and applied once at startup, same spirit as the crit 8 lesson:
// a schema that only works on a fresh DB isn't actually proven against the
// real one.
function migrateVersionColumn(): void {
  const columns = db.prepare("PRAGMA table_info(machines)").all() as Array<{ name: string }>;
  const hasVersion = columns.some((column) => column.name === "version");
  if (!hasVersion) {
    db.exec("ALTER TABLE machines ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  }
}

function seedIfEmpty(): void {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM machines").get() as {
    count: number;
  };
  if (count > 0) return;

  // Seed with status 'unknown' and everything else left NULL: these
  // machines have never actually been reported on, so confirmed_at must
  // stay null rather than claim a confirmation that never happened.
  // version starts at 1 (the column default), not 0 — consistent with the
  // "safe positive integer" validation every client-supplied version is
  // held to.
  const insert = db.prepare("INSERT INTO machines (id, location, type) VALUES (?, ?, ?)");
  for (const location of LOCATIONS) {
    insert.run(`${slug(location)}-washer`, location, "washer");
    insert.run(`${slug(location)}-dryer`, location, "dryer");
  }
}

// PROVISIONAL — see CLAUDE.md ("do not invent decay/staleness thresholds")
// and PROCESS.md: real cycle-time data to pick this properly doesn't exist
// yet. This number only exists so an in-use report with no expected_end_at
// (a dryer nobody estimated an end time for) doesn't claim to be running
// forever; it is a placeholder, not a settled value, and must be revisited
// once real data is available.
const UNTIMED_IN_USE_DECAY_MS = 12 * 60 * 60 * 1000; // 12 hours

// Lazily expire an in-use report once it can no longer be trusted:
//  - with expected_end_at set, the moment that time passes we only know
//    the machine *was* running until then, not what's true now — no
//    guessed threshold needed, the report's own end time is the signal;
//  - with no expected_end_at, fall back to the provisional
//    UNTIMED_IN_USE_DECAY_MS window since started_at.
// available/out-of-order/unknown are never touched here — out-of-order is
// sticky (CLAUDE.md) and must only change via an explicit new report, and
// the user asked that available stay untouched too. This runs on ordinary
// reads (page load / GET), never as a push — it stays the one trigger for
// decay; nothing here changes that (see CLAUDE.md, real-time scope).
//
// A decay transition is a real, canonical mutation, not just a read-time
// display fix, so it increments `version` exactly like a resident's report
// does — a stale client PATCH that doesn't know decay already fired must
// not be able to silently resurrect the state decay just invalidated. The
// WHERE guard mirrors the resident-report path: it's not needed for
// correctness under node:sqlite's synchronous, single-process access, but
// it keeps "a canonical mutation only applies against the row it actually
// read" true everywhere, not just where a real race is possible.
function decayed(row: MachineRow): MachineRow {
  if (row.status !== "in-use") return row;

  const now = Date.now();
  const expired =
    row.expected_end_at !== null
      ? now > row.expected_end_at
      : row.started_at !== null && now - row.started_at > UNTIMED_IN_USE_DECAY_MS;
  if (!expired) return row;

  const { changes } = db
    .prepare(
      `UPDATE machines
       SET status = 'unknown', started_at = NULL, expected_end_at = NULL, version = version + 1
       WHERE id = ? AND status = 'in-use'`,
    )
    .run(row.id);

  // changes === 0 means something else already moved this row since it was
  // read (out of reach in a single synchronous process today, but the
  // row's current truth is one query away either way) — re-read rather
  // than assume our own stale view of it.
  if (changes === 0) {
    return db.prepare("SELECT * FROM machines WHERE id = ?").get(row.id) as unknown as MachineRow;
  }

  return { ...row, status: "unknown", started_at: null, expected_end_at: null, version: row.version + 1 };
}

function toMachine(row: MachineRow): Machine {
  return {
    id: row.id,
    location: row.location,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    expectedEndAt: row.expected_end_at,
    confirmedAt: row.confirmed_at,
    reporterId: row.reporter_id,
    version: row.version,
  };
}

export function getMachine(id: string): Machine | undefined {
  const row = db.prepare("SELECT * FROM machines WHERE id = ?").get(id) as
    | MachineRow
    | undefined;
  return row ? toMachine(decayed(row)) : undefined;
}

export function listMachines(): Machine[] {
  const rows = db.prepare("SELECT * FROM machines ORDER BY location, type").all() as unknown as MachineRow[];
  return rows.map((row) => toMachine(decayed(row)));
}

export interface StatusReport {
  status: MachineStatus;
  startedAt?: number | null;
  expectedEndAt?: number | null;
  reporterId?: string | null;
}

// Explicit tagged result rather than overloading `undefined` for two
// different failures: "no such machine" (404) and "your view was stale"
// (409) need different HTTP responses, and a caller shouldn't have to
// re-derive which one happened from a missing value.
export type UpdateResult =
  | { ok: true; machine: Machine }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "stale"; current: Machine };

// A report is a confirmation event: whatever status it sets, confirmed_at
// moves to now. started_at/expected_end_at only mean anything for
// 'in-use' and are cleared otherwise — see CLAUDE.md on expected_end_at
// never being fabricated from an assumed cycle length. out-of-order takes
// the same generic path and, having no timer, just carries confirmed_at
// forward; nothing here ever clears it automatically.
//
// The write is conditioned on `ifVersion`, the version the reporter's own
// view last saw, atomically in the same UPDATE: zero rows affected means
// either no such machine or a stale view, told apart below by re-reading.
// This is what makes the write safe against both another resident's
// report and the server's own lazy decay landing in between — see
// notes/adr/0001-realtime-and-concurrent-updates.md.
export function reportStatus(id: string, report: StatusReport, ifVersion: number): UpdateResult {
  const startedAt = report.status === "in-use" ? report.startedAt ?? Date.now() : null;
  const expectedEndAt = report.status === "in-use" ? report.expectedEndAt ?? null : null;

  const { changes } = db
    .prepare(
      `UPDATE machines
       SET status = ?, started_at = ?, expected_end_at = ?, confirmed_at = ?, reporter_id = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    )
    .run(report.status, startedAt, expectedEndAt, Date.now(), report.reporterId ?? null, id, ifVersion);

  if (changes === 1) {
    // Re-read rather than hand-build the result: this also applies decay
    // if the write itself (e.g. an already-past expectedEndAt) immediately
    // qualifies, so the response never claims a state the row doesn't hold.
    return { ok: true, machine: getMachine(id)! };
  }

  const current = getMachine(id);
  return current ? { ok: false, reason: "stale", current } : { ok: false, reason: "not-found" };
}
