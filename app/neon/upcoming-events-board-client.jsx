"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { deleteStudentEventLiveAction, updateStudentEventLiveAction } from "./student-live-actions";

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
  if (normalized === 0) return "האירוע חל היום";
  if (normalized === 1) return "האירוע חל מחר";
  return `האירוע בעוד ${normalized} ימים`;
}

export default function UpcomingEventsBoardClient({ initialEvents = [] }) {
  const [events, setEvents] = useState(Array.isArray(initialEvents) ? initialEvents : []);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => Number(a?.nextOccurrence?.daysUntil || 0) - Number(b?.nextOccurrence?.daysUntil || 0)),
    [events]
  );

  function handleUpdateEvent(eventId, payload, options = {}) {
    setMessage("");
    startTransition(async () => {
      const result = await updateStudentEventLiveAction({ id: eventId, studentId: payload.studentId, ...payload });
      if (!result?.ok || !result?.event?.id) {
        setMessage(result?.error || "עדכון האירוע נכשל.");
        return;
      }
      setEvents((current) => current
        .map((item) => (item.id === result.event.id ? { ...item, ...result.event } : item))
        .sort((a, b) => Number(a?.nextOccurrence?.daysUntil || 0) - Number(b?.nextOccurrence?.daysUntil || 0)));
      setMessage("האירוע עודכן.");
      options.onSuccess?.();
    });
  }

  function handleDeleteEvent(eventId, studentId, options = {}) {
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

  if (!sortedEvents.length) {
    return (
      <>
        {message ? <div className={message.includes("נכש") ? "student-inline-feedback error" : "student-inline-feedback ok"}>{message}</div> : null}
        <div className="linked-record-card placeholder">
          <b>עדיין אין אירועים קרובים</b>
          <div className="linked-record-meta">לא נמצאו אירועים מקושרים לטווח הקרוב.</div>
          <div className="linked-record-meta">לאחר שתוסיפו אירועים בכרטיסי תלמיד, הם יופיעו כאן אוטומטית.</div>
        </div>
      </>
    );
  }

  return (
    <>
      {message ? <div className={message.includes("נכש") ? "student-inline-feedback error" : "student-inline-feedback ok"}>{message}</div> : null}
      <div className="linked-records-grid">
        {sortedEvents.map((event) => (
          <UpcomingEventCard
            key={event.id}
            event={event}
            isPending={isPending}
            onUpdate={handleUpdateEvent}
            onDelete={handleDeleteEvent}
          />
        ))}
      </div>
    </>
  );
}

function UpcomingEventCard({ event, isPending, onUpdate, onDelete }) {
  const [eventType, setEventType] = useState(event.eventType || "birthday");
  const detailsRef = useRef(null);

  function handleUpdate(submitEvent) {
    submitEvent.preventDefault();
    const formData = new FormData(submitEvent.currentTarget);
    onUpdate(event.id, {
      studentId: event.studentId,
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
    onDelete(event.id, event.studentId, {
      onSuccess() {
        if (detailsRef.current) detailsRef.current.open = false;
      }
    });
  }

  return (
    <div className="linked-record-card event-board-card-static">
      <div className="linked-record-card-top">
        <b>{event.eventLabel}</b>
        <div className="student-event-card-actions">
          <span className="linked-record-pill">{event.hebrewDateLabel}</span>
          <details ref={detailsRef} className="student-document-rename">
            <summary title="ערוך אירוע">✎</summary>
            <form onSubmit={handleUpdate} className="student-document-rename-form student-event-edit-form">
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
              <div className="quick-actions" style={{ marginTop: 0 }}>
                <button type="submit" disabled={isPending}>{isPending ? "שומר..." : "שמור"}</button>
                <button type="button" className="btn btn-danger" onClick={handleDeleteClick} disabled={isPending}>מחק אירוע</button>
              </div>
            </form>
          </details>
        </div>
      </div>
      <Link className="linked-record-title" href={`/neon/students/${event.studentId}`}>{event.studentName || "ללא שם"}</Link>
      <div className="linked-record-meta">מועד קרוב: {event?.nextOccurrence?.gregorianDisplay || "-"}</div>
      <div className="linked-record-meta">{dayLabel(event?.nextOccurrence?.daysUntil)}</div>
      <div className="linked-record-meta">מוסד: {event.currentInstitution || "-"}</div>
      <div className="linked-record-meta">שיעור: {event.studentClass || "-"}</div>
      <div className="linked-record-meta">הערה: {event.noteText || "-"}</div>
    </div>
  );
}
