"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import PendingSubmitButton from "../../components/pending-submit-button";
import {
  buildPaymentExportSearchParams,
  filterAndSortPaymentTransactions,
  summarizePaymentTransactions
} from "../../lib/payment-report";
import { sendSinglePaymentMandateEmailAction } from "./actions";

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

function isNoRemainingPaymentsMandate(item) {
  const issueKind = clean(item?.issueKind);
  const issueText = clean(item?.errorText);
  return issueKind === "no_remaining_payments"
    || (issueText.includes("לא פעיל") && issueText.includes("אין יתרת תשלומים"));
}

function MandateIssueLabel({ item, fallbackText = "" }) {
  const issueText = clean(item?.errorText || fallbackText);
  if (isNoRemainingPaymentsMandate({ ...item, errorText: issueText })) {
    return (
      <span className="payment-mandate-finished-label">
        הסתיימו כל התשלומים בהוראת הקבע
        {issueText ? <small>{issueText}</small> : null}
      </span>
    );
  }
  return issueText || "-";
}

function MandateRemoteDetails({ item, detailsState }) {
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
        <div><b>סיבת תקלה:</b> <MandateIssueLabel item={details} fallbackText={item.errorText} /></div>
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

      {item.provider === "stripe" ? (
        <div className="card" style={{ padding: 12, borderColor: "#f3c6c6", background: "#fff7f7" }}>
          <div style={{ fontWeight: 800, marginBottom: 8, color: "#991b1b" }}>ניהול המנוי ב-Stripe</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            מחיקה או ביטול של הוראת הקבע מתבצעים ישירות ב-Stripe. הקישור פותח את עמוד המנוי עצמו.
          </div>
          <Link
            className="quick-action-btn quick-action-outline"
            href={`https://dashboard.stripe.com/subscriptions/${encodeURIComponent(item.mandateId || item.id)}`}
            target="_blank"
          >
            פתח את המנוי ב-Stripe
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function QuickMandateEmailForm({ item, returnQuery }) {
  const email = clean(item?.email).toLowerCase();
  if (!email) return null;

  const statusLabel = clean(item?.statusLabel || item?.status);
  const defaultBody = [
    "שלום {{שם}},",
    "",
    "רצינו לעדכן אותך בנושא הוראת הקבע שלך.",
    "",
    "בברכה,",
    "מחלקת תרומות"
  ].join("\n");

  return (
    <details className="quick-single-email-card">
      <summary>שליחת מייל מהירה לתורם</summary>
      <form action={sendSinglePaymentMandateEmailAction} encType="multipart/form-data" className="quick-single-email-form">
        <input type="hidden" name="returnTo" value={`/payments?run=1&${returnQuery}`} />
        <input type="hidden" name="recipientEmail" value={email} />
        <input type="hidden" name="recipientName" value={clean(item?.customerName) || email} />
        <input type="hidden" name="sourceLabel" value={clean(item?.connectionLabel)} />
        <input type="hidden" name="providerLabel" value={clean(item?.providerLabel)} />
        <input type="hidden" name="extraLabel" value={statusLabel} />
        <label>
          שם שולח
          <input name="senderName" defaultValue="מחלקת תרומות" />
        </label>
        <label>
          נושא
          <input name="subject" defaultValue="עדכון בנושא הוראת הקבע שלך" required />
        </label>
        <label className="payments-report-grid-wide">
          תוכן
          <textarea name="bodyText" rows={5} defaultValue={defaultBody} required />
        </label>
        <label className="payments-report-grid-wide">
          קובץ מצורף
          <input type="file" name="attachments" multiple />
        </label>
        <PendingSubmitButton className="quick-action-btn quick-action-primary" pendingText="שולח מייל...">
          שלח מייל עכשיו
        </PendingSubmitButton>
      </form>
    </details>
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

  const emailableMandatesCount = useMemo(
    () => visibleMandates.filter((item) => clean(item.email)).length,
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
            <option value="completedNoRemaining">הצג הוראות שהסתיימו התשלומים שלהן</option>
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
          {emailableMandatesCount ? (
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
        <h2 style={{ marginTop: 0 }}>דוח הוראות קבע</h2>
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
                    {isNoRemainingPaymentsMandate(item) ? (
                      <span className="meta-chip meta-chip-no-remaining">הסתיימו תשלומים</span>
                    ) : null}
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
                    <div className="payments-report-grid-wide"><b>שגיאה אחרונה:</b> <MandateIssueLabel item={item} /></div>
                    <div><b>סכום מקורי:</b> {formatMoney(item.originalAmount ?? item.amount, item.originalCurrency || item.currency)}</div>
                    <div><b>שווי בש&quot;ח:</b> {formatMoney(item.amountIls ?? item.amount, "ILS")}</div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <QuickMandateEmailForm item={item} returnQuery={exportQuery} />
                    <MandateRemoteDetails
                      item={item}
                      detailsState={detailsByMandate[`${item.connectionId}:${item.mandateId || item.id}`]}
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
