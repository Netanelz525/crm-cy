"use client";
import Link from "next/link";
import { useState } from "react";

export default function CallDeskClient({ students }) {
  const [index, setIndex] = useState(0); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const student = students[index];
  if (!student) return <section className="card"><h1>אזור השיחות שלי</h1><p className="muted">אין בוגרים שממתינים ליצירת קשר.</p></section>;
  const name = student.label || student.name || `${student.fullName?.firstName || ""} ${student.fullName?.lastName || ""}`.trim();
  async function save(completed) { setBusy(true); const response=await fetch("/api/call-desk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({studentId:student.id,contactDate:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jerusalem"}),noteText:note,completed})}); setBusy(false); if(response.ok){setNote(""); if(completed)setIndex((value)=>Math.min(value+1,students.length-1));} }
  return <section className="card call-desk"><div className="summary-row"><div><h1>אזור השיחות שלי</h1><span className="muted">{index+1} מתוך {students.length}</span></div><div className="quick-actions"><button onClick={()=>setIndex(Math.max(0,index-1))}>הקודם</button><button onClick={()=>setIndex(Math.min(students.length-1,index+1))}>הבא</button></div></div>
    <div className="linked-record-card"><h2>{name}</h2><div className="payments-report-grid"><div><b>מוסד:</b> {student.currentInstitution||"-"}</div><div><b>שיעור:</b> {student.class||"-"}</div><div><b>טלפון:</b> <a href={`tel:${student.phone||student.studentPhone||""}`}>{student.phone||student.studentPhone||"-"}</a></div><div><b>דוא״ל:</b> {student.email||student.primaryEmail||"-"}</div></div><textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={5} placeholder="סיכום השיחה, תשובה והמשך טיפול"/><div className="quick-actions"><button disabled={busy||!note.trim()} onClick={()=>save(false)}>שמור תיעוד</button><button disabled={busy||!note.trim()} onClick={()=>save(true)}>שמור וסיים — עבור לבא</button><Link className="quick-action-btn quick-action-outline" href={`/neon/students/${student.id}?edit=1`}>פתח ועדכן כרטיס מלא</Link></div></div></section>;
}
