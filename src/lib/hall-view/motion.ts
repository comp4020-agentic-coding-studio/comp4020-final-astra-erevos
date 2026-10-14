// Stage 4 — shared, cosmetic-only animation plumbing for the new hover/
// focus "scan" reveal (machine-mesh.ts) and the focus panel's fade/
// slide-in (overlay.ts). Deliberately kept separate from interaction.ts's
// own FOCUS_TWEEN_SECONDS/easeInOutCubic — the proven, numerically
// verified camera-tween code — rather than importing from or refactoring
// it: these are new, independent timings for a purely decorative reveal
// layered on top of a camera move that already works and must not be
// touched. If the two ever drift apart, HUD_SCAN_SECONDS below is the
// one to adjust to keep the HUD "scan" roughly matched to interaction.ts's
// 480ms camera tween.
export const HUD_SCAN_SECONDS = 0.48;
// "Much faster than focus" per the brief — quick enough that moving the
// pointer across several machines never feels laggy or sticky.
export const HOVER_SCAN_SECONDS = 0.15;

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// Duplicated from interaction.ts's own copy rather than imported — same
// reasoning as above: a one-line pure function, and duplicating it keeps
// this new code from adding any import-time coupling to the proven
// camera-tween module.
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
