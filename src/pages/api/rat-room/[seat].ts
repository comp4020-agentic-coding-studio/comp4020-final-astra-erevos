import type { APIRoute } from "astro";
import {
  getRatRoomSeat,
  RAT_ROOM_SEAT_MAX_OCCUPIED_MS,
  reportRatRoomSeatStatus,
} from "../../../lib/rat-room-db.ts";
import { COOKIE_NAME, resolveSession } from "../../../lib/sessions.ts";
import { logRatRoomReportOutcome, logRatRoomReportRejected } from "../../../lib/log.ts";
import { isSafePositiveInteger } from "../../../lib/validation.ts";
import {
  RAT_ROOM_SEAT_IDS,
  VALID_REPORTABLE_RAT_ROOM_SEAT_OCCUPANCIES,
  type RatRoomSeatId,
  type ReportableRatRoomSeatOccupancy,
} from "../../../lib/types.ts";

// Rat Room's API route — a KEYED resource (ten seats), mirroring
// src/pages/api/machines/[id].ts's shape, not any single-fixed-row
// facility's own route. See notes/adr/0008-rat-room-live-state.md.
//
// The path parameter is always the bare LOGICAL seat letter (A-J) —
// never the composite row id ("rat-room-a") the schema/store use
// internally. This is the ADR's own frozen route contract, restated here
// rather than left for this file to improvise: :seat in
// isSeatId()/getRatRoomSeat()/reportRatRoomSeatStatus() is always one of
// RAT_ROOM_SEAT_IDS.

const json = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function isSeatId(value: string | undefined): value is RatRoomSeatId {
  return (RAT_ROOM_SEAT_IDS as readonly string[]).includes(value ?? "");
}

export const GET: APIRoute = ({ params }) => {
  const seatParam = params.seat;
  if (!isSeatId(seatParam)) {
    return json({ error: `seat must be one of: ${RAT_ROOM_SEAT_IDS.join(", ")}` }, 404);
  }
  const seat = getRatRoomSeat(seatParam);
  // Should never be undefined — all ten seats are seeded at module
  // load — but a client naming a syntactically valid letter is already
  // excluded by isSeatId() above; this is purely defensive.
  return seat ? json(seat, 200) : json({ error: "no such seat" }, 404);
};

interface ReportBody {
  occupancy?: string;
  expectedEndAt?: number;
  // Accepted only so PATCH can detect and reject its presence explicitly
  // — see notes/adr/0002-identity-and-permissions.md's anti-impersonation
  // contract, which this route inherits unchanged (ADR 0008, Decision 6).
  reporterId?: unknown;
  ifVersion?: number;
}

// "unknown" is deliberately excluded here — see
// notes/adr/0008-rat-room-live-state.md, Decision 2: it's a real stored
// value (seed state, decay's target) but never one a client may report.
function isReportableOccupancy(value: string | undefined): value is ReportableRatRoomSeatOccupancy {
  return VALID_REPORTABLE_RAT_ROOM_SEAT_OCCUPANCIES.includes(value as ReportableRatRoomSeatOccupancy);
}

// Crit 10's identity model, unchanged for Rat Room: the actor is resolved
// from the request's session cookie, never from the request body. A
// missing or unknown session is rejected 401 before the body is even
// parsed. ifVersion is required: the version this client's own view last
// saw, scoped to THIS seat's own version column — a stale write against
// one seat never gets satisfied by a different seat's version having
// advanced (ADR 0008, Decision 6). A stale view gets 409 with the current
// canonical state for the targeted seat, never a silent overwrite.
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const seatParam = params.seat;
  if (!isSeatId(seatParam)) {
    return json({ error: `seat must be one of: ${RAT_ROOM_SEAT_IDS.join(", ")}` }, 404);
  }
  const seat = seatParam;

  const session = resolveSession(cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    logRatRoomReportRejected({ actor: "(none)", seat, reason: "no-session" });
    return json({ error: "a valid session is required to report Rat Room's status" }, 401);
  }

  const body: ReportBody | null = await request.json().catch(() => null);
  if (!body || !isReportableOccupancy(body.occupancy)) {
    return json(
      { error: `occupancy must be one of: ${VALID_REPORTABLE_RAT_ROOM_SEAT_OCCUPANCIES.join(", ")}` },
      400,
    );
  }
  if (body.reporterId !== undefined) {
    logRatRoomReportRejected({ actor: session.pseudonym, seat, reason: "client-actor-claim" });
    return json({ error: "reporterId is server-controlled" }, 400);
  }
  if (body.occupancy === "empty" && body.expectedEndAt !== undefined) {
    return json({ error: "expectedEndAt must be absent when occupancy is empty" }, 400);
  }

  // now is read once and reused for both bounds of the expectedEndAt
  // check below, so the two comparisons judge the same instant rather
  // than two slightly different Date.now() calls.
  const now = Date.now();
  if (body.occupancy === "occupied" && body.expectedEndAt !== undefined) {
    if (!isSafePositiveInteger(body.expectedEndAt)) {
      return json({ error: "expectedEndAt must be a valid timestamp" }, 400);
    }
    // ADR 0008, Decision 3: a resident's own estimate can narrow the
    // 4-hour ceiling, never extend past it, and an end time already in
    // the past isn't an estimate of anything.
    if (body.expectedEndAt <= now || body.expectedEndAt > now + RAT_ROOM_SEAT_MAX_OCCUPIED_MS) {
      return json(
        { error: "expectedEndAt must be in the future and no more than 4 hours from now" },
        400,
      );
    }
  }
  if (!isSafePositiveInteger(body.ifVersion)) {
    return json({ error: "ifVersion must be the safe positive integer version you last saw" }, 400);
  }

  const result = reportRatRoomSeatStatus(
    seat,
    {
      occupancy: body.occupancy,
      // Per-observation, never inherited (ADR 0008, Decision 2): an
      // "occupied" report with no expectedEndAt in the body, or any
      // "empty" report, passes null through explicitly —
      // reportRatRoomSeatStatus() also independently forces
      // non-"occupied" reports to null, but this call site never relies
      // on that as its only guard.
      expectedEndAt: body.occupancy === "occupied" ? (body.expectedEndAt ?? null) : null,
      reporterId: session.id,
    },
    body.ifVersion,
    now,
  );

  if (result.ok) {
    logRatRoomReportOutcome({
      actor: session.pseudonym,
      seat,
      occupancy: body.occupancy,
      result: "ok",
      version: result.seat.version,
    });
    return json(result.seat, 200);
  }

  if (result.reason === "not-found") return json({ error: "no such seat" }, 404);

  logRatRoomReportOutcome({
    actor: session.pseudonym,
    seat,
    occupancy: body.occupancy,
    result: "conflict",
    version: result.current.version,
  });
  return json({ error: "stale version", current: result.current }, 409);
};
