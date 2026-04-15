import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import {
  createAiChatMessage,
  listAiChatMessagesByUser,
  listRecentAiChatMessagesByUser
} from "../../../../lib/ai-chat-history";
import { createStudentDocument } from "../../../../lib/student-documents";
import {
  buildStudentSummary,
  buildExportUrlForFilters,
  findStudentsForAgent,
  getStudentForAgent,
  getStudentSchemaCatalog,
  searchStudentsForAgent
} from "../../../../lib/student-agent";

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
    "רשימה",
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
    "מוסד",
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

async function fileToDataUrl(file) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = clean(file.type) || "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
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
  if (!contentType.startsWith("image/")) {
    return {
      documentName: clean(file.name),
      documentType: contentType === "application/pdf" ? "PDF" : "מסמך",
      documentSummary: "המסמך נשמר וניתן לשייך אותו לכרטיס תלמיד. חילוץ פרטים אוטומטי מ-PDF עדיין מוגבל.",
      firstName: "",
      lastName: "",
      fullName: "",
      tznum: "",
      updatableFields: []
    };
  }

  const imageUrl = await fileToDataUrl(file);
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
            { type: "image_url", image_url: { url: imageUrl } }
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

function buildDocumentAnalysisReply({ documentInfo, students, attachedDocument }) {
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
    lines.push("", `התאמה ב-CRM: ${matchedStudent.label}`, "המסמך נשמר בכרטיס התלמיד.");
  } else if (students.length > 1) {
    lines.push("", `נמצאו ${students.length} התאמות אפשריות. יש לבחור כרטיס תלמיד לפני שמירה אוטומטית.`);
  } else {
    lines.push("", "לא נמצאה התאמה ב-CRM. אפשר ליצור תלמיד חדש על בסיס הנתונים שזוהו.");
  }

  lines.push("", "שדות שאפשר לעדכן:");
  if (documentInfo.updatableFields.length) {
    documentInfo.updatableFields.forEach((field, index) => {
      lines.push(`${index + 1}. ${field.label || field.field}: ${field.value}`);
    });
  } else {
    lines.push("-");
  }

  if (attachedDocument?.id) {
    lines.push("", `מזהה מסמך שנשמר: ${attachedDocument.id}`);
  }

  return lines.join("\n");
}

async function handleDocumentMatchFlow({ user, attachment, messageText }) {
  const documentInfo = await extractStudentDocumentInfo(attachment);
  let query = documentInfo.tznum || documentInfo.fullName || [documentInfo.firstName, documentInfo.lastName].filter(Boolean).join(" ");
  if (!query) query = clean(messageText);

  const filters = documentInfo.tznum ? [{ field: "tznum", operator: "equals", value: documentInfo.tznum }] : [];
  const { students, effectiveFilters } = await findStudentsForAgent({ query, filters, minScore: 0.22 });
  const finalStudentCards = students.slice(0, 10).map((student) => buildStudentSummary(student)).filter(Boolean);
  let attachedDocument = null;

  if (students.length === 1) {
    attachedDocument = await createStudentDocument({
      studentId: students[0].id,
      uploadedByUserId: user.clerk_user_id,
      file: attachment,
      documentKind: "id",
      displayName: documentInfo.documentName || clean(attachment.name),
      noteText: documentInfo.documentSummary
    });
  }

  const reply = buildDocumentAnalysisReply({ documentInfo, students, attachedDocument });
  const exportUrl = effectiveFilters.length ? buildExportUrlForFilters(effectiveFilters) : "";
  await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "user",
    content: messageText || `הועלה מסמך: ${clean(attachment.name) || "ללא שם"}`
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
        attachedDocumentId: attachedDocument?.id || "",
        updatableFields: documentInfo.updatableFields,
        suggestedAction: students.length ? "" : "create_student"
      }
    });

  return NextResponse.json({
    reply,
    studentCards: finalStudentCards,
    exportUrl,
    documentInfo,
    extractedIdentity: documentInfo,
    updatableFields: documentInfo.updatableFields,
    attachedDocumentId: attachedDocument?.id || "",
    suggestedAction: students.length ? "" : "create_student"
  });
}

