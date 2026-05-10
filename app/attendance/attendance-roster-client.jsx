"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveAttendanceRecordAction } from "./actions";

export default function AttendanceRosterClient({ sessionId, students, statusOptions }) {
  const [rows, setRows] = useState(students);
  const [, startTransition] = useTransition();
  const noteTimersRef = useRef(new Map());
  const rowsRef = useRef(rows);

  useEffect(() => {
    setRows(students);
    rowsRef.current = students;
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

  function persistRow(row) {
    if (!row?.id) return;
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
      } catch (error) {
        console.error("Attendance autosave failed", error);
      }
    });
  }

  function updateRow(studentId, patch) {
    const currentRows = rowsRef.current;
    let nextRow = null;
    const nextRows = currentRows.map((row) => {
      if (row.id !== studentId) return row;
      nextRow = { ...row, ...patch };
      return nextRow;
    });
    rowsRef.current = nextRows;
    setRows(nextRows);
    return nextRow;
  }

  function handleStatusChange(studentId, nextStatus) {
    const nextRow = updateRow(studentId, { status: nextStatus });
    if (nextRow) persistRow(nextRow);
  }

  function scheduleNoteSave(studentId) {
    const existing = noteTimersRef.current.get(studentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      noteTimersRef.current.delete(studentId);
      const row = rowsRef.current.find((item) => item.id === studentId);
      if (row) persistRow(row);
    }, 700);
    noteTimersRef.current.set(studentId, timer);
  }

  function handleNoteChange(studentId, nextNote) {
    updateRow(studentId, { noteText: nextNote });
    scheduleNoteSave(studentId);
  }

  function handleNoteBlur(studentId) {
    const existing = noteTimersRef.current.get(studentId);
    if (existing) {
      clearTimeout(existing);
      noteTimersRef.current.delete(studentId);
    }
    const row = rowsRef.current.find((item) => item.id === studentId);
    if (row) persistRow(row);
  }

  return (
    <>
      <div className="card">
        <h3>הזנת נוכחות</h3>
        <p className="muted">
          ברירת המחדל היא לא נמצא. אפשר לעבור מהר שורה-שורה, לסמן סטטוס, והכל נשמר אוטומטית.
        </p>
        <div className="attendance-table-wrap">
          <table className="attendance-table">
            <thead>
              <tr>
                <th>שם</th>
                <th>שיעור</th>
                <th>סטטוס</th>
                <th>הערה</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
