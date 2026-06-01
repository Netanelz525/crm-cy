"use client";

import { useActionState } from "react";
import {
  deletePaymentConnectionAction,
  testPaymentConnectionAction,
  togglePaymentConnectionAction,
  updatePaymentConnectionAction
} from "./actions";

const initialTestState = {
  ok: false,
  message: ""
};

function TestConnectionButton({ connectionId }) {
  const [state, formAction, pending] = useActionState(testPaymentConnectionAction, initialTestState);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <form action={formAction}>
        <input type="hidden" name="connectionId" value={connectionId} />
        <button type="submit" className="quick-action-btn quick-action-outline" disabled={pending}>
          {pending ? "בודק חיבור..." : "בדוק חיבור"}
        </button>
      </form>
      {state?.message ? (
        <div className={state.ok ? "ok" : "card muted"} style={{ margin: 0 }}>
          {state.message}
        </div>
      ) : null}
    </div>
  );
}

export default function PaymentConnectionActions({ connection }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <form action={updatePaymentConnectionAction} className="grid" style={{ gap: 8 }}>
        <input type="hidden" name="connectionId" value={connection.id} />
        <input name="label" defaultValue={connection.label} placeholder="שם חיבור" required />
        <input
          name="externalId"
          defaultValue={connection.external_id}
          placeholder={connection.provider === "nederim" ? "MosadNumber / מזהה מוסד" : "מזהה אופציונלי / תיאור"}
        />
        <input
          name="secret"
          type="password"
          placeholder={connection.provider === "nederim" ? "ApiPassword חדש אם השתנה" : "Stripe Secret Key חדש אם השתנה"}
        />
        <button type="submit">עדכן חיבור</button>
      </form>
      <div className="quick-actions" style={{ marginTop: 0 }}>
        <TestConnectionButton connectionId={connection.id} />
        <form action={togglePaymentConnectionAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <input type="hidden" name="active" value={connection.is_active ? "0" : "1"} />
          <button type="submit" className="quick-action-btn quick-action-outline">
            {connection.is_active ? "השבת חיבור" : "הפעל חיבור"}
          </button>
        </form>
        <form action={deletePaymentConnectionAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <button type="submit" className="quick-action-btn" style={{ background: "#991b1b" }}>
            מחק חיבור
          </button>
        </form>
      </div>
    </div>
  );
}
