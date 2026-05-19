"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { ENUM_LABELS } from "../../lib/student-fields";
import { getStudentTagTheme } from "../../lib/student-tag-theme";
import { ageOf, buildMissingState, classLabel, clean, columnText, FIELD_DEF_MAP, getByPath, phoneHref, phoneText } from "../../lib/student-view";
import { addStudentContactLiveAction, addStudentEventLiveAction, addStudentTagLiveAction, bulkUpdateStudentsLiveAction, removeStudentTagLiveAction } from "./student-live-actions";
import { bulkDeleteNeonStudentsAction } from "./actions";

function PhoneLink({ phoneObj }) {
  const text = phoneText(phoneObj);
  if (text === "-") return "-";
  const href = phoneHref(phoneObj);
  if (!href) return text;
  return <a href={href}>{text}</a>;
}

function fieldPhoneHref(student, fieldKey) {
  const fieldDef = FIELD_DEF_MAP[fieldKey];
  if (!fieldDef || !fieldDef.key.endsWith(".primaryPhoneNumber")) return "";
  const phoneRoot = fieldDef.key.slice(0, -".primaryPhoneNumber".length);
  return phoneHref({
    primaryPhoneNumber: getByPath(student, fieldDef.key),
    primaryPhoneCallingCode: getByPath(student, `${phoneRoot}.primaryPhoneCallingCode`)
  });
}

function columnNode(student, columnKey) {
  if (columnKey.startsWith("field:")) {
    const fieldKey = columnKey.slice("field:".length);
    const value = columnText(student, columnKey);
    if (value === "-") return "-";
    const fieldDef = FIELD_DEF_MAP[fieldKey];
    if (fieldDef?.key.endsWith(".primaryPhoneNumber")) {
      const href = fieldPhoneHref(student, fieldKey);
      return href ? <a href={href}>{value}</a> : value;
    }
    if (fieldDef?.key.endsWith(".primaryEmail")) {
      const email = clean(getByPath(student, fieldKey));
      return email ? <a href={`mailto:${email}`}>{email}</a> : value;
    }
    return value;
  }

  switch (columnKey) {
    case "name":
      return <Link className="student-link" href={`/neon/students/${student.id}`}>{clean(student?.label) || "-"}</Link>;
    case "studentPhone":
      return <PhoneLink phoneObj={student?.phone} />;
    case "dadPhone":
      return <PhoneLink phoneObj={student?.dadPhone} />;
    case "momPhone":
      return <PhoneLink phoneObj={student?.momPhone} />;
    case "studentEmail": {
      const email = clean(student?.email?.primaryEmail);
      return email ? <a href={`mailto:${email}`}>{email}</a> : "-";
    }
    case "fatherEmail": {
      const email = clean(student?.fatherEmail?.primaryEmail);
      return email ? <a href={`mailto:${email}`}>{email}</a> : "-";
    }
    case "motherEmail": {
      const email = clean(student?.motherEmail?.primaryEmail);
      return email ? <a href={`mailto:${email}`}>{email}</a> : "-";
    }
    default:
      return columnText(student, columnKey);
  }
}

function BulkField({ name, label, children }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="bulk-field-card">
      <label className="bulk-field-toggle">
        <input type="checkbox" name={`apply_${name}`} value="1" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>{label}</span>
      </label>
      <div className={enabled ? "bulk-field-body" : "bulk-field-body disabled"}>{children(enabled)}</div>
    </div>
  );
}

