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

export interface Machine {
  id: string;
  location: Location;
  type: MachineType;
  status: MachineStatus;
  startedAt: number | null;
  expectedEndAt: number | null;
  confirmedAt: number | null;
  reporterId: string | null;
  // Server-owned, starts at 1. Every persisted mutation — a resident's
  // report or a lazy decay transition alike — increments it atomically as
  // part of that same write. A client only ever echoes a version it saw;
  // it never sets one. See CLAUDE.md and the ADR above.
  version: number;
}
