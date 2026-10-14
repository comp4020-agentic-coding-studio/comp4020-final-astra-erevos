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
// Stage 2.2 — the focus camera's framing is now computed by
// camera-fit.ts's fitBoundsToRect() from each machine's own real extent
// (getFocusedExtentWorld()), not a hand-placed position/lookAt tuned by
// screenshotting one viewport. See scene.ts for the equivalent fix to
// the overview shot.
import * as THREE from "three";
import type { Machine } from "../types.ts";
import type { MachineMeshHandle } from "./machine-mesh.ts";
import { fitBoundsToRect } from "./camera-fit.ts";

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

// Stage 2.2 — the focus shot's target NDC rectangle. Asymmetric on
// purpose: a real bug in the previous version tried to make room for
// the DOM focus panel by shrinking the WHOLE 3D camera's zoom down
// until the panel's own (variable) pixel height happened to fit above
// it — which fought the user's actual ask ("focus 时机器应该明显比
// overview 大很多") every time the panel was tall. Instead, the top of
// the frame is reserved for the panel as a fixed fraction of the
// viewport (not derived from any one panel's measured height), and the
// machine + HUD brackets are fit as large as possible into the
// remaining space — bottom/left/right keep only a small margin, so the
// machine reads as genuinely larger in focus than in overview, not
// smaller. Point 3 (screen-space clamp) is the safety net for whatever
// doesn't fit this reserve exactly; this rectangle is the primary
// mechanism, not a guess either is sufficient.
const FOCUS_NDC_LEFT = -0.92;
const FOCUS_NDC_RIGHT = 0.92;
const FOCUS_NDC_BOTTOM = -0.92;
const FOCUS_NDC_TOP = 0.35;

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

  // Computes this target's fitted focus camera pose fresh from its real
  // current extent (getFocusedExtentWorld()) and the current aspect
  // ratio — never a cached/precomputed value, so a resize (which
  // changes aspect) or this running at a different time always reflects
  // the live geometry, not a value baked in at construction.
  function computeFocusCamera(target: InteractionTarget): { position: THREE.Vector3; lookAt: THREE.Vector3; zoom: number } {
    const corners = target.mesh.getFocusedExtentWorld();
    const fit = fitBoundsToRect(
      corners,
      FOCUS_VIEW_DIRECTION,
      new THREE.Vector3(0, 1, 0),
      currentAspect,
      FOCUS_NDC_LEFT,
      FOCUS_NDC_RIGHT,
      FOCUS_NDC_BOTTOM,
      FOCUS_NDC_TOP,
    );
    const position = fit.lookAt.clone().addScaledVector(FOCUS_VIEW_DIRECTION, FOCUS_CAMERA_DISTANCE);
    return { position, lookAt: fit.lookAt, zoom: 1 / fit.frustumHalfHeight };
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

  return { update, returnToOverview, refreshFraming, dispose };
}
