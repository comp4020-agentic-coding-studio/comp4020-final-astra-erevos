// Rat Room's 3D diorama. Stage 1 built the room's real static geometry
// (perimeter computer desks, a printer, a door threshold); Stage 2 (this
// file, current version) adds the occupancy-driven look — figures for
// derived-"occupied," none for derived-"empty"/"unknown," and a
// muted/dimmed room for derived-"unknown" — per
// notes/adr/0008-rat-room-live-state.md. Same cutaway low-poly visual
// language as room.ts/aa-room.ts/otter-room.ts/rabbit-room.ts/
// weasel-room.ts/badger-room.ts, mounted on the ONE shared renderer
// (renderer-host.ts), never a second WebGLRenderer.
//
// REAL, CONFIRMED FACTS ONLY (see the brief this stage was built from): a
// wide, shallow rectangular room — clearly wider than deep, unlike every
// other room in this app so far. A door in the south-west corner. A
// printer in the north-west corner. Desks line most of the remaining
// walls, holding approximately ten computers. No window, and no other
// confirmed furniture (no whiteboard, no heater, no sofa, no central
// table, no shelves) — none are added here.
//
// THE A-J PRODUCT MODEL IS NOT A 3D REQUIREMENT: ADR 0008 commits to
// exactly ten fixed, reportable seat slots (A-J) as a PRODUCT decision,
// independent of the room's own "approximately ten" physical count (ADR
// 0008, Context). This file draws roughly ten computer workstations so
// the room reads clearly as a computer lab, but this is a DECORATIVE
// APPROXIMATION of the real room's furniture, not a rendering of the
// product's seat slots — there is no workstation-to-seat mapping
// anywhere in this file (no workstation is "seat A," no workstation
// index corresponds to a seat letter). THIS HOLDS FOR STAGE 2'S FIGURES
// TOO: applyState() below takes only the already-DERIVED three-valued
// room `visual` (summarizeRatRoomSeats() in src/lib/types.ts), never any
// individual seat's own state and never occupiedCount/emptyCount/
// unknownCount — the figure count is a small, fixed constant
// (rat-room-status-look.ts's own OCCUPIED_FIGURES) that never varies
// with how many of the ten seats are actually occupied, the exact same
// "decorative, never a real count" rule every other room's own figures
// already follow for headcount. Figures are never placed AT one of the
// workstations built below — they sit in the room's own open central
// area, deliberately clear of every named workstation, so nothing here
// could even be misread as "this specific desk is occupied."
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
// recently badger-room.ts) was built against.
//
// Mapping the room's real compass layout onto this fixed geometry (same
// convention every prior room established): south (the door) -> the
// open front (+Z), no wall exists there at all. North (the printer, and
// most of the desk run) -> the BACK wall (-Z) — visible. West (desks,
// south of the printer, clear of the door) -> the LEFT wall (-X) —
// visible. East (the remaining desk run) -> the RIGHT wall (+X) —
// CULLED, so its own desks are built as floor-standing furniture with no
// rendered wall behind them, the exact tradeoff every prior room's own
// east/right-side furniture already makes (a floor-standing fixture
// reads as "positioned at the room's east side" through its own
// position/orientation alone, with no rendered wall plane required).
//
// THE PRINTER IS FIXED FURNITURE, NOT A REPORTABLE RESOURCE: no status
// light, no queue indicator, no usage animation (ADR 0008, Decision 5 —
// "No printer availability or queue," named directly). A simple body +
// a lighter paper-tray/output accent is enough to read as "a printer,"
// nothing more.
//
// THE DOOR IS EXPRESSED AS A THRESHOLD, NOT A WALL OPENING: the open
// front already *is* the doorway for every room in this app, so nothing
// needs to be cut out of a wall. A floor threshold strip plus two short
// door-jamb posts, offset toward the room's south-west corner, marks
// where the door is without requiring — or breaking — the existing fixed
// dollhouse camera.
import * as THREE from "three";
import type { RatRoomSummary } from "../types.ts";
import { buildRatRoomFigure, type RatRoomFigureHandle } from "./rat-room-figures.ts";
import { lookForRatRoom } from "./rat-room-status-look.ts";

