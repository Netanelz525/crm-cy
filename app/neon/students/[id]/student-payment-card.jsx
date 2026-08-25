"use client";

import Link from "next/link";
import { useState } from "react";

function clean(value) { return String(value || "").trim(); }
function money(value, currency = "ILS") {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: clean(currency) || "ILS" }).format(Number(value || 0));
}
function dateText(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : date.toLocaleDateString("he-IL");
}

export default function StudentPaymentCard({ payment, studentId, transactions = [], unlinkAction }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isMandate = payment.type === "mandate";

  async function loadDetails(event) {
    if (!event.currentTarget.open || !isMandate || details || loading) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/payments/mandates/details?connectionId=${encodeURIComponent(payment.connectionId)}&mandateId=${encodeURIComponent(payment.externalId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "טעינת הפרטים נכשלה");
      setDetails(body.details || {});
    } catch (nextError) { setError(nextError.message || "טעינת הפרטים נכשלה"); }
    finally { setLoading(false); }
  }

  if (!isMandate) return (
    <div className="linked-record-card student-payment-card student-payment-transaction">
      <div className="student-payment-header"><span className="student-payment-kind">עסקה</span><b>{payment.customerName || "ללא שם"}</b></div>
      <div className="student-payment-amount">{money(payment.amount, payment.currency)}</div>
      <div className="linked-record-meta">{payment.provider} · {payment.periodMonth}</div>
      <div className="linked-record-meta">מזהה: <span dir="ltr">{payment.externalId}</span></div>
      <form action={unlinkAction} className="student-payment-actions"><input type="hidden" name="studentId" value={studentId} /><input type="hidden" name="paymentRecordId" value={payment.id} /><button className="quick-action-btn quick-action-outline">הסר שיוך</button></form>
    </div>
  );

  const history = Array.isArray(details?.history) ? details.history.slice(0, 3) : [];
  return (
    <details className="linked-record-card student-payment-card student-payment-mandate" onToggle={loadDetails}>
      <summary className="student-payment-summary"><div className="student-payment-header"><span className="student-payment-kind">הוראת קבע</span><b>{payment.customerName || "ללא שם"}</b></div><div className="student-payment-summary-meta"><span className="student-payment-amount">{money(payment.amount, payment.currency)}</span><span className="linked-record-meta">{payment.provider}</span></div></summary>
      <div className="payments-report-grid student-payment-details">
        <div><b>סטטוס:</b> {details?.statusLabel || payment.status || "-"}</div>
        <div><b>חיוב הבא:</b> {dateText(details?.nextChargeDate)}</div>
        <div><b>סכום:</b> {money(details?.amount ?? payment.amount, details?.currency || payment.currency)}</div>
        <div><b>תדירות:</b> {details?.recurringCode || "-"}</div>
        <div><b>אמצעי תשלום:</b> {details?.paymentMethodLast4 ? `****${details.paymentMethodLast4}` : "-"}</div>
        <div><b>תוקף:</b> {details?.paymentMethodExpiry || "-"}</div>
      </div>
      {loading ? <div className="muted">טוען פרטים עדכניים...</div> : null}
      {error ? <div className="error">{error}</div> : null}
      <div className="student-payment-history"><h4>שלוש עסקאות אחרונות</h4>
        {(history.length ? history : transactions).slice(0, 3).map((item, index) => (
          <div key={item.id || index} className="payments-report-history-row student-payment-history-row">
            <div><b>{dateText(item.date || item.occurredAt)}</b><span className="linked-record-meta">אסמכתא: {item.transactionId || item.externalId || "-"}</span></div>
            <b>{money(item.amount, item.currency || payment.currency)}</b>
          </div>
        ))}
        {!history.length && !transactions.length && !loading ? <div className="muted">לא נמצאו עסקאות משויכות.</div> : null}
      </div>
      <div className="quick-actions student-payment-actions">
        <Link className="quick-action-btn quick-action-primary" href={`/payments/mandates/${encodeURIComponent(payment.id)}?studentId=${encodeURIComponent(studentId)}`}>פתח עמוד הוראת קבע מלא</Link>
        <form action={unlinkAction}><input type="hidden" name="studentId" value={studentId} /><input type="hidden" name="paymentRecordId" value={payment.id} /><button className="quick-action-btn quick-action-outline">הסר שיוך</button></form>
      </div>
    </details>
  );
}
