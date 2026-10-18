// Stage 4 — the ONE WebGLRenderer and ONE render loop for the whole Hall
// View, shared by every facility that mounts a 3D scene (Laundry today,
// AA Room as of this stage, any future facility after that). Before this
// module existed, scene.ts's mount() created its own renderer and its
// own requestAnimationFrame loop; adding a second facility by copying
// that pattern would have meant a second live WebGLRenderer context
// running (and rendering, even off-screen) at the same time — real GPU
// cost for a canvas nobody's looking at, and the exact anti-pattern this
// module exists to rule out structurally, not just avoid by convention.
//
// A facility's own mount function (scene.ts's mount()/mountAaRoom())
// builds its own THREE.Scene/camera and the content it puts in that
// scene, but never creates a THREE.WebGLRenderer or its own animation
// loop — it registers a small {scene, camera, resize, update} descriptor
// here instead. Exactly one registered facility is ever "active"
// (rendered + receiving per-frame update() calls) at a time; switching
// which one is active is a cheap canvas reparent (appendChild into the
// newly active facility's own container — a DOM move, not a new canvas
// or a new WebGL context) plus a resize/refit against that container's
// now-visible real dimensions.
import * as THREE from "three";

export interface HallFacilityContent {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Called once when this facility becomes active (its container just
   * became visible, so this is also the first point its real
   * clientWidth/clientHeight can be trusted), and again on every window
   * resize while this facility stays active. Never called while a
   * facility is inactive — an inactive facility's container is
   * display:none (see src/pages/index.astro's `.facility-view[hidden]`
   * rule), so its clientWidth/clientHeight would read 0 anyway. */
  resize(width: number, height: number): void;
  /** Called every animation frame, but ONLY while this facility is the
   * active one — an inactive facility's content is simply not ticked,
   * the same way a real diorama nobody is looking at doesn't need its
   * animation computed. `deltaSeconds` is wall-clock time since the last
   * frame THIS facility was active for (see activateFacility: the shared
   * clock keeps running, but a facility that regains activity after a
   * while gets one possibly-large delta for that first frame back, not
   * a sudden jump computed from however long it's been — callers that
   * accumulate their own elapsed-time counter from these deltas, as
   * scene.ts's mount() and mountAaRoom() both do, are unaffected by that
   * either way since they only ever see real, monotonic deltas). */
  update(deltaSeconds: number): void;
}

let renderer: THREE.WebGLRenderer | null = null;
let clock: THREE.Clock | null = null;
let frameId: number | null = null;
let activeKey: string | null = null;
let activeContainer: HTMLElement | null = null;
const contents = new Map<string, HallFacilityContent>();

function handleWindowResize(): void {
  if (!renderer || !activeKey || !activeContainer) return;
  const content = contents.get(activeKey);
  if (!content) return;
  const width = activeContainer.clientWidth;
  const height = Math.max(activeContainer.clientHeight, 1);
  renderer.setSize(width, height);
  content.resize(width, height);
}

function animate(): void {
  frameId = requestAnimationFrame(animate);
  if (!renderer || !activeKey || !clock) return;
  const content = contents.get(activeKey);
  if (!content) return;
  const delta = clock.getDelta();
  content.update(delta);
  renderer.render(content.scene, content.camera);
}

function ensureRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  clock = new THREE.Clock();
  window.addEventListener("resize", handleWindowResize);
  animate();
  return renderer;
}

/** The one shared canvas element every facility's interaction layer (if
 * it has one — AA Room deliberately doesn't) attaches pointer listeners
 * to. Laundry's createInteraction() call uses this instead of a
 * per-mount renderer.domElement. */
export function getSharedCanvas(): HTMLCanvasElement {
  return ensureRenderer().domElement;
}

/** Registers a facility's content under `key` — building the scene is
 * the caller's job; this only makes it eligible to become active later.
 * Safe to call before this facility is ever shown (its container may
 * still be `hidden`/zero-sized at this point — resize()/update() are
 * never invoked until activateFacility() actually selects it). */
export function registerFacility(key: string, content: HallFacilityContent): void {
  ensureRenderer();
  contents.set(key, content);
}

export function unregisterFacility(key: string): void {
  contents.delete(key);
  if (activeKey === key) {
    activeKey = null;
    activeContainer = null;
  }
}

/** Makes `key` the one facility being rendered: moves the single shared
 * canvas into `container` (a no-op DOM-wise if it's already there) and
 * immediately resizes/refits against that container's current real
 * size. Call this once at page load for whichever facility starts
 * visible, and again every time the visible facility changes (e.g. a
 * facility-tab click) — see src/pages/index.astro. */
export function activateFacility(key: string, container: HTMLElement): void {
  const content = contents.get(key);
  if (!content) return;
  const r = ensureRenderer();
  if (r.domElement.parentElement !== container) {
    container.appendChild(r.domElement);
  }
  activeKey = key;
  activeContainer = container;
  const width = container.clientWidth;
  const height = Math.max(container.clientHeight, 1);
  r.setSize(width, height);
  content.resize(width, height);
}
