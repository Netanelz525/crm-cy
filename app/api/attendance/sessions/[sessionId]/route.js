import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../lib/api-tokens";
import {
  deleteAttendanceSession,
  getAttendanceRoster,
  saveAttendanceRecord,
  updateAttendanceSessionDetails
} from "../../../../../lib/attendance";
import { getCurrentAppUser } from "../../../../../lib/rbac";

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

async function requireAttendanceReadAccess(request) {
  const token = readBearerToken(request);
  if (token) {
    return requireApiToken(request, "attendance:read");
  }

  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin)) {
    return { ok: false, response: unauthorized() };
  }

  return { ok: true, auth: user };
}

function normalizeRecordInput(record) {
  return {
    studentId: clean(record?.studentId),
    studentName: clean(record?.studentName),
    studentClass: clean(record?.studentClass),
    status: clean(record?.status),
    noteText: clean(record?.noteText)
  };
}

export async function GET(request, { params }) {
  const accessCheck = await requireAttendanceReadAccess(request);
  if (!accessCheck.ok) return accessCheck.response;

  try {
    const resolvedParams = await params;
    const sessionId = clean(resolvedParams?.sessionId);
    const roster = await getAttendanceRoster(sessionId);
    if (!roster) {
      return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });
    }

    return NextResponse.json({
      resource: "attendanceSession",
      item: roster
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session lookup failed" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const tokenCheck = await requireApiToken(request, "attendance:write");
  if (!tokenCheck.ok) return tokenCheck.response;

  try {
    const resolvedParams = await params;
    const sessionId = clean(resolvedParams?.sessionId);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rawRecords = Array.isArray(body.records)
      ? body.records
      : body.studentId
        ? [body]
        : [];

    if (!rawRecords.length) {
      await updateAttendanceSessionDetails(sessionId, {
        title: body.title ?? body.sessionName,
        sourceNote: body.sourceNote,
        sessionType: body.sessionType,
        updatesLockedUntil: body.updatesLockedUntil ?? body.lockedUntil ?? body.updatesLockedUntilAt,
        sessionDate: body.sessionDate
      });
      const roster = await getAttendanceRoster(sessionId);
      if (!roster) {
        return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });
      }
      return NextResponse.json({
        resource: "attendanceSession",
        item: roster
      });
    }

    const markedByUserId = clean(body.markedByUserId) || null;
    for (const entry of rawRecords) {
      const record = normalizeRecordInput(entry);
      if (!record.studentId) continue;
      await saveAttendanceRecord({
        sessionId,
        record,
        markedByUserId
      });
    }

    const roster = await getAttendanceRoster(sessionId);
    if (!roster) {
      return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });
    }

    return NextResponse.json({
      resource: "attendanceSession",
      item: roster
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session update failed" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const tokenCheck = await requireApiToken(request, "attendance:delete");
  if (!tokenCheck.ok) return tokenCheck.response;

  try {
    const resolvedParams = await params;
    const sessionId = clean(resolvedParams?.sessionId);
    await deleteAttendanceSession(sessionId);

    return NextResponse.json({
      resource: "attendanceSession",
      deleted: true,
      id: sessionId
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session delete failed" }, { status: 400 });
  }
}
