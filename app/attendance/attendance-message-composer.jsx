"use client";

import { useEffect, useState } from "react";
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
  const [templateValues, setTemplateValues] = useState({});
  const [responseStatusValues, setResponseStatusValues] = useState([]);
  const defaultRecipients = session?.emailRecipientRoles?.length ? session.emailRecipientRoles : ["father", "mother", "student"];

  useEffect(() => {
    const count = Number(selectedTemplate?.parameterCount) || 0;
    setTemplateValues((current) => Object.fromEntries(
      Array.from({ length: count }, (_, index) => [String(index + 1), current[String(index + 1)] || ""])
    ));
  }, [selectedTemplate?.name, selectedTemplate?.parameterCount]);
  useEffect(() => setResponseStatusValues([]), [selectedTemplate?.name]);
  return (
    <form className="grid attendance-message-grid" encType="multipart/form-data">
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
          <label style={{ gridColumn: "1 / -1" }}><span className="muted">תבנית WhatsApp מאושרת של בוט התפוצה (Dualhook)</span><select name="whatsappTemplateName" value={templateName} onChange={(event) => setTemplateName(event.target.value)} required><option value="">בחר תבנית</option>{(templates || []).map((template) => <option key={`${template.name}:${template.language}`} value={template.name}>{template.name} ({template.language})</option>)}</select></label>
          {!templates?.length ? <div className="error" style={{ gridColumn: "1 / -1" }}>לא נמצאו תבניות מאושרות של בוט התפוצה ב־Dualhook. ודא שהן מאושרות ושחיבור Dualhook מוגדר.</div> : null}
          {selectedTemplate ? <WhatsAppTemplatePreview template={selectedTemplate} values={templateValues} responseStatusLabels={responseStatusValues.map((value) => statusOptions.find(([candidate]) => candidate === value)?.[1]).filter(Boolean)} /> : null}
          {selectedTemplate?.parameterCount ? (
            <div className="whatsapp-template-inputs">
              <div>
                <b>נתוני התבנית</b>
                <span className="muted">המערכת מפרידה בין נתונים שמגיעים אוטומטית מהתלמיד או מהמפגש לבין שדות פתוחים לתוכן אישי.</span>
              </div>
              <div className="whatsapp-template-input-grid">
                {(selectedTemplate.parameterDefinitions || defaultParameterDefinitions(selectedTemplate)).map((definition) => {
                  const key = String(definition.index);
                  const automatic = definition.source !== "free";
                  return <label key={`template-value-${key}`} className={automatic ? "whatsapp-template-auto-field" : ""}>
                    <span>{`{{${key}}}`} · {definition.label}</span>
                    {automatic
                      ? <small className="muted">מילוי אוטומטי: {sourceLabel(definition.source)}</small>
                      : <input name={`whatsappTemplateValue_${key}`} value={templateValues[key] || ""} onChange={(event) => setTemplateValues((current) => ({ ...current, [key]: event.target.value }))} placeholder="תוכן אישי שיופיע לכל הנמענים" />}
                  </label>;
                })}
              </div>
            </div>
          ) : null}
          {selectedTemplate?.headerFormat === "IMAGE" ? (
            <label style={{ gridColumn: "1 / -1" }}>
              <span className="muted">תמונה לצירוף לתבנית</span>
              <input type="file" name="whatsappTemplateImage" accept="image/jpeg,image/png" required />
              <small className="muted">התבנית מאושרת לקבלת תמונת JPG או PNG עד 5MB.</small>
            </label>
          ) : null}
          <input type="hidden" name="whatsappTemplateLanguage" value={selectedTemplate?.language || "he"} />
          <RecipientRoles defaultValues={defaultRecipients} name="whatsappRecipientRoles" whatsappOnly />
          <TargetStatuses statusOptions={statusOptions} name="whatsappTargetStatuses" />
          {selectedTemplate?.buttonLabels?.length ? <ResponseStatuses statusOptions={statusOptions} buttonLabels={selectedTemplate.buttonLabels} selectedValues={responseStatusValues} onChange={setResponseStatusValues} /> : <div className="muted" style={{ gridColumn: "1 / -1" }}>לתבנית הזו אין כפתורי תגובה.</div>}
          <div style={{ gridColumn: "1 / -1" }} className="attendance-whatsapp-note">השליחה מתבצעת דרך בוט התפוצה של Dualhook בלבד. הבוט התפעולי הוא מסלול נפרד; הטקסט והמשתנים נקבעים לפי תבנית WhatsApp שאושרה.</div>
          <div className="quick-actions"><SubmitButton formAction={whatsappAction} primary>שלח WhatsApp לפי התבנית</SubmitButton></div>
        </>
      )}
    </form>
  );
}

