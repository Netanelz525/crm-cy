"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
const outcomes={pending:"ממתין",completed:"טופל",deferred:"נדחה",no_answer:"לא ענה"};
export default function AttendanceCallTeam({sessionId,team,rosterIds}) {
  const [selected,setSelected]=useState(team.selected), [query,setQuery]=useState(""), [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  const router=useRouter();
  const names=new Map(team.students.map(s=>[s.id,s.label]));
  const current=new Set(rosterIds);
  const leads=team.leads.filter(l=>current.has(l.student_id));
  const completed=leads.filter(l=>l.outcome==="completed").length;
  function toggle(id) { setSelected(values=>values.includes(id)?values.filter(x=>x!==id):[...values,id]); setMessage(""); }
  async function save() {
    setBusy(true);setMessage("");
    try {
      const response=await fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/calls`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"team",studentIds:selected})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      setMessage("צוות המתקשרים נשמר. המפגש מופיע באזור השיחות של התלמידים שנבחרו.");router.refresh();
    }catch(error){setMessage(error.message || "השמירה נכשלה. נסה שוב.");}finally{setBusy(false);}
  }
  return <details className="card"><summary><strong>צוות מתקשרים למפגש</strong> · טופלו {completed} מתוך {rosterIds.length}</summary>
    <p>בחר תלמידים אחראים. הם ייכנסו ל„אזור השיחות שלי” בחשבון המקושר לכרטיס התלמיד ויקבלו בכל פעם מוזמן אחד לחמש דקות.</p>
    <fieldset disabled={busy} style={{border:0,padding:0}}>
      <label>חיפוש תלמיד אחראי<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="הקלד לפחות שתי אותיות" /></label>
      <div className="quick-actions">{selected.map(id=><button style={{width:"auto"}} type="button" key={id} onClick={()=>toggle(id)}>{names.get(id)||id} ×</button>)}</div>
      {query.trim().length>=2 ? <div style={{maxHeight:220,overflowY:"auto"}}>{team.students.filter(s=>s.label.includes(query.trim())).slice(0,50).map(s=><label key={s.id} style={{display:"flex",alignItems:"center",gap:8,padding:8}}><input style={{width:"auto",margin:0}} type="checkbox" checked={selected.includes(s.id)} onChange={()=>toggle(s.id)} />{s.label}</label>)}</div> : null}
      <button type="button" onClick={save}>{busy?"שומר…":"שמור צוות מתקשרים"}</button>
    </fieldset>
    {message?<p role="status">{message}</p>:null}
    <div className="quick-actions"><Link href={`/call-desk/attendance/${sessionId}`}>כניסה למוקד המפגש</Link><button type="button" onClick={()=>router.refresh()}>רענן התקדמות</button></div>
    <p>טופלו: {completed} · לא ענו: {leads.filter(l=>l.outcome==="no_answer").length} · נדחו: {leads.filter(l=>l.outcome==="deferred").length}</p>
    <details><summary>תיעוד השיחות האחרונות</summary><div style={{overflowX:"auto"}}><table><thead><tr><th>מועד</th><th>תלמיד</th><th>מתקשר</th><th>תוצאה</th><th>הערה</th></tr></thead><tbody>{team.attempts.map(a=><tr key={a.token}><td>{new Date(a.created_at).toLocaleString("he-IL")}</td><td>{names.get(a.student_id)||a.student_id}</td><td>{a.caller_name||"—"}</td><td>{outcomes[a.outcome]}</td><td>{a.note}</td></tr>)}</tbody></table></div></details>
  </details>;
}
