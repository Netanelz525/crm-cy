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
