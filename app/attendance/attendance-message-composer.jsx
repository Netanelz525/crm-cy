"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

const VARIABLE_SOURCES = [
  ["recipient_name", "שם הנמען והתואר"],
  ["student_name", "שם התלמיד והתואר"],
  ["class", "שיעור/כיתה"],
  ["meeting_title", "שם המפגש"],
  ["meeting_date", "תאריך המפגש"],
  ["attendance_status", "הסטטוס הנוכחי"],
  ["institution", "שם המוסד"],
  ["free_text", "טקסט חופשי" ]
];

function initialSource(template, index) {
  const name = String(template?.name || "");
  if (name.startsWith("general_person")) return index === 1 ? "recipient_name" : "free_text";
  if (name.startsWith("attendance_status") || name.startsWith("attendance_parent")) {
    return ["recipient_name", "meeting_title", "free_text", "student_name", "free_text", "free_text"][index - 1] || "free_text";
  }
  return ["student_name", "class", "meeting_title", "meeting_date", "attendance_status", "institution"][index - 1] || "free_text";
}

const PREVIEW_VALUES = {
  recipient_name: "[שם הנמען והתואר]",
  student_name: "[שם התלמיד והתואר]",
  class: "[שיעור]",
  meeting_title: "[שם המפגש]",
  meeting_date: "[תאריך]",
  attendance_status: "[סטטוס]",
  institution: "[מוסד]"
};

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
  const [variableSettings, setVariableSettings] = useState({});
  const selectedTemplate = templates?.find((item) => item.name === templateName);
  const sourceFor = (index) => variableSettings[index]?.source || initialSource(selectedTemplate, index);
  const valueFor = (variable) => variableSettings[variable.index]?.value || variable.example || "";
  const previewText = String(selectedTemplate?.bodyText || "").replace(/\{\{(\d+)\}\}/g, (_, rawIndex) => {
    const index = Number(rawIndex);
    const source = sourceFor(index);
    return source === "free_text"
      ? (variableSettings[index]?.value || selectedTemplate?.bodyVariables?.find((item) => item.index === index)?.example || `[טקסט ${index}]`)
      : PREVIEW_VALUES[source] || `[שדה ${index}]`;
  });
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
          <label style={{ gridColumn: "1 / -1" }}><span className="muted">תבנית WhatsApp מאושרת</span><select name="whatsappTemplateName" value={templateName} onChange={(event) => { setTemplateName(event.target.value); setVariableSettings({}); }} required><option value="">בחר תבנית</option>{(templates || []).map((template) => <option key={`${template.name}:${template.language}`} value={template.name}>{template.name} ({template.language})</option>)}</select></label>
          {!templates?.length ? <div className="error" style={{ gridColumn: "1 / -1" }}>לא נמצאו תבניות WhatsApp מאושרות. יש לחבר את Dualhook ולוודא שלתבניות יש סטטוס מאושר.</div> : null}
          {selectedTemplate ? <div className="card" style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
            <b>תצוגה מקדימה</b>
            {selectedTemplate.requiresImage ? <div className="muted">🖼️ תמונה תוצג בראש ההודעה</div> : null}
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{previewText}</div>
            {selectedTemplate.footerText ? <small className="muted">{selectedTemplate.footerText}</small> : null}
            {selectedTemplate.buttons?.length ? <div className="quick-actions">{selectedTemplate.buttons.map((button, index) => <span className="attendance-filter-chip" key={`${button.text}-${index}`}>{button.text}</span>)}</div> : null}
          </div> : null}
          <input type="hidden" name="whatsappTemplateLanguage" value={selectedTemplate?.language || "he"} />
          {selectedTemplate?.bodyVariables?.length ? <div style={{ gridColumn: "1 / -1", display: "grid", gap: 12 }}>
            <b>שדות התבנית</b>
            <span className="muted">לכל שדה אפשר לבחור מידע אוטומטי מהרשומה או להזין טקסט חופשי שאינו מגיע מהתלמיד.</span>
            {selectedTemplate.bodyVariables.map((variable) => {
              const source = sourceFor(variable.index);
              return <div className="card" key={`wa-variable-${variable.index}`} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(220px, 2fr)", gap: 10, alignItems: "end" }}>
                <label><span className="muted">שדה {`{{${variable.index}}}`}</span><select name={`whatsappVariableSource_${variable.index}`} value={source} onChange={(event) => setVariableSettings((current) => ({ ...current, [variable.index]: { ...current[variable.index], source: event.target.value } }))}>{VARIABLE_SOURCES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label><span className="muted">ערך חופשי {variable.example ? `(דוגמה: ${variable.example})` : ""}</span><input name={`whatsappVariableValue_${variable.index}`} value={valueFor(variable)} disabled={source !== "free_text"} required={source === "free_text"} onChange={(event) => setVariableSettings((current) => ({ ...current, [variable.index]: { ...current[variable.index], value: event.target.value } }))} /></label>
              </div>;
            })}
          </div> : null}
          {selectedTemplate?.requiresImage ? <label style={{ gridColumn: "1 / -1" }}><span className="muted">תמונה לתבנית (JPG או PNG, עד 5MB)</span><input type="file" name="whatsappTemplateImage" accept="image/jpeg,image/png" required /></label> : null}
          <RecipientRoles defaultValues={defaultRecipients} name="whatsappRecipientRoles" whatsappOnly />
          <TargetStatuses statusOptions={statusOptions} name="whatsappTargetStatuses" />
          <div style={{ gridColumn: "1 / -1" }} className="attendance-whatsapp-note">השליחה מתבצעת רק במסלול התפוצה האנושי ובאמצעות תבנית שאושרה ב־Dualhook/Meta.</div>
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
