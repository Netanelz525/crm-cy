"use client";

import { useMemo, useState, useTransition } from "react";

function clean(value) {
  return String(value || "").trim();
}

export default function AttendanceStudentPicker({ students = [], rosterStudents = [], defaultValues = [], sessionId = "", saveAction = null }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set((Array.isArray(defaultValues) ? defaultValues : [defaultValues]).map(clean).filter(Boolean)));
  const [savingId, setSavingId] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isPending, startTransition] = useTransition();
  const normalizedQuery = clean(query).toLowerCase();
  const matches = useMemo(() => {
    const filtered = normalizedQuery
      ? students.filter((student) => `${student.label} ${student.classLabel} ${student.institutionLabel}`.toLowerCase().includes(normalizedQuery))
      : students;
    return filtered.slice(0, 80);
  }, [students, normalizedQuery]);

  function persistSelection(id, willBeSelected, student = null, removeFromRoster = false) {
    if (!saveAction || !sessionId) return;

    setSavingId(id);
    setSaveError("");
    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("studentId", id);
    formData.set("selected", willBeSelected ? "1" : "0");
    startTransition(async () => {
      try {
        await saveAction(formData);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("attendance-manual-student-changed", {
            detail: { studentId: id, selected: willBeSelected, removeFromRoster, student: student || students.find((item) => item.id === id) || null }
          }));
        }
      } catch (error) {
        setSelected((current) => {
          const rollback = new Set(current);
          if (willBeSelected) rollback.delete(id);
          else rollback.add(id);
          return rollback;
        });
        setSaveError(error?.message || "לא ניתן לשמור את הבחירה.");
      } finally {
        setSavingId("");
      }
    });
  }

  function toggle(id) {
    const student = students.find((item) => item.id === id) || null;
    const willBeSelected = !selected.has(id);
    setSelected((current) => {
      const next = new Set(current);
      if (willBeSelected) next.add(id);
      else next.delete(id);
      return next;
    });
    if (!saveAction || !sessionId) return;
    persistSelection(id, willBeSelected, student);
  }

  function removeRosterStudent(student) {
    if (!saveAction || !sessionId || !student?.id) return;
    persistSelection(student.id, false, student, true);
  }

  return (
    <section className="attendance-manual-student-picker" style={{ gridColumn: "1 / -1" }}>
      <div className="attendance-manual-student-picker-head">
        <div>
          <strong>תלמידים שנבחרו ידנית</strong>
          <small>אפשר להוסיף תלמידים גם אם אינם תואמים למסננים.</small>
        </div>
        <span className="meta-chip">נבחרו: {selected.size}</span>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="חפש תלמיד לפי שם, שיעור או מוסד"
        aria-label="חיפוש תלמידים להוספה ידנית"
      />
      <div className="attendance-manual-student-results">
        {Array.from(selected).filter((id) => !matches.some((student) => student.id === id)).map((id) => (
          <input key={`selected-${id}`} type="hidden" name="manualStudentIds" value={id} />
        ))}
        {matches.map((student) => (
          <label key={student.id} className="attendance-manual-student-option">
            <input
              type="checkbox"
              name="manualStudentIds"
              value={student.id}
              checked={selected.has(student.id)}
              onChange={() => toggle(student.id)}
            />
            <span>
              <b>{student.label}</b>
              <small>{[student.classLabel, student.institutionLabel].filter(Boolean).join(" | ") || "ללא פרטים נוספים"}{savingId === student.id && isPending ? " | נשמר..." : ""}</small>
            </span>
          </label>
        ))}
        {!matches.length ? <p className="muted">לא נמצאו תלמידים תואמים.</p> : null}
        {matches.length === 80 ? <small className="muted">מוצגות 80 תוצאות ראשונות. המשך לחפש כדי לצמצם.</small> : null}
      </div>
      {rosterStudents.length ? (
        <div className="attendance-manual-roster-list">
          <strong>תלמידים שכבר נמצאים במפגש</strong>
          {rosterStudents.map((student) => (
            <div key={`roster-${student.id}`} className="attendance-manual-roster-row">
              <span>{student.label}</span>
              <button type="button" className="quick-action-btn quick-action-outline" onClick={() => removeRosterStudent(student)}>הסר מהמפגש</button>
            </div>
          ))}
        </div>
      ) : null}
      {saveAction && sessionId ? <small className={saveError ? "error" : "muted"}>{saveError || "הבחירה נשמרת מיד, בלי לרענן את העמוד."}</small> : null}
    </section>
  );
}
