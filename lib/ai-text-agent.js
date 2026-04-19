import {
  createAiChatMessage,
  listRecentAiChatMessagesByUser,
  getAiChatMessageById
} from "./ai-chat-history";
import { getStudentDocumentsStats } from "./student-documents";
import { createNeonStudentViaTwenty, updateNeonStudentViaTwenty } from "./neon-students";
import { FIELD_SECTIONS, normalizeStudentInput } from "./student-fields";
import {
  buildStudentSummary,
  buildExportUrlForFilters,
  buildNeonViewUrlForAgent,
  describeAgentFilters,
  findStudentsForAgent,
  findStudentsMissingDataForAgent,
  getStudentForAgent,
  getStudentSchemaCatalog,
  inferEnumFiltersFromQuery,
  searchStudentsForAgent
} from "./student-agent";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
export const CRM_SCOPE_MESSAGE = "אני עונה רק על שאלות שקשורות ל-CRM, תלמידים, שדות, סטטוסים, מסמכים ופעולות עבודה במערכת.";

function clean(value) {
  return String(value || "").trim();
}

function extractLastUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return clean(messages[index].content);
  }
  return "";
}

function extractRequestedLimit(text) {
  const raw = clean(text);
  if (!raw) return null;
  const digitMatch = raw.match(/(?:עד|רק|תן לי|תביא לי|הצג|רשימה של)?\s*(\d{1,3})\s*(?:תלמידים|שמות|אנשים|רשומות)?/);
  if (digitMatch) {
    const value = Number(digitMatch[1]);
    if (Number.isFinite(value) && value > 0) return Math.min(value, 100);
  }
  return null;
}

function isQuantitativeListRequest(text) {
  const raw = clean(text);
  if (!raw) return false;
  return ["כמה", "רשימה", "מי זה", "מי זאת", "מי לומד", "מי גר", "תן לי", "תביא לי", "הצג", "שמות"].some((pattern) => raw.includes(pattern));
}

function isChoiceFieldQuery(text) {
  const raw = clean(text);
  if (!raw) return false;
  return ["מוסד", "לומד ב", "לומדים ב", "נשוי", "נשואים", "רווק", "גרוש", "רישום", "דתות", "משרד החינוך", "שיעור", "כיתה", "סטטוס"].some((pattern) => raw.includes(pattern));
}

function isCrmRelevant(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "crm", "תלמיד", "תלמידים", "בן אדם", "אדם", "איש", "בחור", "מי זה", "מי זאת", "של מי", "שם",
    "תמצא", "תחפש", "חפש", "מצא", "מוסד", "לומד", "לומדים", "לומדות", "רישום", "סטטוס", "נשוי",
    "רווק", "שיעור", "כיתה", "עיר", "כתובת", "טלפון", "אימייל", "מייל", "תז", "ת.ז", "זהות",
    "מסמך", "צילום", "אקסל", "כרטיס", "עדכן", "תעדכן", "צור", "תיצור", "הוסף תלמיד"
  ].some((pattern) => raw.includes(pattern));
}

function buildRecentConversationMessages(historyMessages) {
  return historyMessages
    .filter((item) => clean(item?.content))
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: clean(item.content)
    }));
}

function classifyIntent({ text = "", hasChoiceFilters = false } = {}) {
  const raw = clean(text);
  if (!raw) return "empty";
  if (hasChoiceFilters) return "choice_filter";
  if (/עדכן|תעדכן|לשנות|שנה|לתקן|תקן/.test(raw)) return "update_request";
  if (/צור|תיצור|פתח תלמיד|הוסף תלמיד|חדש תלמיד/.test(raw)) return "create_request";
  if (/מסמך|קובץ|תעודה/.test(raw)) return "document_query";
  if (/כמה|לכמה|חלוקה/.test(raw)) return "count_or_summary";
  if (/תמצא|תחפש|מי זה|מי זאת|בשם|של מי/.test(raw)) return "specific_lookup";
  return "general_crm";
}

const FIELD_LABELS = Object.fromEntries(
  FIELD_SECTIONS.flatMap((section) => section.fields.map((field) => [field.key, field.label]))
);

function flattenStudentData(data, prefix = "") {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const items = [];
  for (const [key, value] of Object.entries(data)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      items.push(...flattenStudentData(value, nextKey));
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length) items.push({ field: nextKey, value: value.join(", ") });
      continue;
    }
    const cleaned = clean(value);
    if (!cleaned) continue;
    items.push({ field: nextKey, value: cleaned });
  }
  return items;
}

