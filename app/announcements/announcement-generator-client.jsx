"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

const PRINT_PLANS = [
  { value: "corner-staple", label: "A4 רגיל, הידוק פינה ימנית עליונה" },
  { value: "duplex", label: "A4 רגיל דו-צדדי" },
  { value: "booklet", label: "חוברת A3, קיפול והידוק" }
];

function categoryLabel(value) {
  if (value === "letter") return "מכתב";
  if (value === "sources") return "מראה מקומות";
  return "מודעה";
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary announcement-submit-wide" disabled={pending}>
      {pending ? "יוצר ושולח לתור..." : "צור מודעה ושלח לשרת המקומי"}
    </button>
  );
}

export default function AnnouncementGeneratorClient({ templates, action }) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id || "");
  const [outputMode, setOutputMode] = useState("email");
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedId) || templates[0],
    [templates, selectedId]
  );

  if (!templates.length) {
    return <div className="muted">לא נמצאו תבניות פעילות.</div>;
  }

  return (
    <form action={action} className="announcement-generator-form">
      <div className="announcement-template-picker">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`announcement-template-option${selectedTemplate?.id === template.id ? " active" : ""}`}
            onClick={() => setSelectedId(template.id)}
          >
            <strong>{template.name}</strong>
            <span>{categoryLabel(template.category)}</span>
          </button>
        ))}
      </div>

      <input type="hidden" name="templateId" value={selectedTemplate?.id || ""} />

      <div className="announcement-generator-panel">
        <div>
          <h3>{selectedTemplate?.name}</h3>
          <p className="muted">{selectedTemplate?.generatorName || "תבנית PDF מקומית"} · {categoryLabel(selectedTemplate?.category)}</p>
        </div>

        <div className="announcement-fields-grid">
          {(selectedTemplate?.fields || []).map((field) => (
            <label key={field.key} className={field.type === "multiline" ? "announcement-field-span" : ""}>
              <span>{field.label}{field.required ? " *" : ""}</span>
              {field.type === "multiline" ? (
                <textarea
                  name={`field:${field.key}`}
                  rows={field.maxLength > 1200 ? 8 : 5}
                  maxLength={field.maxLength || undefined}
                  required={Boolean(field.required)}
                />
              ) : (
                <input
                  name={`field:${field.key}`}
                  maxLength={field.maxLength || undefined}
                  required={Boolean(field.required)}
                />
              )}
            </label>
          ))}
        </div>

        <div className="announcement-delivery-mode">
          <label className={outputMode === "email" ? "active" : ""}>
            <input
              type="radio"
              name="outputMode"
              value="email"
              checked={outputMode === "email"}
              onChange={() => setOutputMode("email")}
            />
            <span>
              <strong>שליחה במייל בלבד</strong>
              <small>ברירת מחדל. השרת המקומי יוריד את ה־PDF וישלח אותו במייל.</small>
            </span>
          </label>
          <label className={outputMode === "print" ? "active" : ""}>
            <input
              type="radio"
              name="outputMode"
              value="print"
              checked={outputMode === "print"}
              onChange={() => setOutputMode("print")}
            />
            <span>
              <strong>הדפסה</strong>
              <small>בחר רק אם צריך להדפיס פיזית.</small>
            </span>
          </label>
        </div>

        <div className={`announcement-print-options${outputMode === "print" ? "" : " muted-options"}`}>
          <label>
            <span>סוג הדפסה</span>
            <select name="printPlan" defaultValue="corner-staple" disabled={outputMode !== "print"}>
              {PRINT_PLANS.map((plan) => (
                <option key={plan.value} value={plan.value}>{plan.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>כמות עותקים</span>
            <input type="number" name="copies" min="1" max="99" defaultValue="1" disabled={outputMode !== "print"} />
          </label>
        </div>

        <SubmitButton />
      </div>
    </form>
  );
}
