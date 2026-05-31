import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getDefaultPaymentDateRange,
  getPaymentDashboard,
  getPaymentProviderLabel,
  listPaymentConnections
} from "../../lib/payment-systems";
import { getCurrentAppUser } from "../../lib/rbac";

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
  const requestedIds = []
    .concat(resolvedSearchParams?.connectionId || [])
    .map(clean)
    .filter(Boolean);
  const activeConnections = await listPaymentConnections({ activeOnly: true });
  const dashboard = await getPaymentDashboard({
    connectionIds: requestedIds,
    dateFrom,
    dateTo
  });
  const selectedIds = requestedIds.length ? requestedIds : activeConnections.map((connection) => connection.id);

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
            <input type="date" name="dateFrom" defaultValue={dateFrom} required />
            <input type="date" name="dateTo" defaultValue={dateTo} required />
            <div className="email-filter-chip-list">
              {activeConnections.map((connection) => (
                <label key={connection.id} className="email-filter-chip">
                  <input
                    className="email-filter-chip-input"
                    type="checkbox"
                    name="connectionId"
                    value={connection.id}
                    defaultChecked={selectedIds.includes(connection.id)}
                  />
                  <span>{connection.label} | {getPaymentProviderLabel(connection.provider)}</span>
                </label>
              ))}
            </div>
            <button type="submit">רענן דוח עסקאות</button>
          </form>
        )}
      </section>

      {activeConnections.length ? (
        <>
          <section className="card">
            <div className="summary-row">
              <div>
                <div className="muted">מקורות פעילים</div>
                <strong>{dashboard.summary.sourcesCount}</strong>
              </div>
              <div>
                <div className="muted">עסקאות</div>
                <strong>{dashboard.summary.transactionsCount}</strong>
              </div>
              <div>
                <div className="muted">סכום כולל</div>
                <strong>{formatMoney(dashboard.summary.totalAmount)}</strong>
              </div>
              <div>
                <div className="muted">נטו</div>
                <strong>{formatMoney(dashboard.summary.totalNetAmount)}</strong>
              </div>
              <div>
                <div className="muted">עמלות</div>
                <strong>{formatMoney(dashboard.summary.totalFees)}</strong>
              </div>
            </div>
          </section>

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

          <section className="card">
            <h2 style={{ marginTop: 0 }}>דוח עסקאות</h2>
            {!dashboard.transactions.length ? (
              <div className="muted">לא נמצאו עסקאות בטווח התאריכים שנבחר.</div>
            ) : (
              <>
                <div className="desktop-table">
                  <table>
                    <thead>
                      <tr>
                        <th>תאריך</th>
                        <th>מקור</th>
                        <th>ספק</th>
                        <th>סוג</th>
                        <th>סטטוס</th>
                        <th>אסמכתא</th>
                        <th>תיאור</th>
                        <th>ברוטו</th>
                        <th>נטו</th>
                        <th>עמלה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.transactions.map((transaction) => (
                        <tr key={`${transaction.provider}-${transaction.id}-${transaction.reference}`}>
                          <td>{formatDateTime(transaction.createdAt)}</td>
                          <td>{transaction.connectionLabel}</td>
                          <td>{transaction.providerLabel}</td>
                          <td>{transaction.type || "-"}</td>
                          <td>{transaction.status || "-"}</td>
                          <td>{transaction.reference || "-"}</td>
                          <td>{transaction.description || transaction.customerName || "-"}</td>
                          <td>{formatMoney(transaction.amount, transaction.currency)}</td>
                          <td>{formatMoney(transaction.netAmount, transaction.currency)}</td>
                          <td>{formatMoney(transaction.feeAmount, transaction.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mobile-generic-list">
                  {dashboard.transactions.map((transaction) => (
                    <div key={`${transaction.provider}-${transaction.id}-${transaction.reference}-mobile`} className="generic-mobile-card">
                      <div className="generic-mobile-head">{transaction.connectionLabel}</div>
                      <div className="generic-mobile-grid">
                        <div><b>תאריך:</b> {formatDateTime(transaction.createdAt)}</div>
                        <div><b>ספק:</b> {transaction.providerLabel}</div>
                        <div><b>סוג:</b> {transaction.type || "-"}</div>
                        <div><b>סטטוס:</b> {transaction.status || "-"}</div>
                        <div><b>אסמכתא:</b> {transaction.reference || "-"}</div>
                        <div><b>תיאור:</b> {transaction.description || transaction.customerName || "-"}</div>
                        <div><b>ברוטו:</b> {formatMoney(transaction.amount, transaction.currency)}</div>
                        <div><b>נטו:</b> {formatMoney(transaction.netAmount, transaction.currency)}</div>
                        <div><b>עמלה:</b> {formatMoney(transaction.feeAmount, transaction.currency)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
