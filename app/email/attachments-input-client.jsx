"use client";

import { useMemo, useState } from "react";

const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

export default function AttachmentsInputClient() {
  const [files, setFiles] = useState([]);

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + Number(file.size || 0), 0),
    [files]
  );
  const remainingBytes = Math.max(0, MAX_TOTAL_BYTES - totalBytes);
  const overLimit = totalBytes > MAX_TOTAL_BYTES;

  return (
    <div className="email-attachments-card">
      <label>
        קבצים מצורפים
        <input
          type="file"
          name="attachments"
          multiple
          onChange={(event) => {
            const nextFiles = Array.from(event.target.files || []);
            const nextTotalBytes = nextFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
            event.target.setCustomValidity(
              nextTotalBytes > MAX_TOTAL_BYTES
                ? "סך הקבצים המצורפים חורג מהמגבלה של 20MB."
                : ""
            );
            setFiles(nextFiles);
          }}
        />
      </label>

      <div className={`email-attachments-status ${overLimit ? "email-attachments-status-error" : "email-attachments-status-ok"}`}>
        <b>{overLimit ? "הקבצים חורגים מהמגבלה" : "הקבצים תקינים לשליחה"}</b>
        <small>
          סך הכול: {formatSize(totalBytes)} מתוך {formatSize(MAX_TOTAL_BYTES)}
          {!overLimit ? ` | נשארו ${formatSize(remainingBytes)}` : ""}
        </small>
      </div>

      <small className="muted">
        אפשר לצרף כמה קבצים, אבל הסך הכולל מוגבל ל־20MB כדי להבטיח קבלה נוחה ובטוחה יותר אצל הנמען.
      </small>

      {files.length ? (
        <div className="email-attachments-list">
          {files.map((file) => (
            <div key={`${file.name}-${file.size}-${file.lastModified}`} className="email-attachments-item">
              <span>{file.name}</span>
              <small>{formatSize(file.size)}</small>
            </div>
          ))}
        </div>
      ) : null}

      {overLimit ? (
        <div className="card muted">
          לא ניתן לשלוח כרגע. יש להסיר קבצים עד שהסך הכולל ירד ל־20MB או פחות.
        </div>
      ) : null}
    </div>
  );
}