function BulkSubmitBar({ selectedCount, onClose }) {
  const { pending } = useFormStatus();

  return (
    <div className={`bulk-submit-shell${pending ? " pending" : ""}`}>
      <div className="bulk-submit-copy">
        <strong>בחירת השדות לעדכון</strong>
        <div className="muted">
          {pending
            ? `מעדכן עכשיו ${selectedCount} רשומות. אפשר להמתין בחלון הזה עד להשלמת השמירה.`
            : `לאחר הלחיצה יוחל עדכון זהה על ${selectedCount} רשומות שנבחרו בתצוגה.`}
        </div>
      </div>
      {pending ? (
        <div className="bulk-progress-shell" aria-hidden="true">
          <div className="bulk-progress-bar" />
        </div>
      ) : null}
      <div className="quick-actions bulk-submit-actions">
        <button type="button" className="btn btn-ghost bulk-cancel-btn" onClick={onClose} disabled={pending}>
          ביטול
        </button>
        <button type="submit" disabled={pending}>
          {pending ? `מעדכן ${selectedCount} רשומות...` : `החל עדכון על ${selectedCount} רשומות`}
        </button>
      </div>
    </div>
  );
}

const BULK_FIELDS = [
  "currentInstitution",
  "registration",
  "class",
  "famliystatus",
  "healthInsurance",
  "childrenCount",
  "note"
];

function scoreClassName(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "score-neutral";
  if (value >= 0.85) return "score-high";
  if (value >= 0.65) return "score-medium";
  return "score-low";
}

function MatchScoreBadge({ score }) {
  const value = Number(score);
  if (!Number.isFinite(value)) return <span className="match-score-pill score-neutral">-</span>;
  return <span className={`match-score-pill ${scoreClassName(value)}`}>{Math.round(value * 100)}%</span>;
}

function formatDateValue(value) {
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

function eventOffsetLabel(daysUntil) {
  const normalized = Number(daysUntil);
  if (!Number.isFinite(normalized)) return "";
  if (normalized === 0) return "היום";
  if (normalized === 1) return "מחר";
  return `עוד ${normalized} ימים`;
}

function StudentTagSummary({ student, onRemoveTag, disabled = false }) {
  const tags = Array.isArray(student?.tags) ? student.tags : [];
  if (!tags.length) return null;
  return (
    <div className="student-card-tag-row">
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className="student-tag-chip-button"
          title={`הסר תווית ${tag.name}`}
          onClick={() => onRemoveTag(student.id, tag.id)}
          disabled={disabled}
        >
          <span style={getStudentTagTheme(tag)}>{tag.name}</span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  );
}

function TagActionButton({ student, availableTags, onAddTag, disabled = false }) {
  const tags = Array.isArray(student?.tags) ? student.tags : [];
  const assignedIds = new Set(tags.map((tag) => tag.id));
  const selectableTags = availableTags.filter((tag) => !assignedIds.has(tag.id));
  const detailsRef = useRef(null);
  const formRef = useRef(null);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    onAddTag(student.id, {
      tagId: clean(formData.get("tagId")),
      newTagName: clean(formData.get("newTagName"))
    }, {
      onSuccess() {
        formRef.current?.reset();
        if (detailsRef.current) detailsRef.current.open = false;
      }
    });
  }

  return (
    <details ref={detailsRef} className="student-tag-quick-panel">
      <summary className="chip-link student-tag-quick-trigger">הוספת תווית</summary>
      <div className="student-tag-quick-body">
        {tags.length ? <div className="muted">תוויות משויכות: {tags.map((tag) => tag.name).join(", ")}</div> : <div className="muted">אין עדיין תוויות לתלמיד הזה.</div>}
        <form ref={formRef} onSubmit={handleSubmit} className="student-tag-quick-form">
          <select name="tagId" defaultValue="" disabled={disabled}>
            <option value="">בחר תווית קיימת</option>
            {selectableTags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
          <input name="newTagName" placeholder="או צור תווית חדשה" disabled={disabled} />
          <button type="submit" disabled={disabled}>{disabled ? "שומר..." : "שמור תווית"}</button>
        </form>
      </div>
    </details>
  );
}

function ContactActionButton({ student, onAddContact, disabled = false }) {
  const latestContact = student?.latestContact || null;
  const defaultDate = todayInputValue();
  const detailsRef = useRef(null);
  const formRef = useRef(null);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    onAddContact(student.id, {
      contactDate: clean(formData.get("contactDate")),
      noteText: clean(formData.get("noteText"))
    }, {
      onSuccess() {
        formRef.current?.reset();
        if (formRef.current?.elements?.namedItem("contactDate")) {
          formRef.current.elements.namedItem("contactDate").value = todayInputValue();
        }
        if (detailsRef.current) detailsRef.current.open = false;
      }
    });
  }

  return (
    <details ref={detailsRef} className="student-tag-quick-panel">
      <summary className="chip-link student-tag-quick-trigger">יצירת קשר</summary>
      <div className="student-tag-quick-body">
        <div className="muted">
          {latestContact
            ? `שיחה אחרונה: ${formatDateValue(latestContact.contactDate)} | ${latestContact.noteText || "-"}`
            : "עדיין לא תועדה יצירת קשר."}
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="student-tag-quick-form">
          <input type="date" name="contactDate" defaultValue={defaultDate} disabled={disabled} />
          <input name="noteText" placeholder="תיעוד קצר של יצירת הקשר" disabled={disabled} />
          <button type="submit" disabled={disabled}>{disabled ? "שומר..." : "שמור יצירת קשר"}</button>
        </form>
      </div>
    </details>
  );
}

