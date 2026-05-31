"use client";

import { useEffect, useRef, useState } from "react";
import { INSTITUTION_COLUMNS_FULL } from "../lib/student-view";

const INITIAL_MESSAGES = [
  {
    id: "welcome",
    role: "assistant",
    content: "אפשר לשאול אותי על תלמידים, מיילים, כתובות, ערכי שדות בחירה, מוסדות וגם על דוחות תרומות ממערכות התשלום. כשיש התאמה אחזיר קישורים למסך, לאקסל ול-PDF."
  }
];

const EXPORT_COLUMN_OPTIONS = INSTITUTION_COLUMNS_FULL;

const DEFAULT_EXPORT_COLUMNS = ["name", "tznum", "field:dateofbirth"];

function splitMessageContent(content) {
  return String(content || "").split("\n");
}

function isLongMessage(content) {
  const lines = splitMessageContent(content);
  return lines.length > 8 || String(content || "").length > 420;
}

function MessageText({ content }) {
  const raw = String(content || "");
  if (!isLongMessage(raw)) {
    return <div className="ai-chat-message-body">{raw}</div>;
  }

  const lines = splitMessageContent(raw);
  const preview = lines.slice(0, 8).join("\n");

  return (
    <div className="ai-chat-message-text-wrap">
      <div className="ai-chat-message-body">{preview}</div>
      <details className="ai-chat-more-text">
        <summary>הצג עוד</summary>
        <div className="ai-chat-message-body ai-chat-message-body-full">{raw}</div>
      </details>
    </div>
  );
}

function buildExportUrlWithColumns(exportUrl, columns) {
  if (!exportUrl) return "";
  const [path, query = ""] = exportUrl.split("?");
  const params = new URLSearchParams(query);
  params.delete("cols");
  columns.forEach((column) => params.append("cols", column));
  return `${path}?${params.toString()}`;
}

function scoreClassName(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "score-neutral";
  if (value >= 0.85) return "score-high";
  if (value >= 0.65) return "score-medium";
  return "score-low";
}

