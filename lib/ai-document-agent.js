import { createAiChatMessage } from "./ai-chat-history";
import { uploadBufferToR2 } from "./r2";
import { buildStudentSummary, buildExportUrlForFilters, describeAgentFilters, findStudentsForAgent } from "./student-agent";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function clean(value) {
  return String(value || "").trim();
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

export async function extractStudentDocumentInfo(file) {
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

  return data;
}

function buildSearchSummary({ query = "", filters = [], resultCount = null } = {}) {
  const parts = [];
  const describedFilters = describeAgentFilters(filters);
  if (clean(query)) parts.push(`בוצע חיפוש מסמך לפי: "${clean(query)}"`);
  if (describedFilters.length) parts.push(`עם מסננים: ${describedFilters.join(" | ")}`);
  if (Number.isFinite(Number(resultCount))) parts.push(`נמצאו ${Number(resultCount)} תוצאות`);
  return parts.join(" | ");
}

export function buildDocumentAnalysisReply({ documentInfo, students }) {
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
    documentInfo,
    extractedIdentity: documentInfo,
    updatableFields: documentInfo.updatableFields,
    pendingAction,
    suggestedAction: students.length ? "" : "create_student",
    searchSummary
  };
}
