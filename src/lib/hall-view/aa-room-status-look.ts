// Stage 4 — AA Room's visual-layer mapping, the same role
// src/lib/hall-view/status-look.ts plays for machines: pure, no Three.js
// or DOM dependency, so the (occupancy, activities, freshness) -> visual
// mapping is easy to read and change without touching scene-graph code.
// Never feeds back into AaRoomState, the dashboard panel, SSE payloads,
// or report logic — those are untouched; this only re-renders them.
//
// Design brief (confirmed, not this module's own invention): the scene
// must show what's happening NOW, continuously — not "played an
// animation once when the state last changed." A resident opening the
// page while AA Room has been "occupied + pool" for an hour must see
// exactly that at a glance, the same way an in-use washer's spinning
// drum is always spinning, never a one-shot that already finished. Every
// field below is therefore a steady-state description (how many figures,
// where, which loops are running), not an event to play once.
//
// v2 (notes/adr/0003-aa-room-live-state.md, "Design correction, v2"):
// activities are independent and can co-occur — tv/pool/table-tennis/
// hanging-out each contribute their own figures and flags independently,
// unioned together; "event" is the one exception, forcing a busier,
// whole-room figure set with every other zone's animation stopped,
// exactly mirroring the stored state's own exclusivity rule (event is
// never actually combined with anything else, but this function stays
// defensively correct even if it somehow were handed a mixed array).
// Every figure count below remains purely decorative — never a real
// headcount, never written back to AaRoomState.
import type { AaRoomActivity, AaRoomOccupancy } from "../types.ts";

export type AaRoomFreshness = "fresh" | "stale" | null;

export type FigurePose = "sofa" | "pool" | "table-tennis" | "tv" | "standing" | "hangout";

export interface AaRoomLook {
  /** How many low-poly figures to show, and where/how (see FigurePose). Empty array = no one in the room. */
  figures: FigurePose[];
  /** TV screen gets its own steady, gentle emissive flicker (same technique as a machine's unknown-status LED flicker) — only when "tv" is in activities. */
  tvOn: boolean;
  /** Pool cue/arm makes a slow, restrained continuous loop — only when "pool" is in activities. Never a one-shot. */
  poolActive: boolean;
  /** Paddle/ball make a simple continuous loop — only when "table-tennis" is in activities. Never a one-shot. */
  tableTennisActive: boolean;
  /** 0–1 desaturation pulled over the whole room's materials — stale pulls partway, unknown pulls further. Mirrors status-look.ts's own `desaturate` field and intent. */
  desaturate: number;
  /** 0–1 dimming of the room's own lighting contribution — stale/unknown only; fresh is always 1 (full brightness). */
  dim: number;
}

// Figure counts per activity — deliberately small and restrained per the
// brief ("not a party with particle effects"). Each activity contributes
// its own figures independently; "event" replaces the whole set rather
// than adding to it (see lookForAaRoom's event branch).
//
// "hangout"/"tv" are deliberately DIFFERENT poses/figures from each
// other and from every other activity, even though both can be active at
// once in the sofa/TV side of the room: v1's TV_FIGURES used to reuse the
// exact same two slot positions SOFA_FIGURES did, which would place a
// hanging-out figure and a TV-watching figure on top of each other now
// that both can be true simultaneously. aa-room.ts (hall-view) gives
// "hangout" its own slots, separate from "tv"'s.
const HANGOUT_FIGURES: FigurePose[] = ["hangout", "hangout"];
const TV_FIGURES: FigurePose[] = ["tv", "tv"];
const POOL_FIGURES: FigurePose[] = ["pool", "standing"];
const TABLE_TENNIS_FIGURES: FigurePose[] = ["table-tennis", "table-tennis"];
const EVENT_FIGURES: FigurePose[] = ["sofa", "standing", "standing", "pool"];

// PROVISIONAL visual-only constants (not a decay threshold — see
// notes/adr/0003-aa-room-live-state.md and CLAUDE.md's "do not invent
// decay/staleness thresholds," which governs the stored freshness model,
// not this presentation-only dial): how strongly stale/unknown pull the
// scene toward grey/dim. These affect nothing stored or reported — only
// how the already-computed freshness value is rendered.
const STALE_DESATURATE = 0.35;
const STALE_DIM = 0.75;
const UNKNOWN_DESATURATE = 0.75;
const UNKNOWN_DIM = 0.55;

/**
 * Maps AA Room's canonical state to a steady-state visual description.
 * `unknown` occupancy always means no figures and a muted room — not
 * "broken," the same "absence of information, not a warning" treatment
 * status-look.ts gives a machine's own `unknown` status. Freshness never
 * changes WHICH figures/activities show — only desaturate/dim, layered on
 * top of whatever occupancy/activities already determined (a stale
 * "occupied + pool" room still shows people playing pool, just dimmer).
 */
export function lookForAaRoom(
  occupancy: AaRoomOccupancy,
  activities: readonly AaRoomActivity[],
  freshness: AaRoomFreshness,
): AaRoomLook {
  let figures: FigurePose[] = [];
  let tvOn = false;
  let poolActive = false;
  let tableTennisActive = false;

  if (occupancy === "unknown" || occupancy === "empty") {
    figures = [];
  } else if (activities.includes("event")) {
    // Event is exclusive by stored-state contract (the API never persists
    // it alongside anything else), but this branch doesn't rely on that:
    // it unconditionally overrides every other activity's figures/flags,
    // so a busier whole-room look and "every zone animation stops" holds
    // even if ever handed a technically-invalid mixed array.
    figures = EVENT_FIGURES;
  } else {
    // Independent activities union together — each contributes its own
    // figures/flag, unaffected by which others are also present.
    if (activities.includes("tv")) {
      figures = [...figures, ...TV_FIGURES];
      tvOn = true;
    }
    if (activities.includes("pool")) {
      figures = [...figures, ...POOL_FIGURES];
      poolActive = true;
    }
    if (activities.includes("table-tennis")) {
      figures = [...figures, ...TABLE_TENNIS_FIGURES];
      tableTennisActive = true;
    }
    if (activities.includes("hanging-out")) {
      figures = [...figures, ...HANGOUT_FIGURES];
    }
  }

  const desaturate = occupancy === "unknown" ? UNKNOWN_DESATURATE : freshness === "stale" ? STALE_DESATURATE : 0;
  const dim = occupancy === "unknown" ? UNKNOWN_DIM : freshness === "stale" ? STALE_DIM : 1;

  return { figures, tvOn, poolActive, tableTennisActive, desaturate, dim };
}
