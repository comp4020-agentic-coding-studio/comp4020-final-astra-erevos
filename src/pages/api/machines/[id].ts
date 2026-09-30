import type { APIRoute } from "astro";
import { getMachine, reportStatus, VALID_STATUSES, type MachineStatus } from "../../../lib/db.ts";

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
  reporterId?: string;
}

function isValidStatus(status: string | undefined): status is MachineStatus {
  return VALID_STATUSES.includes(status as MachineStatus);
}

// node:sqlite throws rather than silently truncate when a stored INTEGER
// exceeds Number.MAX_SAFE_INTEGER, so an unvalidated client timestamp can
// corrupt a row into one that errors on every future read — not a
// hypothetical: this is exactly how ab-washer broke during the crit 8
// redeploy check. Reject anything that isn't a real, safe, positive
// timestamp before it ever reaches SQLite.
function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// A resident's report: sets the new status and, for in-use, an optional
// expected end time (read off a washer's own display, or a dryer user's
// estimate — either way it's this same optional field, never assumed).
export const PATCH: APIRoute = async ({ params, request }) => {
  const body: ReportBody | null = await request.json().catch(() => null);
  if (!body || !isValidStatus(body.status)) {
    return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }
  if (body.startedAt !== undefined && !isSafeTimestamp(body.startedAt)) {
    return json({ error: "startedAt must be a valid timestamp" }, 400);
  }
  if (body.expectedEndAt !== undefined && !isSafeTimestamp(body.expectedEndAt)) {
    return json({ error: "expectedEndAt must be a valid timestamp" }, 400);
  }

  const updated = reportStatus(params.id!, {
    status: body.status,
    startedAt: body.startedAt,
    expectedEndAt: body.expectedEndAt,
    reporterId: body.reporterId,
  });

  return updated ? json(updated, 200) : json({ error: "no such machine" }, 404);
};
