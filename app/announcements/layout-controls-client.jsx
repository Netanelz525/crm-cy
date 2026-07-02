"use client";

import { useEffect, useState } from "react";

function numberValue(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

  function stepBody(key, delta, min, max, precision = 0) {
    const currentValue = numberValue(layout.body[key], key === "lineHeight" ? 1.55 : 24);
    const nextValue = clamp(currentValue + delta, min, max);
    updateBody(key, precision ? Number(nextValue.toFixed(precision)) : Math.round(nextValue));
  }

  return (
    <div className="layout-control-stack">
      <details className="layout-control-card" open>
        <summary>אזור טקסט</summary>
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

      <details className="layout-control-card" open>
        <summary>עיצוב טקסט</summary>
        <div className="announcement-text-control-grid">
          <div className="announcement-text-stepper">
            <span className="announcement-text-control-label">גודל טקסט</span>
            <div className="announcement-text-stepper-row">
              <button type="button" onClick={() => stepBody("fontSize", -1, 12, 64)}>−</button>
              <input
                type="number"
                value={layout.body.fontSize}
                min="12"
                max="64"
                onChange={(event) => updateBody("fontSize", clamp(numberValue(event.target.value, 24), 12, 64))}
              />
              <button type="button" onClick={() => stepBody("fontSize", 1, 12, 64)}>+</button>
            </div>
          </div>

          <div className="announcement-text-stepper">
            <span className="announcement-text-control-label">מרווח שורות</span>
            <div className="announcement-text-stepper-row">
              <button type="button" onClick={() => stepBody("lineHeight", -0.05, 1, 2.4, 2)}>−</button>
              <input
                type="number"
                value={layout.body.lineHeight}
                min="1"
                max="2.4"
                step="0.05"
                onChange={(event) => updateBody("lineHeight", clamp(numberValue(event.target.value, 1.55), 1, 2.4))}
              />
              <button type="button" onClick={() => stepBody("lineHeight", 0.05, 1, 2.4, 2)}>+</button>
            </div>
          </div>

          <div className="announcement-text-align-control">
            <span className="announcement-text-control-label">יישור</span>
            <div className="announcement-text-align-buttons">
              {[
                ["right", "ימין"],
                ["center", "מרכז"],
                ["left", "שמאל"]
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={layout.body.textAlign === value ? "active" : ""}
                  onClick={() => updateBody("textAlign", value)}
                >
                  {label}
                </button>
              ))}
            </div>
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
