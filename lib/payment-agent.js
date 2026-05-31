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

function toIsoDate(day, month, year) {
  const fullYear = String(year).length === 2 ? `20${year}` : String(year);
  const iso = `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? "" : iso;
}

function extractDateRangeFromText(text) {
  const raw = clean(text);
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
  if (raw.includes("היום")) {
    const value = today.toISOString().slice(0, 10);
    return { dateFrom: value, dateTo: value };
  }
  if (raw.includes("החודש")) {
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12, 0, 0));
    return {
      dateFrom: monthStart.toISOString().slice(0, 10),
      dateTo: today.toISOString().slice(0, 10)
    };
  }

  return defaults;
}

function isPaymentReportIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return [
    "דוח תרומות",
    "דוח תרומה",
    "דוח עסקאות",
    "תרומות בין",
    "עסקאות בין",
    "תוציא דוח תרומות",
    "תפיק דוח תרומות",
    "הפק דוח תרומות",
    "הפק דוח עסקאות",
    "יצא דוח תרומות",
    "דוח תשלומים"
  ].some((pattern) => normalized.includes(pattern));
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
