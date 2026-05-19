"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addStudentEventLiveAction } from "../../student-live-actions";

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

  return (
    <>
      <div className="linked-record-card event-card-highlight">
        <div className="linked-record-card-top">
          <b>אירועים לתלמיד</b>
          <span className="linked-record-pill">{sortedEvents.length} רשומות</span>
        </div>
        <div className="linked-record-meta">
          מנהלים כאן חתונה, יום הולדת, יום זיכרון או כל אירוע חופשי לפי תאריך עברי.
        </div>
      </div>
      <form ref={formRef} onSubmit={handleSubmit} className="grid" style={{ marginBottom: 12 }}>
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
        sortedEvents.map((studentEvent) => (
          <div key={studentEvent.id} className="linked-record-card">
            <div className="linked-record-card-top">
              <b>{studentEvent.eventLabel}</b>
              <span className="linked-record-pill">{studentEvent.hebrewDateLabel}</span>
            </div>
            <div className="linked-record-meta">
              מועד קרוב: {studentEvent?.nextOccurrence?.gregorianDisplay || "-"}
            </div>
            <div className="linked-record-meta">
              תזמון: {dayLabel(studentEvent?.nextOccurrence?.daysUntil) || "ללא חישוב"}
            </div>
            <div className="linked-record-meta">
              נרשם על ידי: {studentEvent.createdByDisplayName || studentEvent.createdByEmail || "-"}
            </div>
          </div>
        ))
      )}
    </>
  );
}
