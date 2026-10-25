// Low-poly resident figures for Otter Room. Deliberately its own small
// module, not a change to aa-room-figures.ts: that file is AA Room's
// stable, already-verified figure builder (its own pose set, its own
// per-activity animation loops), and Otter Room's figures need neither —
// a quiet study room has exactly one thing worth animating (a faint idle
// sway, same restrained treatment AA Room's own figures use), not a
// pool-cue/paddle-swing repertoire. Reusing the SAME crude-but-readable
// technique (box body, sphere head, no rig) rather than the same file
// keeps this facility's figures independently simple to read and change,
// the same "second room template, not a different visual system" relationship
// src/lib/hall-view/aa-room.ts already has with room.ts.
import * as THREE from "three";
import type { OtterRoomFigurePose } from "./otter-room-status-look.ts";
import { phaseOffsetFor } from "./phase.ts";

export interface OtterRoomFigureHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives the figure's own idle sway. Skipped entirely under reduced motion (caller's responsibility), same convention as aa-room-figures.ts's own update(). */
  update(elapsedSeconds: number): void;
  setDesaturate(amount: number): void;
}

// Same deliberately few, muted tones as aa-room-figures.ts — these are
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
 * Builds one figure at the given local position/pose, facing +Z toward
 * the room's open front unless `facing` overrides it. `seed` only picks a
 * stable body color and idle-phase offset — never anything that affects
 * behavior, same determinism reasoning as aa-room-figures.ts's own
 * buildFigure(). "desk" is a seated, head-down pose (studying); "standing"
 * is an upright pose (a second person in a small group).
 */
export function buildOtterRoomFigure(
  seed: string,
  pose: OtterRoomFigurePose,
  position: THREE.Vector3,
  facingY = 0,
): OtterRoomFigureHandle {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = facingY;

  const bodyColor = pickColor(seed);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.75 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: HEAD_COLOR, roughness: 0.6 });

  const seated = pose === "desk";
  const torsoHeight = seated ? 0.32 : 0.55;
  const torsoY = seated ? 0.28 : 0.42;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, torsoHeight, 0.18), bodyMaterial);
  torso.position.set(0, torsoY, 0);
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), headMaterial);
  // "desk" tilts the head slightly forward/down — reads as "looking at the
  // table/a book," the one concrete signal that distinguishes "studying"
  // from merely "sitting," without needing a separate animated prop.
  head.position.set(0, torsoY + torsoHeight / 2 + 0.11, seated ? 0.015 : 0);
  if (seated) head.rotation.x = 0.22;
  head.castShadow = true;
  group.add(head);

  const armMaterial = bodyMaterial;
  for (const sideX of [-0.14, 0.14]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), armMaterial);
    arm.position.set(sideX, torsoY + torsoHeight / 2 - (seated ? 0.1 : 0.18), seated ? 0.08 : 0);
    if (seated) arm.rotation.x = -0.6; // forearms resting forward, toward a desk
    arm.castShadow = true;
    group.add(arm);
  }

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
  const idleAmplitude = seated ? 0.012 : 0.02;

  function update(elapsedSeconds: number): void {
    const t = elapsedSeconds + phase;
    // A slow, restrained idle sway — the one and only motion this room's
    // figures need: a quiet study room has nothing like AA Room's
    // pool-cue/paddle activity loops to animate.
    group.rotation.z = Math.sin(t * 0.5) * idleAmplitude;
    head.rotation.y = Math.sin(t * 0.3) * 0.06;
  }

  function setDesaturate(amount: number): void {
    const grey = 0x9c8d76; // --ink-muted, same desaturation target color-sense machine-mesh.ts/aa-room-figures.ts use
    bodyMaterial.color.set(bodyColor).lerp(new THREE.Color(grey), amount);
    headMaterial.color.set(HEAD_COLOR).lerp(new THREE.Color(grey), amount);
  }

  return { group, update, setDesaturate };
}
