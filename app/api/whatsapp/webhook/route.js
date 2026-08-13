import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAppUserByClerkUserId } from "../../../../lib/rbac";
import { clearAiChatMessagePendingAction, getAiChatMessageById, setAiChatMessageFeedback, setAiChatMessageReportConfig } from "../../../../lib/ai-chat-history";
import { CRM_SCOPE_MESSAGE, processTextAiMessage, handleApprovedAiAction, getPendingActionForMessage } from "../../../../lib/ai-text-agent";
import { createPrintJobFromStoredDocument, processDocumentWorkflowAttachment, processStoredDocumentForStudentLink } from "../../../../lib/ai-document-agent";
import { canAccessPrintFeature, canUseColorPrint, canUsePrintQueue } from "../../../../lib/print-jobs";
import { buildPaymentReportAgentResultFromConfig } from "../../../../lib/payment-agent";
import { buildPaymentReportUrls } from "../../../../lib/payment-report";
import { buildStudentCardLines } from "../../../../lib/student-agent";
import { getNeonStudentById } from "../../../../lib/neon-students";
import { buildResendFromAddress, sendResendEmail } from "../../../../lib/resend";
import { createTask, listOfficeTaskEmailUsers } from "../../../../lib/tasks";
import { createWhatsAppInboundEvent, updateWhatsAppInboundEvent } from "../../../../lib/whatsapp-events";
import {
  consumeWhatsAppLinkCode,
  downloadWhatsAppMediaAsAttachment,
  getWhatsAppLinkByWaId,
  getWhatsAppWebhookAppSecret,
  sendWhatsAppDocumentFile,
  sendWhatsAppListMessage,
  sendWhatsAppReplyButtons,
  sendWhatsAppTextMessages
} from "../../../../lib/whatsapp";
import { INSTITUTION_COLUMN_MAP } from "../../../../lib/student-view";
import { buildInstitutionCsvExport, buildInstitutionPdfExport } from "../../../../lib/institution-exports";
import { buildPaymentReportExcelExport, buildPaymentReportPdfExport } from "../../../../lib/payment-report-exports";

const REQUIRED_EXPORT_COLUMNS = ["name"];
const REPORT_EXCLUDED_COLUMNS = new Set([
  "field:email.primaryEmail",
  "field:email.additionalEmails",
  "field:fatherEmail.primaryEmail",
  "field:fatherEmail.additionalEmails",
  "field:motherEmail.primaryEmail",
  "field:motherEmail.additionalEmails",
  "field:phone.primaryPhoneNumber",
  "field:phone.primaryPhoneCountryCode",
  "field:phone.primaryPhoneCallingCode",
  "field:dadPhone.primaryPhoneNumber",
  "field:dadPhone.primaryPhoneCountryCode",
  "field:dadPhone.primaryPhoneCallingCode",
  "field:dadPhone.additionalPhones",
  "field:momPhone.primaryPhoneNumber",
  "field:momPhone.primaryPhoneCountryCode",
  "field:momPhone.primaryPhoneCallingCode",
  "field:momPhone.additionalPhones",
  "field:phone.additionalPhones",
  "field:adders.addressStreet1",
  "field:adders.addressStreet2",
  "field:adders.addressCity",
  "field:adders.addressPostcode",
  "field:adders.addressState",
  "field:adders.addressCountry",
  "field:adders.addressLat",
  "field:adders.addressLng",
  "field:bankNum",
  "field:senif",
  "field:accountNum"
]);
const REPORT_SORT_OPTIONS = [
  { key: "class", label: "שיעור" },
  { key: "name", label: "שם משפחה" }
];
const REPORT_COLUMN_PRESETS = {
  default: ["name", "class"],
  contact: ["name", "tznum", "studentPhone", "dadPhone", "momPhone", "studentEmail", "fatherEmail", "motherEmail"],
  address: ["name", "tznum", "address"],
  bank: ["name", "tznum", "bankDetails"]
};

function clean(value) {
  return String(value || "").trim();
}

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function chunkArray(items, size) {
  const chunkSize = Math.max(1, Number(size) || 1);
  const source = Array.isArray(items) ? items : [];
  const chunks = [];
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize));
  }
  return chunks;
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isFullWhatsAppAgentUser(user) {
  return Boolean(user?.is_team_member || user?.is_manager || user?.is_super_admin);
}

function canLinkDocumentsToStudents(user) {
  return Boolean(user?.is_super_admin);
}

function isLimitedWhatsAppAgentUser(user) {
  return Boolean(user?.access_status === "approved" && (clean(user?.linked_student_id) || canUsePrintQueue(user)));
}

function canUseWhatsAppAgent(user) {
  return isFullWhatsAppAgentUser(user) || isLimitedWhatsAppAgentUser(user);
}

function studentDisplayName(student) {
  return [
    clean(student?.fullName?.firstName),
    clean(student?.fullName?.lastName)
  ].filter(Boolean).join(" ") || clean(student?.label) || clean(student?.name) || "תלמיד";
}

function safeEqualHex(left, right) {
  const a = Buffer.from(clean(left), "utf8");
  const b = Buffer.from(clean(right), "utf8");
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isWebhookSignatureValid(rawBody, signatureHeader) {
  const appSecret = getWhatsAppWebhookAppSecret();
  if (!appSecret) return true;
  const header = clean(signatureHeader);
  if (!header.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqualHex(expected, header);
}

function extractIncomingMessage(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      if (messages[0]) {
        return {
          message: messages[0],
          contact: Array.isArray(value?.contacts) ? value.contacts[0] || null : null,
          metadata: value?.metadata || {}
        };
      }
    }
  }
  return { message: null, contact: null, metadata: {} };
}

function extractText(message) {
  if (message?.type === "text") return clean(message?.text?.body);
  if (message?.type === "button") return clean(message?.button?.text);
  if (message?.type === "interactive") {
    return clean(
      message?.interactive?.button_reply?.title
      || message?.interactive?.list_reply?.title
      || message?.interactive?.button_reply?.id
      || message?.interactive?.list_reply?.id
    );
  }
  return "";
}

function extractInteractiveActionId(message) {
  if (message?.type !== "interactive") return "";
  return clean(
    message?.interactive?.button_reply?.id
    || message?.interactive?.list_reply?.id
  );
}

function resolveAttachmentMeta(message) {
  if (message?.type === "document" && message?.document?.id) {
    return {
      mediaId: clean(message.document.id),
      fileName: clean(message.document.filename) || "whatsapp-document",
      contentType: clean(message.document.mime_type) || "application/octet-stream"
    };
  }

  if (message?.type === "image" && message?.image?.id) {
    const contentType = clean(message.image.mime_type) || "image/jpeg";
    return {
      mediaId: clean(message.image.id),
      fileName: `${clean(message.image.id) || "whatsapp-image"}.${contentType === "image/png" ? "png" : "jpg"}`,
      contentType
    };
  }

  return null;
}

function resolveBaseUrl() {
  const explicit = process.env.CRM_BASE_URL || process.env.APP_BASE_URL;
  if (explicit) return clean(explicit).replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!vercelUrl) return "";
  return `https://${clean(vercelUrl).replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

function toAbsoluteUrl(path) {
  const baseUrl = resolveBaseUrl();
  const relativePath = clean(path);
  if (!baseUrl || !relativePath) return "";
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${baseUrl}${relativePath.startsWith("/") ? relativePath : `/${relativePath}`}`;
}

function buildAiLinkPath(messageId, kind) {
  return `/api/ai/link/${clean(messageId)}/${clean(kind)}`;
}

