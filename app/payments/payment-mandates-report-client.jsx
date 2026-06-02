"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

function formatHistoryMoney(entry, fallbackCurrency = "ILS") {
  if (clean(entry?.amountText)) return clean(entry.amountText);
  return formatMoney(entry?.amount, fallbackCurrency);
}

function MandateRemoteDetails({ item, detailsState, deleteState, onStartDelete, onCancelDelete, onConfirmDelete }) {
  if (detailsState?.loading) {
    return <div className="muted">טוען פרטי הוראת קבע והיסטוריית חיובים...</div>;
  }
  if (detailsState?.error) {
    return <div className="muted" style={{ color: "#991b1b" }}>{detailsState.error}</div>;
  }
  const details = detailsState?.details;
  if (!details) {
    return <div className="muted">פתח את הכרטיס כדי לטעון פרטים נוספים והיסטוריית חיובים.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="payments-report-grid">
        <div><b>סטטוס מורחב:</b> {details.statusLabel || details.status || "-"}</div>
        <div><b>סך היסטוריה:</b> {formatMoney(details.totalHistoryAmount || 0, details.totalHistoryCurrency || details.originalCurrency || details.currency || "ILS")}</div>
        <div><b>כמות חיובים:</b> {details.historyCount || 0}</div>
        <div><b>חיובים מוצלחים:</b> {details.successCount || 0}</div>
        <div><b>עבור:</b> {details.avour || "-"}</div>
        <div><b>כרטיס תורם:</b> {details.asToremCard || "-"}</div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>היסטוריית חיובים</div>
        {!details.history?.length ? (
          <div className="muted">לא נמצאה היסטוריית חיובים זמינה להוראת הקבע הזו.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {details.history.map((entry) => (
              <div key={entry.id} className="payments-report-history-row">
                <div><b>תאריך:</b> {formatDateTime(entry.date)}</div>
                <div><b>סכום:</b> {formatHistoryMoney(entry, details.totalHistoryCurrency || item.originalCurrency || item.currency || "ILS")}</div>
                <div><b>אסמכתא:</b> {entry.transactionId || entry.invoiceNumber || "-"}</div>
                <div><b>סטטוס:</b> {entry.status || "שולם"}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {item.provider === "stripe" && details.status !== "completed" ? (
        <div className="card" style={{ padding: 12, borderColor: "#f3c6c6", background: "#fff7f7" }}>
          <div style={{ fontWeight: 800, marginBottom: 8, color: "#991b1b" }}>מחיקת הוראת קבע</div>
          {!deleteState?.confirming ? (
            <>
              <div className="muted" style={{ marginBottom: 10 }}>
                הפעולה זמינה כרגע רק עבור Stripe, ומבטלת מיד את המנוי החוזר במערכת הסליקה.
              </div>
              <button type="button" className="quick-action-btn quick-action-outline" onClick={onStartDelete}>
                סמן למחיקה
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ color: "#991b1b", fontWeight: 700 }}>
                האם למחוק סופית את הוראת הקבע הזו ב-Stripe?
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={onConfirmDelete} disabled={deleteState?.loading}>
                  {deleteState?.loading ? "מוחק..." : "אישור סופי למחיקה"}
                </button>
                <button type="button" className="quick-action-btn quick-action-outline" onClick={onCancelDelete} disabled={deleteState?.loading}>
                  ביטול
                </button>
              </div>
              {deleteState?.error ? (
                <div className="muted" style={{ color: "#991b1b" }}>{deleteState.error}</div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
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
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [detailsByMandate, setDetailsByMandate] = useState({});
  const [deleteStateByMandate, setDeleteStateByMandate] = useState({});
  const router = useRouter();

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
      searchTerm,
      sortBy,
      sortDir
    }),
    [mandates, selectedProviders, effectiveConnectionIds, mandateStatus, searchTerm, sortBy, sortDir]
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
      searchTerm,
      sortBy,
      sortDir
    }),
    [selectedProviders, effectiveConnectionIds, mandateStatus, searchTerm, sortBy, sortDir]
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

  async function loadMandateDetails(item) {
    const cacheKey = `${item.connectionId}:${item.mandateId || item.id}`;
    const current = detailsByMandate[cacheKey];
    if (current?.loading || current?.details) return;

    setDetailsByMandate((prev) => ({
      ...prev,
      [cacheKey]: { loading: true, error: "", details: null }
    }));

    try {
      const response = await fetch(`/api/payments/mandates/details?connectionId=${encodeURIComponent(item.connectionId)}&mandateId=${encodeURIComponent(item.mandateId || item.id)}`, {
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(clean(payload?.error) || "טעינת פרטי הוראת הקבע נכשלה.");
      }
      setDetailsByMandate((prev) => ({
        ...prev,
        [cacheKey]: { loading: false, error: "", details: payload?.details || null }
      }));
    } catch (error) {
      setDetailsByMandate((prev) => ({
        ...prev,
        [cacheKey]: { loading: false, error: clean(error?.message) || "טעינת פרטי הוראת הקבע נכשלה.", details: null }
      }));
    }
  }

  function startDelete(item) {
    const cacheKey = `${item.connectionId}:${item.mandateId || item.id}`;
    setDeleteStateByMandate((prev) => ({
      ...prev,
      [cacheKey]: { confirming: true, loading: false, error: "" }
    }));
  }

  function cancelDelete(item) {
    const cacheKey = `${item.connectionId}:${item.mandateId || item.id}`;
    setDeleteStateByMandate((prev) => ({
      ...prev,
      [cacheKey]: { confirming: false, loading: false, error: "" }
    }));
  }

  async function confirmDelete(item) {
    const cacheKey = `${item.connectionId}:${item.mandateId || item.id}`;
    setDeleteStateByMandate((prev) => ({
      ...prev,
      [cacheKey]: { confirming: true, loading: true, error: "" }
    }));

    try {
      const response = await fetch("/api/payments/mandates/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: item.connectionId,
          mandateId: item.mandateId || item.id
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(clean(payload?.error) || "מחיקת הוראת הקבע נכשלה.");
      }
      router.refresh();
    } catch (error) {
      setDeleteStateByMandate((prev) => ({
        ...prev,
        [cacheKey]: { confirming: true, loading: false, error: clean(error?.message) || "מחיקת הוראת הקבע נכשלה." }
      }));
    }
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
          <input
            type="search"
            placeholder="חיפוש חופשי בכל שדות הוראת הקבע"
            value={searchTerm}
            onChange={(event) => setSearchTerm(clean(event.target.value))}
          />
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
                className={`payments-report-item${item.status === "issues" ? " payments-report-item-issue" : ""}${item.status === "completed" ? " payments-report-item-completed" : ""}`}
                onToggle={(event) => {
                  if (event.currentTarget.open) {
                    loadMandateDetails(item);
                  }
                }}
              >
                <summary className="payments-report-summary">
                  <div className="payments-report-summary-main">
                    <strong>{formatDateTime(item.nextChargeDate || item.createdAt)}</strong>
                    <span>{item.customerName || "ללא שם"}</span>
                  </div>
                  <div className="payments-report-summary-meta">
                    <span className="meta-chip">{item.connectionLabel}</span>
                    <span className="meta-chip">{item.providerLabel}</span>
                    <span className={`meta-chip${item.status === "issues" ? " meta-chip-issue" : ""}${item.status === "completed" ? " meta-chip-completed" : ""}`}>
                      {item.statusLabel || item.status || "-"}
                    </span>
                    {searchTerm && Number(item.searchScore) >= 0.9 ? (
                      <span className="meta-chip">
                        התאמה {Math.round(Number(item.searchScore) * 100)}%
                      </span>
                    ) : null}
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
                  <div style={{ marginTop: 14 }}>
                    <MandateRemoteDetails
                      item={item}
                      detailsState={detailsByMandate[`${item.connectionId}:${item.mandateId || item.id}`]}
                      deleteState={deleteStateByMandate[`${item.connectionId}:${item.mandateId || item.id}`]}
                      onStartDelete={() => startDelete(item)}
                      onCancelDelete={() => cancelDelete(item)}
                      onConfirmDelete={() => confirmDelete(item)}
                    />
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
