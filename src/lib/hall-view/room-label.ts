// Stage 3 fix (round 2) — a large block letter painted directly on each
// room's back wall, like real dorm room/block signage, so a resident can
// tell which of the five rooms is which at overview scale without
// hovering or clicking anything.
//
// Replaces an earlier floating white "BLOCK X" sprite-card, which read
// as a web UI tag hovering in front of the scene rather than something
// that belongs to the room. This version is a flat plane mounted flush
// against the back wall (same z-offset trick already used by the room's
// own trim strip/clock — see room.ts) with NORMAL depth testing, not an
// always-on-top overlay — like the existing wall clock, a machine
// standing in front of it in the isometric view correctly occludes part
// of the letter, because it IS part of the room's geometry, not a HUD
// layer floating above it.
//
// Deliberately NOT the cyan "cyber/HUD" accent used for hover/focus (see
// machine-mesh.ts's own note on why that accent stays confined to
// interaction feedback) — this is plain dark signage ink, lit the same
// way the room's other props (clock, trim) already are, so it reads as
// belonging to the room rather than as an interaction affordance.
import * as THREE from "three";

const CANVAS_SIZE = 512;
// Deep moss green, matching the app's existing --accent-strong brand
// color (src/pages/index.astro's CSS root) rather than the ink/black
// used by the room's other wall props — ties the signage to Toad
// Live's own palette instead of reading as generic black text. Not
// cyan/red/blue: those are reserved for the interaction accent and the
// machine status colors respectively (see this file's own top-of-file
// note), so this sits deliberately outside both.
const TEXT_COLOR = "#355b3a";
const TARGET_WIDTH_FRACTION = 0.86; // how much of the canvas's width the glyph should fill

function buildLetterTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const fontFamily = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
  const targetWidth = CANVAS_SIZE * TARGET_WIDTH_FRACTION;

  // Auto-fit: measure at a reference size, then scale linearly — simple
  // and exact for a single text run (no wrapping), unlike a binary-search
  // fit which would be needed for multi-line text. Needed because "A/B"
  // is much wider than "C" at the same font size — without this, either
  // "A/B" overflows the plane or every other letter renders tiny to
  // leave room for "A/B".
  const referenceSize = 200;
  ctx.font = `800 ${referenceSize}px ${fontFamily}`;
  const referenceWidth = ctx.measureText(text).width;
  const fontSize = Math.min(referenceSize * (targetWidth / referenceWidth), CANVAS_SIZE * 0.7);

  ctx.font = `800 ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, CANVAS_SIZE / 2, CANVAS_SIZE / 2 + fontSize * 0.04);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Builds one room's wall-mounted block letter, already positioned flush
 * against the room's own back wall (local space — position it, don't
 * re-derive it per caller). `text` is the bare location label, e.g.
 * "A/B" or "C" — no "BLOCK" prefix, no card/background, just the glyph.
 */
export function buildRoomLabel(text: string): THREE.Mesh {
  const texture = buildLetterTexture(text);
  // Plain MeshStandardMaterial, same family the room's other props
  // (clock face, trim, basket) already use — so this participates in the
  // scene's existing lighting/shadow the same way they do, rather than
  // being a separately-lit decal. roughness high (matte paint, not a
  // glossy sign) per "not a glowing HUD."
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 0.85,
    depthWrite: false, // avoids z-fighting with the wall plane directly behind it
  });
  const geometry = new THREE.PlaneGeometry(1.5, 1.5);
  const mesh = new THREE.Mesh(geometry, material);
  // Centered on the back wall's own width (x=0 — the existing wall clock
  // sits off to the side at x=-1.6, see room.ts, so this doesn't
  // collide with it), high on the wall so it clears the machines'
  // control panels/HUD brackets (which top out around world y≈1.7 at
  // the slot's own y=0.7 local base) while staying within the wall's
  // own 2.2 height — matching how the existing clock (y=1.7) is placed
  // high on this same wall. Flush against the wall's z=-1.6 plane,
  // nudged forward by the same small amount the existing trim
  // strip/clock already use to avoid z-fighting.
  mesh.position.set(0, 1.75, -1.59);
  return mesh;
}
