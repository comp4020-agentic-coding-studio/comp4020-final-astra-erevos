// Rat Room's visual-layer mapping — the same role
// src/lib/hall-view/badger-room-status-look.ts/weasel-room-status-look.ts
// play for their own facilities: pure, no Three.js or DOM dependency, so
// the visual -> scene-look mapping is easy to read and change without
// touching scene-graph code. Never feeds back into any RatRoomSeatState,
// the dashboard panel, SSE payloads, or report logic — those are
// untouched; this only re-renders them.
//
// STRUCTURALLY DIFFERENT FROM EVERY SIBLING ROOM'S OWN STATUS-LOOK FILE:
// this module takes the ALREADY-DERIVED three-valued room `visual`
// ("empty" | "occupied" | "unknown" — summarizeRatRoomSeats() in
// src/lib/types.ts), never a single room's own occupancy and never any
// of the ten individual seats' own states. See
// notes/adr/0008-rat-room-live-state.md, Decision 4: the 3D scene is one
// more consumer of the same purely-derived aggregate the panel's summary
// line already uses, not a second place that re-derives (or, worse,
// persists) a room-level fact. There is no occupiedCount/emptyCount/
// unknownCount parameter here on purpose — this file must never read
// exact counts, only the one already-reduced `visual` value, so it
// structurally cannot vary its look by how many seats are occupied.
import type { RatRoomSummary } from "../types.ts";

export type RatRoomFigurePose = "seated" | "standing";

export interface RatRoomLook {
  /** How many low-poly figures to show, and in what pose. Empty = no one visibly using the room (derived-empty or derived-unknown alike). */
  figures: RatRoomFigurePose[];
  /** 0–1 desaturation pulled over the whole room's materials — derived-unknown only (no "stale" concept here, same as every other occupancy-only facility). */
  desaturate: number;
  /** 0–1 dimming of the room's own lighting contribution — derived-unknown only; derived-empty/occupied are always 1 (full brightness). */
  dim: number;
}

// A small, deliberately neutral group — reads as "a few residents are
// using the room right now," never a headcount and never tied to any
// specific seat. Two seated (at different, unlabeled workstations) plus
// one standing nearby is a believable "the room is in use" without
// implying exactly how many of the ten seats are occupied — the same
// "purely decorative, never a real count" rule every other facility's
// own figures already follow, here doubly true since this room's own
// figure count must not vary with occupiedCount even in principle (ADR
// 0008, Decision 5: "3D decorative figure count also doesn't correspond
// to occupied-seat count").
const OCCUPIED_FIGURES: RatRoomFigurePose[] = ["seated", "seated", "standing"];

// Visual-only constants (not a decay threshold — see CLAUDE.md's "do not
// invent decay/staleness thresholds," which governs the stored model, not
// this presentation-only dial), same values every other facility's own
// look uses for the same "absence of information, not broken" treatment.
const UNKNOWN_DESATURATE = 0.75;
const UNKNOWN_DIM = 0.55;

/**
 * Maps Rat Room's already-derived room `visual` to a steady-state visual
 * description. `empty` always means no figures, but a normally-lit
 * room — a real, confirmed observation (all ten seats confirmed empty),
 * not an absence of information, so it must not look muted the way
 * `unknown` does. `unknown` always means no figures AND a muted room —
 * the same treatment every other facility's own unknown state gets,
 * never "broken" or "failed to load," and covers BOTH "all ten seats
 * genuinely unknown" and "no seat occupied, but at least one unknown" —
 * the honest-middle case ADR 0008, Decision 4 describes — identically:
 * this function only ever sees the one already-reduced `visual` value,
 * never which specific combination of seats produced it.
 */
export function lookForRatRoom(visual: RatRoomSummary["visual"]): RatRoomLook {
  const figures = visual === "occupied" ? OCCUPIED_FIGURES : [];
  const desaturate = visual === "unknown" ? UNKNOWN_DESATURATE : 0;
  const dim = visual === "unknown" ? UNKNOWN_DIM : 1;
  return { figures, desaturate, dim };
}
