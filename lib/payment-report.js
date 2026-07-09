function clean(value) {
  return String(value || "").trim();
}

function normalizeSearchText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/["'`׳״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSearchValues(value, values, depth = 0) {
  if (value == null || depth > 2) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSearchValues(item, values, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectSearchValues(item, values, depth + 1));
    return;
  }
  const normalized = normalizeSearchText(value);
  if (normalized) values.push(normalized);
}

function buildBigrams(text) {
  const compact = normalizeSearchText(text).replace(/\s+/g, "");
  if (!compact) return [];
  if (compact.length === 1) return [compact];
  const pairs = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    pairs.push(compact.slice(index, index + 2));
  }
  return pairs;
}

function diceCoefficient(left, right) {
  const a = buildBigrams(left);
  const b = buildBigrams(right);
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const pair of a) {
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  let matches = 0;
  for (const pair of b) {
    const count = counts.get(pair) || 0;
    if (count > 0) {
      matches += 1;
      counts.set(pair, count - 1);
    }
  }
  return (2 * matches) / (a.length + b.length);
}

function getSearchMatch(transaction, searchTerm, minSearchScore = 0.9) {
  const normalizedQuery = normalizeSearchText(searchTerm);
  if (!normalizedQuery) {
    return { matched: true, score: 1 };
  }

  const values = [];
  collectSearchValues(transaction, values);
  let maxScore = 0;

  for (const value of values) {
    if (!value) continue;
    if (value.includes(normalizedQuery)) {
      return { matched: true, score: 1 };
    }

    const segments = [value, ...value.split(/[\s|,:;./\\\-()_[\]{}]+/g).filter(Boolean)];
    for (const segment of segments) {
      const score = diceCoefficient(segment, normalizedQuery);
      if (score > maxScore) maxScore = score;
      if (score >= minSearchScore) {
        return { matched: true, score };
      }
    }
  }

  return { matched: false, score: maxScore };
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
    mandateStatus = "",
    searchTerm = "",
    minSearchScore = 0.9,
    sortBy = "date",
    sortDir = "desc"
  } = {}
) {
  const providerSet = new Set((providers || []).map(clean).filter(Boolean));
  const connectionSet = new Set((connectionIds || []).map(clean).filter(Boolean));
  const direction = clean(sortDir).toLowerCase() === "asc" ? 1 : -1;

  const filtered = (transactions || []).flatMap((transaction) => {
    if (providerSet.size && !providerSet.has(clean(transaction?.provider))) return [];
    if (connectionSet.size && !connectionSet.has(clean(transaction?.connectionId))) return [];
    if (clean(mandateStatus) === "active" && clean(transaction?.status) !== "active") return [];
    if (clean(mandateStatus) === "issues" && clean(transaction?.status) !== "issues") return [];
    if (
      clean(mandateStatus) === "completedNoRemaining"
      && !(clean(transaction?.status) === "completed" && clean(transaction?.issueKind) === "no_remaining_payments")
    ) return [];
    const match = getSearchMatch(transaction, searchTerm, minSearchScore);
    if (!match.matched) return [];
    return [{ ...transaction, searchScore: match.score }];
  });

  return [...filtered].sort((left, right) => {
    if (left.searchScore !== right.searchScore) {
      return (Number(right.searchScore) - Number(left.searchScore));
    }
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
  reportType = "transactions",
  dateFrom = "",
  dateTo = "",
  providers = [],
  connectionIds = [],
  mandateStatus = "",
  searchTerm = "",
  sortBy = "date",
  sortDir = "desc"
} = {}) {
  const params = new URLSearchParams();
  if (clean(reportType)) params.set("reportType", clean(reportType));
  if (clean(dateFrom)) params.set("dateFrom", clean(dateFrom));
  if (clean(dateTo)) params.set("dateTo", clean(dateTo));
  (providers || []).map(clean).filter(Boolean).forEach((provider) => params.append("provider", provider));
  (connectionIds || []).map(clean).filter(Boolean).forEach((connectionId) => params.append("connectionId", connectionId));
  if (clean(mandateStatus)) params.set("mandateStatus", clean(mandateStatus));
  if (clean(searchTerm)) params.set("searchTerm", clean(searchTerm));
  if (clean(sortBy)) params.set("sortBy", clean(sortBy));
  if (clean(sortDir)) params.set("sortDir", clean(sortDir));
  return params.toString();
}

export function buildPaymentReportUrls(config = {}) {
  const query = buildPaymentExportSearchParams({
    reportType: clean(config.reportType) || "transactions",
    dateFrom: clean(config.dateFrom),
    dateTo: clean(config.dateTo),
    providers: Array.isArray(config.providers) ? config.providers : [],
    connectionIds: Array.isArray(config.connectionIds) ? config.connectionIds : [],
    mandateStatus: clean(config.mandateStatus),
    searchTerm: clean(config.searchTerm),
    sortBy: clean(config.sortBy) === "amount" ? "amount" : clean(config.sortBy) === "source" ? "source" : "date",
    sortDir: clean(config.sortDir).toLowerCase() === "asc" ? "asc" : "desc"
  });

  return {
    exportUrl: `/api/payments/export/xlsx?${query}`,
    pdfUrl: `/api/payments/export/pdf?${query}`,
    viewUrl: `/payments?run=1&${query}`
  };
}
