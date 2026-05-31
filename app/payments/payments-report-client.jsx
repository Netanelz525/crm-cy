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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("he-IL");
}

export default function PaymentsReportClient({
  dateFrom,
  dateTo,
  transactions,
  connections,
  providerOptions
}) {
  const [selectedProviders, setSelectedProviders] = useState(providerOptions.map((option) => option.value));
  const [selectedConnectionIds, setSelectedConnectionIds] = useState(connections.map((connection) => connection.id));
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
      sortBy,
      sortDir
    }),
    [transactions, selectedProviders, effectiveConnectionIds, sortBy, sortDir]
  );

  const summary = useMemo(
    () => summarizePaymentTransactions(visibleTransactions),
    [visibleTransactions]
  );

  const exportQuery = useMemo(
    () => buildPaymentExportSearchParams({
      dateFrom,
      dateTo,
      providers: selectedProviders,
      connectionIds: effectiveConnectionIds,
      sortBy,
      sortDir
    }),
    [dateFrom, dateTo, selectedProviders, effectiveConnectionIds, sortBy, sortDir]
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
            <strong>{formatMoney(summary.totalAmount)}</strong>
          </div>
          <div>
            <div className="muted">נטו</div>
            <strong>{formatMoney(summary.totalNetAmount)}</strong>
          </div>
          <div>
            <div className="muted">עמלות</div>
            <strong>{formatMoney(summary.totalFees)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>תצוגה חיה של הדוח</h2>
        <div className="grid">
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
                    <strong>{formatMoney(transaction.amount, transaction.currency)}</strong>
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
                    <div className="payments-report-grid-wide"><b>תיאור:</b> {transaction.description || "-"}</div>
                    <div><b>ברוטו:</b> {formatMoney(transaction.amount, transaction.currency)}</div>
                    <div><b>נטו:</b> {formatMoney(transaction.netAmount, transaction.currency)}</div>
                    <div><b>עמלה:</b> {formatMoney(transaction.feeAmount, transaction.currency)}</div>
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
