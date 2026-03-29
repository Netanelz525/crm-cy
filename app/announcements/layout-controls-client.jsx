"use client";

import { useEffect, useState } from "react";

function numberValue(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeLayout(initialLayout) {
  const body = initialLayout?.body || {};
  return {
    body: {
      fontSize: numberValue(body.fontSize, 24),
      lineHeight: numberValue(body.lineHeight, 1.55),
      textAlign: body.textAlign || "center",
      top: numberValue(body.top, 27),
      bottom: numberValue(body.bottom, 18),
      right: numberValue(body.right, 10),
      left: numberValue(body.left, 10)
    }
  };
}

function ChoiceButton({ active, label, emoji, onClick }) {
  return (
    <button type="button" className={`layout-choice-btn${active ? " active" : ""}`} onClick={onClick}>
      <span>{emoji}</span>
      <span>{label}</span>
    </button>
  );
}

export default function LayoutControlsClient({ initialLayout, storageKey = "body", onChange }) {
  const [layout, setLayout] = useState(() => normalizeLayout(initialLayout));

  useEffect(() => {
    setLayout(normalizeLayout(initialLayout));
  }, [initialLayout]);

  useEffect(() => {
    onChange?.(layout);
  }, [layout, onChange]);

  function updateBody(key, value) {
    setLayout((current) => ({
      ...current,
      body: {
        ...current.body,
        [key]: value
      }
    }));
  }

  return (
    <div className="layout-control-stack">
      <details className="layout-control-card" open>
        <summary>🔤 פונט</summary>
        <div className="layout-choice-row">
          {[18, 20, 22, 24, 26, 28, 30, 32].map((size) => (
            <ChoiceButton key={size} active={layout.body.fontSize === size} emoji="🔠" label={String(size)} onClick={() => updateBody("fontSize", size)} />
          ))}
        </div>
      </details>

      <details className="layout-control-card">
        <summary>↕️ שורות</summary>
        <div className="layout-choice-row">
          {[1.2, 1.35, 1.55, 1.75, 2].map((value) => (
            <ChoiceButton key={value} active={layout.body.lineHeight === value} emoji="↕️" label={String(value)} onClick={() => updateBody("lineHeight", value)} />
          ))}
        </div>
      </details>

      <details className="layout-control-card">
        <summary>↔️ יישור</summary>
        <div className="layout-choice-row">
          <ChoiceButton active={layout.body.textAlign === "right"} emoji="➡️" label="ימין" onClick={() => updateBody("textAlign", "right")} />
          <ChoiceButton active={layout.body.textAlign === "center"} emoji="↔️" label="מרכז" onClick={() => updateBody("textAlign", "center")} />
          <ChoiceButton active={layout.body.textAlign === "left"} emoji="⬅️" label="שמאל" onClick={() => updateBody("textAlign", "left")} />
        </div>
      </details>

      <details className="layout-control-card">
        <summary>📐 אזור טקסט</summary>
        <div className="template-layout-grid">
          <div>
            <label>התחלה מלמעלה (%)</label>
            <input type="number" value={layout.body.top} min="10" max="60" onChange={(event) => updateBody("top", numberValue(event.target.value, 27))} />
          </div>
          <div>
            <label>סיום מלמטה (%)</label>
            <input type="number" value={layout.body.bottom} min="5" max="35" onChange={(event) => updateBody("bottom", numberValue(event.target.value, 18))} />
          </div>
          <div>
            <label>שול ימין (%)</label>
            <input type="number" value={layout.body.right} min="3" max="25" onChange={(event) => updateBody("right", numberValue(event.target.value, 10))} />
          </div>
          <div>
            <label>שול שמאל (%)</label>
            <input type="number" value={layout.body.left} min="3" max="25" onChange={(event) => updateBody("left", numberValue(event.target.value, 10))} />
          </div>
        </div>
      </details>

      <input type="hidden" name={`${storageKey}FontSize`} value={layout.body.fontSize} />
      <input type="hidden" name={`${storageKey}LineHeight`} value={layout.body.lineHeight} />
      <input type="hidden" name={`${storageKey}Align`} value={layout.body.textAlign} />
      <input type="hidden" name={`${storageKey}Top`} value={layout.body.top} />
      <input type="hidden" name={`${storageKey}Bottom`} value={layout.body.bottom} />
      <input type="hidden" name={`${storageKey}Right`} value={layout.body.right} />
      <input type="hidden" name={`${storageKey}Left`} value={layout.body.left} />
    </div>
  );
}
