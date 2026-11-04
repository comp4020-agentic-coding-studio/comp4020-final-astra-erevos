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
  // invisible one. Visual pass, 2nd attempt: the 1st attempt stacked three
  // separate squashed spheres (lower bout, waist, upper bout) — a real
  // screenshot showed this reads as a gourd/calabash, not a guitar, because
  // three independently-overlapping blobs leave visible seams instead of
  // one continuous curve, and a dark pickguard disc positioned across
  // those seams poked past the blobs' own uneven silhouette, showing up as
  // an unexplained dark patch near the lower-right of the body. Fixed here
  // by actually drawing the body's outline as a single closed curve — a
  // THREE.Shape traced through the real lower-bout/waist/upper-bout/
  // shoulder profile with bezierCurveTo, then THREE.ExtrudeGeometry gives
  // it real thickness with a beveled edge — one continuous silhouette,
  // no seams, no stray disc. The pickguard is dropped entirely rather
  // than risk a second placement bug on the same spot; sound hole, bridge,
  // fret markers, headstock, tuning pegs, and strings are kept and
  // repositioned against the new shape's own coordinates. Still tilted via
  // a nested group so the lean pivots from the floor contact point, and
  // rotated to face diagonally into the room (matching the camera's own
  // 45-degree azimuth) so its body profile, not its edge, is what the
  // camera actually sees. ---
  const guitarBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xa6692f, roughness: 0.55 });
  const guitarAccentMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.6 });
  const guitarBridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.55 });
  const guitarFretMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.4 });
  const guitarStringMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.25, metalness: 0.4 });
  const guitarPegMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.5, metalness: 0.3 });

  const guitarFacing = new THREE.Group(); // rotation.y: which way the guitar's flat face points
  const guitarLean = new THREE.Group(); // rotation.x: the backward lean against the corner, pivoting at the floor
  guitarFacing.add(guitarLean);

  // Body outline, traced as one closed curve (half the profile drawn
  // explicitly, mirrored for the other half) rather than stacked
  // primitives: bottom tip -> lower bout (widest) -> waist (narrowest,
  // pinched in) -> upper bout (wide again, but less than the lower bout,
  // per a real acoustic's own proportions) -> shoulder (narrows to meet
  // the neck). Drawn in the local XY plane; ExtrudeGeometry then gives it
  // real depth along Z, which is the same "front face holds the sound
  // hole/bridge" axis every accessory below already assumes.
  const guitarShape = new THREE.Shape();
  guitarShape.moveTo(0, 0.02);
  guitarShape.bezierCurveTo(0.1, 0.02, 0.165, 0.08, 0.165, 0.17); // bottom -> lower bout widest (right)
  guitarShape.bezierCurveTo(0.165, 0.25, 0.11, 0.27, 0.095, 0.33); // lower bout -> waist (right)
  guitarShape.bezierCurveTo(0.08, 0.38, 0.125, 0.4, 0.125, 0.46); // waist -> upper bout widest (right)
  guitarShape.bezierCurveTo(0.125, 0.51, 0.08, 0.54, 0.045, 0.56); // upper bout -> shoulder (right)
  guitarShape.quadraticCurveTo(0, 0.575, -0.045, 0.56); // across the top, shoulder to shoulder
  guitarShape.bezierCurveTo(-0.08, 0.54, -0.125, 0.51, -0.125, 0.46); // shoulder -> upper bout widest (left)
  guitarShape.bezierCurveTo(-0.125, 0.4, -0.08, 0.38, -0.095, 0.33); // upper bout -> waist (left)
  guitarShape.bezierCurveTo(-0.11, 0.27, -0.165, 0.25, -0.165, 0.17); // waist -> lower bout widest (left)
  guitarShape.bezierCurveTo(-0.165, 0.08, -0.1, 0.02, 0, 0.02); // lower bout widest -> bottom, closing the path

  const GUITAR_BODY_DEPTH = 0.09;
  const guitarBodyGeometry = new THREE.ExtrudeGeometry(guitarShape, {
    depth: GUITAR_BODY_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 10,
  });
  // Centers the extrusion on local z=0, matching the neck/headstock below
  // (plain boxes, already centered on z=0) so the whole instrument shares
  // one consistent front-back axis.
  guitarBodyGeometry.translate(0, 0, -GUITAR_BODY_DEPTH / 2);
  const guitarBody = new THREE.Mesh(guitarBodyGeometry, guitarBodyMaterial);
  guitarBody.castShadow = true;
  guitarLean.add(guitarBody);

  // Front-face accessories sit just proud of the body's own ACTUAL flat
  // front face. A 1st attempt placed these at DEPTH/2 + 0.006 — correct
  // only if the extrusion's front cap sat exactly at z = DEPTH/2, which it
  // doesn't once bevelEnabled adds its own outward offset: the real cap
  // sits at DEPTH/2 + bevelThickness, confirmed directly by sampling the
  // actual post-build vertex positions, not assumed from the construction
  // parameters. The 1st attempt's face-z (0.051) sat 0.006 BEHIND the
  // true surface (0.057) — the sound hole, a flat disc with no volume of
  // its own, was entirely buried inside the mesh and never visible at
  // all; the bridge and strings (boxes/cylinders with real volume) still
  // partly poked through, which is why only the sound hole silently
  // disappeared. Face-z is now measured from the actual bevel offset.
  const GUITAR_FACE_Z = GUITAR_BODY_DEPTH / 2 + 0.012 + 0.006;

  // Sound hole and bridge, repositioned: a 1st attempt placed the hole at
  // y=0.27 (down near the lower bout's own widest point, per the body
  // profile's own half-width table) and the bridge even lower at y=0.21 —
  // both read as sitting in the bottom third of the body, well below
  // where a real acoustic's sound hole actually sits (between the waist
  // and the upper bout, roughly centered on the body's own upper half).
  // The hole now sits at y=0.4 (between the waist's own y=0.33-0.35 pinch
  // and the upper bout's own y=0.46 widest point), with the bridge at
  // y=0.3 (just below the hole, near the waist, matching a real
  // acoustic's own string-anchor position relative to its sound hole).
  const guitarSoundHole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 14), guitarAccentMaterial);
  guitarSoundHole.position.set(0, 0.4, GUITAR_FACE_Z);
  guitarLean.add(guitarSoundHole);

  // Bridge — a raised wooden strip just below the sound hole, where the
  // strings actually anchor on a real acoustic, not left implied.
  const guitarBridgeY = 0.3;
  const guitarBridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), guitarBridgeMaterial);
  guitarBridge.position.set(0, guitarBridgeY, GUITAR_FACE_Z);
  guitarLean.add(guitarBridge);

  const guitarNeck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.52, 0.035), guitarAccentMaterial);
  guitarNeck.position.set(0, 0.78, 0);
  guitarNeck.castShadow = true;
  guitarLean.add(guitarNeck);

  // Fret-position markers — small inlay dots at a few real positions along
  // the neck (not every fret, just enough to read as "a fretboard," the
  // same restrained-detail spirit every other facility's own furniture
  // keeps), so the neck isn't a single flat, featureless rod.
  for (const y of [0.6, 0.72, 0.9]) {
    const marker = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), guitarFretMaterial);
    marker.position.set(0, y, 0.021);
    guitarLean.add(marker);
  }

  const guitarHeadstock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), guitarAccentMaterial);
  guitarHeadstock.position.set(0, 1.08, 0);
  guitarHeadstock.castShadow = true;
  guitarLean.add(guitarHeadstock);

  // Tuning pegs — three small cylinders per side at the headstock's
  // edges, reading as real hardware rather than a plain block.
  for (const side of [-1, 1] as const) {
    for (const yOffset of [-0.035, 0, 0.035]) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), guitarPegMaterial);
      peg.rotation.z = Math.PI / 2;
      peg.position.set(side * 0.058, 1.08 + yOffset, 0);
      guitarLean.add(peg);
    }
  }

  // Strings — six thin cylinders running from the bridge up to near the
  // nut, the one detail that most reads as "a guitar, not an empty body"
  // from the camera's own fixed angle.
  const guitarStringTopY = 1.05;
  const guitarStringLength = guitarStringTopY - guitarBridgeY;
  for (let i = 0; i < 6; i++) {
    const stringX = -0.045 + i * 0.018;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, guitarStringLength, 4), guitarStringMaterial);
    string.position.set(stringX, guitarBridgeY + guitarStringLength / 2, GUITAR_FACE_Z);
    guitarLean.add(string);
  }

  guitarLean.rotation.x = -0.16; // leans back into the corner, pivoting at the floor
  guitarFacing.rotation.y = Math.PI / 4; // faces diagonally into the room, matching the camera's own azimuth
  guitarFacing.position.set(-1.22, 0, -1.22); // the back-left corner — both adjoining walls are visible here
  group.add(guitarFacing);

  // --- Electric piano + bench, EAST side — floor-standing furniture near
  // the culled right wall (see the file's own top note on why this
  // fixture, not the whiteboard, goes here). Visual pass, 2nd attempt: the
  // given fact is specifically a floor-standing, mains-powered stage
  // electric piano shaped like "an ordinary electric keyboard with the
  // lower half of a real piano underneath it" — a solid cabinet from the
  // floor up to the keybed, not legs/a stand of any kind (the 1st attempt
  // built an X-frame stand, which is still "thin legs," just crossed ones,
  // and missed the point). Built here as one continuous solid body: a
  // real piano's own tapering cabinet silhouette (narrower at the floor,
  // flaring out slightly to support the keybed, like a real upright
  // piano's lower case) extruded from a 2D profile the same way the
  // guitar's body now is, with a visible black/white key strip on top
  // (individual key divisions, not a flat painted strip), a small raised
  // control panel with a few decorative knobs (fixed geometry only — no
  // lit/unlit state, per ADR 0006's own "no instrument-appliance status"
  // rule: these read as "a real control panel exists," never as a
  // power/on-off indicator), and NO exposed stand/legs/pedal — the given
  // fact is explicit that there's no large open space underneath the way
  // a real acoustic piano has, so the cabinet goes solid to the floor
  // instead. ---
  const keyboardBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.35 });
  const keyboardWhiteKeyMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf1, roughness: 0.3 });
  const keyboardBlackKeyMaterial = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.3 });
  const keyboardPanelMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.4 });
  const keyboardKnobMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.4, metalness: 0.2 });

  const KEYBOARD_X = ROOM_WIDTH / 2 - 0.37; // just inside the east wall's own position
  // A real stage piano's own playing height — lowered from an initial
  // 0.76 (closer to a tabletop keyboard propped high) after a real
  // screenshot showed the key strip sitting noticeably above where a
  // seated player's hands would actually reach relative to the bench's
  // own 0.42 seat height. 0.68 keeps the keybed clearly above the bench
  // (same margin every room's own desk/chair pairs use) without reading
  // as elevated furniture.
  const KEYBOARD_KEYBED_Y = 0.68;

  const keyboardGroup = new THREE.Group();
  keyboardGroup.position.set(KEYBOARD_X, 0, 0);

  // Cabinet: one continuous extruded solid from the floor up to the
  // keybed — a real piano's own lower-case silhouette (CABINET_BASE_DEPTH
  // wide at the floor, narrowing slightly partway up like a real cabinet's
  // waist, then widening again to CABINET_TOP_DEPTH to support the
  // keybed's own overhang), traced in the local XZ plane (X = front-back
  // depth, Z = left-right length along the room's own north-south axis)
  // and extruded upward (+Y) — the same "trace the real outline, extrude
  // for thickness" fix the guitar's body above now uses, so this also
  // reads as one solid piece, not a deck on separate legs.
  const CABINET_LENGTH = 1.1; // matches the previous keyboard body's own east-west footprint
  const CABINET_BASE_DEPTH = 0.42; // front-to-back footprint at the floor
  const CABINET_WAIST_DEPTH = 0.34; // narrower midsection, like a real cabinet's own waist
  const CABINET_TOP_DEPTH = 0.46; // widens again just under the keybed, to support its own overhang

  const cabinetShape = new THREE.Shape();
  cabinetShape.moveTo(0, 0); // front-bottom
  cabinetShape.lineTo(0, KEYBOARD_KEYBED_Y * 0.55);
  cabinetShape.quadraticCurveTo(0, KEYBOARD_KEYBED_Y * 0.7, CABINET_BASE_DEPTH - CABINET_WAIST_DEPTH, KEYBOARD_KEYBED_Y * 0.78); // front face curves in toward the waist
  cabinetShape.lineTo(CABINET_BASE_DEPTH - CABINET_WAIST_DEPTH, KEYBOARD_KEYBED_Y * 0.9);
  cabinetShape.quadraticCurveTo(CABINET_BASE_DEPTH - CABINET_WAIST_DEPTH, KEYBOARD_KEYBED_Y, CABINET_BASE_DEPTH - CABINET_TOP_DEPTH, KEYBOARD_KEYBED_Y); // waist flares back out to meet the keybed
  cabinetShape.lineTo(CABINET_BASE_DEPTH, KEYBOARD_KEYBED_Y); // top, back to the full depth
  cabinetShape.lineTo(CABINET_BASE_DEPTH, 0); // back face, straight down to the floor
  cabinetShape.lineTo(0, 0); // close along the floor

  const cabinetGeometry = new THREE.ExtrudeGeometry(cabinetShape, {
    depth: CABINET_LENGTH,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 8,
  });
  // The shape was already traced with its own local X as the room's
  // front-back depth and its own local Y as the room's vertical axis —
  // ExtrudeGeometry's default extrusion along its own local Z already
  // lines up with the room's own north-south (Z) axis without any
  // rotation. A first attempt added a rotateX(-PI/2) here on the mistaken
  // assumption the shape needed re-orienting; numerically checking the
  // actual post-transform vertex extents caught that this rotation
  // instead swapped the cabinet's height and length — the shape rendered
  // as a too-tall, narrow-footprint block, with the real tapered profile
  // rotated onto a face the fixed camera never sees. No rotation is
  // applied; only the centering translate below is needed.
  cabinetGeometry.translate(-CABINET_BASE_DEPTH / 2, 0, -CABINET_LENGTH / 2);
  const keyboardCabinet = new THREE.Mesh(cabinetGeometry, keyboardBodyMaterial);
  keyboardCabinet.castShadow = true;
  keyboardGroup.add(keyboardCabinet);

  // Rear housing — a raised lip running the full length of the cabinet's
  // own back edge, the real piece a 1st attempt was missing: that attempt
  // left the keys sitting on an otherwise completely flat, open top
  // surface, with nothing behind them but bare cabinet-top — reading as
  // keys laid on an open platform rather than built into an instrument
  // with a real case around them. A real stage piano's own back edge
  // always has a raised housing (holding its own internals/speakers)
  // framing the keybed from behind; built here as one long box the same
  // material as the cabinet, sized to the cabinet's own top depth so it
  // reads as a continuation of the same case, not a bolted-on add-on.
  // CABINET_TOP_DEPTH (0.46) is deliberately larger than CABINET_BASE_DEPTH
  // (0.42) — the whole point of the waist-then-flare profile above is
  // that the top overhangs the floor footprint slightly. That means the
  // top's own FRONT edge (the playing side) sits at the MORE NEGATIVE x,
  // past the floor's own front edge at x=0 — confirmed directly by
  // sampling the built geometry's actual top-surface vertex x-range
  // ([-0.25, 0.21]) rather than assumed from the construction formula. A
  // 1st attempt swapped these two labels, which silently put the "rear"
  // housing at the playing edge and the keys hanging past the real back
  // edge into empty space — caught here before building, not after a
  // second wrong screenshot.
  const KEYBOARD_TOP_FRONT_X = CABINET_BASE_DEPTH - CABINET_TOP_DEPTH - CABINET_BASE_DEPTH / 2; // top's own front (playing-side) edge — the more negative x
  const KEYBOARD_TOP_BACK_X = CABINET_BASE_DEPTH / 2; // top's own back edge — the more positive x
  const REAR_HOUSING_DEPTH = 0.1;
  // Tall enough to sit clearly above the key tops (white + black key
  // heights below, increased for the same reason), per the given fact
  // that a real stage piano's own hinged lid rests closed across the
  // keybed and needs the rear housing to stand taller than that lid so
  // it doesn't tip forward — a 1st attempt's 0.07 numerically cleared the
  // key tops but by too thin a margin to read as a real step from this
  // camera's own isometric angle; raised here so the housing visibly
  // rises above, and slightly in front of, the key strip's own back
  // edge.
  const REAR_HOUSING_HEIGHT = 0.17;
  const rearHousing = new THREE.Mesh(
    new THREE.BoxGeometry(REAR_HOUSING_DEPTH, REAR_HOUSING_HEIGHT, CABINET_LENGTH - 0.02),
    keyboardBodyMaterial,
  );
  rearHousing.position.set(KEYBOARD_TOP_BACK_X - REAR_HOUSING_DEPTH / 2, KEYBOARD_KEYBED_Y + REAR_HOUSING_HEIGHT / 2, 0);
  rearHousing.castShadow = true;
  keyboardGroup.add(rearHousing);

  // Key strip — individual white keys (thin boxes with real gaps, not one
  // painted strip) along the west-facing edge (the front of the cabinet,
  // the side actually played from), with black keys inset slightly above
  // and between them, the same alternating pattern a real 88-key layout
  // reads as even in low-poly. Sized to fill the real gap between the
  // cabinet's own front edge and the new rear housing, rather than a
  // fixed width chosen independently of either.
  const WHITE_KEY_COUNT = 18;
  const WHITE_KEY_WIDTH = (CABINET_LENGTH - 0.02) / WHITE_KEY_COUNT;
  const KEY_STRIP_FRONT_X = KEYBOARD_TOP_FRONT_X + 0.03; // a small lip of cabinet-top visible in front of the keys, like a real instrument's own
  const KEY_DEPTH = KEYBOARD_TOP_BACK_X - KEY_STRIP_FRONT_X - 0.015; // stop short of the rear housing, not overlapping it
  const KEY_STRIP_X = KEY_STRIP_FRONT_X + KEY_DEPTH / 2;
  // Key height (Y, vertical thickness): a 1st attempt used 0.012, thin
  // enough that at this camera's own fixed isometric angle the keys read
  // as a flat painted pattern rather than real raised keys with a
  // visible top face and side. Thickened here to a real, visible slab.
  const WHITE_KEY_HEIGHT = 0.045;
  for (let i = 0; i < WHITE_KEY_COUNT; i++) {
    const key = new THREE.Mesh(new THREE.BoxGeometry(KEY_DEPTH, WHITE_KEY_HEIGHT, WHITE_KEY_WIDTH * 0.92), keyboardWhiteKeyMaterial);
    key.position.set(KEY_STRIP_X, KEYBOARD_KEYBED_Y + WHITE_KEY_HEIGHT / 2, -CABINET_LENGTH / 2 + 0.01 + WHITE_KEY_WIDTH * (i + 0.5));
    keyboardGroup.add(key);
  }
  // Black keys skip the usual two-per-octave gap (after the 3rd and 7th
  // white key in each group of 7) — decorative, not a real-instrument
  // layout requirement, but enough to read as "black and white keys,"
  // not a flat monotone strip. Sit toward the back half of the white
  // keys' own depth, the same real-instrument proportion (black keys
  // reach only partway down a white key, not its full length).
  const BLACK_KEY_HEIGHT = 0.02; // on top of, not instead of, the white keys' own thickness
  for (let i = 0; i < WHITE_KEY_COUNT - 1; i++) {
    if (i % 7 === 2 || i % 7 === 6) continue;
    const key = new THREE.Mesh(new THREE.BoxGeometry(KEY_DEPTH * 0.6, BLACK_KEY_HEIGHT, WHITE_KEY_WIDTH * 0.5), keyboardBlackKeyMaterial);
    key.position.set(KEY_STRIP_X + KEY_DEPTH * 0.18, KEYBOARD_KEYBED_Y + WHITE_KEY_HEIGHT + BLACK_KEY_HEIGHT / 2, -CABINET_LENGTH / 2 + 0.01 + WHITE_KEY_WIDTH * (i + 1));
    keyboardGroup.add(key);
  }

  // Control panel — a few decorative knobs set into the rear housing's
  // own top face (fixed geometry only, never lit — see the file's own
  // top note on why this doesn't cross into instrument-appliance
  // status), at the housing's own north end.
  const KEYBOARD_REAR_HOUSING_CENTER_X = KEYBOARD_TOP_BACK_X - REAR_HOUSING_DEPTH / 2;
  const keyboardPanel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.18), keyboardPanelMaterial);
  keyboardPanel.position.set(KEYBOARD_REAR_HOUSING_CENTER_X, KEYBOARD_KEYBED_Y + REAR_HOUSING_HEIGHT + 0.006, -CABINET_LENGTH / 2 + 0.1);
  keyboardGroup.add(keyboardPanel);
  for (const kz of [-0.52, -0.47, -0.42] as const) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), keyboardKnobMaterial);
    knob.position.set(KEYBOARD_REAR_HOUSING_CENTER_X, KEYBOARD_KEYBED_Y + REAR_HOUSING_HEIGHT + 0.016, kz);
    keyboardGroup.add(knob);
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

  // --- Door threshold, SOUTH-WEST corner — the open front already *is*
  // the doorway for every room in this app (see the file's own top note
  // on the south/open-front mapping), so this is a floor marking, not a
  // wall opening: a contrasting threshold strip plus two short jamb
  // posts, same construction as rat-room.ts's and badger-room.ts's own
  // door threshold. Offset toward the west (DOOR_X following Rat Room's
  // own -ROOM_WIDTH/2 + 0.9 formula, scaled to this room's own smaller
  // 3x3 footprint), with real clearance checked numerically, not by eye,
  // against the heater already occupying this same south-west area: the
  // heater's own Z extent (0.75 to 1.35) sits well short of the
  // threshold's own Z position (1.4), and the heater's own X extent
  // (-1.48 to -1.38) sits 0.28 clear of the threshold's own west edge
  // (-1.1) — no overlap with the heater or with either chair. ---
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
  // color (never touching roughness/other properties) — paired here, once,
  // with the base hex each material actually started from, same technique
  // every other facility's own ROOM_BASE_COLORS uses.
  const ROOM_BASE_COLORS: Array<[THREE.MeshStandardMaterial, number]> = [
    [floorMaterial, 0xd9c9a3],
    [wallMaterial, 0xf6efe1],
    [whiteboardFaceMaterial, 0xfffbf1],
    [windowGlassMaterial, 0x8fc8de],
    [guitarBodyMaterial, 0xa6692f],
    [guitarFretMaterial, 0xd9c9a3],
    [guitarStringMaterial, 0xc9c2b0],
    [guitarPegMaterial, 0xc1652f],
    [keyboardBodyMaterial, 0x1c1512],
    [keyboardWhiteKeyMaterial, 0xfffbf1],
    [keyboardPanelMaterial, 0x3d2414],
    [keyboardKnobMaterial, 0x6b5c47],
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
