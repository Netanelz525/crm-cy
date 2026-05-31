import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getDefaultPaymentDateRange,
  getPaymentProviderLabel,
  listPaymentConnections
} from "../../lib/payment-systems";
import { getCurrentAppUser } from "../../lib/rbac";
import PaymentsReportClient from "./payments-report-client";

function clean(value) {
  return String(value || "").trim();
}

export default async function PaymentsPage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager && !currentUser.is_super_admin) {
    redirect("/unauthorized");
  }

  const resolvedSearchParams = await searchParams;
  const defaults = getDefaultPaymentDateRange();
  const dateFrom = clean(resolvedSearchParams?.dateFrom) || defaults.dateFrom;
  const dateTo = clean(resolvedSearchParams?.dateTo) || defaults.dateTo;
  const shouldRunReport = clean(resolvedSearchParams?.run) === "1";
  const activeConnections = await listPaymentConnections({ activeOnly: true });
  const activeProviders = [...new Set(activeConnections.map((connection) => connection.provider))].map((provider) => ({
    value: provider,
    label: getPaymentProviderLabel(provider)
  }));
  const dashboard = shouldRunReport && activeConnections.length
    ? await (await import("../../lib/payment-systems")).getPaymentDashboard({
        connectionIds: activeConnections.map((connection) => connection.id),
        dateFrom,
        dateTo
      })
    : { transactions: [], errors: [], connections: [], summary: { totalAmount: 0, totalNetAmount: 0, totalFees: 0 } };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card glass">
        <h1 style={{ marginTop: 0 }}>מערכות תשלום</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          דוח עסקאות מאוחד מכל המוסדות והחשבונות שחוברו למערכת, כולל נדרים פלוס ו־Stripe.
        </p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/neon">חזרה לתלמידים</Link>
          {currentUser.is_super_admin ? (
            <Link className="quick-action-btn quick-action-outline" href="/admin/payments">ניהול חיבורים</Link>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>סינון הדוח</h2>
        {!activeConnections.length ? (
          <div className="muted">
            אין כרגע חיבורי תשלום פעילים. רק סופר אדמין יכול להגדיר חיבורים חדשים תחת
            {" "}
            <Link href="/admin/payments">ניהול מערכות תשלום</Link>.
          </div>
        ) : (
          <form method="get" className="grid">
            <input type="hidden" name="run" value="1" />
            <input type="date" name="dateFrom" defaultValue={dateFrom} required />
            <input type="date" name="dateTo" defaultValue={dateTo} required />
            <button type="submit">הפק דוח עסקאות</button>
          </form>
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
          <PaymentsReportClient
            dateFrom={dateFrom}
            dateTo={dateTo}
            transactions={dashboard.transactions}
            connections={dashboard.connections}
            providerOptions={activeProviders}
          />
        </>
      ) : activeConnections.length ? (
        <section className="card muted">
          הדוח לא נוצר עדיין. בחר טווח תאריכים ולחץ על `הפק דוח עסקאות` כדי לבצע את השליפה.
        </section>
      ) : null}
    </div>
  );
}
