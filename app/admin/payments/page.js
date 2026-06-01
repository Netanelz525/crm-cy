import Link from "next/link";
import { listPaymentConnections, getPaymentProviderLabel } from "../../../lib/payment-systems";
import { requireSuperAdmin } from "../../../lib/rbac";
import PaymentConnectionActions from "./payment-connection-actions";
import {
  createNedarimConnectionAction,
  createStripeConnectionAction
} from "./actions";

function clean(value) {
  return String(value || "").trim();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("he-IL");
}

export default async function AdminPaymentsPage({ searchParams }) {
  await requireSuperAdmin();
  const resolvedSearchParams = await searchParams;
  const connections = await listPaymentConnections();
  const created = clean(resolvedSearchParams?.created) === "1";
  const updated = clean(resolvedSearchParams?.updated) === "1";
  const deleted = clean(resolvedSearchParams?.deleted) === "1";
  const statusChanged = clean(resolvedSearchParams?.statusChanged);
  const error = clean(resolvedSearchParams?.error);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card glass">
        <h1 style={{ marginTop: 0 }}>ניהול מערכות תשלום</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          כאן סופר אדמין מגדיר את חיבורי נדרים פלוס ו־Stripe שמהם המשתמשים יוכלו להפיק דוחות עסקאות.
        </p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/payments">מעבר לדוח העסקאות</Link>
          <Link className="quick-action-btn quick-action-outline" href="/admin">חזרה לניהול</Link>
        </div>
      </section>

      {created ? <div className="ok">החיבור נשמר בהצלחה.</div> : null}
      {updated ? <div className="ok">פרטי החיבור עודכנו בהצלחה.</div> : null}
      {deleted ? <div className="ok">החיבור נמחק לחלוטין מהמערכת.</div> : null}
      {statusChanged !== "" ? <div className="ok">{statusChanged === "1" ? "החיבור הופעל." : "החיבור הושבת."}</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>חיבור מוסד נדרים פלוס</h2>
          <form action={createNedarimConnectionAction} className="grid">
            <input name="label" placeholder="שם תצוגה למוסד" required />
            <input name="externalId" placeholder="MosadNumber / מזהה מוסד" required />
            <input name="secret" type="password" placeholder="ApiPassword" required />
            <button type="submit">שמור חיבור נדרים</button>
          </form>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>חיבור חשבון Stripe</h2>
          <form action={createStripeConnectionAction} className="grid">
            <input name="label" placeholder="שם תצוגה לחשבון" required />
            <input name="externalId" placeholder="מזהה אופציונלי / תיאור" />
            <input name="secret" type="password" placeholder="Stripe Secret Key" required />
            <button type="submit">שמור חיבור Stripe</button>
          </form>
        </section>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>חיבורים קיימים</h2>
        {!connections.length ? (
          <div className="muted">עדיין לא הוגדרו חיבורי תשלום.</div>
        ) : (
          <>
            <div className="desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>ספק</th>
                    <th>שם</th>
                    <th>מזהה</th>
                    <th>סטטוס</th>
                    <th>עודכן</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((connection) => (
                    <tr key={connection.id}>
                      <td>{getPaymentProviderLabel(connection.provider)}</td>
                      <td>{connection.label}</td>
                      <td>{connection.external_id || "-"}</td>
                      <td>{connection.is_active ? "פעיל" : "מושבת"}</td>
                      <td>{formatDateTime(connection.updated_at)}</td>
                      <td>
                        <PaymentConnectionActions connection={connection} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-generic-list">
              {connections.map((connection) => (
                <div key={connection.id} className="generic-mobile-card">
                  <div className="generic-mobile-head">{connection.label}</div>
                  <div className="generic-mobile-grid">
                    <div><b>ספק:</b> {getPaymentProviderLabel(connection.provider)}</div>
                    <div><b>מזהה:</b> {connection.external_id || "-"}</div>
                    <div><b>סטטוס:</b> {connection.is_active ? "פעיל" : "מושבת"}</div>
                    <div><b>עודכן:</b> {formatDateTime(connection.updated_at)}</div>
                  </div>
                  <PaymentConnectionActions connection={connection} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
