// AA Room's freshness model — see notes/adr/0003-aa-room-live-state.md,
// Decision 3. Unlike Laundry's machines, AA Room has no objective
// end-time signal at all (nobody can read an "end time" off a common-room
// hangout the way a washer's display gives one off a wash cycle), so
// freshness here is pure elapsed-time-since-confirmation, computed fresh
// on every read rather than stored.
//
// PROVISIONAL — see CLAUDE.md ("do not invent decay/staleness
// thresholds") and the ADR: these two numbers are a starting point with
// no real AA Room usage data behind them yet, the same discipline as
// UNTIMED_IN_USE_DECAY_MS in src/lib/aa-room.ts. Must be revisited once
// real reports accumulate.
export const AA_ROOM_FRESH_MS = 15 * 60 * 1000; // 15 minutes
export const AA_ROOM_EXPIRE_MS = 45 * 60 * 1000; // 45 minutes

export type Freshness = "fresh" | "stale" | null;

// Pure, independent of the system clock — now is a parameter, never read
// internally (no Date.now() call in this module at all) — specifically so
// both this logic and its tests can use constructed timestamps instead of
// waiting out real elapsed time. Mirrors how confirmedLabel()/
// remainingLabel() in src/pages/index.astro are already pure functions of
// (timestamp, now), not stateful, and is the same now-injection shape
// src/lib/aa-room.ts's decay helpers use for the same reason.
//
// null means "there is currently no fresh-enough observation to grade" —
// either occupancy is already "unknown" (seed state, or a prior decay),
// or there has simply never been a confirmation (confirmedAt is null,
// which only coincides with occupancy "unknown" in practice, but both
// are checked explicitly rather than assumed to imply each other).
// Forcing "fresh" or "stale" onto either case would be inventing a
// judgment about an observation that doesn't exist.
export function computeFreshness(
  occupancy: "empty" | "occupied" | "unknown",
  confirmedAt: number | null,
  now: number,
): Freshness {
  if (occupancy === "unknown" || confirmedAt === null) return null;
  const ageMs = now - confirmedAt;
  if (ageMs < AA_ROOM_FRESH_MS) return "fresh";
  if (ageMs < AA_ROOM_EXPIRE_MS) return "stale";
  // Past the expire threshold: on stored state this should already have
  // been decayed to "unknown" by the time anything calls this (decay and
  // freshness are evaluated together in getAaRoom() — see aa-room.ts),
  // but this function stays correct on its own terms even if called
  // against a not-yet-decayed row: past the window, there is no fresh
  // observation left to grade, same as the null cases above.
  return null;
}
