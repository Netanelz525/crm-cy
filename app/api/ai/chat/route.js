import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import {
  createAiChatMessage,
  listAiChatMessagesByUser,
  listRecentAiChatMessagesByUser,
  setAiChatMessageFeedback,
  getAiChatMessageById,
  clearAiChatMessagePendingAction
} from "../../../../lib/ai-chat-history";
import { createStudentDocumentFromStoredObject } from "../../../../lib/student-documents";
import { createNeonStudentViaTwenty, updateNeonStudentViaTwenty } from "../../../../lib/neon-students";
import { uploadBufferToR2 } from "../../../../lib/r2";
import { FIELD_SECTIONS, normalizeStudentInput } from "../../../../lib/student-fields";
import { processTextAiMessage } from "../../../../lib/ai-text-agent";
import { processDocumentAttachment } from "../../../../lib/ai-document-agent";
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
} from "../../../../lib/student-agent";
import { getStudentDocumentsStats } from "../../../../lib/student-documents";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const CRM_SCOPE_MESSAGE = "אני עונה רק על שאלות שקשורות ל-CRM, תלמידים, שדות, סטטוסים, מסמכים ופעולות עבודה במערכת.";

function clean(value) {
  return String(value || "").trim();
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function parseMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: clean(item?.content)
    }))
    .filter((item) => item.content)
    .slice(-12);
}

async function parseIncomingRequest(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const message = clean(formData.get("message"));
    const file = formData.get("file");
    return {
      messages: message ? [{ role: "user", content: message }] : [],
      attachment: file instanceof File ? file : null
    };
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return { messages: [], attachment: null };
  return {
    messages: parseMessages(body.messages),
    attachment: null
  };
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

  const hebrewNumbers = {
    אחד: 1,
    אחת: 1,
    שניים: 2,
    שתיים: 2,
    שני: 2,
    שתי: 2,
    שלושה: 3,
    שלוש: 3,
    ארבעה: 4,
    ארבע: 4,
    חמישה: 5,
    חמש: 5,
    שישה: 6,
    שש: 6,
    שבעה: 7,
    שבע: 7,
    שמונה: 8,
    תשעה: 9,
    תשע: 9,
    עשרה: 10,
    עשר: 10
  };

  for (const [label, value] of Object.entries(hebrewNumbers)) {
    if (raw.includes(label)) return value;
  }

  return null;
}

function isQuantitativeListRequest(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "כמה",
    "איזה",
    "רשימה",
    "רשומים",
    "רשומות",
    "מי זה",
    "מי זאת",
    "מי לומד",
    "מי גר",
    "תן לי",
    "תביא לי",
    "הצג",
    "שמות"
  ].some((pattern) => raw.includes(pattern));
}

function isChoiceFieldQuery(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "מוסד",
    "לומד ב",
    "לומדים ב",
    "נשוי",
    "נשואים",
    "רווק",
    "גרוש",
    "רישום",
    "דתות",
    "משרד החינוך",
    "שיעור",
    "כיתה",
    "סטטוס"
  ].some((pattern) => raw.includes(pattern));
}

function isCrmRelevant(text, hasAttachment = false) {
  if (hasAttachment) return true;
  const raw = clean(text);
  if (!raw) return false;
  return [
    "crm",
    "תלמיד",
    "תלמידים",
    "בן אדם",
    "אדם",
    "איש",
    "בחור",
    "מי זה",
    "מי זאת",
    "של מי",
    "שם",
    "תמצא",
    "תחפש",
    "חפש",
    "מצא",
    "מוסד",
    "לומד",
    "לומדים",
    "לומדות",
    "רישום",
    "סטטוס",
    "נשוי",
    "רווק",
    "שיעור",
    "כיתה",
    "עיר",
    "כתובת",
    "טלפון",
    "אימייל",
    "מייל",
    "תז",
    "ת.ז",
    "זהות",
    "מסמך",
    "צילום",
    "אקסל",
    "כרטיס"
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
  } else if (path === "document") {
    parts.push("בוצע ניתוח מסמך וחיפוש תלמיד תואם");
  }

  if (Number.isFinite(Number(resultCount))) {
    parts.push(`נמצאו ${Number(resultCount)} תוצאות`);
  }

  return parts.join(" | ");
}

