import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getDefaultPaymentDateRange,
  getPaymentProviderLabel,
  listPaymentConnections
} from "../../lib/payment-systems";
import { getCurrentAppUser, signInRedirectUrl } from "../../lib/rbac";
import { getResendConfigStatus } from "../../lib/resend";
import PaymentsReportClient from "./payments-report-client";
import PaymentMandatesReportClient from "./payment-mandates-report-client";
import PaymentFilterFormClient from "./payment-filter-form-client";
import { runPaymentStudentLinkingAction } from "./actions";
import { listExternalMandatesSafe } from "../../lib/external-mandates";

function clean(value) {
  return String(value || "").trim();
}

export default async function PaymentsPage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect(await signInRedirectUrl());
  if (!currentUser.is_team_member && !currentUser.is_manager && !currentUser.is_super_admin) {
    redirect("/unauthorized");
  }

  const resolvedSearchParams = await searchParams;
  const defaults = getDefaultPaymentDateRange();
  const reportType = clean(resolvedSearchParams?.reportType) === "mandates" ? "mandates" : "transactions";
  const mandateStatus = reportType === "mandates"
    ? (["active", "ending_soon", "issues", "completedNoRemaining", "external", "all"].includes(clean(resolvedSearchParams?.mandateStatus))
      ? clean(resolvedSearchParams?.mandateStatus)
      : "active")
    : "";
  const dateFrom = reportType === "mandates"
    ? ""
    : clean(resolvedSearchParams?.dateFrom) || defaults.dateFrom;
  const dateTo = reportType === "mandates"
    ? ""
    : clean(resolvedSearchParams?.dateTo) || defaults.dateTo;
  const notice = clean(resolvedSearchParams?.notice);
  const error = clean(resolvedSearchParams?.error);
  const linkingCompleted = clean(resolvedSearchParams?.linkingCompleted) === "1";
  const linkingError = clean(resolvedSearchParams?.linkingError);
  const shouldRunReport = clean(resolvedSearchParams?.run) === "1";
  const activeConnections = await listPaymentConnections({ activeOnly: true });
  const requestedConnectionIds = Array.isArray(resolvedSearchParams?.connectionId)
    ? resolvedSearchParams.connectionId.map(clean).filter(Boolean)
    : clean(resolvedSearchParams?.connectionId)
      ? [clean(resolvedSearchParams.connectionId)]
      : [];
  const selectedConnectionIds = requestedConnectionIds.length
    ? activeConnections.map((connection) => connection.id).filter((id) => requestedConnectionIds.includes(id))
    : activeConnections.map((connection) => connection.id);
  const activeProviders = [...new Set(activeConnections.map((connection) => connection.provider))].map((provider) => ({
    value: provider,
    label: getPaymentProviderLabel(provider)
  }));
  const defaultReplyTo = getResendConfigStatus().defaultReplyTo;
  const dashboard = shouldRunReport && activeConnections.length
    ? await (await import("../../lib/payment-systems"))[reportType === "mandates" ? "getPaymentMandatesDashboard" : "getPaymentDashboard"]({
        connectionIds: selectedConnectionIds,
        dateFrom,
        dateTo
      })
    : reportType === "mandates"
      ? { mandates: [], errors: [], connections: [], summary: { totalAmount: 0 } }
      : { transactions: [], errors: [], connections: [], summary: { totalAmount: 0, totalNetAmount: 0, totalFees: 0 } };
  const externalMandates = reportType === "mandates" ? await listExternalMandatesSafe() : [];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card glass">
        <h1 style={{ marginTop: 0 }}>מערכות תשלום</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          דוחות מאוחדים מכל המוסדות והחשבונות שחוברו למערכת, כולל עסקאות והוראות קבע מנדרים פלוס ו־Stripe.
        </p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/neon">חזרה לתלמידים</Link>
          {currentUser.is_super_admin ? (
            <Link className="quick-action-btn quick-action-outline" href="/admin/payments">ניהול חיבורים</Link>
          ) : null}
          <Link className="quick-action-btn quick-action-outline" href="/payments/linking">שיוך עסקאות לתלמידים</Link>
        </div>
      </section>

      {linkingCompleted ? <div className="ok">סריקת התשלומים לחודש {clean(resolvedSearchParams?.linkingMonth)} הסתיימה. בוצעו {clean(resolvedSearchParams?.linked) || "0"} שיוכים אוטומטיים.</div> : null}
      {linkingError ? <div className="error">{linkingError}</div> : null}
      {currentUser.is_super_admin ? (
        <details className="card">
          <summary><b>סריקה ושיוך תלמידים</b></summary>
          <form action={runPaymentStudentLinkingAction} className="quick-actions" style={{ marginTop: 12 }}>
            <label>חודש לסריקה <input type="month" name="periodMonth" defaultValue="2026-07" /></label>
            <button type="submit" className="quick-action-btn quick-action-primary">סרוק ושייך</button>
          </form>
          <p className="muted">שיוך אוטומטי יתבצע רק כאשר לפחות שניים מתוך תעודת זהות, אימייל וטלפון תואמים לתלמיד יחיד.</p>
        </details>
      ) : null}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>סינון הדוח</h2>
        {notice ? <div className="ok">{notice}</div> : null}
        {error ? <div className="error">{error}</div> : null}
        {!activeConnections.length ? (
          <div className="muted">
            אין כרגע חיבורי תשלום פעילים. רק סופר אדמין יכול להגדיר חיבורים חדשים תחת
            {" "}
            <Link href="/admin/payments">ניהול מערכות תשלום</Link>.
          </div>
        ) : (
          <PaymentFilterFormClient
            reportType={reportType}
            dateFrom={dateFrom}
            dateTo={dateTo}
            mandateStatus={mandateStatus}
            connections={activeConnections}
            selectedConnectionIds={selectedConnectionIds}
          />
        )}
      </section>

      {activeConnections.length && shouldRunReport ? (
        <>
          {dashboard.errors.length ? (
            <section className="card">
              <h3 style={{ marginTop: 0 }}>חיבורים שנכשלו</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {dashboard.errors.map((item) => (
                  <div key={`${item.connectionId}-${item.provider}`} className="card muted" style={{ padding: 12 }}>
                    <b>{item.connectionLabel || item.provider}</b>: {item.message}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {reportType === "mandates" ? (
            <PaymentMandatesReportClient
              dateFrom={dateFrom}
              dateTo={dateTo}
              initialMandateStatus={mandateStatus}
              mandates={dashboard.mandates}
              connections={dashboard.connections}
              providerOptions={activeProviders}
              initialSelectedConnectionIds={selectedConnectionIds}
              defaultReplyTo={defaultReplyTo}
              externalMandates={externalMandates}
            />
          ) : (
            <PaymentsReportClient
              dateFrom={dateFrom}
              dateTo={dateTo}
              transactions={dashboard.transactions}
              connections={dashboard.connections}
              providerOptions={activeProviders}
              initialSelectedConnectionIds={selectedConnectionIds}
            />
          )}
        </>
      ) : activeConnections.length ? (
        <section className="card muted">
          {reportType === "mandates"
            ? "הדוח לא נוצר עדיין. בחר מקורות תשלום ולחץ על הפקה כדי לראות את הוראות הקבע."
            : "הדוח לא נוצר עדיין. בחר טווח תאריכים ולחץ על `הפק דוח עסקאות` כדי לבצע את השליפה."}
        </section>
      ) : null}
    </div>
  );
}
