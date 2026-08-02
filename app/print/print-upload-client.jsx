"use client";

import { useRef, useState } from "react";

const CHUNK_BASE64_LENGTH = 650000;
const PRINT_PLAN_OPTIONS = [
  {
    value: "booklet",
    label: "חוברת A3",
    description: "פריסה מימין לשמאל, קיפול/הידוק"
  },
  {
    value: "duplex",
    label: "A4 דו-צדדי",
    description: "רגיל, דו-צדדי כשיש יותר מעמוד אחד"
  },
  {
    value: "corner-staple",
    label: "A4 עם הידוק פינה",
    description: "מימין לשמאל, הידוק פינה ימנית עליונה"
  },
  {
    value: "convert-pdf",
    label: "המרת קובץ ל-PDF",
    description: "לקבצי Word/Excel, חיוב 2 עמודים"
  }
];

function clean(value) {
  return String(value || "").trim();
}

function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "-";
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10}KB`;
  return `${Math.round((size / 1024 / 1024) * 10) / 10}MB`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("קריאת הקובץ נכשלה."));
    reader.onload = () => {
      const result = clean(reader.result);
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function isWordOrExcelFile(file) {
  const name = clean(file?.name).toLowerCase();
  const type = clean(file?.type).toLowerCase();
  return (
    name.endsWith(".doc") ||
    name.endsWith(".docx") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsx") ||
    type === "application/msword" ||
    type === "application/vnd.ms-excel" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

async function postUploadPart(payload) {
  const response = await fetch("/api/print-jobs/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(clean(data.error) || "שליחת המסמך להדפסה נכשלה.");
  }
  return data;
}

export default function PrintUploadClient({ maxFileBytes, creditBalance = 0, unlimitedPrintCredit = false }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [copies, setCopies] = useState("1");
  const [printPlan, setPrintPlan] = useState("booklet");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submitLockedRef = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || submitLockedRef.current) return;

    const file = selectedFile;
    if (!file) {
      setError("יש לבחור קובץ להדפסה.");
      return;
    }
    if (!file.size) {
      setError("הקובץ ריק.");
      return;
    }
    if (file.size > maxFileBytes) {
      setError(`אפשר לשלוח להדפסה קבצים עד ${formatSize(maxFileBytes)}.`);
      return;
    }
    if (!unlimitedPrintCredit && isWordOrExcelFile(file) && printPlan !== "convert-pdf") {
      setError("קבצי Word או Excel למשתמשי קרדיט צריכים לעבור קודם המרה ל-PDF. בחר סוג הדפסה: המרת קובץ ל-PDF.");
      return;
    }

    submitLockedRef.current = true;
    setSubmitting(true);
    setError("");
    setProgress(0);
    setStatus("מכין את הקובץ לשליחה...");

    try {
      const uploadId = crypto.randomUUID();
      const fileBase64 = await readFileAsBase64(file);
      const totalChunks = Math.max(1, Math.ceil(fileBase64.length / CHUNK_BASE64_LENGTH));

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * CHUNK_BASE64_LENGTH;
        const chunkBase64 = fileBase64.slice(start, start + CHUNK_BASE64_LENGTH);
        setStatus(`שולח להדפסה... ${chunkIndex + 1}/${totalChunks}`);
        await postUploadPart({
          action: "chunk",
          uploadId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          fileSizeBytes: file.size,
          copies,
          printPlan,
          totalChunks,
          chunkIndex,
          chunkBase64
        });
        setProgress(Math.round(((chunkIndex + 1) / totalChunks) * 90));
      }

      setStatus("מסיים קליטה בתור ההדפסה...");
      await postUploadPart({ action: "finish", uploadId });
      setProgress(100);
      window.location.href = "/print?uploaded=1";
    } catch (uploadError) {
      setError(clean(uploadError?.message) || "שליחת המסמך להדפסה נכשלה.");
      setStatus("");
      setSubmitting(false);
      submitLockedRef.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="print-upload-form">
      <label className="print-file-drop">
        <span>בחר קובץ</span>
        <small>PDF, Word, Excel, תמונה או TXT</small>
        <input
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
          required
          onChange={(event) => {
            setSelectedFile(event.target.files?.[0] || null);
            setError("");
            setStatus("");
            setProgress(0);
          }}
        />
      </label>
      {selectedFile ? <p className="muted">{selectedFile.name} | {formatSize(selectedFile.size)}</p> : null}
      {!unlimitedPrintCredit ? (
        <div className="linked-record-card" style={{ marginBottom: 8 }}>
          <b>יתרת קרדיט: {creditBalance} דפים</b>
          <div className="linked-record-meta">
            אם אין מספיק יתרה, המערכת תחסום את השליחה ותציע רכישת חבילת הדפסה.
            קבצי Word או Excel מחייבים קודם המרה ל-PDF בעלות 2 עמודי שימוש.
          </div>
        </div>
      ) : null}
      <label>
        <span className="muted">כמות עותקים</span>
        <input
          type="number"
          min="1"
          max="99"
          step="1"
          value={copies}
          required
          onChange={(event) => setCopies(event.target.value)}
          disabled={submitting}
        />
      </label>
      <label>
        <span className="muted">סוג הדפסה</span>
        <select value={printPlan} onChange={(event) => setPrintPlan(event.target.value)} disabled={submitting}>
          {PRINT_PLAN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} - {option.description}
            </option>
          ))}
        </select>
      </label>
      {status ? (
        <div className="print-upload-progress" aria-live="polite">
          <div><span style={{ width: `${progress}%` }} /></div>
          <p>{status}</p>
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
      <button type="submit" className="quick-action-btn quick-action-primary" disabled={submitting}>
        {submitting ? "שולח להדפסה..." : "שלח להדפסה"}
      </button>
    </form>
  );
}
