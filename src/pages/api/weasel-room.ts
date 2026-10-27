import type { APIRoute } from "astro";
import { getWeaselRoom, WEASEL_ROOM_MAX_OCCUPIED_MS, reportWeaselRoomStatus } from "../../lib/weasel-room-db.ts";
import { COOKIE_NAME, resolveSession } from "../../lib/sessions.ts";
import { logWeaselRoomReportOutcome, logWeaselRoomReportRejected } from "../../lib/log.ts";
import { isSafePositiveInteger } from "../../lib/validation.ts";
import { VALID_REPORTABLE_WEASEL_ROOM_OCCUPANCIES, type ReportableWeaselRoomOccupancy } from "../../lib/types.ts";

// Weasel Room's API route. Mirrors src/pages/api/rabbit-room.ts's shape
// throughout — same identity model, same ifVersion/409 concurrency, same
// validation discipline — but as a single fixed resource (no :id segment)
// rather than a keyed one, since Weasel Room is one row. See
// notes/adr/0006-weasel-room-live-state.md.

const json = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const GET: APIRoute = () => json(getWeaselRoom(), 200);

interface ReportBody {
  occupancy?: string;
  expectedEndAt?: number;
  // Accepted only so PATCH can detect and reject its presence explicitly
  // — see notes/adr/0002-identity-and-permissions.md's anti-impersonation
  // contract, which this route inherits unchanged (ADR 0006, Decision 4).
  reporterId?: unknown;
  ifVersion?: number;
}

// "unknown" is deliberately excluded here — see
// notes/adr/0006-weasel-room-live-state.md, Decision 1: it's a real
// stored value (seed state, decay's target) but never one a client may
// report.
function isReportableOccupancy(value: string | undefined): value is ReportableWeaselRoomOccupancy {
  return VALID_REPORTABLE_WEASEL_ROOM_OCCUPANCIES.includes(value as ReportableWeaselRoomOccupancy);
}

// Crit 10's identity model, unchanged for Weasel Room: the actor is
// resolved from the request's session cookie, never from the request
// body. A missing or unknown session is rejected 401 before the body is
// even parsed. ifVersion is required: the version this client's own view
// last saw — a stale view gets 409 with the current canonical state,
// never a silent overwrite. See notes/adr/0001 and notes/adr/0002.
export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = resolveSession(cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    logWeaselRoomReportRejected({ actor: "(none)", reason: "no-session" });
    return json({ error: "a valid session is required to report Weasel Room's status" }, 401);
  }

  const body: ReportBody | null = await request.json().catch(() => null);
  if (!body || !isReportableOccupancy(body.occupancy)) {
    return json(
      { error: `occupancy must be one of: ${VALID_REPORTABLE_WEASEL_ROOM_OCCUPANCIES.join(", ")}` },
      400,
    );
  }
  if (body.reporterId !== undefined) {
    logWeaselRoomReportRejected({ actor: session.pseudonym, reason: "client-actor-claim" });
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
    // ADR 0006, Decision 2: a resident's own estimate can narrow the
    // 4-hour ceiling, never extend past it, and an end time already in
    // the past isn't an estimate of anything.
    if (body.expectedEndAt <= now || body.expectedEndAt > now + WEASEL_ROOM_MAX_OCCUPIED_MS) {
      return json(
        { error: "expectedEndAt must be in the future and no more than 4 hours from now" },
        400,
      );
    }
  }
  if (!isSafePositiveInteger(body.ifVersion)) {
    return json({ error: "ifVersion must be the safe positive integer version you last saw" }, 400);
  }

  const result = reportWeaselRoomStatus(
    {
      occupancy: body.occupancy,
      // Per-observation, never inherited (ADR 0006, Decision 2): an
      // "occupied" report with no expectedEndAt in the body, or any
      // "empty" report, passes null through explicitly —
      // reportWeaselRoomStatus() also independently forces non-"occupied"
      // reports to null, but this call site never relies on that as its
      // only guard.
      expectedEndAt: body.occupancy === "occupied" ? (body.expectedEndAt ?? null) : null,
      reporterId: session.id,
    },
    body.ifVersion,
    now,
  );

  if (result.ok) {
    logWeaselRoomReportOutcome({
      actor: session.pseudonym,
      occupancy: body.occupancy,
      result: "ok",
      version: result.room.version,
    });
    return json(result.room, 200);
  }

  logWeaselRoomReportOutcome({
    actor: session.pseudonym,
    occupancy: body.occupancy,
    result: "conflict",
    version: result.current.version,
  });
  return json({ error: "stale version", current: result.current }, 409);
};