function buildStudentActionPreview(data) {
  return flattenStudentData(data)
    .slice(0, 12)
    .map((item) => ({
      field: item.field,
      label: FIELD_LABELS[item.field] || item.field,
      value: item.value
    }));
}

function buildPendingActionReply({ title, intro, previewFields, studentName = "" }) {
  const lines = [];
  if (title) lines.push(title);
  if (intro) lines.push(intro);
  if (studentName) lines.push(`תלמיד: ${studentName}`);
  lines.push("הפעולה המוצעת:");
  if (previewFields.length) {
    previewFields.forEach((field, index) => {
      lines.push(`${index + 1}. ${field.label}: ${field.value}`);
    });
  } else {
    lines.push("-");
  }
  lines.push("לא בוצע שום שינוי עדיין. אפשר לאשר או לסרב.");
  return lines.join("\n");
}

function buildSearchSummary({ path = "", query = "", filters = [], minScore = null, tools = [], resultCount = null } = {}) {
  const parts = [];
  const describedFilters = describeAgentFilters(filters);

  if (path === "deterministic") {
    parts.push("בוצע סינון מערכת דטרמיניסטי");
    if (describedFilters.length) parts.push(`לפי: ${describedFilters.join(" | ")}`);
  } else if (path === "tool") {
    const safeQuery = clean(query);
    if (safeQuery) parts.push(`בוצע חיפוש משוער לפי: "${safeQuery}"`);
    if (Number.isFinite(Number(minScore))) parts.push(`סף התאמה ${Math.round(Number(minScore) * 100)}%`);
    if (describedFilters.length) parts.push(`עם מסננים: ${describedFilters.join(" | ")}`);
    if (tools.length) parts.push(`כלים: ${tools.join(", ")}`);
  }

  if (Number.isFinite(Number(resultCount))) {
    parts.push(`נמצאו ${Number(resultCount)} תוצאות`);
  }

  return parts.join(" | ");
}

function buildQuantitativeReply({ students, requestedLimit, viewUrl }) {
  const total = students.length;
  if (!total) return "לא נמצאו תלמידים מתאימים.";
  const displayLimit = requestedLimit || Math.min(total, total > 7 ? 7 : 200);
  const displayed = students.slice(0, displayLimit);
  const lines = [
    `נמצאו ${total} תלמידים.`,
    ...displayed.map((student, index) => `${index + 1}. ${student?.label || student?.name || "ללא שם"}`)
  ];
  if (displayed.length < total) {
    lines.push(`מוצגים ${displayed.length} מתוך ${total}. מומלץ לפתוח במסך מלא כדי לראות את כל הרשימה, לבחור תלמידים ולעדכן שדות בחירה בצורה מרוכזת.`);
    if (viewUrl) lines.push("הכפתור למסך המלא מופיע מתחת לתשובה.");
  }
  return lines.join("\n");
}

function collectStudentCards(target, payload) {
  const candidates = [];
  if (Array.isArray(payload?.items)) candidates.push(...payload.items);
  if (payload?.item) candidates.push(payload.item);
  if (payload?.summary) candidates.push(payload);
  for (const item of candidates) {
    const summary = item?.summary || item;
    if (!summary?.id || !summary?.studentCardUrl) continue;
    target.set(summary.id, summary);
  }
}

function collectPendingAction(payload) {
  return payload?.pendingAction && typeof payload.pendingAction === "object"
    ? payload.pendingAction
    : null;
}

async function callOpenAI(messages, tools) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages,
      tools,
      tool_choice: "auto"
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
  return data?.choices?.[0]?.message || null;
}

