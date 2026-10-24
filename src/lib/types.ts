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
// field, activities a set of independent, optionally-combinable tags
// (v2's design correction — see the ADR), deliberately not the Machine
// shape above (no per-location rows, no expected-end-time concept — nobody
// can read an objective "end time" off a common-room hangout the way a
// washer's display gives one off a wash cycle).
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

// v2 (see notes/adr/0003-aa-room-live-state.md, "Design correction, v2"):
// AA Room's activities are independent and can co-occur — a single
// optional `activity` field couldn't represent "TV on while a different
// group plays pool," which is the room's ordinary case, not an edge
// case. "hanging-out" is new: it names what v1 left as unset/null
// ("occupied, nothing specific"), because once activities combine,
// "occupied" must always carry at least one tag — there's no longer a
// value-free way to mean "present, nothing louder going on." "event"
// remains the one exception: a formal, dorm-run activity that excludes
// everything else, enforced as array-exclusivity rather than a plain
// member of the set (see VALID_AA_ROOM_ACTIVITIES's order below, which
// is also the canonical sort/dedup order every stored and returned
// `activities` array is normalized into).
export type AaRoomActivity = "tv" | "pool" | "table-tennis" | "hanging-out" | "event";
export const VALID_AA_ROOM_ACTIVITIES: readonly AaRoomActivity[] = [
  "tv",
  "pool",
  "table-tennis",
  "hanging-out",
  "event",
];

export interface AaRoomState {
  occupancy: AaRoomOccupancy;
  // Canonically deduplicated and ordered per VALID_AA_ROOM_ACTIVITIES —
  // never the raw, as-submitted order a client's PATCH body carried.
  // empty/unknown occupancy always means activities is []; occupied
  // always means at least one tag; "event" always means exactly
  // ["event"] — see notes/adr/0003-aa-room-live-state.md's validity
  // constraints. The figure count the 3D scene shows for any of these is
  // purely decorative — never derived from or fed back into this array,
  // and never a real headcount.
  activities: AaRoomActivity[];
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

// Otter Room — Toad Live's third facility. See
// notes/adr/0004-otter-room-live-state.md: occupancy alone, no activity
// taxonomy (unlike AA Room, this small study room has no
// independent-simultaneous-activity fact to represent — ADR 0004,
// Decision 1/3), plus an optional expectedEndAt a resident may carry over
// from the door's paper sign-up sheet, mirroring Laundry's
// Machine.expectedEndAt in spirit (a real but never-fabricated signal)
// while adding a real, decided 4-hour ceiling Laundry's dryer has no
// equivalent of (see OTTER_ROOM_MAX_OCCUPIED_MS in src/lib/otter-room.ts).
export type OtterRoomOccupancy = "empty" | "occupied" | "unknown";
export const VALID_OTTER_ROOM_OCCUPANCIES: readonly OtterRoomOccupancy[] = [
  "empty",
  "occupied",
  "unknown",
];

// "unknown" is never a value a resident's PATCH may send — see ADR 0004,
// Decision 1 (same "unknown is not a reportable value" rule AA Room's
// occupancy already follows, ADR 0003 Decision 2): it represents "there
// is currently no fresh-enough observation," which only seeding or decay
// (never a report) can produce.
export type ReportableOtterRoomOccupancy = Extract<OtterRoomOccupancy, "empty" | "occupied">;
export const VALID_REPORTABLE_OTTER_ROOM_OCCUPANCIES: readonly ReportableOtterRoomOccupancy[] = [
  "empty",
  "occupied",
];

export interface OtterRoomState {
  occupancy: OtterRoomOccupancy;
  // Only ever non-null alongside occupancy "occupied" — a resident's own
  // carried-over estimate from the door's paper sign-up sheet, never
  // fabricated from an assumed session length (CLAUDE.md). Validated on
  // write to satisfy now < expectedEndAt <= now + 4h (ADR 0004, Decision
  // 2), and never inherited from a prior report — every PATCH fully
  // replaces this field (NULL when omitted or when occupancy is "empty"),
  // never merges into whatever the row previously held.
  expectedEndAt: number | null;
  confirmedAt: number | null;
  // Server-owned, starts at 1 — the exact same contract as
  // Machine.version/AaRoomState.version above.
  version: number;
  // No freshness field, unlike AaRoomState — ADR 0004, Decision 4: Otter
  // Room uses Laundry's plain "confirmed N minutes ago" label
  // (confirmedAt alone is enough for that), not AA Room's derived
  // fresh/stale/null three-way split.
}
