"use client";

import { useEffect, useState } from "react";

const INITIAL_MESSAGES = [
  {
    id: "welcome",
    role: "assistant",
    content: "אפשר לשאול אותי על תלמידים, מיילים, כתובות, ערכי שדות בחירה ומוסדות. כל תשובה תחזור עם קישור לכרטיס תלמיד כשיש התאמה."
  }
];

function MessageCard({ message }) {
  return (
    <div className={`ai-chat-message ai-chat-message-${message.role}`}>
      <div className="ai-chat-message-label">{message.role === "user" ? "אתה" : "סוכן"}</div>
      <div className="ai-chat-message-body">{message.content}</div>
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
        <div>
          <a className="ai-chat-export-link" href={message.exportUrl}>הורדה לאקסל</a>
        </div>
      ) : null}
      {Array.isArray(message.studentCards) && message.studentCards.length ? (
        <div className="ai-chat-student-list">
          {message.studentCards.map((student) => (
            <a key={student.id} className="ai-chat-student-card" href={student.studentCardUrl}>
              <strong>{student.name}</strong>
              <span>{student.currentInstitutionLabel ? `${student.currentInstitutionLabel} (${student.currentInstitution})` : "ללא מוסד"}</span>
              <span>{student.classLabel ? `${student.classLabel} (${student.class})` : "ללא שיעור"}</span>
              <span>{student.city || student.addressStreet1 || "ללא כתובת"}</span>
              <span className="ai-chat-student-link">פתח כרטיס תלמיד</span>
            </a>
          ))}
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
  const [error, setError] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);

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
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data?.reply || "לא התקבלה תשובה.",
          studentCards: Array.isArray(data?.studentCards) ? data.studentCards : [],
          exportUrl: data?.exportUrl || "",
          documentInfo: data?.documentInfo || null,
          updatableFields: Array.isArray(data?.updatableFields) ? data.updatableFields : []
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

  return (
    <div className={`ai-chat-shell ${open ? "open" : ""}`}>
      {open ? (
        <section className="ai-chat-panel" aria-label="סוכן CRM">
          <div className="ai-chat-panel-head">
            <div>
              <strong>סוכן CRM</strong>
              <div className="muted">חיפוש תלמידים, שדות מערכת וערכי בחירה</div>
            </div>
            <button type="button" className="ai-chat-close" onClick={() => setOpen(false)}>סגור</button>
          </div>

          <div className="ai-chat-messages">
            {messages.map((message) => <MessageCard key={message.id} message={message} />)}
            {loading ? <div className="ai-chat-status">מחפש במערכת...</div> : null}
            {error ? <div className="ai-chat-error">{error}</div> : null}
          </div>

          <form className="ai-chat-form" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="למשל: מי גר בירושלים? אפשר גם להעלות צילום מסמך לזיהוי."
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
