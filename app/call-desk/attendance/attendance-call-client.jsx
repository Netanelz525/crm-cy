"use client";
import {callPhone as phoneNumber} from "../../../lib/call-phone";
import Link from "next/link";
import { callDeskFilterKey, resolveCallDeskFilter } from "../../../lib/call-desk-preferences.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import CallStudentEditor from "./call-student-editor";

function ContactDetails({ label, name, phone, email, active }) {
  const number = phoneNumber(phone);
  const address = String(typeof email === "object" && email ? email.primaryEmail || "" : email || "").trim();
  return <section style={{border:"1px solid #d5e1ef",borderRadius:12,padding:14,minWidth:0}}>
    <h3 style={{marginTop:0}}>{label}{name ? ` — ${name}` : ""}</h3>
    {number ? <p dir="ltr" style={{textAlign:"right"}}>{number}</p> : <p className="muted">לא הוזן טלפון</p>}
    {address ? <p style={{overflowWrap:"anywhere"}} dir="ltr">{address}</p> : null}
    {active ? <div className="quick-actions">
      {number ? <><a className="quick-action-btn" href={`tel:${number}`}>חיוג ל{label}</a><a className="quick-action-btn" href={`https://wa.me/${number.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp ל{label}</a></> : null}
      {address.includes("@") ? <a className="quick-action-btn" href={`mailto:${address}`}>מייל ל{label}</a> : null}
    </div> : null}
  </section>;
}

const labels = { in_call:"בשיחה כעת", pending:"ממתין", completed:"טופל", deferred:"נדחה", no_answer:"לא ענה" };
export default function AttendanceCallClient({ sessionId, title, locked, statusOptions=[], publicToken="", initialStatus="" }) {
  const [data,setData] = useState(null), [note,setNote] = useState(""), [status,setStatus] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [now,setNow] = useState(Date.now());
  const [query,setQuery] = useState(""), [matches,setMatches] = useState(null), [editing,setEditing] = useState(false);
  const [listStatus, setListStatus] = useState("");
  const [listOutcome, setListOutcome] = useState("");
  const [listSort, setListSort] = useState("outcome");
  const directory = useMemo(() => {
    const students = matches || [];
    const attendanceCounts = new Map();
    const callCounts = { pending: 0, no_answer: 0, deferred: 0, completed: 0, in_call: 0 };
    const callState = (student) => student.inCall ? "in_call" : student.outcome;
    for (const student of students) {
      attendanceCounts.set(student.statusLabel, (attendanceCounts.get(student.statusLabel) || 0) + 1);
      callCounts[callState(student)] = (callCounts[callState(student)] || 0) + 1;
    }
    const order = { in_call: 0, pending: 1, no_answer: 2, deferred: 3, completed: 4 };
    const compareName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "he", { numeric: true });
    const rows = students.filter(student => (!listStatus || student.statusLabel === listStatus)
      && (!listOutcome || callState(student) === listOutcome)).sort((a, b) => {
      const group = listSort === "outcome" ? (order[callState(a)] ?? 5) - (order[callState(b)] ?? 5)
        : listSort === "attendance" ? String(a.statusLabel || "").localeCompare(String(b.statusLabel || ""), "he") : 0;
      return group || compareName(a, b);
    });
    return { rows, callCounts, attendanceCounts: [...attendanceCounts].sort(([a], [b]) => String(a).localeCompare(String(b), "he")) };
  }, [matches, listStatus, listOutcome, listSort]);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const publicWindow=useRef("");
  const [closed,setClosed]=useState(false);
  const [attendanceFilter,setAttendanceFilter]=useState(()=>resolveCallDeskFilter(statusOptions,initialStatus,null,true));
  const [filterReady, setFilterReady] = useState(false);
  const [preferenceWarning, setPreferenceWarning] = useState("");
  const preferenceScope = publicToken ? "public" : "signed";
  const optionsKey = JSON.stringify(statusOptions);
  const selectedStatusLabel = statusOptions.find(([value])=>value===attendanceFilter)?.[1] || "כל הסטטוסים הזמינים";
  useEffect(() => {
    let saved = null;
    try { saved = window.localStorage.getItem(callDeskFilterKey(sessionId, preferenceScope === "public")); }
    catch { setPreferenceWarning("לא ניתן לזכור את הבחירה אחרי סגירת הדפדפן. הבחירה תישמר במהלך העבודה בעמוד."); }
    const url = new URL(window.location.href);
    const restored = resolveCallDeskFilter(JSON.parse(optionsKey),url.searchParams.get("status") ?? initialStatus,saved,url.searchParams.has("status"));
    setAttendanceFilter(restored);
    try { window.localStorage.setItem(callDeskFilterKey(sessionId, preferenceScope === "public"), restored); }
    catch { setPreferenceWarning("הבחירה נשמרת לעמוד הנוכחי בלבד; הדפדפן אינו מאפשר שמירה קבועה."); }
    setFilterReady(true);
  }, [sessionId, initialStatus, optionsKey, preferenceScope]);

  function chooseAttendanceFilter(value) {
    setAttendanceFilter(value);
    try {
      window.localStorage.setItem(callDeskFilterKey(sessionId, preferenceScope === "public"),value);
      setPreferenceWarning("");
    } catch { setPreferenceWarning("הבחירה נשמרה לעמוד הנוכחי בלבד; הדפדפן אינו מאפשר שמירה קבועה."); }
    const url = new URL(window.location.href);
    url.searchParams.set("status",value);
    window.history.replaceState(window.history.state,"",url.toString());
    // Keep the current call and its notes intact. The selection applies to the next automatic claim.
  }
  const [notice,setNotice] = useState("");
  const [invitationBusy,setInvitationBusy] = useState(false);
  const inFlight = useRef(false), offset = useRef(0);
  const lead = data?.lead;
  const remaining = lead ? Math.max(0, Math.ceil((new Date(lead.expiresAt).getTime()-now)/1000)) : 0;
  useEffect(() => { const timer=setInterval(()=>setNow(Date.now()+offset.current),1000); return ()=>clearInterval(timer); },[]);
  async function copyFilteredLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("status", attendanceFilter);
    try { await navigator.clipboard.writeText(url.toString()); setNotice("הקישור עם סינון הסטטוס הועתק."); }
    catch { setError("לא ניתן להעתיק את הקישור. נסה שוב."); }
  }
  async function request(body) {
    if(publicToken&&!publicWindow.current)publicWindow.current=crypto.randomUUID();
    const response = await fetch(publicToken?`/api/public-call/${encodeURIComponent(publicToken)}`:`/api/attendance/sessions/${encodeURIComponent(sessionId)}/calls`, {
      method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(publicToken?{...body,windowId:publicWindow.current}:body)
    });
    const result = await response.json();
    if(publicToken&&response.status===403){setClosed(true);setData(null);}
    if (!response.ok) throw new Error(result.error || "לא ניתן להשלים את הפעולה.");
    return result;
  }
  useEffect(() => {
    if (closed) return;
    let cancelled = false, loading = false;
    async function refresh() {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const result = await request({ kind: "dashboard" });
        if (!cancelled) { setDashboard(result); setDashboardError(""); }
      } catch (failure) { if (!cancelled) setDashboardError(failure.message); }
      finally { loading = false; }
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [sessionId, publicToken, closed]);

  async function next(outcome, requestedStudentId = "") {
    if (inFlight.current || !filterReady) return;
    inFlight.current=true; setBusy(true); setError("");
    try {
      if (outcome && lead) {
        await request({kind:"finish",studentId:lead.studentId,token:lead.token,outcome,note,attendanceStatus:status});
        setData(current=>({...current,lead:null})); setNote(""); setStatus("");
      }
      const result = await request({kind:"claim", studentId:requestedStudentId,attendanceStatus:requestedStudentId ? "" : !outcome && lead && remaining > 0 ? lead.status : attendanceFilter});
      offset.current=new Date(result.serverTime).getTime()-Date.now();
      setNow(Date.now()+offset.current);
      setData(result); setEditing(false); setMatches(null);
      request({kind:"dashboard"}).then(setDashboard).catch(failure=>setDashboardError(failure.message));
      if (result.lead?.token !== lead?.token) { setNote(""); setStatus(""); }
    } catch (failure) { setError(failure.message || "חיבור הרשת נכשל. נסה שוב."); }
    finally { inFlight.current=false; setBusy(false); }
  }
  async function search(event) {
    event.preventDefault(); if(inFlight.current || busy)return;
    inFlight.current=true;setBusy(true);setError("");
    try { const result=await request({kind:"search",query});setMatches(result.students); }
    catch(failure){setError(failure.message);}finally{inFlight.current=false;setBusy(false);}
  }
  async function showAllStudents() {
    if (inFlight.current || busy) return;
    inFlight.current = true; setBusy(true); setError("");
    try { const result = await request({ kind: "list" }); setMatches(result.students); }
    catch (failure) { setError(failure.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function sendInvitation() {
    if (!lead || invitationBusy || !remaining) return;
    setInvitationBusy(true); setError("");
    try {
      const result = await request({ kind: "invitation", studentId: lead.studentId });
      const emailCount = result?.email?.sentEmails || 0;
      const whatsappCount = result?.whatsapp?.sentMessages || 0;
      setNotice(`ההזמנה נשלחה: ${emailCount} במייל ו-${whatsappCount} ב-WhatsApp.`);
    } catch (failure) {
      setError(failure.message || "שליחת ההזמנה נכשלה.");
    } finally { setInvitationBusy(false); }
  }
  if(closed)return <section className="card"><h1>החפ״ק נסגר</h1><p>יש לפנות למנהל לקבלת קישור פעיל.</p></section>;
  return <div className="call-desk-layout"><section className="card call-desk">
    {!publicToken&&<Link href="/call-desk">חזרה לאזור השיחות שלי</Link>}
    <h1>{data?.session?.title || title}</h1>
    <p className="muted">כל תלמיד מוקצה לך לחמש דקות. לאחר טיפול, דחייה או אי־מענה עוברים לתלמיד הבא.</p>
    <div className="call-status-picker">
      <div className="call-status-picker-heading"><h2>למי מתקשרים?</h2><strong>הסטטוס שנבחר: {selectedStatusLabel}</strong></div>
      <div className="call-status-picker-options" role="group" aria-label="בחירת סטטוס נוכחות להתקשרות">
        {[["", "כל הסטטוסים"], ...statusOptions.filter(([value])=>value!=="unavailable")].map(([value,label])=><button
          key={value || "all"} type="button" aria-pressed={attendanceFilter===value}
          className={`quick-action-btn${attendanceFilter===value ? " quick-action-primary" : " quick-action-outline"}`}
          disabled={busy || !filterReady || locked} onClick={()=>chooseAttendanceFilter(value)}>{label}</button>)}
      </div>
      <p className="muted">הבחירה נשמרת למפגש הזה גם אחרי חיפוש, בחירה ידנית ורענון. התלמיד הבא יוקצה לפי הסטטוס שבחרת.</p>
      {lead ? <p className="call-status-current-note">אפשר לשנות עכשיו — הבחירה תחול על התלמיד הבא. השיחה הנוכחית וההערות שלה נשמרות.</p> : null}
      {preferenceWarning ? <p role="status" className="muted">{preferenceWarning}</p> : null}
      <div className="quick-actions"><button type="button" className="quick-action-btn quick-action-outline" disabled={!filterReady} onClick={copyFilteredLink}>העתק קישור עם הבחירה</button>
      {!publicToken&&<a className="btn btn-primary" href={`/api/attendance/sessions/${encodeURIComponent(sessionId)}/calls/export?status=${encodeURIComponent(attendanceFilter)}`}>הורד רשימה לפי הסטטוס שנבחר (Excel)</a>}</div>
    </div>
    {data?.stats ? <p>בסטטוס של ההקצאה הנוכחית: טופלו {data.stats.completed} מתוך {data.stats.total} · בשיחה כעת: {data.stats.active}</p> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!locked ? <details className="card"><summary>חיפוש תלמיד ורשימת תלמידי המפגש</summary>
      <form onSubmit={search}><label>חיפוש לפי שם או טלפון<input type="search" value={query} onChange={e=>setQuery(e.target.value)} minLength={2} required /></label><button disabled={busy}>חפש במוזמני המפגש</button><button type="button" disabled={busy} onClick={showAllStudents}>{busy ? "טוען…" : "הצג את כל תלמידי המפגש"}</button></form>
      <p className="muted">החיפוש והרשימה כוללים את כל תלמידי המפגש. בחירה ידנית לא משנה את סטטוס ההתקשרות הקבוע שבחרת.</p>
      {lead ? <p className="muted">בחירה בתלמיד אחר משחררת את ההקצאה הנוכחית. שמור את סיכום השיחה לפני המעבר.</p> : null}
      {matches?.length===0 ? <p>לא נמצאו תלמידים תואמים במפגש.</p> : null}
      {matches ? <>
        <p>ממתינים: {directory.callCounts.pending} · לא ענו: {directory.callCounts.no_answer} · נדחו: {directory.callCounts.deferred} · טופלו: {directory.callCounts.completed} · בשיחה כעת: {directory.callCounts.in_call}</p>
        <div className="quick-actions">
          <label>סינון לפי סטטוס נוכחות<select value={listStatus} onChange={event=>setListStatus(event.target.value)}>
            <option value="">כל סטטוסי הנוכחות ({matches.length})</option>
            {directory.attendanceCounts.map(([label, count])=><option key={label} value={label}>{label} ({count})</option>)}
          </select></label>
          <label>סינון לפי מצב השיחה<select value={listOutcome} onChange={event=>setListOutcome(event.target.value)}>
            <option value="">כל מצבי השיחה ({matches.length})</option>
            {Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label} ({directory.callCounts[value] || 0})</option>)}
          </select></label>
          <label>מיון הרשימה<select value={listSort} onChange={event=>setListSort(event.target.value)}>
            <option value="outcome">לפי מצב השיחה</option><option value="attendance">לפי סטטוס נוכחות</option><option value="name">לפי שם תלמיד</option>
          </select></label>
          <button type="button" onClick={()=>{setListStatus("");setListOutcome("");setListSort("outcome");}}>איפוס סינון ומיון</button>
        </div>
        <p role="status">מוצגים {directory.rows.length} מתוך {matches.length} תלמידים ברשימה</p>
        {matches.length > 0 && directory.rows.length === 0 ? <p>אין תלמידים שמתאימים למסננים שנבחרו.</p> : null}
      </> : null}
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
      {directory.rows.map(student=><div className="quick-actions" key={student.id}>
        <span><b>{student.name}</b> · {student.classLabel} · {student.statusLabel} · {student.inCall ? labels.in_call : labels[student.outcome] || student.outcome}</span>
        <button disabled={busy || student.busy || !student.canCall} onClick={()=>next(null,student.id)}>{student.busy ? "בטיפול אצל מתקשר אחר" : !student.canCall ? student.unavailableReason : "בחר להתקשרות"}</button>
      </div>)}
      </div>
    </details> : null}
    {locked ? <p>המפגש נעול. מנהל צריך לפתוח אותו לפני תחילת השיחות.</p> : !lead ? <>
      <p>{data ? "אין כרגע תלמיד פנוי. ייתכן שהרשימה טופלה, שיש שיחות פעילות או שממתינים לניסיון חוזר." : "לחץ להתחלת עבודה ולקבלת התלמיד הראשון."}</p>
      {data?.stats?.next_available_at ? <p>ניסיון חוזר זמין החל מ־{new Date(data.stats.next_available_at).toLocaleTimeString("he-IL")}</p> : null}
      <button disabled={busy || !filterReady} onClick={()=>next()}>{busy ? "מקצה תלמיד…" : `קבל תלמיד — ${selectedStatusLabel}`}</button>
    </> : <div className="linked-record-card call-lead-card">
      <h2>{lead.name}</h2><p>{lead.classLabel}</p>
      <p role="status">{remaining ? `הקצאה בלעדית: ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,"0")}` : "זמן ההקצאה הסתיים. אין להתקשר או לשמור על סמך ההקצאה הישנה."}</p>
      {!publicToken&&<button type="button" className="quick-action-btn quick-action-primary" disabled={invitationBusy || !remaining} onClick={sendInvitation}>{invitationBusy ? "שולח הזמנה…" : "שלח הזמנה לפי הגדרות המפגש"}</button>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:12}}>
        <ContactDetails label="תלמיד" phone={lead.phone} email={lead.email} active={remaining>0} />
        <ContactDetails label="אב" {...lead.father} active={remaining>0} />
        <ContactDetails label="אם" {...lead.mother} active={remaining>0} />
      </div>
      {!publicToken&&<button className={`call-edit-toggle${!publicToken&&editing ? " is-open" : ""}`} type="button" aria-expanded={editing} disabled={busy || !remaining} onClick={()=>setEditing(!editing)}>
        <span className="call-edit-toggle-icon" aria-hidden="true">{!publicToken&&editing ? "×" : "✎"}</span>
        <span><strong>{!publicToken&&editing ? "סגור את אזור העריכה" : "פתח עדכון פרטי תלמיד"}</strong><small>{!publicToken&&editing ? "הטופס פתוח כעת" : "לחץ כדי לפתוח את שדות התלמיד"}</small></span>
        <span className="call-edit-toggle-arrow" aria-hidden="true">⌄</span>
      </button>}
      {!publicToken&&editing ? <CallStudentEditor key={lead.token} lead={lead} request={request} disabled={busy || !remaining} onBusy={setBusy} onClose={()=>setEditing(false)} onSaved={async()=>{setNotice("פרטי התלמיד נשמרו במערכת.");await next();}} /> : null}
      <fieldset disabled={busy || !remaining} style={{border:0,padding:0}}>
        <label>סטטוס נוכחות לאחר השיחה<select value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">ללא שינוי בסטטוס הנוכחות</option>
          {(data.session.statusOptions || []).map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
        </select></label>
        <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={4000} rows={4} placeholder="סיכום שיחה או סיבת הדחייה" />
        <div className="quick-actions">
          <button onClick={()=>next("completed")}>טופל — שמור ועבור לבא</button>
          <button onClick={()=>next("no_answer")}>לא ענה — עבור לבא</button>
          <button onClick={()=>next("deferred")}>דחה — עבור לבא</button>
        </div>
        <p className="muted">דחייה: חזרה לתור בעוד 5 דקות. לא ענה: נשאר בתור לניסיון נוסף, ללא המתנה. סטטוס נוכחות מתעדכן רק בלחיצה על „טופל”.</p>
      </fieldset>
      {!remaining || error ? <button disabled={busy} onClick={()=>next()}>רענן הקצאה</button> : null}
      {lead.history?.length ? <details><summary>ניסיונות קודמים</summary>{lead.history.map((item,i)=><p key={i}>{new Date(item.created_at).toLocaleString("he-IL")} · {labels[item.outcome]} · {item.note}</p>)}</details> : null}
    </div>}
  </section>
  <aside className="card call-attendance-dashboard" aria-label="דשבורד מצב נוכחות במפגש">
    <h2>מצב הנוכחות במפגש</h2>
    <p className="muted">כל מוזמני המפגש · ללא סינון</p>
    {dashboard ? <>
      <div className="call-attendance-total"><strong>{dashboard.total}</strong><span>מוזמנים במפגש</span></div>
      {dashboard.total === 0 ? <p>עדיין אין מוזמנים במפגש.</p> : null}
      {dashboard.statuses.map(item=><div className={`call-attendance-status call-attendance-status-${item.value === "found" ? "found" : item.value === "missing" ? "missing" : "other"}`} key={item.value}>
        <div><b>{item.label}</b><strong>{item.percentage}%</strong></div>
        <progress max="100" value={item.percentage} aria-label={`${item.label}: ${item.percentage}%`} />
        <small>{item.count} מתוך {dashboard.total} מוזמנים</small>
      </div>)}
      <small className="muted">עודכן ב־{new Date(dashboard.updatedAt).toLocaleTimeString("he-IL",{timeZone:"Asia/Jerusalem"})} · מתרענן כל 15 שניות</small>
    </> : !dashboardError ? <p role="status">טוען את מצב המפגש…</p> : null}
    {dashboardError ? <p role="alert" className="error">לא ניתן לרענן את הדשבורד. {dashboard ? "מוצגים הנתונים מהעדכון האחרון." : dashboardError}</p> : null}
  </aside>
  </div>;
}
