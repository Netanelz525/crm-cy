"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveAttendanceRecordAction } from "./actions";
import StudentQuickEmailForm from "../student-quick-email-form";

const POLL_INTERVAL_MS = 10000;
const EXIT_HIGHLIGHT_MS = 1800;
const FLASH_HIGHLIGHT_MS = 2200;
const LOCAL_DIRTY_GRACE_MS = 4000;

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

function StudentNameLink({ student }) {
  const studentId = clean(student?.id);
  if (!studentId) return <div className="attendance-student-name">{student?.label || "-"}</div>;
  return (
    <Link className="attendance-student-name attendance-student-link" href={`/neon/students/${studentId}`}>
      {student?.label || "-"}
    </Link>
  );
}

function hasPhone(phoneObj) {
  return Boolean(normalizeDigits(phoneObj?.primaryPhoneNumber));
}

function storageKey(sessionId) {
  return `attendance-roster-state:${clean(sessionId)}`;
}

function buildLiveStats(rows, statusOptions) {
  const counts = Object.fromEntries((statusOptions || []).map(([value]) => [value, 0]));
  for (const row of rows || []) {
    const status = clean(row?.status).toLowerCase();
    if (counts[status] !== undefined) counts[status] += 1;
  }
  return {
    totalStudents: Array.isArray(rows) ? rows.length : 0,
    counts
  };
}

function rowMatchesFilters(row, selectedFilters, query) {
  const normalizedQuery = clean(query).toLowerCase();
  const matchesStatus = !selectedFilters.length
    || selectedFilters.includes(String(row?.status || "").trim().toLowerCase());
  if (!matchesStatus) return false;
  if (!normalizedQuery) return true;

  return [
    row?.label,
    row?.classLabel,
    row?.class,
    phoneText(row?.phone),
    phoneText(row?.dadPhone),
    phoneText(row?.momPhone)
  ].some((value) => clean(value).toLowerCase().includes(normalizedQuery));
}

