import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { validateAttendanceWhatsAppConfig } from "../lib/attendance-whatsapp-config.mjs";

const template = {
  name: "attendance_status_update_v1", language: "he", bodyText: "{{1}} {{2}} {{3}} {{4}} {{5}}",
  buttons: [{ type: "URL", index: 0 }, { type: "QUICK_REPLY", index: 1 }, { type: "QUICK_REPLY", index: 2 }],
  parameterDefinitions: [
    { index: 1, source: "recipient" }, { index: 2, source: "session" },
    { index: 3, source: "free" }, { index: 4, source: "responseStatus:1" }, { index: 5, source: "responseStatus:2" }
  ]
};
const options = [["found", "נמצא"], ["missing", "לא נמצא"]];
const input = { templateName: template.name, templateLanguage: "he", parameterOverrides: { 3: "תוכן קבוע", 1: "שם מזויף" }, responseStatuses: ["missing", "found"], recipientRoles: ["student"], targetStatuses: ["missing"] };

test("saved configuration preserves button order and only accepts free variables", () => {
  const config = validateAttendanceWhatsAppConfig(input, [template], options);
  assert.deepEqual(config.responseStatuses, ["missing", "found"]);
  assert.deepEqual(config.parameterOverrides, { 3: "תוכן קבוע" });
  assert.equal(config.templateLanguage, "he");
});

test("rejects obsolete statuses, duplicate mappings, wrong language and empty recipients", () => {
  for (const patch of [
    { responseStatuses: ["deleted", "found"] }, { responseStatuses: ["found", "found"] },
    { responseStatuses: ["found"] }, { templateLanguage: "en" }, { recipientRoles: [] },
    { recipientRoles: ["unknown"] }, { targetStatuses: ["deleted"] }
  ]) assert.throws(() => validateAttendanceWhatsAppConfig({ ...input, ...patch }, [template], options));
});

test("supports informational templates and requires media for media templates", () => {
  const informational = { ...template, buttons: [] };
  assert.deepEqual(validateAttendanceWhatsAppConfig({ ...input, responseStatuses: [] }, [informational], options).responseStatuses, []);
  assert.throws(() => validateAttendanceWhatsAppConfig(input, [{ ...template, requiresMedia: true }], options));
});