async function executeToolCall(toolCall) {
  const name = toolCall?.function?.name;
  const rawArguments = toolCall?.function?.arguments || "{}";
  let args = {};
  try { args = JSON.parse(rawArguments); } catch {}

  if (name === "get_schema_catalog") return { ok: true, tool: name, catalog: getStudentSchemaCatalog() };

  if (name === "search_students") {
    const items = await searchStudentsForAgent({ query: args?.query, filters: args?.filters, limit: args?.limit });
    return { ok: true, tool: name, count: items.length, items };
  }

  if (name === "count_student_documents") {
    const result = await findStudentsForAgent({ query: args?.query, filters: args?.filters, minScore: 0.4 });
    const targetIds = result.effectiveFilters.length || clean(args?.query) ? result.students.map((student) => student.id) : [];
    const stats = await getStudentDocumentsStats({ studentIds: targetIds });
    return { ok: true, tool: name, ...stats, studentCount: targetIds.length || null };
  }

  if (name === "find_students_missing_data") {
    const result = await findStudentsMissingDataForAgent({
      type: clean(args?.type) === "identity" ? "identity" : "contact",
      query: args?.query,
      filters: args?.filters,
      limit: args?.limit
    });
    return { ok: true, tool: name, count: result.count, items: result.students };
  }

  if (name === "propose_create_student") {
    const data = normalizeStudentInput(args?.data || {});
    const previewFields = buildStudentActionPreview(data);
    if (!Object.keys(data).length) return { ok: false, tool: name, error: "אין מספיק שדות תקינים להצעת יצירת תלמיד." };
    return {
      ok: true,
      tool: name,
      pendingAction: {
        id: crypto.randomUUID(),
        type: "create_student_manual",
        createStudentData: data,
        previewFields
      },
      reply: buildPendingActionReply({
        title: "הצעתי יצירת תלמיד חדש",
        intro: "זיהיתי בקשה ליצירת תלמיד.",
        previewFields
      })
    };
  }

  if (name === "propose_update_student") {
    const studentId = clean(args?.studentId);
    const existingStudent = await getStudentForAgent(studentId);
    if (!existingStudent?.summary?.id) return { ok: false, tool: name, error: "לא נמצא תלמיד לעדכון." };
    const data = normalizeStudentInput(args?.data || {});
    const previewFields = buildStudentActionPreview(data);
    if (!Object.keys(data).length) return { ok: false, tool: name, error: "אין שדות תקינים לעדכון." };
    return {
      ok: true,
      tool: name,
      item: existingStudent,
      pendingAction: {
        id: crypto.randomUUID(),
        type: "update_student",
        studentId,
        updateStudentData: data,
        previewFields
      },
      reply: buildPendingActionReply({
        title: "הצעתי עדכון תלמיד",
        intro: "זיהיתי בקשה לעדכון שדות בכרטיס תלמיד.",
        previewFields,
        studentName: existingStudent.summary.name
      })
    };
  }

  if (name === "get_student") {
    const item = await getStudentForAgent(args?.studentId);
    return { ok: Boolean(item), tool: name, item };
  }

  return { ok: false, tool: name, error: `Unsupported tool: ${name || "unknown"}` };
}

function buildTools() {
  return [
    { type: "function", function: { name: "get_schema_catalog", description: "Return all CRM student fields, labels, and enum values such as CY=חכמי ירושלים.", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "search_students", description: "Search CRM students by free text and/or field filters. Returns concise student summaries and matched fields only.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" }, filters: { type: "array", items: { type: "object", properties: { field: { type: "string" }, operator: { type: "string", enum: ["contains", "equals", "starts_with", "ends_with", "empty", "not_empty"] }, value: { type: "string" } }, required: ["field", "operator"] } } } } } },
    { type: "function", function: { name: "count_student_documents", description: "Count attached student documents, optionally within a filtered student set.", parameters: { type: "object", properties: { query: { type: "string" }, filters: { type: "array", items: { type: "object", properties: { field: { type: "string" }, operator: { type: "string", enum: ["contains", "equals", "starts_with", "ends_with", "empty", "not_empty"] }, value: { type: "string" } }, required: ["field", "operator"] } } } } } },
    { type: "function", function: { name: "find_students_missing_data", description: "Find students with missing contact or identity data.", parameters: { type: "object", properties: { type: { type: "string", enum: ["contact", "identity"] }, query: { type: "string" }, limit: { type: "number" }, filters: { type: "array", items: { type: "object", properties: { field: { type: "string" }, operator: { type: "string", enum: ["contains", "equals", "starts_with", "ends_with", "empty", "not_empty"] }, value: { type: "string" } }, required: ["field", "operator"] } } } } } },
    { type: "function", function: { name: "propose_create_student", description: "Prepare a student creation proposal. Do not create immediately. Use when the user explicitly asks to create a student.", parameters: { type: "object", properties: { data: { type: "object", description: "Student fields to create" } }, required: ["data"] } } },
    { type: "function", function: { name: "propose_update_student", description: "Prepare a student update proposal. Do not update immediately. Use only when the user explicitly asks to update a known student.", parameters: { type: "object", properties: { studentId: { type: "string" }, data: { type: "object", description: "Student fields to update" } }, required: ["studentId", "data"] } } },
    { type: "function", function: { name: "get_student", description: "Get one student by exact CRM student id.", parameters: { type: "object", properties: { studentId: { type: "string" } }, required: ["studentId"] } } }
  ];
}

