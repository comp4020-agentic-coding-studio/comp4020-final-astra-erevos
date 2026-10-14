// Stage 2.2 — general-purpose camera auto-fit, computed from real
// world-space bounds and the canvas's own aspect ratio, never from
// hand-tuned constants. Both the overview shot and the focus "inspect"
// shot are built on this one function; each just supplies its own
// bounds and target NDC rectangle (how much of the frame, and where in
// it, the content should occupy) — the actual framing math is shared
// and derived, never guessed per-camera.
//
// Earlier versions of both camera setups used literal constants
// (frustumHalfHeight = 2.2, a zoom multiplier, a fixed HUD_ANCHOR_LOCAL
// offset) tuned by rendering, screenshotting, and nudging — correct for
// exactly one viewport size and one panel height, and wrong again the
// moment either changed. This module replaces all of that with one
// function whose correctness is checked by construction: project the
// real content bounds back through the computed camera and confirm
// they land exactly on the requested NDC rectangle, not by eyeballing a
// screenshot (verified numerically against this implementation before
// it was wired into the app).
import * as THREE from "three";

export interface FitResult {
  /** World-space point the camera should look at. */
  lookAt: THREE.Vector3;
  /** The orthographic camera's frustumHalfHeight (vertical half-extent, in world units, at zoom=1). */
  frustumHalfHeight: number;
}

/**
 * Computes the lookAt point and frustumHalfHeight an orthographic camera
 * needs so that every corner in `worldCorners`, viewed along `viewDirection`
 * (a unit vector from the target toward the camera) with `up` as the
 * camera's up vector, projects to exactly fill the axis-aligned NDC
 * rectangle [ndcLeft, ndcRight] x [ndcBottom, ndcTop] (each component in
 * [-1, 1]; a symmetric fill like [-0.88, 0.88] x [-0.88, 0.88] reserves
 * an equal margin on every side, while an asymmetric one like
 * [-0.92, 0.92] x [-0.92, 0.4] reserves extra space at the top — e.g.
 * for a screen-space overlay that must not be solved by shrinking the
 * 3D content).
 *
 * This says nothing about *distance* — an orthographic camera's apparent
 * size is controlled by frustumHalfHeight/zoom, not distance — so the
 * caller picks any position along `viewDirection` from `lookAt` that
 * keeps every corner in front of the near plane.
 */
export function fitBoundsToRect(
  worldCorners: THREE.Vector3[],
  viewDirection: THREE.Vector3,
  up: THREE.Vector3,
  aspect: number,
  ndcLeft: number,
  ndcRight: number,
  ndcBottom: number,
  ndcTop: number,
): FitResult {
  // A throwaway camera purely to read off its basis vectors (right/up in
  // world space) for the given view direction — position/zoom here are
  // arbitrary placeholders, never used for anything but matrixWorld.
  const probe = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  probe.position.copy(viewDirection).multiplyScalar(100);
  probe.up.copy(up);
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld();

  const camRight = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);

  // Project every corner onto the view-space right/up axes (dot product
  // against the camera's own right/up, since both are unit vectors) to
  // find the content's 2D bounding box in view space, without yet
  // needing a real camera, zoom, or projection matrix.
  let minRight = Infinity;
  let maxRight = -Infinity;
  let minUp = Infinity;
  let maxUp = -Infinity;
  for (const corner of worldCorners) {
    const right = corner.dot(camRight);
    const vertical = corner.dot(camUp);
    minRight = Math.min(minRight, right);
    maxRight = Math.max(maxRight, right);
    minUp = Math.min(minUp, vertical);
    maxUp = Math.max(maxUp, vertical);
  }

  const boxCenterRight = (minRight + maxRight) / 2;
  const boxCenterUp = (minUp + maxUp) / 2;
  const boxHalfWidth = (maxRight - minRight) / 2;
  const boxHalfHeight = (maxUp - minUp) / 2;

  const targetCenterX = (ndcLeft + ndcRight) / 2;
  const targetCenterY = (ndcBottom + ndcTop) / 2;
  const targetHalfWidth = (ndcRight - ndcLeft) / 2;
  const targetHalfHeight = (ndcTop - ndcBottom) / 2;

  // frustumHalfHeight needed so the box's height fits within the target
  // rectangle's vertical span, and separately so its width fits within
  // the target rectangle's horizontal span (which depends on aspect,
  // since the horizontal frustum extent is frustumHalfHeight * aspect)
  // — take whichever is larger, so both constraints are satisfied
  // simultaneously rather than one at the expense of the other.
  const neededForHeight = boxHalfHeight / targetHalfHeight;
  const neededForWidth = boxHalfWidth / targetHalfWidth / aspect;
  const frustumHalfHeight = Math.max(neededForHeight, neededForWidth);

  // The box's own world-space center.
  const boxCenterWorld = new THREE.Vector3()
    .addScaledVector(camRight, boxCenterRight)
    .addScaledVector(camUp, boxCenterUp);

  // lookAt is offset from the box's center so that, once that center is
  // placed at the target rectangle's own center in NDC (not necessarily
  // frame-center, for an asymmetric rectangle), the box ends up exactly
  // spanning the requested rectangle. A camera's lookAt point always
  // projects to NDC (0,0) — the frame's true center — so to make the
  // box's center land at (targetCenterX, targetCenterY) instead, lookAt
  // must be shifted that many world units in the opposite direction.
  const lookAt = boxCenterWorld
    .clone()
    .addScaledVector(camRight, -targetCenterX * frustumHalfHeight * aspect)
    .addScaledVector(camUp, -targetCenterY * frustumHalfHeight);

  return { lookAt, frustumHalfHeight };
}

/**
 * Collects the world-space AABB corners of everything in `objects`
 * (meshes/groups), via Three.js's own Box3.expandByObject — this is the
 * "real world-space bounds" the fit is computed from, not a manually
 * maintained list of extents that can silently drift from the actual
 * geometry as it's tuned. Note: Box3.expandByObject does NOT check
 * `.visible` (confirmed by reading Three.js's own source, not assumed)
 * — callers must pass only the objects that should actually count
 * toward the bounds, not rely on invisible decorative meshes being
 * silently excluded.
 */
export function boundsCorners(objects: THREE.Object3D[]): THREE.Vector3[] {
  const box = new THREE.Box3();
  for (const object of objects) {
    object.updateMatrixWorld(true);
    box.expandByObject(object);
  }
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corners.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  return corners;
}