function loadWhatsApp(deps) {
  const source = readFileSync(new URL("../lib/attendance-whatsapp.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/export /g, "");
  return new Function(...Object.keys(deps), `${source}\nreturn { sendAttendanceSessionWhatsAppApprovedTemplate, applyAttendanceWhatsAppResponse };`)(...Object.values(deps));
}

test("approved send emits ordered, student-specific response tokens and saved free text", async () => {
  const tokens = [];
  const sent = [];
  const api = loadWhatsApp({
    randomUUID, initDb: async () => {},
    sql: async (parts, ...values) => { if (parts.join("").includes("INSERT INTO attendance_whatsapp_response_tokens")) tokens.push(values); return []; },
    getAttendanceRoster: async () => ({ session: { id: "meeting", title: "מפגש", personalMessage: "טקסט מייל אחר", customStatuses: [] }, students: [{ id: "student", status: "missing" }] }),
    getNeonStudentById: async () => ({ id: "student", label: "תלמיד", phone: "0501234567" }),
    buildAttendanceStatusLabels: () => Object.fromEntries(options), normalizeAttendanceStatus: value => value,
    saveAttendanceRecord: async () => {},
    coexistenceWhatsAppConfig: () => ({ messagesUrl: "https://example.invalid", accessToken: "test" }),
    fetch: async (_, request) => { sent.push(JSON.parse(request.body)); return { ok: true, json: async () => ({}) }; }
  });
  const config = validateAttendanceWhatsAppConfig(input, [template], options);
  const result = await api.sendAttendanceSessionWhatsAppApprovedTemplate({ sessionId: "meeting", ...config, templates: [template] });
  assert.equal(result.sentMessages, 1);
  assert.deepEqual(tokens.map(values => values.slice(1, 6)), [
    ["meeting", "student", "972501234567", "student", "missing"],
    ["meeting", "student", "972501234567", "student", "found"]
  ]);
  const components = sent[0].template.components;
  assert.equal(components[0].parameters[2].text, "תוכן קבוע");
  assert.deepEqual(components.slice(1).map(button => button.index), ["1", "2"]);
  assert.ok(components[1].parameters[0].payload.startsWith("attendance:"));
  await assert.rejects(() => api.sendAttendanceSessionWhatsAppApprovedTemplate({ sessionId: "meeting", ...config, templateLanguage: "en", templates: [template] }));
});

test("webhook rejects another phone or used token; valid reply updates the linked session and student", async () => {
  let used = false;
  const records = [];
  const api = loadWhatsApp({
    initDb: async () => {}, normalizeAttendanceStatus: value => value,
    getNeonStudentById: async () => ({ label: "תלמיד", class: "A" }),
    saveAttendanceRecord: async record => records.push(record),
    sql: async (parts) => {
      const query = parts.join("");
      if (query.includes("SELECT id, session_id, student_id, recipient_phone")) return [{ id: "token", session_id: "meeting", student_id: "student", recipient_phone: "972501234567", status: "found", used_at: used ? new Date() : null }];
      if (query.includes("SELECT note_text")) return [{ note_text: "הערה קיימת" }];
      if (query.includes("UPDATE attendance_whatsapp_response_tokens")) used = true;
      return [];
    }
  });
  assert.equal(await api.applyAttendanceWhatsAppResponse("attendance:token", "0507654321"), null);
  const result = await api.applyAttendanceWhatsAppResponse("attendance:token", "0501234567", "נמצא");
  assert.deepEqual(result, { sessionId: "meeting", studentId: "student", status: "found" });
  assert.equal(records[0].record.noteText, "הערה קיימת");
  assert.equal(records[0].record.status, "found");
  assert.equal(await api.applyAttendanceWhatsAppResponse("attendance:token", "0501234567"), null);
  assert.equal(records.length, 1);
});

test("API enforces scopes, saves without sending and sends saved settings with truthful counts", async () => {
  let auth = null;
  let config = input;
  const sent = [];
  const source = readFileSync(new URL("../app/api/attendance/sessions/[sessionId]/whatsapp/route.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/export /g, "");
  const deps = {
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) },
    readBearerToken: () => "test", authenticateApiToken: async () => auth,
    getAttendanceSessionById: async id => id === "meeting" ? { whatsappMessageConfig: config } : null,
    saveAttendanceWhatsAppConfig: async (_, next) => { config = next; return config; },
    sendSavedAttendanceWhatsAppConfig: async args => { sent.push(args); return { sentMessages: 1, failedMessages: 2, missingRecipients: 3, errors: ["delivery failed"] }; }
  };
  const api = new Function(...Object.keys(deps), `${source}\nreturn { GET, PATCH, POST };`)(...Object.values(deps));
  const context = { params: Promise.resolve({ sessionId: "meeting" }) };
  const request = body => ({ json: async () => body });
  assert.equal((await api.GET(request({}), context)).status, 401);
  auth = { scopes: ["attendance:read"] };
  assert.equal((await api.GET(request({}), context)).body.item.config, input);
  assert.equal((await api.POST(request({}), context)).status, 403);
  auth = { scopes: ["attendance:write"] };
  assert.equal((await api.PATCH(request({ parameterOverrides: { 3: "new" } }), context)).status, 200);
  assert.deepEqual(config.responseStatuses, input.responseStatuses);
  assert.equal(sent.length, 0);
  const result = await api.POST(request({ studentId: "student", targetStatuses: [] }), context);
  assert.equal(result.body.item.failedMessages, 2);
  assert.deepEqual(sent[0].config.targetStatuses, []);
  assert.deepEqual(config.targetStatuses, ["missing"]);
  assert.equal(sent[0].studentId, "student");
  assert.equal((await api.POST(request({ templateName: "override" }), context)).status, 400);
  assert.equal((await api.POST(request(null), context)).status, 400);
  auth = { scopes: ["attendance:read", "attendance:write"] };
  assert.equal((await api.GET(request({}), { params: { sessionId: "absent" } })).status, 404);
});

test("settings round-trip persists JSON and revalidates before sending", async () => {
  let saved = null;
  let locked = false;
  const deliveries = [];
  const source = readFileSync(new URL("../lib/attendance-whatsapp-settings.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/export /g, "");
  const deps = {
    initDb: async () => {}, sql: async (_, json) => { saved = JSON.parse(json); },
    getAttendanceSessionById: async () => ({ statusOptions: options, whatsappMessageConfig: saved, isLocked: locked }),
    listWhatsAppCoexistenceApprovedTemplates: async () => [template], validateAttendanceWhatsAppConfig,
    sendAttendanceSessionWhatsAppApprovedTemplate: async args => { deliveries.push(args); return { sentMessages: 1 }; }
  };
  const api = new Function(...Object.keys(deps), `${source}\nreturn { saveAttendanceWhatsAppConfig, sendSavedAttendanceWhatsAppConfig };`)(...Object.values(deps));
  await api.saveAttendanceWhatsAppConfig("meeting", input);
  assert.deepEqual(saved.responseStatuses, ["missing", "found"]);
  await api.sendSavedAttendanceWhatsAppConfig({ sessionId: "meeting" });
  assert.deepEqual(deliveries[0].parameterOverrides, { 3: "תוכן קבוע" });
  locked = true;
  await assert.rejects(() => api.sendSavedAttendanceWhatsAppConfig({ sessionId: "meeting" }));
  locked = false;
  saved.responseStatuses = ["deleted", "found"];
  await assert.rejects(() => api.sendSavedAttendanceWhatsAppConfig({ sessionId: "meeting" }));
  assert.equal(deliveries.length, 1);
});
