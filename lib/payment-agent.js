import { buildPaymentExportSearchParams } from "./payment-report";
import { getDefaultPaymentDateRange, listPaymentConnections } from "./payment-systems";

function clean(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return clean(value)
    .normalize("NFKC")
    .replace(/["'`׳״.,:;!?()[\]{}<>/_\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const HEBREW_MONTHS = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  מרס: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12
};

function toIsoDate(day, month, year) {
  const fullYear = String(year).length === 2 ? `20${year}` : String(year);
  const iso = `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? "" : iso;
}

function buildMonthRange(year, month) {
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  if (!Number.isFinite(monthNumber) || !Number.isFinite(yearNumber)) return null;
  const start = new Date(Date.UTC(yearNumber, monthNumber - 1, 1, 12, 0, 0));
  const end = new Date(Date.UTC(yearNumber, monthNumber, 0, 12, 0, 0));
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10)
  };
}

function extractDateRangeFromText(text) {
  const raw = clean(text);
  const normalized = normalizeText(text);
  const defaults = getDefaultPaymentDateRange();
  if (!raw) return defaults;

  const isoMatches = [...raw.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)]
    .map((match) => toIsoDate(match[3], match[2], match[1]))
    .filter(Boolean);
  const dotMatches = [...raw.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/g)]
    .map((match) => toIsoDate(match[1], match[2], match[3]))
    .filter(Boolean);
  const slashMatches = [...raw.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)]
    .map((match) => toIsoDate(match[1], match[2], match[3]))
    .filter(Boolean);

  const matches = [...isoMatches, ...dotMatches, ...slashMatches];
  if (matches.length >= 2) {
    const sorted = [...matches].sort();
    return {
      dateFrom: sorted[0],
      dateTo: sorted[sorted.length - 1]
    };
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  const monthMatch = normalized.match(/(?:בחודש|לחודש|חודש)\s+(ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)(?:\s+האחרון|\s+אחרון)?/);
  if (monthMatch) {
    const monthNumber = HEBREW_MONTHS[monthMatch[1]];
    let year = today.getUTCFullYear();
    if (monthNumber > today.getUTCMonth() + 1) {
      year -= 1;
    }
    return buildMonthRange(year, monthNumber) || defaults;
  }

  if (raw.includes("היום")) {
    const value = todayIso;
    return { dateFrom: value, dateTo: value };
  }
  if (normalized.includes("החודש האחרון") || normalized.includes("בחודש האחרון")) {
    const previousMonthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1, 12, 0, 0));
    return buildMonthRange(previousMonthDate.getUTCFullYear(), previousMonthDate.getUTCMonth() + 1) || defaults;
  }
  if (raw.includes("החודש")) {
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12, 0, 0));
    return {
      dateFrom: monthStart.toISOString().slice(0, 10),
      dateTo: todayIso
    };
  }
  if (normalized.includes("השבוע האחרון") || normalized.includes("בשבוע האחרון")) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6, 12, 0, 0));
    return {
      dateFrom: start.toISOString().slice(0, 10),
      dateTo: todayIso
    };
  }

  return defaults;
}

function isPaymentReportIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const hasPaymentNoun = [
    "תרומה",
    "תרומות",
    "עסקה",
    "עסקאות",
    "תשלום",
    "תשלומים"
  ].some((pattern) => normalized.includes(pattern));
  const hasReportVerb = [
    "דוח",
    "הפק",
    "תפיק",
    "תוציא",
    "יצוא",
    "ייצא",
    "אקסל",
    "pdf",
    "הצג",
    "איזה",
    "אילו",
    "בוצעו",
    "היו"
  ].some((pattern) => normalized.includes(pattern));
  const hasDateHint = [
    "בין",
    "היום",
    "החודש",
    "האחרון",
    "השבוע",
    ...Object.keys(HEBREW_MONTHS)
  ].some((pattern) => normalized.includes(pattern));

  return hasPaymentNoun && (hasReportVerb || hasDateHint);
}

function connectionMatchesText(connection, normalizedText) {
  const label = normalizeText(connection.label);
  const provider = normalizeText(connection.provider);
  if (label && normalizedText.includes(label)) return true;
  if (provider === "stripe" && (normalizedText.includes("stripe") || normalizedText.includes("סטרייפ"))) return true;
  if (provider === "nederim" && (normalizedText.includes("נדרים") || normalizedText.includes("נדרים פלוס"))) return true;
  return false;
}

function pickConnectionIdsFromText(text, connections) {
  const normalized = normalizeText(text);
  if (!normalized) return connections.map((connection) => connection.id);
  if (normalized.includes("כל המערכות") || normalized.includes("כל המקורות") || normalized.includes("כל החיבורים")) {
    return connections.map((connection) => connection.id);
  }

  const selected = connections
    .filter((connection) => connectionMatchesText(connection, normalized))
    .map((connection) => connection.id);

  return selected.length ? selected : connections.map((connection) => connection.id);
}

export async function maybeBuildPaymentReportAgentResult({ user, messageText, source = "web" }) {
  const raw = clean(messageText);
  if (!isPaymentReportIntent(raw)) return null;
  if (!user?.is_team_member && !user?.is_manager && !user?.is_super_admin) return null;

  const activeConnections = await listPaymentConnections({ activeOnly: true });
  if (!activeConnections.length) {
    return {
      reply: "אין כרגע חיבורי תשלום פעילים, לכן אי אפשר להפיק דוח תרומות. אפשר להגדיר חיבורים חדשים במסך ניהול מערכות תשלום.",
      exportUrl: "",
      pdfUrl: "",
      viewUrl: "",
      searchSummary: "זוהתה בקשת דוח תרומות, אבל לא נמצאו חיבורי תשלום פעילים",
      paymentReportConfig: null,
      pendingAction: null
    };
  }

  const { dateFrom, dateTo } = extractDateRangeFromText(raw);
  const connectionIds = pickConnectionIdsFromText(raw, activeConnections);
  const selectedConnections = activeConnections.filter((connection) => connectionIds.includes(connection.id));
  const query = buildPaymentExportSearchParams({
    dateFrom,
    dateTo,
    connectionIds
  });

  const labels = selectedConnections.map((connection) => connection.label);
  const scopeText = labels.length === activeConnections.length
    ? "כל המערכות"
    : labels.join(", ");

  return {
    reply: `הכנתי לך דוח תרומות לטווח ${dateFrom} עד ${dateTo} עבור ${scopeText}. אפשר לפתוח את הדוח במסך מלא, או להוריד ישר אקסל ו-PDF.`,
    exportUrl: `/api/payments/export/xlsx?${query}`,
    pdfUrl: `/api/payments/export/pdf?${query}`,
    viewUrl: `/payments?run=1&${query}`,
    searchSummary: `זוהתה בקשת דוח תרומות | טווח: ${dateFrom} עד ${dateTo} | מקורות: ${scopeText}`,
    paymentReportConfig: {
      dateFrom,
      dateTo,
      connectionIds
    },
    pendingAction: null,
    source
  };
}
