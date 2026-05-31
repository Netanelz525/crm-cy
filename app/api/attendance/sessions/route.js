import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../lib/api-tokens";
import {
  createAttendanceSession,
  listAttendanceSessions
} from "../../../../lib/attendance";

function clean(value) {
  return String(value || "").trim();
}

function cleanList(values) {
  return (Array.isArray(values) ? values : [values]).map(clean).filter(Boolean);
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

export async function GET(request) {
  const tokenCheck = await requireApiToken(request, "attendance:read");
  if (!tokenCheck.ok) return tokenCheck.response;

  try {
    const url = new URL(request.url);
    const institution = clean(url.searchParams.get("institution"));
    const dateFrom = clean(url.searchParams.get("dateFrom"));
    const dateTo = clean(url.searchParams.get("dateTo"));
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 25, 100));

    const items = await listAttendanceSessions({
      institution,
      dateFrom,
      dateTo,
      limit
    });

    return NextResponse.json({
      resource: "attendanceSessions",
      count: items.length,
      filters: {
        institution: institution || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        limit
      },
      items
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session list failed" }, { status: 500 });
  }
}

export async function POST(request) {
  const tokenCheck = await requireApiToken(request, "attendance:write");
  if (!tokenCheck.ok) return tokenCheck.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const session = await createAttendanceSession({
      id: clean(body.id) || randomUUID(),
      institution: clean(body.institution),
      sessionType: clean(body.sessionType),
      title: clean(body.title),
      sessionDate: clean(body.sessionDate),
      sourceNote: clean(body.sourceNote),
      classFilter: cleanList(body.classFilter),
      registrationFilter: cleanList(body.registrationFilter),
      familyStatusFilter: cleanList(body.familyStatusFilter || body.famliystatusFilter),
      createdByUserId: clean(body.createdByUserId) || `api:${clean(tokenCheck.auth?.id) || "unknown"}`
    });

    return NextResponse.json(
      {
        resource: "attendanceSessions",
        item: session
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session creation failed" }, { status: 400 });
  }
}
