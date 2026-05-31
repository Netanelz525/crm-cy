function clean(value) {
  return String(value || "").trim();
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
      return ((Number(left?.amount) || 0) - (Number(right?.amount) || 0)) * direction;
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
    totalAmount: transactions.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0),
    totalNetAmount: transactions.reduce((sum, item) => sum + (Number(item?.netAmount) || 0), 0),
    totalFees: transactions.reduce((sum, item) => sum + (Number(item?.feeAmount) || 0), 0)
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
