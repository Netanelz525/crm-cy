"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { WHATSAPP_TEMPLATE_PURPOSES, WHATSAPP_TEMPLATE_SOURCES } from "../../../lib/whatsapp-template-config-shared";

const roles = { student: "תלמיד", father: "אבא", mother: "אמא" };
const mediaLabels = { none: "ללא קובץ", image: "תמונה", document: "מסמך" };

function copy(value) { return JSON.parse(JSON.stringify(value)); }

export default function WhatsAppTemplateDetailClient({ template, saveAction, testAction, activity = [] }) {
  const [config, setConfig] = useState(() => copy(template.crmConfig));
  const [values, setValues] = useState(() => template.parameterDefinitions.map(() => ""));
  const [testState, runTest] = useActionState(testAction, { ok: false, message: "" });
  const set = (patch) => setConfig((current) => ({ ...current, ...patch }));
  const updateMapping = (index, patch) => set({ parameterMappings: config.parameterMappings.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  return (
    <>
      <section className="card glass whatsapp-template-detail-hero">
        <div>
          <div className="quick-actions"><Link className="quick-action-btn quick-action-outline" href="/admin/whatsapp-templates">חזרה לכל התבניות</Link><Link className="quick-action-btn quick-action-outline" href="/admin/whatsapp-templates/new">יצירת תבנית חדשה</Link></div>
          <h1>{template.displayName || template.name}</h1>
          <p className="muted">כותרת Dualhook: <strong>{template.name}</strong> · {template.language} · {template.category || "WhatsApp"}</p>
        </div>
        <span className={`meta-chip ${template.status === "APPROVED" ? "meta-chip-strong" : ""}`}>{template.status || "ללא סטטוס"}</span>
      </section>

      <div className="whatsapp-template-detail-grid">
        <section className="card glass">
          <h2>מה התקבל מ־Dualhook / Meta</h2>
          <div className="template-preview-box"><b>תוכן התבנית</b><p>{template.bodyText || "לא הוחזר טקסט תבנית מהספק"}</p></div>
          <div className="template-facts"><span>שפה: {template.language}</span><span>סטטוס: {template.status}</span><span>פרמטרים: {template.bodyParameterCount}</span><span>כותרת: {template.headerFormat || "ללא"}</span><span>כפתורים: {template.buttonLabels?.join(" | ") || "אין"}</span></div>
          {template.footerText ? <p className="muted">Footer: {template.footerText}</p> : null}
          <h3>השדות שהתבנית לוקחת</h3>
          <div className="whatsapp-template-parameter-list">{template.parameterDefinitions.length ? template.parameterDefinitions.map((item) => <div className="whatsapp-template-mapping-row" key={item.index}><span className="meta-chip">{item.index}</span><span>{item.parameterName || item.label || `פרמטר ${item.index}`}</span><span className="muted">{item.source || "ערך חופשי"}</span></div>) : <p className="muted">לתבנית אין פרמטרים.</p>}</div>
        </section>

        <form action={saveAction} className="card glass whatsapp-template-config">
          <h2>איך ה־CRM משתמש בתבנית</h2>
          <input type="hidden" name="config" value={JSON.stringify(config)} readOnly />
          <label>כותרת תצוגה פנימית<input value={config.displayName || ""} onChange={(event) => set({ displayName: event.target.value })} placeholder="לדוגמה: הזמנה כללית למפגש" /><small className="muted">הכותרת של הצוות. שם Dualhook מוצג בנפרד ונשאר קבוע לשליחה.</small></label>
          <label>מטרת התבנית<select value={config.purpose} onChange={(event) => set({ purpose: event.target.value })}>{Object.entries(WHATSAPP_TEMPLATE_PURPOSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>תיאור פנימי<textarea value={config.internalDescription || ""} onChange={(event) => set({ internalDescription: event.target.value })} /></label>
          <div className="checkbox-row"><label><input type="checkbox" checked={config.enabled} onChange={(event) => set({ enabled: event.target.checked })} /> פעילה</label><label><input type="checkbox" checked={config.preferred} onChange={(event) => set({ preferred: event.target.checked })} /> מועדפת</label></div>
          <fieldset><legend>נמענים</legend><div className="checkbox-row">{Object.entries(roles).map(([value, label]) => <label key={value}><input type="checkbox" checked={config.recipientRoles.includes(value)} onChange={(event) => set({ recipientRoles: event.target.checked ? [...config.recipientRoles, value] : config.recipientRoles.filter((role) => role !== value) })} /> {label}</label>)}</div></fieldset>
          <label>סוג מדיה<select value={config.mediaType} onChange={(event) => set({ mediaType: event.target.value })}>{Object.entries(mediaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <fieldset><legend>מיפוי פרמטרים</legend>{config.parameterMappings.map((mapping, index) => <div className="whatsapp-template-mapping-row" key={`${mapping.index}-${index}`}><span className="meta-chip">{mapping.parameterName || `פרמטר ${mapping.index}`}</span><select value={mapping.source || "free_text"} onChange={(event) => updateMapping(index, { source: event.target.value })}>{Object.entries(WHATSAPP_TEMPLATE_SOURCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{mapping.source === "free_text" ? <input value={mapping.value || ""} onChange={(event) => updateMapping(index, { value: event.target.value })} placeholder="ערך ברירת מחדל" /> : null}</div>)}</fieldset>
          <button className="primary-btn" type="submit">שמור הגדרות לתבנית</button>
        </form>
      </div>

      <section className="card glass whatsapp-template-test-panel">
        <h2>בדיקת שליחה לתבנית הזו</h2>
        <p className="muted">השליחה מיועדת למספר בדיקה אחד בלבד ועוברת דרך בוט התפוצה של Dualhook.</p>
        <form action={runTest} encType="multipart/form-data" className="grid">
          <input type="hidden" name="templateName" value={template.name} />
          <input type="hidden" name="language" value={template.language} />
          <label>מספר WhatsApp לבדיקה<input name="phone" placeholder="9725XXXXXXXX" required /></label>
          {template.parameterDefinitions.map((item, index) => <label key={item.index}>ערך לפרמטר {item.index}{item.parameterName ? ` · ${item.parameterName}` : ""}<input value={values[index] || ""} onChange={(event) => setValues((current) => current.map((value, valueIndex) => valueIndex === index ? event.target.value : value))} placeholder="ערך שיישלח בבדיקה" /></label>)}
          {template.headerFormat ? <label>קובץ לכותרת ({template.headerFormat})<input type="file" name="media" accept={template.headerFormat === "IMAGE" ? "image/jpeg,image/png" : "application/pdf,image/jpeg,image/png"} required /></label> : null}
          <input type="hidden" name="values" value={JSON.stringify(values)} readOnly />
          <button className="primary-btn" type="submit">שלח הודעת בדיקה</button>
          {testState?.message ? <div className={testState.ok ? "ok" : "error"}>{testState.message}</div> : null}
        </form>
      </section>

      <section className="card glass">
        <h2>היסטוריית תבנית</h2>
        {activity.length ? <div className="whatsapp-template-activity-list">{activity.map((item) => <div className="whatsapp-template-activity-row" key={item.id}><strong>{item.action === "test" ? "בדיקת שליחה" : "יצירת תבנית"}</strong><span>{item.status}</span><small>{item.recipientPhone || ""} · {new Date(item.createdAt).toLocaleString("he-IL")}</small>{item.errorMessage ? <em>{item.errorMessage}</em> : null}</div>)}</div> : <p className="muted">עדיין אין פעילות מתועדת לתבנית.</p>}
      </section>
    </>
  );
}
