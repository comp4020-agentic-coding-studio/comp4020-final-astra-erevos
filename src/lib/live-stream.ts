import type { AaRoomState, BadgerRoomState, Machine, OtterRoomState, RabbitRoomState, WeaselRoomState } from "./types.ts";

// Stage 3 (AA Room) — the ONE SSE connection for the whole page, shared
// between index.astro's Laundry dashboard script and its AA Room panel
// script. Those are two separate inline <script type="module"> blocks,
// each with its own module scope, so a page-scoped `const events = new
// EventSource(...)` declared inside one is invisible to the other — this
// module exists so both can observe the exact same connection instead of
// either opening a second EventSource or one script awkwardly reaching
// into the other's closure. Exactly the same sharing mechanism
// src/lib/hall-view/scene.ts already uses for its mountedScenes registry:
// ES modules are singletons keyed by URL, so every script that imports
// this file gets the one instance created the first time any of them
// does. See notes/adr/0003-aa-room-live-state.md.
//
// No event replay/history here, same as before: a (re)connection just
// lets each registered "open" listener re-fetch its own current state —
// see src/pages/api/stream.ts's own note on why.
//
// ADR 0004 (Otter Room) added a third listener set/event the same way
// Stage 3 added the second; ADR 0005 (Rabbit Room) added a fourth, same
// shape; ADR 0006 (Weasel Room) added a fifth; ADR 0007 (Badger Room)
// adds a sixth — one more named SSE event over the same connection, no
// new EventSource.
type MachineListener = (machine: Machine) => void;
type AaRoomListener = (room: AaRoomState) => void;
type OtterRoomListener = (room: OtterRoomState) => void;
type RabbitRoomListener = (room: RabbitRoomState) => void;
type WeaselRoomListener = (room: WeaselRoomState) => void;
type BadgerRoomListener = (room: BadgerRoomState) => void;
type OpenListener = () => void;

const machineListeners = new Set<MachineListener>();
const aaRoomListeners = new Set<AaRoomListener>();
const otterRoomListeners = new Set<OtterRoomListener>();
const rabbitRoomListeners = new Set<RabbitRoomListener>();
const weaselRoomListeners = new Set<WeaselRoomListener>();
const badgerRoomListeners = new Set<BadgerRoomListener>();
const openListeners = new Set<OpenListener>();

const events = new EventSource("/api/stream");

events.addEventListener("machine", (event) => {
  const machine = JSON.parse((event as MessageEvent<string>).data) as Machine;
  for (const listener of machineListeners) listener(machine);
});

events.addEventListener("aa-room", (event) => {
  const room = JSON.parse((event as MessageEvent<string>).data) as AaRoomState;
  for (const listener of aaRoomListeners) listener(room);
});

events.addEventListener("otter-room", (event) => {
  const room = JSON.parse((event as MessageEvent<string>).data) as OtterRoomState;
  for (const listener of otterRoomListeners) listener(room);
});

events.addEventListener("rabbit-room", (event) => {
  const room = JSON.parse((event as MessageEvent<string>).data) as RabbitRoomState;
  for (const listener of rabbitRoomListeners) listener(room);
});

events.addEventListener("weasel-room", (event) => {
  const room = JSON.parse((event as MessageEvent<string>).data) as WeaselRoomState;
  for (const listener of weaselRoomListeners) listener(room);
});

events.addEventListener("badger-room", (event) => {
  const room = JSON.parse((event as MessageEvent<string>).data) as BadgerRoomState;
  for (const listener of badgerRoomListeners) listener(room);
});

events.addEventListener("open", () => {
  for (const listener of openListeners) listener();
});

export function onMachineEvent(fn: MachineListener): void {
  machineListeners.add(fn);
}

export function onAaRoomEvent(fn: AaRoomListener): void {
  aaRoomListeners.add(fn);
}

export function onOtterRoomEvent(fn: OtterRoomListener): void {
  otterRoomListeners.add(fn);
}

export function onRabbitRoomEvent(fn: RabbitRoomListener): void {
  rabbitRoomListeners.add(fn);
}

export function onWeaselRoomEvent(fn: WeaselRoomListener): void {
  weaselRoomListeners.add(fn);
}

export function onBadgerRoomEvent(fn: BadgerRoomListener): void {
  badgerRoomListeners.add(fn);
}

// Fires once per connect/reconnect — each registered listener is
// responsible for re-fetching whatever current state it cares about, the
// same "re-fetch is itself a qualifying read" principle
// src/pages/api/stream.ts already documents for machines, now shared by
// AA Room too.
export function onOpen(fn: OpenListener): void {
  openListeners.add(fn);
}
