// Duplicated from src/pages/index.astro's inline confirmedLabel()/
// remainingLabel() — deliberately not imported. Both need the viewer's
// current clock so they can't be shared directly across the two script
// contexts anyway, and duplicating here means Stage 2's hall-view code
// never needs to touch the existing, already-tested dashboard script —
// see the Stage 2 plan's "how this can't regress existing tests" point.
export function confirmedLabel(confirmedAt: number | null): string {
  if (confirmedAt === null) return "never reported";
  const minutes = Math.round((Date.now() - confirmedAt) / 60_000);
  if (minutes < 1) return "confirmed just now";
  return `confirmed ${minutes} min ago`;
}

export function remainingLabel(expectedEndAt: number | null): { text: string; known: boolean } {
  if (expectedEndAt === null) return { text: "remaining time unknown", known: false };
  const minutes = Math.round((expectedEndAt - Date.now()) / 60_000);
  return minutes > 0
    ? { text: `${minutes} min left`, known: true }
    : { text: "should be finishing", known: true };
}
