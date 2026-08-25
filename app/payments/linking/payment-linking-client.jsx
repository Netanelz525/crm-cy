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
  return {
    provider: item.provider,
    connectionId: item.connectionId,
    externalRecordId: item.id || item.mandateId,
    id: item.id || item.mandateId,
    mandateId: item.mandateId,
    transactionNumber: item.transactionNumber,
    customerName: item.customerName,
    donorId: item.donorId,
    email: item.email,
    phone: item.phone,
    amount: item.amount,
    currency: item.currency,
    createdAt: item.createdAt,
    periodMonth: item.periodMonth,
    status: item.status,
    recordSnapshot: { ...item }
  };
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
        <option value="other">אחר — הגיע דרך התלמיד</option>
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
  const [loadingRecords, setLoadingRecords] = useState({ transactions: true, mandates: true });
  const [localLinks, setLocalLinks] = useState(links);
  const [studentFilter, setStudentFilter] = useState("all");
  const [recordFilter, setRecordFilter] = useState("transaction");
  const [mandateRelationFilter, setMandateRelationFilter] = useState("all");
  const [mandateStudentLinkFilter, setMandateStudentLinkFilter] = useState("all");
  const [mandateIssueFilter, setMandateIssueFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const byKey = useMemo(() => new Map(localLinks.map((link) => [`${link.recordType}:${link.provider}:${link.connectionId}:${link.externalRecordId}`, link])), [localLinks]);
  const linkedStudentIds = useMemo(() => new Set(localLinks.filter((link) => link.recordType === "transaction").map((link) => link.studentId)), [localLinks]);
  const activeMandateStudentIds = useMemo(() => new Set(localLinks.filter((link) => link.recordType === "mandate" && ["active", "issues"].includes(link.recordSnapshot?.status)).map((link) => link.studentId)), [localLinks]);
  const issueMandateStudentIds = useMemo(() => new Set(localLinks.filter((link) => link.recordType === "mandate" && link.recordSnapshot?.status === "issues").map((link) => link.studentId)), [localLinks]);
  const filteredStudents = useMemo(() => students.filter((student) => {
    const hasTransactions = linkedStudentIds.has(student.id);
    const hasMandate = activeMandateStudentIds.has(student.id);
    const matchesType = studentFilter === "all" || (studentFilter === "transactions" && hasTransactions) || (studentFilter === "mandates" && hasMandate) || (studentFilter === "none" && !hasTransactions && !hasMandate);
    return matchesType && (!query || normalize(`${student.label} ${student.tznum} ${student.className} ${student.institution}`).includes(normalize(query)));
  }).sort((a, b) => sort === "count" ? (Number(linkedStudentIds.has(b.id)) - Number(linkedStudentIds.has(a.id))) : a.label.localeCompare(b.label, "he")), [students, studentFilter, query, sort, linkedStudentIds, activeMandateStudentIds]);
  const records = useMemo(() => [
    ...liveRecords.transactions.map((item) => ({ ...item, recordType: "transaction" })),
    ...liveRecords.mandates.map((item) => ({ ...item, recordType: "mandate", id: item.mandateId || item.id }))
  ].filter((item) => item.recordType === recordFilter), [liveRecords, recordFilter]);
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
    setLoadingRecords({ transactions: true, mandates: true });
    for (const type of ["transactions", "mandates"]) {
      fetch(`/api/payments/linking?type=${type}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("שליפת הנתונים נכשלה")))
        .then((data) => { if (active) setLiveRecords((previous) => ({ ...previous, [type]: data[type] || [] })); })
        .catch(() => {})
        .finally(() => { if (active) setLoadingRecords((previous) => ({ ...previous, [type]: false })); });
    }
    return () => { active = false; };
  }, [dateFrom, dateTo]);
  const visibleRecords = records.filter((item) => {
    if (item.recordType === "mandate") {
      const linkedToStudent = byKey.has(`mandate:${item.provider}:${item.connectionId}:${item.id}`);
      const hasIssue = item.status === "issues";
      if (mandateStudentLinkFilter === "linked" && !linkedToStudent) return false;
      if (mandateStudentLinkFilter === "unlinked" && linkedToStudent) return false;
      if (mandateIssueFilter === "issues" && !hasIssue) return false;
      if (mandateIssueFilter === "healthy" && hasIssue) return false;
      return true;
    }
    if (mandateRelationFilter === "all") return true;
    const linkedToMandate = Boolean(item.directDebitNumber || findRelatedMandate(item));
    return mandateRelationFilter === "linked" ? linkedToMandate : !linkedToMandate;
  });
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
      <div className="payment-student-table">{filteredStudents.slice(0, 200).map((student) => {
        const studentLinks = localLinks.filter((link) => link.studentId === student.id);
        const hasIssue = issueMandateStudentIds.has(student.id);
        return <details className={`payment-student-expandable${hasIssue ? " payment-student-issue" : ""}`} key={student.id}>
          <summary className="payment-student-row"><b>{student.label}</b><span>{student.institution || "-"}</span><span>{student.className || "-"}</span><span>{linkedStudentIds.has(student.id) ? "עסקה ✓" : "עסקה -"}</span><span className={hasIssue ? "payment-mandate-issue-label" : ""}>{hasIssue ? "הו״ק עם תקלה" : activeMandateStudentIds.has(student.id) ? "הו״ק פעילה ✓" : "הו״ק -"}</span></summary>
          <div className="payment-student-linked-preview">
            {studentLinks.length ? studentLinks.map((link) => <div key={link.id} className={link.recordSnapshot?.status === "issues" ? "payment-mandate-issue-label" : ""}><b>{link.recordType === "mandate" ? "הוראת קבע" : "עסקה"}</b> · {link.payerName || link.recordSnapshot?.customerName || "ללא שם"} · {{ student: "התלמיד", father: "אבא", mother: "אמא", other: "אחר — הגיע דרך התלמיד" }[link.payerType] || "התלמיד"} · {formatMoney(link.recordSnapshot?.amount)}{link.recordSnapshot?.status === "issues" ? ` · ${link.recordSnapshot?.errorText || "תקלה בחיוב"}` : ""}</div>) : <div className="muted">אין תשלומים משויכים לתלמיד.</div>}
            <Link className="quick-action-btn quick-action-outline" href={`/neon/students/${student.id}?payments=1#payments`}>פתח תשלומים בכרטיס התלמיד</Link>
          </div>
        </details>;
      })}</div>
    </section>
    <section className="card">
      <h2 style={{ marginTop: 0 }}>רשומות תשלום לשיוך</h2>
      <div className="payment-record-tabs" role="tablist" aria-label="סוג רשומות תשלום">
        <button type="button" role="tab" aria-selected={recordFilter === "transaction"} className={`payment-record-tab${recordFilter === "transaction" ? " is-active" : ""}`} onClick={() => setRecordFilter("transaction")}>עסקאות ({liveRecords.transactions.length})</button>
        <button type="button" role="tab" aria-selected={recordFilter === "mandate"} className={`payment-record-tab${recordFilter === "mandate" ? " is-active" : ""}`} onClick={() => setRecordFilter("mandate")}>הוראות קבע פעילות ({liveRecords.mandates.length})</button>
      </div>
      <div className="grid" style={{ marginTop: 12 }}>
        {recordFilter === "transaction" ? <select value={mandateRelationFilter} onChange={(event) => setMandateRelationFilter(event.target.value)}><option value="all">כל העסקאות</option><option value="linked">עסקאות המשויכות להוראת קבע</option><option value="unlinked">עסקאות ללא הוראת קבע</option></select> : null}
        {recordFilter === "mandate" ? <><select value={mandateStudentLinkFilter} onChange={(event) => setMandateStudentLinkFilter(event.target.value)} aria-label="סינון הוראות קבע לפי שיוך לתלמיד"><option value="all">כל הוראות הקבע</option><option value="linked">הוראות קבע משויכות לתלמיד</option><option value="unlinked">הוראות קבע לא משויכות</option></select><select value={mandateIssueFilter} onChange={(event) => setMandateIssueFilter(event.target.value)} aria-label="סינון הוראות קבע לפי תקלות"><option value="all">עם ובלי תקלות</option><option value="issues">הוראות קבע עם תקלה</option><option value="healthy">הוראות קבע ללא תקלה</option></select></> : null}
        <span className="muted">{recordFilter === "transaction" ? `עסקאות עבור ${dateFrom} עד ${dateTo}` : `מוצגות ${visibleRecords.length} מתוך ${records.length} הוראות קבע פעילות והוראות עם תקלה`}</span>
      </div>
      <div className="payment-record-list">{loadingRecords[recordFilter === "transaction" ? "transactions" : "mandates"] ? <div className="muted">{recordFilter === "transaction" ? "טוען עסקאות..." : "טוען הוראות קבע פעילות..."}</div> : visibleRecords.map((item) => { const key = `${item.recordType}:${item.provider}:${item.connectionId}:${item.id}`; const existing = byKey.get(key); const student = students.find((candidate) => candidate.id === existing?.studentId); const relatedMandate = findRelatedMandate(item); const hasMandate = item.recordType === "mandate" || Boolean(item.directDebitNumber) || Boolean(relatedMandate); const hasIssue = item.recordType === "mandate" && item.status === "issues"; return <details className={`payment-record-card${hasIssue ? " payment-record-card-issue" : ""}`} key={key}><summary><b>{item.customerName || "ללא שם"}</b><span>{item.recordType === "mandate" ? "הוראת קבע" : "עסקה"} | {item.connectionLabel} | {dateText(item.createdAt)} | {formatMoney(item.amount)}</span>{hasIssue ? <span className="payment-mandate-issue-label">תקלה: {item.errorText || item.statusLabel}</span> : null}<span className={existing ? "payment-linked" : "payment-unlinked"}>{existing ? `משויך ל-${student?.label || existing.studentId}` : "לא משויך"}</span></summary><div className="payment-record-details"><div className="payments-report-grid"><div><b>מזהה:</b> {item.id}</div><div><b>ספק:</b> {item.providerLabel}</div><div><b>סוג רשומה:</b> {item.recordType === "mandate" ? "הוראת קבע" : "עסקה"}</div><div><b>קשר להוראת קבע:</b> <span className={hasMandate ? "payment-related-yes" : "payment-related-no"}>{hasMandate ? (relatedMandate ? `כן, ${relatedMandate.mandateId || relatedMandate.id}` : "כן") : "לא"}</span></div><div><b>מייל:</b> {item.email || "-"}</div><div><b>טלפון:</b> {item.phone || "-"}</div><div><b>סטטוס:</b> <span className={hasIssue ? "payment-mandate-issue-label" : ""}>{item.statusLabel || item.status || "-"}</span></div><div><b>אסמכתא:</b> {item.reference || item.receiptNumber || "-"}</div>{relatedMandate ? <div className="payment-related-note">העסקה מקושרת להוראת קבע; השיוך יעדכן את העסקה ואת הוראת הקבע לאותו תלמיד.</div> : null}</div><LinkForm item={item} recordType={item.recordType} students={students} existing={existing} relatedMandate={relatedMandate} onSaved={saveLinks} onDeleted={(id) => setLocalLinks((previous) => previous.filter((link) => link.id !== id))} /></div></details>; })}</div>
    </section>
    <button type="button" className="payment-back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="חזרה לראש העמוד">↑ לראש העמוד</button>
  </>;
}