function MessageCard({ message, onDecision, onFeedback, deciding }) {
  const [showColumns, setShowColumns] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const [selectedColumns, setSelectedColumns] = useState(DEFAULT_EXPORT_COLUMNS);
  const [feedbackLoading, setFeedbackLoading] = useState("");
  const customExportUrl = buildExportUrlWithColumns(message.exportUrl, selectedColumns);
  const visibleColumnOptions = EXPORT_COLUMN_OPTIONS.filter((column) => {
    const term = columnSearch.trim().toLowerCase();
    if (!term) return true;
    return column.label.toLowerCase().includes(term) || column.key.toLowerCase().includes(term);
  });

  function toggleColumn(columnKey) {
    if (DEFAULT_EXPORT_COLUMNS.includes(columnKey)) return;
    setSelectedColumns((current) => (
      current.includes(columnKey)
        ? current.filter((item) => item !== columnKey)
        : [...current, columnKey]
    ));
  }

  async function submitFeedback(feedback) {
    if (!message?.id || feedbackLoading) return;
    setFeedbackLoading(feedback);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: message.id,
          feedback
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "שמירת המשוב נכשלה");
      onFeedback?.(message.id, feedback);
    } catch (error) {
      console.error(error);
    } finally {
      setFeedbackLoading("");
    }
  }

  return (
    <div className={`ai-chat-message ai-chat-message-${message.role}`}>
      <div className="ai-chat-message-label">{message.role === "user" ? "אתה" : "סוכן"}</div>
      <MessageText content={message.content} />
      {message.searchSummary ? (
        <div className="ai-chat-search-summary">איך חיפשתי: {message.searchSummary}</div>
      ) : null}
      {message.documentInfo ? (
        <div className="ai-chat-document-summary">
          <strong>{message.documentInfo.documentName || "מסמך"}</strong>
          <span>סוג: {message.documentInfo.documentType || "-"}</span>
          <span>שם: {message.documentInfo.fullName || [message.documentInfo.firstName, message.documentInfo.lastName].filter(Boolean).join(" ") || "-"}</span>
          <span>ת"ז: {message.documentInfo.tznum || "-"}</span>
          {Array.isArray(message.updatableFields) && message.updatableFields.length ? (
            <div className="ai-chat-field-list">
              <b>שדות מוצעים לעדכון:</b>
              {message.updatableFields.map((field) => (
                <span key={`${field.field}-${field.value}`}>{field.label || field.field}: {field.value}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {message.exportUrl ? (
        <div className="ai-chat-export-actions">
          <a className="ai-chat-export-link" href={message.exportUrl}>הורדה לאקסל</a>
          {message.pdfUrl ? (
            <a className="ai-chat-export-link" href={message.pdfUrl}>הורדה ל-PDF</a>
          ) : null}
          <button type="button" className="ai-chat-columns-btn" onClick={() => setShowColumns((value) => !value)}>
            בחירת עמודות לאקסל
          </button>
          {showColumns ? (
            <div className="ai-chat-columns-panel">
              <div className="muted">ברירת המחדל כוללת תמיד שם, תעודת זהות ותאריך לידה.</div>
              <input
                className="ai-chat-column-search"
                value={columnSearch}
                onChange={(event) => setColumnSearch(event.target.value)}
                placeholder="חיפוש שדה, לדוגמה: שם אב"
              />
              {visibleColumnOptions.map((column) => (
                <label key={column.key} className="ai-chat-column-option">
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(column.key)}
                    disabled={DEFAULT_EXPORT_COLUMNS.includes(column.key)}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                </label>
              ))}
              {!visibleColumnOptions.length ? <div className="muted">לא נמצאו שדות מתאימים.</div> : null}
              <a className="ai-chat-export-link" href={customExportUrl}>הורד עם העמודות שנבחרו</a>
            </div>
          ) : null}
        </div>
      ) : null}
      {message.viewUrl ? (
        <div className="ai-chat-large-view">
          <a className="ai-chat-large-view-link" href={message.viewUrl}>
            פתח במסך גדול לבחירה, עדכון גורף ותצוגה נוחה
          </a>
        </div>
      ) : null}
      {Array.isArray(message.studentCards) && message.studentCards.length ? (
        <div className="ai-chat-student-list">
          {message.studentCards.map((student) => (
            <a key={student.id} className="ai-chat-student-card" href={student.studentCardUrl}>
              <span className="ai-chat-student-card-head">
                <strong>{student.name}</strong>
                {Number.isFinite(Number(student.matchScore)) ? (
                  <span className={`match-score-pill ${scoreClassName(student.matchScore)}`}>התאמה</span>
                ) : null}
              </span>
              <span>{[
                Number.isFinite(Number(student.age)) ? `גיל ${Number(student.age)}` : "",
                student.tznum ? `ת"ז ${student.tznum}` : ""
              ].filter(Boolean).join(" | ") || "ללא פרטי זיהוי"}</span>
              <span>{student.studentPhone ? `טלפון תלמיד: ${student.studentPhone}` : "טלפון תלמיד: -"}</span>
              <span>{student.dadPhone ? `טלפון אב: ${student.dadPhone}` : "טלפון אב: -"}</span>
              <span>{student.momPhone ? `טלפון אם: ${student.momPhone}` : "טלפון אם: -"}</span>
              <span className="ai-chat-student-link">פתח כרטיס תלמיד</span>
            </a>
          ))}
        </div>
      ) : null}
      {message.pendingAction ? (
        <div className="ai-chat-decision-row">
          <button type="button" onClick={() => onDecision(message, "approve")} disabled={deciding}>
            {message.pendingAction.type === "create_student" ? "אשר יצירת תלמיד ושיוך מסמך"
              : message.pendingAction.type === "create_student_manual" ? "אשר יצירת תלמיד"
                : message.pendingAction.type === "update_student" ? "אשר עדכון תלמיד"
                  : "אשר פעולה"}
          </button>
          <button type="button" className="ai-chat-reject-btn" onClick={() => onDecision(message, "reject")} disabled={deciding}>
            סרב
          </button>
        </div>
      ) : null}
      {message.role === "assistant" && !message.feedback ? (
        <div className="ai-chat-feedback-row">
          <span className="muted">האם התשובה היתה טובה?</span>
              <button type="button" className={message.feedback === "good" ? "active" : ""} disabled={Boolean(feedbackLoading)} onClick={() => submitFeedback("good")}>
            כן
          </button>
              <button type="button" className={message.feedback === "bad" ? "active" : ""} disabled={Boolean(feedbackLoading)} onClick={() => submitFeedback("bad")}>
            לא
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AiChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [file, setFile] = useState(null);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!open || historyLoaded) return;

    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch("/api/ai/chat", { method: "GET" });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "טעינת ההיסטוריה נכשלה");
        }
        if (cancelled) return;

        const historyMessages = Array.isArray(data?.messages) ? data.messages : [];
        setMessages(historyMessages.length ? historyMessages : INITIAL_MESSAGES);
        setHistoryLoaded(true);
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError?.message || "טעינת ההיסטוריה נכשלה");
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [open, historyLoaded]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [open, messages.length, loading, error]);

  function handleInputKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const content = input.trim();
    if ((!content && !file) || loading) return;

    const userContent = content || `הועלה קובץ: ${file?.name || "ללא שם"}`;
    const nextMessages = [...messages, { id: `user-${Date.now()}`, role: "user", content: userContent }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.set("message", content);
      if (file) formData.set("file", file);

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        body: formData
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "הבקשה נכשלה");
      }

      setMessages((current) => [
        ...current,
        {
          id: data?.id || `assistant-${Date.now()}`,
          role: "assistant",
          content: data?.reply || "לא התקבלה תשובה.",
          studentCards: Array.isArray(data?.studentCards) ? data.studentCards : [],
          exportUrl: data?.exportUrl || "",
          pdfUrl: data?.pdfUrl || "",
          viewUrl: data?.viewUrl || "",
          searchSummary: data?.searchSummary || "",
          documentInfo: data?.documentInfo || null,
          updatableFields: Array.isArray(data?.updatableFields) ? data.updatableFields : [],
          pendingAction: data?.pendingAction || null,
          feedback: ""
        }
      ]);
      setFile(null);
      setHistoryLoaded(true);
    } catch (nextError) {
      setError(nextError?.message || "אירעה שגיאה");
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(message, decision) {
    if (!message?.pendingAction || deciding) return;
    setDeciding(true);
    setError("");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          messageId: message.id,
          pendingAction: message.pendingAction
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "הפעולה נכשלה");

      setMessages((current) => [
        ...current.map((item) => item.id === message.id ? { ...item, pendingAction: null } : item),
        {
          id: data?.id || `assistant-${Date.now()}`,
          role: "assistant",
          content: data?.reply || "הפעולה הושלמה.",
          studentCards: Array.isArray(data?.studentCards) ? data.studentCards : [],
          exportUrl: data?.exportUrl || "",
          pdfUrl: data?.pdfUrl || "",
          viewUrl: data?.viewUrl || "",
          searchSummary: data?.searchSummary || "",
          feedback: ""
        }
      ]);
    } catch (nextError) {
      setError(nextError?.message || "הפעולה נכשלה");
    } finally {
      setDeciding(false);
    }
  }

  function handleFeedback(messageId, feedback) {
    setMessages((current) => current.map((item) => item.id === messageId ? { ...item, feedback } : item));
  }

  return (
    <div className={`ai-chat-shell ${open ? "open" : ""}`}>
      {open ? (
        <section className="ai-chat-panel" aria-label="סוכן CRM">
          <div className="ai-chat-panel-head">
            <div>
              <strong>סוכן CRM</strong>
              <div className="muted">חיפוש תלמידים, שדות מערכת, ערכי בחירה ודוחות תרומות</div>
            </div>
            <button type="button" className="ai-chat-close" onClick={() => setOpen(false)}>סגור</button>
          </div>

          <div className="ai-chat-messages">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} onDecision={handleDecision} onFeedback={handleFeedback} deciding={deciding} />
            ))}
            {loading ? <div className="ai-chat-status">מחפש במערכת...</div> : null}
            {error ? <div className="ai-chat-error">{error}</div> : null}
            <div ref={messagesEndRef} />
          </div>

          <form className="ai-chat-form" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="למשל: מי גר בירושלים? או: הפק דוח תרומות בין 2026-05-01 ל-2026-05-31."
            />
            <label className="ai-chat-file-input">
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <span>{file ? `נבחר: ${file.name}` : "העלה צילום או PDF"}</span>
            </label>
            <button type="submit" disabled={loading || (!input.trim() && !file)}>שלח</button>
          </form>
        </section>
      ) : null}

      <button type="button" className="ai-chat-bubble" onClick={() => setOpen((value) => !value)}>
        סוכן AI
      </button>
    </div>
  );
}