function classifyIntent({ text = "", hasAttachment = false, hasChoiceFilters = false } = {}) {
  if (hasAttachment) return "document_upload";
  const raw = clean(text);
  if (!raw) return "empty";
  if (/צור|תיצור|ליצור|יצירת|פתח תלמיד|תפתח תלמיד|פתיחת תלמיד|לפתוח תלמיד|הוסף תלמיד|תוסיף תלמיד|חדש תלמיד|תלמיד חדש|כרטיס חדש|פתח כרטיס|תפתח כרטיס/.test(raw)) return "create_request";
  if (hasChoiceFilters && isQuantitativeListRequest(raw)) return "choice_filter";
  if (/עדכן|תעדכן|לשנות|שנה|לתקן|תקן/.test(raw)) return "update_request";
  if (hasChoiceFilters) return "choice_filter";
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

async function fileToDataUrl(file) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = clean(file.type) || "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function fileToDocumentImageDataUrls(file) {
  const contentType = clean(file?.type).toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());

  if (contentType.startsWith("image/")) {
    return [`data:${contentType};base64,${bytes.toString("base64")}`];
  }

  if (contentType !== "application/pdf") return [];

  const images = [];
  let cursor = 0;
  while (images.length < 6) {
    const streamIndex = bytes.indexOf("stream", cursor, "latin1");
    if (streamIndex < 0) break;

    let start = streamIndex + "stream".length;
    if (bytes[start] === 0x0d && bytes[start + 1] === 0x0a) start += 2;
    else if (bytes[start] === 0x0a || bytes[start] === 0x0d) start += 1;

    const end = bytes.indexOf("endstream", start, "latin1");
    if (end < 0) break;

    const chunk = bytes.subarray(start, end);
    const jpegStart = chunk.indexOf(Buffer.from([0xff, 0xd8]));
    const jpegEnd = chunk.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (jpegStart >= 0 && jpegEnd > jpegStart) {
      const jpg = chunk.subarray(jpegStart, jpegEnd + 2);
      images.push(`data:image/jpeg;base64,${jpg.toString("base64")}`);
    }

    cursor = end + "endstream".length;
  }

  return images;
}

async function storePendingDocumentFile(file) {
  const contentType = clean(file?.type) || "application/octet-stream";
  const fileName = clean(file?.name) || "document";
  const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "bin";
  const id = crypto.randomUUID();
  const objectKey = `ai-pending-documents/${id}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await uploadBufferToR2({
    key: objectKey,
    buffer,
    contentType,
    contentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"`
  });

  return {
    id,
    objectKey,
    fileName,
    contentType,
    sizeBytes: buffer.length
  };
}

function normalizeExtractedFields(fields) {
  if (!Array.isArray(fields)) return [];
  const allowedFields = new Set([
    "fullName.firstName",
    "fullName.lastName",
    "tznum",
    "dateofbirth",
    "adders.addressStreet1",
    "adders.addressStreet2",
    "adders.addressCity",
    "adders.addressPostcode",
    "phone.primaryPhoneNumber",
    "email.primaryEmail",
    "shmHb",
    "shmHm",
    "tzaba",
    "tzMotherNum"
  ]);

  return fields
    .map((field) => ({
      field: clean(field?.field),
      label: clean(field?.label),
      value: clean(field?.value),
      confidence: Number(field?.confidence) || null
    }))
    .filter((field) => allowedFields.has(field.field) && field.value)
    .slice(0, 12);
}

