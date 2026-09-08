"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CallStudentEditor from "./call-student-editor";

function phoneNumber(value) {
  if (value && typeof value === "object") return `${value.primaryPhoneCallingCode || ""}${value.primaryPhoneNumber || ""}`.replace(/[^\d+]/g, "");
  return String(value || "").replace(/[^\d+]/g, "");
}
const labels = { completed:"טופל", deferred:"נדחה", no_answer:"לא ענה" };
export default function AttendanceCallClient({ sessionId, title, locked }) {
  const [data,setData] = useState(null), [note,setNote] = useState(""), [status,setStatus] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [now,setNow] = useState(Date.now());
  const [query,setQuery] = useState(""), [matches,setMatches] = useState(null), [editing,setEditing] = useState(false);
  const [notice,setNotice] = useState("");
  const inFlight = useRef(false), offset = useRef(0);
  const lead = data?.lead;
  const remaining = lead ? Math.max(0, Math.ceil((new Date(lead.expiresAt).getTime()-now)/1000)) : 0;
  useEffect(() => { const timer=setInterval(()=>setNow(Date.now()+offset.current),1000); return ()=>clearInterval(timer); },[]);
  async function request(body) {
    const response = await fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/calls`, {
      method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "לא ניתן להשלים את הפעולה.");
    return result;
  }
  async function next(outcome, requestedStudentId = "") {
    if (inFlight.current) return;
    inFlight.current=true; setBusy(true); setError("");
    try {
      if (outcome && lead) {
        await request({kind:"finish",studentId:lead.studentId,token:lead.token,outcome,note,attendanceStatus:status});
        setData(current=>({...current,lead:null})); setNote(""); setStatus("");
      }
      const result = await request({kind:"claim", studentId:requestedStudentId});
      offset.current=new Date(result.serverTime).getTime()-Date.now();
      setNow(Date.now()+offset.current);
      setData(result); setEditing(false); setMatches(null);
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
  const phone = phoneNumber(lead?.phone);
  return <section className="card call-desk">
    <Link href="/call-desk">חזרה לאזור השיחות שלי</Link>
    <h1>{data?.session?.title || title}</h1>
    <p className="muted">כל תלמיד מוקצה לך לחמש דקות. לאחר טיפול, דחייה או אי־מענה עוברים לתלמיד הבא.</p>
    {data?.stats ? <p>טופלו {data.stats.completed} מתוך {data.stats.total} · בשיחה כעת: {data.stats.active}</p> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!locked ? <details className="card"><summary>חיפוש תלמיד מסוים במפגש</summary>
      <form onSubmit={search}><label>חיפוש לפי שם או טלפון<input type="search" value={query} onChange={e=>setQuery(e.target.value)} minLength={2} required /></label><button disabled={busy}>חפש במוזמני המפגש</button></form>
      {lead ? <p className="muted">בחירה בתלמיד אחר משחררת את ההקצאה הנוכחית. שמור את סיכום השיחה לפני המעבר.</p> : null}
      {matches?.length===0 ? <p>לא נמצאו תלמידים תואמים במפגש.</p> : null}
      {matches?.map(student=><div className="quick-actions" key={student.id}><span>{student.name} · {student.classLabel}</span><button disabled={busy || student.busy} onClick={()=>next(null,student.id)}>{student.busy?"בטיפול אצל מתקשר אחר":"בחר לטיפול ולעדכון"}</button></div>)}
    </details> : null}
    {locked ? <p>המפגש נעול. מנהל צריך לפתוח אותו לפני תחילת השיחות.</p> : !lead ? <>
      <p>{data ? "אין כרגע תלמיד פנוי. ייתכן שהרשימה טופלה, שיש שיחות פעילות או שממתינים לניסיון חוזר." : "לחץ להתחלת עבודה ולקבלת התלמיד הראשון."}</p>
      {data?.stats?.next_available_at ? <p>ניסיון חוזר זמין החל מ־{new Date(data.stats.next_available_at).toLocaleTimeString("he-IL")}</p> : null}
      <button disabled={busy} onClick={()=>next()}>{busy ? "מקצה תלמיד…" : "קבל תלמיד להתקשרות"}</button>
    </> : <div className="linked-record-card call-lead-card">
      <h2>{lead.name}</h2><p>{lead.classLabel}</p>
      <p role="status">{remaining ? `הקצאה בלעדית: ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,"0")}` : "זמן ההקצאה הסתיים. אין להתקשר או לשמור על סמך ההקצאה הישנה."}</p>
      {phone && remaining>0 ? <a className="quick-action-btn" href={`tel:${phone}`}>חיוג: {phone}</a> : <p>{phone ? "החיוג זמין רק בהקצאה פעילה." : "לא הוזן טלפון לתלמיד."}</p>}
      <button disabled={busy || !remaining} onClick={()=>setEditing(!editing)}>עדכון פרטי תלמיד</button>
      {editing ? <CallStudentEditor key={lead.token} lead={lead} request={request} disabled={busy || !remaining} onBusy={setBusy} onClose={()=>setEditing(false)} onSaved={async()=>{setNotice("פרטי התלמיד נשמרו במערכת.");await next();}} /> : null}
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
        <p className="muted">דחייה: חזרה לתור בעוד 5 דקות. לא ענה: ניסיון חוזר בעוד 15 דקות. סטטוס נוכחות מתעדכן רק בלחיצה על „טופל”.</p>
      </fieldset>
      {!remaining || error ? <button disabled={busy} onClick={()=>next()}>רענן הקצאה</button> : null}
      {lead.history?.length ? <details><summary>ניסיונות קודמים</summary>{lead.history.map((item,i)=><p key={i}>{new Date(item.created_at).toLocaleString("he-IL")} · {labels[item.outcome]} · {item.note}</p>)}</details> : null}
    </div>}
  </section>;
}
