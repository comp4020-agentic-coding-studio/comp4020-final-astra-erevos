// Builds one washer or dryer mesh group — body + an independently
// rotatable drum/porthole mesh, since "the drum spins while in-use" is
// the single most important animated detail and it must be a separate
// mesh, not a material trick, to look real. See status-look.ts for the
// per-status material mapping this applies.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MachineStatus, MachineType } from "../types.ts";
import { lookForStatus } from "./status-look.ts";
import { phaseOffsetFor } from "./phase.ts";
import { HOVER_SCAN_SECONDS, HUD_SCAN_SECONDS, easeInOutCubic, prefersReducedMotion } from "./motion.ts";

export interface MachineMeshHandle {
  /** The group to add to the scene/room — position this, not its children. */
  group: THREE.Group;
  /** Stage 2.1 fix — the ONLY mesh interaction.ts should raycast
   * against for this machine. A real bug: raycasting the whole `group`
   * also hit the interaction-overlay meshes (the outline, ground glow,
   * hazard stripe, and especially the HUD bracket THREE.Line segments —
   * Three.js's Line.raycast() has a default 1-world-unit hit threshold
   * around the line, far larger than the tiny bracket segment itself,
   * and Three.js's raycaster never checks .visible/opacity at all, so
   * these always-present meshes were hit-testable even while invisible).
   * That let a neighboring machine's oversized, invisible hit region
   * cover empty space near a different machine entirely. This hitbox is
   * a plain invisible box sized to the real body silhouette only. */
  hitbox: THREE.Mesh;
  /** Called every frame with the elapsed time in seconds, drives drum spin,
   * status-light blink/pulse, in-use jitter, and focus-bracket pulse. */
  update(elapsedSeconds: number): void;
  /** Applies a new status's look — material colors, spin on/off, hazard band visibility. */
  setStatus(status: MachineStatus): void;
  /** Stage 2: cyan rim outline + ground glow, dimmer than focus. */
  setHovered(hovered: boolean): void;
  /** Stage 2: brighter outline, door-ring accent, and corner HUD brackets. */
  setFocused(focused: boolean): void;
  /** Stage 2.1 fix — world-space point just above this machine's HUD
   * brackets (which sit at local y≈0.78), written into `target` and
   * returned. scene.ts projects this through the camera every frame and
   * anchors the focus panel there, so the panel actually sits above the
   * machine and merges with the brackets — the bug this fixes: the
   * panel was previously just pinned to a fixed screen corner
   * (top: 0.75rem; right: 0.75rem) with no relationship at all to where
   * the machine or its brackets actually render. */
  getHudAnchorWorld(target: THREE.Vector3): THREE.Vector3;
  /** Stage 2.2 — the 8 world-space corners of this machine's full
   * "focused" visual extent: body + legs + HUD brackets (the brackets
   * sit outside the body silhouette, so framing on the body alone would
   * clip them). Used by camera-fit.ts's fitBoundsToFrame() to compute
   * the focus camera's frustum — computed from the same local
   * coordinates the body/leg/bracket meshes themselves are built from
   * (see FOCUSED_EXTENT_LOCAL below), not measured off a screenshot. */
  getFocusedExtentWorld(): THREE.Vector3[];
}

// Local-space point exactly at the top brackets' own position
// (bracketCorners below has them at y=0.78, z=0.62) — not an
// approximated "a bit above" offset. An earlier version used y=0.95 as
// a guess, which left a visibly too-large gap between the panel and the
// brackets once actually screenshotted at the focus camera's zoom
// level (the gap scales with zoom, so a small-looking offset in local
// units reads as a large screen-space gap once zoomed in this far).
// Matching the bracket's own z too, not a different value, since this
// camera's view direction isn't axis-aligned with world Z even in the
// frontal "focus" shot — a differing z can itself shift the projected
// screen position, not just depth.
const HUD_ANCHOR_LOCAL = new THREE.Vector3(0, 0.78, 0.62);

