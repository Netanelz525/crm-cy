"use client";

import { useMemo, useState } from "react";
import { WHATSAPP_TEMPLATE_PURPOSES, WHATSAPP_TEMPLATE_SOURCES } from "../../../lib/whatsapp-template-config-shared";

const roles = { student: "תלמיד", father: "אבא", mother: "אמא" };
const mediaLabels = { none: "ללא קובץ", image: "תמונה", document: "מסמך" };

function safeConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function MappingRow({ mapping, onChange, onRemove }) {
  return (
    <div className="whatsapp-template-mapping-row">
      <span className="meta-chip">{mapping.parameterName || `פרמטר ${mapping.index}`}</span>
      <select value={mapping.source || "free_text"} onChange={(event) => onChange({ ...mapping, source: event.target.value })}>
        {Object.entries(WHATSAPP_TEMPLATE_SOURCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {mapping.source === "free_text" ? <input value={mapping.value || ""} onChange={(event) => onChange({ ...mapping, value: event.target.value })} placeholder="ערך ברירת מחדל (רשות)" /> : null}
      <button type="button" className="quick-action-btn quick-action-outline" onClick={onRemove}>הסר</button>
    </div>
  );
}

export default function WhatsAppTemplateManager({ templates, saveAction }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => templates.filter((template) => `${template.name} ${template.bodyText}`.toLowerCase().includes(query.toLowerCase())), [templates, query]);
  return (
    <section className="whatsapp-template-manager">
      <div className="card glass whatsapp-template-toolbar">
        <div>
          <h2 style={{ margin: 0 }}>תבניות מאושרות לתפוצה</h2>
          <p className="muted" style={{ marginBottom: 0 }}>הצד של Dualhook מציג מה אושר. הצד של ה-CRM מגדיר למי לשלוח, איזה נתון להכניס בכל פרמטר ואיזה קובץ נדרש.</p>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש תבנית" aria-label="חיפוש תבנית" />
      </div>
      <div className="whatsapp-template-list">
        {filtered.map((template) => <TemplateCard key={`${template.name}:${template.language}`} template={template} saveAction={saveAction} />)}
      </div>
    </section>
  );
}

function TemplateCard({ template, saveAction }) {
  const [config, setConfig] = useState(() => safeConfig(template.crmConfig));
  const [saved, setSaved] = useState(false);
  const set = (patch) => { setConfig((current) => ({ ...current, ...patch })); setSaved(false); };
  const updateMapping = (index, mapping) => set({ parameterMappings: config.parameterMappings.map((item, itemIndex) => itemIndex === index ? mapping : item) });
  const save = async (event) => { event.preventDefault(); await saveAction(new FormData(event.currentTarget)); setSaved(true); };
  return (
    <details className="card whatsapp-template-card">
      <summary>
        <span><strong>{template.name}</strong><small>{template.language} · {template.status} · {template.category || "WhatsApp"}</small></span>
        <span className="meta-chip">{template.requiresMedia ? `נדרש ${mediaLabels[config.mediaType] || "קובץ"}` : "ללא מדיה"}</span>
      </summary>
      <div className="whatsapp-template-card-grid">
        <section className="whatsapp-template-provider">
          <h3>מה אושר ב-Dualhook</h3>
          <div className="template-preview-box"><b>תוכן התבנית</b><p>{template.bodyText || "לא הוחזר טקסט תבנית מהספק"}</p></div>
          <div className="template-facts">
            <span>פרמטרים: {template.bodyParameterCount}</span>
            <span>כותרת: {template.headerFormat || "ללא"}</span>
            <span>כפתורים: {template.buttonLabels?.join(" | ") || "אין"}</span>
          </div>
          {template.footerText ? <p className="muted">Footer: {template.footerText}</p> : null}
        </section>
        <form onSubmit={save} className="whatsapp-template-config">
          <h3>איך ה-CRM משתמש בתבנית</h3>
          <input type="hidden" name="config" value={JSON.stringify(config)} readOnly />
          <label>מטרת התבנית<select value={config.purpose} onChange={(event) => set({ purpose: event.target.value })}>{Object.entries(WHATSAPP_TEMPLATE_PURPOSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>תיאור פנימי<textarea value={config.internalDescription || ""} onChange={(event) => set({ internalDescription: event.target.value })} placeholder="מה התבנית עושה במערכת" /></label>
          <div className="checkbox-row"><label><input type="checkbox" checked={config.enabled} onChange={(event) => set({ enabled: event.target.checked })} /> פעילה</label><label><input type="checkbox" checked={config.preferred} onChange={(event) => set({ preferred: event.target.checked })} /> מועדפת</label></div>
          <fieldset><legend>נמענים</legend><div className="checkbox-row">{Object.entries(roles).map(([value, label]) => <label key={value}><input type="checkbox" checked={config.recipientRoles.includes(value)} onChange={(event) => set({ recipientRoles: event.target.checked ? [...config.recipientRoles, value] : config.recipientRoles.filter((role) => role !== value) })} /> {label}</label>)}</div></fieldset>
          <label>קובץ מצורף<select value={config.mediaType} onChange={(event) => set({ mediaType: event.target.value })}>{Object.entries(mediaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <fieldset><legend>מיפוי פרמטרים</legend>{config.parameterMappings.length ? config.parameterMappings.map((mapping, index) => <MappingRow key={`${mapping.index}-${index}`} mapping={mapping} onChange={(next) => updateMapping(index, next)} onRemove={() => set({ parameterMappings: config.parameterMappings.filter((_, itemIndex) => itemIndex !== index) })} />) : <p className="muted">לתבנית אין פרמטרים.</p>}</fieldset>
          {config.buttonMappings.length ? <fieldset><legend>מיפוי כפתורים</legend>{config.buttonMappings.map((button, index) => <div className="whatsapp-template-mapping-row" key={`${button.index}-${index}`}><span className="meta-chip">{button.label || `כפתור ${index + 1}`}</span><select value={button.source || ""} onChange={(event) => set({ buttonMappings: config.buttonMappings.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value } : item) })}><option value="">ללא עדכון</option><option value="response_status_1">סטטוס כפתור 1</option><option value="response_status_2">סטטוס כפתור 2</option></select></div>)}</fieldset> : null}
          <button className="primary-btn" type="submit">שמור הגדרות לתבנית</button>{saved ? <span className="success-text">נשמר</span> : null}
        </form>
      </div>
    </details>
  );
}