export interface RatRoomHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives figure idle sway. Caller skips calling this under reduced motion (see scene.ts), same convention as every other facility's update(). */
  update(elapsedSeconds: number): void;
  /** Applies a new DERIVED room visual's look — rebuilds which figures are present and sets desaturate/dim. Takes only the already-reduced `visual` value (summarizeRatRoomSeats() in src/lib/types.ts), never any individual seat's own state — see the file's own top note. Furniture (desks, monitors, chairs, printer, door threshold) is never added/removed here — only figures are visual-dependent, and there are no occupied-only activity props at all. expectedEndAt plays no role here at any seat (ADR 0008: it never changes the scene, still just whichever visual the ten seats currently derive to). */
  applyState(visual: RatRoomSummary["visual"]): void;
}

// Wide and shallow — clearly wider (X) than deep (Z), unlike every other
// facility built so far, matching the brief's "横向长方形" explicitly.
const ROOM_WIDTH = 6.4;
const ROOM_DEPTH = 4.4;
const WALL_HEIGHT = 2.3;

export function buildRatRoom(): RatRoomHandle {
  const group = new THREE.Group();
  group.name = "rat-room";

  // Floor + plank lines — identical technique to every other room's own,
  // planks running along the room's long (X) axis since this room's own
  // proportions are wide rather than deep (same per-room judgement
  // rabbit-room.ts's own long-axis plank choice already makes).
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a380, roughness: 0.85 });
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(0.02, ROOM_DEPTH - 0.1), plankMaterial);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(i * 0.85, 0.001, 0);
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

  // --- Computer workstation builder: desk + monitor + chair, facing
  // local +Z out of the wall it's mounted against (same "chair's default
  // facing is +Z" convention otter-room.ts's/badger-room.ts's own
  // buildChair() already uses), then wrapped in a positioning group whose
  // own rotation.y points that +Z face into the room from whichever wall
  // it's placed against. Deliberately plain: a desk surface, a monitor
  // silhouette, a chair — no screen content, no keyboard, no books/
  // papers/headphones/bags, nothing occupant-specific (this stage has no
  // occupancy concept at all yet, and even Stage 2 must never add these
  // — see the file's own top note and ADR 0008, Decision 5's "no activity
  // taxonomy"). ---
  const deskMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6 });
  const deskLegMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.7 });
  const monitorBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.4 });
  const monitorScreenMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.35 });
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75 });

  function buildWorkstation(): THREE.Group {
    const station = new THREE.Group();

    // Desk — a slim surface against the wall (local -Z side), legs at
    // its four corners.
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.46), deskMaterial);
    deskTop.position.set(0, 0.46, -0.1);
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    station.add(deskTop);
    for (const [lx, lz] of [
      [-0.3, -0.28],
      [0.3, -0.28],
      [-0.3, 0.08],
      [0.3, 0.08],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.04), deskLegMaterial);
      leg.position.set(lx, 0.22, lz);
      station.add(leg);
    }

    // Monitor — a slim stand + a flat screen panel, sitting toward the
    // desk's back (wall-facing) edge, no stand-mounted content.
    const monitorStand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), monitorBodyMaterial);
    monitorStand.position.set(0, 0.54, -0.22);
    station.add(monitorStand);
    const monitorBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.03), monitorBodyMaterial);
    monitorBody.position.set(0, 0.72, -0.24);
    monitorBody.castShadow = true;
    station.add(monitorBody);
    const monitorScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.37, 0.21), monitorScreenMaterial);
    monitorScreen.position.set(0, 0.72, -0.225);
    station.add(monitorScreen);

    // Chair — reused low-poly shape every other room's own buildChair()
    // already uses, facing +Z (toward the desk, away from the wall).
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), chairMaterial);
    seat.position.set(0, 0.26, 0.42);
    seat.castShadow = true;
    station.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.05), chairMaterial);
    back.position.set(0, 0.42, 0.29);
    back.castShadow = true;
    station.add(back);
    for (const [lx, lz] of [
      [-0.12, 0.3],
      [0.12, 0.3],
      [-0.12, 0.54],
      [0.12, 0.54],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), chairMaterial);
      leg.position.set(lx, 0.13, lz);
      station.add(leg);
    }

    return station;
  }

  // --- North wall (back, visible) — desk run east of the printer, per
  // the brief: "除 printer 所在区域外，其余墙边基本都有 desks." Four
  // workstations, evenly spaced, kept well clear of both the printer
  // (north-west corner) and the east wall's own desk run (a different
  // wall, never overlapping). ---
  const NORTH_PITCH = 1.05;
  const NORTH_START_X = -1.5;
  for (let i = 0; i < 4; i++) {
    const station = buildWorkstation();
    // Local +Z (the chair/monitor-facing side) must point away from the
    // north wall, into the room — i.e. toward world +Z. No rotation
    // needed: a station's own local +Z already matches world +Z by
    // default, the same "no rotation needed" case backWall-mounted
    // fixtures in every prior room's own file already document (e.g.
    // weasel-room.ts's own back-wall window).
    station.position.set(NORTH_START_X + i * NORTH_PITCH, 0, -ROOM_DEPTH / 2 + 0.26);
    group.add(station);
  }

  // --- West wall (left, visible) — desk run south of the printer,
  // stopping well short of the room's true south edge so the door
  // threshold (south-west corner) keeps real clearance. Two
  // workstations: the west wall's own usable run (south of the printer,
  // north of the door) is shorter than the north/east walls' own full
  // runs. ---
  const WEST_PITCH = 1.05;
  const WEST_START_Z = -0.75;
  for (let i = 0; i < 2; i++) {
    const station = buildWorkstation();
    // The desk's own back edge (local -Z) must sit flush against the
    // west wall, with the chair (local +Z) extending into the room —
    // i.e. local -Z maps to world -X. rotation.y = +PI/2 achieves this
    // (confirmed numerically, not assumed: local -Z under +PI/2 rotates
    // to world -X exactly).
    station.rotation.y = Math.PI / 2;
    station.position.set(-ROOM_WIDTH / 2 + 0.26, 0, WEST_START_Z + i * WEST_PITCH);
    group.add(station);
  }

  // --- East wall (right, CULLED) — the remaining desk run, built as
  // ordinary floor-standing furniture near that side (no rendered wall
  // behind it needed — see the file's own top note). Four workstations,
  // the full depth of the room, mirroring the north run's own spacing
  // logic rotated onto this wall. ---
  const EAST_PITCH = 1.05;
  const EAST_START_Z = -1.575;
  for (let i = 0; i < 4; i++) {
    const station = buildWorkstation();
    // The desk's own back edge (local -Z) must sit flush against the
    // east wall, with the chair (local +Z) extending into the room —
    // i.e. local -Z maps to world +X. rotation.y = -PI/2 achieves this
    // (confirmed numerically: local -Z under -PI/2 rotates to world +X
    // exactly) — the mirror image of the west wall's own rotation above.
    station.rotation.y = -Math.PI / 2;
    station.position.set(ROOM_WIDTH / 2 - 0.26, 0, EAST_START_Z + i * EAST_PITCH);
    group.add(station);
  }

  // --- Printer, NORTH-WEST corner — fixed furniture, no status light,
  // no queue indicator, no usage animation (ADR 0008, Decision 5). A
  // body + a lighter paper-tray/output accent on top is enough to read
  // as "a printer." Positioned against the back-left corner, the one
  // corner formed by the two walls that are BOTH actually visible (back
  // + left), same "both adjoining walls visible" placement guitar in
  // weasel-room.ts's own back-left corner uses. ---
  const printerBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.45 });
  const printerAccentMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.6 });
  const printerGroup = new THREE.Group();
  printerGroup.position.set(-ROOM_WIDTH / 2 + 0.45, 0, -ROOM_DEPTH / 2 + 0.4);
  const printerBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.42), printerBodyMaterial);
  printerBody.position.set(0, 0.16, 0);
  printerBody.castShadow = true;
  printerGroup.add(printerBody);
  const printerTray = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.3), printerAccentMaterial);
  printerTray.position.set(0, 0.34, -0.02);
  printerGroup.add(printerTray);
  group.add(printerGroup);

  // --- Door threshold, SOUTH-WEST corner — the open front already *is*
  // the doorway for every room in this app (see the file's own top
  // note), so this is a floor marking, not a wall opening: a contrasting
  // threshold strip plus two short jamb posts, at the room's true south
  // edge, offset toward the west, matching the brief's "门在左下角 /
  // south-west corner." ---
  const thresholdMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const DOOR_X = -ROOM_WIDTH / 2 + 0.9;
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
    [deskMaterial, 0x8a6a4a],
    [chairMaterial, 0x6b4a2f],
    [monitorBodyMaterial, 0x2c2115],
    [printerBodyMaterial, 0xe8e0d0],
  ];

  // --- Figures: rebuilt on every applyState() call, same "cheap enough
  // to rebuild rather than pool" choice every other facility's own room
  // makes. Placed AT two of the workstations/aisles built above, so the
  // room reads as "being used for computer work," not as people standing
  // on open floor — but the two workstations used for this are a FIXED,
  // hardcoded decorative choice, not derived from which real A-J seat is
  // actually occupied. There is still no seat->workstation mapping: no
  // workstation is ever labelled, so nothing here can be read as "this is
  // seat A" — these slots just happen to reuse two of the ten
  // already-built, anonymous desks for a figure to sit at (see the file's
  // own top note). ---
  const figuresGroup = new THREE.Group();
  group.add(figuresGroup);
  let activeFigures: RatRoomFigureHandle[] = [];

  // Fixed slots, each one planted at (or just beside) one specific,
  // already-built workstation — never derived from occupiedCount or any
  // seat's own state, never varying with which of the ten seats is
  // actually occupied (see rat-room-status-look.ts's own OCCUPIED_FIGURES
  // constant). Positions/facing are computed directly from that
  // workstation's own chair position and the station group's own
  // rotation (same rotation math verified for the workstations
  // themselves, above), so a seated figure lines up with its chair
  // instead of floating on open floor.
  //
  // Seat 1: the west wall's first workstation (WEST i=0) — chair world
  // position (-2.52, 0, -0.75), facing world +X (that station's own
  // rotation.y = +PI/2, matching its chair's own orientation).
  // Seat 2: the north wall's second workstation (NORTH i=1) — chair world
  // position (-0.45, 0, -1.52), facing world +Z (no rotation, same as
  // that station's own chair).
  const SEATED_SLOTS: Array<{ position: THREE.Vector3; facingY: number }> = [
    { position: new THREE.Vector3(-2.52, 0, -0.75), facingY: Math.PI / 2 },
    { position: new THREE.Vector3(-0.45, 0, -1.52), facingY: 0 },
  ];
  // Standing slot: in the aisle just off the east wall's third
  // workstation (EAST i=2, chair world position (2.52, 0, 0.525)) —
  // offset 0.5 further into the room (world -X, that station's own
  // facing direction) so it reads as someone approaching/pausing near
  // that desk, not sitting in its chair or standing in the open middle
  // of the room.
  const STANDING_SLOT = { position: new THREE.Vector3(2.02, 0, 0.525), facingY: -Math.PI / 2 };

  function clearFigures(): void {
    for (const figure of activeFigures) figuresGroup.remove(figure.group);
    activeFigures = [];
  }

  let currentDesaturate = 0;
  let seatedCursor = 0;

  function applyState(visual: RatRoomSummary["visual"]): void {
    const look = lookForRatRoom(visual);

    clearFigures();
    seatedCursor = 0;
    look.figures.forEach((pose, index) => {
      const slot = pose === "seated" ? SEATED_SLOTS[seatedCursor++ % SEATED_SLOTS.length]! : STANDING_SLOT;
      const figure = buildRatRoomFigure(`rat-room-figure-${index}-${pose}`, pose, slot.position, slot.facingY);
      figure.setDesaturate(currentDesaturate);
      figuresGroup.add(figure.group);
      activeFigures.push(figure);
    });

    currentDesaturate = look.desaturate;
    for (const figure of activeFigures) figure.setDesaturate(currentDesaturate);

    // Dim: each surface's own base color scaled toward black by `dim` —
    // same technique every other facility's own room uses. Never touches
    // stored state — purely a presentation response to the derived
    // visual ("unknown" only; empty/occupied are both always full
    // brightness).
    for (const [material, baseColor] of ROOM_BASE_COLORS) {
      material.color.setHex(baseColor).multiplyScalar(look.dim);
    }
  }

  function update(elapsedSeconds: number): void {
    for (const figure of activeFigures) figure.update(elapsedSeconds);
  }

  return { group, update, applyState };
}
