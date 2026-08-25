"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

function clean(value) { return String(value || "").trim(); }
function normalize(value) { return clean(value).toLocaleLowerCase("he").replace(/[\u0591-\u05c7]/g, "").replace(/\s+/g, " "); }
function formatMoney(value) { return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(Number(value || 0)); }
function dateText(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? clean(value) : date.toLocaleDateString("he-IL"); }
function compact(value) { return clean(value).toLocaleLowerCase("he").replace(/[^\p{L}\p{N}]/gu, ""); }

function StudentPicker({ students, value, onChange }) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => students.filter((student) => !query || normalize(`${student.label} ${student.tznum} ${student.className} ${student.institution}`).includes(normalize(query))).slice(0, 30), [students, query]);
  const selected = students.find((student) => student.id === value);
  return (
    <div className="payment-student-picker">
      <input value={selected?.label || query} onChange={(event) => { setQuery(event.target.value); onChange(""); }} placeholder="חיפוש תלמיד לפי שם, ת״ז, שיעור או מוסד" />
      {query && !selected ? <div className="payment-student-results">{options.map((student) => <button type="button" key={student.id} onClick={() => { onChange(student.id); setQuery(""); }}>{student.label} {student.tznum ? `| ${student.tznum}` : ""}</button>)}</div> : null}
      {selected ? <div className="muted">נבחר: <b>{selected.label}</b> {selected.institution ? `| ${selected.institution}` : ""}</div> : null}
      <input type="hidden" name="studentId" value={value} />
    </div>
  );
}

function toLinkRecord(item) {
  return { provider: item.provider, connectionId: item.connectionId, externalRecordId: item.id || item.mandateId, recordSnapshot: { id: item.id || item.mandateId, customerName: item.customerName, amount: item.amount, createdAt: item.createdAt, status: item.status, connectionLabel: item.connectionLabel } };
}

function LinkForm({ item, recordType, students, existing, relatedMandate, onSaved, onDeleted }) {
  const [studentId, setStudentId] = useState(existing?.studentId || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const formRef = useRef(null);
  async function submit() {
    if (!studentId || busy) return;
    setBusy(true); setMessage("");
    const form = new FormData(formRef.current);
    const response = await fetch("/api/payments/linking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      record: toLinkRecord(item), recordType, relatedMandate: relatedMandate ? toLinkRecord(relatedMandate) : null, studentId,
      payerType: form.get("payerType"), payerName: form.get("payerName"), payerEmail: form.get("payerEmail"), payerPhone: form.get("payerPhone"), notes: form.get("notes")
    }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error || "השמירה נכשלה"); return; }
    setMessage(relatedMandate ? "העסקה והוראת הקבע שויכו" : "השיוך נשמר");
    onSaved(result.links);
  }
  async function remove() {
    if (!existing || busy) return;
    setBusy(true);
    const response = await fetch("/api/payments/linking", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: existing.id }) });
    setBusy(false);
    if (response.ok) { setMessage("השיוך הוסר"); onDeleted(existing.id); } else setMessage("ההסרה נכשלה");
  }
  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="payment-link-form">
      <StudentPicker students={students} value={studentId} onChange={setStudentId} />
      <select name="payerType" defaultValue={existing?.payerType || "student"}>
        <option value="student">העסקה מהתלמיד</option>
        <option value="father">העסקה מהאבא</option>
        <option value="mother">העסקה מהאמא</option>
      </select>
      <input name="payerName" defaultValue={existing?.payerName || item.customerName || ""} placeholder="שם המשלם כפי שנמסר" />
      <input name="payerEmail" type="email" defaultValue={existing?.payerEmail || item.email || ""} placeholder="מייל המשלם" dir="ltr" />
      <input name="payerPhone" defaultValue={existing?.payerPhone || item.phone || ""} placeholder="טלפון המשלם" dir="ltr" />
      <input name="notes" defaultValue={existing?.notes || ""} placeholder="הערה לשיוך" />
      <button className="quick-action-btn quick-action-primary" type="button" onClick={submit} disabled={!studentId || busy}>{busy ? "שומר..." : existing ? "עדכן שיוך" : "שייך לתלמיד"}</button>
      {existing ? <button className="quick-action-btn quick-action-outline" type="button" onClick={remove} disabled={busy}>הסר שיוך</button> : null}
      {message ? <span className="payment-link-message">{message}</span> : null}
    </form>
  );
}

