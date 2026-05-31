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

function sortTransactions(items, sortBy, sortDir) {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    let leftValue = "";
    let rightValue = "";

    if (sortBy === "amount") {
      leftValue = Number(left?.amount) || 0;
      rightValue = Number(right?.amount) || 0;
      return (leftValue - rightValue) * direction;
    }

    if (sortBy === "source") {
      leftValue = `${clean(left?.providerLabel)} ${clean(left?.connectionLabel)}`.toLowerCase();
      rightValue = `${clean(right?.providerLabel)} ${clean(right?.connectionLabel)}`.toLowerCase();
      return leftValue.localeCompare(rightValue, "he") * direction;
    }

    leftValue = Number(left?.createdAtUnix) || 0;
    rightValue = Number(right?.createdAtUnix) || 0;
    return (leftValue - rightValue) * direction;
  });
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
  const providerFilters = []
    .concat(resolvedSearchParams?.provider || [])
    .map(clean)
    .filter(Boolean);
  const requestedIds = []
    .concat(resolvedSearchParams?.connectionId || [])
    .map(clean)
    .filter(Boolean);
  const sortBy = clean(resolvedSearchParams?.sortBy) || "date";
  const sortDir = clean(resolvedSearchParams?.sortDir) || "desc";
  const activeConnections = await listPaymentConnections({ activeOnly: true });
  const activeProviders = [...new Set(activeConnections.map((connection) => connection.provider))];
  const selectedProviders = providerFilters.length ? providerFilters : activeProviders;
  const visibleConnections = activeConnections.filter((connection) => selectedProviders.includes(connection.provider));
  const dashboard = await getPaymentDashboard({
    connectionIds: requestedIds.length
      ? requestedIds
      : visibleConnections.map((connection) => connection.id),
    dateFrom,
    dateTo
  });
  const selectedIds = requestedIds.length ? requestedIds : visibleConnections.map((connection) => connection.id);
  const transactions = sortTransactions(dashboard.transactions, sortBy, sortDir);

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
            <select name="sortBy" defaultValue={sortBy}>
              <option value="date">מיון לפי תאריך</option>
              <option value="amount">מיון לפי סכום</option>
              <option value="source">מיון לפי מקור תשלום</option>
            </select>
            <select name="sortDir" defaultValue={sortDir}>
              <option value="desc">מהחדש לישן / מהגבוה לנמוך</option>
              <option value="asc">מהישן לחדש / מהנמוך לגבוה</option>
            </select>
            <div>
              <div className="muted" style={{ marginBottom: 8 }}>ספקי תשלום</div>
              <div className="email-filter-chip-list">
                {activeProviders.map((provider) => (
                  <label key={provider} className="email-filter-chip">
                    <input
                      className="email-filter-chip-input"
                      type="checkbox"
                      name="provider"
                      value={provider}
                      defaultChecked={selectedProviders.includes(provider)}
                    />
                    <span>{getPaymentProviderLabel(provider)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="muted" style={{ marginBottom: 8 }}>מקורות תשלום</div>
              <div className="email-filter-chip-list">
                {visibleConnections.map((connection) => (
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
                <strong>{dashboard.connections.length}</strong>
              </div>
              <div>
                <div className="muted">עסקאות</div>
                <strong>{transactions.length}</strong>
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
            {!transactions.length ? (
              <div className="muted">לא נמצאו עסקאות בטווח התאריכים שנבחר.</div>
            ) : (
              <div className="payments-report-list">
                {transactions.map((transaction) => (
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
      ) : null}
    </div>
  );
}