async function extractStudentDocumentInfo(file) {
  if (!file) {
    throw new Error("לא התקבל מסמך.");
  }

  const contentType = clean(file.type).toLowerCase();
  const imageUrls = await fileToDocumentImageDataUrls(file);
  if (!imageUrls.length) {
    return {
      documentName: clean(file.name),
      documentType: contentType === "application/pdf" ? "PDF" : "מסמך",
      documentSummary: "הקובץ נשמר זמנית וניתן לשייך אותו לכרטיס תלמיד אחרי אישור. לא נמצאה תמונה לחילוץ פרטים.",
      firstName: "",
      lastName: "",
      fullName: "",
      tznum: "",
      updatableFields: []
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Extract structured CRM information from the uploaded student document.",
            "The image may be an Israeli identity card (Teudat Zehut), a form, or a student document in Hebrew.",
            "If multiple images are provided, they may be front and back sides of the same Israeli ID card. Combine evidence from all images.",
            "For Israeli ID cards, carefully OCR Hebrew and numeric text. Israeli ID numbers are usually 9 digits; preserve leading zeros if visible.",
            "Do not return empty identity fields if the text is visible. If a 9 digit number is visible, use it as tznum.",
            "Look for Hebrew labels such as שם פרטי, שם משפחה, מספר זהות, ת.ז, זהות, תאריך לידה, מען, כתובת, אב, אם.",
            "Return strict JSON with keys:",
            "documentName, documentType, documentSummary, firstName, lastName, fullName, tznum, updatableFields.",
            "updatableFields must be an array of objects with field, label, value, confidence.",
            "Only include CRM fields that can reasonably update the student card.",
            "Supported field names: fullName.firstName, fullName.lastName, tznum, dateofbirth, adders.addressStreet1, adders.addressStreet2, adders.addressCity, adders.addressPostcode, phone.primaryPhoneNumber, email.primaryEmail, shmHb, shmHm, tzaba, tzMotherNum.",
            "Use empty strings or empty arrays if unknown."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            { type: "text", text: "נתח את המסמך והחזר סוג מסמך, תקציר, פרטי תלמיד ושדות CRM שאפשר לעדכן." },
            ...imageUrls.map((imageUrl) => ({ type: "image_url", image_url: { url: imageUrl, detail: "high" } }))
          ]
        }
      ]
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "OCR extraction failed");

  const raw = data?.choices?.[0]?.message?.content || "{}";
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    documentName: clean(parsed.documentName) || clean(file.name),
    documentType: clean(parsed.documentType) || "מסמך תלמיד",
    documentSummary: clean(parsed.documentSummary),
    firstName: clean(parsed.firstName),
    lastName: clean(parsed.lastName),
    fullName: clean(parsed.fullName),
    tznum: clean(parsed.tznum).replace(/[^\d]/g, ""),
    updatableFields: normalizeExtractedFields(parsed.updatableFields)
  };
}

function buildCreateStudentDataFromDocument(documentInfo) {
  const data = {};
  if (documentInfo.firstName || documentInfo.lastName) {
    data.fullName = {
      ...(documentInfo.firstName ? { firstName: documentInfo.firstName } : {}),
      ...(documentInfo.lastName ? { lastName: documentInfo.lastName } : {})
    };
  }
  if (documentInfo.tznum) data.tznum = documentInfo.tznum;

  for (const field of documentInfo.updatableFields || []) {
    if (!field?.field || !field?.value) continue;
    if (field.field === "fullName.firstName") data.fullName = { ...(data.fullName || {}), firstName: field.value };
    else if (field.field === "fullName.lastName") data.fullName = { ...(data.fullName || {}), lastName: field.value };
    else if (field.field === "tznum") data.tznum = field.value;
    else if (field.field === "dateofbirth") data.dateofbirth = field.value;
    else if (field.field === "phone.primaryPhoneNumber") data.phone = { ...(data.phone || {}), primaryPhoneNumber: field.value };
    else if (field.field === "email.primaryEmail") data.email = { ...(data.email || {}), primaryEmail: field.value };
    else if (field.field.startsWith("adders.")) {
      const key = field.field.slice("adders.".length);
      data.adders = { ...(data.adders || {}), [key]: field.value };
    } else {
      data[field.field] = field.value;
    }
  }

  return data;
}

function buildDocumentAnalysisReply({ documentInfo, students }) {
  const matchedStudent = students.length === 1 ? students[0] : null;
  const lines = [
    `מסמך: ${documentInfo.documentName || "ללא שם"}`,
    `סוג מסמך: ${documentInfo.documentType || "לא זוהה"}`,
    `תקציר: ${documentInfo.documentSummary || "לא זוהה תקציר ברור."}`,
    "",
    "פרטי תלמיד שזוהו:",
    `שם פרטי: ${documentInfo.firstName || "-"}`,
    `שם משפחה: ${documentInfo.lastName || "-"}`,
    `שם מלא: ${documentInfo.fullName || "-"}`,
    `מספר זהות: ${documentInfo.tznum || "-"}`
  ];

  if (matchedStudent) {
    lines.push("", `התאמה ב-CRM: ${matchedStudent.label}`, "לא ביצעתי שיוך עדיין. אשר כדי לשייך את המסמך לכרטיס התלמיד.");
  } else if (students.length > 1) {
    lines.push("", `נמצאו ${students.length} התאמות אפשריות. יש לבחור כרטיס תלמיד לפני שיוך.`);
  } else {
    lines.push("", "לא נמצאה התאמה ב-CRM. אפשר לאשר יצירת תלמיד חדש על בסיס הנתונים שזוהו.");
  }

  lines.push("", "שדות שאפשר לעדכן:");
  if (documentInfo.updatableFields.length) {
    documentInfo.updatableFields.forEach((field, index) => {
      lines.push(`${index + 1}. ${field.label || field.field}: ${field.value}`);
    });
  } else {
    lines.push("-");
  }

  return lines.join("\n");
}