export default function AttendanceRosterClient({ sessionId, students, statusOptions, activeStatusFilters = [], isLocked = false, canSendEmails = false, canEmailParents = true, defaultReplyTo = "", returnTo = "" }) {
  const [rows, setRows] = useState(students);
  const [locked, setLocked] = useState(Boolean(isLocked));
  const [selectedFilters, setSelectedFilters] = useState(activeStatusFilters);
  const [query, setQuery] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [flashRowIds, setFlashRowIds] = useState([]);
  const [exitingRows, setExitingRows] = useState([]);
  const [externalNotices, setExternalNotices] = useState([]);
  const [, startTransition] = useTransition();
  const noteTimersRef = useRef(new Map());
  const localDirtyRowsRef = useRef(new Map());
  const flashTimersRef = useRef(new Map());
  const pollAbortRef = useRef(null);
  const rowsRef = useRef(rows);

  useEffect(() => {
    setRows(students);
    rowsRef.current = students;
  }, [students]);

  useEffect(() => {
    setLocked(Boolean(isLocked));
  }, [isLocked]);

  useEffect(() => {
    for (const timer of noteTimersRef.current.values()) clearTimeout(timer);
    noteTimersRef.current.clear();
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(storageKey(sessionId));
      if (!raw) {
        setSelectedFilters(activeStatusFilters);
        setQuery("");
        return;
      }
      const parsed = JSON.parse(raw);
      const nextFilters = Array.isArray(parsed?.selectedFilters)
        ? parsed.selectedFilters.map((value) => clean(value).toLowerCase()).filter(Boolean)
        : activeStatusFilters;
      const nextQuery = clean(parsed?.query);
      setSelectedFilters(nextFilters);
      setQuery(nextQuery);
    } catch {
      setSelectedFilters(activeStatusFilters);
      setQuery("");
    }
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(storageKey(sessionId), JSON.stringify({
      selectedFilters,
      query
    }));
  }, [sessionId, selectedFilters, query]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => () => {
    for (const timer of noteTimersRef.current.values()) clearTimeout(timer);
    noteTimersRef.current.clear();
    for (const timer of flashTimersRef.current.values()) clearTimeout(timer);
    flashTimersRef.current.clear();
    if (pollAbortRef.current) pollAbortRef.current.abort();
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => rowMatchesFilters(row, selectedFilters, query));
  }, [rows, selectedFilters, query]);

  const liveStats = useMemo(() => buildLiveStats(rows, statusOptions), [rows, statusOptions]);

  function persistRow(row) {
    if (!row?.id || locked) return;
    localDirtyRowsRef.current.set(row.id, Date.now() + LOCAL_DIRTY_GRACE_MS);
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
      } finally {
        localDirtyRowsRef.current.set(row.id, Date.now() + 1200);
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
    if (locked) return;
    const nextRow = updateRow(studentId, { status: nextStatus });
    if (nextRow) persistRow(nextRow);
  }

  function scheduleNoteSave(studentId) {
    if (locked) return;
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
    if (locked) return;
    updateRow(studentId, { noteText: nextNote });
    scheduleNoteSave(studentId);
  }

  function handleNoteBlur(studentId) {
    if (locked) return;
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

  async function copyFilteredNames() {
    const text = filteredRows
      .map((student, index) => `${index + 1}. ${clean(student?.label) || "ללא שם"}`)
      .join("\n");
    if (!text) {
      setCopyNotice("אין שמות להעתקה במסנן הנוכחי");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopyNotice(`${filteredRows.length} שמות הועתקו`);
    window.setTimeout(() => setCopyNotice(""), 3000);
  }

  function flashRow(studentId) {
    setFlashRowIds((current) => (current.includes(studentId) ? current : [...current, studentId]));
    const existing = flashTimersRef.current.get(studentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      flashTimersRef.current.delete(studentId);
      setFlashRowIds((current) => current.filter((value) => value !== studentId));
    }, FLASH_HIGHLIGHT_MS);
    flashTimersRef.current.set(studentId, timer);
  }

  function queueExitingRow(row) {
    const key = `${row.id}:${Date.now()}`;
    setExitingRows((current) => [...current, { ...row, _transientKey: key }]);
    const timer = setTimeout(() => {
      setExitingRows((current) => current.filter((item) => item._transientKey !== key));
      flashTimersRef.current.delete(key);
    }, EXIT_HIGHLIGHT_MS);
    flashTimersRef.current.set(key, timer);
  }

  function pushExternalNotice(text) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setExternalNotices((current) => [...current, { id, text }]);
    const timer = setTimeout(() => {
      setExternalNotices((current) => current.filter((item) => item.id !== id));
      flashTimersRef.current.delete(id);
    }, 3200);
    flashTimersRef.current.set(id, timer);
  }

  useEffect(() => {
    let cancelled = false;

    async function pollRoster() {
      if (pollAbortRef.current) pollAbortRef.current.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;

      try {
        const response = await fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}`, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        const nextRowsRaw = Array.isArray(payload?.item?.students) ? payload.item.students : [];
        setLocked(Boolean(payload?.item?.session?.isLocked));
        if (!nextRowsRaw.length) return;

        const now = Date.now();
        const currentRows = rowsRef.current;
        const currentMap = new Map(currentRows.map((row) => [row.id, row]));
        const nextRows = nextRowsRaw.map((incoming) => {
          const current = currentMap.get(incoming.id);
          const dirtyUntil = localDirtyRowsRef.current.get(incoming.id) || 0;
          if (!current) return incoming;
          if (dirtyUntil > now) return current;
          return { ...current, ...incoming };
        });

        const changedRows = [];
        for (const incoming of nextRows) {
          const current = currentMap.get(incoming.id);
          if (!current) continue;
          if (
            clean(current.status) !== clean(incoming.status)
            || clean(current.noteText) !== clean(incoming.noteText)
          ) {
            changedRows.push({ previous: current, next: incoming });
          }
        }

        if (!changedRows.length) return;

        const nextVisible = [];
        for (const change of changedRows) {
          const wasVisible = rowMatchesFilters(change.previous, selectedFilters, query);
          const isVisible = rowMatchesFilters(change.next, selectedFilters, query);
          if (wasVisible && !isVisible) {
            queueExitingRow(change.next);
            pushExternalNotice(`${change.next.label} עודכן על ידי API וירד מהסינון הנוכחי`);
          }
          if (isVisible) nextVisible.push(change.next.id);
        }

        rowsRef.current = nextRows;
        setRows(nextRows);
        nextVisible.forEach(flashRow);
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("Attendance roster polling failed", error);
        }
      }
    }

    pollRoster();
    const intervalId = setInterval(pollRoster, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (pollAbortRef.current) pollAbortRef.current.abort();
    };
  }, [sessionId, selectedFilters, query]);

  return (
    <>
      {externalNotices.length ? (
        <div className="attendance-live-notices" aria-live="polite">
          {externalNotices.map((notice) => (
            <div key={notice.id} className="attendance-live-notice">{notice.text}</div>
          ))}
        </div>
      ) : null}
      <div className="card attendance-roster-card">
        <div className="attendance-roster-head">
          <h3>הזנת נוכחות</h3>
          {locked ? <div className="attendance-roster-lock-note">המפגש נעול. אפשר לצפות בנתונים, אך אי אפשר לשנות סטטוסים או הערות.</div> : null}
          <div className="attendance-stats">
            <span className="meta-chip">תלמידים: {liveStats.totalStudents}</span>
            {statusOptions.map(([value, label]) => (
              <span key={`stat-${value}`} className="meta-chip">{label}: {liveStats.counts[value] || 0}</span>
            ))}
          </div>
        </div>
        <div className="attendance-toolbar-grid">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש לפי שם תלמיד, שיעור או מספר טלפון"
          />
          <div className="quick-actions" style={{ marginTop: 0 }}>
            <div className="muted attendance-toolbar-count">
              מוצגים כרגע {filteredRows.length} מתוך {rows.length}
            </div>
            <button
              type="button"
              className="quick-action-btn quick-action-outline"
              onClick={copyFilteredNames}
              disabled={!filteredRows.length}
            >
              העתק שמות ({filteredRows.length})
            </button>
          </div>
        </div>
        {copyNotice ? <div className="ok" role="status" aria-live="polite">{copyNotice}</div> : null}
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
        </div>
        <div className="attendance-table-wrap">
          <table className="attendance-table">
            <thead>
              <tr>
                <th>שם</th>
                <th>שיעור</th>
                <th>סטטוס</th>
                <th>הערה</th>
                {canSendEmails ? <th>מייל</th> : null}
              </tr>
            </thead>
            <tbody>
              {exitingRows.map((student) => (
                <tr key={student._transientKey} className="attendance-row-exit-highlight">
                  <td className="attendance-student-cell">
                    <StudentNameLink student={student} />
                  </td>
                  <td className="attendance-class-cell">{student.classLabel}</td>
                  <td className="attendance-status-cell">
                    <div className="attendance-row-exit-text">עודכן מבחוץ ולכן ירד מהסינון הנוכחי</div>
                  </td>
                  <td className="attendance-note-cell">{student.noteText || ""}</td>
                  {canSendEmails ? <td /> : null}
                </tr>
              ))}
              {filteredRows.map((student) => (
                <tr key={student.id} className={flashRowIds.includes(student.id) ? "attendance-row-live-highlight" : ""}>
                  <td className="attendance-student-cell">
                    <StudentNameLink student={student} />
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
                  <td className="attendance-class-cell">{student.classLabel}</td>
                  <td className="attendance-status-cell">
                    <div className="attendance-status-group" role="radiogroup" aria-label={`סטטוס נוכחות עבור ${student.label}`} aria-disabled={locked}>
                      {statusOptions.map(([value, label]) => (
                        <label
                          key={value}
                          className={`attendance-status-option${student.status === value ? " active" : ""}${locked ? " disabled" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`status:${student.id}`}
                            value={value}
                            checked={student.status === value}
                            disabled={locked}
                            onChange={() => handleStatusChange(student.id, value)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="attendance-note-cell">
                    <input
                      value={student.noteText || ""}
                      onChange={(event) => handleNoteChange(student.id, event.target.value)}
                      onBlur={() => handleNoteBlur(student.id)}
                      placeholder="הערה קצרה"
                      disabled={locked}
                    />
                  </td>
                  {canSendEmails ? (
                    <td className="attendance-email-cell">
                      <StudentQuickEmailForm student={student} returnTo={returnTo || `/attendance/${sessionId}`} canSendEmails={canSendEmails} canEmailParents={canEmailParents} defaultReplyTo={defaultReplyTo} />
                    </td>
                  ) : null}
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
