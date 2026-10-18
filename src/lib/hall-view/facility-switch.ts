// Stage 4 — coordinates which facility's 3D content is active, across
// the SEPARATE inline <script type="module"> blocks that each own one
// facility's mount logic (the generic facility-tab click handler, the
// Laundry mount script, the AA Room mount script — three distinct module
// scopes, invisible to each other, the exact same cross-script-scope
// problem src/lib/live-stream.ts already exists to solve for the page's
// one SSE connection). A facility's mount script registers what should
// happen when its own facility becomes the selected one — building its
// scene for the first time, or just re-activating an already-built one
// (see renderer-host.ts's activateFacility, a cheap canvas reparent, not
// a rebuild) — and the facility-tab script calls selectHallFacility() on
// every click, with no knowledge of what any one facility's callback
// actually does.
type Listener = () => void;

const listeners = new Map<string, Listener>();

/** Registers what should happen when `key` becomes the selected facility — called once at registration time isn't implied; this only fires on an actual selectHallFacility(key) call. A facility that's never selected (e.g. AA Room on a page load where Laundry is the default tab) never has this called, so its 3D content is never built until a resident actually switches to it. */
export function onFacilitySelected(key: string, fn: Listener): void {
  listeners.set(key, fn);
}

/** Called by the facility-tab click handler with whichever facility was just selected. A facility with no registered listener (every non-3D facility — Otter Room, etc., which are plain disabled buttons and never reach this at all) is simply a no-op. */
export function selectHallFacility(key: string): void {
  listeners.get(key)?.();
}
