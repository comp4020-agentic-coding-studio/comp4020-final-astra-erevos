// Badger Room's visual-layer mapping — the same role
// src/lib/hall-view/rabbit-room-status-look.ts/weasel-room-status-look.ts
// play for their own facilities: pure, no Three.js or DOM dependency, so
// the (occupancy) -> visual mapping is easy to read and change without
// touching scene-graph code. Never feeds back into BadgerRoomState, the
// dashboard panel, SSE payloads, or report logic — those are untouched;
// this only re-renders them.
//
// Deliberately restrained, per notes/adr/0007-badger-room-live-state.md,
// Decision 1/3: this room has no activity field, because knowing which of
// its several real uses (formal meetings, interviews, special study,
// organised activities like Toad's Table) is actually happening has no
// decision-relevant value to a resident checking the app. The 3D scene
// must not quietly reintroduce that distinction on its own initiative:
// neither the figure count nor their poses may be readable as
// specifically "an interview," "a formally chaired meeting," "a meal," or
// "watching TV"/"playing piano" — see badger-room-figures.ts's own note
// on why its poses stay neutral. expectedEndAt plays no role here
// either — it never changes what the scene shows, still just "occupied"
// either way.
import type { BadgerRoomOccupancy } from "../types.ts";

export type BadgerRoomFigurePose = "seated" | "standing";

export interface BadgerRoomLook {
  /** How many low-poly figures to show, and in what pose. Empty = no one in the room (empty or unknown occupancy alike). */
  figures: BadgerRoomFigurePose[];
  /** 0–1 desaturation pulled over the whole room's materials — unknown only (no "stale" concept here, same as Otter/Rabbit/Weasel Room). */
  desaturate: number;
  /** 0–1 dimming of the room's own lighting contribution — unknown only; empty/occupied are always 1 (full brightness). */
  dim: number;
}

// A small, deliberately neutral group — reads as "a few residents are
// using this room right now," compatible with any of the room's several
// real uses, never pinned to one. Three seated (around the conference
// table, not clustered at one end) plus one standing nearby is a
// believable "the room is occupied" without reading as a meeting with a
// chair, an interview pair, a meal, or an audience — and, same as every
// other facility's figures, purely decorative: never a real headcount
// (the table seats ~10; this never implies all of them, or any fixed
// number, are filled), never derived from or fed back into any stored
// count (occupancy carries none).
const OCCUPIED_FIGURES: BadgerRoomFigurePose[] = ["seated", "seated", "seated", "standing"];

// Visual-only constants (not a decay threshold — see CLAUDE.md's "do not
// invent decay/staleness thresholds," which governs the stored model, not
// this presentation-only dial), same values every other facility's own
// look uses for the same "absence of information, not broken" treatment.
const UNKNOWN_DESATURATE = 0.75;
const UNKNOWN_DIM = 0.55;

/**
 * Maps Badger Room's canonical state to a steady-state visual
 * description. `empty` always means no figures, but a normally-lit
 * room — a real, confirmed observation, not an absence of information, so
 * it must not look muted the way `unknown` does. `unknown` always means
 * no figures AND a muted room — the same treatment every other facility's
 * own unknown state gets, never "broken" or "failed to load."
 */
export function lookForBadgerRoom(occupancy: BadgerRoomOccupancy): BadgerRoomLook {
  const figures = occupancy === "occupied" ? OCCUPIED_FIGURES : [];
  const desaturate = occupancy === "unknown" ? UNKNOWN_DESATURATE : 0;
  const dim = occupancy === "unknown" ? UNKNOWN_DIM : 1;
  return { figures, desaturate, dim };
}
