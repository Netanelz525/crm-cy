"use client";

import { useFormStatus } from "react-dom";

export default function FinalSendSubmitClient({ resendConfigured }) {
  const { pending } = useFormStatus();

  return (
    <div className="email-final-submit-wrap">
      {pending ? (
        <div className="email-final-submit-status">
          <b>המייל בשליחה כעת</b>
          <small>אנא המתן. אין צורך ללחוץ שוב, ולאחר השליחה תועבר אוטומטית למסך הראשי.</small>
        </div>
      ) : null}
      <button type="submit" disabled={!resendConfigured || pending}>
        {pending ? "שולח כעת דרך Resend..." : "אשר ושלח דרך Resend"}
      </button>
    </div>
  );
}
