import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../../lib/api-tokens";
import { buildAttendanceStatusLabels, getAttendanceSessionById } from "../../../../../../lib/attendance";
import { listWhatsAppCoexistenceApprovedTemplates, sendAttendanceSessionWhatsAppApprovedTemplate } from "../../../../../../lib/attendance-whatsapp";

export const runtime = "nodejs";
export const maxDuration = 300;

const clean = (value) => String(value ?? "").trim();
const reply = (error, status) => NextResponse.json({ error }, { status });

async function authorize(request, scope) {
  const token = readBearerToken(request);
  const auth = token ? await authenticateApiToken(token) : null;
  if (!auth) return { response: reply("Unauthorized", 401) };
  if (!auth.scopes?.includes(scope)) return { response: reply(`Missing required scope: ${scope}`, 403) };
  return { auth };
}

function statusList(value, labels, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !clean(item))) throw new Error(`${name} must be an array of status IDs`);
  const statuses = value.map((item) => clean(item));
  if (statuses.some((item) => !Object.hasOwn(labels, item)) || new Set(statuses).size !== statuses.length) throw new Error(`${name} contains unknown or duplicate statuses`);
  return statuses;
}

function buttons(template) {
  return (template.buttons || []).filter((button) => ["QUICK_REPLY", "QUICK_REPLY_BUTTON"].includes(button.type));
}

function automaticStatuses(template, labels) {
  return buttons(template).map((button) => {
    const matches = Object.entries(labels).filter(([, label]) => clean(label) === clean(button.text));
    return matches.length === 1 ? matches[0][0] : "";
  });
}

export async function GET(request, { params }) {
  const access = await authorize(request, "attendance:read");
  if (access.response) return access.response;
  const { sessionId } = await params;
  const session = await getAttendanceSessionById(clean(sessionId));
  if (!session) return reply("Attendance session not found", 404);
  try {
    const statusLabels = buildAttendanceStatusLabels(session.customStatuses);
    const templates = await listWhatsAppCoexistenceApprovedTemplates();
    return NextResponse.json({ resource: "attendanceSessionWhatsApp", item: {
      sessionId: session.id, isLocked: session.isLocked, statusLabels,
      recipientRoles: ["student", "father", "mother"], defaultTargetStatuses: ["missing"],
      templates: templates.filter((template) => !template.name.includes("meeting_invitation")).map((template) => ({
        name: template.name, language: template.language, bodyText: template.bodyText,
        parameterDefinitions: template.parameterDefinitions, headerFormat: template.headerFormat,
        buttons: buttons(template), suggestedResponseStatuses: automaticStatuses(template, statusLabels)
      }))
    } });
  } catch (error) {
    console.error("Attendance API WhatsApp template lookup failed", error?.message);
    return reply("WhatsApp template lookup failed", 502);
  }
}

export async function POST(request, { params }) {
  const access = await authorize(request, "attendance:write");
  if (access.response) return access.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply("Invalid JSON body", 400);
  const { sessionId } = await params;
  const session = await getAttendanceSessionById(clean(sessionId));
  if (!session) return reply("Attendance session not found", 404);
  if (session.isLocked) return reply("Attendance session is locked", 409);
  const templateName = clean(body.templateName);
  const templateLanguage = clean(body.templateLanguage || "he");
  const labels = buildAttendanceStatusLabels(session.customStatuses);
  let recipientRoles, targetStatuses, responseStatuses;
  try {
    if (!templateName) throw new Error("templateName is required");
    recipientRoles = body.recipientRoles ?? ["student"];
    if (!Array.isArray(recipientRoles) || !recipientRoles.length || recipientRoles.some((role) => !["student", "father", "mother"].includes(role)) || new Set(recipientRoles).size !== recipientRoles.length) throw new Error("recipientRoles must contain student, father or mother without duplicates");
    targetStatuses = statusList(body.targetStatuses ?? ["missing"], labels, "targetStatuses");
    if (body.responseStatuses !== undefined) responseStatuses = statusList(body.responseStatuses, labels, "responseStatuses");
    if (body.parameterOverrides !== undefined && (!body.parameterOverrides || typeof body.parameterOverrides !== "object" || Array.isArray(body.parameterOverrides) || Object.values(body.parameterOverrides).some((value) => typeof value !== "string"))) throw new Error("parameterOverrides must be an object of text values");
    if (body.imageId !== undefined && typeof body.imageId !== "string") throw new Error("imageId must be a WhatsApp media ID");
  } catch (error) { return reply(error.message, 400); }
  let templates;
  try { templates = await listWhatsAppCoexistenceApprovedTemplates(); }
  catch { return reply("WhatsApp template lookup failed", 502); }
  const template = templates.find((item) => item.name === templateName && item.language.toLowerCase() === templateLanguage.toLowerCase());
  if (!template) return reply("Approved WhatsApp template not found for this language", 400);
  responseStatuses ??= automaticStatuses(template, labels);
  if (responseStatuses.some((status) => !status) || new Set(responseStatuses).size !== responseStatuses.length || responseStatuses.length !== buttons(template).length) return reply("responseStatuses must map each template button, in provider order, to a distinct attendance status", 400);
  try {
    // Reuse the UI sender: same recipient selection, hidden tokens, message IDs
    // and canonical attendance updates. Do not accept a spoofed user ID from JSON.
    const result = await sendAttendanceSessionWhatsAppApprovedTemplate({
      sessionId: session.id, templateName, templateLanguage, templates,
      recipientRoles, targetStatuses, responseStatuses,
      parameterOverrides: body.parameterOverrides || {}, imageId: clean(body.imageId), studentId: clean(body.studentId),
      createdByUserId: ""
    });
    return NextResponse.json({ resource: "attendanceSessionWhatsAppSend", item: {
      sessionId: session.id, templateName, templateLanguage, completed: true,
      recipientRoles, targetStatuses, responseStatuses, ...result
    } }, { status: result.failedMessages && !result.sentMessages ? 502 : 200 });
  } catch (error) {
    return reply(error?.message || "Attendance WhatsApp send failed", 400);
  }
}
