// Stage 3 — where each of the five real laundry rooms sits in the one
// shared 3D scene. This is a PURE VISUAL COMPOSITION for the Hall View
// diorama — a "3+2 staggered" arrangement chosen so all five rooms read
// clearly in one isometric frame at a reasonable per-room size (see the
// numeric derivation this was built from: a naive single row leaves each
// room at ~37% of its current standalone size, this staggered cluster at
// ~51%). It is NOT a floor plan and carries no claim about where these
// rooms actually sit in Toad Hall relative to one another — in
// particular, nothing here means A/B, C, E are "further back" or
// "upstairs" and F, G are "further forward" or "downstairs" in real life.
// Every room keeps the same world Y (0) and the same +Z orientation
// (nothing here ever sets a room's rotation) — the two things that
// visually separate the two rows are purely how far apart they are in Z
// and X, which the fixed isometric camera (scene.ts's ISO_VIEW_DIRECTION)
// renders as a natural front-to-back layering, the same way two rows of
// real objects placed at different depths look layered from an isometric
// angle without one actually being "above" the other.
import * as THREE from "three";
import type { Location } from "../types.ts";

export interface RoomPlacement {
  location: Location;
  /** World-space position for this room's buildRoom() group origin. */
  position: THREE.Vector3;
  /** Purely cosmetic prop mirroring (see room.ts) — breaks up the
   * "same room copy-pasted five times" look without touching geometry. */
  mirror: boolean;
}

export const ROOM_PLACEMENTS: readonly RoomPlacement[] = [
  { location: "A/B", position: new THREE.Vector3(-5.1, 0, -1.9), mirror: false },
  { location: "C", position: new THREE.Vector3(0, 0, -1.9), mirror: true },
  { location: "E", position: new THREE.Vector3(5.1, 0, -1.9), mirror: false },
  { location: "F", position: new THREE.Vector3(-2.55, 0, 1.9), mirror: true },
  { location: "G", position: new THREE.Vector3(2.55, 0, 1.9), mirror: false },
];
