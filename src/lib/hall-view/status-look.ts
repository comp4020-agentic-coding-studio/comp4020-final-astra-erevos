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
// new vocabulary invented for the 3D view.
import type { MachineStatus } from "../types.ts";

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
// as the same app, not a separately invented mood.
const STATUS_LOOKS: Record<MachineStatus, StatusLook> = {
  available: {
    bodyColor: 0xf6ecd9, // warm near-white, calm
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
  "in-use": {
    bodyColor: 0x3987e5, // --status-in-use
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

export function lookForStatus(status: MachineStatus): StatusLook {
  return STATUS_LOOKS[status];
}
