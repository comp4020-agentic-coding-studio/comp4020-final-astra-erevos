// Badger Room's 3D diorama. Stage 1 built the room's real static geometry
// (conference table + chairs, piano, TV, sofas, a door threshold); Stage
// 2 (this file, current version) adds the occupancy-driven look —
// figures for "occupied," none for "empty"/"unknown," and a muted/dimmed
// room for "unknown" — per notes/adr/0007-badger-room-live-state.md. Same
// cutaway low-poly visual language as room.ts/aa-room.ts/otter-room.ts/
// rabbit-room.ts/weasel-room.ts, mounted on the ONE shared renderer
// (renderer-host.ts), never a second WebGLRenderer.
//
// NO ACTIVITY-SPECIFIC PROPS, per notes/adr/0007-badger-room-live-state.md,
// Decision 1/3: this room has no activity field, because knowing which of
// its several real uses (formal meetings, interviews, special study,
// organised activities like Toad's Table) is actually happening has no
// decision-relevant value to a resident checking the app. "occupied"
// therefore adds ONLY decorative figures (see badger-room-figures.ts's
// own note on why their pose stays neutral) — no papers, no laptops, no
// food, no presentation screen content, no piano-playing props, no TV
// content, nothing that would silently commit the scene to one of the
// room's several real uses the data model deliberately doesn't
// distinguish. The conference table, piano, TV, sofas, and door threshold
// are all always-present furniture (Stage 1), never toggled by occupancy.
//
// REAL, CONFIRMED FACTS ONLY (see the brief this stage was built from): a
// large, roughly-square room, understood as four quadrants from above —
// a big conference table with about ten chairs in the back-right
// quadrant; a piano against the east wall and a large TV against the
// south wall, both in the front-right quadrant; sofas along the walls in
// the two left quadrants; a door on the south wall, toward the
// front-left. No window, no whiteboard, no heater, and no other
// furniture are part of this room's confirmed brief — none are added
// here, and the quadrant layout above is recorded only as a build
// reference, not read back into any data-model requirement (ADR 0007's
// own Context section makes the same distinction).
//
// WALL VISIBILITY, CHECKED BEFORE PLACING ANYTHING (not assumed, and not
// copied from another room's layout): this app's rooms rely on ordinary
// backface culling to hide the wall nearest the fixed isometric camera,
// so the camera can see inside at all (see scene.ts's ISO_VIEW_DIRECTION
// — positive X, Y, and Z). A PlaneGeometry wall is visible only when its
// face normal points toward the camera. backWall (position -Z, default
// normal +Z) and leftWall (rotation.y = +PI/2, normal rotates to +X) both
// end up facing the camera's positive-X/positive-Z position and stay
// visible; rightWall (rotation.y = -PI/2, normal rotates to -X) faces
// away and is culled — the same fact every other room in this app (most
// recently weasel-room.ts) was built against.
//
// Mapping the room's real compass layout onto this fixed geometry (same
// convention weasel-room.ts/rabbit-room.ts established): south (the
// door) -> the open front (+Z), no wall exists there at all; east (the
// piano) -> the RIGHT wall (+X) — CULLED, so the piano is built as
// floor-standing furniture near that side with no rendered wall behind
// it, the exact tradeoff weasel-room.ts's own keyboard already makes
// (a floor-standing fixture reads as "positioned at the room's east
// side" through its own position/orientation alone, with no rendered
// wall plane required). North and west have no confirmed fixture at all
// this stage (no window, no whiteboard per the brief), so neither
// visible wall needs anything mounted on it yet.
//
// THE TV IS A FREESTANDING SOLID, NOT A WALL-MOUNTED PANEL: the brief
// only says the TV sits against the south wall, never that it's wall-
// mounted, and the south side of this room has no wall at all (the open
// front every room's cutaway relies on). Built with real thickness (a
// stand plus a screen box, not a bare plane), inset from the room's true
// south edge so it reads as "against the south wall" from the camera's
// fixed angle without ever floating in front of a wall plane that
// doesn't exist.
//
// THE DOOR IS EXPRESSED AS A THRESHOLD, NOT A WALL OPENING: the open
// front already *is* the doorway for every room in this app, so nothing
// needs to be cut out of a wall. A floor threshold strip plus two short
// door-jamb posts, offset toward the room's front-left, marks where the
// door is without requiring — or breaking — the existing fixed dollhouse
// camera.
import * as THREE from "three";
import type { BadgerRoomOccupancy } from "../types.ts";
import { buildBadgerRoomFigure, type BadgerRoomFigureHandle } from "./badger-room-figures.ts";
import { lookForBadgerRoom } from "./badger-room-status-look.ts";

