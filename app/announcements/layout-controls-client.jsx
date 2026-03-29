"use client";

function numberValue(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export default function LayoutControlsClient({ initialLayout }) {
  const body = initialLayout?.body || {};

  return (
    <div className="layout-control-stack">
      <details className="layout-control-card">
        <summary>🔤 פונט</summary>
        <div className="template-layout-grid">
          <div>
            <label>גודל פונט</label>
            <select name="bodyFontSize" defaultValue={String(numberValue(body.fontSize, 24))}>
              {[18, 20, 22, 24, 26, 28, 30, 32, 36, 40].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>
      </details>

      <details className="layout-control-card">
        <summary>↕️ שורות</summary>
        <div className="template-layout-grid">
          <div>
            <label>ריווח שורות</label>
            <select name="bodyLineHeight" defaultValue={String(numberValue(body.lineHeight, 1.55))}>
              {[1.1, 1.2, 1.3, 1.4, 1.55, 1.7, 1.9, 2.1].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
      </details>

      <details className="layout-control-card">
        <summary>↔️ יישור</summary>
        <div className="template-layout-grid">
          <div>
            <label>יישור טקסט</label>
            <select name="bodyAlign" defaultValue={body.textAlign || "center"}>
              <option value="right">ימין</option>
              <option value="center">מרכז</option>
              <option value="left">שמאל</option>
            </select>
          </div>
        </div>
      </details>

      <details className="layout-control-card">
        <summary>📐 אזור טקסט</summary>
        <div className="template-layout-grid">
          <div>
            <label>התחלה מלמעלה (%)</label>
            <input type="number" name="bodyTop" min="10" max="60" defaultValue={numberValue(body.top, 27)} />
          </div>
          <div>
            <label>סיום מלמטה (%)</label>
            <input type="number" name="bodyBottom" min="5" max="35" defaultValue={numberValue(body.bottom, 18)} />
          </div>
          <div>
            <label>שול ימין (%)</label>
            <input type="number" name="bodyRight" min="3" max="25" defaultValue={numberValue(body.right, 10)} />
          </div>
          <div>
            <label>שול שמאל (%)</label>
            <input type="number" name="bodyLeft" min="3" max="25" defaultValue={numberValue(body.left, 10)} />
          </div>
        </div>
      </details>
    </div>
  );
}
