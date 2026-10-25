import type { AaRoomState, Machine, OtterRoomState, RabbitRoomState } from "./types.ts";

// Crit 9's real-time transport: a single in-process subscriber list,
// correct because this app runs as one Node process on one Fly machine
// (fly.toml — no horizontal scaling to reconcile broadcasts across). This
// module imports nothing from src/lib/db.ts, and db.ts imports this one —
// a one-way dependency, so a future caller of broadcast() never creates a
// cycle with the database layer that calls into it.
//
// In-memory only, deliberately: a subscriber holds no fact about any
// machine or AA Room's state, isn't written to SQLite, and is fully
// rebuilt by the next reconnect. See CLAUDE.md (Persistence) and
// notes/adr/0001-realtime-and-concurrent-updates.md. No event
// replay/history is kept here — a (re)connecting client re-fetches
// current persisted state instead (see src/pages/api/stream.ts).
//
// Stage 3 (AA Room) widened this from a Machine-only callback to a
// discriminated union — see notes/adr/0003-aa-room-live-state.md's
// Mechanics section, which flagged this exact widening as real,
// necessary work rather than something already generic. A discriminated
// union, not a loose `Machine | AaRoomState | OtterRoomState |
// RabbitRoomState`, so a subscriber (and src/pages/api/stream.ts, the
// only one today) can switch on `kind` and get full type narrowing, and
// so adding a facility is one more variant here, not a new parallel
// subscriber list. Otter Room (ADR 0004) was the third variant; Rabbit
// Room (ADR 0005) is the fourth, added the same way.
export type BroadcastPayload =
  | { kind: "machine"; machine: Machine }
  | { kind: "aa-room"; room: AaRoomState }
  | { kind: "otter-room"; room: OtterRoomState }
  | { kind: "rabbit-room"; room: RabbitRoomState };

type Subscriber = (payload: BroadcastPayload) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Call only after a mutation has actually committed to SQLite — never
// speculatively. src/lib/db.ts calls this with `{ kind: "machine", ... }`
// from both the resident-report path (reportStatus) and the lazy-decay
// path (decayed); src/lib/aa-room.ts calls it with `{ kind: "aa-room",
// ... }` from the equivalent two places (reportAaRoomStatus, decayedAaRoom);
// src/lib/otter-room.ts calls it with `{ kind: "otter-room", ... }` and
// src/lib/rabbit-room.ts with `{ kind: "rabbit-room", ... }` from their
// own equivalent two places each (report*/decayed*) — each exactly once
// per real write, so every open session sees the same canonical state
// change regardless of which facility or what caused it.
export function broadcast(payload: BroadcastPayload): void {
  for (const subscriber of subscribers) subscriber(payload);
}
