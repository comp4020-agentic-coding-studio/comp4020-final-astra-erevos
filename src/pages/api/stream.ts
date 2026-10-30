import type { APIRoute } from "astro";
import { subscribe } from "../../lib/realtime.ts";

// Crit 9's real-time transport: a one-directional SSE push of the
// canonical state after each mutation commits — a resident's report or a
// server-driven decay alike. Writes stay plain HTTP PATCH; see
// notes/adr/0001-realtime-and-concurrent-updates.md.
//
// Stage 3 (AA Room), ADR 0004 (Otter Room), ADR 0005 (Rabbit Room), ADR
// 0006 (Weasel Room), and ADR 0007 (Badger Room): still exactly one SSE
// connection, one subscriber list. The single subscribe() callback below
// switches on the broadcast payload's `kind` and writes the matching
// named SSE event (`event: machine`, `event: aa-room`,
// `event: otter-room`, `event: rabbit-room`, `event: weasel-room`, or
// `event: badger-room`), so the six facilities' events are told apart on
// the wire without a discriminator field inside any one payload's own
// JSON body — the existing `event: machine`/`event: aa-room`/
// `event: otter-room`/`event: rabbit-room` listeners, and every test
// keyed on them, see exactly the same shape they always have.
//
// No initial snapshot and no event replay/history here: a client that
// (re)connects re-fetches current persisted state itself (see
// src/pages/index.astro's `open` handler), the same read path any page
// load already uses — that fetch is itself a qualifying read for any
// decay that was due while nobody was looking.
export const GET: APIRoute = ({ request }) => {
  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream({
    start(controller) {
      // Send something immediately so Node actually flushes the response
      // headers/first bytes on connect, instead of holding them back until
      // the first real broadcast happens to come along (observed on Fly: a
      // quiet connection got zero bytes for several seconds). A bare SSE
      // comment line is spec-legal, carries no `data:`/event name, and
      // EventSource silently ignores it — it never reaches the "machine"
      // or "aa-room" listeners in src/pages/index.astro, only triggers the
      // native "open" event once headers arrive, which is exactly the
      // point. This must keep working — see
      // notes/adr/0003-aa-room-live-state.md and 885da13.
      controller.enqueue(encoder.encode(": connected\n\n"));

      unsubscribe = subscribe((payload) => {
        try {
          const data = payload.kind === "machine" ? payload.machine : payload.room;
          controller.enqueue(encoder.encode(`event: ${payload.kind}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The controller is already closed (client gone) — the
          // `cancel`/`abort` handling below will unsubscribe shortly;
          // nothing more to do with this particular event.
        }
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
};