async function handleDocumentMatchFlow({ user, attachment, messageText }) {
  const storedDocument = await storePendingDocumentFile(attachment);
  const documentInfo = await extractStudentDocumentInfo(attachment);
  let query = documentInfo.tznum || documentInfo.fullName || [documentInfo.firstName, documentInfo.lastName].filter(Boolean).join(" ");
  if (!query) query = clean(messageText);

  const filters = documentInfo.tznum ? [{ field: "tznum", operator: "equals", value: documentInfo.tznum }] : [];
  const { students, effectiveFilters } = await findStudentsForAgent({ query, filters, minScore: 0.22 });
  const finalStudentCards = students.slice(0, 10).map((student) => buildStudentSummary(student)).filter(Boolean);

  const pendingAction = students.length === 1 || students.length === 0 ? {
    id: crypto.randomUUID(),
    type: students.length === 1 ? "attach_document" : "create_student",
    suggestedStudentId: students.length === 1 ? students[0].id : "",
    storedDocument,
    documentInfo,
    createStudentData: buildCreateStudentDataFromDocument(documentInfo)
  } : null;

  const reply = buildDocumentAnalysisReply({ documentInfo, students });
  const exportUrl = effectiveFilters.length ? buildExportUrlForFilters(effectiveFilters) : "";
  const intentType = classifyIntent({ text: messageText, hasAttachment: true });
  const searchSummary = buildSearchSummary({
    path: "document",
    query,
    filters: effectiveFilters,
    resultCount: students.length
  });
  await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "user",
    content: messageText || `הועלה מסמך: ${clean(attachment.name) || "ללא שם"}`,
    metadata: {
      intentType,
      path: "document"
    }
  });
  await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "assistant",
    content: reply,
      metadata: {
        studentCards: finalStudentCards,
        exportUrl,
        attachmentName: clean(attachment.name),
        documentInfo,
        extractedIdentity: documentInfo,
        updatableFields: documentInfo.updatableFields,
        pendingAction,
        suggestedAction: students.length ? "" : "create_student",
        intentType,
        path: "document",
        resultCount: students.length,
        searchSummary
      }
    });

  return NextResponse.json({
    reply,
    studentCards: finalStudentCards,
    exportUrl,
    documentInfo,
    extractedIdentity: documentInfo,
    updatableFields: documentInfo.updatableFields,
    pendingAction,
    suggestedAction: students.length ? "" : "create_student",
    searchSummary
  });
}

