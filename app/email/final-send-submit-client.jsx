"use client";

import { useFormStatus } from "react-dom";

export default function FinalSendSubmitClient({ resendConfigured }) {
  const { pending } = useFormStatus();

  return (
    <div className="email-final-submit-wrap">
      {pending ? (
        <div className="email-final-submit-status">
          <b>המייל בשליחה כעת</b>
          <small>אין צורך להישאר בדף. המערכת תמשיך את שליחת המיילים ברקע גם אם תסגור את המסך.</small>
        </div>
      ) : null}
      <button type="submit" disabled={!resendConfigured || pending}>
        {pending ? "מתחיל שליחה ברקע..." : "אשר ושלח דרך Resend"}
      </button>
    </div>
  );
}
