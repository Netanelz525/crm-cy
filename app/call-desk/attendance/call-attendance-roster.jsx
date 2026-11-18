"use client";

import { useEffect, useRef, useState } from "react";

export default function CallAttendanceRoster({ title, request, initialStatus, onBack }) {
  const [roster, setRoster] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialStatus || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request({ kind: "attendance_list" });
      setRoster(result);
      setFilter((value) => result.statusOptions.some(([status]) => status === value) ? value : "");
    } catch (failure) {
      setError(failure.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function update(student, status) {
    if (inFlight.current || status === student.status) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request({ kind: "attendance_update", studentId: student.id, status });
      setRoster((current) => ({ ...current, students: current.students.map((row) =>
        row.id === student.id ? { ...row, status: result.status } : row) }));
      setMessage(`הנוכחות של ${student.name} נשמרה.`);
    } catch (failure) {
      setError(failure.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const term = query.trim().toLocaleLowerCase("he");
  const rows = roster?.students.filter((student) =>
    (!filter || student.status === filter) &&
    `${student.name} ${student.classLabel || ""}`.toLocaleLowerCase("he").includes(term));
  return <section className="card call-attendance-roster">
    <button type="button" className="quick-action-btn quick-action-outline" onClick={onBack}>חזרה למצב שיחות</button>
    <h1>ניהול נוכחות</h1>
    <p>{title}</p>
    <div className="call-attendance-roster-filters">
      <label>חיפוש לפי שם או כיתה<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>סטטוס נוכחות<select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="">כל הסטטוסים</option>
        {roster?.statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button type="button" className="quick-action-btn quick-action-outline" disabled={busy} onClick={load}>רענון רשימה</button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {rows ? <>
      <p className="muted">{rows.length} מתוך {roster.students.length} מוזמנים</p>
      {rows.length ? <ul className="call-attendance-roster-list">
        {rows.map((student) => <li key={student.id}>
          <div><strong>{student.name}</strong> <small className="muted">{student.classLabel}</small></div>
          <select aria-label={`סטטוס נוכחות של ${student.name}`} value={student.status}
            disabled={busy} onChange={(event) => update(student, event.target.value)}>
            {roster.statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </li>)}
      </ul> : <p>אין מוזמנים שתואמים לסינון.</p>}
    </> : busy && <p role="status">טוען רשימת נוכחות…</p>}
  </section>;
}
