// Pointer interaction: hover highlight, click-to-focus with a smooth
// camera tween, and keyboard/background dismissal. Deliberately
// structured so nothing here assumes "exactly one room" or "exactly two
// machines": it raycasts against whatever meshes are registered with it,
// so Stage 3 (more rooms) only needs to register more meshes, not rewrite
// this module. Still a fixed orthographic camera throughout — "focus"
// moves the camera to a computed close-up position and back, never hands
// the user free camera control (no orbit, no drag-to-rotate, nothing
// the user can push further than the one fitted shot this sets up).
//
// Stage 2.4 — the focus camera is no longer a "fit everything into a
// rectangle" calculation at all. That approach (camera-fit.ts's
// fitBoundsToRect(), used for the overview and an earlier version of
// this) is right for "show the whole room," but wrong for "close-up on
// one machine": the washer/dryer body is a fixed, deliberately NOT
// reshaped 1.1×1.3 (narrower than tall) object, and fitting its full
// extent (plus legs, plus the HUD bracket) into any landscape-canvas
// rectangle is *always* bound by height — verified numerically before
// this rewrite: even reserving zero margin at all, the content could
// never exceed ~43% of frame width, no matter how the target rectangle
// was shaped. That's not a bug to fix with more fitting math; a
// close-up composition was never supposed to show the whole room
// un-cropped the way the overview does. This now sizes the camera from
// FIXED LOCAL GEOMETRY CONSTANTS (the bracket's top edge, the legs'
// bottom edge — both already fixed values shared by every machine in
// machine-mesh.ts, not a dynamic bounds computation) so the machine's
// body fills a consistent ~75% of frame height on every focus, with the
// walls/floor behind it cropped naturally like a real close-up — never
// fit to show the whole room the way overview does. Width is whatever
// the aspect ratio gives; no attempt is made to "use" unused width,
// since the machine's own true proportions (not reshaped) don't call
// for it. The DOM focus panel plays no part in this calculation at all
// — see overlay.ts's screen-space clamp for how it stays on-screen
// without the 3D camera reserving room for it.
import * as THREE from "three";
import type { Machine } from "../types.ts";
import type { MachineMeshHandle } from "./machine-mesh.ts";

export interface InteractionTarget {
  id: string;
  mesh: MachineMeshHandle;
  machine: Machine;
}

export interface InteractionCallbacks {
  /** Called whenever the hovered machine changes (null = nothing hovered).
   * screenX/screenY are relative to the canvas's offsetParent (the
   * container the overlay also positions itself within), taken from the
   * very pointermove event that triggered this — not a separately
   * tracked copy, which would race this callback (two 'pointermove'
   * listeners on the same element fire in registration order, so a
   * second listener updating "last known position" can still be stale
   * by the time this one reads it). */
  onHoverChange(target: InteractionTarget | null, screenX: number, screenY: number): void;
  /** Called whenever the focused machine changes (null = returned to overview). */
  onFocusChange(target: InteractionTarget | null): void;
}

export interface InteractionHandle {
  /** Call every frame — advances any in-flight camera tween. */
  update(deltaSeconds: number): void;
  /** Exposed so the overlay's close (×) button can trigger the same dismissal a click-on-background or Escape does. */
  returnToOverview(): void;
  /** Stage 2.3 — the currently focused target's id, or null. Lets
   * scene.ts's applyMachineUpdate() know whether an incoming update is
   * for the machine whose focus panel is currently showing — if so, the
   * panel's *content* (status/confirmedAt/expectedEndAt) needs
   * refreshing too, not just the 3D mesh, since someone else's report
   * can change what it should say while it's open. */
  focusedTargetId(): string | null;
  /** Recomputes the focus fit for whatever's currently focused, and
   * snaps to the new overview position/lookAt/zoom if nothing is
   * focused — called by scene.ts on resize, since both depend on the
   * aspect ratio scene.ts recomputes there. */
  refreshFraming(
    newAspect: number,
    overviewPosition: THREE.Vector3,
    overviewLookAt: THREE.Vector3,
    overviewZoom: number,
  ): void;
  dispose(): void;
}

// Camera tween timing — smooth but brisk; this is a glance-and-inspect
// interaction, not a cinematic cutscene. 480ms matches the kind of
// "snappy but not jarring" timing the rest of the app's own UI already
// uses (compare the existing CSS's 0.15s/0.18s micro-transitions,
// scaled up for a much larger, 3D camera move).
//
// Under prefers-reduced-motion, this becomes a near-zero duration — the
// camera still moves to the focused position (that's the actual
// feature: a closer view + the detail panel), it just doesn't animate
// the transition. This is a deliberate, user-initiated one-shot move,
// not continuous ambient motion like the drum spin/jitter — so unlike
// those, it's never simply skipped outright; skipping it would leave
// the camera stuck at the overview position with no way to actually see
// the closer "inspect" shot.
const FOCUS_TWEEN_SECONDS = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0.001 : 0.48;