function EventActionButton({ student, onAddEvent, disabled = false }) {
  const upcomingEvent = student?.upcomingEvent || null;
  const detailsRef = useRef(null);
  const formRef = useRef(null);
  const [eventType, setEventType] = useState("birthday");

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    onAddEvent(student.id, {
      eventType: clean(formData.get("eventType")),
      customEventLabel: clean(formData.get("customEventLabel")),
      noteText: clean(formData.get("noteText")),
      hebrewDay: clean(formData.get("hebrewDay")),
      hebrewMonthCode: clean(formData.get("hebrewMonthCode"))
    }, {
      onSuccess() {
        formRef.current?.reset();
        setEventType("birthday");
        if (detailsRef.current) detailsRef.current.open = false;
      }
    });
  }

  return (
    <details ref={detailsRef} className="student-tag-quick-panel">
      <summary className="chip-link student-tag-quick-trigger">הוסף אירוע</summary>
      <div className="student-tag-quick-body">
        <div className="muted">
          {upcomingEvent
            ? `הקרוב ביותר: ${upcomingEvent.eventLabel} | ${upcomingEvent.hebrewDateLabel} | ${eventOffsetLabel(upcomingEvent?.nextOccurrence?.daysUntil)}`
            : "עדיין לא הוגדר אירוע לתלמיד הזה."}
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="student-tag-quick-form">
          <select name="eventType" value={eventType} onChange={(event) => setEventType(event.target.value)} disabled={disabled}>
            <option value="birthday">יום הולדת</option>
            <option value="wedding">חתונה</option>
            <option value="memorial">יום זיכרון</option>
            <option value="other">אחר</option>
          </select>
          <input name="customEventLabel" placeholder="אם בחרת אחר, כתוב כאן" disabled={disabled || eventType !== "other"} />
          <textarea name="noteText" placeholder="הערה על האירוע" rows={3} disabled={disabled} />
          <select name="hebrewDay" defaultValue="1" disabled={disabled}>
            {Array.from({ length: 30 }, (_, index) => (
              <option key={index + 1} value={index + 1}>{index + 1}</option>
            ))}
          </select>
          <select name="hebrewMonthCode" defaultValue="TISHREI" disabled={disabled}>
            <option value="TISHREI">תשרי</option>
            <option value="CHESHVAN">חשוון</option>
            <option value="KISLEV">כסלו</option>
            <option value="TEVET">טבת</option>
            <option value="SHVAT">שבט</option>
            <option value="ADAR_I">אדר</option>
            <option value="ADAR_II">אדר ב׳</option>
            <option value="NISAN">ניסן</option>
            <option value="IYYAR">אייר</option>
            <option value="SIVAN">סיוון</option>
            <option value="TAMUZ">תמוז</option>
            <option value="AV">אב</option>
            <option value="ELUL">אלול</option>
          </select>
          <button type="submit" disabled={disabled}>{disabled ? "שומר..." : "שמור אירוע"}</button>
        </form>
      </div>
    </details>
  );
}

