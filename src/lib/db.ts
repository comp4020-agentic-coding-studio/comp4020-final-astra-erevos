import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The five real laundry locations and their fixed machine list. See
// CLAUDE.md: never a sixth location, never a machine list residents grow.
export const LOCATIONS = ["A/B", "C", "E", "F", "G"] as const;
export type Location = (typeof LOCATIONS)[number];
export type MachineType = "washer" | "dryer";
export type MachineStatus = "available" | "in-use" | "out-of-order" | "unknown";
export const VALID_STATUSES: readonly MachineStatus[] = [
  "available",
  "in-use",
  "out-of-order",
  "unknown",
];

export interface Machine {
  id: string;
  location: Location;
  type: MachineType;
  status: MachineStatus;
  startedAt: number | null;
  expectedEndAt: number | null;
  confirmedAt: number | null;
  reporterId: string | null;
}

interface MachineRow {
  id: string;
  location: Location;
  type: MachineType;
  status: MachineStatus;
  started_at: number | null;
  expected_end_at: number | null;
  confirmed_at: number | null;
  reporter_id: string | null;
}

// /data is the one thing the fixed Fly setup persists across a restart or
// redeploy (see fly.toml); DB_PATH points there in production and falls back
// to a local dev file otherwise.
const dbPath = process.env.DB_PATH ?? "./data/toadlive.db";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(readFileSync(join(process.cwd(), "db/schema.sql"), "utf8"));
seedIfEmpty();

function slug(location: Location): string {
  return location.toLowerCase().replace("/", "");
}

function seedIfEmpty(): void {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM machines").get() as {
    count: number;
  };
  if (count > 0) return;

  // Seed with status 'unknown' and everything else left NULL: these
  // machines have never actually been reported on, so confirmed_at must
  // stay null rather than claim a confirmation that never happened.
  const insert = db.prepare("INSERT INTO machines (id, location, type) VALUES (?, ?, ?)");
  for (const location of LOCATIONS) {
    insert.run(`${slug(location)}-washer`, location, "washer");
    insert.run(`${slug(location)}-dryer`, location, "dryer");
  }
}

// PROVISIONAL — see CLAUDE.md ("do not invent decay/staleness thresholds")
// and PROCESS.md: real cycle-time data to pick this properly doesn't exist
// yet. This number only exists so an in-use report with no expected_end_at
// (a dryer nobody estimated a time for) doesn't claim to be running
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
// reads (page load / GET), never as a push — see CLAUDE.md on real-time
// transport staying out of scope until that work explicitly begins.
function decayed(row: MachineRow): MachineRow {
  if (row.status !== "in-use") return row;

  const now = Date.now();
  const expired =
    row.expected_end_at !== null
      ? now > row.expected_end_at
      : row.started_at !== null && now - row.started_at > UNTIMED_IN_USE_DECAY_MS;
  if (!expired) return row;

  db.prepare(
    `UPDATE machines SET status = 'unknown', started_at = NULL, expected_end_at = NULL WHERE id = ?`,
  ).run(row.id);

  return { ...row, status: "unknown", started_at: null, expected_end_at: null };
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

// A report is a confirmation event: whatever status it sets, confirmed_at
// moves to now. started_at/expected_end_at only mean anything for
// 'in-use' and are cleared otherwise — see CLAUDE.md on expected_end_at
// never being fabricated from an assumed cycle length. out-of-order takes
// the same generic path and, having no timer, just carries confirmed_at
// forward; nothing here ever clears it automatically.
export function reportStatus(id: string, report: StatusReport): Machine | undefined {
  if (!getMachine(id)) return undefined;

  const startedAt = report.status === "in-use" ? report.startedAt ?? Date.now() : null;
  const expectedEndAt = report.status === "in-use" ? report.expectedEndAt ?? null : null;

  db.prepare(
    `UPDATE machines
     SET status = ?, started_at = ?, expected_end_at = ?, confirmed_at = ?, reporter_id = ?
     WHERE id = ?`,
  ).run(report.status, startedAt, expectedEndAt, Date.now(), report.reporterId ?? null, id);

  return getMachine(id);
}