export async function processTextAiMessage({ user, messageText, source = "web" }) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const lastUserMessage = clean(messageText);
  const inferredChoiceFilters = inferEnumFiltersFromQuery(lastUserMessage);
  if (!isCrmRelevant(lastUserMessage) && !inferredChoiceFilters.length) {
    return { reply: CRM_SCOPE_MESSAGE, studentCards: [] };
  }

  const recentHistory = await listRecentAiChatMessagesByUser(user.clerk_user_id, { limit: 8, withinMinutes: 45 });
  const recentConversation = buildRecentConversationMessages(recentHistory);
  const requestedLimit = extractRequestedLimit(lastUserMessage);
  const quantitativeListRequest = isQuantitativeListRequest(lastUserMessage);
  const choiceFieldQuery = isChoiceFieldQuery(lastUserMessage) || inferredChoiceFilters.length > 0;

  if (quantitativeListRequest || choiceFieldQuery) {
    const { students, effectiveFilters } = await findStudentsForAgent({ query: lastUserMessage, minScore: 0.4 });
    const finalStudentCards = students.slice(0, 7).map((student) => buildStudentSummary(student)).filter(Boolean);
    const exportUrl = effectiveFilters.length ? buildExportUrlForFilters(effectiveFilters) : "";
    const viewUrl = buildNeonViewUrlForAgent({ query: lastUserMessage, filters: effectiveFilters });
    const reply = buildQuantitativeReply({ students, requestedLimit, viewUrl });
    const searchSummary = buildSearchSummary({ path: "deterministic", query: lastUserMessage, filters: effectiveFilters, resultCount: students.length });
    const intentType = classifyIntent({ text: lastUserMessage, hasChoiceFilters: inferredChoiceFilters.length > 0 });

    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "deterministic", source } });
    const assistantMessage = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: reply,
      metadata: { studentCards: finalStudentCards, exportUrl, viewUrl, intentType, path: "deterministic", resultCount: students.length, searchSummary, source }
    });

    return { ...assistantMessage, reply, exportUrl, viewUrl, searchSummary, pendingAction: null };
  }

  const systemPrompt = {
    role: "system",
    content: [
      "אתה סוכן מידע פנימי של מערכת CRM תלמידים.",
      "אתה עונה רק על בסיס כלי המערכת והמידע שהוחזר מהם.",
      "כאשר נשאלת שאלה על תלמיד או רשימת תלמידים, השתמש בכלי החיפוש לפני מתן תשובה.",
      "כאשר המשתמש מבקש ליצור תלמיד או לעדכן שדות, לעולם אל תבצע פעולה ישירה. השתמש רק בכלי proposal כדי להציע פעולה ממתינה לאישור.",
      "כאשר המשתמש כותב בן אדם, אדם, איש, בחור, מי זה או מי זאת בהקשר חיפוש, הכוונה היא לתלמיד במערכת.",
      "חיפוש שמות חייב להיות משוער לפי ציון התאמה ולא התאמה מדויקת בלבד. גם אם יש שגיאת כתיב בשם, השתמש בכלי search_students עם טקסט השם.",
      "אל תכתוב כתובות URL של כרטיסי תלמיד בגוף התשובה. אם יש כרטיס תלמיד, המערכת תציג קישור נפרד.",
      "כאשר השאלה עוסקת במוסד, שיעור, רישום או סטטוס משפחתי, העדף search_students עם filters על שדות enum ולא רק query חופשי.",
      "אם המשתמש כתב שם אנושי של ערך בחירה כמו חכמי ירושלים, התאם אותו לערך המערכת המתאים כמו CY.",
      "אם יש יותר מתוצאה אחת, ציין זאת במפורש וסכם כל תלמיד בשורה קצרה.",
      requestedLimit ? `המשתמש ביקש במפורש מספר תוצאות. השתמש לכל היותר ב-${requestedLimit} תוצאות אלא אם ביקש אחרת.` : "",
      "אם אין מספיק מידע, בקש הבהרה קצרה.",
      "ענה בעברית, בצורה קצרה וברורה."
    ].filter(Boolean).join(" ")
  };

  const messages = [systemPrompt, ...recentConversation, { role: "user", content: lastUserMessage }];
  const tools = buildTools();
  const referencedStudents = new Map();
  const usedTools = [];
  let finalPendingAction = null;
  let finalMessage = "";

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const assistantMessage = await callOpenAI(messages, tools);
    if (!assistantMessage) break;
    if (Array.isArray(assistantMessage.tool_calls) && assistantMessage.tool_calls.length) {
      messages.push({ role: "assistant", content: assistantMessage.content || "", tool_calls: assistantMessage.tool_calls });
      for (const toolCall of assistantMessage.tool_calls) {
        const result = await executeToolCall(toolCall);
        if (toolCall?.function?.name) usedTools.push(toolCall.function.name);
        collectStudentCards(referencedStudents, result);
        finalPendingAction = collectPendingAction(result) || finalPendingAction;
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
      continue;
    }
    finalMessage = clean(assistantMessage.content);
    break;
  }

  const finalStudentCards = Array.from(referencedStudents.values()).slice(0, 7);
  const intentType = classifyIntent({ text: lastUserMessage, hasChoiceFilters: inferredChoiceFilters.length > 0 });
  const searchSummary = buildSearchSummary({ path: "tool", query: lastUserMessage, minScore: 0.4, tools: Array.from(new Set(usedTools)), resultCount: finalStudentCards.length });

  await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "tool", source } });
  const assistantSaved = await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "assistant",
    content: finalMessage || "לא הצלחתי להשלים תשובה.",
    metadata: { studentCards: finalStudentCards, intentType, path: "tool", resultCount: finalStudentCards.length, searchSummary, pendingAction: finalPendingAction, source }
  });

  return {
    ...assistantSaved,
    reply: finalMessage || "לא הצלחתי להשלים תשובה.",
    studentCards: finalStudentCards,
    searchSummary,
    pendingAction: finalPendingAction
  };
}