function WhatsAppTemplatePreview({ template, values = {}, responseStatusLabels = [] }) {
  const components = Array.isArray(template?.components) ? template.components : [];
  const header = components.find((component) => String(component?.type || "").toLowerCase() === "header");
  const body = components.find((component) => String(component?.type || "").toLowerCase() === "body");
  const footer = components.find((component) => String(component?.type || "").toLowerCase() === "footer");
  const buttons = components.find((component) => String(component?.type || "").toLowerCase() === "buttons");
  const bodyText = body?.text || template.bodyText || "";
  const parameterMatches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
  const definitions = template.parameterDefinitions || defaultParameterDefinitions(template);
  const previewText = bodyText.replace(/\{\{(\d+)\}\}/g, (_, number) => {
    const definition = definitions.find((item) => String(item.index) === String(number));
    if (definition?.source?.startsWith("responseStatus:")) {
      const index = Number(definition.source.split(":")[1]) - 1;
      return responseStatusLabels[index] || `‹${definition.label}›`;
    }
    return values[number]?.trim() || (definition?.source === "free" ? `‹${definition.label}›` : `‹${definition?.label || "נתון אוטומטי"}›`);
  });
  const headerFormat = String(header?.format || "").toUpperCase();
  const mediaLabels = { IMAGE: "תמונה", VIDEO: "סרטון", DOCUMENT: "מסמך" };
  const headerText = headerFormat === "TEXT" ? header?.text : headerFormat ? `כותרת ${mediaLabels[headerFormat] || headerFormat.toLowerCase()}` : "";
  const buttonLabels = Array.isArray(buttons?.buttons)
    ? buttons.buttons.map((button) => button?.text || button?.type).filter(Boolean)
    : [];

  return (
    <section className="whatsapp-template-preview" aria-label="תצוגה מקדימה של תבנית WhatsApp">
      <div className="whatsapp-template-preview-heading">
        <div>
          <b>איך ההודעה תיראה</b>
          <span className="muted">תבנית מאושרת עם נתונים אישיים במקום המשתנים</span>
        </div>
        <span className="whatsapp-template-status">מאושרת</span>
      </div>
      <div className="whatsapp-message-bubble">
        {headerText ? <strong className="whatsapp-message-header">{headerText}</strong> : null}
        <div className="whatsapp-message-body">{previewText || "לתבנית אין טקסט להצגה"}</div>
        {footer?.text ? <small className="whatsapp-message-footer">{footer.text}</small> : null}
        {buttonLabels.length ? <div className="whatsapp-message-buttons">{buttonLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div> : null}
      </div>
      <div className="whatsapp-template-capabilities">
        <b>מה אפשר לשלוח בתבנית הזו</b>
        <div className="whatsapp-template-capability-list">
          <span>✓ תוכן אישי: {parameterMatches.length ? `${parameterMatches.length} משתנים` : "ללא משתנים"}</span>
          <span>✓ {header ? `כותרת ${headerFormat === "TEXT" ? "טקסט" : "מדיה"}` : "ללא כותרת"}</span>
          <span>✓ {buttonLabels.length ? `${buttonLabels.length} כפתורים` : "ללא כפתורים"}</span>
        </div>
        <div className="whatsapp-template-parameter-list">
          <b>הנתונים שיוזנו אוטומטית</b>
          {parameterMatches.length ? (
            <div className="whatsapp-template-capability-list">
              {parameterMatches.map((match) => {
                const definition = definitions.find((item) => String(item.index) === String(match[1]));
                return <span key={`parameter-${match[1]}`}>{`{{${match[1]}}}`} · {definition?.source === "free" ? `שדה פתוח: ${definition.label}` : `אוטומטי: ${definition?.label || "נתוני תלמיד/מפגש"}`}</span>;
              })}
            </div>
          ) : <span className="muted">אין משתנים אישיים בתבנית.</span>}
        </div>
        {parameterMatches.length ? <p className="muted">שדות אוטומטיים מתמלאים בנפרד לכל נמען. שדות פתוחים, אם קיימים, יופיעו באותו ערך לכל הנמענים. הטקסט והכפתורים נשארים לפי מבנה התבנית שאושרה.</p> : null}
      </div>
    </section>
  );
}

function RecipientRoles({ defaultValues, name, whatsappOnly = false }) {
  const roles = whatsappOnly ? [["student", "תלמיד"], ["father", "אב"], ["mother", "אם"]] : [["student", "תלמיד"], ["father", "אב"], ["mother", "אם"]];
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}><b>למי שולחים</b><div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{roles.map(([value, label]) => <label key={`${name}-${value}`} className="attendance-filter-chip"><input type="checkbox" name={name} value={value} defaultChecked={defaultValues.includes(value)} />{label}</label>)}</div></div>;
}

