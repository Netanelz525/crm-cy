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

export default function PaymentMandatesReportClient({
  mandates,
  connections,
  providerOptions,
  initialSelectedConnectionIds = [],
  initialMandateStatus = "active"
}) {
  const [selectedProviders, setSelectedProviders] = useState(providerOptions.map((option) => option.value));
  const [selectedConnectionIds, setSelectedConnectionIds] = useState(
    initialSelectedConnectionIds.length ? initialSelectedConnectionIds : connections.map((connection) => connection.id)
  );
  const [mandateStatus, setMandateStatus] = useState(initialMandateStatus || "active");
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

  const visibleMandates = useMemo(
    () => filterAndSortPaymentTransactions(mandates, {
      providers: selectedProviders,
      connectionIds: effectiveConnectionIds,
      mandateStatus,
      sortBy,
      sortDir
    }),
    [mandates, selectedProviders, effectiveConnectionIds, mandateStatus, sortBy, sortDir]
  );

  const summary = useMemo(
    () => summarizePaymentTransactions(visibleMandates),
    [visibleMandates]
  );

  const sourceSummaries = useMemo(
    () => visibleConnections
      .map((connection) => {
        const items = visibleMandates.filter((item) => item.connectionId === connection.id);
        const itemSummary = summarizePaymentTransactions(items);
        return {
          id: connection.id,
          label: connection.label,
          count: items.length,
          totalAmount: itemSummary.totalAmount
        };
      })
      .filter((item) => item.count > 0),
    [visibleConnections, visibleMandates]
  );

  const exportQuery = useMemo(
    () => buildPaymentExportSearchParams({
      reportType: "mandates",
      providers: selectedProviders,
      connectionIds: effectiveConnectionIds,
      mandateStatus,
      sortBy,
      sortDir
    }),
    [selectedProviders, effectiveConnectionIds, mandateStatus, sortBy, sortDir]
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
            <div className="muted">הוראות קבע</div>
            <strong>{summary.transactionsCount}</strong>
          </div>
          <div>
            <div className="muted">סכום חודשי כולל</div>
            <strong>{formatMoney(summary.totalAmount, "ILS")}</strong>
          </div>
        </div>
        {sourceSummaries.length ? (
          <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
            <div className="muted">סיכום לפי מקור תשלום</div>
            <div style={{ display: "grid", gap: 8 }}>
              {sourceSummaries.map((item) => (
                <div key={item.id} className="card" style={{ padding: 12 }}>
                  <b>{item.label}</b>: {item.count} הוראות קבע | {formatMoney(item.totalAmount, "ILS")}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>תצוגה חיה של הדוח</h2>
        <div className="grid">
          <select value={mandateStatus} onChange={(event) => setMandateStatus(clean(event.target.value) || "active")}>
            <option value="active">הצג הוראות קבע פעילות</option>
            <option value="issues">הצג הוראות קבע עם תקלות</option>
            <option value="all">הצג את כל הוראות הקבע</option>
          </select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="date">מיון לפי תאריך יצירה</option>
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
        <h2 style={{ marginTop: 0 }}>דוח הוראות קבע פעילות</h2>
        {!visibleMandates.length ? (
          <div className="muted">לא נמצאו הוראות קבע בתצוגה שנבחרה.</div>
        ) : (
          <div className="payments-report-list">
            {visibleMandates.map((item) => (
              <details
                key={`${item.provider}-${item.id}`}
                className={`payments-report-item${item.status === "issues" ? " payments-report-item-issue" : ""}`}
              >
                <summary className="payments-report-summary">
                  <div className="payments-report-summary-main">
                    <strong>{formatDateTime(item.nextChargeDate || item.createdAt)}</strong>
                    <span>{item.customerName || "ללא שם"}</span>
                  </div>
                  <div className="payments-report-summary-meta">
                    <span className="meta-chip">{item.connectionLabel}</span>
                    <span className="meta-chip">{item.providerLabel}</span>
                    <span className={`meta-chip${item.status === "issues" ? " meta-chip-issue" : ""}`}>
                      {item.statusLabel || item.status || "-"}
                    </span>
                    <div style={{ display: "grid", justifyItems: "end" }}>
                      <strong>{formatMoney(item.originalAmount ?? item.amount, item.originalCurrency || item.currency)}</strong>
                      <span className="muted">שווי בש&quot;ח: {formatMoney(item.amountIls ?? item.amount, "ILS")}</span>
                    </div>
                  </div>
                </summary>
                <div className="payments-report-body">
                  <div className="payments-report-grid">
                    <div><b>שם:</b> {item.customerName || "-"}</div>
                    <div><b>מייל:</b> {item.email || "-"}</div>
                    <div><b>טלפון:</b> {item.phone || "-"}</div>
                    <div><b>תעודת זהות:</b> {item.donorId || "-"}</div>
                    <div><b>סטטוס:</b> {item.statusLabel || item.status || "-"}</div>
                    <div><b>מקור:</b> {item.connectionLabel || "-"}</div>
                    <div><b>מספר הו&quot;ק / מנוי:</b> {item.mandateId || "-"}</div>
                    <div><b>נוצר בתאריך:</b> {formatDateTime(item.createdAt)}</div>
                    <div><b>חיוב הבא:</b> {formatDateTime(item.nextChargeDate)}</div>
                    <div><b>תדירות:</b> {item.recurringCode || "-"}</div>
                    <div><b>4 ספרות:</b> {item.paymentMethodLast4 || "-"}</div>
                    <div><b>תוקף:</b> {item.paymentMethodExpiry || "-"}</div>
                    <div><b>עיר:</b> {item.city || "-"}</div>
                    <div><b>כתובת:</b> {item.address || "-"}</div>
                    <div><b>קבוצה:</b> {item.group || "-"}</div>
                    <div className="payments-report-grid-wide"><b>הערות:</b> {item.comments || "-"}</div>
                    <div className="payments-report-grid-wide"><b>שגיאה אחרונה:</b> {item.errorText || "-"}</div>
                    <div><b>סכום מקורי:</b> {formatMoney(item.originalAmount ?? item.amount, item.originalCurrency || item.currency)}</div>
                    <div><b>שווי בש&quot;ח:</b> {formatMoney(item.amountIls ?? item.amount, "ILS")}</div>
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
