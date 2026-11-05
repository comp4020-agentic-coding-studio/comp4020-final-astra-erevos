// Low-poly resident figures for Rat Room. Deliberately its own small
// module, not a change to badger-room-figures.ts/weasel-room-figures.ts/
// rabbit-room-figures.ts/otter-room-figures.ts/aa-room-figures.ts: those
// are each other facility's own stable, already-verified figure
// builders. Reuses the SAME crude-but-readable technique (box body,
// sphere head, no rig) as every other facility's figures.
//
// SEATED ONLY, per the Design correction in
// notes/adr/0008-rat-room-live-state.md ("Design correction, v3"): every
// Rat Room figure is now placed at a SPECIFIC occupied seat's own real
// workstation (rat-room.ts's SEAT_WORKSTATIONS map), so there is no more
// "standing nearby" filler figure — a seat is either occupied (one
// seated figure, at its own chair) or not (no figure at all). A figure
// built here must still read as "someone is studying or using a
// computer," not "this is a typing animation" — no screen content
// implied, no typing animation that would suggest an active monitor, no
// books/papers/headphones. Seated sits upright at a generic desk-height
// pose with forearms resting forward, the same kind of genuinely neutral
// "just sitting" pose every other facility's own "seated" figure uses.
import * as THREE from "three";
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
 * Builds one seated figure at the given local position, facing +Z unless
 * `facingY` overrides it. `seed` only picks a stable body color and
 * idle-phase offset — never anything that affects behavior, same
 * determinism reasoning as every other facility's figure builder. An
 * upright, neutral seated pose (head level, forearms resting forward —
 * see the file's own top note on why this is deliberately not a
 * typing/reading pose).
 */
export function buildRatRoomFigure(seed: string, position: THREE.Vector3, facingY = 0): RatRoomFigureHandle {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = facingY;

  const bodyColor = pickColor(seed);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.75 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: HEAD_COLOR, roughness: 0.6 });

  const torsoHeight = 0.32;
  // torsoY is the BOX'S OWN CENTER, not an arbitrary sit height — it
  // must sit torsoHeight/2 ABOVE the room's own chair seat surface
  // (rat-room.ts's own workstation chair build: a 0.05-tall seat centered
  // at y=0.26, so its top face is at 0.285), so the torso's own bottom
  // face lands flush on the seat rather than through it. Same fix, same
  // root cause, as weasel-room-figures.ts's own seated pose (see
  // notes/adr/0006-weasel-room-live-state.md, "Design correction, v2") —
  // every facility sharing this chair geometry had the same bug.
  const CHAIR_SEAT_TOP = 0.285;
  const torsoY = CHAIR_SEAT_TOP + torsoHeight / 2;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.26, torsoHeight, 0.18), bodyMaterial);
  torso.position.set(0, torsoY, 0);
  torso.castShadow = true;
  group.add(torso);

  // Head level, no forward/down tilt — a tilted-down head would read as
  // "looking at a screen/keyboard," which this room's figures must never
  // imply (see the file's own top note).
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), headMaterial);
  head.position.set(0, torsoY + torsoHeight / 2 + 0.11, 0);
  head.castShadow = true;
  group.add(head);

  const armMaterial = bodyMaterial;
  for (const sideX of [-0.14, 0.14]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), armMaterial);
    // Forearms rest forward and slightly down — a neutral "hands
    // resting" pose, not a typing gesture (no raised wrists at keyboard
    // height, no implied active monitor).
    arm.position.set(sideX, torsoY + torsoHeight / 2 - 0.1, 0.08);
    arm.rotation.x = -0.5;
    arm.castShadow = true;
    group.add(arm);
  }

  const phase = phaseOffsetFor(seed);
  const idleAmplitude = 0.012;

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
