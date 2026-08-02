import { createAiChatMessage } from "./ai-chat-history";
import { getObjectBytesFromR2, uploadBufferToR2 } from "./r2";
import { createPrintJobFromBuffer } from "./print-jobs";
import { buildStudentSummary, buildExportUrlForFilters, describeAgentFilters, findStudentsForAgent } from "./student-agent";
import { normalizeStudentInput } from "./student-fields";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_DOCUMENT_MODEL = process.env.OPENAI_DOCUMENT_MODEL || OPENAI_MODEL;
const DOCUMENT_WORKFLOW_PRINT_PLANS = [
  { value: "corner-staple", label: "הידוק פינה מומלץ" },
  { value: "duplex", label: "A4 דו צדדי" },
  { value: "booklet", label: "חוברת A3" },
  { value: "convert-pdf", label: "המרה ל-PDF" }
];

function clean(value) {
  return String(value || "").trim();
}

function normalizeCopies(value) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) return 1;
  const allowed = [1, 5, 20, 40];
  return allowed.includes(Math.floor(numeric)) ? Math.floor(numeric) : 1;
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

export async function storePendingDocumentFile(file) {
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

export async function buildAttachmentFromStoredDocument(storedDocument) {
  const objectKey = clean(storedDocument?.objectKey);
  if (!objectKey) throw new Error("המסמך השמור לא נמצא.");
  const { bytes, contentType } = await getObjectBytesFromR2(objectKey);
  const finalType = clean(storedDocument?.contentType) || contentType || "application/octet-stream";
  const finalName = clean(storedDocument?.fileName) || "document";
  return {
    name: finalName,
    type: finalType,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

export async function createPrintJobFromStoredDocument({ storedDocument, user, copies = 1, printPlan = "booklet" }) {
  const attachment = await buildAttachmentFromStoredDocument(storedDocument);
  const buffer = Buffer.from(await attachment.arrayBuffer());
  return createPrintJobFromBuffer({
    buffer,
    fileName: attachment.name,
    contentType: attachment.type,
    copies: normalizeCopies(copies),
    printPlan,
    uploadedByUserId: user?.clerk_user_id,
    user
  });
}

async function fileToBuffer(file) {
  return Buffer.from(await file.arrayBuffer());
}

function extractResponseText(data) {
  if (clean(data?.output_text)) return clean(data.output_text);
  const chunks = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === "output_text" && content?.text) chunks.push(content.text);
      else if (content?.text) chunks.push(content.text);
    }
  }
  return clean(chunks.join("\n"));
}

function parseJsonObject(rawText) {
  const raw = clean(rawText);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function normalizeIsraeliId(value) {
  const digits = clean(value).replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length <= 9) return digits.padStart(9, "0");
  const nineDigitMatch = digits.match(/\d{9}/);
  return nineDigitMatch?.[0] || digits.slice(0, 9);
}

function splitHebrewFullName(fullName) {
  const parts = clean(fullName).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: clean(fullName), lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) || ""
  };
}

