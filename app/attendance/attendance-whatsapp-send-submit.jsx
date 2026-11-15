"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export default function AttendanceWhatsAppSendSubmit({ formAction, children = "שלח WhatsApp למפגש" }) {
  const { pending } = useFormStatus();
  const locked = useRef(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!pending) {
      locked.current = false;
      setRequested(false);
    }
  }, [pending]);

  function send(event) {
    if (pending || locked.current) {
      event.preventDefault();
      return;
    }
    if (!event.currentTarget.form?.checkValidity()) return;
    locked.current = true;
    setRequested(true);
  }

  return <div className="attendance-email-submit-wrap" aria-busy={requested && pending}>
    {requested ? <div className="attendance-email-submit-status" role="status" aria-live="polite">
      <b>שליחת ה־WhatsApp מתבצעת כעת…</b>
      <small>אין ללחוץ שוב או לרענן. יש להמתין לאישור השליחה שיופיע במסך.</small>
    </div> : null}
    <button type="submit" formAction={formAction} className="quick-action-btn quick-action-primary" disabled={pending} onClick={send}>
      {requested ? "שולח WhatsApp — נא להמתין…" : children}
    </button>
  </div>;
}
