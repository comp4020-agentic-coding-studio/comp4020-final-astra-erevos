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

// A resident's report: sets the new status and, for in-use, an optional
// expected end time (read off a washer's own display, or a dryer user's
// estimate — either way it's this same optional field, never assumed).
export const PATCH: APIRoute = async ({ params, request }) => {
  const body: ReportBody | null = await request.json().catch(() => null);
  if (!body || !isValidStatus(body.status)) {
    return json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }

  const updated = reportStatus(params.id!, {
    status: body.status,
    startedAt: body.startedAt,
    expectedEndAt: body.expectedEndAt,
    reporterId: body.reporterId,
  });

  return updated ? json(updated, 200) : json({ error: "no such machine" }, 404);
};
