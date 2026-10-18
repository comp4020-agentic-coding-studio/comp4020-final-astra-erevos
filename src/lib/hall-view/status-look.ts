// Stage 1 — one room (A/B), two machines. See notes/adr/ for the full
// design discussion (not yet written as an ADR; this is a visual-layer
// addition, not a data-model decision). This module is pure: it maps a
// MachineStatus to the visual language the scene uses, with no Three.js
// or DOM dependency of its own, so the mapping itself is easy to read
// and change without touching scene-graph code.
//
// Every value here is a deliberate re-expression of the *same* semantics
// src/pages/index.astro's STATUS_META already encodes (available/
// out-of-order carry real severity; in-use is neutral-occupied, not a
// warning; unknown is an absence of information, not a color) — not a
// new vocabulary invented for the 3D view. This is a 3D-only visual
// palette: it never feeds back into STATUS_META, the dashboard badge
// colors, SSE payloads, or report logic — those are untouched and still
// define the real status semantics this module only re-renders.
//
// Stage 5 — available's look is now a clear, soft moss green rather than
// a warm near-white: at five-room overview scale (each room ~51% of its
// old standalone size — see hall-layout.ts), the near-white read too
// close to unknown's muted grey-tan to tell apart at a glance. Also,
// in-use is now looked up per MACHINE TYPE, not just per status — a
// washer in-use stays the existing blue (the water association was
// already right), while a dryer in-use gets its own warm amber/burnt-
// orange (a heat association), so overview reads as a fourth
// at-a-glance category (green/blue/amber/red/grey) instead of lumping
// both machine types' "working" state under one color. This is the one
// place this module takes `type` as an input — out-of-order/unknown
// looks are still the same regardless of machine type, since nothing
// about those two statuses is type-specific.
import type { MachineStatus, MachineType } from "../types.ts";

export interface StatusLook {
  /** Body material base color (hex, matches the existing CSS custom properties' hue family). */
  bodyColor: number;
  /** Porthole/drum material color. */
  drumColor: number;
  /** Emissive glow on the drum — 0 for no glow. */
  drumEmissive: number;
  drumEmissiveIntensity: number;
  /** Material roughness — lower reads as "glossier/more alert," higher as "flatter/duller." */
  roughness: number;
  /** 0–1 desaturation applied on top of the base colors (unknown pulls toward grey). */
  desaturate: number;
  /** Whether the drum mesh should be spinning. */
  spinning: boolean;
  /** Whether the hazard-stripe band should be visible on the body. */
  hazard: boolean;
  /** Status LED color (hex) — the one always-visible "is this thing alive" signal. */
  ledColor: number;
  /** LED's steady (non-blinking) emissive intensity. */
  ledBaseIntensity: number;
  /** LED blink rate in Hz — 0 means solid, no blink. */
  ledBlinkHz: number;
  /** Stage 2: irregular, uncertain dimmer flicker instead of a clean blink — unknown only. */
  ledFlicker: boolean;
  /** Stage 2: whether the whole body should show a faint in-use jitter — a working machine has motion, a stopped one doesn't. */
  jitter: boolean;
}

// Hex colors pulled from the same warm palette already defined in
// src/pages/index.astro's CSS custom properties (--status-good,
// --status-in-use, --status-critical, --ink-muted) so the 3D view reads
// as the same app, not a separately invented mood — except available's
// body/LED (see the Stage 5 note above) and in-use's dryer variant
// (there is no existing CSS token for "dryer heat," since the dashboard
// badge is intentionally type-agnostic — a new, 3D-only color).
const STATUS_LOOKS: Record<Exclude<MachineStatus, "in-use">, StatusLook> = {
  available: {
    bodyColor: 0x5aae68, // soft moss green — clearly distinct from unknown's grey-tan at overview scale
    drumColor: 0x2c2115,
    drumEmissive: 0x000000,
    drumEmissiveIntensity: 0,
    roughness: 0.35,
    desaturate: 0,
    spinning: false,
    hazard: false,
    ledColor: 0x3f6b3f, // --accent, calm steady green = ready
    ledBaseIntensity: 0.6,
    ledBlinkHz: 0,
    ledFlicker: false,
    jitter: false,
  },
  "out-of-order": {
    bodyColor: 0xd03b3b, // --status-critical
    drumColor: 0x2c2115,
    drumEmissive: 0x000000,
    drumEmissiveIntensity: 0,
    roughness: 0.6,
    desaturate: 0.15,
    spinning: false,
    hazard: true,
    ledColor: 0xd03b3b,
    ledBaseIntensity: 0.9,
    ledBlinkHz: 0.6, // slower than in-use's — reads as "alert," not "working"
    ledFlicker: false,
    jitter: false,
  },
  unknown: {
    bodyColor: 0x9c8d76, // --ink-muted
    drumColor: 0x6b5c47,
    drumEmissive: 0x000000,
    drumEmissiveIntensity: 0,
    roughness: 0.8,
    desaturate: 0.6,
    spinning: false,
    hazard: false,
    ledColor: 0x6b5c47,
    ledBaseIntensity: 0.25, // dim — "weaker, less sure" per the Stage 2 direction
    ledBlinkHz: 0,
    ledFlicker: true, // irregular, uncertain, rather than a clean confident blink
    jitter: false,
  },
};

// Stage 5 — in-use is the one status whose look now depends on machine
// type, not just status: a washer in-use keeps the original blue (the
// water association already fit), a dryer in-use gets a deliberately
// deep/burnt amber-orange, NOT a bright yellow-orange — chosen specifically
// to stay visually distinct from the out-of-order hazard-tape band's own
// yellow/black stripes (see machine-mesh.ts's buildHazardTexture), so a
// glance across the room never confuses "a dryer is running" with "a
// machine is taped off." Both share the same blink/jitter/spin shape;
// only the color values differ per type.
const IN_USE_LOOKS: Record<MachineType, StatusLook> = {
  washer: {
    bodyColor: 0x3987e5, // --status-in-use, unchanged — water association
    drumColor: 0x1a4a8a,
    drumEmissive: 0x3987e5,
    drumEmissiveIntensity: 0.35,
    roughness: 0.25,
    desaturate: 0,
    spinning: true,
    hazard: false,
    ledColor: 0x3987e5,
    ledBaseIntensity: 0.9,
    ledBlinkHz: 1.4, // a working machine's "active" blink — brisk, not alarming
    ledFlicker: false,
    jitter: true,
  },
  dryer: {
    bodyColor: 0xd9822b, // deep burnt-amber — heat association, deliberately darker than the hazard tape's yellow
    drumColor: 0x5c3312,
    drumEmissive: 0xd9822b,
    drumEmissiveIntensity: 0.35,
    roughness: 0.25,
    desaturate: 0,
    spinning: true,
    hazard: false,
    ledColor: 0xd9822b,
    ledBaseIntensity: 0.9,
    ledBlinkHz: 1.4,
    ledFlicker: false,
    jitter: true,
  },
};

export function lookForStatus(status: MachineStatus, type: MachineType): StatusLook {
  if (status === "in-use") return IN_USE_LOOKS[type];
  return STATUS_LOOKS[status];
}