function buildQuantitativeReply({ query, students, requestedLimit }) {
  const total = students.length;
  if (!total) {
    return "לא נמצאו תלמידים מתאימים.";
  }

  const displayLimit = requestedLimit || Math.min(total, 50);
  const displayed = students.slice(0, displayLimit);
  const lines = [
    `נמצאו ${total} תלמידים.`,
    ...displayed.map((student, index) => `${index + 1}. ${student?.label || student?.name || "ללא שם"}`)
  ];

  if (displayed.length < total) {
    lines.push(`מוצגים ${displayed.length} מתוך ${total}. אפשר להוריד את כל החיתוך לאקסל.`);
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
    if (!conversation.length) {
      return badRequest("message is required");
    }

    const lastUserMessage = extractLastUserMessage(conversation);
    if (!isCrmRelevant(lastUserMessage, Boolean(attachment))) {
      return NextResponse.json({ reply: CRM_SCOPE_MESSAGE, studentCards: [] });
    }

    if (attachment) {
      return handleDocumentMatchFlow({
        user,
        attachment,
        messageText: lastUserMessage
      });
    }

    const recentHistory = await listRecentAiChatMessagesByUser(user.clerk_user_id, { limit: 8, withinMinutes: 45 });
    const recentConversation = buildRecentConversationMessages(recentHistory);
    const requestedLimit = extractRequestedLimit(lastUserMessage);
    const quantitativeListRequest = isQuantitativeListRequest(lastUserMessage);
    const choiceFieldQuery = isChoiceFieldQuery(lastUserMessage);

    if (quantitativeListRequest || choiceFieldQuery) {
      const { students, effectiveFilters } = await findStudentsForAgent({
        query: lastUserMessage,
        minScore: 0.28
      });
      const finalStudentCards = students
        .slice(0, Math.min(requestedLimit || 50, 50))
        .map((student) => buildStudentSummary(student))
        .filter(Boolean);
      const exportUrl = buildExportUrlForFilters(effectiveFilters);
      const reply = buildQuantitativeReply({
        query: lastUserMessage,
        students,
        requestedLimit
      });

      await createAiChatMessage({
        clerkUserId: user.clerk_user_id,
        role: "user",
        content: lastUserMessage
      });
      await createAiChatMessage({
        clerkUserId: user.clerk_user_id,
        role: "assistant",
        content: reply,
        metadata: { studentCards: finalStudentCards, exportUrl }
      });

      return NextResponse.json({
        reply,
        studentCards: finalStudentCards,
        exportUrl
      });
    }

    const tools = [
    {
      type: "function",
      function: {
        name: "get_schema_catalog",
        description: "Return all CRM student fields, labels, and enum values such as CY=חכמי ירושלים.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_students",
        description: "Search CRM students by free text and/or field filters. Use this for email, phone, address, city, institution, class, and other student fields.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  operator: {
                    type: "string",
                    enum: ["contains", "equals", "starts_with", "ends_with", "empty", "not_empty"]
                  },
                  value: { type: "string" }
                },
                required: ["field", "operator"]
              }
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_student",
        description: "Get one student by exact CRM student id.",
        parameters: {
          type: "object",
          properties: {
            studentId: { type: "string" }
          },
          required: ["studentId"]
        }
      }
    }
  ];

    const systemPrompt = {
      role: "system",
      content: [
        "אתה סוכן מידע פנימי של מערכת CRM תלמידים.",
        "אתה עונה רק על בסיס כלי המערכת והמידע שהוחזר מהם.",
        "כאשר נשאלת שאלה על תלמיד או רשימת תלמידים, השתמש בכלי החיפוש לפני מתן תשובה.",
        "כאשר השאלה עוסקת במוסד, שיעור, רישום או סטטוס משפחתי, העדף search_students עם filters על שדות enum ולא רק query חופשי.",
        "אם המשתמש כתב שם אנושי של ערך בחירה כמו חכמי ירושלים, התאם אותו לערך המערכת המתאים כמו CY.",
        "כאשר אתה מציין תלמיד, תמיד כלול הפניה ברורה לכרטיס התלמיד אם קיים studentCardUrl.",
        "כאשר יש שדות enum, הצג גם תווית אנושית וגם קוד בעת הצורך, למשל: חכמי ירושלים (CY).",
        "אם יש יותר מתוצאה אחת, ציין זאת במפורש וסכם כל תלמיד בשורה קצרה.",
        quantitativeListRequest
          ? "בשאלות כמותיות או בקשות לרשימה, החזר רשימה מסודרת של שמות תלמידים בלבד, בלי פירוט נוסף בגוף התשובה. אם המשתמש ביקש מספר מסוים, כבד את המספר הזה."
          : "",
        requestedLimit
          ? `המשתמש ביקש במפורש מספר תוצאות. השתמש לכל היותר ב-${requestedLimit} תוצאות אלא אם ביקש אחרת.`
          : "",
        "אם אין מספיק מידע, בקש הבהרה קצרה.",
        "ענה בעברית, בצורה קצרה וברורה."
      ].filter(Boolean).join(" ")
    };

    const messages = [systemPrompt, ...recentConversation, ...conversation.slice(-1)];
    const referencedStudents = new Map();
    let finalMessage = "";

    for (let iteration = 0; iteration < 5; iteration += 1) {
      const assistantMessage = await callOpenAI(messages, tools);
      if (!assistantMessage) break;

      if (Array.isArray(assistantMessage.tool_calls) && assistantMessage.tool_calls.length) {
        messages.push({
          role: "assistant",
          content: assistantMessage.content || "",
          tool_calls: assistantMessage.tool_calls
        });

        for (const toolCall of assistantMessage.tool_calls) {
          const result = await executeToolCall(toolCall);
          collectStudentCards(referencedStudents, result);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
        continue;
      }

      finalMessage = clean(assistantMessage.content);
      break;
    }

    const finalStudentCards = Array.from(referencedStudents.values()).slice(0, 8);
    const lastUserMessageContent = extractLastUserMessage(conversation);

    await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "user",
      content: lastUserMessageContent
    });
    await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: finalMessage || "לא הצלחתי להשלים תשובה.",
      metadata: { studentCards: finalStudentCards }
    });

    return NextResponse.json({
      reply: finalMessage || "לא הצלחתי להשלים תשובה.",
      studentCards: finalStudentCards
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
