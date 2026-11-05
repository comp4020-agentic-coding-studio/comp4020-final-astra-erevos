// Rat Room's visual-layer mapping — the same role
// src/lib/hall-view/badger-room-status-look.ts/weasel-room-status-look.ts
// play for their own facilities: pure, no Three.js or DOM dependency, so
// the visual -> scene-look mapping is easy to read and change without
// touching scene-graph code. Never feeds back into any RatRoomSeatState,
// the dashboard panel, SSE payloads, or report logic — those are
// untouched; this only re-renders them.
//
// Design correction (notes/adr/0008-rat-room-live-state.md, "Design
// correction, v3"): this module used to take ONLY the already-derived
// three-valued room `visual`, deliberately never any individual seat's
// own state, per the ADR's original Decision 4/5 ("no A-J-to-figure
// mapping," "figure count never corresponds to occupied-seat count"). A
// real-person review of the room asked for the opposite: each seat's own
// state should visibly correspond to its own real workstation, so a
// resident can tell AT A GLANCE which of the ten seats are actually free
// from the 3D scene itself, not only from the panel's ten cards. This
// module now takes each seat's own occupancy too — a deliberate,
// documented reversal of the ADR's original "purely decorative, no
// mapping" stance, not an oversight. `visual` is still passed
// separately and still drives ONLY desaturate/dim (never figures) —
// every other facility's own "only unknown dims the room" rule is
// unchanged here.
import type { RatRoomSeatId, RatRoomSeatOccupancy, RatRoomSummary } from "../types.ts";

export interface RatRoomLook {
  /** Exactly the seats currently "occupied" — one seated figure per entry, placed at that seat's own real workstation (rat-room.ts's own SEAT_WORKSTATIONS map). Never "empty"/"unknown" seats — those show an empty chair, no figure. */
  occupiedSeats: RatRoomSeatId[];
  /** 0–1 desaturation pulled over the whole room's materials — derived-unknown only (no "stale" concept here, same as every other occupancy-only facility). */
  desaturate: number;
  /** 0–1 dimming of the room's own lighting contribution — derived-unknown only; derived-empty/occupied are always 1 (full brightness). */
  dim: number;
}

// Visual-only constants (not a decay threshold — see CLAUDE.md's "do not
// invent decay/staleness thresholds," which governs the stored model, not
// this presentation-only dial), same values every other facility's own
// look uses for the same "absence of information, not broken" treatment.
const UNKNOWN_DESATURATE = 0.75;
const UNKNOWN_DIM = 0.55;

/**
 * Maps each of Rat Room's ten seats' own occupancy, plus the room's
 * already-derived `visual`, to a steady-state visual description. A seat
 * shows a figure if and only if that SPECIFIC seat's own occupancy is
 * "occupied" — "empty" and "unknown" both show the same bare chair, no
 * visual distinction between them (an unconfirmed seat is not asserted
 * to be either free or in use, so it gets neither "confirmed empty"'s
 * nor "confirmed occupied"'s own signal — see the file's own top note).
 * `visual`'s role is unchanged from before this correction: only
 * `unknown` (no seat occupied, but at least one seat unknown) dims/
 * desaturates the WHOLE room — `empty` (all ten seats confirmed empty)
 * is a real, confirmed observation and stays fully lit, the same "only
 * absence-of-information looks muted" rule every other facility's own
 * look enforces.
 */
export function lookForRatRoom(
  seatOccupancies: ReadonlyMap<RatRoomSeatId, RatRoomSeatOccupancy>,
  visual: RatRoomSummary["visual"],
): RatRoomLook {
  const occupiedSeats: RatRoomSeatId[] = [];
  for (const [seat, occupancy] of seatOccupancies) {
    if (occupancy === "occupied") occupiedSeats.push(seat);
  }
  const desaturate = visual === "unknown" ? UNKNOWN_DESATURATE : 0;
  const dim = visual === "unknown" ? UNKNOWN_DIM : 1;
  return { occupiedSeats, desaturate, dim };
}