export default function PaymentLinkingClient({ dateFrom, dateTo, transactions, mandates, students, links, notice, error }) {
  const [liveRecords, setLiveRecords] = useState({ transactions, mandates });
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [localLinks, setLocalLinks] = useState(links);
  const [studentFilter, setStudentFilter] = useState("all");
  const [recordFilter, setRecordFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const byKey = useMemo(() => new Map(localLinks.map((link) => [`${link.recordType}:${link.provider}:${link.connectionId}:${link.externalRecordId}`, link])), [localLinks]);
  const linkedStudentIds = useMemo(() => new Set(localLinks.filter((link) => link.recordType === "transaction").map((link) => link.studentId)), [localLinks]);
  const activeMandateStudentIds = useMemo(() => new Set(localLinks.filter((link) => link.recordType === "mandate" && link.recordSnapshot?.status === "active").map((link) => link.studentId)), [localLinks]);
  const filteredStudents = useMemo(() => students.filter((student) => {
    const hasTransactions = linkedStudentIds.has(student.id);
    const hasMandate = activeMandateStudentIds.has(student.id);
    const matchesType = studentFilter === "all" || (studentFilter === "transactions" && hasTransactions) || (studentFilter === "mandates" && hasMandate) || (studentFilter === "none" && !hasTransactions && !hasMandate);
    return matchesType && (!query || normalize(`${student.label} ${student.tznum} ${student.className} ${student.institution}`).includes(normalize(query)));
  }).sort((a, b) => sort === "count" ? (Number(linkedStudentIds.has(b.id)) - Number(linkedStudentIds.has(a.id))) : a.label.localeCompare(b.label, "he")), [students, studentFilter, query, sort, linkedStudentIds, activeMandateStudentIds]);
  const records = useMemo(() => [
    ...liveRecords.transactions.map((item) => ({ ...item, recordType: "transaction" })),
    ...liveRecords.mandates.map((item) => ({ ...item, recordType: "mandate", id: item.mandateId || item.id }))
  ].filter((item) => recordFilter === "all" || item.recordType === recordFilter), [liveRecords, recordFilter]);
  function findRelatedMandate(item) {
    if (item.recordType !== "transaction") return null;
    const directDebitId = compact(item.directDebitNumber);
    const donorId = compact(item.donorId);
    const email = compact(item.email);
    const phone = compact(item.phone);
    return liveRecords.mandates.find((mandate) => {
      if (clean(mandate.provider) !== clean(item.provider) || clean(mandate.connectionId) !== clean(item.connectionId)) return false;
      const mandateId = compact(mandate.mandateId || mandate.id);
      if (directDebitId && mandateId && directDebitId === mandateId) return true;
      if (donorId && compact(mandate.donorId) === donorId) return true;
      if (email && compact(mandate.email) === email) return true;
      return Boolean(phone && compact(mandate.phone) === phone);
    }) || null;
  }
  useEffect(() => {
    let active = true;
    setLoadingRecords(true);
    fetch(`/api/payments/linking?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("שליפת הנתונים נכשלה")))
      .then((data) => { if (active) setLiveRecords(data); })
      .catch(() => {})
      .finally(() => { if (active) setLoadingRecords(false); });
    return () => { active = false; };
  }, [dateFrom, dateTo]);
  function saveLinks(saved) { setLocalLinks((previous) => [...previous.filter((link) => !saved.some((next) => next.recordType === link.recordType && next.provider === link.provider && next.connectionId === link.connectionId && next.externalRecordId === link.externalRecordId)), ...saved]); }
  return <>
    {notice ? <div className="ok">{notice}</div> : null}{error ? <div className="error">{error}</div> : null}
    <section className="card">
      <h2 style={{ marginTop: 0 }}>מצב תלמידים</h2>
      <div className="grid">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש תלמיד" />
        <select value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}><option value="all">כל התלמידים</option><option value="transactions">עם עסקאות משויכות</option><option value="mandates">עם הוראת קבע פעילה משויכת</option><option value="none">ללא עסקה וללא הוראת קבע</option></select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">מיון לפי שם</option><option value="count">מיון לפי שיוך</option></select>
      </div>
      <div className="payment-student-summary"><b>{filteredStudents.length}</b> תלמידים בתצוגה</div>
      <div className="payment-student-table">{filteredStudents.slice(0, 200).map((student) => <div className="payment-student-row" key={student.id}><Link href={`/neon/students/${student.id}`}>{student.label}</Link><span>{student.institution || "-"}</span><span>{student.className || "-"}</span><span>{linkedStudentIds.has(student.id) ? "עסקה ✓" : "עסקה -"}</span><span>{activeMandateStudentIds.has(student.id) ? "הו״ק פעילה ✓" : "הו״ק -"}</span></div>)}</div>
    </section>
    <section className="card">
      <h2 style={{ marginTop: 0 }}>רשומות תשלום לשיוך</h2>
      <div className="grid"><select value={recordFilter} onChange={(event) => setRecordFilter(event.target.value)}><option value="all">עסקאות והוראות קבע</option><option value="transaction">עסקאות בלבד</option><option value="mandate">הוראות קבע בלבד</option></select><span className="muted">העסקאות מוצגות עבור {dateFrom} עד {dateTo}; הוראות הקבע נשלפות במלואן.</span></div>
      <div className="payment-record-list">{loadingRecords ? <div className="muted">טוען עסקאות והוראות קבע ברקע...</div> : records.map((item) => { const key = `${item.recordType}:${item.provider}:${item.connectionId}:${item.id}`; const existing = byKey.get(key); const student = students.find((candidate) => candidate.id === existing?.studentId); const relatedMandate = findRelatedMandate(item); const hasMandate = item.recordType === "mandate" || Boolean(item.directDebitNumber) || Boolean(relatedMandate); return <details className="payment-record-card" key={key}><summary><b>{item.customerName || "ללא שם"}</b><span>{item.recordType === "mandate" ? "הוראת קבע" : "עסקה"} | {item.connectionLabel} | {dateText(item.createdAt)} | {formatMoney(item.amount)}</span><span className={existing ? "payment-linked" : "payment-unlinked"}>{existing ? `משויך ל-${student?.label || existing.studentId}` : "לא משויך"}</span></summary><div className="payment-record-details"><div className="payments-report-grid"><div><b>מזהה:</b> {item.id}</div><div><b>ספק:</b> {item.providerLabel}</div><div><b>סוג רשומה:</b> {item.recordType === "mandate" ? "הוראת קבע" : "עסקה"}</div><div><b>קשר להוראת קבע:</b> <span className={hasMandate ? "payment-related-yes" : "payment-related-no"}>{hasMandate ? (relatedMandate ? `כן, ${relatedMandate.mandateId || relatedMandate.id}` : "כן") : "לא"}</span></div><div><b>מייל:</b> {item.email || "-"}</div><div><b>טלפון:</b> {item.phone || "-"}</div><div><b>סטטוס:</b> {item.statusLabel || item.status || "-"}</div><div><b>אסמכתא:</b> {item.reference || item.receiptNumber || "-"}</div>{relatedMandate ? <div className="payment-related-note">העסקה מקושרת להוראת קבע; השיוך יעדכן את העסקה ואת הוראת הקבע לאותו תלמיד.</div> : null}</div><LinkForm item={item} recordType={item.recordType} students={students} existing={existing} relatedMandate={relatedMandate} onSaved={saveLinks} onDeleted={(id) => setLocalLinks((previous) => previous.filter((link) => link.id !== id))} /></div></details>; })}</div>
    </section>
  </>;
}