// Shared geometry/material instances across every machine of the same
// type — five rooms' worth of washers can reuse one BoxGeometry, only
// the per-instance Group's transform and the per-instance material
// clones (status needs independent color) differ. Not relevant yet at
// Stage 1's two machines, but keeping the constructor cheap from the
// start means Stage 3 (all five rooms) doesn't need a geometry rewrite.
const bodyGeometry = new RoundedBoxGeometry(1.1, 1.3, 1.0, 3, 0.08);
const drumRingGeometry = new THREE.TorusGeometry(0.32, 0.05, 12, 24);
const drumGlassGeometry = new THREE.CircleGeometry(0.3, 24);
const doorFrameGeometry = new THREE.TorusGeometry(0.34, 0.03, 10, 24);
// A literal strip of "hazard tape" slapped diagonally across the
// porthole — not a thin band low on the body (too subtle at this scale,
// read as a muddy solid color rather than stripes in testing). This is
// also the most literal possible translation of
// notes/FINAL_PROJECT_SOURCE_OF_TRUTH.md §3's own framing: "staff post a
// physical OUT OF ORDER notice" — the 3D view gets to show that
// literally, where the 2D dashboard only has a CSS hazard-tape edge.
const hazardStripeGeometry = new THREE.PlaneGeometry(1.5, 0.3);
// Stage 2 — interaction geometry, shared across every machine the same
// way the status geometry above is.
// Outline: a slightly larger copy of the body rendered back-face-only
// (THREE.BackSide) sitting just behind the real body surface — the
// classic cheap "selection glow" technique, no post-processing pipeline
// needed. Scaled, not a separate shape, so it always matches the body's
// silhouette exactly.
const outlineGeometry = new RoundedBoxGeometry(1.18, 1.38, 1.08, 3, 0.09);
// Ground glow: a soft circular disc on the floor beneath the machine —
// cyan for hover/focus, reads as "this object is the one being
// addressed," independent of the outline (visible even where the
// outline is occluded by other geometry at this camera angle). Sized to
// sit just inside the HUD bracket frame (brackets reach to x=+-0.68 —
// see bracketCorners below), not larger than it: a real bug, found
// during the Stage 2.2 framing fix, was this disc's earlier 0.95
// radius extending past the bracket frame — at the focus camera's
// close zoom, that excess spilled out past where the brackets "close"
// the frame and read as a stray, disconnected arc floating below the
// machine rather than something clearly `under` it.
const groundGlowGeometry = new THREE.CircleGeometry(0.62, 32);
// Status LED: a small emissive dot on the control panel — every real
// appliance has one, and it's the cheapest possible "is this thing
// alive right now" signal, readable even at a glance across the room
// without hovering anything.
const statusLedGeometry = new THREE.CircleGeometry(0.035, 12);
// HUD corner brackets: four small L-shaped line segments floating just
// outside the machine's bounding box, shown only on focus — the
// "instrument panel" cue, kept restrained (four thin lines, not a full
// bounding frame) per the "not game UI plastered on screen" direction.
function buildBracketShape(): THREE.BufferGeometry {
  const points = [
    new THREE.Vector3(0, 0.22, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.22, 0, 0),
  ];
  return new THREE.BufferGeometry().setFromPoints(points);
}
const bracketGeometry = buildBracketShape();

