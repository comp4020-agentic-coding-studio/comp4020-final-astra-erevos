// Weasel Room's 3D diorama. Stage 1 built the room's real static geometry
// (door opening, window, whiteboard, guitar, keyboard + bench, two
// chairs, heater); Stage 2 (this file, current version) adds the
// occupancy-driven look — figures for "occupied," none for
// "empty"/"unknown," and a muted/dimmed room for "unknown" — per
// notes/adr/0006-weasel-room-live-state.md. Same cutaway low-poly visual
// language as room.ts/aa-room.ts/otter-room.ts/rabbit-room.ts, mounted on
// the ONE shared renderer (renderer-host.ts), never a second
// WebGLRenderer.
//
// NO ACTIVITY-SPECIFIC PROPS, per notes/adr/0006-weasel-room-live-state.md,
// Decision 1/3: this room has no activity field, because knowing which
// instrument is actually being played has no decision-relevant value to a
// resident checking the app. "occupied" therefore adds ONLY decorative
// figures (see weasel-room-figures.ts's own note on why their pose stays
// neutral) — no sheet music, no pick, no open songbook, no whiteboard
// marker strokes, nothing that would silently commit the scene to one of
// the room's two real uses the data model deliberately doesn't
// distinguish. Guitar and keyboard themselves are always-present
// furniture (Stage 1), never toggled by occupancy.
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
// away and is culled — exactly the fact otter-room.ts's own window bug
// (ADR 0004 era) was caught and fixed against, and exactly the mistake
// this room must not repeat.
//
// Mapping the room's real compass layout onto this fixed geometry:
//  - south (the door) -> the open front (+Z) — no wall exists there at
//    all, same as every other room's own "door side."
//  - north (the window, directly opposite the door) -> the BACK wall
//    (-Z) — visible. Mounted with NO rotation (unlike a left/right-wall
//    window): the back wall's own default normal is already +Z, so a
//    window built flat in the XY plane (a PlaneGeometry's default
//    orientation) already matches it without needing the rotation.y =
//    +-PI/2 a side-wall-mounted window needs.
//  - west (the whiteboard) -> the LEFT wall (-X) — visible. Mounted with
//    rotation.y = +PI/2, matching the wall's own rotation, same technique
//    otter-room.ts's/rabbit-room.ts's own whiteboards use.
//  - east (the keyboard) -> the RIGHT wall (+X) — CULLED, never rendered.
//    This is a real, deliberate tradeoff, not an oversight: the
//    whiteboard is a true wall-mounted panel that needs a rendered
//    backdrop to read as "flush against the wall" the way a window does;
//    the keyboard is floor-standing furniture (an instrument + its own
//    bench), which can still read clearly as "positioned at the room's
//    east side" through its position/orientation alone, with no rendered
//    wall plane required behind it. Only one of "whiteboard" and
//    "keyboard" could have the one remaining visible side wall, and the
//    wall-mounted fixture gets it.
//
// NO ACTIVITY-SPECIFIC PROPS, no figures: this stage is explicitly the
// static Empty shell only. Guitar and keyboard are both always-present
// furniture (named directly in the room's own brief), not occupied-only
// activity dressing — they stay visible regardless of whatever
// occupancy-driven layer a later stage adds, the same way Otter Room's
// table/chairs/whiteboard panel/window/heater are always present while
// only its book/laptop/marker-strokes are occupied-only.
import * as THREE from "three";
import type { WeaselRoomOccupancy } from "../types.ts";
import { buildWeaselRoomFigure, type WeaselRoomFigureHandle } from "./weasel-room-figures.ts";
import { lookForWeaselRoom } from "./weasel-room-status-look.ts";

export interface WeaselRoomHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives the heater's faint idle glow pulse and figure idle sway. Caller skips calling this under reduced motion (see scene.ts), same convention as every other facility's update(). */
  update(elapsedSeconds: number): void;
  /** Applies a new canonical Weasel Room state's look — rebuilds which figures are present and sets desaturate/dim. Furniture (guitar, keyboard, bench, chairs, whiteboard, window, heater) is never added/removed here — only figures are occupancy-dependent, and there are no occupied-only activity props at all (see the file's own top note). expectedEndAt plays no role here (ADR 0006: it never changes the scene, still just "occupied"). */
  applyState(occupancy: WeaselRoomOccupancy): void;
}