export interface BadgerRoomHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives figure idle sway. Caller skips calling this under reduced motion (see scene.ts), same convention as every other facility's update(). */
  update(elapsedSeconds: number): void;
  /** Applies a new canonical Badger Room state's look — rebuilds which figures are present and sets desaturate/dim. Furniture (table, chairs, piano, TV, sofas, door threshold) is never added/removed here — only figures are occupancy-dependent, and there are no occupied-only activity props at all (see the file's own top note). expectedEndAt plays no role here (ADR 0007: it never changes the scene, still just "occupied"). */
  applyState(occupancy: BadgerRoomOccupancy): void;
}

// Large and roughly square — noticeably bigger than every other facility
// built so far (AA Room's own 5.4 x 4.0 common room was this app's
// previous largest), matching the brief's "大、近似正方形".
const ROOM_WIDTH = 5.2;
const ROOM_DEPTH = 5.4;
const WALL_HEIGHT = 2.4;

export function buildBadgerRoom(): BadgerRoomHandle {
  const group = new THREE.Group();
  group.name = "badger-room";

  // Floor + plank lines — identical technique to every other room's own.
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a380, roughness: 0.85 });
  for (let i = -4; i <= 4; i++) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, 0.02), plankMaterial);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(0, 0.001, i * 0.58);
    group.add(plank);
  }

  // Walls — same open-front cutaway shape as every other room. rightWall
  // is built for the same reason the others keep theirs even though it's
  // culled (consistency, and a real surface in case anything ever needs
  // it) — see the file's own top note on which walls actually render.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf6efe1, roughness: 0.9 });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, WALL_HEIGHT), wallMaterial);
  backWall.position.set(0, WALL_HEIGHT / 2, -ROOM_DEPTH / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, WALL_HEIGHT), wallMaterial);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_WIDTH / 2, WALL_HEIGHT / 2, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, WALL_HEIGHT), wallMaterial);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_WIDTH / 2, WALL_HEIGHT / 2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.1, 0.04), trimMaterial);
  trim.position.set(0, 0.05, -ROOM_DEPTH / 2 + 0.02);
  group.add(trim);

  // --- Conference table + ~10 chairs, BACK-RIGHT quadrant (+X, -Z) — the
  // room's most obviously formal fixture, per the brief. Long axis along
  // Z so it reads as a real multi-person table, not a square meeting
  // desk. Kept well clear of the back wall (margin checked against
  // WALL_HEIGHT/ROOM_DEPTH below) and of the room's midline, so it reads
  // clearly as its own back-right cluster rather than spilling into the
  // piano/TV quadrant in front of it. ---
  const TABLE_CENTER = new THREE.Vector3(1.25, 0, -1.1);
  const TABLE_HALF_LENGTH = 0.85; // along Z
  const TABLE_HALF_WIDTH = 0.65; // along X
  const tableLegMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.7 });
  const tableTopMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6 });
  const tableGroup = new THREE.Group();
  tableGroup.position.copy(TABLE_CENTER);
  const tableTop = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_HALF_WIDTH * 2, 0.07, TABLE_HALF_LENGTH * 2),
    tableTopMaterial,
  );
  tableTop.position.set(0, 0.47, 0);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  tableGroup.add(tableTop);
  for (const [lx, lz] of [
    [-(TABLE_HALF_WIDTH - 0.2), -(TABLE_HALF_LENGTH - 0.2)],
    [TABLE_HALF_WIDTH - 0.2, -(TABLE_HALF_LENGTH - 0.2)],
    [-(TABLE_HALF_WIDTH - 0.2), TABLE_HALF_LENGTH - 0.2],
    [TABLE_HALF_WIDTH - 0.2, TABLE_HALF_LENGTH - 0.2],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.07), tableLegMaterial);
    leg.position.set(lx, 0.225, lz);
    leg.castShadow = true;
    tableGroup.add(leg);
  }
  group.add(tableGroup);

  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75 });
  function buildChair(): THREE.Group {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), chairMaterial);
    seat.position.set(0, 0.26, 0);
    seat.castShadow = true;
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.05), chairMaterial);
    back.position.set(0, 0.42, -0.13);
    back.castShadow = true;
    chair.add(back);
    for (const [lx, lz] of [
      [-0.12, -0.12],
      [0.12, -0.12],
      [-0.12, 0.12],
      [0.12, 0.12],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), chairMaterial);
      leg.position.set(lx, 0.13, lz);
      chair.add(leg);
    }
    return chair;
  }

  // Four chairs along each long side (east/west of the table), facing
  // inward, plus one at each end — ten in total, matching "大约10个
  // seats" without needing ten distinct hand-authored meshes.
  const SIDE_CHAIR_OFFSET = 0.95;
  for (const sideChairZ of [
    TABLE_CENTER.z - 0.7,
    TABLE_CENTER.z - 0.23,
    TABLE_CENTER.z + 0.23,
    TABLE_CENTER.z + 0.7,
  ]) {
    const east = buildChair();
    east.rotation.y = -Math.PI / 2; // faces -X, toward the table
    east.position.set(TABLE_CENTER.x + SIDE_CHAIR_OFFSET, 0, sideChairZ);
    group.add(east);

    const west = buildChair();
    west.rotation.y = Math.PI / 2; // faces +X, toward the table
    west.position.set(TABLE_CENTER.x - SIDE_CHAIR_OFFSET, 0, sideChairZ);
    group.add(west);
  }
  const headChairBack = buildChair();
  headChairBack.position.set(TABLE_CENTER.x, 0, TABLE_CENTER.z - (TABLE_HALF_LENGTH + 0.3)); // faces +Z, toward the table
  group.add(headChairBack);
  const headChairFront = buildChair();
  headChairFront.rotation.y = Math.PI; // faces -Z, toward the table
  headChairFront.position.set(TABLE_CENTER.x, 0, TABLE_CENTER.z + (TABLE_HALF_LENGTH + 0.3));
  group.add(headChairFront);

  // --- Piano, EAST wall, FRONT-RIGHT quadrant (+X, +Z) — floor-standing
  // furniture near the culled right wall, same tradeoff weasel-room.ts's
  // own keyboard makes (see the file's own top note). Built as a real
  // upright-piano silhouette: a tall cabinet (the body + closed lid) with
  // a lower keybed ledge and a lighter keys strip raised on TOP of that
  // ledge, the same "thin raised strip on a lower surface's top face"
  // technique weasel-room.ts's own keyboard key strip already uses (there
  // read front-on; here read from this app's fixed elevated isometric
  // angle instead). The keybed deliberately sits closer to the camera
  // than the tall cabinet within the group's own local space (a first
  // attempt with the keybed on the cabinet's far side was caught by a
  // real screenshot reading as one undifferentiated dark box, because the
  // taller cabinet occluded the shorter keybed's top surface from this
  // camera's specific elevation — swapping which element is nearer the
  // camera, not changing the camera itself, fixed it), then the whole
  // assembly is rotated so the keybed/keys face WEST, toward the left
  // wall (the room's one other visible side, per the brief: "键盘正对着
  // 左侧墙壁") rather than toward the camera/open front — a player would
  // sit between the cabinet and the west wall. A bench sits on the
  // keybed's open (west) side, the same "separate piece of furniture, not
  // swallowed by the instrument's own silhouette" clearance weasel-room.ts's
  // own keyboard bench uses. Kept well clear of the table/chairs cluster
  // (different quadrant) and of the TV beside it (checked numerically,
  // not just by eye). ---
  const pianoBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.4 });
  const pianoLidMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.35 });
  const pianoKeysMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf1, roughness: 0.3 });
  const pianoBenchMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75 });
  const PIANO_X = ROOM_WIDTH / 2 - 0.55; // just inside the east wall's own position
  const PIANO_Z = 0.65;
  const pianoGroup = new THREE.Group();
  pianoGroup.position.set(PIANO_X, 0, PIANO_Z);
  // Local +Z (the keybed/bench side, built below) rotates to world -X
  // (west) — a quarter turn from this assembly's original south-facing
  // build, so the keyboard now faces the left wall instead of the camera.
  pianoGroup.rotation.y = -Math.PI / 2;

  // The tall cabinet — the piano's own back, set toward -Z (further from
  // the camera than the keybed below).
  const pianoCabinet = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.05, 0.34), pianoBodyMaterial);
  pianoCabinet.position.set(0, 0.525, -0.18);
  pianoCabinet.castShadow = true;
  pianoGroup.add(pianoCabinet);
  const pianoLid = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.4), pianoLidMaterial);
  pianoLid.position.set(0, 1.075, -0.18);
  pianoLid.castShadow = true;
  pianoGroup.add(pianoLid);

  // The keybed — a lower, shallower ledge protruding toward +Z (south,
  // toward the camera), with the keys strip on its top face so it reads
  // clearly from this app's elevated isometric angle.
  const pianoKeybed = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.58, 0.4), pianoBodyMaterial);
  pianoKeybed.position.set(0, 0.29, 0.19);
  pianoKeybed.castShadow = true;
  pianoGroup.add(pianoKeybed);
  const pianoKeyStrip = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), pianoKeysMaterial);
  pianoKeyStrip.rotation.x = -Math.PI / 2;
  pianoKeyStrip.position.set(0, 0.581, 0.22);
  pianoGroup.add(pianoKeyStrip);

  const pianoBench = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.34), pianoBenchMaterial);
  pianoBench.position.set(0, 0.15, 0.75);
  pianoBench.castShadow = true;
  pianoGroup.add(pianoBench);

  group.add(pianoGroup);

  // --- Large TV, SOUTH edge, FRONT-RIGHT quadrant (+X, +Z) — a real,
  // freestanding solid (a stand plus a screen box with genuine depth),
  // not a wall-mounted panel: see the file's own top note on why. Inset
  // from the room's true south edge so it reads as "against the south
  // wall" from the camera's fixed angle without floating in front of a
  // wall plane that doesn't exist. The screen's own material carries no
  // emissive glow at all — a TV with nobody present shows no content,
  // never a signal of current use (this stage has no occupancy concept
  // yet regardless, but the room must not accidentally claim one). ---
  const tvStandMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.6 });
  const tvBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.4 });
  const tvScreenMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.35 });
  const TV_X = 1.15;
  const TV_Z = ROOM_DEPTH / 2 - 0.6; // inset from the true south edge, never flush with it
  const tvGroup = new THREE.Group();
  tvGroup.position.set(TV_X, 0, TV_Z);
  const tvStand = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.26), tvStandMaterial);
  tvStand.position.set(0, 0.21, 0);
  tvStand.castShadow = true;
  tvGroup.add(tvStand);
  const tvBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 0.08), tvBodyMaterial);
  tvBody.position.set(0, 0.77, 0);
  tvBody.castShadow = true;
  tvGroup.add(tvBody);
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.56), tvScreenMaterial);
  tvScreen.position.set(0, 0.77, 0.041);
  tvGroup.add(tvScreen);
  group.add(tvGroup);

  // --- Sofas, LEFT HALF (-X) — one in the back-left quadrant, one in the
  // front-left quadrant, both flush against the west wall (the one
  // visible side wall in this room's brief; see the file's own top note)
  // and facing into the room. Fixed furniture, not an activity zone —
  // unlike AA Room's own sofa+TV corner, there is no reportable "who's on
  // the sofa doing what" here (ADR 0007: no activities field at all). ---
  const sofaMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.75 });
  function buildSofa(): THREE.Group {
    const sofa = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.32, 0.6), sofaMaterial);
    base.position.set(0, 0.16, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    sofa.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.42, 0.14), sofaMaterial);
    back.position.set(0, 0.43, -0.23);
    back.castShadow = true;
    sofa.add(back);
    const armLeft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.6), sofaMaterial);
    armLeft.position.set(-0.72, 0.17, 0);
    armLeft.castShadow = true;
    sofa.add(armLeft);
    const armRight = armLeft.clone();
    armRight.position.set(0.72, 0.17, 0);
    sofa.add(armRight);
    return sofa;
  }

  const SOFA_X = -ROOM_WIDTH / 2 + 0.45; // clear of the west wall
  const sofaBackLeft = buildSofa();
  sofaBackLeft.rotation.y = Math.PI / 2; // local back sits against the wall, faces +X into the room
  sofaBackLeft.position.set(SOFA_X, 0, -1.3);
  group.add(sofaBackLeft);

  const sofaFrontLeft = buildSofa();
  sofaFrontLeft.rotation.y = Math.PI / 2;
  sofaFrontLeft.position.set(SOFA_X, 0, 1.1);
  group.add(sofaFrontLeft);

  // --- Door threshold, SOUTH edge, FRONT-LEFT quadrant — the open front
  // already *is* the doorway for every room in this app (see the file's
  // own top note), so this is a floor marking, not a wall opening: a
  // contrasting threshold strip plus two short jamb posts, at the room's
  // true south edge, offset toward the left, matching the brief's "door
  // on the south wall, toward the lower-left." ---
  const thresholdMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const DOOR_X = -1.5;
  const DOOR_Z = ROOM_DEPTH / 2 - 0.1;
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.02, 0.22), thresholdMaterial);
  threshold.position.set(DOOR_X, 0.011, DOOR_Z);
  group.add(threshold);
  const jambMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.6 });
  const jambLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), jambMaterial);
  jambLeft.position.set(DOOR_X - 0.5, 0.15, DOOR_Z);
  jambLeft.castShadow = true;
  group.add(jambLeft);
  const jambRight = jambLeft.clone();
  jambRight.position.set(DOOR_X + 0.5, 0.15, DOOR_Z);
  group.add(jambRight);

  // Dim is applied as a flat multiplier against each surface's own base
  // color (never touching roughness/other properties) — paired here,
  // once, with the base hex each material actually started from, same
  // technique every other facility's own ROOM_BASE_COLORS uses.
  const ROOM_BASE_COLORS: Array<[THREE.MeshStandardMaterial, number]> = [
    [floorMaterial, 0xd9c9a3],
    [wallMaterial, 0xf6efe1],
    [tableTopMaterial, 0x8a6a4a],
    [chairMaterial, 0x6b4a2f],
    [sofaMaterial, 0x8a6a4a],
    [pianoBodyMaterial, 0x2c2115],
    [tvBodyMaterial, 0x14110d],
  ];

  // --- Figures: rebuilt on every applyState() call, same "cheap enough
  // to rebuild rather than pool" choice every other facility's own room
  // makes. ---
  const figuresGroup = new THREE.Group();
  group.add(figuresGroup);
  let activeFigures: BadgerRoomFigureHandle[] = [];

  // Three seated slots reuse three of the conference table's own real
  // chair positions/facings (never a new, furniture-free spot), so a
  // seated figure actually sits IN a chair, the same way otter-room.ts's/
  // rabbit-room.ts's own seated slots match real chair positions. One
  // standing slot sits in the open floor area between the table and the
  // sofas — clear of every piece of furniture (table/chairs, piano, TV,
  // sofas, door threshold), checked numerically against each one's own
  // position/extent above, not just by eye. Fixed slots regardless of how
  // many times the room has actually been reported occupied — never a
  // real headcount (ADR 0007: occupancy carries none).
  const SEATED_SLOTS: Array<{ position: THREE.Vector3; facingY: number }> = [
    { position: new THREE.Vector3(TABLE_CENTER.x + SIDE_CHAIR_OFFSET, 0, TABLE_CENTER.z - 0.23), facingY: -Math.PI / 2 },
    { position: new THREE.Vector3(TABLE_CENTER.x - SIDE_CHAIR_OFFSET, 0, TABLE_CENTER.z + 0.23), facingY: Math.PI / 2 },
    { position: new THREE.Vector3(TABLE_CENTER.x, 0, TABLE_CENTER.z - (TABLE_HALF_LENGTH + 0.3)), facingY: 0 },
  ];
  const STANDING_SLOT = { position: new THREE.Vector3(-0.1, 0, -0.5), facingY: Math.PI / 2 };

  function clearFigures(): void {
    for (const figure of activeFigures) figuresGroup.remove(figure.group);
    activeFigures = [];
  }

  let currentDesaturate = 0;
  let seatedCursor = 0;

  function applyState(occupancy: BadgerRoomOccupancy): void {
    const look = lookForBadgerRoom(occupancy);

    clearFigures();
    seatedCursor = 0;
    look.figures.forEach((pose, index) => {
      const slot = pose === "seated" ? SEATED_SLOTS[seatedCursor++ % SEATED_SLOTS.length]! : STANDING_SLOT;
      const figure = buildBadgerRoomFigure(`badger-room-figure-${index}-${pose}`, pose, slot.position, slot.facingY);
      figure.setDesaturate(currentDesaturate);
      figuresGroup.add(figure.group);
      activeFigures.push(figure);
    });

    currentDesaturate = look.desaturate;
    for (const figure of activeFigures) figure.setDesaturate(currentDesaturate);

    // Dim: each surface's own base color scaled toward black by `dim` —
    // same technique every other facility's own room uses. Never touches
    // stored state — purely a presentation response to occupancy
    // ("unknown" only; empty/occupied are both always full brightness).
    for (const [material, baseColor] of ROOM_BASE_COLORS) {
      material.color.setHex(baseColor).multiplyScalar(look.dim);
    }
  }

  function update(elapsedSeconds: number): void {
    for (const figure of activeFigures) figure.update(elapsedSeconds);
  }

  return { group, update, applyState };
}
