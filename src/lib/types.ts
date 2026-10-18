// Shared machine types and laundry facts, kept separate from src/lib/db.ts
// so a future realtime module (which needs the Machine shape for its
// subscriber callbacks) can depend on this without creating an import
// cycle with the database layer that will call into it to broadcast. See
// notes/adr/0001-realtime-and-concurrent-updates.md.

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

// reporterId is deliberately NOT part of this public shape. As of Crit 10
// it's an internal actor id (sessions.id) — see
// notes/adr/0002-identity-and-permissions.md — and must never appear in a
// GET/PATCH response or an SSE event. Nothing in the client reads it
// today, so dropping it from every response is a pure reduction in
// exposed surface, not a UI change. If a later crit wants to show "last
// reported by <pseudonym>", that's a new field carrying the pseudonym,
// not this one reinstated.
export interface Machine {
  id: string;
  location: Location;
  type: MachineType;
  status: MachineStatus;
  startedAt: number | null;
  expectedEndAt: number | null;
  confirmedAt: number | null;
  // Server-owned, starts at 1. Every persisted mutation — a resident's
  // report or a lazy decay transition alike — increments it atomically as
  // part of that same write. A client only ever echoes a version it saw;
  // it never sets one. See CLAUDE.md and the ADR above.
  version: number;
}

// AA Room — Toad Live's second facility. See
// notes/adr/0003-aa-room-live-state.md: occupancy is the required primary
// field, activity a single optional enrichment, deliberately not the
// Machine shape above (no per-location rows, no expected-end-time concept
// — nobody can read an objective "end time" off a common-room hangout the
// way a washer's display gives one off a wash cycle).
export type AaRoomOccupancy = "empty" | "occupied" | "unknown";
export const VALID_AA_ROOM_OCCUPANCIES: readonly AaRoomOccupancy[] = [
  "empty",
  "occupied",
  "unknown",
];

// "unknown" is never a value a resident's PATCH may send — see the ADR's
// Decision 2, "unknown is not a reportable value": it represents "there
// is currently no fresh-enough observation," which only seeding or decay
// (never a report) can produce. A client sending "unknown" is rejected
// 400, not silently accepted or coerced.
export type ReportableAaRoomOccupancy = Extract<AaRoomOccupancy, "empty" | "occupied">;
export const VALID_REPORTABLE_AA_ROOM_OCCUPANCIES: readonly ReportableAaRoomOccupancy[] = [
  "empty",
  "occupied",
];

export type AaRoomActivity = "tv" | "pool" | "table-tennis" | "event";
export const VALID_AA_ROOM_ACTIVITIES: readonly AaRoomActivity[] = [
  "tv",
  "pool",
  "table-tennis",
  "event",
];

export interface AaRoomState {
  occupancy: AaRoomOccupancy;
  activity: AaRoomActivity | null;
  confirmedAt: number | null;
  // Server-owned, starts at 1 — the exact same contract as Machine.version
  // above (CLAUDE.md, ADR 0001): every persisted mutation increments it
  // atomically; a client only ever echoes a version it saw.
  version: number;
  // Derived at read time from (occupancy, confirmedAt, now) — see
  // src/lib/freshness.ts. Never stored, never accepted from a client.
  // null means there is currently no fresh-enough observation to grade
  // (occupancy is "unknown", whether from the initial seed or from decay
  // having already fired).
  freshness: "fresh" | "stale" | null;
}
