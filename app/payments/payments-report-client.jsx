"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildPaymentExportSearchParams,
  filterAndSortPaymentTransactions,
  summarizePaymentTransactions
} from "../../lib/payment-report";

function clean(value) {
  return String(value || "").trim();
}

function formatMoney(amount, currency = "ILS") {
  const numeric = Number(amount || 0);
  const safeCurrency = clean(currency || "ILS").toUpperCase();
  try {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: safeCurrency
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${safeCurrency}`;
  }
}

function formatOptionalMoney(amount, currency = "ILS") {
  if (amount == null || amount === "") return "-";
  return formatMoney(amount, currency);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("he-IL");
}

function hasFxConversion(transaction) {
  return clean(transaction?.originalCurrency || transaction?.currency || "ILS").toUpperCase() !== "ILS";
}

export default function PaymentsReportClient({
  dateFrom,
  dateTo,
  transactions,
  connections,
  providerOptions,
  initialSelectedConnectionIds = []
}) {
  const [selectedProviders, setSelectedProviders] = useState(providerOptions.map((option) => option.value));
  const [selectedConnectionIds, setSelectedConnectionIds] = useState(
    initialSelectedConnectionIds.length ? initialSelectedConnectionIds : connections.map((connection) => connection.id)
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  const visibleConnections = useMemo(
    () => connections.filter((connection) => selectedProviders.includes(connection.provider)),
    [connections, selectedProviders]
  );

  const effectiveConnectionIds = useMemo(
    () => selectedConnectionIds.filter((id) => visibleConnections.some((connection) => connection.id === id)),
    [selectedConnectionIds, visibleConnections]
  );

  const visibleTransactions = useMemo(
    () => filterAndSortPaymentTransactions(transactions, {
      providers: selectedProviders,
      connectionIds: effectiveConnectionIds,
      searchTerm,
      sortBy,
      sortDir
    }),
    [transactions, selectedProviders, effectiveConnectionIds, searchTerm, sortBy, sortDir]
  );

  const summary = useMemo(
    () => summarizePaymentTransactions(visibleTransactions),
    [visibleTransactions]
  );

  const sourceSummaries = useMemo(
    () => visibleConnections
      .map((connection) => {
        const items = visibleTransactions.filter((transaction) => transaction.connectionId === connection.id);
        const itemSummary = summarizePaymentTransactions(items);
        return {
          id: connection.id,
          label: connection.label,
          count: items.length,
          totalAmount: itemSummary.totalAmount
        };
      })
      .filter((item) => item.count > 0),
    [visibleConnections, visibleTransactions]
  );

  const emailableTransactionsCount = useMemo(
    () => visibleTransactions.filter((transaction) => clean(transaction.email)).length,
    [visibleTransactions]
  );

  const exportQuery = useMemo(
    () => buildPaymentExportSearchParams({
      reportType: "transactions",
      dateFrom,
      dateTo,
      providers: selectedProviders,
      connectionIds: effectiveConnectionIds,
      searchTerm,
      sortBy,
      sortDir
    }),
    [dateFrom, dateTo, selectedProviders, effectiveConnectionIds, searchTerm, sortBy, sortDir]
  );

  function toggleProvider(provider) {
    setSelectedProviders((prev) => (
      prev.includes(provider)
        ? prev.filter((value) => value !== provider)
        : [...prev, provider]
    ));
  }

  function toggleConnection(connectionId) {
    setSelectedConnectionIds((prev) => (
      prev.includes(connectionId)
        ? prev.filter((value) => value !== connectionId)
        : [...prev, connectionId]
    ));
  }

  return (
    <>
      <section className="card">
        <div className="summary-row">
          <div>
            <div className="muted">מקורות פעילים</div>
            <strong>{effectiveConnectionIds.length}</strong>
          </div>
          <div>
            <div className="muted">עסקאות</div>
            <strong>{summary.transactionsCount}</strong>
          </div>
          <div>
            <div className="muted">סכום כולל</div>
            <strong>{formatMoney(summary.totalAmount, "ILS")}</strong>
          </div>
          <div>
            <div className="muted">נטו</div>
            <strong>{formatMoney(summary.totalNetAmount, "ILS")}</strong>
          </div>
          <div>
            <div className="muted">עמלות</div>
            <strong>{formatMoney(summary.totalFees, "ILS")}</strong>
          </div>
        </div>
        {sourceSummaries.length ? (
          <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
            <div className="muted">סיכום לפי מקור תשלום</div>
            <div style={{ display: "grid", gap: 8 }}>
              {sourceSummaries.map((item) => (
                <div key={item.id} className="card" style={{ padding: 12 }}>
                  <b>{item.label}</b>: {item.count} עסקאות | {formatMoney(item.totalAmount, "ILS")}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>תצוגה חיה של הדוח</h2>
        <div className="grid">
          <input
            type="search"
            placeholder="חיפוש חופשי בכל שדות העסקה"
            value={searchTerm}
            onChange={(event) => setSearchTerm(clean(event.target.value))}
          />
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="date">מיון לפי תאריך</option>
            <option value="amount">מיון לפי סכום</option>
            <option value="source">מיון לפי מקור תשלום</option>
          </select>
          <select value={sortDir} onChange={(event) => setSortDir(event.target.value)}>
            <option value="desc">מהחדש לישן / מהגבוה לנמוך</option>
            <option value="asc">מהישן לחדש / מהנמוך לגבוה</option>
          </select>
          <Link className="quick-action-btn quick-action-outline" href={`/api/payments/export/xlsx?${exportQuery}`}>
            יצוא אקסל
          </Link>
          <Link className="quick-action-btn quick-action-outline" href={`/api/payments/export/pdf?${exportQuery}`} target="_blank">
            יצוא PDF
          </Link>
          {emailableTransactionsCount ? (
            <Link className="quick-action-btn quick-action-outline" href={`/email/payments?${exportQuery}`}>
              שלח מייל לנמעני הדוח
            </Link>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
          <div>
            <div className="muted" style={{ marginBottom: 8 }}>ספקי תשלום</div>
            <div className="email-filter-chip-list">
              {providerOptions.map((provider) => (
                <label key={provider.value} className="email-filter-chip">
                  <input
                    className="email-filter-chip-input"
                    type="checkbox"
                    checked={selectedProviders.includes(provider.value)}
                    onChange={() => toggleProvider(provider.value)}
                  />
                  <span>{provider.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 8 }}>מקורות תשלום</div>
            <div className="email-filter-chip-list">
              {visibleConnections.map((connection) => (
                <label key={connection.id} className="email-filter-chip">
                  <input
                    className="email-filter-chip-input"
                    type="checkbox"
                    checked={effectiveConnectionIds.includes(connection.id)}
                    onChange={() => toggleConnection(connection.id)}
                  />
                  <span>{connection.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>דוח עסקאות</h2>
        {!visibleTransactions.length ? (
          <div className="muted">לא נמצאו עסקאות בתצוגה שנבחרה.</div>
        ) : (
          <div className="payments-report-list">
            {visibleTransactions.map((transaction) => (
              <details key={`${transaction.provider}-${transaction.id}-${transaction.reference}`} className="payments-report-item">
                <summary className="payments-report-summary">
                  <div className="payments-report-summary-main">
                    <strong>{formatDateTime(transaction.createdAt)}</strong>
                    <span>{transaction.customerName || "ללא שם"}</span>
                  </div>
                  <div className="payments-report-summary-meta">
                    <span className="meta-chip">{transaction.connectionLabel}</span>
                    <span className="meta-chip">{transaction.providerLabel}</span>
                    {searchTerm && Number(transaction.searchScore) >= 0.9 ? (
                      <span className="meta-chip">
                        התאמה {Math.round(Number(transaction.searchScore) * 100)}%
                      </span>
                    ) : null}
                    <div style={{ display: "grid", justifyItems: "end" }}>
                      <strong>{formatMoney(transaction.originalAmount ?? transaction.amount, transaction.originalCurrency || transaction.currency)}</strong>
                      {hasFxConversion(transaction) ? (
                        <span className="muted">שווי בש&quot;ח: {formatMoney(transaction.amountIls, "ILS")}</span>
                      ) : null}
                    </div>
                  </div>
                </summary>
                <div className="payments-report-body">
                  <div className="payments-report-grid">
                    <div><b>שם:</b> {transaction.customerName || "-"}</div>
                    <div><b>מייל:</b> {transaction.email || "-"}</div>
                    <div><b>טלפון:</b> {transaction.phone || "-"}</div>
                    <div><b>סוג:</b> {transaction.type || "-"}</div>
                    <div><b>סטטוס:</b> {transaction.status || "-"}</div>
                    <div><b>אסמכתא:</b> {transaction.reference || "-"}</div>
                    <div><b>קבלה:</b> {transaction.receiptNumber || "-"}</div>
                    <div><b>עסקה:</b> {transaction.transactionNumber || "-"}</div>
                    <div><b>הו&quot;ק:</b> {transaction.directDebitNumber || "-"}</div>
                    <div><b>ספק סולק:</b> {transaction.clearingCompany || "-"}</div>
                    <div><b>מותג:</b> {transaction.brand || "-"}</div>
                    <div><b>מקור:</b> {transaction.connectionLabel}</div>
                    <div><b>מטבע מקורי:</b> {transaction.originalCurrency || transaction.currency || "-"}</div>
                    <div><b>שער לש&quot;ח:</b> {transaction.fxRateToIls ? transaction.fxRateToIls : "-"}</div>
                    <div><b>תאריך שער:</b> {transaction.fxRateDate || "-"}</div>
                    <div className="payments-report-grid-wide"><b>תיאור:</b> {transaction.description || "-"}</div>
                    <div><b>ברוטו מקורי:</b> {formatMoney(transaction.originalAmount ?? transaction.amount, transaction.originalCurrency || transaction.currency)}</div>
                    <div><b>נטו מקורי:</b> {formatOptionalMoney(transaction.originalNetAmount, transaction.originalCurrency || transaction.currency)}</div>
                    <div><b>עמלה מקורית:</b> {formatOptionalMoney(transaction.originalFeeAmount, transaction.originalCurrency || transaction.currency)}</div>
                    <div><b>ברוטו בש&quot;ח:</b> {formatMoney(transaction.amountIls ?? transaction.amount, "ILS")}</div>
                    <div><b>נטו בש&quot;ח:</b> {formatMoney(transaction.netAmountIls ?? transaction.netAmount, "ILS")}</div>
                    <div><b>עמלה בש&quot;ח:</b> {formatMoney(transaction.feeAmountIls ?? transaction.feeAmount, "ILS")}</div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
