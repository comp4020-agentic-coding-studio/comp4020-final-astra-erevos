// Rabbit Room's visual-layer mapping — the same role
// src/lib/hall-view/otter-room-status-look.ts plays for Otter Room: pure,
// no Three.js or DOM dependency, so the (occupancy) -> visual mapping is
// easy to read and change without touching scene-graph code. Never feeds
// back into RabbitRoomState, the dashboard panel, SSE payloads, or report
// logic — those are untouched; this only re-renders them.
//
// Deliberately more restrained than it might look: see
// notes/adr/0005-rabbit-room-live-state.md, Decision 1/3 — this room has
// no activity field, because knowing whether the room is in use for group
// study or a shared meal has no decision-relevant value to a resident
// checking the app, and the two uses typically don't co-occur. The 3D
// scene must not quietly reintroduce that distinction on its own
// initiative: neither the figure count nor their poses may be readable as
// "specifically studying" or "specifically eating" — see
// rabbit-room-figures.ts's own note on why its one pose stays neutral.
// expectedEndAt plays no role here either — it never changes what the
// scene shows, still just "occupied" either way.
import type { RabbitRoomOccupancy } from "../types.ts";

export type RabbitRoomFigurePose = "seated" | "standing";

export interface RabbitRoomLook {
  /** How many low-poly figures to show, and in what pose. Empty = no one in the room (empty or unknown occupancy alike). */
  figures: RabbitRoomFigurePose[];
  /** 0–1 desaturation pulled over the whole room's materials — unknown only (no "stale" concept here, same as Otter Room). */
  desaturate: number;
  /** 0–1 dimming of the room's own lighting contribution — unknown only; empty/occupied are always 1 (full brightness). */
  dim: number;
}

// A small, deliberately neutral group — reads as "a few residents are
// sharing this room right now," compatible with either of the room's two
// real uses, never pinned to one. Three seated (spread around the long
// table, not clustered at one end) plus one standing is a believable
// "a small group is here" without reading as either "a lecture" or "a
// dinner party" specifically — and, same as every other facility's
// figures, purely decorative: never a real headcount, never derived from
// or fed back into any stored count (occupancy carries none).
const OCCUPIED_FIGURES: RabbitRoomFigurePose[] = ["seated", "seated", "seated", "standing"];

// Visual-only constants (not a decay threshold — see CLAUDE.md's "do not
// invent decay/staleness thresholds," which governs the stored model, not
// this presentation-only dial), same values Otter Room's own look uses
// for the same "absence of information, not broken" treatment.
const UNKNOWN_DESATURATE = 0.75;
const UNKNOWN_DIM = 0.55;

/**
 * Maps Rabbit Room's canonical state to a steady-state visual description.
 * `empty` always means no figures, but a normally-lit room — a real,
 * confirmed observation, not an absence of information, so it must not
 * look muted the way `unknown` does. `unknown` always means no figures
 * AND a muted room — the same treatment every other facility's own
 * unknown state gets, never "broken" or "failed to load."
 */
export function lookForRabbitRoom(occupancy: RabbitRoomOccupancy): RabbitRoomLook {
  const figures = occupancy === "occupied" ? OCCUPIED_FIGURES : [];
  const desaturate = occupancy === "unknown" ? UNKNOWN_DESATURATE : 0;
  const dim = occupancy === "unknown" ? UNKNOWN_DIM : 1;
  return { figures, desaturate, dim };
}
