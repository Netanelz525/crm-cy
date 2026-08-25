import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPaymentMandateDetails } from "../../../../lib/payment-systems";
import { getStudentPaymentRecord, listStudentPayments } from "../../../../lib/payment-student-links";
import { getCurrentAppUser, signInRedirectUrl } from "../../../../lib/rbac";

function clean(value) { return String(value || "").trim(); }
function money(value, currency = "ILS") { return new Intl.NumberFormat("he-IL", { style: "currency", currency: clean(currency) || "ILS" }).format(Number(value || 0)); }
function dateText(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("he-IL") : clean(value) || "-"; }

export default async function StudentMandateDetailsPage({ params, searchParams }) {
  const user = await getCurrentAppUser();
  if (!user) redirect(await signInRedirectUrl());
  if (!(user.is_team_member || user.is_manager || user.is_super_admin)) redirect("/unauthorized");
  const { recordId } = await params;
  const studentId = clean((await searchParams)?.studentId);
  const payment = await getStudentPaymentRecord(studentId, recordId);
  if (!payment || payment.type !== "mandate") notFound();
  let details = {};
  let detailsError = "";
  try { details = await getPaymentMandateDetails({ connectionId: payment.connectionId, mandateId: payment.externalId }); }
  catch (error) { detailsError = clean(error?.message) || "טעינת פרטי הוראת הקבע נכשלה."; }
  const studentTransactions = (await listStudentPayments(studentId)).filter((item) => item.type === "transaction" && item.connectionId === payment.connectionId);
  const history = Array.isArray(details.history) ? details.history : [];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card glass"><h1>פרטי הוראת קבע</h1><div className="muted">{details.customerName || payment.customerName || "ללא שם"}</div><div className="quick-actions"><Link className="quick-action-btn quick-action-outline" href={`/neon/students/${encodeURIComponent(studentId)}?payments=1#payments`}>חזרה לתלמיד</Link><Link className="quick-action-btn quick-action-outline" href="/payments?reportType=mandates&run=1">כל הוראות הקבע</Link></div></section>
      {detailsError ? <div className="error">{detailsError}</div> : null}
      <section className="card"><h2>פרטי ההוראה</h2><div className="payments-report-grid">
        <div><b>משלם:</b> {details.customerName || payment.customerName || "-"}</div>
        <div><b>סטטוס:</b> {details.statusLabel || payment.status || "-"}</div>
        <div><b>סכום:</b> {money(details.amount ?? payment.amount, details.currency || payment.currency)}</div>
        <div><b>חיוב הבא:</b> {dateText(details.nextChargeDate)}</div>
        <div><b>תדירות:</b> {details.recurringCode || "-"}</div>
        <div><b>מייל:</b> {details.email || payment.email || "-"}</div>
        <div><b>טלפון:</b> {details.phone || payment.phone || "-"}</div>
        <div><b>ת״ז:</b> {details.donorId || payment.donorId || "-"}</div>
        <div><b>אמצעי תשלום:</b> {details.paymentMethodLast4 ? `****${details.paymentMethodLast4}` : "-"}</div>
        <div><b>תוקף:</b> {details.paymentMethodExpiry || "-"}</div>
        <div><b>חיובים מוצלחים:</b> {details.successCount ?? "-"}</div>
        <div><b>סה״כ ששולם:</b> {details.totalHistoryAmount != null ? money(details.totalHistoryAmount, details.totalHistoryCurrency || payment.currency) : "-"}</div>
        <div className="payments-report-grid-wide"><b>הערות:</b> {details.comments || "-"}</div>
        {details.errorText ? <div className="payments-report-grid-wide error"><b>שגיאה אחרונה:</b> {details.errorText}</div> : null}
      </div></section>
      <section className="card"><h2>היסטוריית חיובים</h2>{(history.length ? history : studentTransactions).map((item, index) => <div key={item.id || index} className="payments-report-history-row"><b>{dateText(item.date || item.occurredAt)}</b> · {money(item.amount, item.currency || payment.currency)}<div className="muted">אסמכתא: {item.transactionId || item.externalId || "-"}</div></div>)}{!history.length && !studentTransactions.length ? <div className="muted">לא נמצאו חיובים.</div> : null}</section>
    </div>
  );
}
