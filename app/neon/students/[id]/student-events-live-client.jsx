"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addStudentEventLiveAction, deleteStudentEventLiveAction, updateStudentEventLiveAction } from "../../student-live-actions";

const EVENT_TYPE_OPTIONS = [
  { value: "birthday", label: "יום הולדת" },
  { value: "wedding", label: "חתונה" },
  { value: "memorial", label: "יום זיכרון" },
  { value: "other", label: "אחר" }
];

const HEBREW_MONTH_OPTIONS = [
  { value: "TISHREI", label: "תשרי" },
  { value: "CHESHVAN", label: "חשוון" },
  { value: "KISLEV", label: "כסלו" },
  { value: "TEVET", label: "טבת" },
  { value: "SHVAT", label: "שבט" },
  { value: "ADAR_I", label: "אדר" },
  { value: "ADAR_II", label: "אדר ב׳" },
  { value: "NISAN", label: "ניסן" },
  { value: "IYYAR", label: "אייר" },
  { value: "SIVAN", label: "סיוון" },
  { value: "TAMUZ", label: "תמוז" },
  { value: "AV", label: "אב" },
  { value: "ELUL", label: "אלול" }
];

function clean(value) {
  return String(value || "").trim();
}

function dayLabel(daysUntil) {
  const normalized = Number(daysUntil);
  if (!Number.isFinite(normalized)) return "";
  if (normalized === 0) return "היום";
  if (normalized === 1) return "מחר";
  return `עוד ${normalized} ימים`;
}