function withRequiredColumns(columns = []) {
  const seen = new Set();
  const ordered = [];
  [...REQUIRED_EXPORT_COLUMNS, ...columns].forEach((column) => {
    const key = clean(column);
    if (!key || !INSTITUTION_COLUMN_MAP[key] || REPORT_EXCLUDED_COLUMNS.has(key) || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  });
  return ordered;
}

function normalizeSortLevels(sortLevels = []) {
  return (Array.isArray(sortLevels) ? sortLevels : [])
    .map((level) => ({
      sortBy: clean(level?.sortBy),
      sortDir: clean(level?.sortDir).toLowerCase() === "desc" ? "desc" : "asc"
    }))
    .filter((level) => level.sortBy);
}

function buildExportUrlWithOptions(url, { columns = [], sortLevels = [] } = {}) {
  const raw = clean(url);
  if (!raw) return "";
  const parsed = new URL(raw, "https://internal.local");
  parsed.searchParams.delete("cols");
  withRequiredColumns(columns).forEach((column) => parsed.searchParams.append("cols", column));
  parsed.searchParams.delete("sby");
  parsed.searchParams.delete("sdir");
  normalizeSortLevels(sortLevels).forEach((level) => {
    parsed.searchParams.append("sby", level.sortBy);
    parsed.searchParams.append("sdir", level.sortDir);
  });
  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query ? `?${query}` : ""}`;
}

function buildReplyText(result) {
  const parts = [clean(result?.reply || result?.content)];
  const isPaymentReport = isPaymentReportLink(result?.exportUrl) || isPaymentReportLink(result?.pdfUrl) || isPaymentViewLink(result?.viewUrl);
  const exportColumns = withRequiredColumns(result?.exportColumns || []);
  const sortLevels = normalizeSortLevels(result?.sortLevels || [{ sortBy: "class", sortDir: "asc" }]);

  const hasStudentCards = Array.isArray(result?.studentCards) && result.studentCards.length > 0;
  const absoluteViewUrl = toAbsoluteUrl(result?.viewUrl);
  if (absoluteViewUrl && !hasStudentCards && !isPaymentReport) parts.push(`תצוגה מלאה במערכת:\n${absoluteViewUrl}`);
  if ((clean(result?.exportUrl) || clean(result?.pdfUrl)) && !isPaymentReport) {
    parts.push(`מיון דוח: ${sortLevels[0]?.sortBy === "class" ? "שיעור" : "שם משפחה"}`);
    parts.push(`עמודות: ${exportColumns.map((column) => INSTITUTION_COLUMN_MAP[column]?.label || column).join(", ")}`);
  }

  const cardBlocks = (Array.isArray(result?.studentCards) ? result.studentCards : [])
    .slice(0, 7)
    .map((student, index) => [`כרטיס תלמיד ${index + 1}:`, ...buildStudentCardLines(student)].join("\n"))
    .filter(Boolean);

  if (cardBlocks.length) {
    parts.push(cardBlocks.join("\n\n"));
  }

  if (clean(result?.searchSummary)) {
    parts.push(`איך חיפשתי: ${clean(result.searchSummary)}`);
  }

  return parts.filter(Boolean).join("\n\n");
}

function isPaymentReportLink(url) {
  const raw = clean(url);
  return raw.startsWith("/api/payments/export/");
}

function isPaymentViewLink(url) {
  const raw = clean(url);
  return raw.startsWith("/payments");
}

function isPaymentReportMessage(messageRecord) {
  return isPaymentReportLink(messageRecord?.exportUrl)
    || isPaymentReportLink(messageRecord?.pdfUrl)
    || isPaymentViewLink(messageRecord?.viewUrl);
}

function normalizeActionLinks(actionLinks) {
  if (!Array.isArray(actionLinks)) return [];
  return actionLinks
    .map((link) => ({
      label: clean(link?.label),
      url: clean(link?.url)
    }))
    .filter((link) => link.label && link.url);
}

function buildWhatsAppDocumentActionRows(result) {
  const messageId = clean(result?.id);
  if (!messageId) return [];
  return normalizeActionLinks(result?.actionLinks)
    .slice(0, 10)
    .map((link, index) => ({
      id: `docAction:${index}:${messageId}`,
      title: link.label,
      description: link.url === "/print"
        ? "בחר תוכנית הדפסה ושלח לתור"
        : link.url === "/neon"
          ? "חפש תלמיד ושייך את המסמך"
          : "פתח במערכת"
    }));
}

function isDocumentWorkflowAction(pendingAction) {
  return clean(pendingAction?.type) === "document_workflow";
}

const DOCUMENT_PRINT_PLANS = [
  { value: "corner-staple-bw", label: "שחור לבן, הידוק פינה", description: "A4 מימין לשמאל" },
  { value: "duplex-bw", label: "שחור לבן, A4 דו צדדי", description: "בלי חוברת ובלי הידוק" },
  { value: "booklet-bw", label: "שחור לבן, חוברת A3", description: "פריסה מימין לשמאל" },
  { value: "single-a4-bw", label: "שחור לבן, A4 צד אחד", description: "צד אחד בלבד" },
  { value: "single-a3-bw", label: "שחור לבן, A3 צד אחד", description: "צד אחד בלבד" },
  { value: "convert-pdf", label: "המרה ל-PDF", description: "לקבצי Word/Excel" }
];
const COLOR_DOCUMENT_PRINT_PLANS = [
  { value: "corner-staple-color", label: "צבע, הידוק פינה", description: "A4 מימין לשמאל" },
  { value: "duplex-color", label: "צבע, A4 דו צדדי", description: "בלי חוברת ובלי הידוק" },
  { value: "booklet-color", label: "צבע, חוברת A3", description: "פריסה מימין לשמאל" },
  { value: "single-a4-color", label: "צבע, A4 צד אחד", description: "צד אחד בלבד" },
  { value: "single-a3-color", label: "צבע, A3 צד אחד", description: "צד אחד בלבד" }
];
const DOCUMENT_PRINT_COPIES = [1, 5, 20, 40];

function whatsappAdditionalCopiesRows(messageId, printPlan) {
  return [
    {
      id: `docPrintDone:${messageId}`,
      title: "סיימתי",
      description: "אין צורך בעוד הדפסה"
    },
    ...DOCUMENT_PRINT_COPIES.map((copies) => ({
    id: `docPrintCopies:${printPlan}:${copies}:${messageId}`,
      title: `עוד ${copies}`,
      description: copies === 1 ? "עוד עותק אחד" : `עוד ${copies} עותקים`
    }))
  ];
}

async function sendWhatsAppAdditionalCopiesPrompt(waId, { messageId, printPlan, introText = "" }) {
  await sendWhatsAppListMessage(waId, {
    bodyText: [
      introText || "נשלח עותק אחד להדפסה.",
      "כמה עוד תרצה להדפיס?"
    ].filter(Boolean).join("\n"),
    buttonText: "עוד עותקים",
    sections: [
      {
        title: "המשך הדפסה",
        rows: whatsappAdditionalCopiesRows(messageId, printPlan)
      }
    ]
  });
}

async function sendWhatsAppDocumentWorkflowActions(waId, result, user = null) {
  if (!isDocumentWorkflowAction(result?.pendingAction) || !result?.id) return false;
  const rows = [{
    id: `docPrintStart:${result.id}`,
    title: "הדפסה",
    description: "בחירת תוכנית והדפסת עותק אחד"
  }];
  if (canLinkDocumentsToStudents(user)) {
    rows.push({
      id: `docStudentLink:${result.id}`,
      title: "שיוך לתלמיד",
      description: "לנתח את המסמך ולחפש תלמיד"
    });
  }
  await sendWhatsAppListMessage(waId, {
    bodyText: "קיבלתי את המסמך. בחר מה לעשות בו. ברירת המחדל היא הדפסה; לסופר־אדמין קיימת גם אפשרות לשייך את המסמך לתלמיד.",
    buttonText: "מה לעשות במסמך",
    sections: [
      {
        title: "המשך טיפול",
        rows
      }
    ]
  });
  return true;
}

async function sendWhatsAppDocumentPrintPlans(waId, result, user = null, { colorOnly = false } = {}) {
  if (!isDocumentWorkflowAction(result?.pendingAction) || !result?.id) return false;
  const plans = colorOnly
    ? COLOR_DOCUMENT_PRINT_PLANS
    : DOCUMENT_PRINT_PLANS;
  const rows = plans.map((plan) => ({
    id: `docPrintPlan:${plan.value}:${result.id}`,
    title: plan.label,
    description: plan.description
  }));
  if (!colorOnly && canUseColorPrint(user)) {
    rows.push({
      id: `docPrintColorMenu:${result.id}`,
      title: "הדפסה בצבע",
      description: "בחירת תוכנית צבעונית"
    });
  }
  await sendWhatsAppListMessage(waId, {
    bodyText: colorOnly
      ? "בחר תוכנית הדפסה בצבע. מיד לאחר הבחירה יישלח עותק אחד."
      : "בחר תוכנית הדפסה. מיד לאחר הבחירה יישלח עותק אחד, ואז תוכל לבחור אם להוסיף עוד עותקים.",
    buttonText: colorOnly ? "תוכניות צבע" : "תוכנית הדפסה",
    sections: [{
      title: colorOnly ? "הדפסה בצבע" : "שחור לבן והמרה",
      rows
    }]
  });
  return true;
}

function isApprovalReceiptRequestText(text) {
  const value = clean(text);
  if (!value) return false;
  return /(אישור\s+לימודים|אישור\s+תלמיד|אישורי\s+לימודים|קבלה|קבלות|אישור\s+תשלום|אישורי\s+תשלום|תשלום|תשלומים)/.test(value);
}

function inferStudentRequestType(text) {
  const value = clean(text);
  if (/(קבלה|קבלות|תשלום|תשלומים|אישור\s+תשלום|אישורי\s+תשלום)/.test(value)) {
    return "קבלות תרומות/תשלומים";
  }
  return "אישור לימודים";
}

function isPrintRequestText(text) {
  const value = clean(text);
  if (!value) return false;
  return /(הדפס|להדפיס|הדפסה|מדפסת|תור הדפסה|print)/i.test(value);
}

async function sendLimitedWhatsAppMenu(waId, user) {
  const buttons = [];
  if (clean(user?.linked_student_id)) {
    buttons.push({ id: "limited:request", title: "בקשת אישור" });
  }
  if (canAccessPrintFeature(user)) {
    buttons.push({ id: "limited:print", title: "הדפסה" });
  }
  if (!buttons.length) {
    await sendWhatsAppTextMessages(waId, "החשבון מחובר, אבל אין לו פעולה זמינה דרך WhatsApp כרגע.");
    return;
  }
  await sendWhatsAppReplyButtons(waId, {
    bodyText: "בחר פעולה זמינה לחשבון שלך.",
    buttons
  });
}

async function createStudentApprovalReceiptTaskFromWhatsApp({ user, requestText }) {
  const studentId = clean(user?.linked_student_id);
  if (!studentId) {
    return "כדי לפתוח בקשת אישורים או קבלות צריך שהמשתמש יהיה מקושר לכרטיס תלמיד.";
  }

  const student = await getNeonStudentById(studentId);
  if (!student) {
    return "כרטיס התלמיד המקושר לא נמצא. פנה לצוות כדי לבדוק את החיבור.";
  }

  const tznum = normalizeDigits(student?.tznum);
  if (!tznum) {
    return "לא ניתן להגיש בקשה בלי מספר זהות בכרטיס התלמיד. פנה לצוות לעדכון התעודה בכרטיס.";
  }

  const teamUsers = await listOfficeTaskEmailUsers();
  const assigneeUserIds = teamUsers.map((teamUser) => clean(teamUser.id)).filter(Boolean);
  const teamEmails = [...new Set(teamUsers.map((teamUser) => clean(teamUser.email).toLowerCase()).filter(Boolean))];
  const studentName = studentDisplayName(student);
  const requestType = inferStudentRequestType(requestText);
  const title = `בקשת תלמיד: ${requestType} - ${studentName}`;
  const description = [
    `סוג בקשה: ${requestType}`,
    `שם תלמיד: ${studentName}`,
    `ת"ז: ${tznum}`,
    `מוסד: ${clean(student?.currentInstitution) || "-"}`,
    `שיעור: ${clean(student?.class) || "-"}`,
    "",
    "פירוט הבקשה:",
    clean(requestText),
    "",
    `הוגש דרך WhatsApp על ידי: ${clean(user.display_name) || clean(user.email) || user.clerk_user_id}`
  ].join("\n");

  let taskId = "";
  try {
    taskId = await createTask({
      title,
      description,
      status: "pending",
      linkedType: "student",
      studentId,
      assigneeUserIds,
      createdByUserId: user.clerk_user_id,
      sourceSnapshot: {
        source: "student_whatsapp_approval_receipt_request",
        requestType,
        requestedByUserId: user.clerk_user_id,
        studentName,
        tznum
      }
    });
  } catch (error) {
    return clean(error?.message) || "פתיחת המשימה נכשלה. נסה שוב או פנה לצוות.";
  }

  const taskUrl = toAbsoluteUrl(`/tasks?taskId=${encodeURIComponent(taskId)}`);
  let emailWarning = "";
  if (teamEmails.length) {
    try {
      await sendResendEmail({
        to: teamEmails,
        from: buildResendFromAddress("מערכת CRM"),
        subject: title,
        text: [
          "נפתחה בקשת תלמיד חדשה מ-WhatsApp לקבלת אישורים/קבלות.",
          "",
          description,
          "",
          `משימה: ${taskId}`,
          `פתיחה במערכת: ${taskUrl}`
        ].join("\n"),
        html: [
          "<div dir=\"rtl\" style=\"font-family:Arial,sans-serif;line-height:1.7\">",
          "<h2>נפתחה בקשת תלמיד חדשה מ-WhatsApp</h2>",
          `<p><b>תלמיד:</b> ${escapeHtml(studentName)}</p>`,
          `<p><b>ת"ז:</b> ${escapeHtml(tznum)}</p>`,
          `<p><b>פירוט:</b></p><div style=\"white-space:pre-wrap;border:1px solid #d7e1ef;border-radius:10px;padding:12px;background:#f8fbff\">${escapeHtml(requestText)}</div>`,
          `<p><a href=\"${escapeHtml(taskUrl)}\" style=\"display:inline-block;padding:10px 14px;border-radius:10px;background:#0b4f8c;color:#fff;text-decoration:none;font-weight:bold\">פתח את המשימה</a></p>`,
          "</div>"
        ].join(""),
        idempotencyKey: `student-whatsapp-request-${taskId}`
      });
    } catch (error) {
      emailWarning = clean(error?.message) || "המייל לצוות לא נשלח.";
    }
  } else {
    emailWarning = "לא נמצאו אנשי צוות עם תווית משרד לשליחת מייל.";
  }

  return [
    "הבקשה נקלטה ונפתחה משימה לצוות.",
    `מספר משימה: ${taskId}`,
    emailWarning || "נשלח מייל לאנשי הצוות."
  ].join("\n");
}

