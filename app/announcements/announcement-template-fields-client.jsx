"use client";

import { useState } from "react";

function emptyField(required = true) {
  return {
    key: "",
    type: "",
    required,
    maxLength: "",
    templateFieldId: "",
    label: ""
  };
}

export default function AnnouncementTemplateFieldsClient({ fields = [], minRows = 0 }) {
  const [rows, setRows] = useState(() => {
    const initialRows = Array.isArray(fields) ? fields : [];
    const missingRows = Math.max(0, Number(minRows || 0) - initialRows.length);
    return [...initialRows, ...Array.from({ length: missingRows }, () => emptyField())];
  });

  return (
    <div className="announcement-template-fields-editor">
      <input type="hidden" name="fieldCount" value={rows.length} />
      <div className="announcement-template-fields-title">
        <div>
          <strong>שדות התבנית</strong>
          <span className="muted">אפשר לשנות שדות קיימים או להוסיף שדה חדש רק כשצריך.</span>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setRows((current) => [...current, emptyField()])}>
          הוסף שדה
        </button>
      </div>
      <div className="announcement-template-fields-head">
        <span>ID בתבנית Google Docs</span>
        <span>תיאור/תווית למשתמש</span>
      </div>
      {rows.map((field, index) => (
        <div key={`${field.key || "new"}-${index}`} className="announcement-template-field-row">
          <input type="hidden" name={`fieldKey:${index}`} defaultValue={field.key || ""} />
          <input type="hidden" name={`fieldType:${index}`} defaultValue={field.type || ""} />
          <input type="hidden" name={`fieldRequired:${index}`} defaultValue={field.required === false ? "0" : "1"} />
          <input type="hidden" name={`fieldMaxLength:${index}`} defaultValue={field.maxLength || ""} />
          <input name={`fieldTemplateFieldId:${index}`} defaultValue={field.templateFieldId || ""} placeholder="7 / data / name" />
          <input name={`fieldLabel:${index}`} defaultValue={field.label || ""} placeholder="תוכן המודעה" />
        </div>
      ))}
    </div>
  );
}