export async function handleApprovedAiAction({ user, decision, pendingAction }) {
  if (!pendingAction || typeof pendingAction !== "object") throw new Error("Missing pending action");
  if (decision === "reject") {
    const reply = "הפעולה נדחתה. לא בוצע שום שינוי.";
    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "assistant", content: reply, metadata: { searchSummary: "הפעולה נדחתה על ידי המשתמש" } });
    return { reply, studentCards: [], searchSummary: "הפעולה נדחתה על ידי המשתמש" };
  }
  if (decision !== "approve") throw new Error("Invalid decision");

  if (pendingAction.type === "update_student") {
    const updatedStudent = await updateNeonStudentViaTwenty(clean(pendingAction.studentId), pendingAction.updateStudentData || {});
    if (!updatedStudent?.id) throw new Error("עדכון התלמיד נכשל.");
    const reply = `העדכון בוצע בכרטיס התלמיד: ${updatedStudent.label || updatedStudent.name || updatedStudent.id}.`;
    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "assistant", content: reply, metadata: { studentCards: [buildStudentSummary(updatedStudent)], searchSummary: "בוצע עדכון תלמיד אחרי אישור מפורש" } });
    return { reply, studentCards: [buildStudentSummary(updatedStudent)], searchSummary: "בוצע עדכון תלמיד אחרי אישור מפורש" };
  }

  if (pendingAction.type === "create_student_manual") {
    const createdStudent = await createNeonStudentViaTwenty(pendingAction.createStudentData || {});
    const reply = `נוצר תלמיד חדש: ${createdStudent?.label || createdStudent?.name || createdStudent?.id || "-"}.`;
    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "assistant", content: reply, metadata: { studentCards: createdStudent ? [buildStudentSummary(createdStudent)] : [], searchSummary: "בוצעה יצירת תלמיד אחרי אישור מפורש" } });
    return { reply, studentCards: createdStudent ? [buildStudentSummary(createdStudent)] : [], searchSummary: "בוצעה יצירת תלמיד אחרי אישור מפורש" };
  }

  throw new Error("Unsupported pending action for this channel.");
}

export async function getPendingActionForMessage({ clerkUserId, messageId }) {
  const message = await getAiChatMessageById({ clerkUserId, messageId });
  return message?.pendingAction || null;
}
