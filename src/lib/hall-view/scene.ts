// Stage 1: the A/B room, fixed camera, real-time initial state.
// Stage 2: hover/click interaction on those same two machines — a cyan
// selection outline + ground glow + mini info card on hover, a camera
// dolly-in + fuller HUD detail panel on click.
//
// Stage 2.2 — both the overview camera and the per-machine focus camera
// (interaction.ts) are now computed by camera-fit.ts's fitBoundsToRect()
// from the room's real world-space bounds, not a hand-tuned
// frustumHalfHeight constant verified by screenshotting one viewport.
//
// Stage 2.3 — wired into the dashboard's existing canonical update path.
// index.astro's dashboard script and this module's own mount script are
// two SEPARATE inline <script type="module"> blocks — Astro compiles
// each into its own module (confirmed: they each get a distinct
// ?astro&type=script&index=N URL) — but both import this same file, and
// ES modules are singletons keyed by URL, so both scripts end up
// sharing the exact same module instance of everything below, including
// the mountedScenes registry. That's what lets index.astro's
// applyMachineUpdate() call this module's applyMachineToScene() directly
// — no second EventSource, no second state model, no window-global
// bridge: just one more function imported from the one scene module,
// same as mount() already was.
//
// Stage 3 — all five real locations (A/B, C, E, F, G; see
// hall-layout.ts), each its own buildRoom() instance placed at a fixed
// world offset. Every per-machine mechanism below (hover, focus, HUD,
// hitbox, animation, live-state sync) is the exact same code path the
// single A/B room already used — this stage only changes *how many*
// rooms/machines are built and placed, never how any one of them
// behaves. The overview camera fit already took "the room" as a list of
// objects (boundsCorners([room.group])), so fitting all five rooms'
// combined bounds instead needed no change to camera-fit.ts itself.
import * as THREE from "three";
import type { Location, Machine, MachineType } from "../types.ts";
import { buildRoom } from "./room.ts";
import { ROOM_PLACEMENTS } from "./hall-layout.ts";
import { buildRoomLabel } from "./room-label.ts";
import { buildMachineMesh, type MachineMeshHandle } from "./machine-mesh.ts";
import { createInteraction, type InteractionTarget } from "./interaction.ts";
import { createOverlay } from "./overlay.ts";
import { boundsCorners, fitBoundsToRect } from "./camera-fit.ts";

export interface HallViewHandle {
  /** Stops the render loop and frees GPU resources — call on page teardown if ever needed. */
  dispose(): void;
}

// Stage 2.3 — every mounted hall-view scene registers itself here so
// applyMachineToScene() can reach it. In practice there is exactly one
// (the A/B room), but this is a list, not a single nullable reference,
// so Stage 3 (more rooms, each its own mount() call) needs no change
// here at all — a machine update just gets routed to whichever mounted
// scene actually has that machine id, the same way it already gets
// routed to whichever dashboard card has it.
interface MountedScene {
  applyMachineUpdate(machine: Machine): void;
}
const mountedScenes = new Set<MountedScene>();

/**
 * The one function index.astro's dashboard script calls from inside its
 * own existing applyMachineUpdate() — the single canonical update path
 * (SSE push, 409-conflict canonical state, and reconnect re-fetch all
 * already funnel through that one function). This is the 3D view's only
 * subscriber to that path: it owns no second EventSource, no second
 * fetch, no second reconnect/backoff logic, and cannot disagree with the
 * dashboard about a machine's state, since both are painting the exact
 * same event.
 */
export function applyMachineToScene(machine: Machine): void {
  for (const scene of mountedScenes) scene.applyMachineUpdate(machine);
}

// True isometric angle (not an arbitrary tilt): atan(1/sqrt(2)) elevation.
const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2));
const ISO_AZIMUTH = Math.PI / 4;
const ISO_VIEW_DIRECTION = new THREE.Vector3(
  Math.cos(ISO_ELEVATION) * Math.cos(ISO_AZIMUTH),
  Math.sin(ISO_ELEVATION),
  Math.cos(ISO_ELEVATION) * Math.sin(ISO_AZIMUTH),
).normalize();
const CAMERA_DISTANCE = 10; // arbitrary — orthographic apparent size depends only on frustumHalfHeight/zoom, not distance

