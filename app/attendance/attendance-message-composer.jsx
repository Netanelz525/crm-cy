"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

const VARIABLE_SOURCES = [
  ["recipient_name", "שם הנמען והתואר"],
  ["student_name", "שם התלמיד והתואר"],
  ["meeting_title", "שם המפגש"],
  ["meeting_date", "תאריך המפגש"],
  ["attendance_status", "הסטטוס הנוכחי"],
  ["response_status_1", "סטטוס תשובה ראשון"],
  ["response_status_2", "סטטוס תשובה שני"],
  ["institution", "שם המוסד"],
  ["free_text", "טקסט חופשי" ]
];

function initialSource(template, index) {
  const name = String(template?.name || "");
  if (name.startsWith("general_person")) return index === 1 ? "recipient_name" : "free_text";
  if (name.startsWith("parent_meeting")) {
    return ["recipient_name", "meeting_title", "free_text", "response_status_1", "response_status_2"][index - 1] || "free_text";
  }
  if (name.startsWith("attendance_status") || name.startsWith("attendance_parent")) {
    return ["recipient_name", "meeting_title", "free_text", "student_name", "response_status_1", "response_status_2"][index - 1] || "free_text";
  }
  return ["recipient_name", "meeting_title", "free_text", "response_status_1", "response_status_2"][index - 1] || "free_text";
}

const PREVIEW_VALUES = {
  recipient_name: "[שם הנמען והתואר]",
  student_name: "[שם התלמיד והתואר]",
  class: "[שיעור]",
  meeting_title: "[שם המפגש]",
  meeting_date: "[תאריך]",
  attendance_status: "[סטטוס]",
  response_status_1: "[סטטוס תשובה ראשון]",
  response_status_2: "[סטטוס תשובה שני]",
  institution: "[מוסד]"
};

const VARIABLE_SOURCE_LABELS = Object.fromEntries(VARIABLE_SOURCES);

function TemplatePreview({ template, sourceFor, variableSettings, responseStatusLabels }) {
  const bodyVariables = new Map((template?.bodyVariables || []).map((item) => [Number(item.index), item]));
  const parts = String(template?.bodyText || "").split(/(\{\{\d+\}\})/g);
  return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.9 }}>
    {parts.map((part, partIndex) => {
      const match = part.match(/^\{\{(\d+)\}\}$/);
      if (!match) return <span key={`text-${partIndex}`}>{part}</span>;
      const index = Number(match[1]);
      const source = sourceFor(index);
      const isFreeText = source === "free_text";
      const variable = bodyVariables.get(index);
      const value = isFreeText
        ? (variableSettings[index]?.value || variable?.example || `[טקסט ${index}]`)
        : source === "response_status_1" ? (responseStatusLabels[0] || PREVIEW_VALUES[source])
        : source === "response_status_2" ? (responseStatusLabels[1] || PREVIEW_VALUES[source])
        : PREVIEW_VALUES[source] || `[שדה ${index}]`;
      return <span
        key={`variable-${index}-${partIndex}`}
        title={`${VARIABLE_SOURCE_LABELS[source] || "שדה"} · ${isFreeText ? "ניתן לעריכה כללית" : "מוזן אוטומטית מהמערכת"}`}
        style={{
          display: "inline-block",
          padding: "1px 7px",
          margin: "0 2px",
          borderRadius: 7,
          fontWeight: 700,
          color: isFreeText ? "#7c2d12" : "#075985",
          background: isFreeText ? "#ffedd5" : "#e0f2fe",
          border: `1px solid ${isFreeText ? "#fdba74" : "#7dd3fc"}`
        }}
      >{value}</span>;
    })}
  </div>;
}

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
  const [responseStatuses, setResponseStatuses] = useState([]);
  const selectedTemplate = templates?.find((item) => item.name === templateName);
  const sourceFor = (index) => variableSettings[index]?.source || initialSource(selectedTemplate, index);
  const valueFor = (variable) => variableSettings[variable.index]?.value || variable.example || "";
  const defaultRecipients = session?.emailRecipientRoles?.length ? session.emailRecipientRoles : ["father", "mother", "student"];
  const responseStatusLabels = responseStatuses.map((value) => statusOptions.find(([status]) => status === value)?.[1] || value);
  const templateVariables = selectedTemplate?.bodyVariables || [];
  const editableVariables = templateVariables.filter((variable) => sourceFor(variable.index) === "free_text");
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
            <div className="quick-actions" style={{ justifyContent: "flex-start" }}>
              <span style={{ color: "#075985", background: "#e0f2fe", border: "1px solid #7dd3fc", borderRadius: 999, padding: "4px 10px" }}>כחול — מוזן אוטומטית מהמערכת</span>
              <span style={{ color: "#7c2d12", background: "#ffedd5", border: "1px solid #fdba74", borderRadius: 999, padding: "4px 10px" }}>כתום — טקסט חופשי שניתן לשנות</span>
            </div>
            {selectedTemplate.requiresImage ? <div className="muted">🖼️ תמונה תוצג בראש ההודעה</div> : null}
            <TemplatePreview template={selectedTemplate} sourceFor={sourceFor} variableSettings={variableSettings} responseStatusLabels={responseStatusLabels} />
            {selectedTemplate.footerText ? <small className="muted">{selectedTemplate.footerText}</small> : null}
            {selectedTemplate.buttons?.length ? <div className="quick-actions">{selectedTemplate.buttons.map((button, index) => <span className="attendance-filter-chip" key={`${button.text}-${index}`}>{button.text}</span>)}</div> : null}
          </div> : null}
          <input type="hidden" name="whatsappTemplateLanguage" value={selectedTemplate?.language || "he"} />
          {templateVariables.map((variable) => <input type="hidden" name={`whatsappVariableSource_${variable.index}`} value={sourceFor(variable.index)} key={`wa-source-${variable.index}`} />)}
          {editableVariables.length ? <div style={{ gridColumn: "1 / -1", display: "grid", gap: 12 }}>
            <b>טקסטים חופשיים בתבנית</b>
            <span className="muted">מוצגים כאן רק הטקסטים שניתן לערוך. שאר הפרטים מוזנים אוטומטית מהמערכת.</span>
            {editableVariables.map((variable) => <label className="card" key={`wa-variable-${variable.index}`} style={{ display: "grid", gap: 7 }}>
              <span className="muted">טקסט חופשי {variable.example ? `(דוגמה: ${variable.example})` : ""}</span>
              <input name={`whatsappVariableValue_${variable.index}`} value={valueFor(variable)} required onChange={(event) => setVariableSettings((current) => ({ ...current, [variable.index]: { ...current[variable.index], value: event.target.value } }))} />
            </label>)}
          </div> : null}
          {selectedTemplate?.requiresImage ? <label style={{ gridColumn: "1 / -1" }}><span className="muted">תמונה לתבנית (JPG או PNG, עד 5MB)</span><input type="file" name="whatsappTemplateImage" accept="image/jpeg,image/png" required /></label> : null}
          <RecipientRoles defaultValues={defaultRecipients} name="whatsappRecipientRoles" whatsappOnly />
          <ResponseStatuses statusOptions={statusOptions} template={selectedTemplate} selected={responseStatuses} setSelected={setResponseStatuses} />
          <TargetStatuses statusOptions={statusOptions} name="whatsappTargetStatuses" />
          <div style={{ gridColumn: "1 / -1" }} className="attendance-whatsapp-note">השליחה מתבצעת רק במסלול התפוצה האנושי ובאמצעות תבנית שאושרה ב־Dualhook/Meta.</div>
          <div className="quick-actions"><SubmitButton formAction={whatsappAction} primary>שלח WhatsApp לפי התבנית</SubmitButton></div>
        </>
      )}
    </form>
  );
}