async function sendInstitutionAttachments(waId, messageRecord) {
  if (isPaymentReportMessage(messageRecord)) {
    const hasExplicitExportUrl = Object.prototype.hasOwnProperty.call(messageRecord || {}, "exportUrl");
    const hasExplicitPdfUrl = Object.prototype.hasOwnProperty.call(messageRecord || {}, "pdfUrl");
    const paymentUrls = messageRecord?.paymentReportConfig
      ? buildPaymentReportUrls(messageRecord.paymentReportConfig)
      : {
          exportUrl: messageRecord?.exportUrl || "",
          pdfUrl: messageRecord?.pdfUrl || ""
        };
    const shouldSendExcel = hasExplicitExportUrl ? Boolean(messageRecord?.exportUrl) : Boolean(paymentUrls.exportUrl);
    const shouldSendPdf = hasExplicitPdfUrl ? Boolean(messageRecord?.pdfUrl) : Boolean(paymentUrls.pdfUrl);
    if (shouldSendExcel && paymentUrls.exportUrl) {
      const excelFile = await buildPaymentReportExcelExport(paymentUrls.exportUrl);
      await sendWhatsAppDocumentFile(waId, excelFile, {
        caption: "אקסל של דוח התרומות מוכן."
      });
    }
    if (shouldSendPdf && paymentUrls.pdfUrl) {
      const pdfFile = await buildPaymentReportPdfExport(paymentUrls.pdfUrl);
      await sendWhatsAppDocumentFile(waId, pdfFile, {
        caption: "PDF של דוח התרומות מוכן."
      });
    }
    return;
  }

  const columns = withRequiredColumns(messageRecord?.exportColumns || []);
  const sortLevels = normalizeSortLevels(messageRecord?.sortLevels || [{ sortBy: "class", sortDir: "asc" }]);

  if (messageRecord?.exportUrl) {
    const csvFile = await buildInstitutionCsvExport(buildExportUrlWithOptions(messageRecord.exportUrl, { columns, sortLevels }));
    await sendWhatsAppDocumentFile(waId, csvFile, {
      caption: `אקסל. מיון: ${sortLevels[0]?.sortBy === "class" ? "שיעור" : "שם משפחה"}.`
    });
  }

  if (messageRecord?.pdfUrl) {
    const pdfFile = await buildInstitutionPdfExport(buildExportUrlWithOptions(messageRecord.pdfUrl, { columns, sortLevels }));
    await sendWhatsAppDocumentFile(waId, pdfFile, {
      caption: `PDF. מיון: ${sortLevels[0]?.sortBy === "class" ? "שיעור" : "שם משפחה"}.`
    });
  }
}