function TargetStatuses({ statusOptions, name = "targetStatuses" }) {
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}><b>שלח לסטטוסים</b><div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{statusOptions.map(([value, label]) => <label key={`${name}-${value}`} className="attendance-filter-chip"><input type="checkbox" name={name} value={value} defaultChecked={value === "missing"} />{label}</label>)}</div></div>;
}

function ResponseStatuses({ statusOptions, buttonLabels = [], selectedValues = [], onChange }) {
  const limit = buttonLabels.length;
  const toggle = (value) => {
    const next = selectedValues.includes(value)
      ? selectedValues.filter((item) => item !== value)
      : selectedValues.length < limit ? [...selectedValues, value] : selectedValues;
    onChange(next);
  };
  return <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}><b>סטטוסים לעדכון באמצעות כפתורים</b><span className="muted">יש לבחור {limit} {limit === 1 ? "סטטוס" : "סטטוסים"}. אי אפשר לבחור יותר ממספר הכפתורים בתבנית.</span><div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>{statusOptions.map(([value, label]) => <label key={`whatsapp-response-${value}`} className={`attendance-filter-chip${selectedValues.includes(value) ? " active" : ""}`}><input type="checkbox" name="whatsappResponseStatuses" value={value} checked={selectedValues.includes(value)} onChange={() => toggle(value)} disabled={!selectedValues.includes(value) && selectedValues.length >= limit} />{label}</label>)}</div><div className="whatsapp-template-button-map">{buttonLabels.map((label, index) => <span key={`${label}-${index}`}>כפתור {index + 1}: {selectedValues[index] ? statusOptions.find(([value]) => value === selectedValues[index])?.[1] : "לא נבחר"} · {label}</span>)}</div></div>;
}

function defaultParameterDefinitions(template) {
  return Array.from({ length: Number(template?.parameterCount) || 0 }, (_, index) => ({ index: index + 1, source: "free", label: `שדה פתוח ${index + 1}`, editable: true }));
}

function sourceLabel(source) {
  if (source?.startsWith("responseStatus:")) return `סטטוס שנבחר (${source.split(":")[1]})`;
  return { recipient: "הנמען", student: "התלמיד", class: "שיעור התלמיד", session: "המפגש", date: "תאריך המפגש", status: "סטטוס נוכחי", institution: "המוסד" }[source] || "המערכת";
}
