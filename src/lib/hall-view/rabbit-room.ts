// Rabbit Room's 3D diorama. Stage 1 built the room's real static geometry
// (two windows, a whiteboard, a long centre table formed from two joined
// desks, many chairs, a kitchen zone at the far end); Stage 2 (this file,
// current version) adds the occupancy-driven look — figures for
// "occupied," none for "empty"/"unknown," and a muted/dimmed room for
// "unknown" — per notes/adr/0005-rabbit-room-live-state.md. Same cutaway
// low-poly visual language as room.ts/aa-room.ts/otter-room.ts, mounted
// on the ONE shared renderer (renderer-host.ts), never a second
// WebGLRenderer.
//
// WALL VISIBILITY, CHECKED BEFORE PLACING ANYTHING (not assumed): this
// app's rooms rely on ordinary backface culling to hide the wall nearest
// the fixed isometric camera, so the camera can see inside at all (see
// scene.ts's ISO_VIEW_DIRECTION — positive X, Y, and Z). A PlaneGeometry
// wall is visible only when its face normal points toward the camera.
// backWall (position -Z, default normal +Z) and leftWall (rotation.y =
// +PI/2, normal rotates to +X) both end up facing the camera's positive-
// X/positive-Z position and stay visible; rightWall (rotation.y = -PI/2,
// normal rotates to -X) faces away and is culled — exactly the fact
// otter-room.ts's own window bug (ADR 0004 era) was caught and fixed
// against. Every wall-mounted fixture below (two windows, the whiteboard,
// the kitchen's wall cabinets) is therefore placed on the LEFT wall or
// the BACK wall only — never the right wall — and this is verified by
// inspection here, not re-derived by trial and error the way the first
// Otter Room attempt was.
//
// NO ACTIVITY-SPECIFIC PROPS, per notes/adr/0005-rabbit-room-live-state.md,
// Decision 1/3: this room has no activity field, because distinguishing
// group study from a shared meal has no decision-relevant value to a
// resident checking the app. "occupied" therefore adds ONLY decorative
// figures (see rabbit-room-figures.ts's own note on why their pose stays
// neutral) — no books, no plates/cutlery, no whiteboard marker strokes,
// nothing that would silently commit the scene to one of the room's two
// real uses the data model deliberately doesn't distinguish.
import * as THREE from "three";
import type { RabbitRoomOccupancy } from "../types.ts";
import { buildRabbitRoomFigure, type RabbitRoomFigureHandle } from "./rabbit-room-figures.ts";
import { lookForRabbitRoom } from "./rabbit-room-status-look.ts";

export interface RabbitRoomHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives figure idle sway. Caller skips calling this under reduced motion (see scene.ts), same convention as every other facility's update(). */
  update(elapsedSeconds: number): void;
  /** Applies a new canonical Rabbit Room state's look — rebuilds which figures are present and sets desaturate/dim. Furniture (table, chairs, whiteboard, windows, kitchen) is never added/removed here — only figures are occupancy-dependent, and there are no occupied-only activity props at all (see the file's own top note). expectedEndAt plays no role here (ADR 0005: it never changes the scene, still just "occupied"). */
  applyState(occupancy: RabbitRoomOccupancy): void;
}

// A long, narrow room — noticeably more elongated than any existing
// facility (Otter Room 3.4 x 2.8, AA Room 5.4 x 4.0): Rabbit Room's own
// brief is explicit that the room itself is long and narrow, seating
// roughly twelve around one long table, double Otter Room's six. WIDTH
// is the X axis (left/right wall separation, the narrow dimension);
// DEPTH is the Z axis (back wall to open front, the long dimension).
const ROOM_WIDTH = 2.6;
const ROOM_DEPTH = 6.0;
const WALL_HEIGHT = 2.3;

// Named Z zones along the room's long axis, back (kitchen, most negative)
// to front (open, most positive) — kept as constants so the table,
// chairs, and kitchen cluster below are laid out from one shared plan
// rather than scattered magic numbers that could silently drift apart.
const KITCHEN_FRONT_Z = -ROOM_DEPTH / 2 + 0.55; // kitchen counter's front edge
const TABLE_HALF_LENGTH = 1.4; // half of the two-joined-desks' combined length