async function sendWhatsAppPaymentReportActions(waId, messageRecord) {
  const config = messageRecord?.paymentReportConfig || {};
  const sortBy = clean(config.sortBy) === "amount" ? "amount" : "date";
  const actionRows = [
    { id: `pay:view:${messageRecord.id}`, title: "צפייה במערכת", description: "פתיחת הדוח במסך מלא" },
    { id: `xlsx:${messageRecord.id}`, title: "אקסל", description: "הורדת קובץ אקסל" },
    { id: `pdf:${messageRecord.id}`, title: "PDF", description: "הורדת קובץ PDF" },
    { id: `pay:sort:date:${messageRecord.id}`, title: sortBy === "date" ? "מיון: תאריך" : "מיין לפי תאריך", description: "מהחדש לישן כברירת מחדל" },
    { id: `pay:sort:amount:${messageRecord.id}`, title: sortBy === "amount" ? "מיון: סכום" : "מיין לפי סכום", description: "מהגבוה לנמוך" },
    { id: `pay:sources:${messageRecord.id}`, title: "בחירת מקורות", description: "כל המערכות או מקור מסוים" }
  ];
  await sendWhatsAppListMessage(waId, {
    bodyText: "בחר פעולה לדוח התרומות.",
    buttonText: "אפשרויות דוח",
    sections: [
      {
        title: "דוח תרומות",
        rows: actionRows
      }
    ]
  });
}

async function sendWhatsAppPaymentSourcesMenu(waId, messageRecord) {
  const config = messageRecord?.paymentReportConfig || {};
  const currentIds = Array.isArray(config.connectionIds) ? config.connectionIds.map(clean).filter(Boolean) : [];
  const allConnections = Array.isArray(messageRecord?.paymentConnections) ? messageRecord.paymentConnections : [];
  const sourceRows = allConnections.map((connection) => ({
    id: `pay:source:${connection.id}:${messageRecord.id}`,
    title: `${currentIds.includes(connection.id) ? "✓ " : ""}${connection.label}`.slice(0, 24),
    description: "הוספה או הסרה של המקור"
  }));
  const sections = [
    {
      title: "כל המערכות",
      rows: [
        {
          id: `pay:source:all:${messageRecord.id}`,
          title: currentIds.length === allConnections.length ? "כל המערכות ✓" : "כל המערכות",
          description: "הפקה מכל מקורות התשלום"
        }
      ]
    },
    ...chunkArray(sourceRows, 10).map((rows, index) => ({
      title: `מקורות זמינים ${index + 1}`,
      rows
    }))
  ];
  await sendWhatsAppListMessage(waId, {
    bodyText: "בחר מקור תשלום להוספה או להסרה מהדוח.",
    buttonText: "מקורות תשלום",
    sections
  });
}

async function refreshAndSendPaymentReport(waId, user, messageRecord, updateConfig = {}) {
  const currentConfig = messageRecord?.paymentReportConfig || {};
  const nextConfig = {
    ...currentConfig,
    ...updateConfig
  };
  const result = await buildPaymentReportAgentResultFromConfig({
    user,
    paymentReportConfig: nextConfig,
    source: "whatsapp"
  });
  await setAiChatMessageReportConfig({
    messageId: messageRecord.id,
    clerkUserId: user.clerk_user_id,
    paymentReportConfig: result.paymentReportConfig,
    exportUrl: result.exportUrl,
    pdfUrl: result.pdfUrl,
    viewUrl: result.viewUrl,
    searchSummary: result.searchSummary,
    paymentSummary: result.paymentSummary
  });
  await sendWhatsAppTextMessages(waId, buildReplyText(result));
  const refreshedRecord = {
    ...messageRecord,
    ...result,
    paymentReportConfig: result.paymentReportConfig
  };
  await sendWhatsAppPaymentReportActions(waId, refreshedRecord);
  return refreshedRecord;
}

