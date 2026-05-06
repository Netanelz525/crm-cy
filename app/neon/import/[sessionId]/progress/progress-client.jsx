"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

function statusLabel(status) {
  if (status === "queued") return "ממתין להתחלה";
  if (status === "running") return "רץ עכשיו";
  if (status === "completed") return "הושלם";
  if (status === "failed") return "נכשל";
  return "טיוטה";
}

export default function ImportProgressClient({ sessionId, initialState }) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    let cancelled = false;

    async function startImport() {
      if (initialState?.status !== "queued") return;
      try {
        await fetch(`/api/neon/import-run/${sessionId}`, { method: "POST" });
      } catch {
        // polling below will surface failed state if server persisted it
      }
    }

    async function poll() {
      try {
        const response = await fetch(`/api/neon/import-status/${sessionId}`, { cache: "no-store" });
        if (!response.ok) return;
        const nextState = await response.json();
        if (!cancelled) setState(nextState);
      } catch {
        // keep polling
      }
    }

    startImport();
    const interval = setInterval(poll, 1200);
    poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initialState?.status, sessionId]);

  const progress = state?.progress || {};
  const totalRows = Number(progress.totalRows || 0);
  const processedRows = Number(progress.processedRows || 0);
  const percent = totalRows > 0 ? Math.round((processedRows / totalRows) * 100) : 0;
  const result = state?.result || null;
  const importReportHref = state?.status === "completed" ? `/api/neon/import-report/${sessionId}` : "";
  const summaryHref = useMemo(() => {
    if (state?.status !== "completed" || !result) return "/neon";
    const params = new URLSearchParams({
      imported: "1",
      updated: String(result.updated || 0),
      skipped: String(result.skipped || 0),
      failed: String(result.failed || 0),
      importSessionId: sessionId
    });
    if (Array.isArray(result.errors) && result.errors.length) {
      params.set("importMessage", result.errors.slice(0, 5).join(" | "));
    }
    return `/neon?${params.toString()}`;
  }, [result, sessionId, state?.status]);

  return (
    <>
      <div className="card glass">
        <h1>ייבוא אקסל ל-Neon בתהליך</h1>
        <p className="muted">אפשר להשאיר את המסך פתוח ולעקוב בזמן אמת אחרי התקדמות הייבוא.</p>
      </div>

      <div className="card">
        <div className="student-meta-line">
          <span className="meta-chip">סטטוס: {statusLabel(clean(state?.status))}</span>
          <span className="meta-chip">שורות שטופלו: {processedRows} / {totalRows}</span>
          <span className="meta-chip">עודכנו: {Number(progress.updated || 0)}</span>
          <span className="meta-chip">דולגו: {Number(progress.skipped || 0)}</span>
          <span className="meta-chip">נכשלו: {Number(progress.failed || 0)}</span>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="bulk-progress-shell" aria-hidden="true">
            <div className="bulk-progress-bar" style={{ width: `${Math.min(Math.max(percent, 2), 100)}%` }} />
          </div>
          <div className="muted" style={{ marginTop: 8 }}>{percent}% הושלם</div>
        </div>
      </div>

      {clean(state?.error) ? <div className="card muted">{state.error}</div> : null}

      {state?.status === "completed" ? (
        <div className="card">
          <h3>הייבוא הושלם</h3>
          <div className="quick-actions">
            <Link className="btn btn-primary" href={summaryHref}>חזור ל-Neon עם סיכום הייבוא</Link>
            {importReportHref ? <a className="btn btn-ghost" href={importReportHref}>הורד דוח אקסל מפורט</a> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
