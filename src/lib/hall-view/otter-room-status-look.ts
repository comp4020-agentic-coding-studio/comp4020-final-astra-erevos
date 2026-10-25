// Otter Room's visual-layer mapping — the same role
// src/lib/hall-view/status-look.ts plays for machines and
// aa-room-status-look.ts plays for AA Room: pure, no Three.js or DOM
// dependency, so the (occupancy) -> visual mapping is easy to read and
// change without touching scene-graph code. Never feeds back into
// OtterRoomState, the dashboard panel, SSE payloads, or report logic —
// those are untouched; this only re-renders them.
//
// Much simpler than AA Room's own look: see
// notes/adr/0004-otter-room-live-state.md, Decision 1/3 — there is no
// activity taxonomy here, no headcount, and expectedEndAt never changes
// what the scene shows (it's still just "occupied" either way). The one
// thing this module decides is how many figures to show and in what pose,
// purely decorative, never a real headcount.
import type { OtterRoomOccupancy } from "../types.ts";

export type OtterRoomFigurePose = "desk" | "standing";

export interface OtterRoomLook {
  /** How many low-poly figures to show, and in what pose. Empty = no one in the room (empty or unknown occupancy alike). */
  figures: OtterRoomFigurePose[];
  /** 0–1 desaturation pulled over the whole room's materials — unknown only (no "stale" concept here, unlike AA Room). */
  desaturate: number;
  /** 0–1 dimming of the room's own lighting contribution — unknown only; empty/occupied are always 1 (full brightness). */
  dim: number;
}

// A single person studying alone, or a small handful discussing around
// the table — restrained per the brief ("a small and quiet study room"),
// never a crowd. One desk-seated figure plus up to two standing/leaning
// figures covers both the "alone" and "small group" cases named in
// FINAL_PROJECT_SOURCE_OF_TRUTH.md without inventing a distinction the
// data model doesn't carry (occupancy has no "how many" signal at all).
const OCCUPIED_FIGURES: OtterRoomFigurePose[] = ["desk", "standing"];

// Visual-only constant (not a decay threshold — see CLAUDE.md's "do not
// invent decay/staleness thresholds," which governs the stored model, not
// this presentation-only dial): how strongly unknown pulls the scene
// toward grey/dim. Affects nothing stored or reported — only how the
// already-computed occupancy is rendered. No STALE_* constants exist here
// the way aa-room-status-look.ts has them, since Otter Room has no stale
// presentation state (ADR 0004, Decision 4: a plain confirmed-N-min-ago
// label, not a graded freshness).
const UNKNOWN_DESATURATE = 0.75;
const UNKNOWN_DIM = 0.55;

/**
 * Maps Otter Room's canonical state to a steady-state visual description.
 * `empty` always means no figures, but a normally-lit room — this is a
 * real, confirmed observation, not an absence of information, so it must
 * not look muted the way `unknown` does. `unknown` always means no
 * figures AND a muted room — the same "absence of information, not a
 * warning" treatment status-look.ts/aa-room-status-look.ts already give
 * their own unknown states, never "broken" or "failed to load."
 * expectedEndAt deliberately plays no role here — see ADR 0004: it never
 * changes figure count or introduces a new visual state, it's still just
 * "occupied."
 */
export function lookForOtterRoom(occupancy: OtterRoomOccupancy): OtterRoomLook {
  const figures = occupancy === "occupied" ? OCCUPIED_FIGURES : [];
  const desaturate = occupancy === "unknown" ? UNKNOWN_DESATURATE : 0;
  const dim = occupancy === "unknown" ? UNKNOWN_DIM : 1;
  return { figures, desaturate, dim };
}
