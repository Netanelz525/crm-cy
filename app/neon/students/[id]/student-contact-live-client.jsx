"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addStudentContactLiveAction } from "../../student-live-actions";

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("he-IL");
}

function todayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export default function StudentContactLiveClient({ studentId, initialContactLogs = [] }) {
  const [contactLogs, setContactLogs] = useState(Array.isArray(initialContactLogs) ? initialContactLogs : []);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef(null);

  const latestContact = contactLogs[0] || null;
  const defaultContactDate = todayInputValue();
  const sortedLogs = useMemo(
    () => [...contactLogs].sort((a, b) => `${b.contactDate || ""}${b.createdAt || ""}`.localeCompare(`${a.contactDate || ""}${a.createdAt || ""}`)),
    [contactLogs]
  );

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const contactDate = clean(formData.get("contactDate"));
    const noteText = clean(formData.get("noteText"));
    setMessage("");

    startTransition(async () => {
      const result = await addStudentContactLiveAction({ studentId, contactDate, noteText });
      if (!result?.ok || !result?.contact?.id) {
        setMessage(result?.error || "שמירת יצירת הקשר נכשלה.");
        return;
      }
      setContactLogs((current) => [result.contact, ...current]);
      formRef.current?.reset();
      if (formRef.current?.elements?.namedItem("contactDate")) {
        formRef.current.elements.namedItem("contactDate").value = todayInputValue();
      }
      setMessage("יצירת הקשר נשמרה.");
    });
  }

  return (
    <details className="linked-record-group">
      <summary className="linked-record-group-summary">
        <div>
          <b>יצירת קשר</b>
          <div className="linked-record-meta">יומן שיחות ופניות לתלמיד.</div>
        </div>
        <div className="linked-records-summary">
          <span className="linked-record-pill">רשומות: {sortedLogs.length}</span>
          <span className="linked-record-pill">{latestContact ? formatDate(latestContact.contactDate) : "עדיין לא תועד"}</span>
        </div>
      </summary>
      <div className="linked-record-group-body">
        <div className="linked-record-card contact-log-card">
          <div className="linked-record-card-top">
            <b>יצירת קשר אחרונה</b>
            <span className="linked-record-pill">{latestContact ? formatDate(latestContact.contactDate) : "עדיין לא תועד"}</span>
          </div>
          <div className="linked-record-meta">{latestContact ? latestContact.noteText : "עדיין אין תיעוד יצירת קשר לתלמיד הזה."}</div>
          {latestContact?.createdByDisplayName || latestContact?.createdByEmail ? (
            <div className="linked-record-meta">תועד על ידי: {latestContact.createdByDisplayName || latestContact.createdByEmail}</div>
          ) : null}
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="grid">
          <input type="date" name="contactDate" defaultValue={defaultContactDate} disabled={isPending} />
          <input name="noteText" placeholder="תיעוד קצר של השיחה או יצירת הקשר" disabled={isPending} />
          <button type="submit" disabled={isPending}>{isPending ? "שומר..." : "הוסף יצירת קשר"}</button>
        </form>
        {message ? <div className={message.includes("נכש") ? "student-inline-feedback error" : "student-inline-feedback ok"}>{message}</div> : null}
        {!sortedLogs.length ? (
          <div className="linked-record-card placeholder">
            <b>יצירת קשר</b>
            <div className="linked-record-meta">עדיין לא תועדה יצירת קשר עם התלמיד.</div>
            <div className="linked-record-meta">כאן יופיעו התאריך והסיכום הקצר של כל שיחה או פניה.</div>
          </div>
        ) : (
          <div className="linked-records-grid">
            {sortedLogs.map((contact) => (
              <div key={contact.id} className="linked-record-card">
                <div className="linked-record-card-top">
                  <b>יצירת קשר</b>
                  <span className="linked-record-pill">{formatDate(contact.contactDate)}</span>
                </div>
                <div className="linked-record-meta">{contact.noteText || "-"}</div>
                <div className="linked-record-meta">תועד: {contact.createdByDisplayName || contact.createdByEmail || "-"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
