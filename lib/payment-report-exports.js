import * as XLSX from "xlsx";
import { renderInstitutionPdf } from "./institution-pdf";
import { listPaymentConnections, getPaymentDashboard, getPaymentMandatesDashboard } from "./payment-systems";
import { filterAndSortPaymentTransactions, summarizePaymentTransactions } from "./payment-report";

function clean(value) {
  return String(value || "").trim();
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value) ? [clean(value)] : [];
}

function parseSearchParams(input) {
  const searchParams = input instanceof URLSearchParams
    ? input
    : new URL(String(input), "https://internal.local").searchParams;
  return {
    reportType: clean(searchParams.get("reportType")) || "transactions",
    dateFrom: clean(searchParams.get("dateFrom")),
    dateTo: clean(searchParams.get("dateTo")),
    providers: searchParams.getAll("provider").map(clean).filter(Boolean),
    connectionIds: searchParams.getAll("connectionId").map(clean).filter(Boolean),
    mandateStatus: clean(searchParams.get("mandateStatus")),
    sortBy: clean(searchParams.get("sortBy")) || "date",
    sortDir: clean(searchParams.get("sortDir")) || "desc"
  };
}

function sanitizeFilenamePart(value) {
  return clean(value)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildExportTimestamp() {
  const now = new Date();
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0")
  ].join("");
}

function buildFileName(config, extension) {
  const prefix = clean(config.reportType) === "mandates" ? "payment-mandates-report" : "payment-report";
  if (clean(config.reportType) === "mandates") {
    return `${prefix}-${buildExportTimestamp()}.${extension}`;
  }
  const from = sanitizeFilenamePart(config.dateFrom || "from");
  const to = sanitizeFilenamePart(config.dateTo || "to");
  return `${prefix}-${from}-to-${to}-${buildExportTimestamp()}.${extension}`;
}

function exportNumeric(value) {
  if (value == null || value === "") return "";
  return Number(value) || 0;
}

async function buildFilteredPaymentReport(input) {
  const config = parseSearchParams(input);
  const activeConnections = await listPaymentConnections({ activeOnly: true });
  const providerFilteredConnections = config.providers.length
    ? activeConnections.filter((connection) => config.providers.includes(connection.provider))
    : activeConnections;
  const connectionIds = config.connectionIds.length
    ? config.connectionIds
    : providerFilteredConnections.map((connection) => connection.id);
  const reportType = clean(config.reportType) === "mandates" ? "mandates" : "transactions";
  const dashboard = reportType === "mandates"
    ? await getPaymentMandatesDashboard({
        connectionIds
      })
    : await getPaymentDashboard({
        connectionIds,
        dateFrom: config.dateFrom,
        dateTo: config.dateTo
      });
  const items = filterAndSortPaymentTransactions(reportType === "mandates" ? dashboard.mandates : dashboard.transactions, {
    providers: config.providers,
    connectionIds,
    mandateStatus: config.mandateStatus,
    sortBy: config.sortBy,
    sortDir: config.sortDir
  });
  const summary = summarizePaymentTransactions(items);
  return { config: { ...config, reportType }, items, summary };
}

