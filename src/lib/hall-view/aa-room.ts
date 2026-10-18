// Stage 4 — AA Room's 3D diorama. Same cutaway low-poly visual language
// as src/lib/hall-view/room.ts (floor planks, open-front walls, warm
// palette pulled from the app's existing CSS custom properties) — this
// is a second room template, not a different visual system. Unlike
// room.ts, there is exactly one of these (AA Room has no sub-locations),
// so there's no hall-layout.ts-style placement grid: one buildAaRoom()
// call, framed the same way Laundry's overview is (see scene.ts).
//
// Three named zones, matching the facility's real, already-decided
// furniture (notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md §3): sofas + TV
// against the back-left, pool table centered, table tennis to the
// right, bookshelf against the back wall. No per-zone camera — the
// brief is explicit that this room gets one fixed overview, never an
// activity-specific shot (see notes on why: that would need
// re-deriving camera-fit.ts-style framing per activity and works
// against the "fixed diorama, not a navigable game" identity the whole
// Hall View has kept).
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

const ROOM_WIDTH = 5.4;
const ROOM_DEPTH = 4.0;

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

  // Walls — same open-front cutaway shape as room.ts.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf6efe1, roughness: 0.9 });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, 2.4), wallMaterial);
  backWall.position.set(0, 1.2, -ROOM_DEPTH / 2);
  backWall.receiveShadow = true;
  group.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, 2.4), wallMaterial);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_WIDTH / 2, 1.2, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, 2.4), wallMaterial);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_WIDTH / 2, 1.2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(ROOM_WIDTH, 0.1, 0.04), trimMaterial);
  trim.position.set(0, 0.05, -ROOM_DEPTH / 2 + 0.02);
  group.add(trim);

  // --- Zone 1: sofas + TV, back-left ---
  const sofaMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.75 });
  const sofaGroup = new THREE.Group();
  sofaGroup.position.set(-1.7, 0, -1.0);
  const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.32, 0.55), sofaMaterial);
  sofaBase.position.set(0, 0.16, 0);
  sofaBase.castShadow = true;
  sofaBase.receiveShadow = true;
  sofaGroup.add(sofaBase);
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.14), sofaMaterial);
  sofaBack.position.set(0, 0.42, -0.2);
  sofaBack.castShadow = true;
  sofaGroup.add(sofaBack);
  group.add(sofaGroup);

  // TV: a thin dark panel on the back wall + a stand, with its own
  // emissive screen material so aa-room-status-look.ts's tvOn flicker
  // (same technique as a machine's unknown-status LED flicker in
  // machine-mesh.ts) only needs to drive emissiveIntensity, not swap
  // materials.
  const tvStandMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.6 });
  const tvStand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), tvStandMaterial);
  tvStand.position.set(-1.7, 0.6, -1.85);
  tvStand.castShadow = true;
  group.add(tvStand);
  const tvScreenMaterial = new THREE.MeshStandardMaterial({
    color: 0x14110d,
    emissive: 0x3987e5,
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.5), tvScreenMaterial);
  tvScreen.position.set(-1.7, 1.15, -1.97);
  group.add(tvScreen);

  // --- Zone 2: pool table, centered ---
  const poolLegMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3312, roughness: 0.7 });
  const poolFeltMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6b4a, roughness: 0.85 });
  const poolTableGroup = new THREE.Group();
  poolTableGroup.position.set(0, 0, 0.3);
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
  group.add(poolTableGroup);

  // --- Zone 3: table tennis, right side ---
  const pingPongGroup = new THREE.Group();
  pingPongGroup.position.set(1.8, 0, 0.6);
  const pingPongTableMaterial = new THREE.MeshStandardMaterial({ color: 0x1f5c8a, roughness: 0.5 });
  const pingPongTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.7), pingPongTableMaterial);
  pingPongTop.position.set(0, 0.4, 0);
  pingPongTop.castShadow = true;
  pingPongTop.receiveShadow = true;
  pingPongGroup.add(pingPongTop);
  const netMaterial = new THREE.MeshStandardMaterial({ color: 0xf6ecd9, roughness: 0.9, transparent: true, opacity: 0.85 });
  const net = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.1), netMaterial);
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
  pingPongGroup.add(pingPongBall);
  group.add(pingPongGroup);

  // --- Bookshelf, back wall (opposite the TV side, like room.ts's clock placement) ---
  const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8 });
  const shelfGroup = new THREE.Group();
  shelfGroup.position.set(2.1, 0, -1.8);
  const shelfBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.26), shelfMaterial);
  shelfBody.position.set(0, 0.7, 0);
  shelfBody.castShadow = true;
  shelfBody.receiveShadow = true;
  shelfGroup.add(shelfBody);
  const bookColors = [0xd03b3b, 0x3987e5, 0x5aae68, 0xd9822b, 0x8a6a4a];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.035 + (i % 3) * 0.01, 0.28, 0.16),
        new THREE.MeshStandardMaterial({ color: bookColors[i % bookColors.length], roughness: 0.7 }),
      );
      book.position.set(-0.36 + i * 0.14, 0.3 + row * 0.42, 0);
      book.castShadow = true;
      shelfGroup.add(book);
    }
  }
  group.add(shelfGroup);

  // Freshness's `dim` is applied as a flat multiplier against each
  // surface's own base color (never touching roughness/other properties)
  // — paired here, once, with the base hex each material actually started
  // from, so re-dimming from a fresh state doesn't compound against an
  // already-dimmed color.
  const ROOM_BASE_COLORS: Array<[THREE.MeshStandardMaterial, number]> = [
    [floorMaterial, 0xd9c9a3],
    [wallMaterial, 0xf6efe1],
    [sofaMaterial, 0x8a6a4a],
    [poolFeltMaterial, 0x2f6b4a],
    [shelfMaterial, 0x6b4a2f],
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
  const FIGURE_SLOTS: Partial<Record<FigurePose, THREE.Vector3[]>> = {
    tv: [new THREE.Vector3(-2.0, 0, -0.75), new THREE.Vector3(-1.4, 0, -0.75)],
    hangout: [new THREE.Vector3(1.0, 0, -1.6), new THREE.Vector3(0.55, 0, -1.9)],
    pool: [new THREE.Vector3(-0.9, 0, 0.3), new THREE.Vector3(0.9, 0, 0.5)],
    "table-tennis": [new THREE.Vector3(1.8, 0, -0.1), new THREE.Vector3(1.8, 0, 1.3)],
    standing: [new THREE.Vector3(0.2, 0, -1.2), new THREE.Vector3(-0.3, 0, 1.6)],
  };

  // Event's own independent, whole-room figure layout (per the design
  // brief: event is busier and more dispersed, not just "occupied's sofa
  // pose repeated") — spread across the room rather than concentrated in
  // any one zone's normal slots, since a formal event genuinely occupies
  // the whole room, not one activity's corner of it.
  const EVENT_SLOTS: THREE.Vector3[] = [
    new THREE.Vector3(-1.7, 0, -0.9),
    new THREE.Vector3(-0.2, 0, 1.2),
    new THREE.Vector3(1.0, 0, -1.5),
    new THREE.Vector3(0.6, 0, 0.9),
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
      const facingY = isEvent
        ? 0
        : pose === "tv" || pose === "hangout"
          ? 0.3
          : pose === "pool" || pose === "table-tennis"
            ? Math.PI / 2
            : 0;
      const figure = buildFigure(`aa-room-figure-${index}-${pose}`, pose, position, facingY);
      figure.setDesaturate(currentDesaturate);
      figuresGroup.add(figure.group);
      activeFigures.push(figure);
    });

    group.userData.tvOn = look.tvOn;
    group.userData.poolActive = look.poolActive;
    group.userData.tableTennisActive = look.tableTennisActive;
    currentDesaturate = look.desaturate;
    for (const figure of activeFigures) figure.setDesaturate(currentDesaturate);

    // Dim: each surface's own base color scaled toward black by `dim` —
    // applied directly to materials rather than via scene lighting, so
    // it stays local to this room's own meshes regardless of how
    // lighting is shared with whatever facility mounts next (see
    // scene.ts's single-renderer design). Never touches stored state —
    // purely a presentation response to freshness, exactly like
    // status-look.ts's own `desaturate` field on machines.
    for (const [material, baseColor] of ROOM_BASE_COLORS) {
      material.color.setHex(baseColor).multiplyScalar(look.dim);
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
  }

  return { group, update, applyState };
}
