import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../../lib/api-tokens";
import {
  getAttendanceSessionById,
  parseAttendanceCustomStatusesText,
  updateAttendanceSessionCustomStatuses
} from "../../../../../../lib/attendance";

function clean(value) {
  return String(value || "").trim();
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden(scope) {
  return NextResponse.json({ error: `Missing required scope: ${scope}` }, { status: 403 });
}

async function requireApiToken(request, scope) {
  const token = readBearerToken(request);
  if (!token) return { ok: false, response: unauthorized() };
  const auth = await authenticateApiToken(token);
  if (!auth) return { ok: false, response: unauthorized() };
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : [];
  if (scope && !scopes.includes(scope)) {
    return { ok: false, response: forbidden(scope) };
  }
  return { ok: true, auth };
}

function buildPayload(session) {
  return {
    sessionId: session.id,
    customStatuses: session.customStatuses || [],
    statusOptions: session.statusOptions || []
  };
}

export async function GET(request, { params }) {
  const tokenCheck = await requireApiToken(request, "attendance:read");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const session = await getAttendanceSessionById(clean(resolvedParams?.sessionId));
  if (!session) return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });

  return NextResponse.json({
    resource: "attendanceSessionStatuses",
    item: buildPayload(session)
  });
}

export async function PATCH(request, { params }) {
  const tokenCheck = await requireApiToken(request, "attendance:write");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const session = await updateAttendanceSessionCustomStatuses(clean(resolvedParams?.sessionId), {
      customStatuses: Array.isArray(body.customStatuses)
        ? body.customStatuses
        : parseAttendanceCustomStatusesText(body.customStatusesText)
    });

    return NextResponse.json({
      resource: "attendanceSessionStatuses",
      item: buildPayload(session)
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session statuses update failed" }, { status: 400 });
  }
}
