"use client";

import { useState } from "react";

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(String(value || ""));
    return true;
  } catch {
    return false;
  }
}

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

  async function handleCopy(value, successMessage) {
    const ok = await copyText(value);
    setMessage(ok ? successMessage : "לא הצלחתי להעתיק.");
  }

  return (
    <div className="card glass">
      <h2 style={{ marginTop: 0 }}>חיבור Telegram</h2>
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
          <strong>{codeState.deepLink ? "קישור חיבור מוכן" : `קוד חיבור: ${codeState.code}`}</strong>
          {codeState.deepLink ? (
            <>
              <p className="muted" style={{ marginTop: 8, direction: "ltr", wordBreak: "break-all" }}>
                {codeState.deepLink}
              </p>
              <div className="quick-actions" style={{ marginTop: 10 }}>
                <button type="button" onClick={() => handleCopy(codeState.deepLink, "קישור Telegram הועתק.")}>
                  העתק
                </button>
                <a className="quick-action-btn quick-action-outline" href={codeState.deepLink} target="_blank" rel="noreferrer">
                  כניסה
                </a>
              </div>
            </>
          ) : null}
          <p className="muted" style={{ marginTop: 8 }}>
            {codeState.deepLink ? "אם צריך, אפשר גם להעתיק רק את הקוד:" : "שלח לבוט את הפקודה:"}
            <br />
            <code>{codeState.deepLink ? codeState.code : `/start ${codeState.code}`}</code>
          </p>
          <div className="quick-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={() => handleCopy(codeState.code, "קוד Telegram הועתק.")}>
              העתק קוד
            </button>
          </div>
          <p className="muted">
            תוקף עד: {codeState.expiresAt ? new Date(codeState.expiresAt).toLocaleString("he-IL") : "-"}
          </p>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>איך זה עובד</h3>
        <ol>
          <li>לוחצים על `צור קוד חיבור`.</li>
          <li>לוחצים על `כניסה` כדי לעבור ישירות לבוט עם הקוד.</li>
          <li>אפשר גם ללחוץ `העתק` ולהדביק את הקישור או את הקוד ידנית.</li>
          <li>מרגע זה אפשר לדבר עם הסוכן ישירות דרך Telegram.</li>
        </ol>
      </div>

      {message ? <div className="ok" style={{ marginTop: 16 }}>{message}</div> : null}
    </div>
  );
}