// Stage 2.2 — the overview's target NDC rectangle: a small, even margin
// on every side (symmetric, unlike the focus shot's reserved-top
// rectangle) so the room — floor, both walls, every prop, both
// machines — fills the frame as fully as possible while leaving a
// uniform breathing margin. 0.9 means the room's tightest-fitting axis
// reaches 90% of the way to the frame edge; confirmed by the same
// project-the-real-corners-back verification camera-fit.ts's own
// correctness was checked with, not chosen by eye.
const OVERVIEW_FILL = 0.9;

// Stage 6 — the workbench-layout page wants the right-hand information
// panel to highlight and scroll to whichever machine's 3D model is
// currently focused. Rather than have index.astro reach into this
// module's internals, mount() takes an optional callback invoked with
// the focused machine's id (or null on return-to-overview) — the same
// "outward notification" shape applyMachineToScene() already uses for
// the opposite direction (dashboard -> scene). This is purely additive:
// it only ever READS the existing focus state out to the caller, it
// never changes what hover/focus/HUD/camera framing actually do.
export function mount(
  container: HTMLElement,
  machines: Machine[],
  onFocusChange?: (machineId: string | null) => void,
): HallViewHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6efe1); // --page

  // Fixed orthographic camera. No OrbitControls, no PointerLockControls,
  // nothing attached that could pan/zoom/rotate — there is deliberately
  // no code path for camera movement to grow into. This is the single
  // most important decision keeping this a diorama, not a navigable
  // world: see the Stage 1 design discussion. frustumHalfHeight/position
  // are placeholders here — set for real a few lines down, once the
  // room exists and its bounds can be measured.
  let aspect = container.clientWidth / Math.max(container.clientHeight, 1);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Lighting: one warm directional light (the shadow-casting key light,
  // angled to roughly match the camera's isometric direction so faces
  // read with real shading variation) plus one soft hemisphere light so
  // shadow-side faces aren't pure black. See the Stage 1 lighting notes.
  const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.2);
  keyLight.position.set(4, 6, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 4;
  keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 15;
  keyLight.shadow.bias = -0.002;
  scene.add(keyLight);

  const hemiLight = new THREE.HemisphereLight(0xfdf6e6, 0x8a6a4a, 0.6);
  scene.add(hemiLight);

  // Stage 3 — one buildRoom() per real location, each placed at its
  // hall-layout.ts offset, each with its own washer+dryer pair at that
  // room's own local machineSlots (translated into world space the same
  // way the single A/B room always did: slot is in the room's local
  // space, machine groups are added directly to the scene, not nested
  // under room.group, so each machine's world position is simply the
  // room's offset plus its local slot).
  //
  // Stage 3 fix (focus occlusion) — roomsByLocation and
  // machineGroupsByLocation let setOnlyLocationVisible() below toggle an
  // entire room (its walls/floor/props AND its machines) on or off by
  // location, so a focused back-row room is never hidden behind a
  // front-row room's walls, and the other rooms' now-invisible meshes
  // never intercept a click either (see interaction.ts's targetAt()
  // filtering on mesh.group.visible).
  const roomGroups: THREE.Object3D[] = [];
  const roomsByLocation = new Map<Location, THREE.Object3D>();
  const machineGroupsByLocation = new Map<Location, THREE.Object3D[]>();
  const machineHandles = new Map<string, MachineMeshHandle>();
  const interactionTargets: InteractionTarget[] = [];
  const machinesByLocation = new Map<string, Machine[]>();
  for (const machine of machines) {
    const list = machinesByLocation.get(machine.location) ?? [];
    list.push(machine);
    machinesByLocation.set(machine.location, list);
  }

  for (const placement of ROOM_PLACEMENTS) {
    const room = buildRoom(placement.mirror);
    room.group.position.copy(placement.position);
    // Stage 3 — the large block letter mounted on this room's back wall
    // (see room-label.ts). A child of room.group, not a separate scene
    // object, so it inherits the room's position/visibility for free.
    room.group.add(buildRoomLabel(placement.location));
    scene.add(room.group);
    roomGroups.push(room.group);
    roomsByLocation.set(placement.location, room.group);
    machineGroupsByLocation.set(placement.location, []);

    const roomMachines = machinesByLocation.get(placement.location) ?? [];
    const washer = roomMachines.find((m) => m.type === "washer");
    const dryer = roomMachines.find((m) => m.type === "dryer");
    const typed: Array<[Machine | undefined, MachineType]> = [
      [washer, "washer"],
      [dryer, "dryer"],
    ];
    typed.forEach(([machine, type], index) => {
      if (!machine) return;
      const handle = buildMachineMesh(machine.id, type, machine.status);
      const slot = room.machineSlots[index]!;
      handle.group.position.copy(slot).add(placement.position);
      scene.add(handle.group);
      machineHandles.set(machine.id, handle);
      interactionTargets.push({ id: machine.id, mesh: handle, machine });
      machineGroupsByLocation.get(placement.location)!.push(handle.group);
    });
  }

  // Stage 3 fix — hides every room except `onlyLocation` (and that
  // room's own machines are the only ones left clickable/visible too,
  // via interaction.ts's targetAt() filter on mesh.group.visible).
  // `null` means "show all five" (the overview state). This is the
  // direct, no-partial-occlusion approach: rather than keep tuning the
  // staggered layout's Z/Y gaps to try to make every room's focus shot
  // avoid every other room from every possible camera angle, a focused
  // room's neighbors are simply not drawn at all for as long as that
  // focus lasts — overview restores all five immediately on return.
  function setOnlyLocationVisible(onlyLocation: Location | null): void {
    for (const [location, roomGroup] of roomsByLocation) {
      const visible = onlyLocation === null || location === onlyLocation;
      roomGroup.visible = visible;
      for (const machineGroup of machineGroupsByLocation.get(location) ?? []) {
        machineGroup.visible = visible;
      }
    }
  }

  // Stage 2.2 (Stage 3: now fit to all five rooms' combined bounds, not
  // just one) — the overview fit, computed from the rooms' real bounds
  // (room groups only: machines are separate scene children, never
  // nested inside any room.group, so this never accidentally includes
  // any machine's interaction-overlay meshes). Recomputed identically in
  // handleResize() below when the aspect ratio changes.
  const overviewLookAt = new THREE.Vector3();
  let overviewZoom = 1;
  function computeOverviewFit(): void {
    const corners = boundsCorners(roomGroups);
    const fit = fitBoundsToRect(
      corners,
      ISO_VIEW_DIRECTION,
      new THREE.Vector3(0, 1, 0),
      aspect,
      -OVERVIEW_FILL,
      OVERVIEW_FILL,
      -OVERVIEW_FILL,
      OVERVIEW_FILL,
    );
    overviewLookAt.copy(fit.lookAt);
    overviewZoom = 1 / fit.frustumHalfHeight;
    camera.left = -1 * aspect;
    camera.right = 1 * aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.position.copy(overviewLookAt).addScaledVector(ISO_VIEW_DIRECTION, CAMERA_DISTANCE);
    camera.zoom = overviewZoom;
    camera.lookAt(overviewLookAt);
    camera.updateProjectionMatrix();
  }
  computeOverviewFit();

  // Stage 2 — overlay DOM (hover card + focus panel) and interaction
  // (raycasting, hover/click, the camera dolly tween). `container` here
  // is the same element the canvas lives in — the overlay positions
  // itself relative to it via CSS (see index.astro's .hall-view-canvas
  // being `position: relative`).
  const overviewPosition = camera.position.clone();

  // overlay is declared with `let` and assigned just below so its
  // onFocusChange/onHoverChange callbacks (passed into createInteraction
  // first) can close over it — createInteraction only invokes those
  // callbacks in response to later pointer events, never synchronously
  // during its own construction, so overlay is always assigned by the
  // time either callback actually runs.
  let overlay: ReturnType<typeof createOverlay>;
  // Stage 2.1 — tracked so the render loop can re-project this target's
  // own HUD anchor every frame (see updateFocusPanelPosition below). The
  // anchor point needs to track both the camera's in-flight focus tween
  // and window resizes, so a one-off position set at focus time isn't
  // enough — it has to be continuous.
  let focusedTarget: InteractionTarget | null = null;

  const interaction = createInteraction(
    renderer.domElement,
    camera,
    interactionTargets,
    overviewPosition,
    overviewLookAt,
    overviewZoom,
    aspect,
    {
      onHoverChange(target, screenX, screenY) {
        overlay.showHover(target?.machine ?? null, screenX, screenY);
      },
      onFocusChange(target) {
        focusedTarget = target;
        overlay.showFocus(target?.machine ?? null);
        onFocusChange?.(target?.id ?? null);
        // Stage 3 fix — only the focused machine's own room stays
        // visible while focused; every other room (and its machines)
        // is hidden, so a front-row room can never occlude a back-row
        // room's focus shot (or vice versa). Returning to overview
        // (target === null) restores all five.
        setOnlyLocationVisible(target ? target.machine.location : null);
        // Positioned immediately, not left to wait for the next
        // animate() frame — avoids a one-frame flash of the panel
        // appearing at no particular position before its first update.
        updateFocusPanelPosition();
      },
    },
  );

  overlay = createOverlay(container, () => interaction.returnToOverview());

  // Stage 2.1/2.2 — projects focusedTarget's HUD anchor
  // (machine-mesh.ts's getHudAnchorWorld) through the camera into
  // container-relative screen pixels, and keeps the focus panel pinned
  // there every frame (the anchor moves during the camera's focus tween
  // and on window resize). Point 3's screen-space clamp: the focus
  // shot's NDC rectangle (interaction.ts's FOCUS_NDC_TOP) already
  // reserves room for the panel as a matter of 3D framing, but a
  // clamp here is the safety net for whatever that reservation doesn't
  // exactly cover (an unusually tall panel, an unusually narrow
  // viewport) — it nudges the panel's on-screen position within the
  // container's bounds, it never changes the 3D camera to make room.
  const hudAnchorWorld = new THREE.Vector3();
  function updateFocusPanelPosition(): void {
    if (!focusedTarget) return;
    focusedTarget.mesh.getHudAnchorWorld(hudAnchorWorld);
    const ndc = hudAnchorWorld.clone().project(camera);
    const width = container.clientWidth;
    const height = container.clientHeight;
    const screenX = ((ndc.x + 1) / 2) * width;
    const screenY = ((1 - ndc.y) / 2) * height;
    overlay.updateFocusPosition(screenX, screenY, width, height);
  }

  // Stage 2.3 — the one place a real update actually touches the scene.
  // Looks the machine up by id (machineHandles is already keyed that
  // way for exactly this kind of lookup) and:
  //  - applies its new status to the mesh (material, drum spin on/off,
  //    hazard tape, LED) via the existing setStatus() — the same
  //    per-status look built in Stage 1/2, now just reachable from a
  //    live update instead of only from the initial mount;
  //  - if this machine's focus panel is currently open, refreshes its
  //    displayed content (status/confirmed/remaining) too — otherwise a
  //    resident watching a focused machine while someone else reports
  //    it would see the 3D mesh change but the panel's text go stale.
  // Nothing here creates a new mesh, a new interaction target, or
  // touches the camera — an update changes what's already there, it
  // never adds or removes a machine (the room's machine list is fixed
  // per CLAUDE.md).
  function applyMachineUpdate(machine: Machine): void {
    const handle = machineHandles.get(machine.id);
    if (!handle) return;
    handle.setStatus(machine.status);

    const target = interactionTargets.find((t) => t.id === machine.id);
    if (target) target.machine = machine;

    if (interaction.focusedTargetId() === machine.id) {
      overlay.showFocus(machine);
    }
  }

  const registeredScene: MountedScene = { applyMachineUpdate };
  mountedScenes.add(registeredScene);

  function handleResize(): void {
    const width = container.clientWidth;
    const height = Math.max(container.clientHeight, 1);
    aspect = width / height;
    renderer.setSize(width, height);
    computeOverviewFit();
    overviewPosition.copy(camera.position);
    interaction.refreshFraming(aspect, overviewPosition, overviewLookAt, overviewZoom);
  }
  window.addEventListener("resize", handleResize);

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const clock = new THREE.Clock();
  let frameId: number | null = null;
  let previousElapsed = 0;
  function animate(): void {
    frameId = requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    const delta = elapsed - previousElapsed;
    previousElapsed = elapsed;
    if (!prefersReducedMotion) {
      for (const handle of machineHandles.values()) handle.update(elapsed);
    }
    // Always advances, unlike the ambient per-machine animation above:
    // see interaction.ts's note on why a user-initiated camera move
    // can't simply be skipped under reduced motion (it would leave the
    // camera stuck at the overview position) — reduced motion instead
    // makes interaction.ts's own tween duration near-instant.
    interaction.update(delta);
    updateFocusPanelPosition();
    renderer.render(scene, camera);
  }
  animate();

  function dispose(): void {
    if (frameId !== null) cancelAnimationFrame(frameId);
    window.removeEventListener("resize", handleResize);
    interaction.dispose();
    overlay.dispose();
    renderer.dispose();
    container.removeChild(renderer.domElement);
    mountedScenes.delete(registeredScene);
  }

  return { dispose };
}
