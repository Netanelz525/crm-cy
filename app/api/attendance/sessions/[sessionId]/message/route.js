import { NextResponse } from "next/server";
import { after } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../../lib/api-tokens";
import {
  getAttendanceSessionById,
  updateAttendanceSessionMessaging
} from "../../../../../../lib/attendance";
import { sendAttendanceSessionEmails } from "../../../../../../lib/attendance-email";

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

export async function GET(request, { params }) {
  const tokenCheck = await requireApiToken(request, "attendance:read");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const session = await getAttendanceSessionById(clean(resolvedParams?.sessionId));
  if (!session) return NextResponse.json({ error: "Attendance session not found" }, { status: 404 });

  return NextResponse.json({
    resource: "attendanceSessionMessage",
    item: {
      sessionId: session.id,
      title: session.title || "",
      displayTitle: session.displayTitle || session.title || session.sessionTypeLabel || "",
      emailSubject: session.emailSubject || "",
      personalMessage: session.personalMessage || "",
      emailResponseStatuses: session.emailResponseStatuses || [],
      emailRecipientRoles: session.emailRecipientRoles || []
    }
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
    const session = await updateAttendanceSessionMessaging(clean(resolvedParams?.sessionId), {
      emailSubject: clean(body.emailSubject || body.subject),
      personalMessage: clean(body.personalMessage),
      emailResponseStatuses: cleanList(body.emailResponseStatuses),
      emailRecipientRoles: cleanList(body.emailRecipientRoles || body.recipientRoles)
    });
    return NextResponse.json({
      resource: "attendanceSessionMessage",
      item: {
        sessionId: session.id,
        title: session.title || "",
        displayTitle: session.displayTitle || session.title || session.sessionTypeLabel || "",
        emailSubject: session.emailSubject || "",
        personalMessage: session.personalMessage || "",
        emailResponseStatuses: session.emailResponseStatuses || [],
        emailRecipientRoles: session.emailRecipientRoles || []
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session message update failed" }, { status: 400 });
  }
}

export async function POST(request, { params }) {
  const tokenCheck = await requireApiToken(request, "attendance:write");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const sessionId = clean(resolvedParams?.sessionId);
    const emailSubject = clean(body.emailSubject || body.subject);
    const personalMessage = clean(body.personalMessage);
    const emailResponseStatuses = cleanList(body.emailResponseStatuses);
    const targetStatuses = cleanList(body.targetStatuses);
    const recipientRoles = cleanList(body.recipientRoles || body.emailRecipientRoles);
    const createdByUserId = clean(body.createdByUserId) || `api:${clean(tokenCheck.auth?.id) || "unknown"}`;

    await updateAttendanceSessionMessaging(sessionId, {
      emailSubject,
      personalMessage,
      emailResponseStatuses,
      emailRecipientRoles: recipientRoles
    });

    after(async () => {
      try {
        await sendAttendanceSessionEmails({
          sessionId,
          emailSubject,
          personalMessage,
          emailResponseStatuses,
          targetStatuses,
          recipientRoles,
          createdByUserId
        });
      } catch (error) {
        console.error("Attendance session API email send failed", {
          sessionId,
          error: error instanceof Error ? error.message : String(error || "Unknown error")
        });
      }
    });

    return NextResponse.json({
      resource: "attendanceSessionMessageSend",
      item: {
        sessionId,
        accepted: true,
        queued: true,
        targetStatuses,
        responseStatuses: emailResponseStatuses,
        recipientRoles
      }
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Attendance session email send failed" }, { status: 400 });
  }
}
