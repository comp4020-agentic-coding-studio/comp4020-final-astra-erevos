// Stage 4 — AA Room's 3D diorama. Same cutaway low-poly visual language
// as src/lib/hall-view/room.ts (floor planks, open-front walls, warm
// palette pulled from the app's existing CSS custom properties) — this
// is a second room template, not a different visual system. Unlike
// room.ts, there is exactly one of these (AA Room has no sub-locations),
// so there's no hall-layout.ts-style placement grid: one buildAaRoom()
// call, framed the same way Laundry's overview is (see scene.ts).
//
// Layout v5 (user-specified, not this file's own invention) — a 7.2 x 5.6
// footprint, three rows, north (back wall, camera-visible) at the top:
//  - Row 1, against the back wall, left to right: a staff-only kitchen
//    door (a plain doorway, no furniture behind it — AA Room's kitchen is
//    out of scope), a WIDENED bookshelf (two shelving units, not one —
//    v4's single unit left an odd gap once the main door moved), and the
//    main door, now immediately right of the shelf (moved left from v4's
//    position, which left it oddly far from everything else on the wall).
//  - A third door sits on the west wall, aligned with the pool table's own
//    depth (not the bookshelf's, as in v4 — "大致和桌球在一条线上").
//  - Row 2: two study/dining tables, ROTATED to match the pool table's own
//    portrait orientation (v4 left them in their original landscape
//    orientation, inconsistent with the room's other rotated tables),
//    stacked front-to-back under the shelf; table tennis under the main
//    door, its net/ball/figure slots all re-derived for the group's own
//    rotation (the TABLE itself was already correctly oriented in v4, but
//    the net stayed perpendicular to the wrong axis and the figures stood
//    at the long sides instead of the short ends).
//  - Row 3: three zones, pool now sitting meaningfully closer to the movie
//    zone than to karaoke (v4 had it roughly equidistant, which read as
//    "just placed in the middle" rather than a deliberate choice):
//     - Movie zone: shrunk floor/furniture footprint (v4's was
//       disproportionately large for what's actually a small corner), TV
//       wall-mounted with a real stand/table under it (not floating), and
//       its on-screen flicker glow now clipped to the screen's own visible
//       extent (a stray full-size emissive plane previously spilled past
//       the mesh everyone could actually see it occupy).
//     - Pool table: portrait orientation, unchanged from v4.
//     - Karaoke zone: THREE SEPARATE sofas with real gaps between them
//       (v4's sofas were flush, reading as one continuous wraparound
//       bench, not three distinct pieces), a stand/table under the screen
//       (matching the movie zone's own stand), and — since this screen
//       faces the camera rather than the room (a deliberate tradeoff the
//       karaoke backdrop's own camera-visibility constraint forces, see
//       below) — no glow at all when "on"; a couple of floating music
//       notes above the singing figures signal the activity instead,
//       since a camera-facing glow on a screen that's supposed to face
//       away from the camera would misread as the screen itself glowing
//       toward the viewer.
//  Matching the facility's real, already-decided furniture
//  (notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md §3) plus karaoke, confirmed as
//  a real additional fixture (notes/adr/0003-aa-room-live-state.md,
//  "Design correction, v3"), with v4 and this v5 pass correcting the
//  layout's geometry against the room's actual floor plan (same ADR,
//  "Design correction, v4"/"v5"). No per-zone camera — the brief is
//  explicit that this room gets one fixed overview, never an activity-
//  specific shot (see notes on why: that would need re-deriving
//  camera-fit.ts-style framing per activity and works against the "fixed
//  diorama, not a navigable game" identity the whole Hall View has kept).
import * as THREE from "three";
import type { AaRoomActivity, AaRoomOccupancy } from "../types.ts";
import { buildFigure, type FigureHandle } from "./aa-room-figures.ts";
import { lookForAaRoom, type AaRoomFreshness, type FigurePose } from "./aa-room-status-look.ts";

export interface AaRoomHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives the TV flicker, pool/table-tennis loops, and figure idle sway. Caller skips calling this under reduced motion (see scene.ts), same convention as machine-mesh.ts's update(). */
  update(elapsedSeconds: number): void;
  /** Applies a new canonical AA Room state's look — rebuilds which figures are present (cheap: a handful of boxes/spheres, not loaded assets) and sets TV/pool/table-tennis loop flags and desaturate/dim. `activities` may hold any combination of tv/pool/table-tennis/hanging-out, or exactly ["event"] — see notes/adr/0003-aa-room-live-state.md. */
  applyState(occupancy: AaRoomOccupancy, activities: readonly AaRoomActivity[], freshness: AaRoomFreshness): void;
}

const ROOM_WIDTH = 7.2;
const ROOM_DEPTH = 5.6;

