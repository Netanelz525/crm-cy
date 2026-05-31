import * as XLSX from "xlsx";
import { renderInstitutionPdf } from "./institution-pdf";
import { listPaymentConnections, getPaymentDashboard } from "./payment-systems";
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
    dateFrom: clean(searchParams.get("dateFrom")),
    dateTo: clean(searchParams.get("dateTo")),
    providers: searchParams.getAll("provider").map(clean).filter(Boolean),
    connectionIds: searchParams.getAll("connectionId").map(clean).filter(Boolean),
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

function buildFileName(config, extension) {
  const from = sanitizeFilenamePart(config.dateFrom || "from");
  const to = sanitizeFilenamePart(config.dateTo || "to");
  return `payment-report-${from}-to-${to}.${extension}`;
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
  const dashboard = await getPaymentDashboard({
    connectionIds,
    dateFrom: config.dateFrom,
    dateTo: config.dateTo
  });
  const transactions = filterAndSortPaymentTransactions(dashboard.transactions, {
    providers: config.providers,
    connectionIds,
    sortBy: config.sortBy,
    sortDir: config.sortDir
  });
  const summary = summarizePaymentTransactions(transactions);
  return { config, transactions, summary };
}

export async function buildPaymentReportExcelExport(input) {
  const { config, transactions } = await buildFilteredPaymentReport(input);
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
  const rows = transactions.map((transaction) => ([
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
    Number(transaction.originalAmount ?? transaction.amount) || 0,
    Number(transaction.originalNetAmount ?? transaction.netAmount) || 0,
    Number(transaction.originalFeeAmount ?? transaction.feeAmount) || 0,
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
  const { config, transactions, summary } = await buildFilteredPaymentReport(input);
  const rows = transactions.map((transaction, index) => ({
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
