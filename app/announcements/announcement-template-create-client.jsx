"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import AnnouncementTemplateFieldsClient from "./announcement-template-fields-client";

function CreateButton({ disabled }) {
  const { pending } = useFormStatus();
  return <button className="btn" type="submit" disabled={disabled || pending}>{pending ? "שומר תבנית..." : "צור תבנית"}</button>;
}

export default function AnnouncementTemplateCreateClient({ action }) {
  const [source, setSource] = useState("docx");
  const [fields, setFields] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(null);

  function changeSource(value) {
    requestRef.current?.abort();
    requestRef.current = null;
    setSource(value); setFields([]); setError(""); setBusy(false);
  }

  async function inspectFile(event) {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setFields([]); setError(""); setBusy(false);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.docx$/i.test(file.name) || !file.size || file.size > 4 * 1024 * 1024) {
      setError("יש לבחור קובץ Word מסוג DOCX שאינו ריק, עד 4MB."); return;
    }
    setBusy(true);
    const form = new FormData(); form.set("docxFile", file);
    try {
      const response = await fetch("/api/announcements/templates/docx/inspect", { method: "POST", body: form, signal: request.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.fields?.length) throw new Error(result?.error || "זיהוי השדות נכשל. נסה להעלות את הקובץ שוב.");
      if (requestRef.current !== request) return;
      setFields(result.fields); setRevision((value) => value + 1);
    } catch (failure) {
      if (requestRef.current === request && !request.signal.aborted) setError(failure.message);
    } finally {
      if (requestRef.current === request) setBusy(false);
    }
  }

  return <form action={action} className="announcement-template-admin-form" encType="multipart/form-data">
    <div className="announcement-template-create-grid">
      <label><span>שם תבנית</span><input name="name" required placeholder="שם שיוצג ברשימת התבניות" /></label>
      <label><span>מקור התבנית</span><select name="templateSource" value={source} onChange={(event) => changeSource(event.target.value)}><option value="docx">העלאת מסמך Word — DOCX</option><option value="googleDocs">קישור Google Docs</option></select></label>
      <label><span>סוג</span><select name="category" defaultValue="sources"><option value="sources">מראה מקומות</option><option value="announcement">מודעה</option><option value="letter">מכתב</option></select></label>
    </div>
    {source === "docx" ? <div className="announcement-template-docx-row">
      <label><span>מסמך Word לתבנית</span><input type="file" name="docxFile" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={inspectFile} required /><small className="muted">עד 4MB. סמן במסמך שדות בסוגריים מסולסלים, למשל {"{t}"} או {"{שם}"}. שדות חוזרים יוצגו פעם אחת. העיצוב המקורי נשמר.</small></label>
    </div> : <label><span>קישור Google Docs</span><input name="googleDocsUrl" required placeholder="https://docs.google.com/document/d/..." /></label>}
    <div className="announcement-template-role-access"><strong>הגדרות תבנית</strong><input type="hidden" name="isPreferred" value="" /><label className="checkbox-inline"><input name="allowedRoles" value="marei_mekomot" type="checkbox" defaultChecked /><span>מאושר להרשאת מראה מקומות</span></label></div>
    <div aria-live="polite">
      {busy ? <p role="status">קורא את המסמך ומזהה שדות...</p> : null}
      {error ? <p role="alert" className="error">{error}</p> : null}
      {source === "docx" && fields.length ? <p className="ok">זוהו {fields.length} שדות. איך להציג כל שדה למשתמש?</p> : null}
    </div>
    {source === "docx" ? fields.length > 0 ? <AnnouncementTemplateFieldsClient key={`docx-${revision}`} fields={fields} detected /> : null : <AnnouncementTemplateFieldsClient key="google-docs" minRows={1} />}
    <div className="announcement-template-admin-actions"><CreateButton disabled={source === "docx" && (busy || !fields.length || !!error)} /></div>
  </form>;
}