function ResponseStatuses({ statusOptions, template, selected, setSelected }) {
  const quickReplyCount = (template?.buttons || []).filter((button) => String(button?.type || "").toUpperCase() === "QUICK_REPLY").length;
  const buttons = (template?.buttons || []).filter((button) => String(button?.type || "").toUpperCase() === "QUICK_REPLY").slice(0, 2);
  const toggle = (value) => setSelected((current) => current.includes(value)
    ? current.filter((item) => item !== value)
    : current.length < 2 ? [...current, value] : current);
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
    <b>שני סטטוסים לעדכון מצב הנוכחות מתוך WhatsApp</b>
    <span className="muted">לחיצה על אחד משני כפתורי התבנית תעדכן מיד את הסטטוס של התלמיד ברשומת המפגש.</span>
    {template && quickReplyCount < 2 ? <div className="error">לתבנית הזו אין שני כפתורי תשובה מהירה. יש לבחור תבנית עם שני כפתורים כדי לאפשר עדכון נוכחות.</div> : null}
    {selected.map((value) => <input type="hidden" name="whatsappResponseStatuses" value={value} key={`selected-response-${value}`} />)}
    <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{statusOptions.map(([value, label]) => <label key={`whatsapp-response-${value}`} className={`attendance-filter-chip${selected.includes(value) ? " active" : ""}`}><input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />{label}</label>)}</div>
    {selected.length ? <div className="card" style={{ display: "grid", gap: 6 }}>
      {selected.map((value, index) => <div key={`button-map-${value}`}><b>{buttons[index]?.text || `כפתור ${index + 1}`}</b> ← יעדכן את מצב הנוכחות ל־<b>{statusOptions.find(([status]) => status === value)?.[1] || value}</b></div>)}
      {selected.length < 2 ? <small className="muted">יש לבחור עוד סטטוס אחד.</small> : null}
    </div> : null}
  </div>;
}

function RecipientRoles({ defaultValues, name, whatsappOnly = false }) {
  const roles = whatsappOnly ? [["student", "תלמיד"], ["father", "אב"], ["mother", "אם"]] : [["student", "תלמיד"], ["father", "אב"], ["mother", "אם"]];
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}><b>למי שולחים</b><div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{roles.map(([value, label]) => <label key={`${name}-${value}`} className="attendance-filter-chip"><input type="checkbox" name={name} value={value} defaultChecked={defaultValues.includes(value)} />{label}</label>)}</div></div>;
}

function TargetStatuses({ statusOptions, name = "targetStatuses" }) {
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}><b>שלח לסטטוסים</b><div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{statusOptions.map(([value, label]) => <label key={`${name}-${value}`} className="attendance-filter-chip"><input type="checkbox" name={name} value={value} defaultChecked={value === "missing"} />{label}</label>)}</div></div>;
}
