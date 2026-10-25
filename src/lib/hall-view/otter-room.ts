// Otter Room's 3D diorama. Same cutaway low-poly visual language as
// src/lib/hall-view/room.ts/aa-room.ts (floor planks, open-front walls,
// warm palette pulled from the app's existing CSS custom properties) —
// this is a third room template, not a different visual system. Like AA
// Room, there is exactly one of these (Otter Room has no sub-locations),
// so there's no hall-layout.ts-style placement grid.
//
// Deliberately much simpler than AA Room's own scene: Otter Room is a
// small, quiet study room with one real state to show (occupancy alone —
// see notes/adr/0004-otter-room-live-state.md, Decision 1/3), not a large
// common room with several independently-animated activity zones. Real,
// already-decided furniture (notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md §3):
// one table, a few chairs, a whiteboard, a window, a heater.
import * as THREE from "three";
import type { OtterRoomOccupancy } from "../types.ts";
import { buildOtterRoomFigure, type OtterRoomFigureHandle } from "./otter-room-figures.ts";
import { lookForOtterRoom, type OtterRoomFigurePose } from "./otter-room-status-look.ts";

export interface OtterRoomHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives the heater's faint glow pulse and figure idle sway. Caller skips calling this under reduced motion (see scene.ts), same convention as room.ts/aa-room.ts's update(). */
  update(elapsedSeconds: number): void;
  /** Applies a new canonical Otter Room state's look — rebuilds which figures are present, toggles occupied-only activity props (book/laptop/whiteboard marker strokes), and sets desaturate/dim. Furniture (table, chairs, whiteboard panel, window, heater) is never added/removed here — only figures and activity props are occupancy-dependent. expectedEndAt plays no role here (ADR 0004: it never changes the scene, still just "occupied"). */
  applyState(occupancy: OtterRoomOccupancy): void;
}

// A small study room footprint — noticeably smaller than AA Room's large
// common room (5.4 x 4.0), matching the facility's own real-world scale
// ("approximately six people" vs. AA Room's larger gathering space).
const ROOM_WIDTH = 3.4;
const ROOM_DEPTH = 2.8;

