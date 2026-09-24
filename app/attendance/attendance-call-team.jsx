"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const outcomes = { pending: "ממתין", completed: "טופל", deferred: "נדחה", no_answer: "לא ענה" };

function outcomeTone(outcome) {
  if (outcome === "completed") return "success";
  if (outcome === "no_answer") return "warning";
  if (outcome === "deferred") return "danger";
  return "neutral";
}

export default function AttendanceCallTeam({ sessionId, team, rosterIds }) {
  const [selected, setSelected] = useState(team.selected);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editingToken, setEditingToken] = useState("");
  const router = useRouter();
  const names = new Map(team.students.map((student) => [student.id, student.label]));
  const current = new Set(rosterIds);
  const leads = team.leads.filter((lead) => current.has(lead.student_id));
  const attempts = team.attempts || [];
  const completed = leads.filter((lead) => lead.outcome === "completed").length;

  const dashboardStats = useMemo(() => {
    const counts = { total: rosterIds.length, completed: 0, pending: 0, no_answer: 0, deferred: 0 };
    leads.forEach((lead) => {
      if (Object.hasOwn(counts, lead.outcome)) counts[lead.outcome] += 1;
    });
    counts.pending = Math.max(0, counts.total - counts.completed - counts.no_answer - counts.deferred);
    return counts;
  }, [leads, rosterIds.length]);

  function toggle(id) {
    setSelected((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
    setMessage("");
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/calls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "team", studentIds: selected }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("צוות המתקשרים נשמר. המפגש מופיע באזור השיחות של התלמידים שנבחרו."); router.refresh();
    } catch (error) { setMessage(error.message || "השמירה נכשלה. נסה שוב."); } finally { setBusy(false); }
  }

  async function manage(body) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/calls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setEditingToken(""); setMessage(body.kind === "requeue" ? "התלמיד הוחזר לתור." : "תיעוד השיחה עודכן."); router.refresh();
    } catch (error) { setMessage(error.message || "העדכון נכשל."); } finally { setBusy(false); }
  }

  function updateAttempt(event, attempt) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    manage({ kind: "manage_attempt", token: attempt.token, outcome: form.get("outcome"), attendanceStatus: form.get("attendanceStatus"), note: form.get("note") });
  }

  return <details id="call-results" className="card attendance-call-team-panel">
    <summary className="attendance-call-dashboard-summary">
      <div className="attendance-call-dashboard-summary-main">
        <span className="eyebrow">ניהול מפגש</span>
        <h2>דשבורד תוצאות שיחות</h2>
        <p className="muted">מעקב קצר אחר מצב המפגש. פתח כדי לראות ולעדכן תוצאות.</p>
      </div>
      <div className="attendance-call-dashboard-summary-stats" aria-label="סיכום מצב המפגש">
        <span>{dashboardStats.total} מוזמנים</span>
        <span>{dashboardStats.completed} טופלו</span>
        <span>{dashboardStats.pending} ממתינים</span>
        <b>פתח דשבורד</b>
      </div>
    </summary>
    <div className="attendance-call-dashboard-header">
      <div><span className="eyebrow">ניהול מפגש</span><h2>דשבורד תוצאות שיחות</h2><p className="muted">מעקב קצר אחר מצב המפגש. פרטי העדכון נפתחים רק עבור השורה שבחרת.</p></div>
      <div className="attendance-call-dashboard-actions"><Link className="quick-action-btn quick-action-primary" href={`/attendance/${encodeURIComponent(sessionId)}#call-results`}>פתח דשבורד מפגש</Link><Link className="quick-action-btn quick-action-outline" href="/call-desk/manage">דשבורד מנהלים</Link><Link className="quick-action-btn quick-action-outline" href={`/call-desk/attendance/${encodeURIComponent(sessionId)}`}>כניסה למוקד המפגש</Link></div>
    </div>
    <div className="attendance-call-stats" aria-label="סיכום מצב המפגש">
      <div className="attendance-call-stat"><b>{dashboardStats.total}</b><span>מוזמנים</span></div><div className="attendance-call-stat attendance-call-stat-success"><b>{dashboardStats.completed}</b><span>טופלו</span></div><div className="attendance-call-stat attendance-call-stat-warning"><b>{dashboardStats.no_answer}</b><span>לא ענו</span></div><div className="attendance-call-stat attendance-call-stat-danger"><b>{dashboardStats.deferred}</b><span>נדחו</span></div><div className="attendance-call-stat attendance-call-stat-neutral"><b>{dashboardStats.pending}</b><span>ממתינים</span></div>
    </div>
    <details className="attendance-call-team-settings"><summary>צוות מתקשרים למפגש <span className="linked-record-pill">טופלו {completed} מתוך {rosterIds.length}</span></summary><p className="muted">בחר תלמידים אחראים. הם ייכנסו לאזור השיחות שלהם ויקבלו בכל פעם מוזמן אחד.</p><fieldset disabled={busy} style={{ border: 0, padding: 0 }}><label>חיפוש תלמיד אחראי<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="הקלד לפחות שתי אותיות" /></label><div className="quick-actions">{selected.map((id) => <button style={{ width: "auto" }} type="button" key={id} onClick={() => toggle(id)}>{names.get(id) || id} ×</button>)}</div>{query.trim().length >= 2 ? <div className="attendance-call-assignee-list">{team.students.filter((student) => student.label.includes(query.trim())).slice(0, 50).map((student) => <label key={student.id}><input type="checkbox" checked={selected.includes(student.id)} onChange={() => toggle(student.id)} />{student.label}</label>)}</div> : null}<button type="button" onClick={save}>{busy ? "שומר…" : "שמור צוות מתקשרים"}</button></fieldset></details>
    {message ? <p role="status" className="attendance-call-feedback">{message}</p> : null}
    <details className="attendance-call-results"><summary>תוצאות שיחות אחרונות <span className="linked-record-pill">{attempts.length} רשומות</span></summary><div className="call-attempt-list">{attempts.length ? attempts.map((attempt) => { const student = team.students.find((item) => item.id === attempt.student_id); const isEditing = editingToken === attempt.token; return <details className={`call-result-card${isEditing ? " is-editing" : ""}`} key={attempt.token} open={isEditing}><summary className="call-result-summary"><span className="call-result-person"><b>{student?.label || attempt.student_id}</b><small>{new Date(attempt.created_at).toLocaleString("he-IL")} · {attempt.caller_name || "לא ידוע"}</small></span><span className={`call-result-status call-result-status-${outcomeTone(attempt.outcome)}`}>{outcomes[attempt.outcome] || attempt.outcome}</span><button type="button" className="call-result-edit-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setEditingToken(isEditing ? "" : attempt.token); }}>✎ {isEditing ? "סגור" : "סמן לעדכון"}</button></summary>{isEditing ? <form className="call-result-editor" onSubmit={(event) => updateAttempt(event, attempt)}><label>תוצאת שיחה<select name="outcome" defaultValue={attempt.outcome}>{Object.entries(outcomes).filter(([value]) => value !== "pending").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>סטטוס הגעה בפועל<select name="attendanceStatus" defaultValue={student?.status || attempt.attendance_status || ""}><option value="">ללא סטטוס</option>{team.statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="call-result-note">הערה<input name="note" defaultValue={attempt.note} /></label><div className="quick-actions"><button disabled={busy}>שמור עדכון</button><button type="button" disabled={busy} onClick={() => manage({ kind: "requeue", studentId: attempt.student_id })}>החזר לתור</button></div></form> : null}</details>; }) : <p className="muted">עדיין לא נרשמו תוצאות שיחה במפגש.</p>}</div></details>
  </details>;
}