// A simple diagonal-stripe canvas texture for the out-of-order hazard
// band — cheap (one small canvas, generated once, reused by every
// out-of-order machine) and reads unambiguously as "hazard tape," the
// same visual metaphor src/pages/index.astro's CSS already uses for
// .machine--broken. NearestFilter (not the default mipmapped linear
// filter) keeps the stripes crisp rather than blurring into a muddy
// average color at this texture's small on-screen size.
function buildHazardTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f2d230";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#1a1410";
  const stripeWidth = 16;
  for (let x = -size; x < size * 2; x += stripeWidth * 2) {
    ctx.fillRect(x, 0, stripeWidth, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  return texture;
}

let hazardTexture: THREE.CanvasTexture | null = null;
function getHazardTexture(): THREE.CanvasTexture {
  hazardTexture ??= buildHazardTexture();
  return hazardTexture;
}

export function buildMachineMesh(
  id: string,
  type: MachineType,
  initialStatus: MachineStatus,
): MachineMeshHandle {
  const group = new THREE.Group();
  group.name = `machine-${type}`;

  // Stage 4 — a deterministic per-machine phase offset (see phase.ts),
  // added into every periodic animation argument below (drum rotation,
  // LED blink/flicker, jitter) so two machines sharing the same status
  // don't animate in exact lockstep, the way they did before this —
  // confirmed visually to read as "two clones," not "two independent
  // appliances." Purely a phase shift: amplitude/frequency/semantics are
  // unchanged, so this has no bearing on what a machine's status means.
  const phase = phaseOffsetFor(id);

  // Stage 2 — everything that should jitter while in-use lives inside
  // this inner group, not directly on `group` itself. `group`'s own
  // position/transform is owned entirely by the caller (scene.ts places
  // it in the room via room.machineSlots) — jitter must never fight
  // that, so it's expressed as a small local offset on `shake` instead
  // of touching `group.position` directly. The one exception is the
  // ground glow (added to `group` after this block): it's meant to stay
  // fixed to the floor directly beneath the machine's actual position,
  // not jitter along with the body.
  const shake = new THREE.Group();
  shake.name = "shake";
  group.add(shake);

  // Body: the rounded-box cabinet. Its own material is cloned per
  // instance (not shared) since status drives per-instance color.
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.05 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  shake.add(body);

  // Stage 2.1 fix — the dedicated, exclusive raycast target (see
  // MachineMeshHandle.hitbox's own note on why this exists). `visible =
  // false` correctly hides it from rendering, but that's set purely so
  // it never accidentally shows up on screen — it has nothing to do
  // with the raycast fix itself, since Three.js's raycaster ignores
  // .visible entirely either way. The actual fix is scope: this mesh
  // uses the exact same bodyGeometry as the visible body (so its hit
  // region matches the real silhouette precisely) and is the *only*
  // mesh interaction.ts is ever given to test against — no Line
  // segments, no oversized glow discs, nothing with an inflated hit
  // threshold to leak into a neighboring machine's space. Added
  // directly to `group`, not `shake`, at `group`'s own local origin —
  // the same resting position the body sits at (the in-use jitter is a
  // few thousandths of a unit, immaterial for hit-testing).
  const hitbox = new THREE.Mesh(bodyGeometry, new THREE.MeshBasicMaterial());
  hitbox.visible = false;
  group.add(hitbox);

  // Stage 2 — selection outline: a slightly larger, back-face-only copy
  // of the body, hidden until hovered/focused. Cyan/electric, not the
  // warm palette everything else uses — this is the one place the "cyber
  // overlay" register is allowed into the otherwise warm low-poly scene,
  // and it stays confined to interaction feedback only. MeshBasicMaterial
  // (unlit) rather than Standard — it needs to read as a glowing line,
  // not a lit surface that would dim in the body's own shadow.
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x5fe8e0,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
  });
  const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
  shake.add(outline);

  // Control panel: a small raised strip near the top-front, reads as
  // "this is an appliance with controls," not a plain box — a couple of
  // flat knob/button details sell the silhouette as washer/dryer rather
  // than generic crate.
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.5 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.05), panelMaterial);
  panel.position.set(0, 0.52, 0.5);
  panel.castShadow = true;
  shake.add(panel);

  const knobMaterial = new THREE.MeshStandardMaterial({ color: 0xe0c98f, roughness: 0.3, metalness: 0.4 });
  for (const x of [-0.32, -0.1, 0.12]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12), knobMaterial);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, 0.52, 0.53);
    shake.add(knob);
  }

  // Door frame: a torus ring set into the front face — depth cue that
  // reads as a real recessed porthole rather than a decal.
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.4, metalness: 0.3 });
  const doorFrame = new THREE.Mesh(doorFrameGeometry, frameMaterial);
  doorFrame.position.set(0, -0.05, 0.5);
  doorFrame.castShadow = true;
  shake.add(doorFrame);

  // Drum assembly: the independently-rotating child. A ring (the drum's
  // visible rim) plus a flat glass disc (so spin reads as the drum's
  // depth rotating, with the glass disc giving a visible reference
  // surface — an unadorned torus alone doesn't read as "spinning," it
  // needs a flat face to show rotation against). Nested one level
  // deeper than the door frame so it visually sits "inside" the porthole.
  const drum = new THREE.Group();
  drum.name = "drum";
  const drumMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.4, metalness: 0.2 });
  const drumRing = new THREE.Mesh(drumRingGeometry, drumMaterial);
  drum.add(drumRing);
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c2115,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
    emissive: 0x000000,
  });
  const drumGlass = new THREE.Mesh(drumGlassGeometry, glassMaterial);
  drum.add(drumGlass);
  // A small off-center detail on the glass face — the actual thing that
  // makes rotation visible; a perfectly circular, perfectly uniform disc
  // spinning is indistinguishable from standing still.
  const tumbleDetail = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.05, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.5 }),
  );
  tumbleDetail.position.set(0.1, -0.08, 0.02);
  drum.add(tumbleDetail);
  drum.position.set(0, -0.05, 0.51);
  shake.add(drum);

  // Hazard tape: a literal diagonal strip slapped across the porthole,
  // only shown for out-of-order. Built once, toggled via .visible rather
  // than added/removed from the scene graph. Slightly in front of the
  // door frame (z 0.54 vs the frame's 0.5) so it reads as stuck "on top
  // of" the door, not embedded in the same plane as it.
  const hazardMaterial = new THREE.MeshStandardMaterial({
    map: getHazardTexture(),
    roughness: 0.7,
  });
  const hazardStripe = new THREE.Mesh(hazardStripeGeometry, hazardMaterial);
  hazardStripe.position.set(0, -0.05, 0.54);
  hazardStripe.rotation.z = -Math.PI / 7;
  hazardStripe.visible = false;
  shake.add(hazardStripe);

  // Type-specific detail: the one visual difference between a washer
  // and a dryer, so the pair reads as a family of related but distinct
  // appliances rather than two identical boxes with different labels.
  // A washer shows a thin raised "water level" band near the top; a
  // dryer shows a small vent grille on its side instead.
  if (type === "washer") {
    const waterLineMaterial = new THREE.MeshStandardMaterial({ color: 0x3987e5, roughness: 0.3, metalness: 0.2 });
    const waterLine = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.02), waterLineMaterial);
    waterLine.position.set(0, 0.42, 0.5);
    shake.add(waterLine);
  } else {
    const ventMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.7 });
    const ventGrille = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.02), ventMaterial);
      slat.position.set(0.56, 0.1 - i * 0.07, 0.3);
      ventGrille.add(slat);
    }
    shake.add(ventGrille);
  }

  // Legs/feet: small cylinders, lifts the body visibly off the floor —
  // without this the body's shadow reads as "resting flush," losing the
  // sense of a real object with mass standing in the room.
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.6 });
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [
    [-0.45, -0.4],
    [0.45, -0.4],
    [-0.45, 0.4],
    [0.45, 0.4],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), legMaterial);
    legs.push(leg);
    leg.position.set(x, -0.7, z);
    leg.castShadow = true;
    shake.add(leg);
  }

  // Stage 2 — ground glow: a flat cyan disc on the floor, beneath the
  // machine, hidden until hovered/focused. Independent of the outline so
  // the "this one" signal still reads even from an angle where the
  // outline itself might be thin/occluded — the floor glow is always
  // visible from the fixed isometric camera.
  const groundGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x5fe8e0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const groundGlow = new THREE.Mesh(groundGlowGeometry, groundGlowMaterial);
  groundGlow.rotation.x = -Math.PI / 2;
  groundGlow.position.set(0, -0.745, 0); // just above the floor plane, avoids z-fighting
  group.add(groundGlow);

  // Stage 2 — status LED: a small emissive dot on the panel, always
  // visible (not gated on hover/focus) — color/blink driven by status,
  // the one "alive" signal readable at a glance across the whole room.
  const ledMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.3,
  });
  const statusLed = new THREE.Mesh(statusLedGeometry, ledMaterial);
  statusLed.position.set(0.32, 0.52, 0.53);
  shake.add(statusLed);

  // Stage 2 — HUD corner brackets: TOP-left/TOP-right only. A real bug,
  // found and fixed in the Stage 2.3 framing pass: all four corners
  // (including two bottom segments) were originally built, but the
  // bottom pair connects to nothing — the top pair visually merges into
  // the focus panel's own stem above them (one continuous instrument
  // frame), while the bottom pair just floats in empty space below the
  // machine with no panel, no stem, nothing to visually close the frame
  // against. Confirmed directly (not guessed): a debug scene dump
  // showed exactly 4 Line objects with nonzero opacity whenever a
  // machine is focused, at the expected bottom-bracket world positions,
  // proving the "stray disconnected cyan line" a screenshot showed was
  // a real, intentionally-built mesh — not a leftover from the ground
  // glow or hazard tape. Removing the bottom pair also fixes the second
  // problem it was silently causing: machine-mesh.ts's
  // getFocusedExtentWorld() included the bottom brackets' full extent
  // (reaching 0.39 world units below the legs) in the box camera-fit.ts
  // fits the focus camera to — that extra height, on top of the body +
  // legs + top bracket's own height, made the fitted box tall enough
  // relative to the canvas's landscape aspect ratio that no choice of
  // margin could use more than ~30% of the available width (verified
  // numerically: even with zero panel-reservation, the full
  // body+legs+both-brackets box only ever filled ~34% of frame width).
  // Dropping the unconnected bottom pair removes that unnecessary
  // height outright, rather than trying to compensate for it with a
  // wider target rectangle or a different margin.
  const bracketMaterial = new THREE.LineBasicMaterial({ color: 0x5fe8e0, transparent: true, opacity: 0 });
  const bracketCorners: Array<[number, number, number, number]> = [
    [-0.68, 0.78, 1, 1], // top-left: no flip
    [0.68, 0.78, -1, 1], // top-right: flip x
  ];
  // One shared material instance across both — they always show/hide
  // together, so there's nothing per-instance to differentiate.
  const brackets: THREE.Line[] = [];
  // Stage 4 — each bracket's own flip signs, kept so the scan-in reveal
  // (see setVisualState/applyLookState below) can scale each bracket
  // from 0 up to its own (flipX, flipY) rather than a plain (1,1):
  // scaling an L-shaped line FROM its own corner (the shared origin both
  // arms meet at, per bracketGeometry's own points) DOWN to 0 collapses
  // it invisibly at that corner, so animating back up to 1 reads as the
  // bracket being "drawn" outward from the corner — exactly the
  // instrument-panel "scan" look asked for, with no shader or extra
  // geometry needed.
  const bracketSigns = new Map<THREE.Line, { x: number; y: number }>();
  for (const [x, y, flipX, flipY] of bracketCorners) {
    const bracket = new THREE.Line(bracketGeometry, bracketMaterial);
    brackets.push(bracket);
    bracket.position.set(x, y, 0.62);
    bracket.scale.set(0, 0, 1); // starting scale — see setVisualState's initial state below
    bracketSigns.set(bracket, { x: flipX, y: flipY });
    shake.add(bracket);
  }

  const hsl = { h: 0, s: 0, l: 0 };

  function applyDesaturation(color: THREE.Color, amount: number): THREE.Color {
    if (amount <= 0) return color;
    color.getHSL(hsl);
    return color.setHSL(hsl.h, hsl.s * (1 - amount), hsl.l);
  }

  let currentLook = lookForStatus(initialStatus);
  let hovered = false;
  let focused = false;

  function setStatus(status: MachineStatus): void {
    const look = lookForStatus(status);
    currentLook = look;
    bodyMaterial.color = applyDesaturation(new THREE.Color(look.bodyColor), look.desaturate);
    bodyMaterial.roughness = look.roughness;
    glassMaterial.color = new THREE.Color(look.drumColor);
    glassMaterial.emissive = new THREE.Color(look.drumEmissive);
    glassMaterial.emissiveIntensity = look.drumEmissiveIntensity;
    hazardStripe.visible = look.hazard;
    group.userData.spinning = look.spinning;
    ledMaterial.emissive = new THREE.Color(look.ledColor);
    ledMaterial.color = new THREE.Color(look.ledColor);
  }

  setStatus(initialStatus);

  // Stage 2 — hover/focus feedback. Both are additive to whatever status
  // look is already applied: hovering an out-of-order machine still
  // shows the hazard tape, with the cyan outline layered on top, never
  // replacing the status signal. Focus is simply "hover, but stronger" —
  // brighter outline opacity plus the HUD brackets — not a separate
  // visual language.
  const HOVER_OUTLINE_OPACITY = 0.35;
  const FOCUS_OUTLINE_OPACITY = 0.7;
  const HOVER_GLOW_OPACITY = 0.25;
  const FOCUS_GLOW_OPACITY = 0.45;

  // Stage 4 — "scan" reveal driving hover/focus visuals as an animated
  // transition rather than an instant snap. Rather than tracking one
  // "progress toward the new state" value (which would make a scan-OUT
  // jump straight to its target of 0 instead of easing down from
  // whatever level was visible), this interpolates directly between an
  // explicit `scanFrom` level (the levels that were visible when the
  // current transition started) and `scanTo` level (the new state's
  // target levels) — correct for every transition (idle→hover,
  // hover→focus, focus→idle, focus→hover) without special-casing any of
  // them.
  interface ScanLevels {
    outline: number;
    glow: number;
    bracket: number;
    bracketScale: number; // 0 or 1 — brackets only ever fully open or fully closed as a *target*, see bracketSigns for why mid-way values still make sense as an interpolated state
  }
  const SCAN_LEVELS: Record<"idle" | "hover" | "focus", ScanLevels> = {
    idle: { outline: 0, glow: 0, bracket: 0, bracketScale: 0 },
    hover: { outline: HOVER_OUTLINE_OPACITY, glow: HOVER_GLOW_OPACITY, bracket: 0, bracketScale: 0 },
    focus: { outline: FOCUS_OUTLINE_OPACITY, glow: FOCUS_GLOW_OPACITY, bracket: 0.9, bracketScale: 1 },
  };
  let scanFrom: ScanLevels = SCAN_LEVELS.idle;
  let scanTo: ScanLevels = SCAN_LEVELS.idle;
  let scanSourceState: "idle" | "hover" | "focus" = "idle";
  let scanTargetState: "idle" | "hover" | "focus" = "idle";
  let scanProgress = 1; // 1 = fully arrived at scanTo already (the initial, unhovered/unfocused state)
  let scanLastElapsed: number | null = null;

  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  // Stage 4 — applies an interpolated point between scanFrom and scanTo
  // at the given eased `t` to every material/transform the scan drives.
  // Brackets additionally scale with bracketScale (not just opacity) so
  // they read as being "drawn" open from their shared corner
  // (bracketSigns, set above) rather than just fading in place in their
  // full open position — the literal "scan-drawn" instrument-panel look
  // asked for, distinct from hover/glow's plain opacity fade.
  function applyScanLook(t: number): void {
    outlineMaterial.opacity = lerp(scanFrom.outline, scanTo.outline, t);
    groundGlowMaterial.opacity = lerp(scanFrom.glow, scanTo.glow, t);
    bracketMaterial.opacity = lerp(scanFrom.bracket, scanTo.bracket, t);
    const bracketScale = lerp(scanFrom.bracketScale, scanTo.bracketScale, t);
    for (const bracket of brackets) {
      const signs = bracketSigns.get(bracket)!;
      bracket.scale.set(signs.x * bracketScale, signs.y * bracketScale, 1);
    }
  }

  // Stage 4 — starts (or redirects) the reveal toward `next`. Reduced
  // motion snaps straight to the final state with no animated frames at
  // all, per the brief's own requirement — the same "instant, never
  // stuck mid-transition" treatment interaction.ts's own camera tween
  // already gives its reduced-motion case, applied here to this
  // separate, purely decorative reveal.
  function startScan(next: "idle" | "hover" | "focus"): void {
    if (prefersReducedMotion()) {
      scanSourceState = next;
      scanTargetState = next;
      scanTo = SCAN_LEVELS[next];
      scanFrom = scanTo;
      scanProgress = 1;
      applyScanLook(1);
      return;
    }
    // Redirecting mid-animation (e.g. hover→focus, or focus→idle while
    // still partway through an in-progress hover-in) restarts from
    // wherever the CURRENT interpolated visual actually is, not from
    // scratch — otherwise a quick hover-then-click would visibly snap
    // backward for an instant before re-animating forward, which would
    // read as a glitch rather than one continuous reveal.
    const eased = easeInOutCubic(scanProgress);
    scanFrom = {
      outline: lerp(scanFrom.outline, scanTo.outline, eased),
      glow: lerp(scanFrom.glow, scanTo.glow, eased),
      bracket: lerp(scanFrom.bracket, scanTo.bracket, eased),
      bracketScale: lerp(scanFrom.bracketScale, scanTo.bracketScale, eased),
    };
    scanSourceState = scanTargetState;
    scanTargetState = next;
    scanTo = SCAN_LEVELS[next];
    scanProgress = 0;
    scanLastElapsed = null;
  }

  // Stage 4 — advances the in-flight scan toward scanTo, called every
  // frame from update() (see its own note on why this uses real
  // elapsedSeconds rather than the phase-shifted `t`). A no-op once
  // scanProgress reaches 1 — this isn't a continuous ambient animation,
  // it's a one-shot reveal per state change, matching interaction.ts's
  // own one-shot (not looping) camera tween.
  function updateScan(elapsedSeconds: number): void {
    if (scanProgress >= 1) {
      scanLastElapsed = elapsedSeconds;
      return;
    }
    // Any transition into or out of focus uses the slower HUD timing
    // (coordinated with interaction.ts's 480ms camera tween); a plain
    // idle<->hover transition (focus not involved on either side) uses
    // the much quicker hover timing per the brief's "hover must feel
    // fast, never laggy" requirement.
    const duration =
      scanSourceState === "focus" || scanTargetState === "focus" ? HUD_SCAN_SECONDS : HOVER_SCAN_SECONDS;
    const delta = scanLastElapsed === null ? 0 : elapsedSeconds - scanLastElapsed;
    scanLastElapsed = elapsedSeconds;
    scanProgress = Math.min(scanProgress + delta / duration, 1);
    applyScanLook(easeInOutCubic(scanProgress));
  }

  function setHovered(next: boolean): void {
    hovered = next;
    startScan(focused ? "focus" : hovered ? "hover" : "idle");
  }

  function setFocused(next: boolean): void {
    focused = next;
    startScan(focused ? "focus" : hovered ? "hover" : "idle");
  }

  function update(elapsedSeconds: number): void {
    // Stage 4 — `t` is elapsedSeconds shifted by this machine's own
    // deterministic phase (see phase.ts) and is what every periodic
    // animation below reads instead of raw elapsedSeconds, so two
    // in-use machines no longer spin/blink/jitter in exact lockstep.
    const t = elapsedSeconds + phase;

    if (group.userData.spinning) {
      // One full rotation per ~2.4s — fast enough to read as "actively
      // washing," slow enough that the tumble detail doesn't blur into
      // a smear at a diorama's typical screen size.
      drum.rotation.z = t * 2.6;
    }

    // Stage 2 — status LED: blink (in-use/out-of-order, a clean on/off
    // pulse at the status's own rate) or flicker (unknown, an irregular
    // low-confidence shimmer built from two mismatched sine waves rather
    // than a regular pulse, so it reads as "uncertain," not "broken").
    let ledIntensity = currentLook.ledBaseIntensity;
    if (currentLook.ledBlinkHz > 0) {
      const blinkPhase = Math.sin(t * currentLook.ledBlinkHz * Math.PI * 2);
      ledIntensity = currentLook.ledBaseIntensity * (blinkPhase > 0 ? 1 : 0.15);
    } else if (currentLook.ledFlicker) {
      const flicker =
        0.5 +
        0.3 * Math.sin(t * 3.1) +
        0.2 * Math.sin(t * 7.7 + 1.3);
      ledIntensity = currentLook.ledBaseIntensity * Math.max(0.1, flicker);
    }
    ledMaterial.emissiveIntensity = ledIntensity;

    // Stage 2 — in-use jitter: a faint, high-frequency tremor on the
    // `shake` group (a pure local offset, see its definition above —
    // never touches `group.position`, which scene.ts owns) while
    // actively working. Not a cartoon shake, just enough that an in-use
    // machine reads as having real mechanical motion even where the
    // viewer isn't looking directly at the spinning drum.
    if (currentLook.jitter) {
      shake.position.x = Math.sin(t * 28) * 0.004;
      shake.position.z = Math.cos(t * 31) * 0.003;
    } else if (shake.position.x !== 0 || shake.position.z !== 0) {
      shake.position.set(0, 0, 0);
    }

    // Stage 2 — focus bracket pulse: a slow, restrained breathing
    // opacity on top of the fixed FOCUS_OUTLINE_OPACITY base, so a
    // focused machine reads as "actively being inspected," not just
    // statically highlighted. Deliberately subtle (not setHovered/
    // setFocused's job to animate — those set the *base* level; this
    // layers a small oscillation on top each frame). Stage 4: only once
    // the scan-in reveal (below) has finished — see scanProgress's own
    // note on why this guard exists.
    if (focused && scanProgress >= 1) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
      bracketMaterial.opacity = 0.9 * pulse;
    }

    // Stage 4 — advances the hover/focus "scan" reveal (see
    // refreshInteractionLook's own note). Uses real elapsedSeconds, not
    // the phase-shifted `t` above — this is a one-shot UI reveal tied to
    // a user action, not an ambient per-machine animation, so it must
    // not be offset by this machine's own phase.
    updateScan(elapsedSeconds);
  }

  function getHudAnchorWorld(target: THREE.Vector3): THREE.Vector3 {
    target.copy(HUD_ANCHOR_LOCAL);
    group.localToWorld(target);
    return target;
  }

  // Stage 2.2 — a real THREE.Box3 computed from the actual meshes that
  // make up the focused visual silhouette: the hitbox (exact body
  // bounds), the legs (extend below the body), and the brackets (extend
  // outside the body on every side). Deliberately NOT the whole `group`
  // or `shake` — those also contain the outline, ground glow, and
  // hazard stripe, which are either larger than the real silhouette
  // (outline, ground glow) or would wrongly inflate the box while
  // invisible (Box3.expandByObject(), like the raycaster, does not
  // check .visible — confirmed by reading Three.js's own source, not
  // assumed). Returns 8 corners (not just the Box3 itself) so
  // camera-fit.ts's fitBoundsToFrame() can treat it the same way it
  // treats room bounds — one shared code path for both.
  const focusedExtentBox = new THREE.Box3();
  function getFocusedExtentWorld(): THREE.Vector3[] {
    // Box3.expandByObject() (like Three.js's raycaster) only updates
    // the object's OWN world matrix, not its ancestors' — if this runs
    // before the scene's first render (matrixWorldAutoUpdate normally
    // keeps these current every frame, but there's no guarantee a
    // render has happened yet when this is first called), group's
    // parent chain could still hold stale/identity matrices. Force a
    // full, eager update through the whole chain first so this is
    // correct regardless of when it's called, not just when it happens
    // to run after a render.
    group.updateMatrixWorld(true);
    focusedExtentBox.makeEmpty();
    focusedExtentBox.expandByObject(hitbox);
    for (const leg of legs) focusedExtentBox.expandByObject(leg);
    for (const bracket of brackets) focusedExtentBox.expandByObject(bracket);
    const corners: THREE.Vector3[] = [];
    for (const x of [focusedExtentBox.min.x, focusedExtentBox.max.x]) {
      for (const y of [focusedExtentBox.min.y, focusedExtentBox.max.y]) {
        for (const z of [focusedExtentBox.min.z, focusedExtentBox.max.z]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    return corners;
  }

  return {
    group,
    hitbox,
    update,
    setStatus,
    setHovered,
    setFocused,
    getHudAnchorWorld,
    getFocusedExtentWorld,
  };
}
