"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { deletePaymentLinkAction, savePaymentLinkAction } from "./actions";

function clean(value) { return String(value || "").trim(); }
function formatMoney(value) { return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(Number(value || 0)); }
function dateText(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? clean(value) : date.toLocaleDateString("he-IL"); }

function StudentPicker({ students, value, onChange }) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => students.filter((student) => !query || `${student.label} ${student.tznum} ${student.className} ${student.institution}`.includes(query)).slice(0, 30), [students, query]);
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

function LinkForm({ item, recordType, students, existing, returnTo }) {
  const [studentId, setStudentId] = useState(existing?.studentId || "");
  return (
    <form action={savePaymentLinkAction} className="payment-link-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="recordType" value={recordType} />
      <input type="hidden" name="provider" value={item.provider} />
      <input type="hidden" name="connectionId" value={item.connectionId} />
      <input type="hidden" name="externalRecordId" value={item.id || item.mandateId} />
      <input type="hidden" name="recordSnapshot" value={JSON.stringify({ id: item.id || item.mandateId, customerName: item.customerName, amount: item.amount, createdAt: item.createdAt, status: item.status, connectionLabel: item.connectionLabel })} />
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
      <button className="quick-action-btn quick-action-primary" type="submit" disabled={!studentId}>{existing ? "עדכן שיוך" : "שייך לתלמיד"}</button>
      {existing ? <button className="quick-action-btn quick-action-outline" formAction={deletePaymentLinkAction} name="linkId" value={existing.id} type="submit">הסר שיוך</button> : null}
    </form>
  );
}

export default function PaymentLinkingClient({ dateFrom, dateTo, transactions, mandates, students, links, notice, error }) {
  const [studentFilter, setStudentFilter] = useState("all");
  const [recordFilter, setRecordFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const byKey = useMemo(() => new Map(links.map((link) => [`${link.recordType}:${link.provider}:${link.connectionId}:${link.externalRecordId}`, link])), [links]);
  const linkedStudentIds = useMemo(() => new Set(links.filter((link) => link.recordType === "transaction").map((link) => link.studentId)), [links]);
  const activeMandateStudentIds = useMemo(() => new Set(links.filter((link) => link.recordType === "mandate" && link.recordSnapshot?.status === "active").map((link) => link.studentId)), [links]);
  const filteredStudents = useMemo(() => students.filter((student) => {
    const hasTransactions = linkedStudentIds.has(student.id);
    const hasMandate = activeMandateStudentIds.has(student.id);
    const matchesType = studentFilter === "all" || (studentFilter === "transactions" && hasTransactions) || (studentFilter === "mandates" && hasMandate) || (studentFilter === "none" && !hasTransactions && !hasMandate);
    return matchesType && (!query || `${student.label} ${student.tznum} ${student.className} ${student.institution}`.includes(query));
  }).sort((a, b) => sort === "count" ? (Number(linkedStudentIds.has(b.id)) - Number(linkedStudentIds.has(a.id))) : a.label.localeCompare(b.label, "he")), [students, studentFilter, query, sort, linkedStudentIds, activeMandateStudentIds]);
  const records = useMemo(() => [
    ...transactions.map((item) => ({ ...item, recordType: "transaction" })),
    ...mandates.map((item) => ({ ...item, recordType: "mandate", id: item.mandateId || item.id }))
  ].filter((item) => recordFilter === "all" || item.recordType === recordFilter), [transactions, mandates, recordFilter]);
  const returnTo = `/payments/linking?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
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
      <div className="payment-record-list">{records.map((item) => { const key = `${item.recordType}:${item.provider}:${item.connectionId}:${item.id}`; const existing = byKey.get(key); const student = students.find((candidate) => candidate.id === existing?.studentId); return <details className="payment-record-card" key={key}><summary><b>{item.customerName || "ללא שם"}</b><span>{item.recordType === "mandate" ? "הוראת קבע" : "עסקה"} | {item.connectionLabel} | {dateText(item.createdAt)} | {formatMoney(item.amount)}</span><span className={existing ? "payment-linked" : "payment-unlinked"}>{existing ? `משויך ל-${student?.label || existing.studentId}` : "לא משויך"}</span></summary><div className="payment-record-details"><div className="payments-report-grid"><div><b>מזהה:</b> {item.id}</div><div><b>ספק:</b> {item.providerLabel}</div><div><b>מייל:</b> {item.email || "-"}</div><div><b>טלפון:</b> {item.phone || "-"}</div><div><b>סטטוס:</b> {item.statusLabel || item.status || "-"}</div><div><b>אסמכתא:</b> {item.reference || item.receiptNumber || "-"}</div></div><LinkForm item={item} recordType={item.recordType} students={students} existing={existing} returnTo={returnTo} /></div></details>; })}</div>
    </section>
  </>;
}
