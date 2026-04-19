"use client";

import { useState } from "react";

export default function TelegramSettingsClient({
  isLinked,
  linkedChatId,
  botUsername,
  onGenerateCode,
  onSetupWebhook,
  onUnlink
}) {
  const [codeState, setCodeState] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState("");

  async function handleGenerate() {
    setLoading("code");
    setMessage("");
    try {
      const result = await onGenerateCode();
      setCodeState(result);
      if (result?.alreadyLinked) {
        setMessage("החשבון כבר מחובר ל-Telegram.");
      }
    } catch (error) {
      setMessage(error?.message || "יצירת קוד נכשלה.");
    } finally {
      setLoading("");
    }
  }

  async function handleWebhook() {
    setLoading("webhook");
    setMessage("");
    try {
      const result = await onSetupWebhook();
      setMessage(`ה־webhook הוגדר: ${result.webhookUrl}`);
    } catch (error) {
      setMessage(error?.message || "הגדרת webhook נכשלה.");
    } finally {
      setLoading("");
    }
  }

  async function handleUnlink() {
    setLoading("unlink");
    setMessage("");
    try {
      await onUnlink();
      setMessage("החיבור ל-Telegram נותק.");
      setCodeState(null);
    } catch (error) {
      setMessage(error?.message || "ניתוק נכשל.");
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="card glass">
      <h1>חיבור Telegram</h1>
      <p className="muted">
        החיבור הוא חד-פעמי. אחרי הקישור, כל הודעה מה־Telegram תזוהה אוטומטית לפי החשבון שלך.
      </p>

      <div className="student-meta-line">
        <span className="meta-chip">סטטוס: {isLinked ? "מחובר" : "לא מחובר"}</span>
        {linkedChatId ? <span className="meta-chip">Chat ID: {linkedChatId}</span> : null}
        {botUsername ? <span className="meta-chip">בוט: @{botUsername}</span> : null}
      </div>

      <div className="quick-actions">
        <button type="button" onClick={handleGenerate} disabled={Boolean(loading) || isLinked}>
          {loading === "code" ? "יוצר קוד..." : "צור קוד חיבור"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleWebhook} disabled={Boolean(loading)}>
          {loading === "webhook" ? "מגדיר..." : "הגדר webhook לבוט"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleUnlink} disabled={Boolean(loading) || !isLinked}>
          {loading === "unlink" ? "מנתק..." : "נתק Telegram"}
        </button>
      </div>

      {codeState?.code ? (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>קוד חיבור: {codeState.code}</strong>
          <p className="muted" style={{ marginTop: 8 }}>
            שלח לבוט את הפקודה:
            <br />
            <code>/start {codeState.code}</code>
          </p>
          <p className="muted">
            תוקף עד: {codeState.expiresAt ? new Date(codeState.expiresAt).toLocaleString("he-IL") : "-"}
          </p>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>איך זה עובד</h3>
        <ol>
          <li>לוחצים על `צור קוד חיבור`.</li>
          <li>פותחים את הבוט ב־Telegram.</li>
          <li>שולחים לו `/start CODE` עם הקוד שקיבלת.</li>
          <li>מרגע זה אפשר לדבר עם הסוכן ישירות דרך Telegram.</li>
        </ol>
      </div>

      {message ? <div className="ok" style={{ marginTop: 16 }}>{message}</div> : null}
    </div>
  );
}
