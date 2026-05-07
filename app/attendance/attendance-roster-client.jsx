"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveAttendanceRecordAction } from "./actions";

function buildStats(records) {
  const stats = {
    totalStudents: records.length,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    left_early: 0
  };

  for (const record of records) {
    const status = String(record?.status || "absent").trim().toLowerCase();
    if (stats[status] !== undefined) stats[status] += 1;
  }

  return stats;
}

export default function AttendanceRosterClient({ sessionId, students, statusOptions, initialStats }) {
  const [rows, setRows] = useState(students);
  const [rowStates, setRowStates] = useState({});
  const [, startTransition] = useTransition();
  const noteTimersRef = useRef(new Map());
  const rowsRef = useRef(rows);

  useEffect(() => {
    setRows(students);
    rowsRef.current = students;
    setRowStates({});
    for (const timer of noteTimersRef.current.values()) clearTimeout(timer);
    noteTimersRef.current.clear();
  }, [students, sessionId]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => () => {
    for (const timer of noteTimersRef.current.values()) clearTimeout(timer);
    noteTimersRef.current.clear();
  }, []);

  const stats = useMemo(() => buildStats(rows), [rows]);
  const displayStats = initialStats?.totalStudents ? stats : { ...stats, totalStudents: rows.length };

  function setRowSaving(studentId, next) {
    setRowStates((current) => ({
      ...current,
      [studentId]: {
        ...current[studentId],
        ...next
      }
    }));
  }

  function persistRow(studentId, reason = "status") {
    const row = rowsRef.current.find((item) => item.id === studentId);
    if (!row) return;
    setRowSaving(studentId, { state: "saving", error: "" });
    startTransition(async () => {
      try {
        await saveAttendanceRecordAction({
          sessionId,
          studentId: row.id,
          studentName: row.label,
          studentClass: row.class,
          status: row.status,
          noteText: row.noteText
        });
        setRowSaving(studentId, {
          state: reason === "note" ? "saved_note" : "saved",
          error: "",
          savedAt: Date.now()
        });
      } catch (error) {
        setRowSaving(studentId, {
          state: "error",
          error: String(error?.message || "שמירת הנוכחות נכשלה")
        });
      }
    });
  }

  function updateRow(studentId, patch) {
    setRows((current) => current.map((row) => (
      row.id === studentId ? { ...row, ...patch } : row
    )));
  }

  function handleStatusChange(studentId, nextStatus) {
    updateRow(studentId, { status: nextStatus });
    persistRow(studentId, "status");
  }

  function scheduleNoteSave(studentId) {
    const existing = noteTimersRef.current.get(studentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      noteTimersRef.current.delete(studentId);
      persistRow(studentId, "note");
    }, 700);
    noteTimersRef.current.set(studentId, timer);
  }

  function handleNoteChange(studentId, nextNote) {
    updateRow(studentId, { noteText: nextNote });
    setRowSaving(studentId, { state: "typing", error: "" });
    scheduleNoteSave(studentId);
  }

  function handleNoteBlur(studentId) {
    const existing = noteTimersRef.current.get(studentId);
    if (existing) {
      clearTimeout(existing);
      noteTimersRef.current.delete(studentId);
    }
    persistRow(studentId, "note");
  }

  function rowStatusText(studentId) {
    const state = rowStates[studentId]?.state || "";
    if (state === "saving") return "שומר...";
    if (state === "typing") return "מעדכן...";
    if (state === "saved") return "נשמר";
    if (state === "saved_note") return "הערה נשמרה";
    if (state === "error") return rowStates[studentId]?.error || "שגיאה";
    return "";
  }

  return (
    <>
      <div className="card summary-row">
        <div className="attendance-live-note">המסך חי. כל שינוי נשמר מיד ברקע בלי כפתור שמירה.</div>
        <div className="attendance-stats">
          <span className="meta-chip">תלמידים: {displayStats.totalStudents}</span>
          <span className="meta-chip">נוכחים: {displayStats.present}</span>
          <span className="meta-chip">איחרו: {displayStats.late}</span>
          <span className="meta-chip">נעדרו: {displayStats.absent}</span>
          <span className="meta-chip">מוצדקים: {displayStats.excused}</span>
        </div>
      </div>

      <div className="card">
        <h3>הזנת נוכחות</h3>
        <p className="muted">
          ברירת המחדל היא נעדר. אפשר לעבור מהר שורה-שורה, לסמן סטטוס, והכל נשמר אוטומטית.
        </p>
        <div className="attendance-table-wrap">
          <table className="attendance-table">
            <thead>
              <tr>
                <th>שם</th>
                <th>שיעור</th>
                <th>סטטוס</th>
                <th>הערה</th>
                <th>מצב</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((student) => (
                <tr key={student.id}>
                  <td>
                    <div className="attendance-student-name">{student.label}</div>
                  </td>
                  <td>{student.classLabel}</td>
                  <td>
                    <div className="attendance-status-group" role="radiogroup" aria-label={`סטטוס נוכחות עבור ${student.label}`}>
                      {statusOptions.map(([value, label]) => (
                        <label
                          key={value}
                          className={`attendance-status-option${student.status === value ? " active" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`status:${student.id}`}
                            value={value}
                            checked={student.status === value}
                            onChange={() => handleStatusChange(student.id, value)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>
                    <input
                      value={student.noteText || ""}
                      onChange={(event) => handleNoteChange(student.id, event.target.value)}
                      onBlur={() => handleNoteBlur(student.id)}
                      placeholder="הערה קצרה"
                    />
                  </td>
                  <td>
                    <span className={`attendance-row-state${rowStates[student.id]?.state === "error" ? " error" : ""}`}>
                      {rowStatusText(student.id) || "מוכן"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