// A small square room, matching the brief ("正方形小型 Music Room") —
// width and depth are deliberately equal, unlike every other facility's
// own rectangular footprint.
const ROOM_WIDTH = 3.0;
const ROOM_DEPTH = 3.0;
const WALL_HEIGHT = 2.3;

export function buildWeaselRoom(): WeaselRoomHandle {
  const group = new THREE.Group();
  group.name = "weasel-room";

  // Floor + plank lines — identical technique to otter-room.ts's/
  // room.ts's (planks run along the width, repeating front-to-back).
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a380, roughness: 0.85 });
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, 0.02), plankMaterial);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(0, 0.001, i * 0.42);
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

  // --- Window, NORTH (back) wall, centered — directly opposite the door
  // (the open front), per the brief. See the file's own top note on why
  // this one needs NO rotation, unlike a side-wall-mounted window:
  // the back wall's own default normal already matches a window plane
  // built flat in its local XY plane. Same open four-strip frame +
  // self-lit emissive glass technique as every other room's own windows
  // (never imported — each room keeps its own small, independent
  // buildWindow, per the project's established "no shared furniture
  // module" choice). ---
  const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.65 });
  const windowGlassMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fc8de,
    roughness: 0.3,
    emissive: 0x8fc8de,
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide, // defensive, same reasoning as every other room's own window glass
  });
  const windowSillMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const WINDOW_INNER_WIDTH = 0.8;
  const WINDOW_INNER_HEIGHT = 0.6;
  const WINDOW_BORDER = 0.08;
  const WINDOW_FRAME_DEPTH = 0.05;

  const windowGroup = new THREE.Group();
  // No rotation — flush against the BACK wall's own un-rotated +Z normal,
  // centered along the wall's width, at the same height every other
  // room's own window uses.
  windowGroup.position.set(0, 1.35, -ROOM_DEPTH / 2 + 0.02);

  const windowGlass = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_INNER_WIDTH, WINDOW_INNER_HEIGHT), windowGlassMaterial);
  windowGroup.add(windowGlass);

  const windowOuterWidth = WINDOW_INNER_WIDTH + WINDOW_BORDER * 2;
  const windowOuterHeight = WINDOW_INNER_HEIGHT + WINDOW_BORDER * 2;
  const windowTopStrip = new THREE.Mesh(new THREE.BoxGeometry(windowOuterWidth, WINDOW_BORDER, WINDOW_FRAME_DEPTH), windowFrameMaterial);
  windowTopStrip.position.set(0, WINDOW_INNER_HEIGHT / 2 + WINDOW_BORDER / 2, -0.01);
  windowGroup.add(windowTopStrip);
  const windowBottomStrip = windowTopStrip.clone();
  windowBottomStrip.position.set(0, -(WINDOW_INNER_HEIGHT / 2 + WINDOW_BORDER / 2), -0.01);
  windowGroup.add(windowBottomStrip);
  const windowSideStrip = new THREE.Mesh(new THREE.BoxGeometry(WINDOW_BORDER, WINDOW_INNER_HEIGHT, WINDOW_FRAME_DEPTH), windowFrameMaterial);
  windowSideStrip.position.set(WINDOW_INNER_WIDTH / 2 + WINDOW_BORDER / 2, 0, -0.01);
  windowGroup.add(windowSideStrip);
  const windowSideStrip2 = windowSideStrip.clone();
  windowSideStrip2.position.set(-(WINDOW_INNER_WIDTH / 2 + WINDOW_BORDER / 2), 0, -0.01);
  windowGroup.add(windowSideStrip2);

  const windowMullionH = new THREE.Mesh(new THREE.BoxGeometry(WINDOW_INNER_WIDTH, 0.025, 0.015), windowFrameMaterial);
  windowMullionH.position.set(0, 0, 0.02);
  windowGroup.add(windowMullionH);
  const windowMullionV = new THREE.Mesh(new THREE.BoxGeometry(0.025, WINDOW_INNER_HEIGHT, 0.015), windowFrameMaterial);
  windowMullionV.position.set(0, 0, 0.02);
  windowGroup.add(windowMullionV);

  const windowSill = new THREE.Mesh(new THREE.BoxGeometry(windowOuterWidth + 0.08, 0.05, 0.12), windowSillMaterial);
  windowSill.position.set(0, -(windowOuterHeight / 2 + 0.03), 0.06);
  windowSill.castShadow = true;
  windowGroup.add(windowSill);

  group.add(windowGroup);

  // --- Whiteboard, WEST (left) wall — the one remaining visible wall, per
  // the file's own top note on why it (not the keyboard) gets it.
  // Positioned mid-wall, clear of both the guitar corner (toward the
  // back) and the heater (toward the front) along the same wall.
  //
  // The face plane is offset a full WHITEBOARD_BORDER_DEPTH past the
  // frame's own inner face, not a near-touching 0.015 fraction of the
  // frame's depth — the same shape as this room's own window glass (set
  // in front of its frame strips' -0.01 z, not flush with them). A
  // same-plane face+frame mount (checked directly against this room's
  // first attempt, which matched Otter Room's/Rabbit Room's own existing
  // 0.02-frame/0.035-face offsets) z-fights: two coplanar triangles at
  // the exact same depth render with an unstable, flickering diagonal
  // tear where the GPU can't consistently decide which surface is in
  // front — caught by a real screenshot, not assumed from the code.
  // Otter Room's and Rabbit Room's own whiteboards carry this same latent
  // offset (confirmed by inspection), but this file does not touch
  // either of those already-shipped, production-verified rooms to fix
  // it — only its own new geometry. ---
  const WHITEBOARD_FRAME_DEPTH = 0.03;
  const WHITEBOARD_FACE_CLEARANCE = 0.02; // clearly past the frame's own inner face, not a near-coplanar fraction of it
  const whiteboardFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.6 });
  const whiteboardFrame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, WHITEBOARD_FRAME_DEPTH), whiteboardFrameMaterial);
  whiteboardFrame.rotation.y = Math.PI / 2;
  whiteboardFrame.position.set(-ROOM_WIDTH / 2 + 0.02, 1.3, -0.15);
  group.add(whiteboardFrame);
  const whiteboardFaceMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf1, roughness: 0.3 });
  const whiteboardFace = new THREE.Mesh(new THREE.PlaneGeometry(0.87, 0.54), whiteboardFaceMaterial);
  whiteboardFace.rotation.y = Math.PI / 2;
  whiteboardFace.position.set(-ROOM_WIDTH / 2 + 0.02 + WHITEBOARD_FRAME_DEPTH / 2 + WHITEBOARD_FACE_CLEARANCE, 1.3, -0.15);
  group.add(whiteboardFace);

  // --- Guitar, leaning in the back-left corner — the one corner formed by
  // the two walls that are BOTH actually visible (back + left), so it
  // reads clearly against real wall surfaces rather than floating near an
  // invisible one. A low-poly figure-8 silhouette (two flattened spheres,
  // overlapping) plus a neck and headstock, not a single undifferentiated
  // rod — tilted via a nested group so the lean pivots from the floor
  // contact point, and rotated to face diagonally into the room (matching
  // the camera's own 45-degree azimuth) so its body profile, not its
  // edge, is what the camera actually sees. ---
  const guitarBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xa6692f, roughness: 0.6 });
  const guitarAccentMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.6 });

  const guitarFacing = new THREE.Group(); // rotation.y: which way the guitar's flat face points
  const guitarLean = new THREE.Group(); // rotation.x: the backward lean against the corner, pivoting at the floor
  guitarFacing.add(guitarLean);

  const guitarLowerBout = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), guitarBodyMaterial);
  guitarLowerBout.scale.set(1, 1, 0.35);
  guitarLowerBout.position.set(0, 0.22, 0);
  guitarLowerBout.castShadow = true;
  guitarLean.add(guitarLowerBout);

  const guitarUpperBout = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), guitarBodyMaterial);
  guitarUpperBout.scale.set(1, 1, 0.35);
  guitarUpperBout.position.set(0, 0.42, 0);
  guitarUpperBout.castShadow = true;
  guitarLean.add(guitarUpperBout);

  const guitarSoundHole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), guitarAccentMaterial);
  guitarSoundHole.position.set(0, 0.3, 0.057);
  guitarLean.add(guitarSoundHole);

  const guitarNeck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.035), guitarAccentMaterial);
  guitarNeck.position.set(0, 0.78, 0);
  guitarNeck.castShadow = true;
  guitarLean.add(guitarNeck);

  const guitarHeadstock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), guitarAccentMaterial);
  guitarHeadstock.position.set(0, 1.08, 0);
  guitarHeadstock.castShadow = true;
  guitarLean.add(guitarHeadstock);

  guitarLean.rotation.x = -0.16; // leans back into the corner, pivoting at the floor
  guitarFacing.rotation.y = Math.PI / 4; // faces diagonally into the room, matching the camera's own azimuth
  guitarFacing.position.set(-1.22, 0, -1.22); // the back-left corner — both adjoining walls are visible here
  group.add(guitarFacing);

  // --- Keyboard + bench, EAST side — floor-standing furniture near the
  // culled right wall (see the file's own top note on why this fixture,
  // not the whiteboard, goes here). Body + four thin legs, a lighter key
  // strip along its west-facing edge (the side actually played from), and
  // a separate bench to its west, facing it. ---
  const keyboardBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.4 });
  const keyboardKeysMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf1, roughness: 0.3 });
  const keyboardLegMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.6 });

  const KEYBOARD_X = ROOM_WIDTH / 2 - 0.37; // just inside the east wall's own position

  const keyboardGroup = new THREE.Group();
  keyboardGroup.position.set(KEYBOARD_X, 0, 0);

  const keyboardBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 1.1), keyboardBodyMaterial);
  keyboardBody.position.set(0, 0.74, 0);
  keyboardBody.castShadow = true;
  keyboardGroup.add(keyboardBody);

  const keyboardKeyStrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 1.0), keyboardKeysMaterial);
  keyboardKeyStrip.position.set(-0.15, 0.776, 0); // the west-facing edge — the side actually played from
  keyboardGroup.add(keyboardKeyStrip);

  for (const lx of [-0.14, 0.14] as const) {
    for (const lz of [-0.48, 0.48] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.04), keyboardLegMaterial);
      leg.position.set(lx, 0.35, lz);
      keyboardGroup.add(leg);
    }
  }
  group.add(keyboardGroup);

  const benchMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75 });
  const benchGroup = new THREE.Group();
  // West of the keyboard, facing it, with real clearance — not just
  // enough to avoid a literal mesh overlap, but enough that the bench
  // reads as its own separate piece of furniture rather than tucked
  // under the keyboard's own wide, elevated tabletop from this camera's
  // angle. A real screenshot caught an earlier, tighter offset (0.42)
  // rendering the bench as almost entirely swallowed by the keyboard's
  // silhouette — this wider gap (0.75) was verified against a fresh
  // screenshot to actually clear it.
  benchGroup.position.set(KEYBOARD_X - 0.75, 0, 0);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.85), benchMaterial);
  bench.position.set(0, 0.42, 0);
  bench.castShadow = true;
  benchGroup.add(bench);
  for (const lx of [-0.1, 0.1] as const) {
    for (const lz of [-0.35, 0.35] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.035), benchMaterial);
      leg.position.set(lx, 0.21, lz);
      benchGroup.add(leg);
    }
  }
  group.add(benchGroup);

  // --- Two ordinary chairs — fixed furniture, loosely placed toward the
  // room's open centre, clear of the guitar corner, the whiteboard, and
  // the keyboard/bench so none overlap. ---
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

  const chairA = buildChair();
  chairA.rotation.y = Math.PI / 5;
  chairA.position.set(-0.35, 0, 0.55);
  group.add(chairA);

  const chairB = buildChair();
  chairB.rotation.y = -Math.PI / 6;
  chairB.position.set(0.45, 0, 0.75);
  group.add(chairB);

  // --- Heater, southwest corner — the LEFT wall's front end (west side,
  // near the open front/south), same finned-radiator technique as every
  // other room's own heater (never imported — its own small,
  // independent build, same reasoning as the window above). ---
  const heaterBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.45 });
  const heaterGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9822b,
    emissive: 0xd9822b,
    emissiveIntensity: 0.25,
    roughness: 0.5,
  });
  const heaterGroup = new THREE.Group();
  heaterGroup.position.set(-ROOM_WIDTH / 2 + 0.07, 0.3, 1.05);
  const heaterBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.6), heaterBodyMaterial);
  heaterBody.castShadow = true;
  heaterGroup.add(heaterBody);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.46, 0.02), heaterGlowMaterial);
    fin.position.set(0, 0, i * 0.11);
    heaterGroup.add(fin);
  }
  group.add(heaterGroup);

  // Dim is applied as a flat multiplier against each surface's own base
  // color (never touching roughness/other properties) — paired here, once,
  // with the base hex each material actually started from, same technique
  // every other facility's own ROOM_BASE_COLORS uses.
  const ROOM_BASE_COLORS: Array<[THREE.MeshStandardMaterial, number]> = [
    [floorMaterial, 0xd9c9a3],
    [wallMaterial, 0xf6efe1],
    [whiteboardFaceMaterial, 0xfffbf1],
    [windowGlassMaterial, 0x8fc8de],
    [guitarBodyMaterial, 0xa6692f],
    [keyboardBodyMaterial, 0x2c2115],
    [chairMaterial, 0x6b4a2f],
  ];

  // --- Figures: rebuilt on every applyState() call, same "cheap enough
  // to rebuild rather than pool" choice every other facility's own room
  // makes. ---
  const figuresGroup = new THREE.Group();
  group.add(figuresGroup);
  let activeFigures: WeaselRoomFigureHandle[] = [];

  // Fixed slots, well clear of the guitar corner, the whiteboard, and the
  // keyboard/bench, so figures never visually overlap this small room's
  // furniture. "seated" reuses chairA's own position/facing (one of the
  // room's two real chairs) so a seated figure actually sits IN a chair,
  // the same way otter-room.ts's/rabbit-room.ts's own seated slots match
  // real chair positions; "standing" sits in the open floor area near the
  // room's centre, clear of every other fixture — never a real headcount,
  // purely decorative (ADR 0006: occupancy carries none).
  const SEATED_SLOT = { position: new THREE.Vector3(-0.35, 0, 0.55), facingY: Math.PI / 5 };
  const STANDING_SLOT = { position: new THREE.Vector3(0.1, 0, -0.1), facingY: Math.PI / 4 };

  function clearFigures(): void {
    for (const figure of activeFigures) figuresGroup.remove(figure.group);
    activeFigures = [];
  }

  let currentDesaturate = 0;

  function applyState(occupancy: WeaselRoomOccupancy): void {
    const look = lookForWeaselRoom(occupancy);

    clearFigures();
    look.figures.forEach((pose, index) => {
      const slot = pose === "seated" ? SEATED_SLOT : STANDING_SLOT;
      const figure = buildWeaselRoomFigure(`weasel-room-figure-${index}-${pose}`, pose, slot.position, slot.facingY);
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
    // The heater's own faint, slow warm pulse — restrained ambient detail,
    // never a status signal, same spirit as every other room's own
    // always-on heater glow. Not occupancy-dependent.
    const pulse = 0.2 + 0.08 * Math.sin(elapsedSeconds * 0.8);
    heaterGlowMaterial.emissiveIntensity = pulse * (1 - currentDesaturate * 0.6);

    for (const figure of activeFigures) figure.update(elapsedSeconds);
  }

  return { group, update, applyState };
}
