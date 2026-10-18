// Stage 4 — low-poly resident figures for AA Room. Kept separate from
// aa-room.ts's furniture/room-building code, the same split machine-mesh.ts
// keeps from room.ts: furniture is static set-dressing, figures are the
// one thing with per-instance pose and continuous animation.
//
// Deliberately crude/blocky (box body, sphere head, no rig) — matches the
// room's own low-poly furniture language, and keeps the per-figure cost
// low enough that "event"'s four figures is still cheap to animate every
// frame alongside the furniture loops.
import * as THREE from "three";
import type { FigurePose } from "./aa-room-status-look.ts";
import { phaseOffsetFor } from "./phase.ts";

export interface FigureHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives the figure's own idle sway. Skipped entirely under reduced motion (caller's responsibility, same as machine-mesh.ts's own update()). */
  update(elapsedSeconds: number): void;
  setDesaturate(amount: number): void;
}

// Skin/clothing tones kept deliberately few and muted — these are
// background figures establishing "the room is in use," not individually
// designed characters.
const BODY_COLORS = [0x6b5c47, 0x3987e5, 0xc1652f, 0x5aae68];
const HEAD_COLOR = 0xe8c9a0;

function pickColor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return BODY_COLORS[hash % BODY_COLORS.length]!;
}

/**
 * Builds one figure at the given local position/pose, facing +Z (toward
 * the room's open front) unless `facing` overrides it. `seed` only picks
 * a stable body color and idle-phase offset (same determinism reasoning
 * as phase.ts: a figure shouldn't re-roll its look/phase on every
 * re-render of the same pose) — never anything that affects behavior.
 */
export function buildFigure(seed: string, pose: FigurePose, position: THREE.Vector3, facingY = 0): FigureHandle {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = facingY;

  const bodyColor = pickColor(seed);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.75 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: HEAD_COLOR, roughness: 0.6 });

  // Seated vs. standing changes proportions, not rig — no shared
  // skeleton, just two different fixed low-poly builds, matching the
  // "crude but readable" brief. "hangout" (chatting/sitting/reading/
  // resting) is seated, same proportions as "sofa" — it's the same kind
  // of casual presence, just placed at its own slots (see aa-room.ts)
  // rather than sharing "tv"'s, now that both can be true at once.
  const seated = pose === "sofa" || pose === "tv" || pose === "hangout";
  const torsoHeight = seated ? 0.32 : 0.55;
  const torsoY = seated ? 0.28 : 0.42;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, torsoHeight, 0.18), bodyMaterial);
  torso.position.set(0, torsoY, 0);
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), headMaterial);
  head.position.set(0, torsoY + torsoHeight / 2 + 0.11, 0);
  head.castShadow = true;
  group.add(head);

  // Arms as two thin boxes — a pivot child for the one that animates
  // (pool cue swing, paddle motion), the other static, so only the limb
  // that's actually supposed to move carries rotation.
  const armMaterial = bodyMaterial;
  const primaryArmPivot = new THREE.Group();
  primaryArmPivot.position.set(0.14, torsoY + torsoHeight / 2 - 0.05, 0);
  const primaryArm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), armMaterial);
  primaryArm.position.set(0, -0.13, 0);
  primaryArm.castShadow = true;
  primaryArmPivot.add(primaryArm);
  group.add(primaryArmPivot);

  const secondaryArm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), armMaterial);
  secondaryArm.position.set(-0.14, torsoY + torsoHeight / 2 - 0.18, 0);
  secondaryArm.castShadow = true;
  group.add(secondaryArm);

  if (!seated) {
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.8 });
    for (const sideX of [-0.08, 0.08]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), legMaterial);
      leg.position.set(sideX, 0.2, 0);
      leg.castShadow = true;
      group.add(leg);
    }
  }

  const phase = phaseOffsetFor(seed);
  const idleAmplitude = seated ? 0.015 : 0.02;

  function update(elapsedSeconds: number): void {
    const t = elapsedSeconds + phase;
    // A slow, restrained idle sway — never a loop energetic enough to
    // read as "dancing" or distract from the furniture-specific
    // animation (pool cue/paddle), which is the actual activity signal.
    group.rotation.z = Math.sin(t * 0.6) * idleAmplitude;
    head.rotation.y = Math.sin(t * 0.35) * 0.08;

    if (pose === "pool") {
      // A slow, restrained back-and-forth cue stroke — continuous, not a
      // one-shot, so the scene reads "playing pool right now" at any
      // moment, not only in the instant the state first changed.
      primaryArmPivot.rotation.x = Math.sin(t * 0.9) * 0.25 - 0.15;
    } else if (pose === "table-tennis") {
      primaryArmPivot.rotation.x = Math.sin(t * 2.1) * 0.35;
    } else {
      primaryArmPivot.rotation.x = Math.sin(t * 0.4) * 0.05; // faint idle, not a specific activity
    }
  }

  function setDesaturate(amount: number): void {
    const grey = 0x9c8d76; // --ink-muted, same desaturation target color-sense machine-mesh.ts's unknown look uses
    bodyMaterial.color.set(bodyColor).lerp(new THREE.Color(grey), amount);
    headMaterial.color.set(HEAD_COLOR).lerp(new THREE.Color(grey), amount);
  }

  return { group, update, setDesaturate };
}
