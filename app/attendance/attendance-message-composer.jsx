"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton({ children, formAction, primary = false }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formAction={formAction} className={`quick-action-btn ${primary ? "quick-action-primary" : "quick-action-outline"}`} disabled={pending}>
      {pending ? "שולח..." : children}
    </button>
  );
}

export default function AttendanceMessageComposer({
  sessionId,
  session,
  statusOptions,
  templates,
  saveAction,
  emailAction,
  whatsappAction,
  whatsappOnly = false
}) {
  const [channel, setChannel] = useState(whatsappOnly ? "whatsapp" : "email");
  const [templateName, setTemplateName] = useState(templates?.[0]?.name || "");
  const selectedTemplate = templates?.find((item) => item.name === templateName);
  const defaultRecipients = session?.emailRecipientRoles?.length ? session.emailRecipientRoles : ["father", "mother", "student"];
  return (
    <form className="grid attendance-message-grid">
      <input type="hidden" name="sessionId" value={sessionId} />
      {!whatsappOnly ? <div className="attendance-channel-switch" style={{ gridColumn: "1 / -1" }}>
        <b>ערוץ שליחה</b>
        <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
          <label className={`attendance-filter-chip${channel === "email" ? " active" : ""}`}>
            <input type="radio" name="channel" value="email" checked={channel === "email"} onChange={() => setChannel("email")} /> מייל
          </label>
          <label className={`attendance-filter-chip${channel === "whatsapp" ? " active" : ""}`}>
            <input type="radio" name="channel" value="whatsapp" checked={channel === "whatsapp"} onChange={() => setChannel("whatsapp")} /> WhatsApp
          </label>
        </div>
      </div> : null}

      {channel === "email" ? (
        <>
          <label style={{ gridColumn: "1 / -1" }}><span className="muted">נושא המייל</span><input name="emailSubject" defaultValue={session?.emailSubject || ""} placeholder="לדוגמה: עדכון נוכחות למפגש מנהל" /></label>
          <label style={{ gridColumn: "1 / -1" }}><span className="muted">טקסט ההודעה</span><textarea name="personalMessage" rows={4} defaultValue={session?.personalMessage || ""} placeholder="טקסט חופשי למייל" /></label>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>סטטוסים שאפשר לעדכן מתוך ההודעה</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{statusOptions.map(([value, label]) => <label key={`email-status-${value}`} className="attendance-filter-chip"><input type="checkbox" name="emailResponseStatuses" value={value} defaultChecked={session?.emailResponseStatuses?.includes(value)} />{label}</label>)}</div>
          </div>
          <RecipientRoles defaultValues={defaultRecipients} name="emailRecipientRoles" />
          <TargetStatuses statusOptions={statusOptions} />
          <div className="quick-actions"><SubmitButton formAction={saveAction}>שמור הודעה</SubmitButton><SubmitButton formAction={emailAction} primary>שלח מיילים למפגש</SubmitButton></div>
        </>
      ) : (
        <>
          <label style={{ gridColumn: "1 / -1" }}><span className="muted">תבנית WhatsApp מאושרת</span><select name="whatsappTemplateName" value={templateName} onChange={(event) => setTemplateName(event.target.value)} required><option value="">בחר תבנית</option>{(templates || []).map((template) => <option key={`${template.name}:${template.language}`} value={template.name}>{template.name} ({template.language})</option>)}</select></label>
          {!templates?.length ? <div className="error" style={{ gridColumn: "1 / -1" }}>לא נמצאו תבניות WhatsApp מאושרות. יש לחבר את Dualhook ולוודא שלתבניות יש סטטוס מאושר.</div> : null}
          {selectedTemplate?.bodyText ? <div className="muted" style={{ gridColumn: "1 / -1" }}>תצוגה מקדימה: {selectedTemplate.bodyText}</div> : null}
          <input type="hidden" name="whatsappTemplateLanguage" value={selectedTemplate?.language || "he"} />
          <RecipientRoles defaultValues={defaultRecipients} name="whatsappRecipientRoles" whatsappOnly />
          <TargetStatuses statusOptions={statusOptions} name="whatsappTargetStatuses" />
          <div style={{ gridColumn: "1 / -1" }} className="attendance-whatsapp-note">WhatsApp נשלח רק לפי תבנית שאושרה ב־Dualhook/Meta. הטקסט והמשתנים נקבעים לפי התבנית.</div>
          <div className="quick-actions"><SubmitButton formAction={whatsappAction} primary>שלח WhatsApp לפי התבנית</SubmitButton></div>
        </>
      )}
    </form>
  );
}

function RecipientRoles({ defaultValues, name, whatsappOnly = false }) {
  const roles = whatsappOnly ? [["student", "תלמיד"], ["father", "אב"], ["mother", "אם"]] : [["student", "תלמיד"], ["father", "אב"], ["mother", "אם"]];
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}><b>למי שולחים</b><div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{roles.map(([value, label]) => <label key={`${name}-${value}`} className="attendance-filter-chip"><input type="checkbox" name={name} value={value} defaultChecked={defaultValues.includes(value)} />{label}</label>)}</div></div>;
}

function TargetStatuses({ statusOptions, name = "targetStatuses" }) {
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}><b>שלח לסטטוסים</b><div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{statusOptions.map(([value, label]) => <label key={`${name}-${value}`} className="attendance-filter-chip"><input type="checkbox" name={name} value={value} defaultChecked={value === "missing"} />{label}</label>)}</div></div>;
}
