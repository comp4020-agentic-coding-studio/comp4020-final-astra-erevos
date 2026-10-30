// Low-poly resident figures for Rat Room. Deliberately its own small
// module, not a change to badger-room-figures.ts/weasel-room-figures.ts/
// rabbit-room-figures.ts/otter-room-figures.ts/aa-room-figures.ts: those
// are each other facility's own stable, already-verified figure
// builders. Reuses the SAME crude-but-readable technique (box body,
// sphere head, no rig) as every other facility's figures.
//
// DELIBERATELY NEUTRAL, SEAT-AGNOSTIC POSE, per
// notes/adr/0008-rat-room-live-state.md: these figures represent "the
// room is in use" at the AGGREGATE level only — they are never placed at
// one of the ten real workstations built in rat-room.ts, and never
// implied to correspond to any specific A-J seat (there is no
// workstation-to-seat mapping anywhere in this app — see rat-room.ts's
// own top note). A figure built here must read as "someone is studying
// or using a computer," not "this specific workstation is occupied" —
// no screen content implied, no typing animation that would suggest an
// active monitor, no books/papers/headphones. "seated" sits upright at
// a generic desk-height pose with forearms resting forward, the same
// kind of genuinely neutral "just sitting" pose every other facility's
// own "seated" figure uses; "standing" is the same neutral standing pose
// every other facility's own figures use.
import * as THREE from "three";
import type { RatRoomFigurePose } from "./rat-room-status-look.ts";
import { phaseOffsetFor } from "./phase.ts";

export interface RatRoomFigureHandle {
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
 * resting forward — see the file's own top note on why this is
 * deliberately not a typing/reading pose); "standing" is an upright
 * standing pose, same as every other facility's own "standing."
 */
export function buildRatRoomFigure(
  seed: string,
  pose: RatRoomFigurePose,
  position: THREE.Vector3,
  facingY = 0,
): RatRoomFigureHandle {
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

  // Head level, no forward/down tilt — a tilted-down head would read as
  // "looking at a screen/keyboard," exactly the per-workstation mapping
  // this room's figures must never imply (see the file's own top note).
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), headMaterial);
  head.position.set(0, torsoY + torsoHeight / 2 + 0.11, 0);
  head.castShadow = true;
  group.add(head);

  const armMaterial = bodyMaterial;
  for (const sideX of [-0.14, 0.14]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), armMaterial);
    // Seated: forearms rest forward and slightly down — a neutral
    // "hands resting" pose, not a typing gesture (no raised wrists at
    // keyboard height, no implied active monitor). Standing: arms hang
    // naturally at the side.
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
