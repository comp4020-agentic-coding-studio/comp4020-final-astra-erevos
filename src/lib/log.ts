// Crit 10's logging layer. See notes/adr/0002-identity-and-permissions.md.
//
// Deliberately narrow: only the events a pod demo narration actually
// needs are logged — a new session being created, and the outcome of
// every PATCH attempt, authenticated or not. No ordinary GETs, no SSE
// connects/reconnects, no routine page render. One line per event, plain
// `key=value` on stdout — picked up by `flyctl logs` with no extra
// infrastructure. This *is* the permanent instrumentation: no separate
// audit table, nothing that stops working once the crit ends.
//
// Never logs a raw cookie token, a token hash, or an internal session id
// (sessions.id) — only the pseudonym, which is drawn independently of the
// token (see src/lib/sessions.ts) and reveals nothing about the
// credential that authenticates its session.
//
// The format functions are pure (no console I/O) so the line shape is
// mechanically testable without capturing stdout; the log* functions are
// thin wrappers that actually emit.

const PREFIX = "[toadlive]";

// An ordered list of tuples, not an object: the field order a human reads
// during the crit narration is guaranteed by call-site order here, not by
// whatever order a generic object merge happens to produce.
function formatLine(fields: Array<[string, string | number]>): string {
  return [PREFIX, ...fields.map(([key, value]) => `${key}=${value}`)].join(" ");
}

export function formatSessionCreated(pseudonym: string): string {
  return formatLine([
    ["actor", pseudonym],
    ["action", "session_created"],
  ]);
}

export type ReportOutcome = "ok" | "conflict";

// A report that actually reached reportStatus() — status and version are
// both known by this point, whichever branch fired. `version` is the
// version the write itself produced on success, or the version it
// collided against on conflict — never a fresh read just to log an "old"
// value that wasn't otherwise needed.
export function formatReportOutcome(params: {
  actor: string;
  machine: string;
  status: string;
  result: ReportOutcome;
  version: number;
}): string {
  return formatLine([
    ["actor", params.actor],
    ["machine", params.machine],
    ["action", "report"],
    ["status", params.status],
    ["result", params.result],
    ["version", params.version],
  ]);
}

// A report rejected before reportStatus() ever ran. Deliberately carries
// no `status`: for a missing/unknown session the body may not even have
// been parsed yet, and for a client-actor-claim the point is that the
// claimed identity is being rejected, not that a status was invalid.
// `actor` is "(none)" only when there's no session at all; a rejection
// from an authenticated session (e.g. a forged reporterId) still names
// the real actor who attempted it, never the forged value.
export function formatReportRejected(params: { actor: string; machine: string; reason: string }): string {
  return formatLine([
    ["actor", params.actor],
    ["machine", params.machine],
    ["action", "report"],
    ["result", "rejected"],
    ["reason", params.reason],
  ]);
}

// AA Room's own report-outcome lines — same shape as the machine ones
// above, but naming the facility ("aa-room") instead of a machine id,
// since AA Room is one row, not a keyed resource. See
// notes/adr/0003-aa-room-live-state.md.
export function formatAaRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "aa-room"],
    ["action", "report"],
    ["occupancy", params.occupancy],
    ["result", params.result],
    ["version", params.version],
  ]);
}

export function formatAaRoomReportRejected(params: { actor: string; reason: string }): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "aa-room"],
    ["action", "report"],
    ["result", "rejected"],
    ["reason", params.reason],
  ]);
}

// Otter Room's own report-outcome lines — same shape as the AA Room pair
// above, naming the facility ("otter-room"). See
// notes/adr/0004-otter-room-live-state.md.
export function formatOtterRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "otter-room"],
    ["action", "report"],
    ["occupancy", params.occupancy],
    ["result", params.result],
    ["version", params.version],
  ]);
}

export function formatOtterRoomReportRejected(params: { actor: string; reason: string }): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "otter-room"],
    ["action", "report"],
    ["result", "rejected"],
    ["reason", params.reason],
  ]);
}

// Rabbit Room's own report-outcome lines — same shape as the Otter Room
// pair above, naming the facility ("rabbit-room"). See
// notes/adr/0005-rabbit-room-live-state.md.
export function formatRabbitRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "rabbit-room"],
    ["action", "report"],
    ["occupancy", params.occupancy],
    ["result", params.result],
    ["version", params.version],
  ]);
}

export function formatRabbitRoomReportRejected(params: { actor: string; reason: string }): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "rabbit-room"],
    ["action", "report"],
    ["result", "rejected"],
    ["reason", params.reason],
  ]);
}

// Weasel Room's own report-outcome lines — same shape as the Rabbit Room
// pair above, naming the facility ("weasel-room"). See
// notes/adr/0006-weasel-room-live-state.md.
export function formatWeaselRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "weasel-room"],
    ["action", "report"],
    ["occupancy", params.occupancy],
    ["result", params.result],
    ["version", params.version],
  ]);
}

export function formatWeaselRoomReportRejected(params: { actor: string; reason: string }): string {
  return formatLine([
    ["actor", params.actor],
    ["facility", "weasel-room"],
    ["action", "report"],
    ["result", "rejected"],
    ["reason", params.reason],
  ]);
}

export function logSessionCreated(pseudonym: string): void {
  console.log(formatSessionCreated(pseudonym));
}

export function logReportOutcome(params: {
  actor: string;
  machine: string;
  status: string;
  result: ReportOutcome;
  version: number;
}): void {
  console.log(formatReportOutcome(params));
}

export function logReportRejected(params: { actor: string; machine: string; reason: string }): void {
  console.log(formatReportRejected(params));
}

export function logAaRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): void {
  console.log(formatAaRoomReportOutcome(params));
}

export function logAaRoomReportRejected(params: { actor: string; reason: string }): void {
  console.log(formatAaRoomReportRejected(params));
}

export function logOtterRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): void {
  console.log(formatOtterRoomReportOutcome(params));
}

export function logOtterRoomReportRejected(params: { actor: string; reason: string }): void {
  console.log(formatOtterRoomReportRejected(params));
}

export function logRabbitRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): void {
  console.log(formatRabbitRoomReportOutcome(params));
}

export function logRabbitRoomReportRejected(params: { actor: string; reason: string }): void {
  console.log(formatRabbitRoomReportRejected(params));
}

export function logWeaselRoomReportOutcome(params: {
  actor: string;
  occupancy: string;
  result: ReportOutcome;
  version: number;
}): void {
  console.log(formatWeaselRoomReportOutcome(params));
}

export function logWeaselRoomReportRejected(params: { actor: string; reason: string }): void {
  console.log(formatWeaselRoomReportRejected(params));
}
