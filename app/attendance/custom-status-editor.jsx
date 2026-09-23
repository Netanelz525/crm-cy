"use client";

import { useState } from "react";

export default function CustomStatusEditor({ statuses = [] }) {
  const initialRows = Array.isArray(statuses) && statuses.length
    ? statuses.map((item) => ({ value: item?.value || "", label: item?.label || "" }))
    : [{ value: "", label: "" }];
  const [rows, setRows] = useState(initialRows);

  function updateRow(index, key, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  function removeRow(index) {
    setRows((current) => current.length === 1 ? [{ value: "", label: "" }] : current.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
      <div>
        <span className="muted">סטטוסים ייחודיים למפגש</span>
        <p className="muted" style={{ margin: "4px 0 0" }}>לכל שורה יש ערך API טכני ותווית תצוגה בעברית. אין צורך במפריד פסיק או בקו מפריד.</p>
      </div>
      {rows.map((row, index) => (
        <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto", gap: 8, alignItems: "end" }}>
          <label>
            <span className="muted">ערך API</span>
            <input name="customStatusApi" value={row.value} onChange={(event) => updateRow(index, "value", event.target.value)} placeholder="needs_call" />
          </label>
          <label>
            <span className="muted">ערך תצוגה</span>
            <input name="customStatusLabel" value={row.label} onChange={(event) => updateRow(index, "label", event.target.value)} placeholder="צריך שיחה" />
          </label>
          <button type="button" className="quick-action-btn quick-action-outline" onClick={() => removeRow(index)} aria-label={`הסר שורה ${index + 1}`}>הסר</button>
        </div>
      ))}
      <button type="button" className="quick-action-btn quick-action-outline" style={{ justifySelf: "start" }} onClick={() => setRows((current) => [...current, { value: "", label: "" }])}>+ הוסף שורה</button>
    </div>
  );
}