export default function BulkStudentsClient({ students, selectedColumns, showInstitutionView, showMatchScores = false, returnTo, availableTags = [] }) {
  const [studentRows, setStudentRows] = useState(Array.isArray(students) ? students : []);
  const [tagOptions, setTagOptions] = useState(Array.isArray(availableTags) ? availableTags : []);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = studentRows.length > 0 && studentRows.every((student) => selectedSet.has(student.id));

  function updateStudentRow(studentId, updater) {
    setStudentRows((current) => current.map((student) => (
      student.id === studentId ? updater(student) : student
    )));
  }

  function sortTags(list) {
    return [...list].sort((a, b) => clean(a?.name).localeCompare(clean(b?.name), "he"));
  }

  function handleRemoveTag(studentId, tagId) {
    setFeedback("");
    startTransition(async () => {
      const result = await removeStudentTagLiveAction({ studentId, tagId });
      if (!result?.ok) {
        setFeedback(result?.error || "הסרת התווית נכשלה.");
        return;
      }
      updateStudentRow(studentId, (student) => {
        const nextTags = (student.tags || []).filter((tag) => tag.id !== tagId);
        return {
          ...student,
          tags: nextTags,
          tagIds: nextTags.map((tag) => tag.id),
          tagNames: nextTags.map((tag) => tag.name)
        };
      });
    });
  }

  function handleAddTag(studentId, payload, options = {}) {
    setFeedback("");
    startTransition(async () => {
      const result = await addStudentTagLiveAction({ studentId, ...payload });
      if (!result?.ok || !result?.tag?.id) {
        setFeedback(result?.error || "שמירת התווית נכשלה.");
        return;
      }
      setTagOptions((current) => current.some((tag) => tag.id === result.tag.id) ? current : sortTags([...current, result.tag]));
      updateStudentRow(studentId, (student) => {
        if ((student.tags || []).some((tag) => tag.id === result.tag.id)) return student;
        const nextTags = sortTags([...(student.tags || []), result.tag]);
        return {
          ...student,
          tags: nextTags,
          tagIds: nextTags.map((tag) => tag.id),
          tagNames: nextTags.map((tag) => tag.name)
        };
      });
      options.onSuccess?.();
    });
  }

  function handleAddContact(studentId, payload, options = {}) {
    setFeedback("");
    startTransition(async () => {
      const result = await addStudentContactLiveAction({ studentId, ...payload });
      if (!result?.ok || !result?.contact?.id) {
        setFeedback(result?.error || "שמירת יצירת הקשר נכשלה.");
        return;
      }
      updateStudentRow(studentId, (student) => ({
        ...student,
        latestContact: result.contact
      }));
      options.onSuccess?.();
    });
  }

  function handleAddEvent(studentId, payload, options = {}) {
    setFeedback("");
    startTransition(async () => {
      const result = await addStudentEventLiveAction({ studentId, ...payload });
      if (!result?.ok || !result?.event?.id) {
        setFeedback(result?.error || "שמירת האירוע נכשלה.");
        return;
      }
      updateStudentRow(studentId, (student) => {
        const currentUpcoming = student?.upcomingEvent || null;
        const nextEvent = result.event;
        const shouldReplace = !currentUpcoming
          || Number(nextEvent?.nextOccurrence?.daysUntil ?? Number.POSITIVE_INFINITY)
            <= Number(currentUpcoming?.nextOccurrence?.daysUntil ?? Number.POSITIVE_INFINITY);
        return {
          ...student,
          upcomingEvent: shouldReplace ? nextEvent : currentUpcoming
        };
      });
      options.onSuccess?.();
    });
  }

  function toggleStudent(studentId, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(studentId);
      else next.delete(studentId);
      return Array.from(next);
    });
  }

  function toggleAll(checked) {
    setSelectedIds(checked ? studentRows.map((student) => student.id) : []);
  }

  function closeBulk() {
    setBulkOpen(false);
  }

  function closeDelete() {
    setDeleteOpen(false);
  }

  const emailHref = useMemo(() => {
    const params = new URLSearchParams();
    const rawQuery = clean(returnTo).split("?")[1] || "";
    const existing = new URLSearchParams(rawQuery);
    for (const [key, value] of existing.entries()) {
      if (key === "mode") continue;
      params.append(key, value);
    }
    params.set("compose", "1");
    params.set("recipientMode", "parents");
    selectedIds.forEach((id) => params.append("studentIds", id));
    return `/email?${params.toString()}`;
  }, [returnTo, selectedIds]);

  function handleBulkSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const fields = {};
    for (const field of BULK_FIELDS) {
      if (clean(formData.get(`apply_${field}`)) !== "1") continue;
      fields[field] = formData.get(field);
    }

    const bulkTagEnabled = clean(formData.get("apply_bulkTag")) === "1";
    const bulkTagId = clean(formData.get("bulkTagId"));
    const bulkNewTagName = clean(formData.get("bulkNewTagName"));

    setFeedback("");
    startTransition(async () => {
      const result = await bulkUpdateStudentsLiveAction({
        studentIds: selectedIds,
        fields,
        bulkTagId: bulkTagEnabled ? bulkTagId : "",
        bulkNewTagName: bulkTagEnabled ? bulkNewTagName : ""
      });

      if (!result?.ok) {
        setFeedback(result?.error || "העדכון המרוכז נכשל.");
        return;
      }

      if (result.tag?.id) {
        setTagOptions((current) => current.some((tag) => tag.id === result.tag.id) ? current : sortTags([...current, result.tag]));
      }

      setStudentRows((current) => current.map((student) => {
        if (!selectedIds.includes(student.id)) return student;
        let nextStudent = {
          ...student,
          ...result.fields
        };

        if (result.tag?.id && !(student.tags || []).some((tag) => tag.id === result.tag.id)) {
          const nextTags = sortTags([...(student.tags || []), result.tag]);
          nextStudent = {
            ...nextStudent,
            tags: nextTags,
            tagIds: nextTags.map((tag) => tag.id),
            tagNames: nextTags.map((tag) => tag.name)
          };
        }

        return nextStudent;
      }));

      const summary = result.failed
        ? `העדכון הוחל על ${result.updated} רשומות, ${result.failed} נכשלו.`
        : `העדכון הוחל על ${result.updated} רשומות.`;
      setFeedback(summary);
      setBulkOpen(false);
    });
  }

  return (
    <>
      {students.length ? (
        <div className="card bulk-toolbar">
          <div className="bulk-toolbar-copy">
            <strong>פעולות מרוכזות על התצוגה הנוכחית</strong>
            <div className="muted">נבחרו לעדכון מרוכז: <b>{selectedIds.length}</b> מתוך <b>{studentRows.length}</b> רשומות בתצוגה</div>
            {feedback ? <div className="student-inline-feedback">{feedback}</div> : null}
          </div>
          <div className="quick-actions bulk-toolbar-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-primary bulk-primary-btn" onClick={() => setSelectedIds(studentRows.map((student) => student.id))}>
              בחר את כל {studentRows.length} הרשומות בתצוגה
            </button>
            <Link className="btn btn-ghost bulk-open-btn" href={emailHref} aria-disabled={!selectedIds.length} onClick={(event) => {
              if (!selectedIds.length) event.preventDefault();
            }}>
              עבור לשליחת מייל
            </Link>
            <button type="button" className="btn btn-ghost bulk-open-btn" disabled={!selectedIds.length} onClick={() => setBulkOpen(true)}>
              המשך לבחירת השדות לעדכון
            </button>
            <button type="button" className="btn btn-danger bulk-open-btn" disabled={!selectedIds.length} onClick={() => setDeleteOpen(true)}>
              מחק {selectedIds.length || ""} תלמידים
            </button>
            <button type="button" className="chip-link bulk-trigger-btn" disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>
              נקה בחירה
            </button>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="bulk-modal-backdrop" onClick={closeDelete}>
          <div className="bulk-modal" onClick={(event) => event.stopPropagation()}>
            <div className="student-topbar">
              <div>
                <h3>מחיקה מרוכזת לתלמידים נבחרים</h3>
                <p className="muted">התלמידים יועברו לאזור מחיקה זמני ל-30 יום ויוסתרו מיד מכל הרשימות.</p>
              </div>
              <button type="button" className="bulk-close-btn" onClick={closeDelete} aria-label="סגור חלון מחיקה">
                ✕
              </button>
            </div>
            <form action={bulkDeleteNeonStudentsAction} className="bulk-form-grid">
              {selectedIds.map((id) => (
                <input key={`delete-${id}`} type="hidden" name="studentIds" value={id} />
              ))}
              <label className="bulk-field-toggle">
                <input type="checkbox" name="confirmDelete" value="1" />
                <span>{`אני מאשר מחיקה של ${selectedIds.length} תלמידים`}</span>
              </label>
              <input name="confirmationText" placeholder='הקלד "אני מאשר"' />
              <div className="quick-actions bulk-submit-actions">
                <button type="button" className="btn btn-ghost bulk-cancel-btn" onClick={closeDelete}>
                  ביטול
                </button>
                <button type="submit" className="btn btn-danger">אשר מחיקה מרוכזת</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {bulkOpen ? (
        <div className="bulk-modal-backdrop" onClick={closeBulk}>
          <div className="bulk-modal" onClick={(event) => event.stopPropagation()}>
            <div className="student-topbar">
              <div>
                <h3>עדכון מרוכז לתלמידים נבחרים</h3>
                <p className="muted">העדכון יחול על {selectedIds.length} רשומות. סמן רק את השדות שברצונך להחיל על כולן.</p>
              </div>
              <button type="button" className="bulk-close-btn" onClick={closeBulk} aria-label="סגור חלון עדכון שדות">
                ✕
              </button>
            </div>
            <form onSubmit={handleBulkSubmit} className="bulk-form-grid">
              <input type="hidden" name="returnTo" value={returnTo || "/neon"} />
              {selectedIds.map((id) => (
                <input key={id} type="hidden" name="studentIds" value={id} />
              ))}
              <BulkField name="currentInstitution" label="מוסד">
                {(enabled) => (
                  <select name="currentInstitution" disabled={!enabled} defaultValue="">
                    <option value="">בחר מוסד</option>
                    {Object.entries(ENUM_LABELS.currentInstitution || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="class" label="שיעור">
                {(enabled) => (
                  <select name="class" disabled={!enabled} defaultValue="">
                    <option value="">בחר שיעור</option>
                    {Object.entries(ENUM_LABELS.class || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="registration" label="רישום">
                {(enabled) => (
                  <select name="registration" disabled={!enabled} defaultValue="">
                    <option value="">בחר רישום</option>
                    {Object.entries(ENUM_LABELS.registration || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="famliystatus" label="סטטוס משפחתי">
                {(enabled) => (
                  <select name="famliystatus" disabled={!enabled} defaultValue="">
                    <option value="">בחר סטטוס</option>
                    {Object.entries(ENUM_LABELS.familystatus || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="healthInsurance" label="קופת חולים">
                {(enabled) => (
                  <select name="healthInsurance" disabled={!enabled} defaultValue="">
                    <option value="">בחר קופה</option>
                    {Object.entries(ENUM_LABELS.healthInsurance || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="childrenCount" label="מספר ילדים">
                {(enabled) => (
                  <input type="number" min="0" step="1" name="childrenCount" disabled={!enabled} />
                )}
              </BulkField>
              <BulkField name="note" label="הערה">
                {(enabled) => (
                  <textarea name="note" disabled={!enabled} placeholder="הערה שתתווסף לכל הרשומות שנבחרו" />
                )}
              </BulkField>
              <BulkField name="bulkTag" label="הוספת תווית">
                {(enabled) => (
                  <>
                    <select name="bulkTagId" disabled={!enabled} defaultValue="">
                      <option value="">בחר תווית קיימת</option>
                      {tagOptions.map((tag) => (
                        <option key={tag.id} value={tag.id}>{tag.name}</option>
                      ))}
                    </select>
                    <input name="bulkNewTagName" disabled={!enabled} placeholder="או צור תווית חדשה לכל הבחירה" />
                  </>
                )}
              </BulkField>
              <BulkSubmitBar selectedCount={selectedIds.length} onClose={closeBulk} />
            </form>
          </div>
        </div>
      ) : null}

      <div className="card desktop-table">
        <table>
          <thead>
            {showInstitutionView ? (
              <tr>
                <th className="selection-cell">
                  <input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleAll(event.target.checked)} />
                </th>
                {selectedColumns.map((col) => <th key={col.key}>{col.label}</th>)}
              </tr>
            ) : (
              <tr>
                <th className="selection-cell">
                  <input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleAll(event.target.checked)} />
                </th>
                <th>שם</th>
                {showMatchScores ? <th>דיוק</th> : null}
                <th>שיעור</th>
                <th>ת"ז</th>
                <th>גיל</th>
                <th>טלפון תלמיד</th>
                <th>טלפון אב</th>
                <th>טלפון אם</th>
                <th>יצירת קשר</th>
                <th>אירוע</th>
                <th>תוויות</th>
                <th>חוסרים</th>
              </tr>
            )}
          </thead>
          <tbody>
            {!studentRows.length ? (
              <tr>
                <td colSpan={showInstitutionView ? Math.max(selectedColumns.length + 1, 1) : (showMatchScores ? 13 : 12)} className="muted">אין תוצאות</td>
              </tr>
            ) : showInstitutionView ? (
              studentRows.map((student) => {
                const hasMissing = (student.missingItems || []).length > 0;
                return (
                  <tr key={student.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    <td className="selection-cell">
                      <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                    </td>
                    {selectedColumns.map((col) => (
                      <td key={col.key} style={col.key === "missing" && hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>
                        {col.key === "name" ? (
                          <div className="student-table-name-cell">
                            {columnNode(student, col.key)}
                            <StudentTagSummary student={student} onRemoveTag={handleRemoveTag} disabled={isPending} />
                            <TagActionButton student={student} availableTags={tagOptions} onAddTag={handleAddTag} disabled={isPending} />
                          </div>
                        ) : (
                          columnNode(student, col.key)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              studentRows.map((student) => {
                const missingState = buildMissingState(student);
                const hasMissing = missingState.items.length > 0;
                return (
                  <tr key={student.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    <td className="selection-cell">
                      <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                    </td>
                    <td>
                      <div className="student-table-name-cell">
                        <Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link>
                        <StudentTagSummary student={student} onRemoveTag={handleRemoveTag} disabled={isPending} />
                      </div>
                    </td>
                    {showMatchScores ? <td><MatchScoreBadge score={student._matchScore} /></td> : null}
                    <td>{classLabel(student.class)}</td>
                    <td>{student.tznum || "-"}</td>
                    <td>{ageOf(student.dateofbirth) ?? "-"}</td>
                    <td><PhoneLink phoneObj={student.phone} /></td>
                    <td><PhoneLink phoneObj={student.dadPhone} /></td>
                    <td><PhoneLink phoneObj={student.momPhone} /></td>
                    <td>
                      <ContactActionButton student={student} onAddContact={handleAddContact} disabled={isPending} />
                    </td>
                    <td>
                      <EventActionButton student={student} onAddEvent={handleAddEvent} disabled={isPending} />
                    </td>
                    <td>
                      <TagActionButton student={student} availableTags={tagOptions} onAddTag={handleAddTag} disabled={isPending} />
                    </td>
                    <td style={hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>{hasMissing ? missingState.items.join(", ") : "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mobile-student-list">
        {!studentRows.length ? (
          <div className="card muted">אין תוצאות</div>
        ) : showInstitutionView ? (
          studentRows.map((student) => {
            const hasMissing = (student.missingItems || []).length > 0;
            return (
              <div key={student.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <label className="bulk-mobile-select">
                  <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                  <span>בחר לעדכון מרוכז</span>
                </label>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link>
                </div>
                <StudentTagSummary student={student} onRemoveTag={handleRemoveTag} disabled={isPending} />
                <div className="student-mobile-contact">
                  <b>יצירת קשר אחרונה:</b> {student?.latestContact ? `${formatDateValue(student.latestContact.contactDate)} | ${student.latestContact.noteText || "-"}` : "אין תיעוד"}
                </div>
                <div className="student-mobile-contact">
                  <b>אירוע קרוב:</b> {student?.upcomingEvent ? `${student.upcomingEvent.eventLabel} | ${student.upcomingEvent.hebrewDateLabel} | ${eventOffsetLabel(student.upcomingEvent?.nextOccurrence?.daysUntil)}` : "אין אירוע"}
                </div>
                <div className="student-mobile-grid">
                  {selectedColumns.map((col) => <div key={col.key}><b>{col.label}:</b> {columnNode(student, col.key)}</div>)}
                </div>
                <ContactActionButton student={student} onAddContact={handleAddContact} disabled={isPending} />
                <EventActionButton student={student} onAddEvent={handleAddEvent} disabled={isPending} />
                <TagActionButton student={student} availableTags={tagOptions} onAddTag={handleAddTag} disabled={isPending} />
              </div>
            );
          })
        ) : (
          studentRows.map((student) => {
            const missingState = buildMissingState(student);
            const hasMissing = missingState.items.length > 0;
            return (
              <div key={student.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <label className="bulk-mobile-select">
                  <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                  <span>בחר לעדכון מרוכז</span>
                </label>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link>
                  {showMatchScores ? <MatchScoreBadge score={student._matchScore} /> : null}
                  <span>{classLabel(student.class)}</span>
                </div>
                <StudentTagSummary student={student} onRemoveTag={handleRemoveTag} disabled={isPending} />
                <div className="student-mobile-contact">
                  <b>יצירת קשר אחרונה:</b> {student?.latestContact ? `${formatDateValue(student.latestContact.contactDate)} | ${student.latestContact.noteText || "-"}` : "אין תיעוד"}
                </div>
                <div className="student-mobile-contact">
                  <b>אירוע קרוב:</b> {student?.upcomingEvent ? `${student.upcomingEvent.eventLabel} | ${student.upcomingEvent.hebrewDateLabel} | ${eventOffsetLabel(student.upcomingEvent?.nextOccurrence?.daysUntil)}` : "אין אירוע"}
                </div>
                <div className="student-mobile-grid">
                  <div><b>ת"ז:</b> {student.tznum || "-"}</div>
                  <div><b>גיל:</b> {ageOf(student.dateofbirth) ?? "-"}</div>
                  <div><b>טלפון תלמיד:</b> <PhoneLink phoneObj={student.phone} /></div>
                  <div><b>טלפון אב:</b> <PhoneLink phoneObj={student.dadPhone} /></div>
                  <div><b>טלפון אם:</b> <PhoneLink phoneObj={student.momPhone} /></div>
                </div>
                <ContactActionButton student={student} onAddContact={handleAddContact} disabled={isPending} />
                <EventActionButton student={student} onAddEvent={handleAddEvent} disabled={isPending} />
                <TagActionButton student={student} availableTags={tagOptions} onAddTag={handleAddTag} disabled={isPending} />
                <div className="student-mobile-missing"><b>חוסרים:</b> {hasMissing ? missingState.items.join(", ") : "-"}</div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
