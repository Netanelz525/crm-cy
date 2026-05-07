import Link from "next/link";
import { getEmailUnsubscribeInfo } from "../../../lib/email-campaigns";
import { clean } from "../../../lib/student-view";
import { confirmEmailUnsubscribeAction } from "./actions";

export default async function EmailUnsubscribePage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const deliveryId = clean(resolvedSearchParams?.delivery);
  const done = clean(resolvedSearchParams?.done) === "1";
  const error = clean(resolvedSearchParams?.error);
  const info = deliveryId ? await getEmailUnsubscribeInfo(deliveryId) : null;

  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ maxWidth: 720 }}>
        <div className="email-certainty-card">
          <p className="email-kicker">הסרה מרשימת תפוצה</p>
          <h1 style={{ marginTop: 0 }}>
            {done || info?.isUnsubscribed ? "הכתובת הוסרה בהצלחה" : "אישור הסרה מעדכוני הישיבה"}
          </h1>

          {!deliveryId || !info ? (
            <p className="muted">קישור ההסרה אינו תקין או שההודעה כבר לא זמינה.</p>
          ) : done || info.isUnsubscribed ? (
            <>
              <p className="muted">
                הכתובת <b>{info.recipient_email}</b> לא תקבל מאיתנו עדכונים נוספים עד להסרה ידנית מהרשימה השחורה.
              </p>
              <p className="muted">אם זו הייתה טעות, יש לפנות למשרד הישיבה כדי להחזיר את הכתובת לרשימת התפוצה.</p>
            </>
          ) : (
            <>
              <p className="muted">
                האם אתה בטוח שאינך מעונין לקבל עידכונים מהישיבה לכתובת <b>{info.recipient_email}</b>?
              </p>
              <p className="muted">נושא ההודעה האחרונה: {info.subject || "-"}</p>
            </>
          )}

          {error ? <div className="card muted">{error}</div> : null}

          {!deliveryId || !info || done || info.isUnsubscribed ? (
            <div className="quick-actions">
              <Link className="chip-link" href="/">חזרה לאתר</Link>
            </div>
          ) : (
            <form action={confirmEmailUnsubscribeAction} className="grid" style={{ marginTop: 12 }}>
              <input type="hidden" name="delivery" value={deliveryId} />
              <div className="quick-actions">
                <button type="submit">אשר הסרה</button>
                <Link className="chip-link" href="/">ביטול</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
