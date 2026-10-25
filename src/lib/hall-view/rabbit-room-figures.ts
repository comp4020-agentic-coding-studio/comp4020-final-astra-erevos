// Low-poly resident figures for Rabbit Room. Deliberately its own small
// module, not a change to otter-room-figures.ts/aa-room-figures.ts: those
// are each other facility's own stable, already-verified figure builders,
// and Rabbit Room's figures need a pose neither of them has — see the
// note below on why "seated" here is NOT otter-room-figures.ts's "desk"
// pose. Reuses the SAME crude-but-readable technique (box body, sphere
// head, no rig) as every other facility's figures.
//
// DELIBERATELY NEUTRAL POSE, per notes/adr/0005-rabbit-room-live-state.md:
// this room has no activity field, because distinguishing group study
// from a shared meal has no decision-relevant value to a resident
// checking the app. A figure built here must therefore read as "someone
// is present," not "someone is reading" or "someone is eating" — no head
// tilted down over a book (otter-room-figures.ts's "desk" pose does this
// deliberately, which is exactly why that pose is NOT reused here), no
// hand-to-mouth gesture, no utensil or book prop. "seated" sits upright
// with forearms resting flat on the table — a pose equally plausible as
// "pausing mid-conversation while studying" or "sitting down to a meal,"
// which is the point.
import * as THREE from "three";
import type { RabbitRoomFigurePose } from "./rabbit-room-status-look.ts";
import { phaseOffsetFor } from "./phase.ts";

export interface RabbitRoomFigureHandle {
  group: THREE.Group;
  /** Every frame, elapsed seconds — drives the figure's own idle sway. Skipped entirely under reduced motion (caller's responsibility), same convention as every other facility's figures. */
  update(elapsedSeconds: number): void;
  setDesaturate(amount: number): void;
}

// Same deliberately few, muted tones as every other facility's figures —
// these are background figures establishing "the room is in use," not
// individually designed characters.
const BODY_COLORS = [0x6b5c47, 0x3987e5, 0xc1652f, 0x5aae68];
const HEAD_COLOR = 0xe8c9a0;

function pickColor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return BODY_COLORS[hash % BODY_COLORS.length]!;
}

/**
 * Builds one figure at the given local position/pose, facing +Z unless
 * `facingY` overrides it. `seed` only picks a stable body color and
 * idle-phase offset — never anything that affects behavior, same
 * determinism reasoning as every other facility's figure builder.
 * "seated" is an upright, neutral seated pose (head level, forearms
 * resting on the table — see the file's own top note on why this is
 * deliberately NOT a reading or eating pose); "standing" is an upright
 * standing pose, same as every other facility's own "standing."
 */
export function buildRabbitRoomFigure(
  seed: string,
  pose: RabbitRoomFigurePose,
  position: THREE.Vector3,
  facingY = 0,
): RabbitRoomFigureHandle {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = facingY;

  const bodyColor = pickColor(seed);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.75 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: HEAD_COLOR, roughness: 0.6 });

  const seated = pose === "seated";
  const torsoHeight = seated ? 0.32 : 0.55;
  const torsoY = seated ? 0.28 : 0.42;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, torsoHeight, 0.18), bodyMaterial);
  torso.position.set(0, torsoY, 0);
  torso.castShadow = true;
  group.add(torso);

  // Head level, no forward/down tilt — unlike otter-room-figures.ts's
  // "desk" pose, which deliberately tilts down to read as "looking at a
  // book." Kept neutral here on purpose (see the file's own top note).
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), headMaterial);
  head.position.set(0, torsoY + torsoHeight / 2 + 0.11, 0);
  head.castShadow = true;
  group.add(head);

  const armMaterial = bodyMaterial;
  for (const sideX of [-0.14, 0.14]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), armMaterial);
    // Seated: forearms rest forward and slightly down, toward the table —
    // a neutral "hands on the table" pose, not a book-reading or
    // utensil-holding gesture. Standing: arms hang naturally at the side.
    arm.position.set(sideX, torsoY + torsoHeight / 2 - (seated ? 0.1 : 0.18), seated ? 0.08 : 0);
    if (seated) arm.rotation.x = -0.5;
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
    // A slow, restrained idle sway — the one and only motion these
    // figures need, same "ambient presence, not an activity loop"
    // restraint every other facility's own figures use.
    group.rotation.z = Math.sin(t * 0.5) * idleAmplitude;
    head.rotation.y = Math.sin(t * 0.3) * 0.06;
  }

  function setDesaturate(amount: number): void {
    const grey = 0x9c8d76; // --ink-muted, same desaturation target color-sense every other facility's figures use
    bodyMaterial.color.set(bodyColor).lerp(new THREE.Color(grey), amount);
    headMaterial.color.set(HEAD_COLOR).lerp(new THREE.Color(grey), amount);
  }

  return { group, update, setDesaturate };
}
