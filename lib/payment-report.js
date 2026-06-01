function clean(value) {
  return String(value || "").trim();
}

function getComparableAmount(transaction, field) {
  const ilsKey = `${field}Ils`;
  const ilsValue = Number(transaction?.[ilsKey]);
  if (Number.isFinite(ilsValue) && ilsValue > 0) return ilsValue;
  return Number(transaction?.[field]) || 0;
}

export function filterAndSortPaymentTransactions(
  transactions = [],
  {
    providers = [],
    connectionIds = [],
    sortBy = "date",
    sortDir = "desc"
  } = {}
) {
  const providerSet = new Set((providers || []).map(clean).filter(Boolean));
  const connectionSet = new Set((connectionIds || []).map(clean).filter(Boolean));
  const direction = clean(sortDir).toLowerCase() === "asc" ? 1 : -1;

  const filtered = (transactions || []).filter((transaction) => {
    if (providerSet.size && !providerSet.has(clean(transaction?.provider))) return false;
    if (connectionSet.size && !connectionSet.has(clean(transaction?.connectionId))) return false;
    return true;
  });

  return [...filtered].sort((left, right) => {
    if (sortBy === "amount") {
      return (getComparableAmount(left, "amount") - getComparableAmount(right, "amount")) * direction;
    }

    if (sortBy === "source") {
      const leftValue = `${clean(left?.providerLabel)} ${clean(left?.connectionLabel)}`.toLowerCase();
      const rightValue = `${clean(right?.providerLabel)} ${clean(right?.connectionLabel)}`.toLowerCase();
      return leftValue.localeCompare(rightValue, "he") * direction;
    }

    return ((Number(left?.createdAtUnix) || 0) - (Number(right?.createdAtUnix) || 0)) * direction;
  });
}

export function summarizePaymentTransactions(transactions = []) {
  return {
    transactionsCount: transactions.length,
    totalAmount: transactions.reduce((sum, item) => sum + getComparableAmount(item, "amount"), 0),
    totalNetAmount: transactions.reduce((sum, item) => sum + getComparableAmount(item, "netAmount"), 0),
    totalFees: transactions.reduce((sum, item) => sum + getComparableAmount(item, "feeAmount"), 0)
  };
}

export function buildPaymentExportSearchParams({
  dateFrom = "",
  dateTo = "",
  providers = [],
  connectionIds = [],
  sortBy = "date",
  sortDir = "desc"
} = {}) {
  const params = new URLSearchParams();
  if (clean(dateFrom)) params.set("dateFrom", clean(dateFrom));
  if (clean(dateTo)) params.set("dateTo", clean(dateTo));
  (providers || []).map(clean).filter(Boolean).forEach((provider) => params.append("provider", provider));
  (connectionIds || []).map(clean).filter(Boolean).forEach((connectionId) => params.append("connectionId", connectionId));
  if (clean(sortBy)) params.set("sortBy", clean(sortBy));
  if (clean(sortDir)) params.set("sortDir", clean(sortDir));
  return params.toString();
}

export function buildPaymentReportUrls(config = {}) {
  const query = buildPaymentExportSearchParams({
    dateFrom: clean(config.dateFrom),
    dateTo: clean(config.dateTo),
    providers: Array.isArray(config.providers) ? config.providers : [],
    connectionIds: Array.isArray(config.connectionIds) ? config.connectionIds : [],
    sortBy: clean(config.sortBy) === "amount" ? "amount" : clean(config.sortBy) === "source" ? "source" : "date",
    sortDir: clean(config.sortDir).toLowerCase() === "asc" ? "asc" : "desc"
  });

  return {
    exportUrl: `/api/payments/export/xlsx?${query}`,
    pdfUrl: `/api/payments/export/pdf?${query}`,
    viewUrl: `/payments?run=1&${query}`
  };
}
