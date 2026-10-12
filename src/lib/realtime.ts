import type { Machine } from "./types.ts";

// Crit 9's real-time transport: a single in-process subscriber list,
// correct because this app runs as one Node process on one Fly machine
// (fly.toml — no horizontal scaling to reconcile broadcasts across). This
// module imports nothing from src/lib/db.ts, and db.ts imports this one —
// a one-way dependency, so a future caller of broadcast() never creates a
// cycle with the database layer that calls into it.
//
// In-memory only, deliberately: a subscriber holds no fact about any
// machine, isn't written to SQLite, and is fully rebuilt by the next
// reconnect. See CLAUDE.md (Persistence) and
// notes/adr/0001-realtime-and-concurrent-updates.md. No event
// replay/history is kept here — a (re)connecting client re-fetches
// current persisted state instead (see src/pages/api/stream.ts).
type Subscriber = (machine: Machine) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Call only after a mutation has actually committed to SQLite — never
// speculatively. src/lib/db.ts calls this from both the resident-report
// path (reportStatus) and the lazy-decay path (decayed), each exactly once
// per real write, so every open session sees the same canonical state
// change regardless of what caused it.
export function broadcast(machine: Machine): void {
  for (const subscriber of subscribers) subscriber(machine);
}
