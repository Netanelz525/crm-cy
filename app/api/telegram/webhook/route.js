import { NextResponse } from "next/server";
import { getAppUserByClerkUserId } from "../../../../lib/rbac";
import { getTelegramWebhookSecret, getTelegramLinkByChatId, consumeTelegramLinkCode, sendTelegramMessage, sendTelegramDocumentFile, answerTelegramCallbackQuery, downloadTelegramFileAsAttachment, editTelegramMessageReplyMarkup } from "../../../../lib/telegram";
import { processTextAiMessage, handleApprovedAiAction, getPendingActionForMessage } from "../../../../lib/ai-text-agent";
import { clearAiChatMessagePendingAction, createAiChatMessage, getAiChatMessageById, getAiChatMessageByIdPrefix, setAiChatMessageExportColumns, setAiChatMessageFeedback, setAiChatMessageReportConfig } from "../../../../lib/ai-chat-history";
import { createPrintJobFromStoredDocument, processDocumentWorkflowAttachment, processStoredDocumentForStudentLink } from "../../../../lib/ai-document-agent";
import { canAccessPrintFeature, canUseColorPrint } from "../../../../lib/print-jobs";
import { buildInstitutionCsvExport, buildInstitutionPdfExport } from "../../../../lib/institution-exports";
import { buildPaymentReportUrls } from "../../../../lib/payment-report";
import { buildPaymentReportAgentResultFromConfig } from "../../../../lib/payment-agent";
import { buildStudentCardLines } from "../../../../lib/student-agent";
import { INSTITUTION_COLUMN_MAP, INSTITUTION_COLUMNS_FULL } from "../../../../lib/student-view";
import { buildPaymentReportExcelExport, buildPaymentReportPdfExport } from "../../../../lib/payment-report-exports";

function clean(value) {
  return String(value || "").trim();
}

function canLinkDocumentsToStudents(user) {
  return Boolean(user?.is_super_admin);
}

function extractChat(update) {
  return update?.message?.chat || update?.callback_query?.message?.chat || null;
}

function resolveTelegramAttachment(message) {
  const document = message?.document;
  if (document?.file_id) {
    return {
      fileId: clean(document.file_id),
      fileName: clean(document.file_name) || "telegram-document",
      contentType: clean(document.mime_type) || "application/octet-stream"
    };
  }

  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const photo = photos[photos.length - 1];
  if (photo?.file_id) {
    const photoId = clean(photo.file_id);
    return {
      fileId: photoId,
      fileName: `${photoId}.jpg`,
      contentType: "image/jpeg"
    };
  }

  return null;
}