export async function buildPaymentReportExcelExport(input) {
  const { config, items } = await buildFilteredPaymentReport(input);
  if (config.reportType === "mandates") {
    const header = [
      "נוצר בתאריך",
      "חיוב הבא",
      "מקור",
      "ספק",
      "שם",
      "מייל",
      "טלפון",
      "תעודת זהות",
      "עיר",
      "כתובת",
      "סטטוס",
      "הו\"ק / מנוי",
      "תדירות",
      "4 ספרות",
      "תוקף",
      "מטבע מקורי",
      "סכום מקורי",
      "שווי בשח",
      "קבוצה",
      "הערות",
      "שגיאה אחרונה"
    ];
    const rows = items.map((item) => ([
      clean(item.createdAt),
      clean(item.nextChargeDate),
      clean(item.connectionLabel),
      clean(item.providerLabel),
      clean(item.customerName),
      clean(item.email),
      clean(item.phone),
      clean(item.donorId),
      clean(item.city),
      clean(item.address),
      clean(item.statusLabel || item.status),
      clean(item.mandateId),
      clean(item.recurringCode),
      clean(item.paymentMethodLast4),
      clean(item.paymentMethodExpiry),
      clean(item.originalCurrency || item.currency || "ILS"),
      exportNumeric(item.originalAmount ?? item.amount),
      exportNumeric(item.amountIls ?? item.amount),
      clean(item.group),
      clean(item.comments),
      clean(item.errorText)
    ]));
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Active Mandates");
    const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return {
      content,
      filename: buildFileName(config, "xlsx"),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    };
  }
  const header = [
    "תאריך",
    "מקור",
    "ספק",
    "שם",
    "מייל",
    "טלפון",
    "סוג",
    "סטטוס",
    "אסמכתא",
    "קבלה",
    "עסקה",
    "הוק",
    "ספק סולק",
    "מותג",
    "תיאור",
    "מטבע מקורי",
    "ברוטו מקורי",
    "נטו מקורי",
    "עמלה מקורית",
    "שער לשח",
    "תאריך שער",
    "ברוטו בשח",
    "נטו בשח",
    "עמלה בשח"
  ];
  const rows = items.map((transaction) => ([
    clean(transaction.createdAt),
    clean(transaction.connectionLabel),
    clean(transaction.providerLabel),
    clean(transaction.customerName),
    clean(transaction.email),
    clean(transaction.phone),
    clean(transaction.type),
    clean(transaction.status),
    clean(transaction.reference),
    clean(transaction.receiptNumber),
    clean(transaction.transactionNumber),
    clean(transaction.directDebitNumber),
    clean(transaction.clearingCompany),
    clean(transaction.brand),
    clean(transaction.description),
    clean(transaction.originalCurrency || transaction.currency || "ILS"),
    exportNumeric(transaction.originalAmount ?? transaction.amount),
    exportNumeric(transaction.originalNetAmount),
    exportNumeric(transaction.originalFeeAmount),
    Number(transaction.fxRateToIls) || 0,
    clean(transaction.fxRateDate),
    Number(transaction.amountIls ?? transaction.amount) || 0,
    Number(transaction.netAmountIls ?? transaction.netAmount) || 0,
    Number(transaction.feeAmountIls ?? transaction.feeAmount) || 0
  ]));
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Payment Report");
  const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return {
    content,
    filename: buildFileName(config, "xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
}

export async function buildPaymentReportPdfExport(input) {
  const { config, items, summary } = await buildFilteredPaymentReport(input);
  if (config.reportType === "mandates") {
    const rows = items.map((item, index) => ({
      rowNumber: String(index + 1),
      createdAt: clean(item.createdAt),
      nextChargeDate: clean(item.nextChargeDate),
      source: clean(item.connectionLabel),
      provider: clean(item.providerLabel),
      name: clean(item.customerName),
      amount: `${String(Number((item.originalAmount ?? item.amount) || 0).toFixed(2))} ${clean(item.originalCurrency || item.currency || "ILS")}`,
      ilsAmount: String(Number((item.amountIls ?? item.amount) || 0).toFixed(2)),
      status: clean(item.statusLabel || item.status),
      recurring: clean(item.recurringCode),
      phone: clean(item.phone)
    }));
    const pdf = await renderInstitutionPdf({
      title: "דוח הוראות קבע פעילות",
      subtitle: `הוראות: ${summary.transactionsCount} | סה״כ בש״ח: ${summary.totalAmount.toFixed(2)}`,
      orientation: "landscape",
      columns: [
        { key: "rowNumber", label: "#", kind: "rowNumber" },
        { key: "createdAt", label: "נוצר" },
        { key: "nextChargeDate", label: "חיוב הבא" },
        { key: "source", label: "מקור" },
        { key: "provider", label: "ספק" },
        { key: "name", label: "שם" },
        { key: "amount", label: "סכום מקורי" },
        { key: "ilsAmount", label: "שווי בשח" },
        { key: "status", label: "סטטוס" },
        { key: "recurring", label: "תדירות" },
        { key: "phone", label: "טלפון" }
      ],
      rows
    });
    return {
      content: pdf,
      filename: buildFileName(config, "pdf"),
      contentType: "application/pdf"
    };
  }
  const rows = items.map((transaction, index) => ({
    rowNumber: String(index + 1),
    date: clean(transaction.createdAt),
    source: clean(transaction.connectionLabel),
    provider: clean(transaction.providerLabel),
    name: clean(transaction.customerName),
    originalAmount: `${String(Number((transaction.originalAmount ?? transaction.amount) || 0).toFixed(2))} ${clean(transaction.originalCurrency || transaction.currency || "ILS")}`,
    ilsAmount: String(Number((transaction.amountIls ?? transaction.amount) || 0).toFixed(2)),
    net: String(Number((transaction.netAmountIls ?? transaction.netAmount) || 0).toFixed(2)),
    phone: clean(transaction.phone),
    email: clean(transaction.email),
    reference: clean(transaction.reference)
  }));
  const pdf = await renderInstitutionPdf({
    title: "דוח עסקאות",
    subtitle: `טווח: ${clean(config.dateFrom)} עד ${clean(config.dateTo)} | עסקאות: ${summary.transactionsCount} | סה״כ בש״ח: ${summary.totalAmount.toFixed(2)}`,
    orientation: "landscape",
    columns: [
      { key: "rowNumber", label: "#", kind: "rowNumber" },
      { key: "date", label: "תאריך" },
      { key: "source", label: "מקור" },
      { key: "provider", label: "ספק" },
      { key: "name", label: "שם" },
      { key: "originalAmount", label: "סכום מקורי" },
      { key: "ilsAmount", label: "שווי בשח" },
      { key: "net", label: "נטו" },
      { key: "phone", label: "טלפון" },
      { key: "email", label: "מייל" },
      { key: "reference", label: "אסמכתא" }
    ],
    rows
  });
  return {
    content: pdf,
    filename: buildFileName(config, "pdf"),
    contentType: "application/pdf"
  };
}
