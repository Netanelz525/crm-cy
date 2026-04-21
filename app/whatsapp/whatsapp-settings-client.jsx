"use client";

import { useState } from "react";

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

  return (
    <div className="card glass">
      <h1>חיבור WhatsApp</h1>
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
          <strong>קוד חיבור: {codeState.code}</strong>
          <p className="muted" style={{ marginTop: 8 }}>
            שלח למספר ה-WhatsApp העסקי רק את הקוד הזה כהודעה אחת.
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
          <li>פותחים את שיחת ה-WhatsApp עם המספר העסקי.</li>
          <li>שולחים רק את הקוד שקיבלתם.</li>
          <li>מרגע זה רק המספר שחובר יוכל לדבר עם הסוכן.</li>
        </ol>
      </div>

      {message ? <div className="ok" style={{ marginTop: 16 }}>{message}</div> : null}
    </div>
  );
}
