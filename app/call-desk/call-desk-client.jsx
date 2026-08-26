"use client";
import Link from "next/link";
import { useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

function phoneText(value) {
  if (value && typeof value === "object") {
    const number = clean(value.primaryPhoneNumber);
    const callingCode = clean(value.primaryPhoneCallingCode);
    return [callingCode, number].filter(Boolean).join(" ") || "-";
  }
  return clean(value) || "-";
}

function phoneHref(value) {
  if (value && typeof value === "object") {
    const number = clean(value.primaryPhoneNumber).replace(/[^\d]/g, "");
    if (!number) return "";
    const callingCode = clean(value.primaryPhoneCallingCode).replace(/[^\d+]/g, "");
    return `tel:${callingCode || "+"}${number}`;
  }
  const number = clean(value).replace(/[^\d+]/g, "");
  return number ? `tel:${number}` : "";
}

function emailText(value) {
  if (value && typeof value === "object") {
    return emailText(value.primaryEmail || value.emailAddress || value.address || value.value);
  }
  const email = clean(value);
  return email.includes("@") ? email : "";
}

function whatsappHref(value) {
  const raw = phoneText(value).replace(/[^\d]/g, "");
  if (!raw || raw === "-") return "";
  const number = raw.startsWith("972") ? raw : raw.startsWith("0") ? `972${raw.slice(1)}` : raw;
  return `https://wa.me/${number}`;
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width="18" height="18">
      <path fill="currentColor" d="M16 3C8.8 3 3 8.7 3 15.8c0 2.2.6 4.4 1.8 6.3L3 29l7-1.8c1.8.9 3.8 1.3 5.9 1.3 7.2 0 13-5.7 13-12.8S23.2 3 16 3Zm0 23.1c-1.9 0-3.7-.5-5.3-1.4l-.4-.2-4.2 1.1 1.1-4.1-.3-.4c-1-1.7-1.5-3.5-1.5-5.4C5.4 9.9 10.2 5.2 16 5.2s10.6 4.7 10.6 10.5S21.8 26.1 16 26.1Z" />
      <path fill="currentColor" d="M22 18.6c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.7-1.7-2-.2-.3 0-.5.1-.6l.5-.5c.2-.2.2-.3.3-.5.1-.2.1-.4 0-.6l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.8.4-.3.3-1.1 1-1.1 2.5s1.1 2.9 1.3 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4Z" />
    </svg>
  );
}

export default function CallDeskClient({ students }) {
  const [index, setIndex] = useState(0); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const student = students[index];
  if (!student) return <section className="card"><h1>אזור השיחות שלי</h1><p className="muted">אין בוגרים שממתינים ליצירת קשר.</p></section>;
  const name = student.label || student.name || `${student.fullName?.firstName || ""} ${student.fullName?.lastName || ""}`.trim();
  const phone = phoneText(student.phone || student.studentPhone);
  const phoneLink = phoneHref(student.phone || student.studentPhone);
  const whatsappLink = whatsappHref(student.phone || student.studentPhone);
  const email = emailText(student.email || student.primaryEmail);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  async function save(completed) { setBusy(true); const response=await fetch("/api/call-desk",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({studentId:student.id,contactDate:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jerusalem"}),noteText:note,completed})}); setBusy(false); if(response.ok){setNote(""); if(completed)setIndex((value)=>Math.min(value+1,students.length-1));} }
  return <section className="card call-desk"><div className="summary-row"><div><h1>אזור השיחות שלי</h1><span className="muted">{index+1} מתוך {students.length} לידים</span></div><div className="quick-actions"><button onClick={()=>setIndex(Math.max(0,index-1))}>הקודם</button><button onClick={()=>setIndex(Math.min(students.length-1,index+1))}>הבא</button></div></div>
    <div className="linked-record-card call-lead-card"><div className="call-lead-header"><span className="call-lead-avatar">{initials || "?"}</span><div><h2>{name}</h2><div className="call-lead-badges"><span>{clean(student.currentInstitution)||"ללא מוסד"}</span><span>{clean(student.class)||"ללא שיעור"}</span><span className="call-lead-status">ממתין לטיפול</span></div></div></div><div className="payments-report-grid call-lead-details"><div><b>טלפון:</b> {phoneLink ? <a href={phoneLink}>{phone}</a> : phone}</div><div><b>דוא״ל:</b> {email || "-"}</div></div><div className="call-lead-actions">{phoneLink ? <a className="quick-action-btn quick-action-outline" href={phoneLink}>חיוג</a> : null}{whatsappLink ? <a className="quick-action-btn call-whatsapp-btn" href={whatsappLink} target="_blank" rel="noreferrer"><WhatsAppIcon /> WhatsApp</a> : null}{email ? <a className="quick-action-btn quick-action-outline" href={`mailto:${email}`}>שליחת מייל</a> : null}<Link className="quick-action-btn quick-action-outline" href={`/neon/students/${student.id}?edit=1`}>פתח כרטיס מלא</Link></div><textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={5} placeholder="סיכום השיחה, תשובה והמשך טיפול"/><div className="quick-actions call-lead-save-actions"><button disabled={busy||!note.trim()} onClick={()=>save(false)}>שמור תיעוד</button><button disabled={busy||!note.trim()} onClick={()=>save(true)}>שמור וסיים — עבור לבא</button></div></div></section>;
}
