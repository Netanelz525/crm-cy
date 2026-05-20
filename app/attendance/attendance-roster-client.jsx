"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveAttendanceRecordAction } from "./actions";

function clean(value) {
  return String(value || "").trim();
}

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function phoneHref(phoneObj) {
  const number = normalizeDigits(phoneObj?.primaryPhoneNumber);
  if (!number) return "";
  const calling = clean(phoneObj?.primaryPhoneCallingCode).replace(/[^\d+]/g, "");
  const prefix = calling || "+";
  return `tel:${prefix}${number}`.replace(/\s+/g, "");
}

function whatsappHref(phoneObj) {
  const number = normalizeDigits(phoneObj?.primaryPhoneNumber);
  if (!number) return "";
  const calling = clean(phoneObj?.primaryPhoneCallingCode).replace(/[^\d]/g, "");
  const fullNumber = `${calling}${number}`.replace(/^0+/, "").replace(/[^\d]/g, "");
  return fullNumber ? `https://wa.me/${fullNumber}` : "";
}

function hasPhone(phoneObj) {
  return Boolean(normalizeDigits(phoneObj?.primaryPhoneNumber));
}

export default function AttendanceRosterClient({ sessionId, students, statusOptions, activeStatusFilters = [] }) {
  const [rows, setRows] = useState(students);
  const [selectedFilters, setSelectedFilters] = useState(activeStatusFilters);
  const [, startTransition] = useTransition();
  const noteTimersRef = useRef(new Map());
  const rowsRef = useRef(rows);

  useEffect(() => {
    setRows(students);
    setSelectedFilters(activeStatusFilters);
    rowsRef.current = students;
    for (const timer of noteTimersRef.current.values()) clearTimeout(timer);
    noteTimersRef.current.clear();
  }, [students, sessionId, activeStatusFilters]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => () => {
    for (const timer of noteTimersRef.current.values()) clearTimeout(timer);
    noteTimersRef.current.clear();
  }, []);

  const filteredRows = useMemo(() => {
    if (!selectedFilters.length) return rows;
    return rows.filter((row) => selectedFilters.includes(String(row?.status || "").trim().toLowerCase()));
  }, [rows, selectedFilters]);

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

  function toggleFilter(statusValue) {
    setSelectedFilters((current) => (
      current.includes(statusValue)
        ? current.filter((value) => value !== statusValue)
        : [...current, statusValue]
    ));
  }

  return (
    <>
      <div className="card">
        <h3>הזנת נוכחות</h3>
        <p className="muted">
          ברירת המחדל היא לא נמצא. אפשר לעבור מהר שורה-שורה, לסמן סטטוס, והכל נשמר אוטומטית.
        </p>
        <div className="attendance-filter-toolbar">
          <button
            type="button"
            className={`attendance-filter-chip${selectedFilters.length ? "" : " active"}`}
            onClick={() => setSelectedFilters([])}
          >
            הכל
          </button>
          {statusOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`attendance-filter-chip${selectedFilters.includes(value) ? " active" : ""}`}
              onClick={() => toggleFilter(value)}
            >
              {label}
            </button>
          ))}
          <span className="muted">מוצגים: {filteredRows.length}</span>
        </div>
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
              {filteredRows.map((student) => (
                <tr key={student.id}>
                  <td>
                    <div className="attendance-student-name">{student.label}</div>
                    <div className="attendance-contact-actions">
                      <ContactActionButton href={phoneHref(student.phone)} label="חיוג" />
                      <ContactActionButton href={whatsappHref(student.phone)} label="WhatsApp" external />
                      <details className="attendance-contact-details">
                        <summary>▾</summary>
                        <div className="attendance-contact-details-body">
                          <ContactLine label="תלמיד" phoneObj={student.phone} />
                          <ContactLine label="אב" phoneObj={student.dadPhone} />
                          <ContactLine label="אם" phoneObj={student.momPhone} />
                        </div>
                      </details>
                    </div>
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

function ContactActionButton({ href, label, external = false }) {
  if (!href) {
    return <span className="attendance-contact-btn disabled">{label}</span>;
  }

  return (
    <a
      className="attendance-contact-btn"
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
    >
      {label}
    </a>
  );
}

function ContactLine({ label, phoneObj }) {
  const text = phoneText(phoneObj);
  const hasValue = hasPhone(phoneObj);

  return (
    <div className="attendance-contact-line">
      <div className="attendance-contact-line-top">
        <b>{label}</b>
        <span>{text || "-"}</span>
      </div>
      <div className="attendance-contact-line-actions">
        <ContactActionButton href={phoneHref(phoneObj)} label="חיוג" />
        <ContactActionButton href={whatsappHref(phoneObj)} label="WhatsApp" external />
        {!hasValue ? <span className="muted">אין מספר</span> : null}
      </div>
    </div>
  );
}