async function sendWhatsAppResult(waId, result, user = null) {
  const replyText = buildReplyText(result);
  if (replyText) {
    await sendWhatsAppTextMessages(waId, replyText);
  }

  if (isDocumentWorkflowAction(result?.pendingAction)) {
    await sendWhatsAppDocumentWorkflowActions(waId, result, user);
    return;
  }

  if (result?.pendingAction?.id && result?.id) {
    const isDocumentUpdateChoice = result.pendingAction.type === "attach_document";
    await sendWhatsAppReplyButtons(waId, {
      bodyText: isDocumentUpdateChoice ? "בחר אם לשייך את הצילום בלבד או גם לעדכן את פרטי התלמיד." : "לא בוצע שינוי עדיין. אפשר לאשר או לדחות כאן.",
      buttons: isDocumentUpdateChoice
        ? [
          { id: `attachonly:${result.id}`, title: "שייך צילום בלבד" },
          { id: `approve:${result.id}`, title: "שייך ועדכן" },
          { id: `reject:${result.id}`, title: "דחה" }
        ]
        : [
          { id: `approve:${result.id}`, title: "אשר" },
          { id: `reject:${result.id}`, title: "דחה" }
        ]
    });
    return;
  }

  if (result?.id) {
    const documentActionRows = buildWhatsAppDocumentActionRows(result);
    if (documentActionRows.length) {
      await sendWhatsAppListMessage(waId, {
        bodyText: "בחר מה לעשות עם המסמך שקיבלתי.",
        buttonText: "בחר פעולה",
        sections: [
          {
            title: "פעולות למסמך",
            rows: documentActionRows
          }
        ]
      });
    }

    if (clean(result?.exportUrl) || clean(result?.pdfUrl)) {
      if (isPaymentReportMessage(result)) {
        await sendWhatsAppPaymentReportActions(waId, result);
      } else {
        await sendWhatsAppReplyButtons(waId, {
          bodyText: "אפשר להתאים את הדוח מתוך השיחה.",
          buttons: [
            { id: `xlsx:${result.id}`, title: "אקסל" },
            { id: `pdf:${result.id}`, title: "PDF" },
            { id: `cols:${result.id}`, title: "התאמה" }
          ]
        });
      }
      return;
    }
    if (Array.isArray(result?.studentCards) && result.studentCards.length) {
      const studentRows = result.studentCards
        .slice(0, 7)
        .map((student, index) => ({
          id: `studentcard:${index}:${result.id}`,
          title: clean(student?.name) || `תלמיד ${index + 1}`,
          description: [
            Number.isFinite(Number(student?.age)) ? `גיל ${Number(student.age)}` : "",
            clean(student?.tznum) ? `ת"ז ${clean(student.tznum)}` : ""
          ].filter(Boolean).join(" | ") || "פתח כרטיס במערכת"
        }));
      await sendWhatsAppListMessage(waId, {
        bodyText: "לבחירת כרטיס תלמיד לפתיחה במערכת.",
        buttonText: "פתח כרטיס",
        sections: [
          {
            title: "תלמידים שנמצאו",
            rows: studentRows
          }
        ]
      });
    }
    await sendWhatsAppReplyButtons(waId, {
      bodyText: "האם התשובה עזרה?",
      buttons: [
        { id: `feedback:good:${result.id}`, title: "עזר" },
        { id: `feedback:bad:${result.id}`, title: "לא מדויק" }
      ]
    });
  }
}

async function handleLimitedWhatsAppAgentMessage({ waId, user, text, attachmentMeta }) {
  if (attachmentMeta) {
    if (!canAccessPrintFeature(user)) {
      await sendWhatsAppTextMessages(
        waId,
        "קיבלתי את המסמך, אבל לחשבון הזה אין הרשאה לשליחה להדפסה. אפשר לשלוח כאן בקשה לאישורים/קבלות בטקסט."
      );
      return "limited_document_no_print_permission";
    }
    const attachment = await downloadWhatsAppMediaAsAttachment(attachmentMeta.mediaId, {
      fileName: attachmentMeta.fileName,
      contentType: attachmentMeta.contentType
    });
    const result = await processDocumentWorkflowAttachment({
      user,
      attachment,
      messageText: "",
      source: "whatsapp"
    });
    await sendWhatsAppTextMessages(waId, buildReplyText(result));
    await sendWhatsAppDocumentWorkflowActions(waId, result, user);
    return "limited_document_print_options_sent";
  }

  if (isPrintRequestText(text)) {
    if (!canAccessPrintFeature(user)) {
      await sendWhatsAppTextMessages(waId, "אין לחשבון הזה הרשאה לשליחה להדפסה.");
      return "limited_print_no_permission";
    }
    await sendWhatsAppTextMessages(waId, `פתיחת מסך הדפסה:\n${toAbsoluteUrl("/print")}`);
    return "limited_print_link_sent";
  }

  if (clean(user?.linked_student_id) && isApprovalReceiptRequestText(text)) {
    const responseText = await createStudentApprovalReceiptTaskFromWhatsApp({
      user,
      requestText: text
    });
    await sendWhatsAppTextMessages(waId, responseText);
    return "limited_student_request_created";
  }

  await sendWhatsAppTextMessages(
    waId,
    clean(user?.linked_student_id)
      ? "אפשר לשלוח כאן בקשה לאישורים/קבלות בטקסט, או לבקש הדפסה אם יש לך הרשאת הדפסה."
      : "אפשר להשתמש כאן בשליחה להדפסה אם יש לך הרשאת הדפסה."
  );
  await sendLimitedWhatsAppMenu(waId, user);
  return "limited_help_sent";
}

function shouldSuppressScopeOnlyReply(result) {
  return clean(result?.reply) === clean(CRM_SCOPE_MESSAGE)
    && !clean(result?.viewUrl)
    && !clean(result?.exportUrl)
    && !(Array.isArray(result?.studentCards) && result.studentCards.length)
    && !result?.pendingAction;
}

