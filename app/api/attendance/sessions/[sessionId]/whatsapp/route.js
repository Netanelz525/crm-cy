import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../../lib/api-tokens";
import { getAttendanceSessionById } from "../../../../../../lib/attendance";
import { saveAttendanceWhatsAppConfig, sendSavedAttendanceWhatsAppConfig } from "../../../../../../lib/attendance-whatsapp-settings";

async function authorize(request, scope) {
  const token = readBearerToken(request);
  const auth = token ? await authenticateApiToken(token) : null;
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!Array.isArray(auth.scopes) || !auth.scopes.includes(scope)) return NextResponse.json({ error: `Missing required scope: ${scope}` }, { status: 403 });
  return null;
}

export async function GET(request, { params }) {
  const denied = await authorize(request, "attendance:read");
  if (denied) return denied;
  const { sessionId } = await params;
  const session = await getAttendanceSessionById(sessionId);
  if (!session) return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });
  return NextResponse.json({ resource: "attendanceSessionWhatsApp", item: { sessionId, config: session.whatsappMessageConfig } });
}

export async function PATCH(request, { params }) {
  const denied = await authorize(request, "attendance:write");
  if (denied) return denied;
  const { sessionId } = await params;
  const session = await getAttendanceSessionById(sessionId);
  if (!session) return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const config = await saveAttendanceWhatsAppConfig(sessionId, { ...session.whatsappMessageConfig, ...body });
    return NextResponse.json({ resource: "attendanceSessionWhatsApp", item: { sessionId, config } });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Invalid WhatsApp configuration" }, { status: 400 });
  }
}

export async function POST(request, { params }) {
  const denied = await authorize(request, "attendance:write");
  if (denied) return denied;
  const { sessionId } = await params;
  const session = await getAttendanceSessionById(sessionId);
  if (!session) return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Send a JSON object, e.g. {}" }, { status: 400 });
  if (Object.keys(body).some((key) => !["studentId", "targetStatuses", "recipientRoles"].includes(key))) {
    return NextResponse.json({ error: "Save template settings with PATCH first. POST accepts studentId, targetStatuses and recipientRoles only." }, { status: 400 });
  }
  try {
    const config = { ...session.whatsappMessageConfig };
    for (const key of ["targetStatuses", "recipientRoles"]) if (Object.hasOwn(body, key)) config[key] = body[key];
    // Return actual delivery counts, including partial failures, instead of reporting a queued send as success.
    const result = await sendSavedAttendanceWhatsAppConfig({ sessionId, config, studentId: String(body.studentId || "").trim() });
    return NextResponse.json({ resource: "attendanceSessionWhatsAppSend", item: { sessionId, ...result } });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "WhatsApp send failed" }, { status: 400 });
  }
}