async function sendNotLinkedMessage(chatId) {
  await sendTelegramMessage(
    chatId,
    "החשבון הזה עדיין לא מחובר למערכת. היכנס לאתר, פתח את מסך Telegram, צור קוד חיבור, ואז שלח לי /start עם הקוד."
  );
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
  if (!baseUrl) return "";
  const relativePath = clean(path);
  if (!relativePath) return "";
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${baseUrl}${relativePath.startsWith("/") ? relativePath : `/${relativePath}`}`;
}

function splitMessageForTelegram(text, visibleLines = 8) {
  const raw = String(text || "");
  const lines = raw.split("\n");
  if (lines.length <= visibleLines && raw.length <= 700) {
    return {
      text: raw,
      hasMore: false
    };
  }

  const visibleText = lines.slice(0, visibleLines).join("\n");
  return {
    text: `${visibleText}\n\nיש עוד פריטים ברשימה. אפשר ללחוץ על "הצג עוד".`,
    hasMore: true
  };
}

function splitFullTelegramMessage(text, maxChars = 3800) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  if (raw.length <= maxChars) return [raw];

  const chunks = [];
  let remaining = raw;
  while (remaining.length > maxChars) {
    let splitIndex = remaining.lastIndexOf("\n", maxChars);
    if (splitIndex < Math.floor(maxChars * 0.6)) {
      splitIndex = remaining.lastIndexOf(" ", maxChars);
    }
    if (splitIndex < Math.floor(maxChars * 0.6)) {
      splitIndex = maxChars;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
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

function toTelegramToken(value, length = 8) {
  const raw = clean(value);
  if (!raw) return "";
  const preferred = raw.split("-")[0];
  return clean(preferred || raw).slice(0, length);
}

async function resolveTelegramMessageRecord(clerkUserId, messageIdOrToken) {
  const exactId = clean(messageIdOrToken);
  if (!exactId) return null;
  return await getAiChatMessageById({ clerkUserId, messageId: exactId })
    || await getAiChatMessageByIdPrefix({ clerkUserId, messageIdPrefix: exactId });
}

async function buildTelegramPaymentKeyboard({ messageId, messageRecord, hasMore = false }) {
  const { listPaymentConnections } = await import("../../../../lib/payment-systems");
  const activeConnections = await listPaymentConnections({ activeOnly: true });
  const selectedIds = Array.isArray(messageRecord?.paymentReportConfig?.connectionIds)
    ? messageRecord.paymentReportConfig.connectionIds.map(clean).filter(Boolean)
    : activeConnections.map((connection) => connection.id);
  const sortBy = clean(messageRecord?.paymentReportConfig?.sortBy) === "amount" ? "amount" : "date";
  const messageToken = toTelegramToken(messageId);
  const keyboard = [
    [
      { text: "אקסל", callback_data: `xlsx:${messageToken}` },
      { text: "PDF", callback_data: `pdf:${messageToken}` }
    ]
  ];
  const absoluteViewUrl = toAbsoluteUrl(messageRecord?.viewUrl || "");
  if (absoluteViewUrl) {
    keyboard.push([{ text: "פתח דוח במערכת", url: absoluteViewUrl }]);
  }
  if (hasMore) {
    keyboard.push([{ text: "הצג עוד", callback_data: `more:${messageToken}` }]);
  }
  keyboard.push([
    { text: sortBy === "date" ? "✅ מיון תאריך" : "מיון תאריך", callback_data: `paysort:date:${messageToken}` },
    { text: sortBy === "amount" ? "✅ מיון סכום" : "מיון סכום", callback_data: `paysort:amount:${messageToken}` }
  ]);
  keyboard.push([
    {
      text: selectedIds.length === activeConnections.length ? "✅ כל המערכות" : "כל המערכות",
      callback_data: `paysource:all:${messageToken}`
    }
  ]);
  activeConnections.forEach((connection) => {
    const connectionToken = toTelegramToken(connection.id, 10);
    keyboard.push([{
      text: `${selectedIds.includes(connection.id) ? "✅ " : ""}${connection.label}`.slice(0, 48),
      callback_data: `paysource:${connectionToken}:${messageToken}`
    }]);
  });
  keyboard.push([
    { text: "⚫ תשובה טובה", callback_data: `feedback:good:${messageToken}` },
    { text: "🔴 לא מדויק", callback_data: `feedback:bad:${messageToken}` }
  ]);
  return { inline_keyboard: keyboard };
}

async function refreshTelegramPaymentReport({ chatId, user, messageRecord, updateConfig = {} }) {
  const nextConfig = {
    ...(messageRecord?.paymentReportConfig || {}),
    ...updateConfig
  };
  const result = await buildPaymentReportAgentResultFromConfig({
    user,
    paymentReportConfig: nextConfig,
    source: "telegram"
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
  const replyText = [
    result.reply,
    result.searchSummary ? `\nאיך חיפשתי: ${result.searchSummary}` : ""
  ].filter(Boolean).join("\n");
  const keyboard = await buildTelegramPaymentKeyboard({
    messageId: messageRecord.id,
    messageRecord: {
      ...messageRecord,
      ...result,
      paymentReportConfig: result.paymentReportConfig
    }
  });
  await sendTelegramMessage(chatId, replyText, { replyMarkup: keyboard })
    .catch(async () => {
      await sendTelegramMessage(chatId, replyText);
    });
}

async function sendTelegramMessageWithFallback(chatId, text, options = {}) {
  try {
    return await sendTelegramMessage(chatId, text, options);
  } catch (error) {
    if (options?.replyMarkup) {
      return sendTelegramMessage(chatId, text);
    }
    throw error;
  }
}

function buildTelegramStudentCardsText(studentCards = []) {
  const cards = Array.isArray(studentCards) ? studentCards : [];
  if (!cards.length) return "";
  return cards
    .slice(0, 7)
    .map((student, index) => [`כרטיס תלמיד ${index + 1}:`, ...buildStudentCardLines(student)].join("\n"))
    .join("\n\n");
}

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
  "field:phone.additionalPhones",
  "field:dadPhone.primaryPhoneNumber",
  "field:dadPhone.primaryPhoneCountryCode",
  "field:dadPhone.primaryPhoneCallingCode",
  "field:dadPhone.additionalPhones",
  "field:momPhone.primaryPhoneNumber",
  "field:momPhone.primaryPhoneCountryCode",
  "field:momPhone.primaryPhoneCallingCode",
  "field:momPhone.additionalPhones",
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
  address: ["name", "tznum", "address"]
};
const PRIORITY_EXPORT_COLUMNS = [
  "address",
  "bankDetails",
  "field:dateofbirth",
  "class",
  "age",
  "studentPhone",
  "dadPhone",
  "momPhone",
  "studentEmail",
  "fatherEmail",
  "motherEmail",
  "fatherTz",
  "motherTz",
  "institution",
  "registration",
  "missing"
];
const TELEGRAM_EXPORT_COLUMN_OPTIONS = INSTITUTION_COLUMNS_FULL
  .map((column) => column.key)
  .filter((key) => INSTITUTION_COLUMN_MAP[key] && !REQUIRED_EXPORT_COLUMNS.includes(key) && !REPORT_EXCLUDED_COLUMNS.has(key))
  .sort((left, right) => {
    const leftIndex = PRIORITY_EXPORT_COLUMNS.indexOf(left);
    const rightIndex = PRIORITY_EXPORT_COLUMNS.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }
    return (INSTITUTION_COLUMN_MAP[left]?.label || left).localeCompare(INSTITUTION_COLUMN_MAP[right]?.label || right, "he");
  });

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

const DOCUMENT_PRINT_PLANS = [
  { value: "corner-staple-bw", label: "שחור לבן, הידוק פינה" },
  { value: "duplex-bw", label: "שחור לבן, A4 דו צדדי" },
  { value: "booklet-bw", label: "שחור לבן, חוברת A3" },
  { value: "single-a4-bw", label: "שחור לבן, A4 צד אחד" },
  { value: "single-a3-bw", label: "שחור לבן, A3 צד אחד" },
  { value: "convert-pdf", label: "המרה ל-PDF" }
];
const COLOR_DOCUMENT_PRINT_PLANS = [
  { value: "corner-staple-color", label: "צבע, הידוק פינה" },
  { value: "duplex-color", label: "צבע, A4 דו צדדי" },
  { value: "booklet-color", label: "צבע, חוברת A3" },
  { value: "single-a4-color", label: "צבע, A4 צד אחד" },
  { value: "single-a3-color", label: "צבע, A3 צד אחד" }
];
const DOCUMENT_PRINT_COPIES = [1, 5, 20, 40];

function buildTelegramKeyboard({ messageId, pendingAction = null, studentCards = [], viewUrl = "", exportUrl = "", pdfUrl = "", actionLinks = [], exportColumns = [], sortLevels = [], hasMore = false, includeFeedback = true, canLinkStudentDocuments = false, canUseColor = false }) {
  const inlineKeyboard = [];
  const isPaymentReport = isPaymentReportLink(exportUrl) || isPaymentReportLink(pdfUrl) || isPaymentViewLink(viewUrl);

  if (clean(pendingAction?.type) === "document_workflow" && messageId) {
    return {
      inline_keyboard: [
        [{ text: "הדפסה", callback_data: `docprintstart:${messageId}` }],
        ...(canLinkStudentDocuments ? [[
          { text: "שיוך לתלמיד", callback_data: `docstudent:${messageId}` }
        ]] : [])
      ]
    };
  }

  const actionButtons = (Array.isArray(actionLinks) ? actionLinks : [])
    .map((link) => {
      const url = toAbsoluteUrl(link?.url);
      const label = clean(link?.label);
      if (!url || !label) return null;
      return { text: label, url };
    })
    .filter(Boolean);
  actionButtons.forEach((button) => inlineKeyboard.push([button]));

  if (pendingAction) {
    if (clean(pendingAction.type) === "attach_document") {
      inlineKeyboard.push([
        { text: "שייך צילום בלבד", callback_data: `attachonly:${messageId}` },
        { text: "שייך ועדכן", callback_data: `approve:${messageId}` }
      ]);
      inlineKeyboard.push([{ text: "סרב", callback_data: `reject:${messageId}` }]);
    } else {
      inlineKeyboard.push([
        { text: "אשר", callback_data: `approve:${messageId}` },
        { text: "סרב", callback_data: `reject:${messageId}` }
      ]);
    }
  }

  const paymentViewUrl = isPaymentReport && messageId ? buildAiLinkPath(messageId, "view") : viewUrl;
  const absoluteViewUrl = toAbsoluteUrl(paymentViewUrl);
  if (absoluteViewUrl) {
    inlineKeyboard.push([{ text: "פתח תצוגה מלאה", url: absoluteViewUrl }]);
  }

  if (exportUrl || pdfUrl) {
    inlineKeyboard.push([
      { text: "אקסל", callback_data: `xlsx:${messageId}` },
      { text: "PDF", callback_data: `pdf:${messageId}` }
    ]);
    if (!isPaymentReport) {
      const activeSort = normalizeSortLevels(sortLevels)[0]?.sortBy || "class";
      inlineKeyboard.push([
        { text: activeSort === "name" ? "✅ מיון שם" : "מיון שם", callback_data: `sort:name:${messageId}` },
        { text: activeSort === "class" ? "✅ מיון שיעור" : "מיון שיעור", callback_data: `sort:class:${messageId}` }
      ]);
      inlineKeyboard.push([{ text: "עמודות", callback_data: `cols:${messageId}` }]);
    }
  }

  const cardButtons = (Array.isArray(studentCards) ? studentCards : [])
    .slice(0, 3)
    .map((student) => {
      const url = toAbsoluteUrl(student?.studentCardUrl);
      if (!url) return null;
      return { text: `כרטיס: ${clean(student?.name) || "תלמיד"}`, url };
    })
    .filter(Boolean);
  cardButtons.forEach((button) => inlineKeyboard.push([button]));
  if ((Array.isArray(studentCards) ? studentCards : []).length > 1) {
    inlineKeyboard.push([{ text: "בחר תלמיד לעדכון", callback_data: `pickstudent:${messageId}` }]);
  }

  if (hasMore) {
    inlineKeyboard.push([{ text: "הצג עוד", callback_data: `more:${messageId}` }]);
  }

  if (includeFeedback && messageId) {
    inlineKeyboard.push([
      { text: "⚫ תשובה טובה", callback_data: `feedback:good:${messageId}` },
      { text: "🔴 לא מדויק", callback_data: `feedback:bad:${messageId}` }
    ]);
  }

  return inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined;
}

function buildTelegramStudentPickerKeyboard({ messageId, studentCards = [] }) {
  const cards = (Array.isArray(studentCards) ? studentCards : []).filter((card) => clean(card?.id));
  const inlineKeyboard = cards.slice(0, 7).map((student, index) => ([
    {
      text: clean(student?.name) || `תלמיד ${index + 1}`,
      callback_data: `pick:${messageId}:${index}`
    }
  ]));
  inlineKeyboard.push([{ text: "חזור", callback_data: `back:${messageId}` }]);
  return { inline_keyboard: inlineKeyboard };
}

function buildTelegramDocumentCopiesKeyboard({ messageId, printPlan }) {
  return {
    inline_keyboard: [
      [{ text: "סיימתי", callback_data: `docdone:${messageId}` }],
      [1, 5].map((copies) => ({ text: `עוד ${copies}`, callback_data: `doccopies:${printPlan}:${copies}:${messageId}` })),
      [20, 40].map((copies) => ({ text: `עוד ${copies}`, callback_data: `doccopies:${printPlan}:${copies}:${messageId}` }))
    ]
  };
}

function buildTelegramDocumentPrintPlansKeyboard({ messageId, canUseColor = false, colorOnly = false }) {
  const plans = colorOnly ? COLOR_DOCUMENT_PRINT_PLANS : DOCUMENT_PRINT_PLANS;
  const rows = plans.map((plan) => ([
    { text: plan.label, callback_data: `docplan:${plan.value}:${messageId}` }
  ]));
  if (!colorOnly && canUseColor) {
    rows.push([{ text: "הדפסה בצבע", callback_data: `doccolormenu:${messageId}` }]);
  }
  return { inline_keyboard: rows };
}

function buildTelegramColumnsKeyboard({ messageId, exportColumns = [], sortLevels = [], viewUrl = "", includeFeedback = false }) {
  const inlineKeyboard = [];
  const selected = new Set(withRequiredColumns(exportColumns));

  inlineKeyboard.push([{ text: "שם תלמיד", callback_data: `noop:${messageId}` }]);

  for (let index = 0; index < TELEGRAM_EXPORT_COLUMN_OPTIONS.length; index += 2) {
    const row = TELEGRAM_EXPORT_COLUMN_OPTIONS.slice(index, index + 2).map((columnKey, offset) => {
      const optionIndex = index + offset;
      const label = INSTITUTION_COLUMN_MAP[columnKey]?.label || columnKey;
      const mark = selected.has(columnKey) ? "✅" : "⬜";
      return {
        text: `${mark} ${label}`,
        callback_data: `col:${optionIndex}:${messageId}`
      };
    });
    inlineKeyboard.push(row);
  }

  inlineKeyboard.push([
    { text: "שלח אקסל", callback_data: `xlsx:${messageId}` },
    { text: "שלח PDF", callback_data: `pdf:${messageId}` }
  ]);
  inlineKeyboard.push([
    { text: "פריסט: ברירת מחדל", callback_data: `preset:default:${messageId}` },
    { text: "פריסט: קשר", callback_data: `preset:contact:${messageId}` }
  ]);
  inlineKeyboard.push([{ text: "פריסט: כתובת", callback_data: `preset:address:${messageId}` }]);
  const activeSort = normalizeSortLevels(sortLevels)[0]?.sortBy || "class";
  inlineKeyboard.push([
    { text: activeSort === "name" ? "✅ מיון שם" : "מיון שם", callback_data: `sort:name:${messageId}` },
    { text: activeSort === "class" ? "✅ מיון שיעור" : "מיון שיעור", callback_data: `sort:class:${messageId}` }
  ]);

  const absoluteViewUrl = toAbsoluteUrl(viewUrl);
  if (absoluteViewUrl) {
    inlineKeyboard.push([{ text: "פתח תצוגה מלאה", url: absoluteViewUrl }]);
  }

  inlineKeyboard.push([{ text: "סגור בחירת עמודות", callback_data: `done:${messageId}` }]);

  if (includeFeedback && messageId) {
    inlineKeyboard.push([
      { text: "⚫ תשובה טובה", callback_data: `feedback:good:${messageId}` },
      { text: "🔴 לא מדויק", callback_data: `feedback:bad:${messageId}` }
    ]);
  }

  return { inline_keyboard: inlineKeyboard };
}

async function sendInstitutionAttachment(chatId, type, messageRecord) {
  if (isPaymentReportMessage(messageRecord)) {
    const paymentUrls = messageRecord?.paymentReportConfig
      ? buildPaymentReportUrls(messageRecord.paymentReportConfig)
      : {
          exportUrl: messageRecord?.exportUrl || "",
          pdfUrl: messageRecord?.pdfUrl || ""
        };
    if (type === "xlsx" && paymentUrls.exportUrl) {
      const excelFile = await buildPaymentReportExcelExport(paymentUrls.exportUrl);
      await sendTelegramDocumentFile(chatId, excelFile, {
        caption: "קובץ אקסל של דוח התרומות מוכן."
      });
      return;
    }
    if (type === "pdf" && paymentUrls.pdfUrl) {
      const pdfFile = await buildPaymentReportPdfExport(paymentUrls.pdfUrl);
      await sendTelegramDocumentFile(chatId, pdfFile, {
        caption: "קובץ PDF של דוח התרומות מוכן."
      });
    }
    return;
  }

  const columns = withRequiredColumns(messageRecord?.exportColumns || []);
  const sortLevels = normalizeSortLevels(messageRecord?.sortLevels || [{ sortBy: "class", sortDir: "asc" }]);
  if (type === "xlsx" && messageRecord?.exportUrl) {
    const csvFile = await buildInstitutionCsvExport(buildExportUrlWithOptions(messageRecord.exportUrl, { columns, sortLevels }));
    await sendTelegramDocumentFile(chatId, csvFile, {
      caption: `קובץ אקסל מוכן. מיון: ${(REPORT_SORT_OPTIONS.find((option) => option.key === sortLevels[0]?.sortBy)?.label) || "שיעור"}. עמודות: ${columns.map((column) => INSTITUTION_COLUMN_MAP[column]?.label || column).join(", ")}`
    });
    return;
  }
  if (type === "pdf" && messageRecord?.pdfUrl) {
    const pdfFile = await buildInstitutionPdfExport(buildExportUrlWithOptions(messageRecord.pdfUrl, { columns, sortLevels }));
    await sendTelegramDocumentFile(chatId, pdfFile, {
      caption: `קובץ PDF מוכן. מיון: ${(REPORT_SORT_OPTIONS.find((option) => option.key === sortLevels[0]?.sortBy)?.label) || "שיעור"}. עמודות: ${columns.map((column) => INSTITUTION_COLUMN_MAP[column]?.label || column).join(", ")}`
    });
  }
}

export async function POST(request) {
  let fallbackChatId = "";
  try {
    const secret = getTelegramWebhookSecret();
    if (secret) {
      const header = clean(request.headers.get("x-telegram-bot-api-secret-token"));
      if (header !== secret) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const update = await request.json().catch(() => null);
    if (!update || typeof update !== "object") {
      return NextResponse.json({ ok: true });
    }
    fallbackChatId = clean(extractChat(update)?.id);

    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = clean(callback?.message?.chat?.id);
      const link = await getTelegramLinkByChatId(chatId);
      if (!link?.clerk_user_id) {
        await answerTelegramCallbackQuery(callback.id, "החשבון לא מחובר.");
        return NextResponse.json({ ok: true });
      }
      const user = await getAppUserByClerkUserId(link.clerk_user_id);
      if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin && !user.is_print_only && !user.is_marei_mekomot)) {
        await answerTelegramCallbackQuery(callback.id, "אין הרשאה לפעולה.");
        return NextResponse.json({ ok: true });
      }
      const parts = clean(callback.data).split(":");
      const action = parts[0];
      const messageId = parts[1];

      if (action === "noop") {
        await answerTelegramCallbackQuery(callback.id, "שם תלמיד נשאר תמיד.");
        return NextResponse.json({ ok: true });
      }

      if (action === "docprintstart") {
        const workflowMessageId = parts[1];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, workflowMessageId);
        if (clean(messageRecord?.pendingAction?.type) !== "document_workflow") {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        await answerTelegramCallbackQuery(callback.id, "בחר תוכנית הדפסה.");
        await sendTelegramMessage(chatId, "ברירת המחדל היא שחור לבן. בחר תוכנית:", {
          replyMarkup: buildTelegramDocumentPrintPlansKeyboard({
            messageId: messageRecord.id,
            canUseColor: canUseColorPrint(user)
          })
        });
        return NextResponse.json({ ok: true });
      }

      if (action === "doccolormenu") {
        const workflowMessageId = parts[1];
        if (!canUseColorPrint(user)) {
          await answerTelegramCallbackQuery(callback.id, "הדפסה בצבע זמינה רק למשתמשים מורשים.");
          return NextResponse.json({ ok: true });
        }
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, workflowMessageId);
        if (clean(messageRecord?.pendingAction?.type) !== "document_workflow") {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        await answerTelegramCallbackQuery(callback.id, "בחר תוכנית צבע.");
        await sendTelegramMessage(chatId, "בחר תוכנית הדפסה בצבע:", {
          replyMarkup: buildTelegramDocumentPrintPlansKeyboard({
            messageId: messageRecord.id,
            canUseColor: true,
            colorOnly: true
          })
        });
        return NextResponse.json({ ok: true });
      }

      if (action === "docprint") {
        const printPlan = clean(parts[1]);
        const copies = clean(parts[2]);
        const workflowMessageId = parts[3];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, workflowMessageId);
        if (clean(messageRecord?.pendingAction?.type) !== "document_workflow") {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        if (!canAccessPrintFeature(user)) {
          await answerTelegramCallbackQuery(callback.id, "אין הרשאה להדפסה.");
          await sendTelegramMessage(chatId, "אין לחשבון הזה הרשאה לשליחה להדפסה.");
          return NextResponse.json({ ok: true });
        }
        const job = await createPrintJobFromStoredDocument({
          storedDocument: messageRecord.pendingAction.storedDocument,
          user,
          printPlan,
          copies
        });
        await answerTelegramCallbackQuery(callback.id, "נשלח לתור ההדפסה.");
        await sendTelegramMessage(chatId, [
          "המסמך נשלח לתור ההדפסה.",
          `מספר עבודה: ${job.id}`,
          `סוג הדפסה: ${job.printPlanLabel}`,
          `עותקים: ${job.copies}`
        ].join("\n"));
        return NextResponse.json({ ok: true });
      }

      if (action === "docplan") {
        const printPlan = clean(parts[1]);
        const workflowMessageId = parts[2];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, workflowMessageId);
        if (clean(messageRecord?.pendingAction?.type) !== "document_workflow") {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        if (!canAccessPrintFeature(user)) {
          await answerTelegramCallbackQuery(callback.id, "אין הרשאה להדפסה.");
          await sendTelegramMessage(chatId, "אין לחשבון הזה הרשאה לשליחה להדפסה.");
          return NextResponse.json({ ok: true });
        }
        const job = await createPrintJobFromStoredDocument({
          storedDocument: messageRecord.pendingAction.storedDocument,
          user,
          printPlan,
          copies: 1
        });
        if (printPlan === "convert-pdf") {
          await answerTelegramCallbackQuery(callback.id, "המרה ל-PDF נקלטה.");
          await sendTelegramMessage(chatId, [
            "המרה ל-PDF נקלטה בהצלחה.",
            "העבודה נשלחה למערכת ההמרה הנפרדת.",
            `מספר עבודה: ${job.id}`,
            `סוג עבודה: ${job.printPlanLabel}`,
            "בסיום ההמרה הקובץ המומר יישלח אליך במייל."
          ].join("\n"));
          return NextResponse.json({ ok: true });
        }
        await answerTelegramCallbackQuery(callback.id, "נשלח עותק אחד להדפסה.");
        await sendTelegramMessage(chatId, [
          "נשלח עותק אחד להדפסה.",
          `מספר עבודה: ${job.id}`,
          `סוג הדפסה: ${job.printPlanLabel}`,
          "",
          "כמה עוד תרצה להדפיס?"
        ].join("\n"), {
          replyMarkup: buildTelegramDocumentCopiesKeyboard({ messageId: messageRecord.id, printPlan })
        });
        return NextResponse.json({ ok: true });
      }

      if (action === "docdone") {
        const workflowMessageId = parts[1];
        await clearAiChatMessagePendingAction({
          clerkUserId: user.clerk_user_id,
          messageId: workflowMessageId
        }).catch(() => null);
        await answerTelegramCallbackQuery(callback.id, "סיימתי.");
        await sendTelegramMessage(chatId, "סיימתי. לא אשלח עוד עותקים למסמך הזה.");
        return NextResponse.json({ ok: true });
      }

      if (action === "doccopies") {
        const printPlan = clean(parts[1]);
        const copies = clean(parts[2]);
        const workflowMessageId = parts[3];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, workflowMessageId);
        if (clean(messageRecord?.pendingAction?.type) !== "document_workflow") {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי מסמך שממתין להדפסה.");
          return NextResponse.json({ ok: true });
        }
        if (!canAccessPrintFeature(user)) {
          await answerTelegramCallbackQuery(callback.id, "אין הרשאה להדפסה.");
          await sendTelegramMessage(chatId, "אין לחשבון הזה הרשאה לשליחה להדפסה.");
          return NextResponse.json({ ok: true });
        }
        const job = await createPrintJobFromStoredDocument({
          storedDocument: messageRecord.pendingAction.storedDocument,
          user,
          printPlan,
          copies
        });
        await answerTelegramCallbackQuery(callback.id, "נשלח לתור ההדפסה.");
        await sendTelegramMessage(chatId, [
          `נשלחו עוד ${job.copies} עותקים לתור ההדפסה.`,
          `מספר עבודה: ${job.id}`,
          `סוג הדפסה: ${job.printPlanLabel}`,
          `עותקים: ${job.copies}`,
          "",
          "כמה עוד תרצה להדפיס?"
        ].join("\n"), {
          replyMarkup: buildTelegramDocumentCopiesKeyboard({ messageId: messageRecord.id, printPlan })
        });
        return NextResponse.json({ ok: true });
      }

      if (action === "docstudent") {
        if (!canLinkDocumentsToStudents(user)) {
          await answerTelegramCallbackQuery(callback.id, "שיוך מסמך לתלמיד זמין רק לסופר אדמין.");
          await sendTelegramMessage(chatId, "שיוך מסמך לתלמיד זמין רק לסופר אדמין.");
          return NextResponse.json({ ok: true });
        }
        const workflowMessageId = parts[1];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, workflowMessageId);
        if (clean(messageRecord?.pendingAction?.type) !== "document_workflow") {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי מסמך שממתין לשיוך.");
          return NextResponse.json({ ok: true });
        }
        await answerTelegramCallbackQuery(callback.id, "מתחיל שיוך לתלמיד.");
        await sendTelegramMessage(chatId, "מתחיל ניתוח וחיפוש תלמיד לשיוך המסמך.");
        const result = await processStoredDocumentForStudentLink({
          user,
          storedDocument: messageRecord.pendingAction.storedDocument,
          messageText: "שיוך מסמך לתלמיד",
          source: "telegram"
        });
        const cardsText = buildTelegramStudentCardsText(result.studentCards);
        const replyText = [result.reply, cardsText, result.searchSummary ? `\nאיך חיפשתי: ${result.searchSummary}` : ""].filter(Boolean).join("\n\n");
        await sendTelegramMessageWithFallback(chatId, replyText, {
          replyMarkup: buildTelegramKeyboard({
            messageId: result.id,
            pendingAction: result.pendingAction,
            studentCards: result.studentCards,
            viewUrl: result.viewUrl || "",
            exportUrl: result.exportUrl || "",
            pdfUrl: result.pdfUrl || "",
            actionLinks: result.actionLinks || [],
            exportColumns: result.exportColumns || [],
            sortLevels: result.sortLevels || [],
            canLinkStudentDocuments: canLinkDocumentsToStudents(user),
            canUseColor: canUseColorPrint(user)
          })
        });
        return NextResponse.json({ ok: true });
      }

      if (action === "feedback") {
        const feedback = parts[1];
        const feedbackMessageId = parts[2];
        const feedbackMessageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, feedbackMessageId);
        if (!feedbackMessageRecord?.id) {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי את ההודעה לעדכון.");
          return NextResponse.json({ ok: true });
        }
        await setAiChatMessageFeedback({
          messageId: feedbackMessageRecord.id,
          clerkUserId: user.clerk_user_id,
          feedback
        });
        const currentReplyMarkup = isPaymentReportMessage(feedbackMessageRecord)
          ? await buildTelegramPaymentKeyboard({
            messageId: feedbackMessageRecord.id,
            messageRecord: feedbackMessageRecord,
            hasMore: false
          })
          : buildTelegramKeyboard({
            messageId: feedbackMessageRecord.id,
            pendingAction: feedbackMessageRecord?.pendingAction || null,
            studentCards: feedbackMessageRecord?.studentCards || [],
            viewUrl: feedbackMessageRecord?.viewUrl || "",
            exportUrl: feedbackMessageRecord?.exportUrl || "",
            pdfUrl: feedbackMessageRecord?.pdfUrl || "",
            exportColumns: feedbackMessageRecord?.exportColumns || [],
            sortLevels: feedbackMessageRecord?.sortLevels || [],
            includeFeedback: false
          });
        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: currentReplyMarkup
          }).catch(() => null);
        }
        await answerTelegramCallbackQuery(callback.id, feedback === "good" ? "תודה, שמרתי שהתגובה היתה טובה." : "תודה, שמרתי שהתגובה לא היתה מדויקת.");
        return NextResponse.json({ ok: true });
      }

      if (action === "pickstudent") {
        const targetMessageId = parts[1];
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: targetMessageId
        });
        const cards = Array.isArray(messageRecord?.studentCards) ? messageRecord.studentCards : [];
        if (cards.length < 2) {
          await answerTelegramCallbackQuery(callback.id, "אין כמה תלמידים לבחור מהם.");
          return NextResponse.json({ ok: true });
        }
        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramStudentPickerKeyboard({
              messageId: targetMessageId,
              studentCards: cards
            })
          }).catch(() => null);
        }
        await answerTelegramCallbackQuery(callback.id, "בחר תלמיד להמשך עדכון.");
        return NextResponse.json({ ok: true });
      }

      if (action === "back") {
        const targetMessageId = parts[1];
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: targetMessageId
        });
        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramKeyboard({
              messageId: targetMessageId,
              pendingAction: messageRecord?.pendingAction || null,
              studentCards: messageRecord?.studentCards || [],
              viewUrl: messageRecord?.viewUrl || "",
              exportUrl: messageRecord?.exportUrl || "",
              pdfUrl: messageRecord?.pdfUrl || "",
              actionLinks: messageRecord?.actionLinks || [],
              exportColumns: messageRecord?.exportColumns || [],
              sortLevels: messageRecord?.sortLevels || [],
              includeFeedback: !messageRecord?.feedback
            })
          }).catch(() => null);
        }
        await answerTelegramCallbackQuery(callback.id, "חזרתי לפעולות של התוצאה.");
        return NextResponse.json({ ok: true });
      }

      if (action === "pick") {
        const targetMessageId = parts[1];
        const selectedIndex = Number(parts[2]);
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: targetMessageId
        });
        const cards = Array.isArray(messageRecord?.studentCards) ? messageRecord.studentCards : [];
        const selectedStudent = Number.isFinite(selectedIndex) ? cards[selectedIndex] : null;
        if (!selectedStudent?.id) {
          await answerTelegramCallbackQuery(callback.id, "לא הצלחתי לזהות את התלמיד שנבחר.");
          return NextResponse.json({ ok: true });
        }

        const reply = [
          `נבחר תלמיד לעדכון: ${clean(selectedStudent.name) || "תלמיד"}.`,
          "אפשר עכשיו לכתוב מה לעדכן, למשל:",
          "תעדכן כתובת בצלאל 35 ירושלים",
          "תעדכן טלפון תלמיד 050...",
          "תעדכן רישום דתות"
        ].join("\n");
        const savedMessage = await createAiChatMessage({
          clerkUserId: user.clerk_user_id,
          role: "assistant",
          content: reply,
          metadata: {
            studentCards: [selectedStudent],
            exportUrl: "",
            pdfUrl: "",
            viewUrl: "",
            source: "telegram",
            searchSummary: `נבחר תלמיד להמשך עדכון מתוך תוצאות חיפוש: ${clean(selectedStudent.name) || "תלמיד"}`
          }
        });

        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramKeyboard({
              messageId: targetMessageId,
              pendingAction: messageRecord?.pendingAction || null,
              studentCards: messageRecord?.studentCards || [],
              viewUrl: messageRecord?.viewUrl || "",
              exportUrl: messageRecord?.exportUrl || "",
              pdfUrl: messageRecord?.pdfUrl || "",
              actionLinks: messageRecord?.actionLinks || [],
              exportColumns: messageRecord?.exportColumns || [],
              sortLevels: messageRecord?.sortLevels || [],
              includeFeedback: !messageRecord?.feedback
            })
          }).catch(() => null);
        }

        await answerTelegramCallbackQuery(callback.id, `נבחר ${clean(selectedStudent.name) || "התלמיד"} לעדכון.`);
        await sendTelegramMessage(chatId, reply, {
          replyMarkup: buildTelegramKeyboard({
            messageId: savedMessage?.id || targetMessageId,
            studentCards: [selectedStudent],
            includeFeedback: false
          })
        });
        return NextResponse.json({ ok: true });
      }

      if (action === "xlsx" || action === "pdf") {
        const exportMessageId = parts[1];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, exportMessageId);
        if (!messageRecord || (action === "xlsx" && !messageRecord.exportUrl) || (action === "pdf" && !messageRecord.pdfUrl)) {
          await answerTelegramCallbackQuery(callback.id, "אין קובץ זמין לתשובה הזו.");
          return NextResponse.json({ ok: true });
        }

        await answerTelegramCallbackQuery(callback.id, action === "xlsx" ? "מכין אקסל" : "מכין PDF");
        await sendInstitutionAttachment(chatId, action, messageRecord);
        return NextResponse.json({ ok: true });
      }

      if (action === "paysort") {
        const sortBy = clean(parts[1]) === "amount" ? "amount" : "date";
        const exportMessageId = parts[2];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, exportMessageId);
        if (!isPaymentReportMessage(messageRecord)) {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי דוח תשלומים.");
          return NextResponse.json({ ok: true });
        }
        await answerTelegramCallbackQuery(callback.id, sortBy === "amount" ? "מעדכן למיון לפי סכום" : "מעדכן למיון לפי תאריך");
        try {
          await refreshTelegramPaymentReport({
            chatId,
            user,
            messageRecord,
            updateConfig: { sortBy, sortDir: "desc" }
          });
        } catch (error) {
          await sendTelegramMessage(chatId, error?.message || "עדכון הדוח נכשל.");
        }
        return NextResponse.json({ ok: true });
      }

      if (action === "paysource") {
        const target = clean(parts[1]);
        const exportMessageId = parts[2];
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, exportMessageId);
        if (!isPaymentReportMessage(messageRecord)) {
          await answerTelegramCallbackQuery(callback.id, "לא מצאתי דוח תשלומים.");
          return NextResponse.json({ ok: true });
        }
        const { listPaymentConnections } = await import("../../../../lib/payment-systems");
        const activeConnections = await listPaymentConnections({ activeOnly: true });
        const allIds = activeConnections.map((connection) => connection.id);
        const resolvedTarget = target === "all"
          ? "all"
          : activeConnections.find((connection) => toTelegramToken(connection.id, 10) === target)?.id;
        if (!resolvedTarget) {
          await answerTelegramCallbackQuery(callback.id, "מקור התשלום לא נמצא.");
          return NextResponse.json({ ok: true });
        }
        const currentIds = Array.isArray(messageRecord?.paymentReportConfig?.connectionIds)
          ? messageRecord.paymentReportConfig.connectionIds.map(clean).filter(Boolean)
          : allIds;
        const nextIds = resolvedTarget === "all"
          ? allIds
          : (currentIds.includes(resolvedTarget)
            ? currentIds.filter((id) => id !== resolvedTarget)
            : [...currentIds, resolvedTarget]);
        await answerTelegramCallbackQuery(callback.id, "מעדכן את מקורות התשלום");
        try {
          await refreshTelegramPaymentReport({
            chatId,
            user,
            messageRecord,
            updateConfig: { connectionIds: nextIds.length ? nextIds : allIds }
          });
        } catch (error) {
          await sendTelegramMessage(chatId, error?.message || "עדכון הדוח נכשל.");
        }
        return NextResponse.json({ ok: true });
      }

      if (action === "cols") {
        const exportMessageId = parts[1];
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: exportMessageId
        });
        if (isPaymentReportMessage(messageRecord)) {
          await answerTelegramCallbackQuery(callback.id, "בדוח תרומות אין בחירת עמודות.");
          return NextResponse.json({ ok: true });
        }
        if (!messageRecord?.exportUrl) {
          await answerTelegramCallbackQuery(callback.id, "אין עמודות לבחירה בתשובה הזו.");
          return NextResponse.json({ ok: true });
        }
        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramColumnsKeyboard({
              messageId: exportMessageId,
              exportColumns: messageRecord.exportColumns || [],
              sortLevels: messageRecord.sortLevels || [],
              viewUrl: messageRecord.viewUrl || "",
              includeFeedback: !messageRecord.feedback
            })
          }).catch(() => null);
        }
        await answerTelegramCallbackQuery(callback.id, "אפשר לבחור אילו עמודות ייכללו בקובץ.");
        return NextResponse.json({ ok: true });
      }

      if (action === "col") {
        const optionIndex = Number(parts[1]);
        const exportMessageId = parts[2];
        const columnKey = TELEGRAM_EXPORT_COLUMN_OPTIONS[optionIndex];
        if (!columnKey) {
          await answerTelegramCallbackQuery(callback.id, "השדה לא זמין.");
          return NextResponse.json({ ok: true });
        }

        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: exportMessageId
        });
        if (isPaymentReportMessage(messageRecord)) {
          await answerTelegramCallbackQuery(callback.id, "בדוח תרומות אין התאמת עמודות.");
          return NextResponse.json({ ok: true });
        }
        if (!messageRecord?.exportUrl) {
          await answerTelegramCallbackQuery(callback.id, "אין עמודות לבחירה בתשובה הזו.");
          return NextResponse.json({ ok: true });
        }

        const selected = new Set(withRequiredColumns(messageRecord.exportColumns || []));
        if (selected.has(columnKey)) {
          selected.delete(columnKey);
        } else {
          selected.add(columnKey);
        }
        const nextColumns = withRequiredColumns(Array.from(selected));
        await setAiChatMessageExportColumns({
          messageId: exportMessageId,
          clerkUserId: user.clerk_user_id,
          exportColumns: nextColumns
        });

        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramColumnsKeyboard({
              messageId: exportMessageId,
              exportColumns: nextColumns,
              sortLevels: messageRecord.sortLevels || [],
              viewUrl: messageRecord.viewUrl || "",
              includeFeedback: !messageRecord.feedback
            })
          }).catch(() => null);
        }

        await answerTelegramCallbackQuery(callback.id, `${INSTITUTION_COLUMN_MAP[columnKey]?.label || columnKey} ${selected.has(columnKey) ? "נוסף" : "הוסר"}.`);
        return NextResponse.json({ ok: true });
      }

      if (action === "preset") {
        const presetKey = clean(parts[1]);
        const exportMessageId = parts[2];
        const presetColumns = REPORT_COLUMN_PRESETS[presetKey];
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: exportMessageId
        });
        if (isPaymentReportMessage(messageRecord)) {
          await answerTelegramCallbackQuery(callback.id, "בדוח תרומות אין פריסטי עמודות של תלמידים.");
          return NextResponse.json({ ok: true });
        }
        if (!messageRecord?.exportUrl || !presetColumns) {
          await answerTelegramCallbackQuery(callback.id, "הפריסט לא זמין.");
          return NextResponse.json({ ok: true });
        }
        const nextColumns = withRequiredColumns(presetColumns);
        await setAiChatMessageExportColumns({
          messageId: exportMessageId,
          clerkUserId: user.clerk_user_id,
          exportColumns: nextColumns
        });
        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramColumnsKeyboard({
              messageId: exportMessageId,
              exportColumns: nextColumns,
              sortLevels: messageRecord.sortLevels || [],
              viewUrl: messageRecord.viewUrl || "",
              includeFeedback: !messageRecord.feedback
            })
          }).catch(() => null);
        }
        await answerTelegramCallbackQuery(callback.id, `נבחר פריסט ${(presetKey === "contact" ? "אנשי קשר" : presetKey === "address" ? "כתובת" : "ברירת מחדל")}.`);
        return NextResponse.json({ ok: true });
      }

      if (action === "sort") {
        const sortBy = clean(parts[1]) === "class" ? "class" : "name";
        const exportMessageId = parts[2];
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: exportMessageId
        });
        if (isPaymentReportMessage(messageRecord)) {
          await answerTelegramCallbackQuery(callback.id, "בדוח תרומות אין מיון תלמידים מתוך Telegram.");
          return NextResponse.json({ ok: true });
        }
        if (!messageRecord?.exportUrl && !messageRecord?.pdfUrl) {
          await answerTelegramCallbackQuery(callback.id, "אין דוח זמין למיון.");
          return NextResponse.json({ ok: true });
        }
        const nextSortLevels = [{ sortBy, sortDir: "asc" }];
        await setAiChatMessageReportConfig({
          messageId: exportMessageId,
          clerkUserId: user.clerk_user_id,
          sortLevels: nextSortLevels
        });
        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramKeyboard({
              messageId: exportMessageId,
              pendingAction: messageRecord?.pendingAction || null,
              studentCards: messageRecord?.studentCards || [],
              viewUrl: messageRecord?.viewUrl || "",
              exportUrl: messageRecord?.exportUrl || "",
              pdfUrl: messageRecord?.pdfUrl || "",
              actionLinks: messageRecord?.actionLinks || [],
              exportColumns: messageRecord?.exportColumns || [],
              sortLevels: nextSortLevels,
              includeFeedback: !messageRecord?.feedback
            })
          }).catch(() => null);
        }
        await answerTelegramCallbackQuery(callback.id, `המיון עודכן ל-${sortBy === "class" ? "שיעור" : "שם משפחה"}.`);
        return NextResponse.json({ ok: true });
      }

      if (action === "done") {
        const exportMessageId = parts[1];
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId: exportMessageId
        });
        if (callback?.message?.message_id) {
          await editTelegramMessageReplyMarkup({
            chatId,
            messageId: callback.message.message_id,
            replyMarkup: buildTelegramKeyboard({
              messageId: exportMessageId,
              pendingAction: messageRecord?.pendingAction || null,
              studentCards: messageRecord?.studentCards || [],
              viewUrl: messageRecord?.viewUrl || "",
              exportUrl: messageRecord?.exportUrl || "",
              pdfUrl: messageRecord?.pdfUrl || "",
              actionLinks: messageRecord?.actionLinks || [],
              exportColumns: messageRecord?.exportColumns || [],
              sortLevels: messageRecord?.sortLevels || [],
              includeFeedback: !messageRecord?.feedback
            })
          }).catch(() => null);
        }
        await answerTelegramCallbackQuery(callback.id, "בחירת העמודות נשמרה.");
        return NextResponse.json({ ok: true });
      }

      if (action === "more") {
        const messageRecord = await resolveTelegramMessageRecord(user.clerk_user_id, messageId);
        if (!messageRecord?.content) {
          await answerTelegramCallbackQuery(callback.id, "לא הצלחתי לטעון את ההמשך.");
          return NextResponse.json({ ok: true });
        }

        const fullChunks = splitFullTelegramMessage(messageRecord.content);
        await answerTelegramCallbackQuery(callback.id, "מציג עוד");
        for (let index = 0; index < fullChunks.length; index += 1) {
          const finalReplyMarkup = isPaymentReportMessage(messageRecord)
            ? await buildTelegramPaymentKeyboard({ messageId: messageRecord.id, messageRecord })
            : buildTelegramKeyboard({
              messageId,
              studentCards: messageRecord.studentCards,
              viewUrl: messageRecord.viewUrl || "",
              exportUrl: messageRecord.exportUrl || "",
              pdfUrl: messageRecord.pdfUrl || "",
              actionLinks: messageRecord.actionLinks || [],
              exportColumns: messageRecord.exportColumns || [],
              includeFeedback: false
            });
          await sendTelegramMessageWithFallback(chatId, fullChunks[index], {
            replyMarkup: index === fullChunks.length - 1 ? finalReplyMarkup : undefined
          });
        }
        return NextResponse.json({ ok: true });
      }

      const pendingAction = await getPendingActionForMessage({
        clerkUserId: user.clerk_user_id,
        messageId
      });
      if (!pendingAction) {
        await answerTelegramCallbackQuery(callback.id, "לא נמצאה פעולה ממתינה.");
        return NextResponse.json({ ok: true });
      }

      const normalizedDecision = action === "attachonly" ? "attach_only" : action;
      const result = await handleApprovedAiAction({ user, decision: normalizedDecision, pendingAction, messageId });
      if (callback?.message?.message_id) {
        await editTelegramMessageReplyMarkup({
          chatId,
          messageId: callback.message.message_id,
          replyMarkup: buildTelegramKeyboard({
            messageId,
            pendingAction: null,
            studentCards: [],
            includeFeedback: false
          })
        }).catch(() => null);
      }
      await answerTelegramCallbackQuery(callback.id, normalizedDecision === "attach_only" ? "הצילום שויך ללא שינוי שדות" : normalizedDecision === "approve" ? "הפעולה אושרה" : "הפעולה נדחתה");
      const approvalReplyMarkup = isPaymentReportMessage(result)
        ? await buildTelegramPaymentKeyboard({ messageId, messageRecord: { ...result, id: messageId } })
        : buildTelegramKeyboard({
          messageId,
          studentCards: result.studentCards,
          viewUrl: result.viewUrl || "",
          exportUrl: result.exportUrl || "",
          pdfUrl: result.pdfUrl || "",
          exportColumns: result.exportColumns || [],
          sortLevels: result.sortLevels || [],
          includeFeedback: false
        });
      await sendTelegramMessageWithFallback(chatId, result.reply, {
        replyMarkup: approvalReplyMarkup
      });
      return NextResponse.json({ ok: true });
    }

    const message = update.message;
    const chat = extractChat(update);
    const chatId = clean(chat?.id);
    const text = clean(message?.text || message?.caption);
    const attachmentMeta = resolveTelegramAttachment(message);
    if (!chatId || (!text && !attachmentMeta)) {
      return NextResponse.json({ ok: true });
    }

    const startMatch = text.match(/^\/start(?:\s+(.+))?$/i);
    if (startMatch?.[1]) {
      try {
        const linkResult = await consumeTelegramLinkCode({
          code: startMatch[1],
          telegramChatId: chatId,
          telegramUserId: clean(message?.from?.id),
          telegramUsername: clean(message?.from?.username)
        });
        const user = await getAppUserByClerkUserId(linkResult.clerkUserId);
        await sendTelegramMessage(chatId, `החיבור הושלם בהצלחה. מעכשיו אני מזהה אותך כ-${user?.display_name || "משתמש מורשה"}.`);
      } catch (error) {
        await sendTelegramMessage(chatId, error?.message || "חיבור Telegram נכשל.");
      }
      return NextResponse.json({ ok: true });
    }

    const link = await getTelegramLinkByChatId(chatId);
    if (!link?.clerk_user_id) {
      await sendNotLinkedMessage(chatId);
      return NextResponse.json({ ok: true });
    }

    const user = await getAppUserByClerkUserId(link.clerk_user_id);
    if (!user || (!user.is_team_member && !user.is_manager)) {
      await sendTelegramMessage(chatId, "החשבון הזה אינו מורשה להשתמש בסוכן.");
      return NextResponse.json({ ok: true });
    }
    if (!user.agent_telegram_enabled) {
      await sendTelegramMessage(chatId, "הגישה שלך לסוכן דרך Telegram כבויה כרגע. פנה למנהל המערכת.");
      return NextResponse.json({ ok: true });
    }

    let result;
    if (attachmentMeta) {
      await sendTelegramMessage(
        chatId,
        "קיבלתי את המסמך. אני מעבד אותו עכשיו ואחזיר לך אפשרויות להמשך."
      ).catch(() => null);
      try {
        result = await processDocumentWorkflowAttachment({
          user,
          attachment: await downloadTelegramFileAsAttachment(attachmentMeta.fileId, {
            fileName: attachmentMeta.fileName,
            contentType: attachmentMeta.contentType
          }),
          messageText: text,
          source: "telegram"
        });
      } catch (error) {
        console.error("Telegram document processing failed:", error?.message || error);
        await sendTelegramMessage(
          chatId,
          `המסמך התקבל, אבל העיבוד נכשל: ${clean(error?.message) || "שגיאה לא ידועה"}. נסה לשלוח שוב או לפתוח את מסך ההדפסה במערכת.`
        ).catch(() => null);
        return NextResponse.json({ ok: true });
      }
    } else {
      result = await processTextAiMessage({
        user,
        messageText: text,
        source: "telegram"
      });
    }

    const cardsText = buildTelegramStudentCardsText(result.studentCards);
    const baseReply = [result.reply, cardsText].filter(Boolean).join("\n\n");
    const collapsedReply = isPaymentReportMessage(result)
      ? { text: baseReply, hasMore: false }
      : splitMessageForTelegram(baseReply, 8);
    const replyText = [collapsedReply.text, result.searchSummary ? `\nאיך חיפשתי: ${result.searchSummary}` : ""].filter(Boolean).join("\n");
    const replyMarkup = isPaymentReportMessage(result)
      ? await buildTelegramPaymentKeyboard({ messageId: result.id, messageRecord: result, hasMore: collapsedReply.hasMore })
      : buildTelegramKeyboard({
        messageId: result.id,
        pendingAction: result.pendingAction,
        studentCards: result.studentCards,
        viewUrl: result.viewUrl || "",
        exportUrl: result.exportUrl || "",
        pdfUrl: result.pdfUrl || "",
        actionLinks: result.actionLinks || [],
        exportColumns: result.exportColumns || [],
        sortLevels: result.sortLevels || [],
        hasMore: collapsedReply.hasMore,
        canLinkStudentDocuments: canLinkDocumentsToStudents(user),
        canUseColor: canUseColorPrint(user)
      });
    await sendTelegramMessageWithFallback(chatId, replyText, { replyMarkup });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failed:", error?.message || error);
    if (fallbackChatId) {
      await sendTelegramMessage(
        fallbackChatId,
        `אירעה שגיאה בטיפול בהודעה: ${clean(error?.message) || "שגיאה לא ידועה"}. נסה שוב בעוד רגע.`
      ).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }
}