export function buildAaRoom(): AaRoomHandle {
  const group = new THREE.Group();
  group.name = "aa-room";

  // Floor + plank lines — identical technique to room.ts's, sized for
  // AA Room's larger single-room footprint (a common room, not a
  // laundry alcove).
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a380, roughness: 0.85 });
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, 0.02), plankMaterial);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(0, 0.001, i * 0.55);
    group.add(plank);
  }

  // Walls — same open-front cutaway shape as room.ts, EXCEPT the back
  // wall (now carrying TWO door openings: the staff-only kitchen door and
  // the main door) and the west wall (now carrying a third door) — see
  // this file's own top note. Every opening uses the same "open border,
  // nothing solid in the gap" construction: solid wall segments either
  // side of each gap, a lintel strip above it, and a frame (jambs +
  // header) sitting just forward of the wall plane — the same technique
  // Otter Room's window settled on after an earlier box-frame attempt
  // occluded its own glass (otter-room.ts's own door/window notes).
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf6efe1, roughness: 0.9 });
  const doorFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.6 });
  const WALL_HEIGHT = 2.4;
  // Shrunk from 2.0 — AA Room is the only facility with real wall openings
  // (every other room's own "door" is a floor threshold on its open front,
  // not a wall cut) and a first version sized these openings far larger
  // than that scale, reading as oversized/jarring next to the rest of the
  // app's own door language ("AA ROOM的门还是太大了，你改成otter room等其他
  // 房间统一用的小门吧"). The wall-opening construction itself stays —
  // these walls are genuinely opaque, unlike the other rooms' always-open
  // front — only the dimensions shrink.
  const DOOR_HEIGHT = 1.8;
  const DOOR_FRAME_DEPTH = 0.06;
  const doorLintelHeight = WALL_HEIGHT - DOOR_HEIGHT;

  // Pure segment math — given a wall's half-length and a sorted list of
  // door gaps along its own local axis, returns the solid segments
  // between them. Axis/orientation-agnostic so both the back wall (two
  // gaps, local axis X) and the west wall (one gap, local axis Z) share
  // the same derivation instead of two hand-duplicated calculations.
  function wallSegments(halfLength: number, gaps: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
    const bounds = [-halfLength, ...gaps.flatMap(([left, right]) => [left, right]), halfLength];
    const segments: Array<[number, number]> = [];
    for (let i = 0; i < bounds.length; i += 2) {
      const left = bounds[i]!;
      const right = bounds[i + 1]!;
      segments.push([(left + right) / 2, right - left]);
    }
    return segments;
  }

  // --- Back wall (north, z=-ROOM_DEPTH/2): kitchen door (west end), the
  // bookshelf's own wall span (two shelving units — see the shelf's own
  // build code below — WITH a real gap between them, not flush: a v5
  // attempt built them flush, so the study table meant to sit in that
  // "gap" actually fell inside the shelf's own combined solid body), then
  // the main door, immediately right of the shelf's own right edge — the
  // user's own original instruction, "书架右边就是这扇门". A v6 attempt
  // wrongly blamed this dependency for the movie-zone door-through-the-TV
  // bug and reverted the main door to an independent, east-wall-anchored
  // formula — but that bug was actually the WEST door's own Z position
  // (see that door's own note below), unrelated to the main door's X.
  // Reverting the main door away from the shelf left a long, empty
  // stretch of the back wall with nothing in it between the shelf and the
  // door, and (once table tennis also moved to its own independent spot
  // near the east wall) crowded the door and the table together in the
  // room's own corner where "书架旁边的位置" clearly did not mean the main
  // door to sit. Restored the shelf-dependent formula; table tennis's own
  // position (below) is independent of the door's, so moving the door back
  // here doesn't drag the table along with it. ---
  const KITCHEN_DOOR_WIDTH = 0.52; // shrunk alongside DOOR_HEIGHT — see that constant's own note
  const KITCHEN_DOOR_X = -ROOM_WIDTH / 2 + 0.55; // left edge 0.2 clear of the west wall (checked numerically before this was written)

  const SHELF_UNIT_WIDTH = 0.9;
  const SHELF_UNIT_GAP = 0.15; // a real gap between the two shelving units — see the shelf-vs-table bug note above
  const SHELF_LEFT_EDGE = KITCHEN_DOOR_X + KITCHEN_DOOR_WIDTH / 2 + 0.35;
  const SHELF_UNIT1_X = SHELF_LEFT_EDGE + SHELF_UNIT_WIDTH / 2;
  const SHELF_UNIT2_X = SHELF_UNIT1_X + SHELF_UNIT_WIDTH + SHELF_UNIT_GAP;
  const SHELF_RIGHT_EDGE = SHELF_UNIT2_X + SHELF_UNIT_WIDTH / 2;

  const MAIN_DOOR_WIDTH = 0.68; // shrunk alongside DOOR_HEIGHT — see that constant's own note
  const MAIN_DOOR_GAP_FROM_SHELF = 0.15; // a real gap, not flush — avoids the door jamb and shelf body clipping into each other
  const MAIN_DOOR_X = SHELF_RIGHT_EDGE + MAIN_DOOR_GAP_FROM_SHELF + MAIN_DOOR_WIDTH / 2;

  const backWallGaps: Array<[number, number]> = [
    [KITCHEN_DOOR_X - KITCHEN_DOOR_WIDTH / 2, KITCHEN_DOOR_X + KITCHEN_DOOR_WIDTH / 2],
    [MAIN_DOOR_X - MAIN_DOOR_WIDTH / 2, MAIN_DOOR_X + MAIN_DOOR_WIDTH / 2],
  ];
  const backWallSegments = wallSegments(ROOM_WIDTH / 2, backWallGaps);
  for (const [centerX, width] of backWallSegments) {
    const segment = new THREE.Mesh(new THREE.PlaneGeometry(width, WALL_HEIGHT), wallMaterial);
    segment.position.set(centerX, WALL_HEIGHT / 2, -ROOM_DEPTH / 2);
    segment.receiveShadow = true;
    group.add(segment);
  }

  function buildDoorOnBackWall(doorX: number, doorWidth: number): void {
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(doorWidth, doorLintelHeight), wallMaterial);
    lintel.position.set(doorX, DOOR_HEIGHT + doorLintelHeight / 2, -ROOM_DEPTH / 2);
    lintel.receiveShadow = true;
    group.add(lintel);

    const jambLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, DOOR_HEIGHT + 0.08, DOOR_FRAME_DEPTH), doorFrameMaterial);
    jambLeft.position.set(doorX - doorWidth / 2 - 0.04, (DOOR_HEIGHT + 0.08) / 2, -ROOM_DEPTH / 2 + DOOR_FRAME_DEPTH / 2);
    jambLeft.castShadow = true;
    group.add(jambLeft);
    const jambRight = jambLeft.clone();
    jambRight.position.set(doorX + doorWidth / 2 + 0.04, (DOOR_HEIGHT + 0.08) / 2, -ROOM_DEPTH / 2 + DOOR_FRAME_DEPTH / 2);
    group.add(jambRight);
    const header = new THREE.Mesh(new THREE.BoxGeometry(doorWidth + 0.16, 0.08, DOOR_FRAME_DEPTH), doorFrameMaterial);
    header.position.set(doorX, DOOR_HEIGHT + 0.04, -ROOM_DEPTH / 2 + DOOR_FRAME_DEPTH / 2);
    header.castShadow = true;
    group.add(header);
  }
  // The kitchen door is deliberately plain — no furniture drawn behind
  // it. AA Room's kitchen is staff/event-organiser-only and out of this
  // facility's scope; only the doorway itself needs to exist.
  buildDoorOnBackWall(KITCHEN_DOOR_X, KITCHEN_DOOR_WIDTH);
  buildDoorOnBackWall(MAIN_DOOR_X, MAIN_DOOR_WIDTH);

  // --- West wall (left, camera-visible, x=-ROOM_WIDTH/2): a third door,
  // at the bookshelf/study-tables' own latitude — this was v4's correct
  // position. A v5 attempt moved it to align with the pool table's own
  // depth instead, misreading the user's "大致和桌球在一条线上" as meaning
  // the WEST door when it actually meant the main (back-wall) door's own
  // alignment with the shelf — that move put this door directly through
  // the movie zone's own wall-mounted TV, since the pool table and the
  // movie zone share the same row-3 depth. Reverted to the original,
  // correct row. Unlike the back wall, this wall's local "width" axis is
  // world Z (PlaneGeometry(ROOM_DEPTH, ...) rotated 90° about Y), so its
  // gap is expressed in z, not x. ---
  const WEST_DOOR_WIDTH = 0.68; // shrunk alongside DOOR_HEIGHT — see that constant's own note
  const WEST_DOOR_Z = -1.3; // the shelf/study-tables' own row
  const westWallGaps: Array<[number, number]> = [[WEST_DOOR_Z - WEST_DOOR_WIDTH / 2, WEST_DOOR_Z + WEST_DOOR_WIDTH / 2]];
  const westWallSegments = wallSegments(ROOM_DEPTH / 2, westWallGaps);
  for (const [centerZ, depth] of westWallSegments) {
    const segment = new THREE.Mesh(new THREE.PlaneGeometry(depth, WALL_HEIGHT), wallMaterial);
    segment.rotation.y = Math.PI / 2;
    segment.position.set(-ROOM_WIDTH / 2, WALL_HEIGHT / 2, centerZ);
    segment.receiveShadow = true;
    group.add(segment);
  }
  const westDoorLintel = new THREE.Mesh(new THREE.PlaneGeometry(WEST_DOOR_WIDTH, doorLintelHeight), wallMaterial);
  westDoorLintel.rotation.y = Math.PI / 2;
  westDoorLintel.position.set(-ROOM_WIDTH / 2, DOOR_HEIGHT + doorLintelHeight / 2, WEST_DOOR_Z);
  westDoorLintel.receiveShadow = true;
  group.add(westDoorLintel);
  const westJambNorth = new THREE.Mesh(new THREE.BoxGeometry(DOOR_FRAME_DEPTH, DOOR_HEIGHT + 0.08, 0.08), doorFrameMaterial);
  westJambNorth.position.set(-ROOM_WIDTH / 2 + DOOR_FRAME_DEPTH / 2, (DOOR_HEIGHT + 0.08) / 2, WEST_DOOR_Z - WEST_DOOR_WIDTH / 2 - 0.04);
  westJambNorth.castShadow = true;
  group.add(westJambNorth);
  const westJambSouth = westJambNorth.clone();
  westJambSouth.position.set(-ROOM_WIDTH / 2 + DOOR_FRAME_DEPTH / 2, (DOOR_HEIGHT + 0.08) / 2, WEST_DOOR_Z + WEST_DOOR_WIDTH / 2 + 0.04);
  group.add(westJambSouth);
  const westHeader = new THREE.Mesh(new THREE.BoxGeometry(DOOR_FRAME_DEPTH, 0.08, WEST_DOOR_WIDTH + 0.16), doorFrameMaterial);
  westHeader.position.set(-ROOM_WIDTH / 2 + DOOR_FRAME_DEPTH / 2, DOOR_HEIGHT + 0.04, WEST_DOOR_Z);
  westHeader.castShadow = true;
  group.add(westHeader);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, WALL_HEIGHT), wallMaterial);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_WIDTH / 2, WALL_HEIGHT / 2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  // Baseboard trim along the back wall, split around both door openings
  // the same way the wall itself is — an unbroken trim strip would
  // otherwise visually cross each doorway at floor level.
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  for (const [centerX, width] of backWallSegments) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 0.04), trimMaterial);
    trim.position.set(centerX, 0.05, -ROOM_DEPTH / 2 + 0.02);
    group.add(trim);
  }

  // --- Row 1 (back wall): bookshelf, now TWO shelving units (widened per
  // the user's own request — "书架可以多摆一个"), between the kitchen door
  // and the main door, which now sits immediately right of the shelf's own
  // right edge ("这样正好书架右边就是这扇门"). Same "named fixture anchored
  // to the back wall" role room.ts's clock plays. ---
  const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8 });
  const SHELF_DEPTH = 0.26;
  const SHELF_Z = -ROOM_DEPTH / 2 + SHELF_DEPTH / 2 + 0.02; // flush against the back wall
  const bookColors = [0xd03b3b, 0x3987e5, 0x5aae68, 0xd9822b, 0x8a6a4a];
  const BOOK_DEPTH = 0.16;
  const BOOK_Z = SHELF_DEPTH / 2 + BOOK_DEPTH / 2 + 0.01;
  function buildShelfUnit(x: number): void {
    const shelfGroup = new THREE.Group();
    shelfGroup.position.set(x, 0, SHELF_Z);
    const shelfBody = new THREE.Mesh(new THREE.BoxGeometry(SHELF_UNIT_WIDTH, 1.4, SHELF_DEPTH), shelfMaterial);
    shelfBody.position.set(0, 0.7, 0);
    shelfBody.castShadow = true;
    shelfBody.receiveShadow = true;
    shelfGroup.add(shelfBody);
    // Books sit a real BOOK_DEPTH/2 past the shelf body's own front face —
    // not inside it. An earlier version placed books at local z=0, dead
    // center of the shelf body's own ±0.13 depth, so they were entirely
    // buried inside the solid box and never actually rendered — the same
    // class of bug as a sound hole buried inside a bevel offset
    // (weasel-room.ts's own guitar-redesign notes). Found by computing the
    // shelf body's own world-space front face before placing a single
    // book, not by eyeballing a screenshot.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 6; i++) {
        const book = new THREE.Mesh(
          new THREE.BoxGeometry(0.035 + (i % 3) * 0.01, 0.28, BOOK_DEPTH),
          new THREE.MeshStandardMaterial({ color: bookColors[i % bookColors.length], roughness: 0.7 }),
        );
        book.position.set(-0.36 + i * 0.14, 0.3 + row * 0.42, BOOK_Z);
        book.castShadow = true;
        shelfGroup.add(book);
      }
    }
    group.add(shelfGroup);
  }
  buildShelfUnit(SHELF_UNIT1_X);
  buildShelfUnit(SHELF_UNIT2_X);

  // --- Row 2 (south of row 1): two plain study/dining tables south of the
  // bookshelf, stacked front-to-back — no chairs, matching the brief's own
  // description ("书架下方有两个桌子," nothing about seating) and this
  // room's existing restraint on how much furniture detail each zone gets
  // (the pool table and table tennis table are both chair-less too).
  // PORTRAIT orientation (long axis along Z, short along X), matching the
  // pool table's own rotation — a plain rectangular table has no front/
  // back distinction, so "rotated 90°" is achieved simply by swapping
  // which axis is the long one in the geometry itself, not by rotating a
  // group. Centered under the FIRST shelf unit's own x — a v5 attempt
  // centered the table between the two shelf units' own x positions, which
  // only works if there's a real gap wide enough for the table there; the
  // table (0.55 wide) was wider than the shelf units' own 0.15 gap, so it
  // fell partly inside both units' solid bodies. The table's own Z was
  // also wrong in that attempt — equal to the shelf's own Z rather than
  // south of it, stacking the table ON the shelf's own row instead of
  // beneath it. ---
  const tableTopMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.65 });
  const tableLegMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.7 });
  const TABLE_SHORT = 0.55; // along X
  const TABLE_LONG = 0.8; // along Z
  const TABLE_X = SHELF_UNIT1_X; // under the first shelf unit, not between the two
  function buildStudyTable(z: number): void {
    const tableGroup = new THREE.Group();
    tableGroup.position.set(TABLE_X, 0, z);
    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE_SHORT, 0.05, TABLE_LONG), tableTopMaterial);
    top.position.set(0, 0.42, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    tableGroup.add(top);
    for (const [lx, lz] of [
      [-TABLE_SHORT / 2 + 0.05, -TABLE_LONG / 2 + 0.05],
      [TABLE_SHORT / 2 - 0.05, -TABLE_LONG / 2 + 0.05],
      [-TABLE_SHORT / 2 + 0.05, TABLE_LONG / 2 - 0.05],
      [TABLE_SHORT / 2 - 0.05, TABLE_LONG / 2 - 0.05],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), tableLegMaterial);
      leg.position.set(lx, 0.2, lz);
      leg.castShadow = true;
      tableGroup.add(leg);
    }
    group.add(tableGroup);
  }
  // z=-1.97 (0.15 clear of the shelf's own front face) and z=-1.02 (0.15
  // gap from the first table's own south edge) — both numerically
  // checked, not eyeballed, same discipline as this app's other door/
  // furniture placements.
  buildStudyTable(-1.97);
  buildStudyTable(-1.02);

  // --- Table tennis: LANDSCAPE orientation (long axis along X, left-
  // right), perpendicular to the pool table's own portrait rotation — the
  // user's own correction: "相对于台球桌来说旋转90度". Moved out of row 2
  // entirely into the open corner between the main door and the east
  // wall, which a v5 attempt left completely empty furniture-wise once the
  // table moved away from it without anything taking its place ("明明这里
  // 有这么一大片空地"). The net's own local rotation.y=PI/2 already makes
  // it span the table's short axis (Z) regardless of the group's own
  // orientation — confirmed via each mesh's actual world-space bounds
  // before this was written — so with NO group rotation at all, the net
  // still lands correctly between the two end-slot figures, net/ball/
  // figure-slot coordinates below are otherwise unchanged from their
  // original (also landscape) values. ---
  const poolLegMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.7 });
  const pingPongGroup = new THREE.Group();
  const PING_PONG_X = 2.9; // open corner between the main door and the east wall (3.6)
  const PING_PONG_Z = -1.9; // near the back wall, same general row-2 latitude
  pingPongGroup.position.set(PING_PONG_X, 0, PING_PONG_Z);
  const pingPongTableMaterial = new THREE.MeshStandardMaterial({ color: 0x1f5c8a, roughness: 0.5 });
  const pingPongTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.7), pingPongTableMaterial);
  pingPongTop.position.set(0, 0.4, 0);
  pingPongTop.castShadow = true;
  pingPongTop.receiveShadow = true;
  pingPongGroup.add(pingPongTop);
  const netMaterial = new THREE.MeshStandardMaterial({ color: 0xf6ecd9, roughness: 0.9, transparent: true, opacity: 0.85 });
  const net = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.1), netMaterial);
  net.rotation.y = Math.PI / 2; // spans the table's own SHORT axis (local Z), perpendicular to the long axis (local X) the two figures stand along
  net.position.set(0, 0.46, 0);
  pingPongGroup.add(net);
  for (const lx of [-0.5, 0.5]) {
    for (const lz of [-0.3, 0.3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.06), poolLegMaterial);
      leg.position.set(lx, 0.19, lz);
      leg.castShadow = true;
      pingPongGroup.add(leg);
    }
  }
  const pingPongBallMaterial = new THREE.MeshStandardMaterial({ color: 0xfefefe, roughness: 0.2 });
  const pingPongBall = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), pingPongBallMaterial);
  pingPongBall.position.set(0, 0.55, 0);
  pingPongGroup.add(pingPongBall); // moves along local X (the table's own long axis, between the two end-slot figures) — see update()'s own ball-motion code, unchanged
  group.add(pingPongGroup);

  // --- Row 3 (nearest the open front): three zones redesigned to read as
  // visually distinct from each other — v2's movie and karaoke zones both
  // being "a dark cabinet + one sofa facing it" made them nearly
  // indistinguishable. ---
  const sofaMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.75 });
  const tvCabinetMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.6 });

  // Movie zone: TV wall-mounted on the west wall, sofa facing it, and a
  // short partition wall east of the sofa that stands in for the real
  // room's own short extended wall segment that blocks light/sightline
  // into the pool area. This corner's floor/furniture carry a fixed
  // darker base color (MOVIE_DIM below) to read as "the lit-down corner"
  // the partition creates — a stable, numerically-checkable choice (a
  // constant multiplier against the base hex) rather than a real shadow,
  // whose shape/darkness would depend on this scene's specific light
  // angle and never reliably read as "this one zone is dimmer." The whole
  // zone's own footprint is shrunk from an earlier, disproportionately
  // large version — a real screenshot showed it reading as a second large
  // room rather than the small corner it actually is.
  const MOVIE_Z = 1.3; // row 3's own depth, shared by every row-3 zone (movie/pool/karaoke) below
  const MOVIE_DIM = 0.65;
  const tvScreenMaterial = new THREE.MeshStandardMaterial({
    color: 0x14110d,
    emissive: 0x3987e5,
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  // Bracket sits flush against the wall; the screen sits in FRONT of the
  // bracket's own near (room-facing) face, not behind it — a first
  // attempt placed the screen between the wall and the bracket's own
  // solid body, so the opaque bracket entirely hid it from this fixed
  // camera angle — the same "buried inside a solid mesh" failure class as
  // the bookshelf's own books bug above, just along the depth axis instead
  // of literally inside another mesh.
  //
  // The screen itself is sized SMALLER than the bracket's own face
  // (inset within the bracket's own face by a real bezel margin on every
  // side) — an earlier version made the screen LARGER than its own
  // bracket, so the lit "screen on" glow visibly spilled past the
  // physical TV's own edges, an unoccluded floating rectangle of light
  // rather than a screen inside a frame. Caught by a real screenshot of
  // the lit state, not assumed from the construction parameters.
  // Enlarged from the original 0.6x0.5 bracket / 0.5x0.35 screen — "电影
  // 区的显示器可以更大一点才有电影的感觉": at the original size the
  // screen read as a small bedroom TV, not a movie-zone display.
  const TV_BRACKET_DEPTH = 0.85;
  const TV_BRACKET_HEIGHT = 0.7;
  const tvBracket = new THREE.Mesh(new THREE.BoxGeometry(0.1, TV_BRACKET_HEIGHT, TV_BRACKET_DEPTH), tvCabinetMaterial);
  const TV_BRACKET_X = -ROOM_WIDTH / 2 + 0.05;
  tvBracket.position.set(TV_BRACKET_X, 1.35, MOVIE_Z);
  tvBracket.castShadow = true;
  group.add(tvBracket);
  const TV_SCREEN_X = TV_BRACKET_X + 0.05 + 0.02; // just past the bracket's own near face (0.05 half-depth)
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.55), tvScreenMaterial);
  tvScreen.rotation.y = Math.PI / 2; // faces +X (east), into the room — verified via the real plane normal before this was written
  tvScreen.position.set(TV_SCREEN_X, 1.35, MOVIE_Z);
  group.add(tvScreen);

  // A low stand/table under the screen, against the wall — "现实中它下面
  // 是有桌子的": the TV was floating with nothing supporting it from
  // below.
  const tvStand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.5), tvCabinetMaterial);
  tvStand.position.set(-ROOM_WIDTH / 2 + 0.15, 0.21, MOVIE_Z);
  tvStand.castShadow = true;
  tvStand.receiveShadow = true;
  group.add(tvStand);

  // A pair of floor-standing speakers flanking the TV stand, north/south
  // of it — "下面可以放上落地音响增加氛围感": a plain stand under a big
  // screen with nothing else around it still read as sparse for a movie
  // corner. Tall and slim (speaker proportions, not furniture), just
  // outside the stand's own 0.5-deep footprint so they don't clip it.
  const speakerMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.5 });
  for (const speakerZ of [MOVIE_Z - 0.4, MOVIE_Z + 0.4]) {
    const speaker = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.2), speakerMaterial);
    speaker.position.set(-ROOM_WIDTH / 2 + 0.15, 0.425, speakerZ);
    speaker.castShadow = true;
    speaker.receiveShadow = true;
    group.add(speaker);
  }

  const movieFloorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const MOVIE_FLOOR_X = -ROOM_WIDTH / 2 + 1.0;
  const movieFloorPatch = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.5), movieFloorMaterial);
  movieFloorPatch.rotation.x = -Math.PI / 2;
  movieFloorPatch.position.set(MOVIE_FLOOR_X, 0.002, MOVIE_Z);
  movieFloorPatch.receiveShadow = true;
  group.add(movieFloorPatch);

  const movieSofaX = -ROOM_WIDTH / 2 + 1.1; // shrunk from 1.3 — faces west (-X) toward the TV, verified via the sofa's own world-space backrest position before this was written
  const movieSofaMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.75 });
  const movieSofaGroup = new THREE.Group();
  movieSofaGroup.position.set(movieSofaX, 0, MOVIE_Z);
  movieSofaGroup.rotation.y = -Math.PI / 2;
  const movieSofaBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.55), movieSofaMaterial);
  movieSofaBase.position.set(0, 0.16, 0);
  movieSofaBase.castShadow = true;
  movieSofaBase.receiveShadow = true;
  movieSofaGroup.add(movieSofaBase);
  const movieSofaBack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.14), movieSofaMaterial);
  movieSofaBack.position.set(0, 0.42, -0.2);
  movieSofaBack.castShadow = true;
  movieSofaGroup.add(movieSofaBack);
  group.add(movieSofaGroup);

  // Partition wall, east of the sofa's own east edge, blocking the pool
  // area's light/sightline into this corner — the real fixture this
  // zone's own dimming stands in for. Shrunk to match the zone's own
  // smaller footprint.
  const PARTITION_X = movieSofaX + 0.55 / 2 + 0.4; // 0.4 clear of the sofa's own east edge for walking space
  const partitionMaterial = new THREE.MeshStandardMaterial({ color: 0xf6efe1, roughness: 0.9 });
  const partitionWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 1.4), partitionMaterial);
  partitionWall.position.set(PARTITION_X, 0.75, MOVIE_Z);
  partitionWall.castShadow = true;
  partitionWall.receiveShadow = true;
  group.add(partitionWall);

  // Pool table, portrait orientation (long axis front-to-back, not
  // left-to-right). Positioned meaningfully CLOSER to the movie zone's own
  // partition than to the karaoke zone — a first attempt placed it
  // equidistant between the two, which read as "just centered" rather
  // than the deliberate "靠近电影区" the user asked for.
  const poolFeltMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6b4a, roughness: 0.85 });
  const poolTableGroup = new THREE.Group();
  const POOL_X = PARTITION_X + 0.06 + 0.35 + 0.93 / 2; // 0.35 clear of the partition's own east face
  const POOL_Z = MOVIE_Z;
  poolTableGroup.position.set(POOL_X, 0, POOL_Z);
  poolTableGroup.rotation.y = Math.PI / 2;
  const poolBed = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.85), poolFeltMaterial);
  poolBed.position.set(0, 0.46, 0);
  poolBed.castShadow = true;
  poolBed.receiveShadow = true;
  poolTableGroup.add(poolBed);
  const poolRailMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.6 });
  const poolRail = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.1, 0.93), poolRailMaterial);
  poolRail.position.set(0, 0.42, 0);
  poolTableGroup.add(poolRail);
  for (const [lx, lz] of [
    [-0.68, -0.36],
    [0.68, -0.36],
    [-0.68, 0.36],
    [0.68, 0.36],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), poolLegMaterial);
    leg.position.set(lx, 0.21, lz);
    leg.castShadow = true;
    poolTableGroup.add(leg);
  }
  const poolBallMaterial = new THREE.MeshStandardMaterial({ color: 0xf6ecd9, roughness: 0.3 });
  const poolBall = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), poolBallMaterial);
  poolBall.position.set(0.15, 0.52, 0.05);
  poolBall.castShadow = true;
  poolTableGroup.add(poolBall);
  // A loose triangle of colored object balls, static (the single white ball
  // above is the one that actually rolls — see its own update() motion) —
  // "台球桌上应该有好多彩色小球才对，现在就一个白球太少了": one ball read
  // as an empty table rather than a game in progress. Clustered at the
  // table's own far end (local x around -0.3 to -0.55), well clear of the
  // rolling white ball's own x in [0.03, 0.27].
  const POOL_OBJECT_BALL_COLORS = [0xd9b23c, 0x2f6fae, 0xb23c3c, 0x7a3cb2, 0xd9822b, 0x2f8a4a, 0x7a3b1f, 0xb23c8a, 0xdede3c, 0x1a1a1a];
  const poolObjectBallPositions: Array<[number, number]> = [
    [-0.55, 0],
    [-0.47, -0.04],
    [-0.47, 0.04],
    [-0.39, -0.08],
    [-0.39, 0],
    [-0.39, 0.08],
    [-0.31, -0.12],
    [-0.31, -0.04],
    [-0.31, 0.04],
    [-0.31, 0.12],
  ];
  poolObjectBallPositions.forEach(([lx, lz], i) => {
    const ballMaterial = new THREE.MeshStandardMaterial({ color: POOL_OBJECT_BALL_COLORS[i % POOL_OBJECT_BALL_COLORS.length], roughness: 0.3 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), ballMaterial);
    ball.position.set(lx, 0.52, lz);
    ball.castShadow = true;
    poolTableGroup.add(ball);
  });
  group.add(poolTableGroup);

  // Karaoke zone: the screen mounted on a small backdrop panel built
  // specifically for it (the real east wall is backface-culled invisible
  // under this app's fixed isometric camera — the same fact Otter Room's
  // window redesign had to work around, see otter-room.ts's own notes),
  // with THREE SEPARATE sofas (west, north, south) around an open floor
  // area facing the screen — a real gap between each pair, not one
  // continuous wraparound bench (an earlier version built the north/south
  // sofas flush against the west sofa's own edges, which read on screen as
  // a single U-shaped piece of furniture, not three distinct sofas).
  // Confirmed as a real room fixture — notes/adr/0003-aa-room-live-
  // state.md, "Design correction, v3"/"v4"/"v5".
  //
  // Two wrong attempts at the backdrop before this one:
  //  1. A zero-thickness PlaneGeometry, the same construction the room's
  //     own east/west/back walls use — numerically checking this wall's
  //     own face normal against the camera's real view direction (the
  //     same check otter-room.ts's window redesign used) showed it
  //     dot-products negative: this wall's west-facing normal is on the
  //     SAME culled side the room's real east wall already is, so it (and
  //     the screen mounted to it) rendered as fully invisible.
  //  2. A full-height (WALL_HEIGHT), 1.8-wide backdrop built as a real
  //     BoxGeometry (to avoid the culling problem, same technique the
  //     partition wall already uses) DID render, but sized to the whole
  //     wall segment it looked like an oversized blank panel blocking the
  //     view into the whole zone.
  // Fixed by sizing the backdrop panel to just the screen plus a small
  // margin, not the full wall segment — still a real BoxGeometry so it
  // isn't backface-culled, but small enough to read as "the screen's own
  // mount," not a second wall.
  const KARAOKE_Z = MOVIE_Z;
  const KARAOKE_BACKDROP_X = ROOM_WIDTH / 2 - 0.3; // 0.3 clear of the true (invisible) east wall
  const BACKDROP_WIDTH = 1.0;
  const BACKDROP_HEIGHT = 0.9;
  const BACKDROP_Y_CENTER = 1.3;
  const karaokeBackdropPanel = new THREE.Mesh(new THREE.BoxGeometry(0.1, BACKDROP_HEIGHT, BACKDROP_WIDTH), tvCabinetMaterial);
  karaokeBackdropPanel.position.set(KARAOKE_BACKDROP_X, BACKDROP_Y_CENTER, KARAOKE_Z);
  karaokeBackdropPanel.castShadow = true;
  karaokeBackdropPanel.receiveShadow = true;
  group.add(karaokeBackdropPanel);

  // A low stand/table under the screen, matching the movie zone's own TV
  // stand — "现实中它下面是有桌子的" applies to both screens in this room.
  const karaokeStand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.7), tvCabinetMaterial);
  karaokeStand.position.set(KARAOKE_BACKDROP_X - 0.2, 0.21, KARAOKE_Z);
  karaokeStand.castShadow = true;
  karaokeStand.receiveShadow = true;
  group.add(karaokeStand);

  // Unlike the TV bracket (mounted on the west wall, where "facing into
  // the room" and "facing the camera" are the same direction, +X), the
  // karaoke backdrop sits on the room's EAST side, where "facing into the
  // room" (-X, toward the sofas) and "facing the camera" (+X, the same
  // direction the room's own real east wall is backface-culled away from)
  // are OPPOSITE. A first attempt mounted the screen on the panel's west
  // (room-facing) side with `side: THREE.DoubleSide` as a defensive
  // measure — but the panel's own opaque BoxGeometry body sat between the
  // screen and the camera, fully occluding it regardless of which faces
  // the material rendered. Fixed by mounting the screen on the panel's
  // EAST (camera-facing) side instead — unoccluded, but necessarily facing
  // away from the sofas it's meant to face.
  //
  // Because of that same tradeoff, this screen gets NO emissive glow at
  // all when "on" (unlike the TV's own flicker) — "卡拉OK区的电视由于背对
  // 镜头，应该是看不到发光效果的": a glow on a screen that visually faces
  // the camera, when the real screen faces the opposite way (toward the
  // sofas), would misread as the screen glowing toward the viewer, the
  // wrong direction for what's actually a room fixture facing away from
  // them. A couple of small floating music notes above the singing
  // figures (see applyState()'s own karaoke figure handling and the notes
  // group below) signal the activity instead — see update()'s own comment
  // on why notes, not glow, carry this zone's "on" signal.
  const karaokeScreenMaterial = new THREE.MeshStandardMaterial({
    color: 0x14110d,
    roughness: 0.4,
  });
  const karaokeScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.42), karaokeScreenMaterial);
  karaokeScreen.rotation.y = Math.PI / 2; // faces +X (east/camera-facing) — the panel's own near side, unoccluded
  karaokeScreen.position.set(KARAOKE_BACKDROP_X + 0.05 + 0.02, BACKDROP_Y_CENTER, KARAOKE_Z); // just past the backdrop panel's own near face (0.05 half-thickness)
  group.add(karaokeScreen);

  // West sofa: faces east toward the screen — its own backrest sits
  // further WEST (away from the screen), verified via the sofa's own
  // world-space backrest position before this was written. Shortened from
  // an earlier version (2.2 -> 1.4) to leave real gaps to the north/south
  // sofas below, rather than spanning the open floor's full depth.
  const KARAOKE_SOFA_DEPTH = 0.55;
  const KARAOKE_SOFA_W_SPAN = 1.4;
  const KARAOKE_GAP_FROM_POOL = 0.55; // clearly bigger than the pool table's own 0.35 gap to the partition — confirms pool sits closer to the movie zone than to karaoke
  const KARAOKE_SOFA_W_X = POOL_X + 0.93 / 2 + KARAOKE_GAP_FROM_POOL + KARAOKE_SOFA_DEPTH / 2;
  const karaokeWestSofaGroup = new THREE.Group();
  karaokeWestSofaGroup.position.set(KARAOKE_SOFA_W_X, 0, KARAOKE_Z);
  karaokeWestSofaGroup.rotation.y = Math.PI / 2;
  const karaokeWestSofaBase = new THREE.Mesh(new THREE.BoxGeometry(KARAOKE_SOFA_W_SPAN, 0.32, KARAOKE_SOFA_DEPTH), sofaMaterial);
  karaokeWestSofaBase.position.set(0, 0.16, 0);
  karaokeWestSofaBase.castShadow = true;
  karaokeWestSofaBase.receiveShadow = true;
  karaokeWestSofaGroup.add(karaokeWestSofaBase);
  const karaokeWestSofaBack = new THREE.Mesh(new THREE.BoxGeometry(KARAOKE_SOFA_W_SPAN, 0.4, 0.14), sofaMaterial);
  karaokeWestSofaBack.position.set(0, 0.42, -0.2);
  karaokeWestSofaBack.castShadow = true;
  karaokeWestSofaGroup.add(karaokeWestSofaBack);
  group.add(karaokeWestSofaGroup);

  // North/south sofas: span from a real gap east of the west sofa's own
  // edge (KARAOKE_SOFA_CORNER_GAP, below) to a real gap short of the
  // backdrop — three genuinely separate pieces of furniture, confirmed
  // numerically clear of each other and of the backdrop before this was
  // written, not eyeballed.
  const KARAOKE_SOFA_CORNER_GAP = 0.2;
  const [kwsLeft, kwsRight] = [KARAOKE_SOFA_W_X - KARAOKE_SOFA_DEPTH / 2, KARAOKE_SOFA_W_X + KARAOKE_SOFA_DEPTH / 2];
  const KARAOKE_NS_LENGTH = KARAOKE_BACKDROP_X - 0.1 - (kwsRight + KARAOKE_SOFA_CORNER_GAP);
  const KARAOKE_NS_X_CENTER = kwsRight + KARAOKE_SOFA_CORNER_GAP + KARAOKE_NS_LENGTH / 2;
  const KARAOKE_NORTH_SOFA_Z = KARAOKE_Z - KARAOKE_SOFA_W_SPAN / 2 - KARAOKE_SOFA_CORNER_GAP - KARAOKE_SOFA_DEPTH / 2;
  const KARAOKE_SOUTH_SOFA_Z = KARAOKE_Z + KARAOKE_SOFA_W_SPAN / 2 + KARAOKE_SOFA_CORNER_GAP + KARAOKE_SOFA_DEPTH / 2;

  const karaokeNorthSofaGroup = new THREE.Group();
  karaokeNorthSofaGroup.position.set(KARAOKE_NS_X_CENTER, 0, KARAOKE_NORTH_SOFA_Z);
  const karaokeNorthSofaBase = new THREE.Mesh(new THREE.BoxGeometry(KARAOKE_NS_LENGTH, 0.32, KARAOKE_SOFA_DEPTH), sofaMaterial);
  karaokeNorthSofaBase.position.set(0, 0.16, 0);
  karaokeNorthSofaBase.castShadow = true;
  karaokeNorthSofaBase.receiveShadow = true;
  karaokeNorthSofaGroup.add(karaokeNorthSofaBase);
  const karaokeNorthSofaBack = new THREE.Mesh(new THREE.BoxGeometry(KARAOKE_NS_LENGTH, 0.4, 0.14), sofaMaterial);
  karaokeNorthSofaBack.position.set(0, 0.42, -0.2); // backrest on the north side, away from the open floor
  karaokeNorthSofaBack.castShadow = true;
  karaokeNorthSofaGroup.add(karaokeNorthSofaBack);
  group.add(karaokeNorthSofaGroup);

  const karaokeSouthSofaGroup = new THREE.Group();
  karaokeSouthSofaGroup.position.set(KARAOKE_NS_X_CENTER, 0, KARAOKE_SOUTH_SOFA_Z);
  karaokeSouthSofaGroup.rotation.y = Math.PI; // backrest flipped to the south side, away from the open floor
  const karaokeSouthSofaBase = new THREE.Mesh(new THREE.BoxGeometry(KARAOKE_NS_LENGTH, 0.32, KARAOKE_SOFA_DEPTH), sofaMaterial);
  karaokeSouthSofaBase.position.set(0, 0.16, 0);
  karaokeSouthSofaBase.castShadow = true;
  karaokeSouthSofaBase.receiveShadow = true;
  karaokeSouthSofaGroup.add(karaokeSouthSofaBase);
  const karaokeSouthSofaBack = new THREE.Mesh(new THREE.BoxGeometry(KARAOKE_NS_LENGTH, 0.4, 0.14), sofaMaterial);
  karaokeSouthSofaBack.position.set(0, 0.42, -0.2);
  karaokeSouthSofaBack.castShadow = true;
  karaokeSouthSofaGroup.add(karaokeSouthSofaBack);
  group.add(karaokeSouthSofaGroup);

  // Floating music notes beside the karaoke figures' own heads — the
  // activity's "on" signal now that the screen itself carries no glow (see
  // the screen's own note above). Two simple torus "note heads" with a
  // short stem, positioned at each figure's own (x,z) from FIGURE_SLOTS.
  // karaoke (defined further below) and at standing-figure head height
  // (0.42 torsoY + 0.275 half torsoHeight + 0.11 ≈ 0.8, see aa-room-
  // figures.ts's own head-placement math) plus a small clearance — a first
  // attempt placed these at y=1.75 with x/z offsets independent of the
  // actual figure slots, floating nearly a full meter above the figures'
  // own heads and visibly drifted sideways from them ("音符应该放在两个人
  // 的脑袋旁边，现在太远了"). Built here (before FIGURE_SLOTS is defined)
  // using the same KARAOKE_NS_X_CENTER/KARAOKE_Z this zone's own figure
  // slots are built from further down, so the two can never drift apart
  // again. ---
  const KARAOKE_FIGURE_HEAD_Y = 0.95; // standing-figure head center (~0.8) plus a small clearance above it
  // Each note gets its OWN material (not shared) so its own rise-and-fade
  // cycle (see update()'s own note) can set its own opacity independently
  // — the two notes are on offset phases specifically so they don't move
  // in lockstep, which a single shared material's opacity would undo.
  function buildMusicNote(x: number, z: number): { note: THREE.Group; material: THREE.MeshStandardMaterial } {
    const material = new THREE.MeshStandardMaterial({ color: 0xd9467b, roughness: 0.5, transparent: true });
    const note = new THREE.Group();
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.015, 6, 10), material);
    head.position.set(0, 0, 0);
    note.add(head);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), material);
    stem.position.set(0.03, 0.06, 0);
    note.add(stem);
    note.position.set(x, KARAOKE_FIGURE_HEAD_Y, z);
    group.add(note);
    return { note, material };
  }
  const karaokeNote1Built = buildMusicNote(KARAOKE_NS_X_CENTER + 0.12, KARAOKE_Z - 0.3); // beside figure 1's own head (same x/z as its FIGURE_SLOTS.karaoke entry)
  const karaokeNote2Built = buildMusicNote(KARAOKE_NS_X_CENTER + 0.12, KARAOKE_Z + 0.3); // beside figure 2's own head
  const karaokeNote1 = karaokeNote1Built.note;
  const karaokeNote2 = karaokeNote2Built.note;
  const karaokeNote1Material = karaokeNote1Built.material;
  const karaokeNote2Material = karaokeNote2Built.material;
  const karaokeNotes = [karaokeNote1, karaokeNote2];
  for (const note of karaokeNotes) note.visible = false;

  // Freshness's `dim` is applied as a flat multiplier against each
  // surface's own base color (never touching roughness/other properties)
  // — paired here, once, with the base hex each material actually started
  // from, so re-dimming from a fresh state doesn't compound against an
  // already-dimmed color. The optional third element is a FIXED extra
  // multiplier, independent of freshness — only the movie zone's own
  // floor/sofa materials carry one (MOVIE_DIM), standing in for the real
  // room's own partition wall blocking light into that corner. It composes
  // with freshness's own dim (fixedDim * look.dim) rather than replacing
  // it, so an unknown/stale movie zone still gets darker still, same as
  // every other zone's materials do.
  const ROOM_BASE_COLORS: Array<[THREE.MeshStandardMaterial, number, number?]> = [
    [floorMaterial, 0xd9c9a3],
    [wallMaterial, 0xf6efe1],
    [sofaMaterial, 0x8a6a4a],
    [movieFloorMaterial, 0xd9c9a3, MOVIE_DIM],
    [movieSofaMaterial, 0x8a6a4a, MOVIE_DIM],
    [poolFeltMaterial, 0x2f6b4a],
    [shelfMaterial, 0x6b4a2f],
    [tableTopMaterial, 0x8a6a4a],
  ];

  // --- Figures: rebuilt on every applyState() call. A handful of boxes/
  // spheres is cheap enough to rebuild rather than pool/reuse instances
  // — same "simplicity over premature optimization" choice this app's
  // Three.js layer has made elsewhere (e.g. machine meshes are built once
  // and only re-materialed, but there the count is fixed; here the COUNT
  // itself changes with occupancy, which pooling would complicate for no
  // real cost benefit at this scale).
  const figuresGroup = new THREE.Group();
  group.add(figuresGroup);
  let activeFigures: FigureHandle[] = [];

  // Where each pose stands/sits, keyed to the zone it belongs with. "tv"
  // and "hangout" are DELIBERATELY SEPARATE slot lists even though both
  // sit in the sofa/TV side of the room: v2 (notes/adr/0003-aa-room-live-
  // state.md, "Design correction") made tv and hanging-out independently
  // combinable, so sharing one slot list (as v1's tv/sofa slots used to)
  // would stack a hanging-out figure and a TV-watching figure on top of
  // each other the moment both are reported at once. Figures that only
  // ever appear via "event" (see EVENT_SLOTS below) don't need entries
  // here — event uses its own independent, whole-room layout, never this
  // per-zone one.
  // "sofa" has no entry here on purpose: that pose only ever appears via
  // EVENT_FIGURES (aa-room-status-look.ts), and every event figure is
  // placed through EVENT_SLOTS below, never through this per-zone table —
  // see applyState()'s isEvent branch. The Record is still typed over the
  // full FigurePose union (via Partial) so a future pose that SHOULD have
  // a per-zone slot can't silently compile without one.
  // Re-derived for the v2 layout (row 3's freestanding zones, row 2's
  // relocated table tennis) — each slot pair numerically checked against
  // its own zone's real furniture bounds above, not eyeballed, the same
  // discipline otter-room.ts's door placement used.
  const FIGURE_SLOTS: Partial<Record<FigurePose, THREE.Vector3[]>> = {
    tv: [new THREE.Vector3(movieSofaX, 0, MOVIE_Z - 0.25), new THREE.Vector3(movieSofaX, 0, MOVIE_Z + 0.25)], // seated on the movie sofa, split north/south across its own 1.3 width
    // Standing near the bookshelf — the user's own correction: v2's slots
    // placed these two in row 3's own open floor, nowhere near anything in
    // particular, which read as arbitrary rather than deliberate. One
    // stands in the gap between the kitchen door and the shelf's own left
    // edge, the other just east of the shelf's second unit before the main
    // door — both a real 0.3 south of the shelf's own front face, clear of
    // both study tables' own bounds (checked numerically, not eyeballed).
    hangout: [new THREE.Vector3(-2.745, 0, -2.22), new THREE.Vector3(-0.34, 0, -2.22)],
    // Standing at the table's own north/south (short) ends, flanking it
    // like real pool players. Several earlier attempts chased a screen-
    // space occlusion check (the table itself, then the partition wall)
    // by pushing these slots further and further away, ending up standing
    // in open floor nowhere near the table at all ("玩桌球的两个人现在也
    // 没有站在台球桌两旁") — a worse result than the occlusion it was
    // trying to avoid. Kept close to the table's own short ends instead
    // and checked by an actual screenshot rather than projected math
    // alone this time.
    pool: [new THREE.Vector3(POOL_X, 0, POOL_Z - 1.05), new THREE.Vector3(POOL_X, 0, POOL_Z + 1.05)],
    "table-tennis": [new THREE.Vector3(PING_PONG_X - 0.65, 0, PING_PONG_Z), new THREE.Vector3(PING_PONG_X + 0.65, 0, PING_PONG_Z)], // past the table's own (now landscape) east/west ends
    standing: [new THREE.Vector3(0.6, 0, 2.6), new THREE.Vector3(-3.0, 0, 1.0)],
    karaoke: [new THREE.Vector3(KARAOKE_NS_X_CENTER, 0, KARAOKE_Z - 0.3), new THREE.Vector3(KARAOKE_NS_X_CENTER, 0, KARAOKE_Z + 0.3)], // the U's own open floor area, facing the screen
  };

  // Event's own independent, whole-room figure layout (per the design
  // brief: event is busier and more dispersed, not just "occupied's sofa
  // pose repeated") — spread across the room rather than concentrated in
  // any one zone's normal slots, since a formal event genuinely occupies
  // the whole room, not one activity's corner of it. Re-derived for the
  // v4 layout's larger footprint and new furniture bounds (shelf, both
  // tables, table tennis, the partitioned movie zone, the portrait pool
  // table, the karaoke U) and numerically checked clear of all of them —
  // the v2 slots silently overlapped three different pieces of furniture
  // once row 3's shapes changed, caught by this same bounds check before
  // ever rendering it.
  // Grown from 4 to 8 slots — "hall event可以再热闹一点，你看现在的情况还
  // 不如点满其他活动的时候人多呢": with only 4 figures, a formal hall
  // event read as emptier than simply checking every other activity box at
  // once (which spawns 2 figures per zone across 5 zones). An event is
  // meant to be the busiest state the room has, not one of the quieter
  // ones — each new slot numerically checked clear of every nearby piece
  // of furniture (0.2 margin, matching this file's own door-gap
  // discipline) before being added, not eyeballed.
  const EVENT_SLOTS: THREE.Vector3[] = [
    new THREE.Vector3(-2.9, 0, 0),
    new THREE.Vector3(0, 0, -0.3),
    new THREE.Vector3(-1, 0, 2.5),
    new THREE.Vector3(-3, 0, 2),
    new THREE.Vector3(1.2, 0, -0.7),
    new THREE.Vector3(-0.2, 0, 2.6),
    new THREE.Vector3(-2.9, 0, 2.6),
    new THREE.Vector3(0.2, 0, -1.3),
  ];

  const slotCursor: Record<string, number> = {};

  function clearFigures(): void {
    for (const figure of activeFigures) figuresGroup.remove(figure.group);
    activeFigures = [];
  }

  let currentDesaturate = 0;

  function applyState(occupancy: AaRoomOccupancy, activities: readonly AaRoomActivity[], freshness: AaRoomFreshness): void {
    const look = lookForAaRoom(occupancy, activities, freshness);
    const isEvent = activities.includes("event");

    clearFigures();
    for (const key of Object.keys(slotCursor)) delete slotCursor[key];
    look.figures.forEach((pose, index) => {
      // Event gets its own independent whole-room placement — never the
      // per-zone FIGURE_SLOTS, which would otherwise cluster event's
      // figures into tv/pool/table-tennis's normal spots and read as
      // "occupied, extra-crowded" rather than "the whole room is in use."
      const position = isEvent ? EVENT_SLOTS[index % EVENT_SLOTS.length]! : (() => {
        const slots = FIGURE_SLOTS[pose]!; // every non-event pose has an entry — see FIGURE_SLOTS's own note
        const cursor = slotCursor[pose] ?? 0;
        const position = slots[cursor % slots.length]!;
        slotCursor[pose] = cursor + 1;
        return position;
      })();
      // Pool and table-tennis each have figures standing at BOTH ends of
      // their own table, so no single constant angle faces the table from
      // both sides — a prior version gave every pool/table-tennis figure
      // the same fixed Math.PI/2, which only happened to face the table
      // from one of the two slots and left the other rotated 90° away from
      // it ("两个人朝向应该对着桌子才对，现在偏移了90度"). Computed per
      // figure instead, toward that pose's own table center, using the
      // same atan2(dx, dz) convention Three.js's own rotation.y=0-faces-+Z.
      const facingY = isEvent
        ? 0
        : pose === "tv" || pose === "hangout"
          ? 0.3
          : pose === "pool"
            ? Math.atan2(POOL_X - position.x, POOL_Z - position.z)
            : pose === "table-tennis"
              ? Math.atan2(PING_PONG_X - position.x, PING_PONG_Z - position.z)
              : pose === "karaoke"
                ? Math.PI // facing north, toward the karaoke screen, same orientation as its sofa
                : 0;
      const figure = buildFigure(`aa-room-figure-${index}-${pose}`, pose, position, facingY);
      figure.setDesaturate(currentDesaturate);
      figuresGroup.add(figure.group);
      activeFigures.push(figure);
    });

    group.userData.tvOn = look.tvOn;
    group.userData.poolActive = look.poolActive;
    group.userData.tableTennisActive = look.tableTennisActive;
    group.userData.karaokeOn = look.karaokeOn;
    currentDesaturate = look.desaturate;
    for (const figure of activeFigures) figure.setDesaturate(currentDesaturate);

    // Dim: each surface's own base color scaled toward black by `dim` —
    // applied directly to materials rather than via scene lighting, so
    // it stays local to this room's own meshes regardless of how
    // lighting is shared with whatever facility mounts next (see
    // scene.ts's single-renderer design). Never touches stored state —
    // purely a presentation response to freshness, exactly like
    // status-look.ts's own `desaturate` field on machines.
    for (const [material, baseColor, fixedDim] of ROOM_BASE_COLORS) {
      material.color.setHex(baseColor).multiplyScalar(look.dim * (fixedDim ?? 1));
    }
  }

  function update(elapsedSeconds: number): void {
    for (const figure of activeFigures) figure.update(elapsedSeconds);

    // TV: steady, gentle flicker — same two-mismatched-sine-waves
    // technique as a machine's unknown-status LED flicker
    // (machine-mesh.ts), but tuned gentler (smaller amplitude, higher
    // floor) since a TV screen flickering as hard as an "uncertain"
    // status LED would read as a broken TV, not one that's on.
    if (group.userData.tvOn) {
      const flicker = 0.75 + 0.15 * Math.sin(elapsedSeconds * 4.3) + 0.1 * Math.sin(elapsedSeconds * 9.1 + 0.7);
      tvScreenMaterial.emissiveIntensity = Math.max(0.5, flicker) * (1 - currentDesaturate * 0.5);
    } else {
      tvScreenMaterial.emissiveIntensity = 0;
    }

    // Pool ball: a faint continuous roll/settle loop — restrained per
    // the brief ("not a game"), a small positional drift rather than a
    // full roll around the table.
    if (group.userData.poolActive) {
      poolBall.position.x = 0.15 + Math.sin(elapsedSeconds * 0.5) * 0.12;
      poolBall.position.z = 0.05 + Math.cos(elapsedSeconds * 0.37) * 0.08;
    }

    if (group.userData.tableTennisActive) {
      pingPongBall.position.x = Math.sin(elapsedSeconds * 2.4) * 0.35;
      pingPongBall.position.y = 0.5 + Math.abs(Math.sin(elapsedSeconds * 2.4)) * 0.08;
    }

    // Karaoke: the screen itself carries no glow (it faces the camera, not
    // the sofas it's actually meant to face — see its own material's
    // note), so "on" is signaled by a couple of floating music notes
    // instead — the activity's one and only visible signal, so it needs to
    // read clearly as motion, not just presence. A first version only
    // bobbed by +/-0.04 in place, too subtle to actually notice next to
    // every other activity's own loop (ball rolls, cue swings, TV
    // flickers) — "音符可以活动起来，活动明显一点才能看出来是音符." Rebuilt
    // as a real rising-and-looping drift (each note climbs ~0.3 units over
    // a ~3 second cycle, with a gentle side-to-side sway and a slow spin,
    // then resets to the bottom of its own loop) — a continuous, never-
    // ending animation like every other activity's own, just one with
    // actual vertical travel instead of a fixed bob.
    for (const note of karaokeNotes) note.visible = group.userData.karaokeOn;
    if (group.userData.karaokeOn) {
      const cycle = (t: number, phase: number) => ((t + phase) % 3) / 3; // 0..1 repeating every 3 seconds
      const c1 = cycle(elapsedSeconds, 0);
      karaokeNote1.position.y = KARAOKE_FIGURE_HEAD_Y + c1 * 0.3;
      karaokeNote1.position.x = KARAOKE_NS_X_CENTER + 0.12 + Math.sin(elapsedSeconds * 3) * 0.03;
      karaokeNote1.rotation.z = elapsedSeconds * 1.5;
      karaokeNote1Material.opacity = Math.sin(c1 * Math.PI); // fades in from the bottom, fades out before looping back, instead of popping
      const c2 = cycle(elapsedSeconds, 1.5); // offset phase so the two notes don't rise in lockstep
      karaokeNote2.position.y = KARAOKE_FIGURE_HEAD_Y + c2 * 0.3;
      karaokeNote2.position.x = KARAOKE_NS_X_CENTER + 0.12 + Math.sin(elapsedSeconds * 3 + 2) * 0.03;
      karaokeNote2.rotation.z = elapsedSeconds * -1.3;
      karaokeNote2Material.opacity = Math.sin(c2 * Math.PI);
    }
  }

  return { group, update, applyState };
}