const NON_CRM_REPLY = "ההודעה לא נראית קשורה ל-CRM. אפשר לכתוב כאן על תלמידים, מסמכים, שדות, סטטוסים ופעולות במערכת.";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = clean(searchParams.get("hub.mode"));
  const verifyToken = clean(searchParams.get("hub.verify_token"));
  const challenge = clean(searchParams.get("hub.challenge"));

  if (
    mode === "subscribe"
    && verifyToken
    && verifyToken === clean(process.env.WHATSAPP_VERIFY_TOKEN)
  ) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  let inboundEventId = "";
  let fallbackWaId = "";
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-hub-signature-256");
    const parsedBody = rawBody ? JSON.parse(rawBody) : null;

    if (!isWebhookSignatureValid(rawBody, signatureHeader)) {
      const { message, contact, metadata } = extractIncomingMessage(parsedBody || {});
      const waId = clean(message?.from || contact?.wa_id);
      const profileName = clean(contact?.profile?.name);
      const text = extractText(message);
      const attachmentMeta = resolveAttachmentMeta(message);
      await createWhatsAppInboundEvent({
        messageId: clean(message?.id),
        waId,
        phoneNumberId: clean(metadata?.phone_number_id),
        displayPhoneNumber: clean(metadata?.display_phone_number),
        profileName,
        messageType: clean(message?.type) || (attachmentMeta ? "attachment" : "unknown"),
        textPreview: text,
        payload: {
          signatureHeader: clean(signatureHeader),
          body: parsedBody || {}
        },
        processingStatus: "forbidden_signature"
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = parsedBody;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: true });
    }

    const { message, contact, metadata } = extractIncomingMessage(body);
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const waId = clean(message?.from || contact?.wa_id);
    fallbackWaId = waId;
    const profileName = clean(contact?.profile?.name);
    const text = extractText(message);
    const interactiveActionId = extractInteractiveActionId(message);
    const attachmentMeta = resolveAttachmentMeta(message);
    const messageType = clean(message?.type) || (attachmentMeta ? "attachment" : "unknown");
    const inboundEvent = await createWhatsAppInboundEvent({
      messageId: clean(message?.id),
      waId,
      phoneNumberId: clean(metadata?.phone_number_id),
      displayPhoneNumber: clean(metadata?.display_phone_number),
      profileName,
      messageType,
      textPreview: text,
      payload: body
    });
    if (inboundEvent?.duplicate) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    inboundEventId = inboundEvent.id;
    if (!waId) {
      return NextResponse.json({ ok: true });
    }

    if (interactiveActionId) {
      const link = await getWhatsAppLinkByWaId(waId);
      if (!link?.clerk_user_id) {
        const responseText = "המספר הזה עדיין לא מחובר למערכת. היכנס ל-CRM, פתח את מסך WhatsApp, צור קוד חיבור ושלח כאן רק את הקוד.";
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "unlinked",
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      const user = await getAppUserByClerkUserId(link.clerk_user_id);
      if (!user || !canUseWhatsAppAgent(user)) {
        const responseText = "החשבון הזה אינו מורשה להשתמש בסוכן.";
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "unauthorized",
          clerkUserId: link.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      if (!isFullWhatsAppAgentUser(user)) {
        if (interactiveActionId.startsWith("docPrint:") || interactiveActionId.startsWith("docPrintStart:") || interactiveActionId.startsWith("docPrintColorMenu:") || interactiveActionId.startsWith("docPrintPlan:") || interactiveActionId.startsWith("docPrintCopies:") || interactiveActionId.startsWith("docPrintDone:")) {
          // Limited users may continue only through the print workflow handlers below.
        } else if (interactiveActionId.startsWith("docStudentLink:")) {
          const responseText = "שיוך מסמך לתלמיד זמין רק לסופר אדמין.";
          await sendWhatsAppTextMessages(waId, responseText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "limited_student_link_blocked",
            clerkUserId: user.clerk_user_id,
            responseText
          });
          return NextResponse.json({ ok: true });
        } else {
        if (interactiveActionId === "limited:request") {
          const responseText = "כתוב כאן פירוט לבקשה לאישור לימודים או לקבלות/אישורי תשלום. בקשות אחרות לא יפתחו משימה.";
          await sendWhatsAppTextMessages(waId, responseText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "limited_request_prompt",
            clerkUserId: user.clerk_user_id,
            responseText
          });
          return NextResponse.json({ ok: true });
        }
        if (interactiveActionId === "limited:print") {
          const responseText = canAccessPrintFeature(user)
            ? `פתיחת מסך הדפסה:\n${toAbsoluteUrl("/print")}`
            : "אין לחשבון הזה הרשאה לשליחה להדפסה.";
          await sendWhatsAppTextMessages(waId, responseText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: canAccessPrintFeature(user) ? "limited_print_link_sent" : "limited_print_no_permission",
            clerkUserId: user.clerk_user_id,
            responseText
          });
          return NextResponse.json({ ok: true });
        }
        const responseText = "החשבון הזה מחובר לסוכן מוגבל. אפשר להשתמש רק בבקשת אישור לימודים, בקשות קבלות/אישורי תשלום, ובהדפסה לפי הרשאה.";
        await sendWhatsAppTextMessages(waId, responseText);
        await sendLimitedWhatsAppMenu(waId, user);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "limited_action_blocked",
          clerkUserId: user.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
        }
      }

      if (interactiveActionId.startsWith("feedback:")) {
        const [, feedback, messageId] = interactiveActionId.split(":");
        await setAiChatMessageFeedback({
          messageId,
          clerkUserId: user.clerk_user_id,
          feedback
        });
        const responseText = feedback === "good"
          ? "תודה, שמרתי שהתשובה עזרה."
          : "תודה, שמרתי שהתשובה לא היתה מדויקת.";
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "feedback_saved",
          clerkUserId: user.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("studentcard:")) {
        const [, rawIndex, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        const studentCards = Array.isArray(messageRecord?.studentCards) ? messageRecord.studentCards : [];
        const student = studentCards[Number(rawIndex)];
        const url = toAbsoluteUrl(student?.studentCardUrl);
        if (!student || !url) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי את כרטיס התלמיד המבוקש.");
          return NextResponse.json({ ok: true });
        }
        await sendWhatsAppTextMessages(waId, `כרטיס ${clean(student?.name) || "תלמיד"}:\n${url}`);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "student_card_link_sent",
          clerkUserId: user.clerk_user_id,
          responseText: `נשלח קישור לכרטיס ${clean(student?.name) || "תלמיד"}`
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docAction:")) {
        const [, rawIndex, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        const actionLinks = normalizeActionLinks(messageRecord?.actionLinks);
        const actionLink = actionLinks[Number(rawIndex)];
        const actionUrl = toAbsoluteUrl(actionLink?.url);
        if (!actionLink || !actionUrl) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי את הפעולה המבוקשת למסמך.");
          return NextResponse.json({ ok: true });
        }
        const responseText = `${actionLink.label}:\n${actionUrl}`;
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "document_action_link_sent",
          clerkUserId: user.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docPrint:")) {
        const [, printPlan, rawCopies, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isDocumentWorkflowAction(messageRecord?.pendingAction)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        if (!canAccessPrintFeature(user)) {
          await sendWhatsAppTextMessages(waId, "אין לחשבון הזה הרשאה לשליחה להדפסה.");
          return NextResponse.json({ ok: true });
        }
        const job = await createPrintJobFromStoredDocument({
          storedDocument: messageRecord.pendingAction.storedDocument,
          user,
          printPlan,
          copies: rawCopies
        });
        const responseText = [
          "המסמך נשלח לתור ההדפסה.",
          `מספר עבודה: ${job.id}`,
          `סוג הדפסה: ${job.printPlanLabel}`,
          `עותקים: ${job.copies}`
        ].join("\n");
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "document_print_queued",
          clerkUserId: user.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docPrintStart:")) {
        const [, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isDocumentWorkflowAction(messageRecord?.pendingAction)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        await sendWhatsAppDocumentPrintPlans(waId, messageRecord, user);
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docPrintColorMenu:")) {
        const [, messageId] = interactiveActionId.split(":");
        if (!canUseColorPrint(user)) {
          await sendWhatsAppTextMessages(waId, "הדפסה בצבע זמינה רק למשתמשים מורשים.");
          return NextResponse.json({ ok: true });
        }
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isDocumentWorkflowAction(messageRecord?.pendingAction)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        await sendWhatsAppDocumentPrintPlans(waId, messageRecord, user, { colorOnly: true });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docPrintPlan:")) {
        const [, printPlan, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isDocumentWorkflowAction(messageRecord?.pendingAction)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        if (!canAccessPrintFeature(user)) {
          await sendWhatsAppTextMessages(waId, "אין לחשבון הזה הרשאה לשליחה להדפסה.");
          return NextResponse.json({ ok: true });
        }
        const job = await createPrintJobFromStoredDocument({
          storedDocument: messageRecord.pendingAction.storedDocument,
          user,
          printPlan,
          copies: 1
        });
        if (printPlan === "convert-pdf") {
          const responseText = [
            "המרה ל-PDF נקלטה בהצלחה.",
            "העבודה נשלחה למערכת ההמרה הנפרדת.",
            `מספר עבודה: ${job.id}`,
            `סוג עבודה: ${job.printPlanLabel}`,
            "בסיום ההמרה הקובץ המומר יישלח אליך במייל."
          ].join("\n");
          await sendWhatsAppTextMessages(waId, responseText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "document_pdf_conversion_queued",
            clerkUserId: user.clerk_user_id,
            responseText
          });
          return NextResponse.json({ ok: true });
        }
        const introText = [
          "נשלח עותק אחד להדפסה.",
          `מספר עבודה: ${job.id}`,
          `סוג הדפסה: ${job.printPlanLabel}`
        ].join("\n");
        await sendWhatsAppAdditionalCopiesPrompt(waId, {
          messageId,
          printPlan,
          introText
        });
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "document_print_first_copy_queued",
          clerkUserId: user.clerk_user_id,
          responseText: introText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docPrintDone:")) {
        const [, messageId] = interactiveActionId.split(":");
        await clearAiChatMessagePendingAction({
          clerkUserId: user.clerk_user_id,
          messageId
        }).catch(() => null);
        const responseText = "סיימתי. לא אשלח עוד עותקים למסמך הזה.";
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "document_print_finished",
          clerkUserId: user.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docPrintCopies:")) {
        const [, printPlan, rawCopies, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isDocumentWorkflowAction(messageRecord?.pendingAction)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        if (!canAccessPrintFeature(user)) {
          await sendWhatsAppTextMessages(waId, "אין לחשבון הזה הרשאה לשליחה להדפסה.");
          return NextResponse.json({ ok: true });
        }
        const job = await createPrintJobFromStoredDocument({
          storedDocument: messageRecord.pendingAction.storedDocument,
          user,
          printPlan,
          copies: rawCopies
        });
        const introText = [
          `נשלחו עוד ${job.copies} עותקים לתור ההדפסה.`,
          `מספר עבודה: ${job.id}`,
          `סוג הדפסה: ${job.printPlanLabel}`,
          `עותקים: ${job.copies}`
        ].join("\n");
        await sendWhatsAppAdditionalCopiesPrompt(waId, {
          messageId,
          printPlan,
          introText
        });
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "document_print_more_queued",
          clerkUserId: user.clerk_user_id,
          responseText: introText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("docStudentLink:")) {
        if (!canLinkDocumentsToStudents(user)) {
          const responseText = "שיוך מסמך לתלמיד זמין רק לסופר אדמין.";
          await sendWhatsAppTextMessages(waId, responseText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "document_student_link_forbidden",
            clerkUserId: user.clerk_user_id,
            responseText
          });
          return NextResponse.json({ ok: true });
        }
        const [, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isDocumentWorkflowAction(messageRecord?.pendingAction)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי מסמך שממתין לשיוך.");
          return NextResponse.json({ ok: true });
        }
        await sendWhatsAppTextMessages(waId, "מתחיל ניתוח וחיפוש תלמיד לשיוך המסמך.");
        const result = await processStoredDocumentForStudentLink({
          user,
          storedDocument: messageRecord.pendingAction.storedDocument,
          messageText: "שיוך מסמך לתלמיד",
          source: "whatsapp"
        });
        await sendWhatsAppResult(waId, result, user);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "document_student_link_started",
          clerkUserId: user.clerk_user_id,
          responseText: buildReplyText(result)
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("cols:")) {
        const [, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (isPaymentReportMessage(messageRecord)) {
          await sendWhatsAppTextMessages(waId, "בדוח תרומות אין בחירת עמודות מתוך WhatsApp. אפשר להוריד ישר אקסל או PDF.");
          return NextResponse.json({ ok: true });
        }
        await sendWhatsAppReplyButtons(waId, {
          bodyText: "בחר פריסט עמודות או סוג מיון.",
          buttons: [
            { id: `sort:name:${messageId}`, title: "מיון שם" },
            { id: `sort:class:${messageId}`, title: "מיון שיעור" },
            { id: `presets:${messageId}`, title: "עמודות" }
          ]
        });
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "report_columns_prompt",
          clerkUserId: link?.clerk_user_id || null,
          responseText: "נשלחה בחירת עמודות לדוח"
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("pay:view:")) {
        const [, , messageId] = interactiveActionId.split(":");
        await sendWhatsAppTextMessages(waId, toAbsoluteUrl(buildAiLinkPath(messageId, "view")));
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("pay:sources:")) {
        const [, , messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isPaymentReportMessage(messageRecord)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי דוח תשלומים להתאמה.");
          return NextResponse.json({ ok: true });
        }
        const { listPaymentConnections } = await import("../../../../lib/payment-systems");
        const paymentConnections = await listPaymentConnections({ activeOnly: true });
        await sendWhatsAppPaymentSourcesMenu(waId, {
          ...messageRecord,
          paymentConnections
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("pay:source:")) {
        const parts = interactiveActionId.split(":");
        const target = clean(parts[2]);
        const messageId = clean(parts[3]);
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isPaymentReportMessage(messageRecord)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי דוח תשלומים להתאמה.");
          return NextResponse.json({ ok: true });
        }
        const { listPaymentConnections } = await import("../../../../lib/payment-systems");
        const paymentConnections = await listPaymentConnections({ activeOnly: true });
        const allIds = paymentConnections.map((connection) => connection.id);
        const currentIds = Array.isArray(messageRecord.paymentReportConfig?.connectionIds)
          ? messageRecord.paymentReportConfig.connectionIds.map(clean).filter(Boolean)
          : allIds;
        const nextIds = target === "all"
          ? allIds
          : (currentIds.includes(target)
            ? currentIds.filter((id) => id !== target)
            : [...currentIds, target]);
        const finalIds = nextIds.length ? nextIds : allIds;
        const refreshed = await refreshAndSendPaymentReport(waId, user, messageRecord, {
          connectionIds: finalIds
        });
        await sendWhatsAppPaymentSourcesMenu(waId, {
          ...refreshed,
          paymentConnections
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("pay:sort:")) {
        const [, , sortBy, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!isPaymentReportMessage(messageRecord)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי דוח תשלומים להתאמה.");
          return NextResponse.json({ ok: true });
        }
        await refreshAndSendPaymentReport(waId, user, messageRecord, {
          sortBy: clean(sortBy) === "amount" ? "amount" : "date",
          sortDir: "desc"
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("presets:")) {
        const [, messageId] = interactiveActionId.split(":");
        await sendWhatsAppListMessage(waId, {
          bodyText: "בחר מבנה עמודות לדוח.",
          buttonText: "בחר עמודות",
          sections: [
            {
              title: "מבני עמודות",
              rows: [
                { id: `preset:default:${messageId}`, title: "ברירת מחדל", description: "שם ושיעור" },
                { id: `preset:contact:${messageId}`, title: "אנשי קשר", description: "טלפונים ואימיילים" },
                { id: `preset:address:${messageId}`, title: "כתובת", description: "כתובת מלאה" },
                { id: `preset:bank:${messageId}`, title: "פרטי בנק", description: "בנק-סניף-חשבון" }
              ]
            }
          ]
        });
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "report_presets_prompt",
          clerkUserId: user.clerk_user_id,
          responseText: "נשלחו פריסטים לדוח"
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("xlsx:") || interactiveActionId.startsWith("pdf:")) {
        const [kind, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!messageRecord || (kind === "xlsx" && !messageRecord.exportUrl) || (kind === "pdf" && !messageRecord.pdfUrl)) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי את הקובץ המבוקש.");
          return NextResponse.json({ ok: true });
        }
        await sendInstitutionAttachments(waId, {
          ...messageRecord,
          exportUrl: kind === "xlsx" ? messageRecord.exportUrl : "",
          pdfUrl: kind === "pdf" ? messageRecord.pdfUrl : ""
        });
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: kind === "xlsx" ? "report_xlsx_sent" : "report_pdf_sent",
          clerkUserId: user.clerk_user_id,
          responseText: kind === "xlsx" ? "נשלח אקסל" : "נשלח PDF"
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("sort:") || interactiveActionId.startsWith("preset:")) {
        const [kind, value, messageId] = interactiveActionId.split(":");
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (isPaymentReportMessage(messageRecord)) {
          await sendWhatsAppTextMessages(waId, "בדוח תרומות אין התאמת עמודות בסגנון דוח תלמידים.");
          return NextResponse.json({ ok: true });
        }
        if (!messageRecord) {
          await sendWhatsAppTextMessages(waId, "לא מצאתי את הדוח המקורי.");
          return NextResponse.json({ ok: true });
        }

        const nextConfig = {};
        if (kind === "sort") {
          nextConfig.sortLevels = [{ sortBy: clean(value) === "class" ? "class" : "name", sortDir: "asc" }];
        }
        if (kind === "preset" && REPORT_COLUMN_PRESETS[clean(value)]) {
          nextConfig.exportColumns = withRequiredColumns(REPORT_COLUMN_PRESETS[clean(value)]);
        }
        await setAiChatMessageReportConfig({
          messageId,
          clerkUserId: user.clerk_user_id,
          ...nextConfig
        });

        const refreshedRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        const sortLabel = REPORT_SORT_OPTIONS.find((option) => option.key === clean(value))?.label || "שם משפחה";
        await sendWhatsAppTextMessages(
          waId,
          kind === "sort"
            ? `המיון עודכן ל-${sortLabel}.`
            : `העמודות עודכנו לפריסט ${clean(value) === "contact" ? "אנשי קשר" : clean(value) === "address" ? "כתובת" : clean(value) === "bank" ? "פרטי בנק" : "ברירת מחדל"}.`
        );
        await sendWhatsAppReplyButtons(waId, {
          bodyText: "הדוח עודכן. אפשר להוריד או להמשיך להתאים.",
          buttons: [
            { id: `xlsx:${messageId}`, title: "אקסל" },
            { id: `pdf:${messageId}`, title: "PDF" },
            { id: `cols:${messageId}`, title: "התאמה" }
          ]
        });
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: kind === "sort" ? "report_sort_updated" : "report_columns_updated",
          clerkUserId: user.clerk_user_id,
          responseText: kind === "sort" ? `המיון עודכן ל-${clean(value) === "class" ? "שיעור" : "שם משפחה"}` : `העמודות עודכנו לפריסט ${clean(value)}`
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("approve:") || interactiveActionId.startsWith("attachonly:") || interactiveActionId.startsWith("reject:")) {
        const [decision, messageId] = interactiveActionId.split(":");
        const pendingAction = await getPendingActionForMessage({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!pendingAction) {
          const responseText = "לא נמצאה פעולה ממתינה.";
          await sendWhatsAppTextMessages(waId, responseText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "missing_pending_action",
            clerkUserId: user.clerk_user_id,
            responseText
          });
          return NextResponse.json({ ok: true });
        }

        const normalizedDecision = decision === "attachonly" ? "attach_only" : decision;
        const result = await handleApprovedAiAction({ user, decision: normalizedDecision, pendingAction, messageId });
        const assistantMessage = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        await sendWhatsAppResult(waId, {
          id: messageId,
          reply: result.reply,
          studentCards: result.studentCards || [],
          searchSummary: result.searchSummary || "",
          viewUrl: assistantMessage?.viewUrl || "",
          exportUrl: assistantMessage?.exportUrl || ""
        }, user);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: normalizedDecision === "approve" ? "approved_action" : normalizedDecision === "attach_only" ? "attached_document_only" : "rejected_action",
          clerkUserId: user.clerk_user_id,
          responseText: result.reply
        });
        return NextResponse.json({ ok: true });
      }
    }

    if (text && !attachmentMeta) {
      try {
        const linkResult = await consumeWhatsAppLinkCode({
          code: text,
          waId,
          phoneNumber: waId,
          profileName
        });
        const user = await getAppUserByClerkUserId(linkResult.clerkUserId);
        await sendWhatsAppTextMessages(
          waId,
          `החיבור הושלם בהצלחה. מעכשיו אני מזהה אותך כ-${user?.display_name || "משתמש מורשה"}.`
        );
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "linked",
          clerkUserId: linkResult.clerkUserId,
          responseText: `החיבור הושלם בהצלחה. מעכשיו אני מזהה אותך כ-${user?.display_name || "משתמש מורשה"}.`
        });
        return NextResponse.json({ ok: true });
      } catch (error) {
        const messageText = clean(error?.message);
        const isCodeAttempt = /^[A-Z0-9]{6,12}$/i.test(text);
        if (isCodeAttempt && messageText) {
          await sendWhatsAppTextMessages(waId, messageText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "link_failed",
            responseText: messageText
          });
          return NextResponse.json({ ok: true });
        }
      }
    }

    const link = await getWhatsAppLinkByWaId(waId);
    if (!link?.clerk_user_id) {
      const responseText = "המספר הזה עדיין לא מחובר למערכת. היכנס ל-CRM, פתח את מסך WhatsApp, צור קוד חיבור ושלח כאן רק את הקוד.";
      await sendWhatsAppTextMessages(
        waId,
        responseText
      );
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "unlinked",
        responseText
      });
      return NextResponse.json({ ok: true });
    }

    const user = await getAppUserByClerkUserId(link.clerk_user_id);
    if (!user || !canUseWhatsAppAgent(user)) {
      const responseText = "החשבון הזה אינו מורשה להשתמש בסוכן.";
      await sendWhatsAppTextMessages(waId, responseText);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "unauthorized",
        clerkUserId: link.clerk_user_id,
        responseText
      });
      return NextResponse.json({ ok: true });
    }
    if (!user.agent_whatsapp_enabled) {
      const responseText = "הגישה שלך לסוכן דרך WhatsApp כבויה כרגע. פנה למנהל המערכת.";
      await sendWhatsAppTextMessages(waId, responseText);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "channel_disabled",
        clerkUserId: user.clerk_user_id,
        responseText
      });
      return NextResponse.json({ ok: true });
    }

    if (!isFullWhatsAppAgentUser(user)) {
      const processingStatus = await handleLimitedWhatsAppAgentMessage({
        waId,
        user,
        text,
        attachmentMeta
      });
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus,
        clerkUserId: user.clerk_user_id,
        responseText: text || (attachmentMeta ? "מסמך התקבל במסלול מוגבל" : "")
      });
      return NextResponse.json({ ok: true });
    }

    if (attachmentMeta) {
      await sendWhatsAppTextMessages(
        waId,
        "קיבלתי את המסמך. אני מעבד אותו עכשיו ואחזיר לך אפשרויות להמשך."
      ).catch(() => null);
      let result;
      try {
        const attachment = await downloadWhatsAppMediaAsAttachment(attachmentMeta.mediaId, {
          fileName: attachmentMeta.fileName,
          contentType: attachmentMeta.contentType
        });
        result = await processDocumentWorkflowAttachment({
          user,
          attachment,
          messageText: text,
          source: "whatsapp"
        });
      } catch (error) {
        console.error("WhatsApp document processing failed:", error?.message || error);
        const responseText = `המסמך התקבל, אבל העיבוד נכשל: ${clean(error?.message) || "שגיאה לא ידועה"}. נסה לשלוח שוב או לפתוח את מסך ההדפסה במערכת.`;
        await sendWhatsAppTextMessages(waId, responseText).catch(() => null);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "document_processing_failed",
          clerkUserId: user.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }
      await sendWhatsAppResult(waId, result, user);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "processed_document",
        clerkUserId: user.clerk_user_id,
        responseText: buildReplyText(result)
      });
      return NextResponse.json({ ok: true });
    }

    if (!text) {
      const responseText = "כרגע אפשר לשלוח ב-WhatsApp טקסט, תמונות ומסמכי PDF.";
      await sendWhatsAppTextMessages(waId, responseText);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "unsupported_message",
        clerkUserId: user.clerk_user_id,
        responseText
      });
      return NextResponse.json({ ok: true });
    }

    const result = await processTextAiMessage({
      user,
      messageText: text,
      source: "whatsapp"
    });
    if (shouldSuppressScopeOnlyReply(result)) {
      await sendWhatsAppTextMessages(waId, NON_CRM_REPLY);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "non_crm_reply",
        clerkUserId: user.clerk_user_id,
        responseText: NON_CRM_REPLY
      });
      return NextResponse.json({ ok: true });
    }
    await sendWhatsAppResult(waId, result, user);
    await updateWhatsAppInboundEvent(inboundEvent.id, {
      processingStatus: "processed_text",
      clerkUserId: user.clerk_user_id,
      responseText: buildReplyText(result)
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("WhatsApp webhook failed:", error?.message || error);
    if (fallbackWaId) {
      await sendWhatsAppTextMessages(
        fallbackWaId,
        `אירעה שגיאה בטיפול בהודעה: ${clean(error?.message) || "שגיאה לא ידועה"}. נסה שוב בעוד רגע.`
      ).catch(() => null);
    }
    if (inboundEventId) {
      await updateWhatsAppInboundEvent(inboundEventId, {
        processingStatus: "failed",
        responseText: clean(error?.message || error)
      }).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }
}