export function buildRabbitRoom(): RabbitRoomHandle {
  const group = new THREE.Group();
  group.name = "rabbit-room";

  // Floor — same warm plank technique as every other room, but planks run
  // along the room's LONG axis (Z) here, repeating across its narrow
  // width (X), the way floorboards in a real long, narrow room usually
  // run lengthwise. This is a deliberate per-room choice reflecting this
  // room's own proportions, not a change to how any other room's floor
  // (which keeps its own width-wise plank orientation) is built.
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a380, roughness: 0.85 });
  for (let i = -4; i <= 4; i++) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(0.02, ROOM_DEPTH - 0.1), plankMaterial);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(i * 0.3, 0.001, 0);
    group.add(plank);
  }

  // Walls — same open-front cutaway shape as every other room. rightWall
  // is built for the same reason the others keep theirs even though it's
  // culled (consistency, and a real surface for anything that might ever
  // need it) — see the file's own top note on which walls actually render.
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

  // --- The centre table: two rectangular desks pushed together to form
  // one long table, the room's visual centrepiece — long enough, and
  // positioned centrally enough, that it reads at a glance as a bigger,
  // more multi-person space than Otter Room's small single table. ---
  const tableLegMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.7 });
  const tableTopMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6 });
  const tableGroup = new THREE.Group();
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, TABLE_HALF_LENGTH * 2), tableTopMaterial);
  tableTop.position.set(0, 0.46, 0);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  tableGroup.add(tableTop);

  // A thin seam strip at the midpoint — the visible hint that this is
  // two desks joined, not one single piece of furniture, matching the
  // real brief ("两张拼接在一起的长方形书桌").
  const seamMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.6 });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.015, 0.03), seamMaterial);
  seam.position.set(0, 0.495, 0);
  tableGroup.add(seam);

  // Eight legs — four per sub-desk, at each desk's own four corners, so
  // the joined-desks reading holds up structurally too, not just via the
  // seam line.
  for (const subDeskCenterZ of [-0.7, 0.7]) {
    for (const [lx, lz] of [
      [-0.405, subDeskCenterZ - 0.6],
      [0.405, subDeskCenterZ - 0.6],
      [-0.405, subDeskCenterZ + 0.6],
      [0.405, subDeskCenterZ + 0.6],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.06), tableLegMaterial);
      leg.position.set(lx, 0.22, lz);
      leg.castShadow = true;
      tableGroup.add(leg);
    }
  }
  group.add(tableGroup);

  // --- Many chairs around the table — "许多椅子", a noticeably fuller
  // ring than Otter Room's three, matching this room's larger real
  // capacity. Built from one local template (facing +Z, back panel at
  // -Z) and rotated per side, rather than four near-duplicated blocks. ---
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

  // Four along each long side, facing the table (rotated toward +X/-X
  // respectively), plus one at each end facing along the table's own
  // axis — ten in total, clearly more than a small study room's handful.
  const SIDE_CHAIR_X = 0.68;
  for (const sideChairZ of [-1.05, -0.35, 0.35, 1.05]) {
    const left = buildChair();
    left.rotation.y = Math.PI / 2; // local +Z (seat-facing) becomes world +X, toward the table
    left.position.set(-SIDE_CHAIR_X, 0, sideChairZ);
    group.add(left);

    const right = buildChair();
    right.rotation.y = -Math.PI / 2; // local +Z becomes world -X, toward the table
    right.position.set(SIDE_CHAIR_X, 0, sideChairZ);
    group.add(right);
  }
  const headChairBack = buildChair();
  headChairBack.position.set(0, 0, -(TABLE_HALF_LENGTH + 0.3)); // faces +Z (default), toward the table
  group.add(headChairBack);
  const headChairFront = buildChair();
  headChairFront.rotation.y = Math.PI; // faces -Z, toward the table from its open-front end
  headChairFront.position.set(0, 0, TABLE_HALF_LENGTH + 0.3);
  group.add(headChairFront);

  // --- Whiteboard and two windows, LEFT wall only — the one visible side
  // wall (see the file's own top note). Spread along the wall's length,
  // front to back, with clear gaps between them and clear of both the
  // table and the kitchen zone at the far end. ---
  const whiteboardFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.6 });
  const whiteboardFrame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.66, 0.03), whiteboardFrameMaterial);
  whiteboardFrame.rotation.y = Math.PI / 2;
  whiteboardFrame.position.set(-ROOM_WIDTH / 2 + 0.02, 1.3, 2.2);
  group.add(whiteboardFrame);
  const whiteboardFaceMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf1, roughness: 0.3 });
  const whiteboardFace = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.58), whiteboardFaceMaterial);
  whiteboardFace.rotation.y = Math.PI / 2;
  whiteboardFace.position.set(-ROOM_WIDTH / 2 + 0.035, 1.3, 2.2);
  group.add(whiteboardFace);

  // Window builder — identical technique to otter-room.ts's own (open
  // four-strip frame with nothing in front of the glass, opaque self-lit
  // glass so its brightness doesn't depend on scene lighting), factored
  // into a local function here specifically because THIS room needs two
  // of them — avoids duplicating that ~20-line shape twice within this
  // one new file. Does not touch or import anything from otter-room.ts.
  const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.65 });
  const windowGlassMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fc8de,
    roughness: 0.3,
    emissive: 0x8fc8de,
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide, // defensive, same reasoning as otter-room.ts's own window glass
  });
  const windowSillMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const WINDOW_INNER_WIDTH = 0.7;
  const WINDOW_INNER_HEIGHT = 0.56;
  const WINDOW_BORDER = 0.07;
  const WINDOW_FRAME_DEPTH = 0.05;
  const windowGlassMeshes: THREE.Mesh[] = [];

  function buildWindow(z: number): void {
    const windowGroup = new THREE.Group();
    windowGroup.position.set(-ROOM_WIDTH / 2 + 0.02, 1.35, z);
    windowGroup.rotation.y = Math.PI / 2; // matches leftWall's own rotation — mounted flush against it

    const glass = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_INNER_WIDTH, WINDOW_INNER_HEIGHT), windowGlassMaterial);
    windowGroup.add(glass);
    windowGlassMeshes.push(glass);

    const outerWidth = WINDOW_INNER_WIDTH + WINDOW_BORDER * 2;
    const outerHeight = WINDOW_INNER_HEIGHT + WINDOW_BORDER * 2;
    const topStrip = new THREE.Mesh(new THREE.BoxGeometry(outerWidth, WINDOW_BORDER, WINDOW_FRAME_DEPTH), windowFrameMaterial);
    topStrip.position.set(0, WINDOW_INNER_HEIGHT / 2 + WINDOW_BORDER / 2, -0.01);
    windowGroup.add(topStrip);
    const bottomStrip = topStrip.clone();
    bottomStrip.position.set(0, -(WINDOW_INNER_HEIGHT / 2 + WINDOW_BORDER / 2), -0.01);
    windowGroup.add(bottomStrip);
    const sideStrip = new THREE.Mesh(new THREE.BoxGeometry(WINDOW_BORDER, WINDOW_INNER_HEIGHT, WINDOW_FRAME_DEPTH), windowFrameMaterial);
    sideStrip.position.set(WINDOW_INNER_WIDTH / 2 + WINDOW_BORDER / 2, 0, -0.01);
    windowGroup.add(sideStrip);
    const sideStrip2 = sideStrip.clone();
    sideStrip2.position.set(-(WINDOW_INNER_WIDTH / 2 + WINDOW_BORDER / 2), 0, -0.01);
    windowGroup.add(sideStrip2);

    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(WINDOW_INNER_WIDTH, 0.025, 0.015), windowFrameMaterial);
    mullionH.position.set(0, 0, 0.02);
    windowGroup.add(mullionH);
    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.025, WINDOW_INNER_HEIGHT, 0.015), windowFrameMaterial);
    mullionV.position.set(0, 0, 0.02);
    windowGroup.add(mullionV);

    const sill = new THREE.Mesh(new THREE.BoxGeometry(outerWidth + 0.08, 0.05, 0.12), windowSillMaterial);
    sill.position.set(0, -(outerHeight / 2 + 0.03), 0.06);
    sill.castShadow = true;
    windowGroup.add(sill);

    group.add(windowGroup);
  }

  // Front window, between the whiteboard and the table; back window,
  // between the table and the kitchen zone — both with clear margins on
  // every side, none overlapping the whiteboard, the table's footprint,
  // or the kitchen counter's own front edge (KITCHEN_FRONT_Z).
  buildWindow(0.6);
  buildWindow(-1.0);

  // --- Kitchen, the far end of the room (FINAL_PROJECT_SOURCE_OF_TRUTH.md
  // §3: stove, sink, microwave, kettle, cabinets) — one continuous base
  // cabinet run flush against the back wall, not loose scattered items,
  // so it reads as a single kitchen zone at a glance. ---
  const kitchenGroup = new THREE.Group();
  const cabinetMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75 });
  const countertopMaterial = new THREE.MeshStandardMaterial({ color: 0x9c9690, roughness: 0.4 });

  const baseCabinet = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 0.55), cabinetMaterial);
  baseCabinet.position.set(0, 0.425, -ROOM_DEPTH / 2 + 0.275);
  baseCabinet.castShadow = true;
  baseCabinet.receiveShadow = true;
  kitchenGroup.add(baseCabinet);

  // Door-divider seams on the cabinet run's front face — a cheap visual
  // cue that this is several cabinet units, not one slab.
  const cabinetSeamMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.6 });
  for (const sx of [-0.37, 0.37]) {
    const cabinetSeam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 0.02), cabinetSeamMaterial);
    cabinetSeam.position.set(sx, 0.425, KITCHEN_FRONT_Z - 0.01);
    kitchenGroup.add(cabinetSeam);
  }

  const countertop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.6), countertopMaterial);
  countertop.position.set(0, 0.875, -ROOM_DEPTH / 2 + 0.3);
  countertop.castShadow = true;
  countertop.receiveShadow = true;
  kitchenGroup.add(countertop);

  const upperCabinetMaterial = cabinetMaterial;
  for (const sx of [-0.75, 0.75]) {
    const upperCabinet = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.35), upperCabinetMaterial);
    upperCabinet.position.set(sx, 1.55, -ROOM_DEPTH / 2 + 0.175);
    upperCabinet.castShadow = true;
    kitchenGroup.add(upperCabinet);
  }

  // Sink — a basin sunk into the countertop (a darker box inset slightly
  // below the countertop's own surface) plus a simple faucet.
  const sinkBasinMaterial = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.3, metalness: 0.3 });
  const sinkBasin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.26), sinkBasinMaterial);
  sinkBasin.position.set(-0.7, 0.865, -ROOM_DEPTH / 2 + 0.3);
  kitchenGroup.add(sinkBasin);
  const faucetMaterial = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.3, metalness: 0.5 });
  const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 8), faucetMaterial);
  faucet.position.set(-0.7, 0.99, -ROOM_DEPTH / 2 + 0.1);
  kitchenGroup.add(faucet);

  // Stove/cooktop — a flat dark panel on the countertop with four burner
  // marks.
  const stoveMaterial = new THREE.MeshStandardMaterial({ color: 0x242019, roughness: 0.4, metalness: 0.2 });
  const stove = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.4), stoveMaterial);
  stove.position.set(0.05, 0.91, -ROOM_DEPTH / 2 + 0.3);
  kitchenGroup.add(stove);
  const burnerMaterial = new THREE.MeshStandardMaterial({ color: 0x0f0c09, roughness: 0.5 });
  for (const [bx, bz] of [
    [-0.12, -0.1],
    [0.12, -0.1],
    [-0.12, 0.1],
    [0.12, 0.1],
  ] as const) {
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 12), burnerMaterial);
    burner.position.set(0.05 + bx, 0.925, -ROOM_DEPTH / 2 + 0.3 + bz);
    kitchenGroup.add(burner);
  }

  // Kettle — a small accent-coloured item on the counter near the stove.
  const kettleMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.4, metalness: 0.3 });
  const kettleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.09, 12), kettleMaterial);
  kettleBody.position.set(0.4, 0.945, -ROOM_DEPTH / 2 + 0.22);
  kettleBody.castShadow = true;
  kitchenGroup.add(kettleBody);
  const kettleLid = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.02, 12), kettleMaterial);
  kettleLid.position.set(0.4, 0.995, -ROOM_DEPTH / 2 + 0.22);
  kitchenGroup.add(kettleLid);
  const kettleHandle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 10, Math.PI), kettleMaterial);
  kettleHandle.rotation.z = Math.PI / 2;
  kettleHandle.position.set(0.47, 0.955, -ROOM_DEPTH / 2 + 0.22);
  kitchenGroup.add(kettleHandle);

  // Microwave — a dark box with a lighter door panel, sitting on the
  // counter's far end.
  const microwaveBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.4 });
  const microwave = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.32), microwaveBodyMaterial);
  microwave.position.set(0.85, 1.04, -ROOM_DEPTH / 2 + 0.3);
  microwave.castShadow = true;
  kitchenGroup.add(microwave);
  const microwaveDoorMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.3 });
  const microwaveDoor = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), microwaveDoorMaterial);
  microwaveDoor.position.set(0.85, 1.04, -ROOM_DEPTH / 2 + 0.46);
  kitchenGroup.add(microwaveDoor);

  group.add(kitchenGroup);

  // Dim is applied as a flat multiplier against each surface's own base
  // color (never touching roughness/other properties) — paired here, once,
  // with the base hex each material actually started from, same technique
  // every other facility's own ROOM_BASE_COLORS uses.
  const ROOM_BASE_COLORS: Array<[THREE.MeshStandardMaterial, number]> = [
    [floorMaterial, 0xd9c9a3],
    [wallMaterial, 0xf6efe1],
    [tableTopMaterial, 0x8a6a4a],
    [chairMaterial, 0x6b4a2f],
    [whiteboardFaceMaterial, 0xfffbf1],
    [windowGlassMaterial, 0x8fc8de],
    [countertopMaterial, 0x9c9690],
    [cabinetMaterial, 0x6b4a2f],
  ];

  // --- Figures: rebuilt on every applyState() call, same "cheap enough
  // to rebuild rather than pool" choice every other facility's own room
  // makes. ---
  const figuresGroup = new THREE.Group();
  group.add(figuresGroup);
  let activeFigures: RabbitRoomFigureHandle[] = [];

  // Fixed slots, spread around the long table rather than clustered at
  // one end — reads as "a small group sharing the room," not "huddled in
  // one corner." Reuses the side-chairs' own X positions/facing so seated
  // figures sit IN a chair, facing the table, the same way otter-room.ts's
  // single "desk" slot matches its own chair position. "standing" sits
  // well clear of every chair and the kitchen zone, in the room's open
  // front area — never a real headcount, purely decorative (ADR 0005:
  // occupancy carries none).
  const SEATED_SLOTS: Array<{ position: THREE.Vector3; facingY: number }> = [
    { position: new THREE.Vector3(-0.68, 0, -1.05), facingY: Math.PI / 2 },
    { position: new THREE.Vector3(0.68, 0, 0.35), facingY: -Math.PI / 2 },
    { position: new THREE.Vector3(-0.68, 0, 1.05), facingY: Math.PI / 2 },
  ];
  const STANDING_SLOTS: Array<{ position: THREE.Vector3; facingY: number }> = [
    { position: new THREE.Vector3(0, 0, 2.2), facingY: Math.PI },
  ];

  function clearFigures(): void {
    for (const figure of activeFigures) figuresGroup.remove(figure.group);
    activeFigures = [];
  }

  let currentDesaturate = 0;

  function applyState(occupancy: RabbitRoomOccupancy): void {
    const look = lookForRabbitRoom(occupancy);

    clearFigures();
    const seatedCursor = { i: 0 };
    const standingCursor = { i: 0 };
    look.figures.forEach((pose, index) => {
      const slots: Array<{ position: THREE.Vector3; facingY: number }> =
        pose === "seated" ? SEATED_SLOTS : STANDING_SLOTS;
      const cursor = pose === "seated" ? seatedCursor : standingCursor;
      const slot = slots[cursor.i % slots.length]!;
      cursor.i += 1;
      const figure = buildRabbitRoomFigure(`rabbit-room-figure-${index}-${pose}`, pose, slot.position, slot.facingY);
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
