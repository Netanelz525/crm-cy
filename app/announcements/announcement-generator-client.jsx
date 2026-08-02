"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

const PRINT_PLANS = [
  { value: "corner-staple", label: "A4 רגיל, הידוק פינה ימנית עליונה" },
  { value: "duplex", label: "A4 רגיל דו-צדדי" },
  { value: "booklet", label: "חוברת A3, קיפול והידוק" },
  { value: "convert-pdf", label: "המרת קובץ ל-PDF" }
];

const FAVORITES_STORAGE_KEY = "crm-announcement-template-favorites";

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

export default function AnnouncementGeneratorClient({ templates, action, initialTemplateId = "" }) {
  const initialSelectedId = templates.some((template) => template.id === initialTemplateId)
    ? initialTemplateId
    : templates[0]?.id || "";
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [outputMode, setOutputMode] = useState("email");
  const [favoriteIds, setFavoriteIds] = useState([]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
      if (Array.isArray(parsed)) setFavoriteIds(parsed.filter(Boolean));
    } catch {
      setFavoriteIds([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds));
    } catch {
      // Local preference only; ignore browsers that block storage.
    }
  }, [favoriteIds]);

  useEffect(() => {
    if (initialTemplateId && templates.some((template) => template.id === initialTemplateId)) {
      setSelectedId(initialTemplateId);
    }
  }, [initialTemplateId, templates]);

  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const favoriteTemplates = useMemo(
    () => templates.filter((template) => favoriteIdSet.has(template.id)),
    [templates, favoriteIdSet]
  );
  const regularTemplates = useMemo(
    () => templates.filter((template) => !favoriteIdSet.has(template.id)),
    [templates, favoriteIdSet]
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedId) || templates[0],
    [templates, selectedId]
  );

  function toggleFavorite(templateId) {
    setFavoriteIds((current) => (
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId]
    ));
  }

  function renderTemplateOption(template) {
    const isFavorite = favoriteIdSet.has(template.id);
    return (
      <div
        key={template.id}
        className={`announcement-template-option${selectedTemplate?.id === template.id ? " active" : ""}`}
      >
        <input
          className="announcement-template-radio"
          type="radio"
          name="templateId"
          value={template.id}
          checked={selectedTemplate?.id === template.id}
          onChange={() => setSelectedId(template.id)}
        />
        <button type="button" className="announcement-template-select" onClick={() => setSelectedId(template.id)}>
          <strong>{template.name}</strong>
          <span>{categoryLabel(template.category)}</span>
        </button>
        <button
          type="button"
          className={`announcement-template-favorite${isFavorite ? " active" : ""}`}
          aria-label={isFavorite ? "הסר ממועדפות" : "הוסף למועדפות"}
          title={isFavorite ? "הסר ממועדפות" : "הוסף למועדפות"}
          onClick={() => toggleFavorite(template.id)}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      </div>
    );
  }

  if (!templates.length) {
    return <div className="muted">לא נמצאו תבניות פעילות.</div>;
  }

  return (
    <form action={action} className="announcement-generator-form" encType="multipart/form-data">
      <div className="announcement-template-picker">
        <div className="announcement-template-picker-title">
          <strong>תבניות להכנה</strong>
          <span className="muted">סמן כוכב כדי לשמור תבנית מועדפת להכנה מהירה.</span>
        </div>
        {favoriteTemplates.length ? (
          <div className="announcement-template-section favorite-section">
            <div className="announcement-template-section-title">מועדפות</div>
            <div className="announcement-template-section-grid">
              {favoriteTemplates.map(renderTemplateOption)}
            </div>
          </div>
        ) : null}
        {regularTemplates.length || !favoriteTemplates.length ? (
          <div className="announcement-template-section">
            <div className="announcement-template-section-title">{favoriteTemplates.length ? "שאר התבניות" : "כל התבניות"}</div>
            <div className="announcement-template-section-grid">
              {(favoriteTemplates.length ? regularTemplates : templates).map(renderTemplateOption)}
            </div>
          </div>
        ) : null}
      </div>

      <div className="announcement-generator-panel">
        <div>
          <h3>{selectedTemplate?.name}</h3>
          <p className="muted">{selectedTemplate?.generatorName || "תבנית PDF מקומית"} · {categoryLabel(selectedTemplate?.category)}</p>
        </div>

        <label>
          <span>שם רשומה / שם קובץ *</span>
          <input
            name="recordName"
            required
            maxLength={140}
            placeholder="לדוגמה: נציב יום - יז תמוז"
          />
        </label>

        <div className="announcement-fields-grid">
          {(selectedTemplate?.fields || []).map((field) => {
            if (field.type === "image") {
              return (
                <div key={field.key} className="announcement-image-field announcement-field-span">
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  <div className="announcement-image-field-grid">
                    <label>
                      <span className="muted">מקור תמונה</span>
                      <select name={`fieldImageSource:${field.key}`} defaultValue="signature">
                        <option value="signature">מאגר חתימות / קישור שמור</option>
                        <option value="upload">קובץ מצורף</option>
                      </select>
                    </label>
                    <label>
                      <span className="muted">קישור תמונה ממאגר חתימות</span>
                      <input name={`fieldImageUrl:${field.key}`} placeholder="https://example.com/signature.png" />
                    </label>
                    <label>
                      <span className="muted">קובץ תמונה</span>
                      <input name={`fieldImageFile:${field.key}`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
                    </label>
                    <label>
                      <span className="muted">רוחב</span>
                      <input name={`fieldImageWidth:${field.key}`} type="number" min="1" max="2000" defaultValue="180" />
                    </label>
                    <label>
                      <span className="muted">גובה</span>
                      <input name={`fieldImageHeight:${field.key}`} type="number" min="1" max="2000" defaultValue="70" />
                    </label>
                  </div>
                </div>
              );
            }
            return (
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
            );
          })}
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
