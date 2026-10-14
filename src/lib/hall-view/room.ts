// Builds one laundry room's static geometry — floor, back wall, two low
// side walls, and a couple of non-interactive "lived-in" props. No
// status logic lives here; this is pure set-dressing, built once.
//
// Stage 2.2 — this no longer computes a hand-placed "focus camera" pose
// per machine (the earlier MachineFocusCamera/frontalFocusCamera, tuned
// by rendering and nudging a lookAt offset until it looked right for
// one viewport). Framing for both the overview and the per-machine
// focus shot is now computed generically by camera-fit.ts from real
// world-space bounds — this module's job is only to report which
// objects make up "the room" for that bounds computation (via
// boundsObjects below), plus where machines are placed.
import * as THREE from "three";

export interface RoomHandle {
  group: THREE.Group;
  /** Where a machine should be placed, in local room space, for a 2-machine room. */
  machineSlots: THREE.Vector3[];
}

const floorGeometry = new THREE.PlaneGeometry(4.6, 3.2);
const backWallGeometry = new THREE.PlaneGeometry(4.6, 2.2);
const sideWallGeometry = new THREE.PlaneGeometry(3.2, 2.2);

/**
 * @param mirror Stage 3 — flips the three ambient props (clock, basket,
 * plant) left-to-right. Purely cosmetic: floor/walls/trim/machineSlots
 * are identical either way, so a room built with mirror=true is still
 * the same template, not a redesign — this just keeps five rooms in one
 * scene from reading as the exact same prop photo copy-pasted five times.
 */
export function buildRoom(mirror: boolean = false): RoomHandle {
  const group = new THREE.Group();
  group.name = "room";
  const sign = mirror ? -1 : 1;

  // Floor: warm wood-plank color from the existing CSS palette
  // (--surface-alt), a faint vertex-colored plank pattern rather than a
  // texture file — keeps this dependency-free and on-brand.
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Plank lines: thin dark strips laid flush on the floor, cheap and
  // reads immediately as "wood floor" rather than "flat colored plane."
  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xb8a380, roughness: 0.85 });
  for (let i = -2; i <= 2; i++) {
    const plank = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.02), plankMaterial);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(0, 0.001, i * 0.6);
    group.add(plank);
  }

  // Back and side walls — low-poly "cutaway dollhouse" framing: open
  // front, no roof, so the camera looks *into* the room rather than at
  // a sealed box. Warm cream from the existing --page/--surface palette.
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf6efe1, roughness: 0.9 });

  const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
  backWall.position.set(0, 1.1, -1.6);
  backWall.receiveShadow = true;
  group.add(backWall);

  const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-2.3, 1.1, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(2.3, 1.1, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);

  // A baseboard trim strip along the back wall — a small detail that
  // breaks up the flat wall-meets-floor seam, the kind of thing that
  // separates "crafted diorama" from "two planes touching at 90°."
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.6 });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 0.04), trimMaterial);
  trim.position.set(0, 0.05, -1.58);
  group.add(trim);

  // Ambient prop 1: a small wall clock on the back wall — "a room
  // someone actually uses," and a nod to confirmed_at/freshness being
  // part of this app's whole concept.
  const clockFaceMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf1, roughness: 0.4 });
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), clockFaceMaterial);
  clockFace.position.set(-1.6 * sign, 1.7, -1.57);
  group.add(clockFace);
  const clockRimMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2115, roughness: 0.5 });
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 20), clockRimMaterial);
  clockRim.position.set(-1.6 * sign, 1.7, -1.57);
  group.add(clockRim);
  const clockHand = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.12, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x2c2115 }),
  );
  clockHand.position.set(-1.6 * sign, 1.74, -1.56);
  clockHand.rotation.z = Math.PI / 5;
  group.add(clockHand);

  // Ambient prop 2: a small laundry basket in the back corner — warm,
  // low-poly, non-interactive, pure "lived-in" signal.
  const basketMaterial = new THREE.MeshStandardMaterial({ color: 0xc1652f, roughness: 0.7 });
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.34, 10), basketMaterial);
  basket.position.set(1.7 * sign, 0.17, -1.2);
  basket.castShadow = true;
  basket.receiveShadow = true;
  group.add(basket);
  const linenMaterial = new THREE.MeshStandardMaterial({ color: 0xf6ecd9, roughness: 0.9 });
  const linen = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), linenMaterial);
  linen.position.set(1.7 * sign, 0.36, -1.2);
  linen.scale.set(1, 0.6, 1);
  linen.castShadow = true;
  group.add(linen);

  // Ambient prop 3: a small potted plant — matches the warm green
  // --accent already in the app's palette.
  const potMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.18, 10), potMaterial);
  pot.position.set(-1.9 * sign, 0.09, 1.3);
  pot.castShadow = true;
  group.add(pot);
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6b3f, roughness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 6), leafMaterial);
    leaf.position.set(
      -1.9 * sign + Math.cos((i * Math.PI * 2) / 3) * 0.05,
      0.36,
      1.3 + Math.sin((i * Math.PI * 2) / 3) * 0.05,
    );
    leaf.rotation.z = (Math.random() - 0.5) * 0.3;
    leaf.castShadow = true;
    group.add(leaf);
  }

  // Two machine slots, side by side, facing the open front — the
  // washer/dryer pair a resident would actually see walking in. Every
  // machine faces local/world +Z (nothing here ever sets a rotation.y),
  // which is what lets camera-fit.ts's frontal view direction
  // (interaction.ts) be the same fixed vector for every machine in this
  // room, needing no per-slot adjustment.
  const machineSlots = [new THREE.Vector3(-0.85, 0.7, 0.2), new THREE.Vector3(0.85, 0.7, 0.2)];

  return { group, machineSlots };
}
