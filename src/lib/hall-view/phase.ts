// Stage 4 — a deterministic (not Math.random()) per-machine animation
// phase offset, derived from the machine's own id. Two different in-use
// machines today animate in exact lockstep (drum rotation, LED blink,
// jitter all driven by the same shared elapsedSeconds with no
// per-instance offset), which reads as two clones of one machine rather
// than two independent appliances. This offset breaks that lockstep
// while staying stable across a status refresh/remount — same id always
// yields the same offset — unlike Math.random(), which would re-roll a
// new phase (and a visible jump) every time a mesh is rebuilt.
//
// FNV-1a, a small well-known non-cryptographic string hash, chosen only
// for determinism and a reasonably even spread across ids like
// "ab-washer"/"c-dryer" — no cryptographic property is needed or implied.
function fnv1aHash(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A value in [0, 2*PI), stable for a given machine id — used as a phase
 * offset added inside any periodic animation (a rotation angle, a blink
 * sine's argument, a jitter sine's argument) so different machines
 * sharing the same status don't visibly move in exact lockstep. Purely
 * cosmetic: never read by status logic, never persisted, never affects
 * what a machine's status *is* — only how its existing animation looks.
 */
export function phaseOffsetFor(id: string): number {
  return ((fnv1aHash(id) % 100000) / 100000) * Math.PI * 2;
}