// Stage 2.2 — the focus camera's own view direction: frontal, with a
// small upward elevation (not perfectly flat/degenerate, and
// deliberately far short of the overview's full isometric elevation —
// see scene.ts's ISO_ELEVATION) so the shot still reads as a natural
// eye-level "look at the machine" angle rather than a flat orthographic
// projection with no sense of looking slightly down.
const FOCUS_ELEVATION = Math.PI / 14;
const FOCUS_VIEW_DIRECTION = new THREE.Vector3(0, Math.sin(FOCUS_ELEVATION), Math.cos(FOCUS_ELEVATION)).normalize();
const FOCUS_CAMERA_DISTANCE = 10; // arbitrary — orthographic apparent size depends only on frustumHalfHeight/zoom, not distance

// Stage 2.4 — the two fixed local-Y anchors the focus camera frames
// between: the top HUD bracket's own top edge (0.78 + the bracket
// line's own 0.22 reach — see machine-mesh.ts's bracketCorners/
// buildBracketShape) and the legs' bottom edge (-0.75 — see
// machine-mesh.ts's leg y-position of -0.7 minus half the leg's own
// 0.1 height). These are the same shared constants every machine's
// mesh is built from, not re-measured per machine — every washer/dryer
// in this room has an identical body, so one fixed pair of anchors is
// correct for all of them, not something to recompute from a live
// bounds query the way the room-overview fit does.
const FOCUS_TOP_ANCHOR_Y = 1.0;
const FOCUS_BOTTOM_ANCHOR_Y = -0.75;
// Small, deliberately asymmetric-in-spirit-only NDC margins: both are
// "small" per the brief, but kept as two named constants rather than
// one shared value in case the top ever needs slightly more headroom
// than the bottom for a reason unrelated to the DOM panel (the panel
// itself plays NO part in this calculation — see this module's own
// top-of-file note).
const FOCUS_TOP_MARGIN = 0.05;
const FOCUS_BOTTOM_MARGIN = 0.05;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createInteraction(
  canvas: HTMLCanvasElement,
  camera: THREE.OrthographicCamera,
  targets: InteractionTarget[],
  overviewPosition: THREE.Vector3,
  overviewLookAt: THREE.Vector3,
  overviewZoom: number,
  aspect: number,
  callbacks: InteractionCallbacks,
): InteractionHandle {
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  let hoveredTarget: InteractionTarget | null = null;
  let focusedTarget: InteractionTarget | null = null;
  let currentAspect = aspect;
  let currentOverviewPosition = overviewPosition.clone();
  let currentOverviewLookAt = overviewLookAt.clone();
  let currentOverviewZoom = overviewZoom;

  // Tween state: where the camera is animating from/to. `null` tween
  // means the camera is already where it should be. The camera's actual
  // position/zoom/lookAt are mutated only inside update() below — no
  // other code path moves the camera, which is what keeps "no free
  // camera control" true even while this adds a second camera state
  // (overview vs. focused) beyond a single fixed shot.
  interface Tween {
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromLookAt: THREE.Vector3;
    toLookAt: THREE.Vector3;
    fromZoom: number;
    toZoom: number;
    elapsed: number;
  }
  let tween: Tween | null = null;
  const currentLookAt = overviewLookAt.clone();

  function startTween(toPosition: THREE.Vector3, toLookAt: THREE.Vector3, toZoom: number): void {
    tween = {
      fromPosition: camera.position.clone(),
      toPosition: toPosition.clone(),
      fromLookAt: currentLookAt.clone(),
      toLookAt: toLookAt.clone(),
      fromZoom: camera.zoom,
      toZoom,
      elapsed: 0,
    };
  }

  // Stage 2.4 — a close-up composition, not a bounds fit. Frames the
  // camera so FOCUS_TOP_ANCHOR_Y and FOCUS_BOTTOM_ANCHOR_Y — fixed local
  // points every machine's mesh shares — land at the top/bottom NDC
  // margins, vertically. Horizontally, the machine is simply centered
  // (its own local X=0, i.e. the body's true center) — no horizontal
  // fit is attempted; width is whatever the resulting zoom/aspect gives,
  // deliberately (see this module's top-of-file note on why fitting
  // width would require either distorting the machine or capping zoom
  // so low the shot stops being a close-up at all).
  //
  // The two world-space anchor points are built once from the fixed
  // local Y constants (every machine's identical geometry) plus this
  // target's own slot position (mesh.group.position, the world
  // placement scene.ts already assigned it) — not from a live bounds
  // query, since the composition is deliberately the same for every
  // machine regardless of its current status (status changes material/
  // animation, never geometry).
  function computeFocusCamera(target: InteractionTarget): { position: THREE.Vector3; lookAt: THREE.Vector3; zoom: number } {
    const slot = target.mesh.group.position;
    const topAnchor = slot.clone().add(new THREE.Vector3(0, FOCUS_TOP_ANCHOR_Y, 0));
    const bottomAnchor = slot.clone().add(new THREE.Vector3(0, FOCUS_BOTTOM_ANCHOR_Y, 0));

    const up = new THREE.Vector3(0, 1, 0);
    // camUp: the camera's actual up vector in world space for this view
    // direction — not simply world +Y, since FOCUS_VIEW_DIRECTION has a
    // slight upward elevation (see this file's own note on why), so the
    // camera's local "up" is tilted slightly forward of true vertical.
    // Reusing the same probe-camera technique camera-fit.ts verified,
    // rather than assuming camUp === up.
    const probe = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    probe.position.copy(FOCUS_VIEW_DIRECTION).multiplyScalar(100);
    probe.up.copy(up);
    probe.lookAt(0, 0, 0);
    probe.updateMatrixWorld();
    const camUp = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);

    const topU = topAnchor.dot(camUp);
    const bottomU = bottomAnchor.dot(camUp);
    const availableNdcSpan = 2 - FOCUS_TOP_MARGIN - FOCUS_BOTTOM_MARGIN;
    const frustumHalfHeight = (topU - bottomU) / availableNdcSpan;
    // lookAt's camUp-component such that topAnchor lands exactly at NDC
    // (1 - FOCUS_TOP_MARGIN): (topU - lookAtU) / frustumHalfHeight == 1 - FOCUS_TOP_MARGIN
    const lookAtU = topU - (1 - FOCUS_TOP_MARGIN) * frustumHalfHeight;

    // Horizontal placement: center on the machine's own slot X/Z — no
    // width fitting, just centering the body itself in frame.
    const lookAt = slot.clone();
    // Overwrite only the camUp-axis component with the vertically-solved
    // value above; camera.lookAt() (used when actually aiming the real
    // camera, both here for position and in update()'s tween) handles
    // the rest of the orientation correctly regardless of this point's
    // exact camRight/view-direction components, since those two other
    // axes are already what slot naturally gives.
    const camRight = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
    const slotR = slot.dot(camRight);
    lookAt.copy(new THREE.Vector3().addScaledVector(camRight, slotR).addScaledVector(camUp, lookAtU));

    const position = lookAt.clone().addScaledVector(FOCUS_VIEW_DIRECTION, FOCUS_CAMERA_DISTANCE);
    return { position, lookAt, zoom: 1 / frustumHalfHeight };
  }

  // Raycasts only against each target's dedicated hitbox mesh — a flat,
  // non-recursive list, exactly matching the real body silhouette,
  // never the interaction-overlay meshes (outline, ground glow, hazard
  // stripe, HUD brackets). A real bug found and fixed in Stage 2.1:
  // Three.js's raycaster never checks `.visible`, and its Line.raycast()
  // uses a default 1-world-unit hit threshold regardless of how short
  // the segment is — large enough, at this room's ~1.7-unit machine
  // spacing, for one machine's always-present bracket lines to cover a
  // neighboring machine's empty space.
  function targetAt(ndcX: number, ndcY: number): InteractionTarget | null {
    pointerNdc.set(ndcX, ndcY);
    raycaster.setFromCamera(pointerNdc, camera);
    const hitboxes = targets.map((t) => t.mesh.hitbox);
    const hits = raycaster.intersectObjects(hitboxes, false);
    if (hits.length === 0) return null;
    const hitObject = hits[0]!.object;
    return targets.find((t) => t.mesh.hitbox === hitObject) ?? null;
  }

  function ndcFromEvent(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  function setHover(next: InteractionTarget | null, screenX: number, screenY: number): void {
    hoveredTarget?.mesh.setHovered(false);
    hoveredTarget = next;
    // A focused machine already shows the fuller focus panel — its mesh
    // ring stays at the focus level (not hover) and the small hover
    // card is suppressed entirely while it's the focused one, rather
    // than stacking a second, redundant info surface on top of the
    // focus panel.
    const isFocused = next !== null && next === focusedTarget;
    if (next && !isFocused) next.mesh.setHovered(true);
    // Always notified when not focused (not gated on "did the target
    // change") — the hover card's own position needs to track the live
    // pointer even while still hovering the same machine, not just on
    // target change.
    callbacks.onHoverChange(isFocused ? null : next, screenX, screenY);
    canvas.style.cursor = next ? "pointer" : "default";
  }

  function focusOn(target: InteractionTarget): void {
    if (focusedTarget === target) return;
    focusedTarget?.mesh.setFocused(false);
    focusedTarget = target;
    target.mesh.setFocused(true);
    // Being focused supersedes hover's own ring (setFocused's look is
    // already the stronger of the two) and its info card (the fuller
    // focus panel is about to show the same facts and more) — clear
    // both the mesh-level hover ring and notify the hover-card overlay
    // to hide, not just the bookkeeping variable, or the hover card
    // stays visible, stacked underneath the new focus panel.
    if (hoveredTarget === target) {
      hoveredTarget.mesh.setHovered(false);
      hoveredTarget = null;
      callbacks.onHoverChange(null, 0, 0);
    }

    const { position, lookAt, zoom } = computeFocusCamera(target);
    startTween(position, lookAt, zoom);
    callbacks.onFocusChange(target);
  }

  function returnToOverview(): void {
    if (!focusedTarget) return;
    focusedTarget.mesh.setFocused(false);
    focusedTarget = null;
    startTween(currentOverviewPosition, currentOverviewLookAt, currentOverviewZoom);
    callbacks.onFocusChange(null);
  }

  function handlePointerMove(event: PointerEvent): void {
    const { x, y } = ndcFromEvent(event);
    // Container-relative screen coordinates, read directly from this
    // same event — not a separately tracked "last known position" that
    // a second listener elsewhere could race (see onHoverChange's own
    // note on why).
    const rect = canvas.getBoundingClientRect();
    setHover(targetAt(x, y), event.clientX - rect.left, event.clientY - rect.top);
  }

  function handleClick(event: PointerEvent): void {
    const { x, y } = ndcFromEvent(event);
    const hit = targetAt(x, y);
    if (hit) {
      focusOn(hit);
    } else {
      returnToOverview();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") returnToOverview();
  }

  function handlePointerLeave(): void {
    setHover(null, 0, 0);
  }

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("click", handleClick);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("keydown", handleKeydown);

  function update(deltaSeconds: number): void {
    if (!tween) return;
    tween.elapsed += deltaSeconds;
    const t = Math.min(tween.elapsed / FOCUS_TWEEN_SECONDS, 1);
    const eased = easeInOutCubic(t);
    camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    currentLookAt.lerpVectors(tween.fromLookAt, tween.toLookAt, eased);
    camera.zoom = tween.fromZoom + (tween.toZoom - tween.fromZoom) * eased;
    camera.lookAt(currentLookAt);
    camera.updateProjectionMatrix();
    if (t >= 1) tween = null;
  }

  // Called by scene.ts on resize: aspect changed, so both the overview
  // fit (computed in scene.ts, passed in here) and any in-progress or
  // current focus fit (computed in this module) need to be refreshed
  // against the new aspect, not left stale.
  function refreshFraming(
    newAspect: number,
    newOverviewPosition: THREE.Vector3,
    newOverviewLookAt: THREE.Vector3,
    newOverviewZoom: number,
  ): void {
    currentAspect = newAspect;
    currentOverviewPosition = newOverviewPosition.clone();
    currentOverviewLookAt = newOverviewLookAt.clone();
    currentOverviewZoom = newOverviewZoom;
    if (focusedTarget) {
      const { position, lookAt, zoom } = computeFocusCamera(focusedTarget);
      camera.position.copy(position);
      currentLookAt.copy(lookAt);
      camera.zoom = zoom;
      camera.lookAt(lookAt);
      camera.updateProjectionMatrix();
    } else if (!tween) {
      camera.position.copy(currentOverviewPosition);
      currentLookAt.copy(currentOverviewLookAt);
      camera.zoom = currentOverviewZoom;
      camera.lookAt(currentOverviewLookAt);
      camera.updateProjectionMatrix();
    }
  }

  function dispose(): void {
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("click", handleClick);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("keydown", handleKeydown);
  }

  function focusedTargetId(): string | null {
    return focusedTarget?.id ?? null;
  }

  return { update, returnToOverview, refreshFraming, focusedTargetId, dispose };
}
