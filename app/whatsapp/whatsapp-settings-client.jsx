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

export default function WhatsAppSettingsClient({
  isLinked,
  linkedWaId,
  businessNumber,
  onGenerateCode,
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
        setMessage("החשבון כבר מחובר ל-WhatsApp.");
      }
    } catch (error) {
      setMessage(error?.message || "יצירת קוד נכשלה.");
    } finally {
      setLoading("");
    }
  }

  async function handleUnlink() {
    setLoading("unlink");
    setMessage("");
    try {
      await onUnlink();
      setMessage("החיבור ל-WhatsApp נותק.");
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
      <h2 style={{ marginTop: 0 }}>חיבור WhatsApp</h2>
      <p className="muted">
        החיבור הוא חד-פעמי. רק מספר שמחובר דרך קוד זמני יוכל לדבר עם הסוכן דרך WhatsApp.
      </p>

      <div className="student-meta-line">
        <span className="meta-chip">סטטוס: {isLinked ? "מחובר" : "לא מחובר"}</span>
        {linkedWaId ? <span className="meta-chip">WA ID: {linkedWaId}</span> : null}
        {businessNumber ? <span className="meta-chip">מספר עסקי: {businessNumber}</span> : null}
      </div>

      <div className="quick-actions">
        <button type="button" onClick={handleGenerate} disabled={Boolean(loading) || isLinked}>
          {loading === "code" ? "יוצר קוד..." : "צור קוד חיבור"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={handleUnlink} disabled={Boolean(loading) || !isLinked}>
          {loading === "unlink" ? "מנתק..." : "נתק WhatsApp"}
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
                <button type="button" onClick={() => handleCopy(codeState.deepLink, "קישור WhatsApp הועתק.")}>
                  העתק
                </button>
                <a className="quick-action-btn quick-action-outline" href={codeState.deepLink} target="_blank" rel="noreferrer">
                  כניסה
                </a>
              </div>
            </>
          ) : null}
          <p className="muted" style={{ marginTop: 8 }}>
            {codeState.deepLink ? "אם צריך, אפשר גם להעתיק רק את הקוד:" : "שלח למספר ה-WhatsApp העסקי רק את הקוד הזה כהודעה אחת."}
          </p>
          <code>{codeState.code}</code>
          <div className="quick-actions" style={{ marginTop: 10 }}>
            <button type="button" className="quick-action-btn quick-action-outline" style={{ width: "auto" }} onClick={() => handleCopy(codeState.code, "קוד WhatsApp הועתק.")}>
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
          <li>לוחצים על `כניסה` כדי לעבור ישירות לשיחה עם הבוט והקוד המוכן.</li>
          <li>אפשר גם ללחוץ `העתק` ולהדביק את הקישור או את הקוד ידנית.</li>
          <li>מרגע זה רק המספר שחובר יוכל לדבר עם הסוכן.</li>
        </ol>
      </div>

      {message ? <div className="ok" style={{ marginTop: 16 }}>{message}</div> : null}
    </div>
  );
}