function normalizeDateValue(value) {
  const raw = clean(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dayFirst = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!dayFirst) return raw;
  const year = dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3];
  return `${year}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
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
    "adders.address",
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
      value: clean(field?.field) === "dateofbirth" ? normalizeDateValue(field?.value) : clean(field?.value),
      confidence: Number(field?.confidence) || null
    }))
    .map((field) => field.field === "adders.address" ? { ...field, field: "adders.addressStreet1" } : field)
    .filter((field) => allowedFields.has(field.field) && field.value)
    .slice(0, 12);
}

function normalizeDocumentInfo(parsed, file) {
  const updatableFields = normalizeExtractedFields(parsed.updatableFields);
  const fieldValue = (name) => clean(updatableFields.find((field) => field.field === name)?.value);
  const fullName = clean(parsed.fullName) || [clean(parsed.firstName), clean(parsed.lastName)].filter(Boolean).join(" ");
  const splitName = splitHebrewFullName(fullName);
  const firstName = clean(parsed.firstName) || fieldValue("fullName.firstName") || splitName.firstName;
  const lastName = clean(parsed.lastName) || fieldValue("fullName.lastName") || splitName.lastName;
  const tznum = normalizeIsraeliId(parsed.tznum || fieldValue("tznum"));
  const dateofbirth = normalizeDateValue(parsed.dateofbirth || parsed.dateOfBirth || fieldValue("dateofbirth"));
  const addressCity = clean(parsed.addressCity || parsed.city || fieldValue("adders.addressCity"));
  const addressStreet = clean(parsed.addressStreet || parsed.address || fieldValue("adders.addressStreet1"));

  const finalFields = [...updatableFields];
  const ensureField = (field, label, value, confidence = 0.8) => {
    const normalizedValue = clean(value);
    if (!normalizedValue || finalFields.some((item) => item.field === field)) return;
    finalFields.unshift({ field, label, value: normalizedValue, confidence });
  };

  ensureField("tznum", "תעודת זהות", tznum, 0.95);
  ensureField("dateofbirth", "תאריך לידה", dateofbirth, 0.85);
  ensureField("adders.addressCity", "עיר", addressCity, 0.75);
  ensureField("adders.addressStreet1", "כתובת", addressStreet, 0.75);
  ensureField("fullName.lastName", "שם משפחה", lastName, 0.9);
  ensureField("fullName.firstName", "שם פרטי", firstName, 0.9);

  return {
    documentName: clean(parsed.documentName) || clean(file.name),
    documentType: clean(parsed.documentType) || "מסמך תלמיד",
    documentSummary: clean(parsed.documentSummary),
    firstName,
    lastName,
    fullName: fullName || [firstName, lastName].filter(Boolean).join(" "),
    tznum,
    updatableFields: finalFields.slice(0, 14)
  };
}

async function extractStudentDocumentInfoWithResponsesApi(file, bytes, imageUrls = []) {
  const contentType = clean(file.type).toLowerCase();
  const content = [
    {
      type: "input_text",
      text: [
        "נתח את המסמך והחזר רק JSON תקין ללא Markdown.",
        "המסמך עשוי להיות תעודת זהות ישראלית, כולל שני צדדים בתוך PDF או תמונה.",
        "חובה לנסות לחלץ: שם פרטי, שם משפחה, שם מלא, מספר זהות בן 9 ספרות, תאריך לידה, כתובת/עיר, ושדות נוספים אם קיימים.",
        "בתעודת זהות ישראלית מספר זהות הוא בדרך כלל 9 ספרות; שמור אפסים מובילים אם מופיעים.",
        "תאריכים החזר בפורמט YYYY-MM-DD בלבד.",
        "החזר אובייקט עם keys: documentName, documentType, documentSummary, firstName, lastName, fullName, tznum, updatableFields.",
        "updatableFields הוא מערך של {field,label,value,confidence}.",
        "field מותר: fullName.firstName, fullName.lastName, tznum, dateofbirth, adders.addressStreet1, adders.addressStreet2, adders.addressCity, adders.addressPostcode, phone.primaryPhoneNumber, email.primaryEmail, shmHb, shmHm, tzaba, tzMotherNum.",
        "אם זיהית כתובת מלאה ואין לך חלוקה בטוחה, שים אותה ב-adders.addressStreet1."
      ].join(" ")
    }
  ];

  if (contentType === "application/pdf") {
    content.push({
      type: "input_file",
      filename: clean(file.name) || "document.pdf",
      file_data: `data:application/pdf;base64,${bytes.toString("base64")}`
    });
  } else {
    for (const imageUrl of imageUrls) {
      content.push({ type: "input_image", image_url: imageUrl, detail: "high" });
    }
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_DOCUMENT_MODEL,
      temperature: 0,
      input: [{ role: "user", content }]
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "Document extraction failed");
  return normalizeDocumentInfo(parseJsonObject(extractResponseText(data)), file);
}

export async function extractStudentDocumentInfo(file) {
  if (!file) {
    throw new Error("לא התקבל מסמך.");
  }

  const contentType = clean(file.type).toLowerCase();
  const bytes = await fileToBuffer(file);
  const imageUrls = contentType === "application/pdf" ? [] : await fileToDocumentImageDataUrls(file);

  if (contentType === "application/pdf") {
    try {
      return await extractStudentDocumentInfoWithResponsesApi(file, bytes);
    } catch (error) {
      console.error("PDF document extraction failed:", error?.message || error);
    }
  }

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

  try {
    return await extractStudentDocumentInfoWithResponsesApi(file, bytes, imageUrls);
  } catch (error) {
    console.error("Responses image extraction failed:", error?.message || error);
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

  return normalizeDocumentInfo(parseJsonObject(data?.choices?.[0]?.message?.content || "{}"), file);
}

export function buildCreateStudentDataFromDocument(documentInfo) {
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

  return normalizeStudentInput(data);
}

function buildSearchSummary({ query = "", filters = [], resultCount = null } = {}) {
  const parts = [];
  const describedFilters = describeAgentFilters(filters);
  if (clean(query)) parts.push(`בוצע חיפוש מסמך לפי: "${clean(query)}"`);
  if (describedFilters.length) parts.push(`עם מסננים: ${describedFilters.join(" | ")}`);
  if (Number.isFinite(Number(resultCount))) parts.push(`נמצאו ${Number(resultCount)} תוצאות`);
  return parts.join(" | ");
}

function buildDocumentWorkflowActionLinks() {
  return [
    {
      label: "חפש תלמיד לשיוך",
      url: "/neon"
    },
    {
      label: "בחר תוכנית הדפסה",
      url: "/print"
    }
  ];
}

export function buildDocumentAnalysisReply({ documentInfo, students }) {
  const matchedStudent = students.length === 1 ? students[0] : null;
  const lines = [
    "קיבלתי מסמך. לפני שאני מתקדם, בחר מה לעשות איתו:",
    "1. לחפש תלמיד לשיוך המסמך לכרטיס תלמיד.",
    "2. לבחור תוכנית הדפסה ולשלוח לתור ההדפסה.",
    "",
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

function buildDocumentWorkflowReply(storedDocument, { canLinkStudentDocuments = false } = {}) {
  const lines = [
    `קיבלתי את המסמך: ${clean(storedDocument?.fileName) || "ללא שם"}`,
    "",
    "מה לעשות בו?",
    "ברירת מחדל: הדפסה.",
    "בחר תוכנית הדפסה. מיד לאחר הבחירה אשלח עותק אחד, ואז תוכל לבחור אם להוסיף עוד עותקים.",
    `תוכניות זמינות: ${DOCUMENT_WORKFLOW_PRINT_PLANS.map((plan) => plan.label).join(" | ")}`
  ];
  if (canLinkStudentDocuments) {
    lines.push("אם צריך לשייך לכרטיס תלמיד, בחר שיוך לתלמיד.");
  }
  return lines.join("\n");
}

export async function processDocumentWorkflowAttachment({ user, attachment, messageText = "", source = "web" }) {
  const storedDocument = await storePendingDocumentFile(attachment);
  const reply = buildDocumentWorkflowReply(storedDocument, {
    canLinkStudentDocuments: Boolean(user?.is_super_admin)
  });
  const pendingAction = {
    id: crypto.randomUUID(),
    type: "document_workflow",
    storedDocument,
    defaultPrintPlan: "corner-staple",
    printPlanOptions: DOCUMENT_WORKFLOW_PRINT_PLANS,
    copiesOptions: [1, 5, 20, 40]
  };

  await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "user",
    content: messageText || `הועלה מסמך: ${clean(attachment.name) || "ללא שם"}`,
    metadata: {
      intentType: "document_workflow",
      path: "document_workflow",
      source
    }
  });

  const assistantMessage = await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "assistant",
    content: reply,
    metadata: {
      attachmentName: clean(attachment.name),
      pendingAction,
      intentType: "document_workflow",
      path: "document_workflow",
      source
    }
  });

  return {
    ...assistantMessage,
    reply,
    pendingAction,
    searchSummary: "המסמך נשמר. לא בוצע ניתוח עד לבחירת שיוך לתלמיד."
  };
}

export async function processDocumentAttachment({ user, attachment, messageText = "", source = "web" }) {
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
  const actionLinks = buildDocumentWorkflowActionLinks();
  const searchSummary = buildSearchSummary({
    query,
    filters: effectiveFilters,
    resultCount: students.length
  });

  await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "user",
    content: messageText || `הועלה מסמך: ${clean(attachment.name) || "ללא שם"}`,
    metadata: {
      intentType: "document_query",
      path: "document",
      source
    }
  });

  const assistantMessage = await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "assistant",
    content: reply,
    metadata: {
      studentCards: finalStudentCards,
      exportUrl,
      actionLinks,
      attachmentName: clean(attachment.name),
      documentInfo,
      extractedIdentity: documentInfo,
      updatableFields: documentInfo.updatableFields,
      pendingAction,
      suggestedAction: students.length ? "" : "create_student",
      intentType: "document_query",
      path: "document",
      resultCount: students.length,
      searchSummary,
      source
    }
  });

  return {
    ...assistantMessage,
    reply,
    studentCards: finalStudentCards,
    exportUrl,
    actionLinks,
    documentInfo,
    extractedIdentity: documentInfo,
    updatableFields: documentInfo.updatableFields,
    pendingAction,
    suggestedAction: students.length ? "" : "create_student",
    searchSummary
  };
}

export async function processStoredDocumentForStudentLink({ user, storedDocument, messageText = "", source = "web" }) {
  const attachment = await buildAttachmentFromStoredDocument(storedDocument);
  return processDocumentAttachment({
    user,
    attachment,
    messageText,
    source
  });
}