export function buildOtterRoom(): OtterRoomHandle {
  const group = new THREE.Group();
  group.name = "otter-room";

  // Floor + plank lines — identical technique to room.ts/aa-room.ts's.
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a380, roughness: 0.85 });
  for (let i = -2; i <= 2; i++) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, 0.02), plankMaterial);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(0, 0.001, i * 0.5);
    group.add(plank);
  }

  // Walls — same open-front cutaway shape as room.ts/aa-room.ts.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf6efe1, roughness: 0.9 });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, 2.3), wallMaterial);
  backWall.position.set(0, 1.15, -ROOM_DEPTH / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, 2.3), wallMaterial);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_WIDTH / 2, 1.15, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, 2.3), wallMaterial);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_WIDTH / 2, 1.15, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.1, 0.04), trimMaterial);
  trim.position.set(0, 0.05, -ROOM_DEPTH / 2 + 0.02);
  group.add(trim);

  // --- The table, centered — the room's one real piece of furniture
  // everything else is arranged around. ---
  const tableLegMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.7 });
  const tableTopMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6 });
  const tableGroup = new THREE.Group();
  tableGroup.position.set(0, 0, 0.1);
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.75), tableTopMaterial);
  tableTop.position.set(0, 0.46, 0);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  tableGroup.add(tableTop);
  for (const [lx, lz] of [
    [-0.58, -0.3],
    [0.58, -0.3],
    [-0.58, 0.3],
    [0.58, 0.3],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.06), tableLegMaterial);
    leg.position.set(lx, 0.22, lz);
    leg.castShadow = true;
    tableGroup.add(leg);
  }
  // A book and a laptop-shaped block on the table — occupied-only
  // activity props, not permanent set dressing (see applyState() below,
  // which toggles these alongside the whiteboard's marker strokes). A
  // real browser check found the previous version left these visible
  // after a report back to "empty," reading as "someone left in a hurry"
  // rather than "the room is actually clear" — these must track occupancy
  // exactly the way the figures already do.
  const bookMaterial = new THREE.MeshStandardMaterial({ color: 0x3987e5, roughness: 0.7 });
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.22), bookMaterial);
  book.position.set(-0.25, 0.495, 0.05);
  book.castShadow = true;
  tableGroup.add(book);
  const laptopMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.4 });
  const laptop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.18), laptopMaterial);
  laptop.position.set(0.3, 0.485, -0.05);
  laptop.castShadow = true;
  tableGroup.add(laptop);
  group.add(tableGroup);

  // --- Chairs around the table — a few, matching "approximately six
  // people" at most, without needing six real meshes for a room this
  // size to read correctly (chairs are furniture, independent of how
  // many figures end up seated/standing — see applyState()'s own figure
  // count, which is never derived from how many chairs exist here). ---
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.75 });
  const chairPositions: Array<[number, number, number]> = [
    [-0.75, 0, 0.45],
    [0.75, 0, 0.45],
    [0, 0, -0.55],
  ];
  for (const [cx, , cz] of chairPositions) {
    const chairGroup = new THREE.Group();
    chairGroup.position.set(cx, 0, cz);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), chairMaterial);
    seat.position.set(0, 0.26, 0);
    seat.castShadow = true;
    chairGroup.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.05), chairMaterial);
    back.position.set(0, 0.42, cz > 0 ? 0.13 : -0.13);
    back.castShadow = true;
    chairGroup.add(back);
    for (const [lx, lz] of [
      [-0.12, -0.12],
      [0.12, -0.12],
      [-0.12, 0.12],
      [0.12, 0.12],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), chairMaterial);
      leg.position.set(lx, 0.13, lz);
      chairGroup.add(leg);
    }
    group.add(chairGroup);
  }

  // --- Whiteboard, back wall — the room's one named fixture besides the
  // table (FINAL_PROJECT_SOURCE_OF_TRUTH.md §3). The frame/blank face are
  // permanent fixtures; the marker strokes are an occupied-only activity
  // prop (see applyState() below) — a clean board when nobody's using the
  // room, same reasoning as the table's book/laptop. ---
  const whiteboardFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.6 });
  const whiteboardFrame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.66, 0.03), whiteboardFrameMaterial);
  whiteboardFrame.position.set(-0.9, 1.3, -ROOM_DEPTH / 2 + 0.02);
  group.add(whiteboardFrame);
  const whiteboardFaceMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf1, roughness: 0.3 });
  const whiteboardFace = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.58), whiteboardFaceMaterial);
  whiteboardFace.position.set(-0.9, 1.3, -ROOM_DEPTH / 2 + 0.035);
  group.add(whiteboardFace);
  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0x3987e5, roughness: 0.5 });
  const markerStroke1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.01), markerMaterial);
  markerStroke1.position.set(-0.95, 1.42, -ROOM_DEPTH / 2 + 0.04);
  group.add(markerStroke1);
  const markerStroke2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.01), markerMaterial);
  markerStroke2.rotation.z = -0.1;
  markerStroke2.position.set(-1.0, 1.32, -ROOM_DEPTH / 2 + 0.04);
  group.add(markerStroke2);

  // Occupied-only activity props: visible signs someone is actively using
  // the room right now (a book/laptop open on the table, marker strokes
  // on the board) — toggled alongside the figures in applyState() below,
  // never left showing once the room is reported empty (or dimmed away
  // as "unknown"). Furniture itself (table, chairs, whiteboard panel,
  // window, heater) is never in this list — it's always present
  // regardless of occupancy, per the brief.
  const activityProps: THREE.Object3D[] = [book, laptop, markerStroke1, markerStroke2];

  // --- Window, LEFT wall (same wall as the heater — see below). Four real
  // bugs found and fixed by an actual browser screenshot check at every
  // step, not assumed from the code alone:
  //  1. The original version's transparent, near-wall-colored glass pane
  //     blended almost invisibly into the cream wall behind it, leaving
  //     only the thin cross-mullion bars visible — reading as a stray
  //     white mark on the wall, not a window.
  //  2. The next attempt (a solid box "frame" with the glass plane
  //     positioned at a z just inside that box) made it WORSE: the glass
  //     ended up embedded behind the box's own front face, so the box
  //     fully occluded it — one flat dark slab, no hint of blue at all.
  //  3. Switching to an open four-strip border (no box in front of the
  //     opening) plus a self-lit emissive glass fixed the glass's own
  //     color, but a second screenshot (this time of the full room, not
  //     just a close crop) showed the whole window — frame, glass, sill —
  //     floating at an odd angle with no wall behind it at all, unrelated
  //     to the glass material. The actual cause: this room's walls
  //     (room.ts/aa-room.ts's "cutaway dollhouse" technique) rely on
  //     ordinary backface culling to hide the wall nearest the fixed
  //     isometric camera, so the camera can see into the room. At this
  //     room's specific camera angle, computed directly from
  //     ISO_VIEW_DIRECTION (scene.ts) against each wall's own face
  //     normal, it's the RIGHT wall whose normal (pointing into the room,
  //     -X) ends up facing AWAY from the camera and gets culled — the
  //     LEFT wall's normal (+X) faces toward the camera and stays
  //     visible, which is exactly why the heater (mounted on the left
  //     wall, below) was never a problem. The window was mounted on the
  //     right wall — the invisible one. Its frame (built from BoxGeometry,
  //     a closed volume that always shows some face toward the camera
  //     regardless of orientation) stayed visible on its own, but with no
  //     visible wall plane around it to anchor it — exactly the "floating,
  //     wrongly-angled" look a real screenshot caught, since nothing
  //     backing it shared the back wall's own camera-facing orientation.
  // Fixed by mounting the whole window group on the LEFT wall instead —
  // the same wall the heater already sits on, at a different position
  // along it so neither overlaps — flush against a wall that's actually
  // rendered, the same way the whiteboard is flush against the (visible)
  // back wall. The glass keeps `side: THREE.DoubleSide` as a defensive
  // measure (harmless for a pane this small, and guards against this
  // exact failure mode recurring if the geometry/rotation ever changes
  // again), but the wall choice — not the material — is what actually
  // makes this mounted and visible now. ---
  const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5c47, roughness: 0.65 }); // --ink-secondary — clearly darker than the cream wall, not matched to it
  const windowGlassMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fc8de, // a clearly saturated sky blue, not a near-white tint — reads distinctly against the cream wall
    roughness: 0.3,
    emissive: 0x8fc8de,
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide, // defensive — see the bug note above; the real fix is mounting on the visible wall
  });
  const windowSillMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 }); // --warm, matches the baseboard trim elsewhere in this room

  const WINDOW_INNER_WIDTH = 0.72;
  const WINDOW_INNER_HEIGHT = 0.56;
  const WINDOW_BORDER = 0.08;
  const WINDOW_FRAME_DEPTH = 0.05;

  const windowGroup = new THREE.Group();
  // Left wall, same side as the heater (position.set's x matches
  // leftWall's own -ROOM_WIDTH/2, offset slightly toward the room
  // interior) but at z = -0.9 — toward the back-left corner, well clear
  // of the heater's own z = 0.9 toward the front-left — so the two never
  // overlap. rotation.y matches leftWall's own +Math.PI/2 exactly, the
  // same "same rotation as the wall it's mounted on" rule the right-wall
  // attempt also followed correctly; the wall choice was the bug, not
  // this rotation math.
  windowGroup.position.set(-ROOM_WIDTH / 2 + 0.02, 1.35, -0.9);
  windowGroup.rotation.y = Math.PI / 2;

  // Glass sits flush in the opening, at the frame's own mid-depth — there
  // is no mesh in front of it within the opening, unlike the box-frame
  // attempt this replaces.
  const windowGlass = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_INNER_WIDTH, WINDOW_INNER_HEIGHT), windowGlassMaterial);
  windowGroup.add(windowGlass);

  // Four border strips forming an open frame around the glass — a real
  // gap in the middle, not a solid box with the glass hidden inside it.
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

  // Mullion cross bars sit in front of the glass (a clearly positive z,
  // outside the frame strips' own depth range) — thin enough that the
  // glass's own color stays the dominant visual element.
  const windowMullionH = new THREE.Mesh(new THREE.BoxGeometry(WINDOW_INNER_WIDTH, 0.025, 0.015), windowFrameMaterial);
  windowMullionH.position.set(0, 0, 0.02);
  windowGroup.add(windowMullionH);
  const windowMullionV = new THREE.Mesh(new THREE.BoxGeometry(0.025, WINDOW_INNER_HEIGHT, 0.015), windowFrameMaterial);
  windowMullionV.position.set(0, 0, 0.02);
  windowGroup.add(windowMullionV);

  const windowSill = new THREE.Mesh(new THREE.BoxGeometry(outerWidth + 0.08, 0.05, 0.12), windowSillMaterial);
  windowSill.position.set(0, -(outerHeight / 2 + 0.03), 0.06);
  windowSill.castShadow = true;
  windowGroup.add(windowSill);

  group.add(windowGroup);

  // --- Heater, against the left wall — a simple finned radiator block
  // with its own faint warm emissive glow, matching the real room's
  // furniture list. ---
  const heaterBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.45 });
  const heaterGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9822b,
    emissive: 0xd9822b,
    emissiveIntensity: 0.25,
    roughness: 0.5,
  });
  const heaterGroup = new THREE.Group();
  heaterGroup.position.set(-ROOM_WIDTH / 2 + 0.07, 0.3, 0.9);
  const heaterBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.75), heaterBodyMaterial);
  heaterBody.castShadow = true;
  heaterGroup.add(heaterBody);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.46, 0.02), heaterGlowMaterial);
    fin.position.set(0, 0, i * 0.13);
    heaterGroup.add(fin);
  }
  group.add(heaterGroup);

  // Freshness's `dim` is applied as a flat multiplier against each
  // surface's own base color (never touching roughness/other properties)
  // — paired here, once, with the base hex each material actually started
  // from, same technique as aa-room.ts's ROOM_BASE_COLORS.
  const ROOM_BASE_COLORS: Array<[THREE.MeshStandardMaterial, number]> = [
    [floorMaterial, 0xd9c9a3],
    [wallMaterial, 0xf6efe1],
    [tableTopMaterial, 0x8a6a4a],
    [chairMaterial, 0x6b4a2f],
    [whiteboardFaceMaterial, 0xfffbf1],
    [windowGlassMaterial, 0x8fc8de],
  ];

  // --- Figures: rebuilt on every applyState() call, same "cheap enough
  // to rebuild rather than pool" choice aa-room.ts makes, at an even
  // smaller scale (at most two figures here, vs. up to four for AA
  // Room's "event"). ---
  const figuresGroup = new THREE.Group();
  group.add(figuresGroup);
  let activeFigures: OtterRoomFigureHandle[] = [];

  // One seat at the table (matching the back chair's own position) for
  // the "desk" (studying) pose, one clearly open spot away from any chair
  // for a "standing" figure (a second person in a small group, leaning in
  // to look at the table rather than occupying a seat) — see
  // notes/adr/0004-otter-room-live-state.md: occupancy carries no
  // headcount, so this is always the same fixed pair of slots regardless
  // of how many times the room has actually been reported occupied. Kept
  // well clear of chairPositions above so the two figures and the
  // furniture never visually overlap at this room's small scale.
  const FIGURE_SLOTS: Record<OtterRoomFigurePose, THREE.Vector3> = {
    desk: new THREE.Vector3(0, 0, -0.55),
    standing: new THREE.Vector3(-1.05, 0, 0.75),
  };

  function clearFigures(): void {
    for (const figure of activeFigures) figuresGroup.remove(figure.group);
    activeFigures = [];
  }

  let currentDesaturate = 0;

  function applyState(occupancy: OtterRoomOccupancy): void {
    const look = lookForOtterRoom(occupancy);

    clearFigures();
    look.figures.forEach((pose, index) => {
      const position = FIGURE_SLOTS[pose];
      const facingY = pose === "desk" ? 0 : -0.4;
      const figure = buildOtterRoomFigure(`otter-room-figure-${index}-${pose}`, pose, position, facingY);
      figure.setDesaturate(currentDesaturate);
      figuresGroup.add(figure.group);
      activeFigures.push(figure);
    });

    // Activity props (book/laptop/marker strokes) track occupancy exactly
    // like the figures do: visible only while "occupied," hidden for both
    // "empty" (the room is actually clear — no leftover signs of use) and
    // "unknown" (no figures either, same absence-of-information
    // treatment). A real browser check found these needed exactly the
    // same "rebuilt/toggled on every applyState() call" discipline as
    // figures — a one-way reveal with no corresponding hide would leave
    // stale "someone was just here" clutter behind after a report back to
    // empty.
    for (const prop of activityProps) prop.visible = occupancy === "occupied";

    currentDesaturate = look.desaturate;
    for (const figure of activeFigures) figure.setDesaturate(currentDesaturate);

    // Dim: each surface's own base color scaled toward black by `dim` —
    // same technique as aa-room.ts's own dim handling. Never touches
    // stored state — purely a presentation response to occupancy
    // ("unknown" only; empty/occupied are both always full brightness,
    // unlike AA Room, which also dims for "stale").
    for (const [material, baseColor] of ROOM_BASE_COLORS) {
      material.color.setHex(baseColor).multiplyScalar(look.dim);
    }
  }

  function update(elapsedSeconds: number): void {
    for (const figure of activeFigures) figure.update(elapsedSeconds);

    // Heater: a faint, slow warm pulse — restrained ambient detail, never
    // a status signal (the heater's glow has nothing to do with
    // occupancy/freshness; it's just "lived-in" set dressing, the same
    // spirit as room.ts's clock).
    const pulse = 0.2 + 0.08 * Math.sin(elapsedSeconds * 0.8);
    heaterGlowMaterial.emissiveIntensity = pulse * (1 - currentDesaturate * 0.6);

    // Window: a steady "daylight" glow, same desaturation-scaling
    // treatment as the heater's — a muted "unknown" room shouldn't still
    // show a bright, cheerful window.
    windowGlassMaterial.emissiveIntensity = 0.7 * (1 - currentDesaturate * 0.6);
  }

  return { group, update, applyState };
}
