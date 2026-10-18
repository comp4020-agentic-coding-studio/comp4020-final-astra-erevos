import type { APIRoute } from "astro";
import { getMachine, reportStatus, VALID_STATUSES, type MachineStatus } from "../../../lib/db.ts";
import { COOKIE_NAME, resolveSession } from "../../../lib/sessions.ts";
import { logReportOutcome, logReportRejected } from "../../../lib/log.ts";
import { isSafePositiveInteger } from "../../../lib/validation.ts";

const json = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const GET: APIRoute = ({ params }) => {
  const machine = getMachine(params.id!);
  return machine ? json(machine, 200) : json({ error: "no such machine" }, 404);
};

interface ReportBody {
  status?: string;
  startedAt?: number;
  expectedEndAt?: number;
  // Accepted only so PATCH can detect and reject its presence explicitly
  // (see the PATCH handler below) rather than silently stripping it —
  // the actor is always the server-resolved session, never a
  // client-asserted field.
  reporterId?: unknown;
  ifVersion?: number;
}

function isValidStatus(status: string | undefined): status is MachineStatus {
  return VALID_STATUSES.includes(status as MachineStatus);
}

// A resident's report: sets the new status and, for in-use, an optional
// expected end time (read off a washer's own display, or a dryer user's
// estimate — either way it's this same optional field, never assumed).
//
// Crit 10: the actor is resolved from the request's session cookie, never
// from the request body. A missing or unknown session is rejected with
// 401 before the body is even parsed — see
// notes/adr/0002-identity-and-permissions.md. A body carrying a
// reporterId field is rejected outright with 400, not silently ignored:
// a client is not allowed to *claim* an actor at all, not just prevented
// from having that claim believed.
//
// ifVersion is required: the version this client's own view last saw. The
// write only applies if that's still the machine's current version — see
// notes/adr/0001-realtime-and-concurrent-updates.md. A stale view gets 409
// with the current canonical state, never a silent overwrite.
export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const machineId = params.id!;
  const session = resolveSession(cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    // Rejected before the body is even parsed: there's no status to name
    // here, because the server never read one — see
    // notes/adr/0002-identity-and-permissions.md on not inventing a
    // requested status the server never actually parsed.
    logReportRejected({ actor: "(none)", machine: machineId, reason: "no-session" });
    return json({ error: "a valid session is required to report a machine's status" }, 401);
  }

  const body: ReportBody | null = await request.json().catch(() => null);
  if (!body || !isValidStatus(body.status)) {
    return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }
  if (body.reporterId !== undefined) {
    // The real, authenticated actor attempted this — never the forged
    // value they tried to claim, which is dropped here, not logged.
    logReportRejected({ actor: session.pseudonym, machine: machineId, reason: "client-actor-claim" });
    return json({ error: "reporterId is server-controlled" }, 400);
  }
  if (body.startedAt !== undefined && !isSafePositiveInteger(body.startedAt)) {
    return json({ error: "startedAt must be a valid timestamp" }, 400);
  }
  if (body.expectedEndAt !== undefined && !isSafePositiveInteger(body.expectedEndAt)) {
    return json({ error: "expectedEndAt must be a valid timestamp" }, 400);
  }
  if (!isSafePositiveInteger(body.ifVersion)) {
    return json({ error: "ifVersion must be the safe positive integer version you last saw" }, 400);
  }

  const result = reportStatus(
    machineId,
    {
      status: body.status,
      startedAt: body.startedAt,
      expectedEndAt: body.expectedEndAt,
      reporterId: session.id,
    },
    body.ifVersion,
  );

  if (result.ok) {
    logReportOutcome({
      actor: session.pseudonym,
      machine: machineId,
      status: body.status,
      result: "ok",
      version: result.machine.version,
    });
    return json(result.machine, 200);
  }
  if (result.reason === "not-found") return json({ error: "no such machine" }, 404);

  logReportOutcome({
    actor: session.pseudonym,
    machine: machineId,
    status: body.status,
    result: "conflict",
    version: result.current.version,
  });
  return json({ error: "stale version", current: result.current }, 409);
};
