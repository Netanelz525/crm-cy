"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export default function AttendanceEmailSendSubmit({ formAction }) {
  const { pending } = useFormStatus();
  const [sendRequested, setSendRequested] = useState(false);

  useEffect(() => {
    if (!pending) setSendRequested(false);
  }, [pending]);

  return (
    <div className="attendance-email-submit-wrap">
      {sendRequested && pending ? (
        <div className="attendance-email-submit-status">
          <b>השליחה התחילה</b>
          <small>אפשר לסגור את החלון. המערכת תמשיך את שליחת המיילים ברקע.</small>
        </div>
      ) : null}
      <button
        type="submit"
        formAction={formAction}
        className="quick-action-btn quick-action-primary"
        disabled={pending}
        onClick={() => setSendRequested(true)}
      >
        {sendRequested && pending ? "מתחיל שליחה ברקע..." : "שלח מיילים למפגש"}
      </button>
    </div>
  );
}