export default function StudentEventsLiveClient({ studentId, initialEvents = [] }) {
  const [events, setEvents] = useState(Array.isArray(initialEvents) ? initialEvents : []);
  const [message, setMessage] = useState("");
  const [eventType, setEventType] = useState("birthday");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef(null);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => Number(a?.nextOccurrence?.daysUntil || 0) - Number(b?.nextOccurrence?.daysUntil || 0)),
    [events]
  );

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      studentId,
      eventType: clean(formData.get("eventType")),
      customEventLabel: clean(formData.get("customEventLabel")),
      noteText: clean(formData.get("noteText")),
      hebrewDay: clean(formData.get("hebrewDay")),
      hebrewMonthCode: clean(formData.get("hebrewMonthCode"))
    };
    setMessage("");

    startTransition(async () => {
      const result = await addStudentEventLiveAction(payload);
      if (!result?.ok || !result?.event?.id) {
        setMessage(result?.error || "שמירת האירוע נכשלה.");
        return;
      }
      setEvents((current) => {
        const next = [result.event, ...current];
        return next.sort((a, b) => Number(a?.nextOccurrence?.daysUntil || 0) - Number(b?.nextOccurrence?.daysUntil || 0));
      });
      formRef.current?.reset();
      setEventType("birthday");
      setMessage("האירוע נשמר.");
    });
  }

  function handleUpdateEvent(eventId, payload, options = {}) {
    setMessage("");
    startTransition(async () => {
      const result = await updateStudentEventLiveAction({ id: eventId, studentId, ...payload });
      if (!result?.ok || !result?.event?.id) {
        setMessage(result?.error || "עדכון האירוע נכשל.");
        return;
      }
      setEvents((current) => current
        .map((item) => (item.id === result.event.id ? result.event : item))
        .sort((a, b) => Number(a?.nextOccurrence?.daysUntil || 0) - Number(b?.nextOccurrence?.daysUntil || 0)));
      setMessage("האירוע עודכן.");
      options.onSuccess?.();
    });
  }

  function handleDeleteEvent(eventId, options = {}) {
    setMessage("");
    startTransition(async () => {
      const result = await deleteStudentEventLiveAction({ id: eventId, studentId });
      if (!result?.ok) {
        setMessage(result?.error || "מחיקת האירוע נכשלה.");
        return;
      }
      setEvents((current) => current.filter((item) => item.id !== eventId));
      setMessage("האירוע נמחק.");
      options.onSuccess?.();
    });
  }

  return (
    <details className="linked-record-group">
      <summary className="linked-record-group-summary">
        <div>
          <b>אירועים</b>
          <div className="linked-record-meta">יום הולדת, יום זיכרון, חתונה או כל אירוע מחזורי נוסף.</div>
        </div>
        <div className="linked-records-summary">
          <span className="linked-record-pill">רשומות: {sortedEvents.length}</span>
        </div>
      </summary>
      <div className="linked-record-group-body">
        <div className="linked-record-card event-card-highlight">
          <div className="linked-record-card-top">
            <b>אירועים לתלמיד</b>
            <span className="linked-record-pill">{sortedEvents.length} רשומות</span>
          </div>
          <div className="linked-record-meta">
            מנהלים כאן חתונה, יום הולדת, יום זיכרון או כל אירוע חופשי לפי תאריך עברי.
          </div>
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="grid">
          <select name="eventType" value={eventType} onChange={(event) => setEventType(event.target.value)} disabled={isPending}>
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            name="customEventLabel"
            placeholder="אם בחרת אחר, כתוב כאן"
            disabled={isPending || eventType !== "other"}
          />
          <textarea
            name="noteText"
            placeholder="הערה על האירוע"
            rows={3}
            disabled={isPending}
          />
          <select name="hebrewDay" defaultValue="1" disabled={isPending}>
            {Array.from({ length: 30 }, (_, index) => (
              <option key={index + 1} value={index + 1}>{index + 1}</option>
            ))}
          </select>
          <select name="hebrewMonthCode" defaultValue="TISHREI" disabled={isPending}>
            {HEBREW_MONTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button type="submit" disabled={isPending}>{isPending ? "שומר..." : "הוסף אירוע"}</button>
        </form>
        {message ? <div className={message.includes("נכש") ? "student-inline-feedback error" : "student-inline-feedback ok"}>{message}</div> : null}
        {!sortedEvents.length ? (
          <div className="linked-record-card placeholder">
            <b>אירועים</b>
            <div className="linked-record-meta">עדיין לא נוספו אירועים לתלמיד הזה.</div>
            <div className="linked-record-meta">לאחר הוספה, כאן יוצגו התאריך העברי והמועד הקרוב הבא.</div>
          </div>
        ) : (
          <div className="linked-records-grid">
            {sortedEvents.map((studentEvent) => (
              <StudentEventCard
                key={studentEvent.id}
                event={studentEvent}
                isPending={isPending}
                onUpdate={handleUpdateEvent}
                onDelete={handleDeleteEvent}
              />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function StudentEventCard({ event, isPending, onUpdate, onDelete }) {
  const [eventType, setEventType] = useState(event.eventType || "birthday");
  const detailsRef = useRef(null);

  function handleUpdate(eventSubmit) {
    eventSubmit.preventDefault();
    const formData = new FormData(eventSubmit.currentTarget);
    onUpdate(event.id, {
      eventType: clean(formData.get("eventType")),
      customEventLabel: clean(formData.get("customEventLabel")),
      noteText: clean(formData.get("noteText")),
      hebrewDay: clean(formData.get("hebrewDay")),
      hebrewMonthCode: clean(formData.get("hebrewMonthCode"))
    }, {
      onSuccess() {
        if (detailsRef.current) detailsRef.current.open = false;
      }
    });
  }

  function handleDeleteClick() {
    onDelete(event.id, {
      onSuccess() {
        if (detailsRef.current) detailsRef.current.open = false;
      }
    });
  }

  return (
    <div className="linked-record-card">
      <div className="linked-record-card-top">
        <div>
          <b>{event.eventLabel}</b>
          <div className="linked-record-meta">מועד קרוב: {event?.nextOccurrence?.gregorianDisplay || "-"}</div>
          {event?.nextOccurrence?.hebrewDateDisplay && event.nextOccurrence.hebrewDateDisplay !== event.hebrewDateLabel ? (
            <div className="linked-record-meta">התאריך בפועל השנה: {event.nextOccurrence.hebrewDateDisplay}</div>
          ) : null}
        </div>
        <div className="student-event-card-actions">
          <span className="linked-record-pill">{event.hebrewDateLabel}</span>
          <span className="linked-record-pill">{dayLabel(event?.nextOccurrence?.daysUntil) || "ללא חישוב"}</span>
        </div>
      </div>
      <div className="linked-record-meta">
        הערה: {event.noteText || "-"}
      </div>
      {event?.nextOccurrence?.adjustmentNote ? (
        <div className="linked-record-meta">
          התאמה שנתית: {event.nextOccurrence.adjustmentNote}
        </div>
      ) : null}
      <div className="linked-record-meta">
        נרשם על ידי: {event.createdByDisplayName || event.createdByEmail || "-"}
      </div>
      <details ref={detailsRef} className="student-event-edit-panel">
        <summary className="student-event-edit-trigger">עריכה ומחיקה</summary>
        <form onSubmit={handleUpdate} className="student-event-edit-form">
          <select name="eventType" value={eventType} onChange={(nextEvent) => setEventType(nextEvent.target.value)} disabled={isPending}>
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={`${event.id}-${option.value}`} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            name="customEventLabel"
            defaultValue={event.customEventLabel || ""}
            placeholder="אם בחרת אחר, כתוב כאן"
            disabled={isPending || eventType !== "other"}
          />
          <textarea name="noteText" defaultValue={event.noteText || ""} placeholder="הערה על האירוע" rows={3} disabled={isPending} />
          <div className="student-event-edit-grid">
            <select name="hebrewDay" defaultValue={String(event.hebrewDay || 1)} disabled={isPending}>
              {Array.from({ length: 30 }, (_, index) => (
                <option key={`${event.id}-day-${index + 1}`} value={index + 1}>{index + 1}</option>
              ))}
            </select>
            <select name="hebrewMonthCode" defaultValue={event.hebrewMonthCode || "TISHREI"} disabled={isPending}>
              {HEBREW_MONTH_OPTIONS.map((option) => (
                <option key={`${event.id}-${option.value}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="quick-actions" style={{ marginTop: 0 }}>
            <button type="submit" disabled={isPending}>{isPending ? "שומר..." : "שמור"}</button>
            <button type="button" className="btn btn-danger" onClick={handleDeleteClick} disabled={isPending}>מחק אירוע</button>
          </div>
        </form>
      </details>
    </div>
  );
}
