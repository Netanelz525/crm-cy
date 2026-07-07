"use client";

import { useRef, useState } from "react";

const CHUNK_BASE64_LENGTH = 650000;

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

export default function PrintUploadClient({ maxFileBytes }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [copies, setCopies] = useState("1");
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