export async function PUT(request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return unauthorized();
    if (!user.is_team_member && !user.is_manager) return forbidden();

    const body = await request.json().catch(() => null);
    const decision = clean(body?.decision);
    const messageId = clean(body?.messageId);
    const messageRecord = messageId
      ? await getAiChatMessageById({ clerkUserId: user.clerk_user_id, messageId })
      : null;
    const pendingAction = messageRecord?.pendingAction || body?.pendingAction;
    if (!pendingAction || typeof pendingAction !== "object") {
      return badRequest("Missing pending action");
    }

    const clearPendingAction = async () => {
      if (!messageId) return;
      await clearAiChatMessagePendingAction({
        messageId,
        clerkUserId: user.clerk_user_id
      });
    };

    if (decision === "reject") {
      await clearPendingAction();
      const reply = "הפעולה נדחתה. לא נוצר תלמיד ולא שויך מסמך.";
      await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "assistant", content: reply });
      return NextResponse.json({ reply });
    }

    if (decision !== "approve") {
      return badRequest("Invalid decision");
    }

    if (pendingAction.type === "update_student") {
      const studentId = clean(pendingAction.studentId);
      const data = pendingAction.updateStudentData || {};
      if (!studentId || !Object.keys(data).length) {
        return badRequest("Missing student update payload.");
      }
      const updatedStudent = await updateNeonStudentViaTwenty(studentId, data);
      if (!updatedStudent?.id) throw new Error("עדכון התלמיד נכשל.");

      const reply = `העדכון בוצע בכרטיס התלמיד: ${updatedStudent.label || updatedStudent.name || updatedStudent.id}.`;

      await createAiChatMessage({
        clerkUserId: user.clerk_user_id,
        role: "assistant",
        content: reply,
        metadata: {
          studentCards: [buildStudentSummary(updatedStudent)].filter(Boolean),
          searchSummary: "בוצע עדכון תלמיד אחרי אישור מפורש"
        }
      });

      await clearPendingAction();
      return NextResponse.json({
        reply,
        studentCards: [buildStudentSummary(updatedStudent)].filter(Boolean),
        searchSummary: "בוצע עדכון תלמיד אחרי אישור מפורש"
      });
    }

    let studentId = clean(pendingAction.suggestedStudentId);
    let createdStudent = null;
    if (pendingAction.type === "create_student" || pendingAction.type === "create_student_manual") {
      const data = pendingAction.createStudentData || {};
      if (!Object.keys(data).length) {
        return badRequest("אין מספיק פרטים ליצירת תלמיד.");
      }
      try {
        createdStudent = await createNeonStudentViaTwenty(data);
      } catch (error) {
        if (error?.code === "DUPLICATE_STUDENT") {
          const existingStudent = error?.student || null;
          const reply = `לא נוצר תלמיד חדש כי נמצאה כפילות: ${error?.message || "כבר קיים תלמיד דומה במערכת."}`;

          await createAiChatMessage({
            clerkUserId: user.clerk_user_id,
            role: "assistant",
            content: reply,
            metadata: {
              studentCards: existingStudent ? [buildStudentSummary(existingStudent)].filter(Boolean) : [],
              searchSummary: "נמנעה יצירת תלמיד כפול"
            }
          });

          await clearPendingAction();
          return NextResponse.json({
            reply,
            studentCards: existingStudent ? [buildStudentSummary(existingStudent)].filter(Boolean) : [],
            searchSummary: "נמנעה יצירת תלמיד כפול"
          });
        }
        throw error;
      }
      studentId = clean(createdStudent?.id);
      if (!studentId) throw new Error("יצירת התלמיד נכשלה.");
    }

    if (pendingAction.type === "create_student_manual") {
      const reply = `נוצר תלמיד חדש: ${createdStudent?.label || createdStudent?.name || studentId}.`;

      await createAiChatMessage({
        clerkUserId: user.clerk_user_id,
        role: "assistant",
        content: reply,
        metadata: {
          studentCards: createdStudent ? [buildStudentSummary(createdStudent)].filter(Boolean) : [],
          searchSummary: "בוצעה יצירת תלמיד אחרי אישור מפורש"
        }
      });

      await clearPendingAction();
      return NextResponse.json({
        reply,
        studentCards: createdStudent ? [buildStudentSummary(createdStudent)].filter(Boolean) : [],
        searchSummary: "בוצעה יצירת תלמיד אחרי אישור מפורש"
      });
    }

    if (!studentId) return badRequest("Missing student id for document attachment.");

    const documentInfo = pendingAction.documentInfo || {};
    const storedDocument = pendingAction.storedDocument || {};
    const document = await createStudentDocumentFromStoredObject({
      studentId,
      uploadedByUserId: user.clerk_user_id,
      fileName: storedDocument.fileName,
      displayName: documentInfo.documentName || storedDocument.fileName,
      noteText: documentInfo.documentSummary,
      contentType: storedDocument.contentType,
      objectKey: storedDocument.objectKey,
      sizeBytes: storedDocument.sizeBytes,
      documentKind: "id"
    });

    const reply = createdStudent
      ? `נוצר תלמיד חדש והמסמך שויך לכרטיס: ${createdStudent.label || createdStudent.name || studentId}.`
      : "המסמך שויך לכרטיס התלמיד.";

    await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: reply,
      metadata: {
        attachedDocumentId: document.id,
        studentCards: createdStudent ? [buildStudentSummary(createdStudent)].filter(Boolean) : []
      }
    });

    await clearPendingAction();
    return NextResponse.json({
      reply,
      attachedDocumentId: document.id,
      studentCards: createdStudent ? [buildStudentSummary(createdStudent)].filter(Boolean) : []
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Document action failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return unauthorized();
    if (!user.is_team_member && !user.is_manager) return forbidden();

    const body = await request.json().catch(() => null);
    const messageId = clean(body?.messageId);
    const feedback = clean(body?.feedback);
    if (!messageId || !feedback) return badRequest("Missing feedback payload");

    const result = await setAiChatMessageFeedback({
      messageId,
      clerkUserId: user.clerk_user_id,
      feedback
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Feedback update failed" },
      { status: 500 }
    );
  }
}

function buildQuantitativeReply({ query, students, requestedLimit, viewUrl }) {
  const total = students.length;
  if (!total) {
    return "לא נמצאו תלמידים מתאימים.";
  }

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
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  return data?.choices?.[0]?.message || null;
}

async function executeToolCall(toolCall) {
  const name = toolCall?.function?.name;
  const rawArguments = toolCall?.function?.arguments || "{}";
  let args = {};

  try {
    args = JSON.parse(rawArguments);
  } catch {
    args = {};
  }

  if (name === "get_schema_catalog") {
    return {
      ok: true,
      tool: name,
      catalog: getStudentSchemaCatalog()
    };
  }

  if (name === "search_students") {
    const items = await searchStudentsForAgent({
      query: args?.query,
      filters: args?.filters,
      limit: args?.limit
    });
    return {
      ok: true,
      tool: name,
      count: items.length,
      items
    };
  }

  if (name === "count_student_documents") {
    const result = await findStudentsForAgent({
      query: args?.query,
      filters: args?.filters,
      minScore: 0.4
    });
    const targetIds = result.effectiveFilters.length || clean(args?.query)
      ? result.students.map((student) => student.id)
      : [];
    const stats = await getStudentDocumentsStats({ studentIds: targetIds });
    return {
      ok: true,
      tool: name,
      ...stats,
      studentCount: targetIds.length || null
    };
  }

  if (name === "find_students_missing_data") {
    const result = await findStudentsMissingDataForAgent({
      type: clean(args?.type) === "identity" ? "identity" : "contact",
      query: args?.query,
      filters: args?.filters,
      limit: args?.limit
    });
    return {
      ok: true,
      tool: name,
      count: result.count,
      items: result.students
    };
  }

  if (name === "propose_create_student") {
    const data = normalizeStudentInput(args?.data || {});
    const previewFields = buildStudentActionPreview(data);
    if (!Object.keys(data).length) {
      return {
        ok: false,
        tool: name,
        error: "אין מספיק שדות תקינים להצעת יצירת תלמיד."
      };
    }
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
    if (!existingStudent?.summary?.id) {
      return {
        ok: false,
        tool: name,
        error: "לא נמצא תלמיד לעדכון."
      };
    }
    const data = normalizeStudentInput(args?.data || {});
    const previewFields = buildStudentActionPreview(data);
    if (!Object.keys(data).length) {
      return {
        ok: false,
        tool: name,
        error: "אין שדות תקינים לעדכון."
      };
    }
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
    return {
      ok: Boolean(item),
      tool: name,
      item
    };
  }

  return {
    ok: false,
    tool: name,
    error: `Unsupported tool: ${name || "unknown"}`
  };
}

export async function POST(request) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const user = await getCurrentAppUser();
    if (!user) return unauthorized();
    if (!user.is_team_member && !user.is_manager) return forbidden();

    const parsed = await parseIncomingRequest(request);
    const conversation = parsed.messages;
    const attachment = parsed.attachment;
    if (!conversation.length && !attachment) {
      return badRequest("message is required");
    }

    const lastUserMessage = extractLastUserMessage(conversation);
    const inferredChoiceFilters = inferEnumFiltersFromQuery(lastUserMessage);
    if (!isCrmRelevant(lastUserMessage, Boolean(attachment)) && !inferredChoiceFilters.length) {
      return NextResponse.json({ reply: CRM_SCOPE_MESSAGE, studentCards: [] });
    }

    if (attachment) {
      const result = await processDocumentAttachment({
        user,
        attachment,
        messageText: lastUserMessage,
        source: "web"
      });
      return NextResponse.json(result);
    }

    const result = await processTextAiMessage({
      user,
      messageText: lastUserMessage,
      source: "web"
    });

    return NextResponse.json({
      id: result?.id || "",
      reply: result?.reply || "לא הצלחתי להשלים תשובה.",
      studentCards: Array.isArray(result?.studentCards) ? result.studentCards : [],
      exportUrl: result?.exportUrl || "",
      pdfUrl: result?.pdfUrl || "",
      viewUrl: result?.viewUrl || "",
      searchSummary: result?.searchSummary || "",
      pendingAction: result?.pendingAction || null
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "AI chat failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const user = await getCurrentAppUser();
    if (!user) return unauthorized();
    if (!user.is_team_member && !user.is_manager) return forbidden();

    const messages = await listAiChatMessagesByUser(user.clerk_user_id, 80);
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to load AI chat history" },
      { status: 500 }
    );
  }
}
