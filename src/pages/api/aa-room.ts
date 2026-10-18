import type { APIRoute } from "astro";
import { getAaRoom, reportAaRoomStatus } from "../../lib/aa-room.ts";
import { COOKIE_NAME, resolveSession } from "../../lib/sessions.ts";
import { logAaRoomReportOutcome, logAaRoomReportRejected } from "../../lib/log.ts";
import { isSafePositiveInteger } from "../../lib/validation.ts";
import {
  VALID_AA_ROOM_ACTIVITIES,
  VALID_REPORTABLE_AA_ROOM_OCCUPANCIES,
  type AaRoomActivity,
  type ReportableAaRoomOccupancy,
} from "../../lib/types.ts";

// AA Room's API route. Mirrors src/pages/api/machines/[id].ts's shape
// throughout — same identity model, same ifVersion/409 concurrency, same
// validation discipline — but as a single fixed resource (no :id segment)
// rather than a keyed one, since AA Room is one row. See
// notes/adr/0003-aa-room-live-state.md.

const json = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const GET: APIRoute = () => json(getAaRoom(), 200);

interface ReportBody {
  occupancy?: string;
  activity?: string | null;
  // Accepted only so PATCH can detect and reject its presence explicitly
  // — see notes/adr/0002-identity-and-permissions.md's anti-impersonation
  // contract, which this route inherits unchanged (ADR 0003, Decision 4).
  reporterId?: unknown;
  ifVersion?: number;
}

// "unknown" is deliberately excluded here — see
// notes/adr/0003-aa-room-live-state.md, Decision 2: it's a real stored
// value (seed state, decay's target) but never one a client may report.
function isReportableOccupancy(value: string | undefined): value is ReportableAaRoomOccupancy {
  return VALID_REPORTABLE_AA_ROOM_OCCUPANCIES.includes(value as ReportableAaRoomOccupancy);
}

function isValidActivity(value: string | null | undefined): value is AaRoomActivity | null | undefined {
  return value == null || VALID_AA_ROOM_ACTIVITIES.includes(value as AaRoomActivity);
}

// Crit 10's identity model, unchanged for AA Room: the actor is resolved
// from the request's session cookie, never from the request body. A
// missing or unknown session is rejected 401 before the body is even
// parsed. ifVersion is required: the version this client's own view last
// saw — a stale view gets 409 with the current canonical state, never a
// silent overwrite. See notes/adr/0001 and notes/adr/0002.
export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = resolveSession(cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    logAaRoomReportRejected({ actor: "(none)", reason: "no-session" });
    return json({ error: "a valid session is required to report AA Room's status" }, 401);
  }

  const body: ReportBody | null = await request.json().catch(() => null);
  if (!body || !isReportableOccupancy(body.occupancy)) {
    return json(
      { error: `occupancy must be one of: ${VALID_REPORTABLE_AA_ROOM_OCCUPANCIES.join(", ")}` },
      400,
    );
  }
  if (body.reporterId !== undefined) {
    logAaRoomReportRejected({ actor: session.pseudonym, reason: "client-actor-claim" });
    return json({ error: "reporterId is server-controlled" }, 400);
  }
  if (body.activity !== undefined && !isValidActivity(body.activity)) {
    return json({ error: `activity must be one of: ${VALID_AA_ROOM_ACTIVITIES.join(", ")}, or omitted` }, 400);
  }
  if (body.activity != null && body.occupancy !== "occupied") {
    return json({ error: "activity may only be set when occupancy is occupied" }, 400);
  }
  if (!isSafePositiveInteger(body.ifVersion)) {
    return json({ error: "ifVersion must be the safe positive integer version you last saw" }, 400);
  }

  const result = reportAaRoomStatus(
    { occupancy: body.occupancy, activity: body.activity ?? null, reporterId: session.id },
    body.ifVersion,
  );

  if (result.ok) {
    logAaRoomReportOutcome({
      actor: session.pseudonym,
      occupancy: body.occupancy,
      result: "ok",
      version: result.room.version,
    });
    return json(result.room, 200);
  }

  logAaRoomReportOutcome({
    actor: session.pseudonym,
    occupancy: body.occupancy,
    result: "conflict",
    version: result.current.version,
  });
  return json({ error: "stale version", current: result.current }, 409);
};
