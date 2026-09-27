"use client";

import { useRef, useState } from "react";

const roles = [
  ["student", "תלמיד"],
  ["father", "אב"],
  ["mother", "אם"]
];

function templateFormatLabel(template) {
  const format = String(template?.headerFormat || "").toUpperCase();
  if (format === "IMAGE") return "תמונה";
  if (format === "DOCUMENT") return "PDF";
  return "ללא קובץ";
}

export default function AttendanceInvitationConfig({ session, templates = [], templateError = "", saveAction, sendAction, recipientCounts = {}, sendHistory = [] }) {
  const emailRoles = session?.invitationEmailRecipientRoles || ["student", "father", "mother"];
  const invitationTitle = session?.title || session?.displayTitle || "";
  const emailSubject = session?.invitationEmailSubject || invitationTitle;
  const emailMessage = session?.invitationEmailBody || session?.invitationMessage || session?.sourceNote || "";
  const whatsappMessage = session?.invitationWhatsAppMessage || emailMessage;
  const canSendEmail = Boolean(emailMessage);
  const hasWhatsAppTemplates = templates.length > 0;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRef = useRef(false);
  const formRef = useRef(null);
  const emailCount = Number(recipientCounts.email || 0);
  const whatsappCount = Number(recipientCounts.whatsapp || 0);
  const studentCount = Number(recipientCounts.students || 0);
  function requestSend(event) {
    if (confirmRef.current) {
      confirmRef.current = false;
      return;
    }
    event.preventDefault();
    setConfirmOpen(true);
  }
  function confirmSend() {
    confirmRef.current = true;
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  }
  return (
    <details className="card attendance-message-panel">
      <summary className="attendance-message-summary">
        <div>
          <h3>הזמנה לאירוע</h3>
          <span className="muted">המייל וה־WhatsApp נשלחים במסלולים נפרדים. פרטי המפגש והתוכן מוזנים פעם אחת, וה־WhatsApp פועל לפי התבנית המאושרת שנבחרה.</span>
        </div>
        <span className="attendance-message-summary-action">פתח הגדרות הזמנה</span>
      </summary>
      <form action={saveAction} encType="multipart/form-data" className="grid attendance-message-grid">
        <input type="hidden" name="sessionId" value={session.id} />
        <label>
          <span className="muted">שם המפגש / שם הרשומה</span>
          <input name="invitationTitle" defaultValue={invitationTitle} placeholder="לדוגמה: הזמנה למפגש הורים" required />
        </label>
        <fieldset className="attendance-invitation-channel-note" style={{ gridColumn: "1 / -1" }}>
          <legend>הזמנת מייל</legend>
          <label>
            <span className="muted">נושא המייל</span>
            <input name="invitationEmailSubject" defaultValue={emailSubject} placeholder="לדוגמה: הזמנה למפגש" required />
          </label>
          <label>
            <span className="muted">תוכן המייל</span>
            <textarea name="invitationMessage" defaultValue={emailMessage} rows={5} placeholder="שלום, נשמח להזמינכם..." required />
          </label>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, gridColumn: "1 / -1" }}>
          <legend>נמענים במייל</legend>
          <div className="attendance-filter-toolbar">
            {roles.map(([value, label]) => <label className="attendance-filter-chip active" key={`email-${value}`}><input type="checkbox" name="invitationEmailRecipientRoles" value={value} defaultChecked={emailRoles.includes(value)} />{label}</label>)}
          </div>
        </fieldset>
        <input type="hidden" name="invitationWhatsAppTemplateLanguage" value={session.invitationWhatsAppTemplateLanguage || "he"} />
        {!hasWhatsAppTemplates ? <input type="hidden" name="invitationWhatsAppTemplateName" value={session.invitationWhatsAppTemplateName || ""} /> : null}
        <div className="attendance-invitation-channel-note" style={{ gridColumn: "1 / -1" }}>
          <strong>שליחה ב־WhatsApp</strong>
          <span className="muted">הטקסט כאן נפרד מהמייל. אפשר להישאר על ברירת מחדל: המערכת תבחר תבנית מאושרת לפי הקובץ המצורף.</span>
          <label>
            <span className="muted">תוכן WhatsApp חופשי לתבנית</span>
            <textarea name="invitationWhatsAppMessage" defaultValue={whatsappMessage} rows={4} placeholder="הטקסט שיוזן בשדה החופשי של תבנית WhatsApp" />
          </label>
          <label>
            <span className="muted">תבנית WhatsApp להזמנה</span>
            <select name="invitationWhatsAppTemplateName" defaultValue={session.invitationWhatsAppTemplateName || ""} disabled={!hasWhatsAppTemplates}>
              <option value="">ברירת מחדל — בחירה אוטומטית לפי הקובץ</option>
              {templates.map((template) => (
                <option key={`${template.name}-${template.language || "he"}`} value={template.name}>
                  {template.name} — {templateFormatLabel(template)}
                </option>
              ))}
            </select>
          </label>
          {session.invitationWhatsAppTemplateName ? <small className="muted">נבחרה תבנית ייעודית: {session.invitationWhatsAppTemplateName}. יש לצרף את סוג הקובץ שהתבנית דורשת.</small> : null}
          {templateError ? <small className="error">{templateError}</small> : null}
          {!templateError && !hasWhatsAppTemplates ? <small className="muted">לא נמצאה כרגע תבנית הזמנה מאושרת של בוט התפוצה.</small> : null}
        </div>
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="muted">קובץ מצורף להזמנה, משותף למייל ול־WhatsApp (אופציונלי, JPG / PNG / PDF עד 30MB)</span>
          {session.invitationAttachment ? <span className="attendance-attachment-summary">קיים קובץ מצורף: <strong>{session.invitationAttachment.fileName}</strong>. בחר קובץ חדש כדי להחליף אותו.</span> : null}
          <input type="file" name="invitationAttachment" accept="image/jpeg,image/png,application/pdf" />
        </label>
        {session.invitationAttachment ? <label className="attendance-filter-chip"><input type="checkbox" name="removeInvitationAttachment" value="1" />הסר את הקובץ הקיים</label> : null}
        <div className="quick-actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="quick-action-btn quick-action-outline">שמור הגדרות הזמנה</button>
        </div>
      </form>
      <form ref={formRef} action={sendAction} onSubmit={requestSend} className="quick-actions" style={{ marginTop: 12 }}>
        <input type="hidden" name="sessionId" value={session.id} />
        {canSendEmail ? <input type="hidden" name="invitationChannels" value="email" /> : null}
        {canSendEmail ? <label className="attendance-filter-chip"><input type="checkbox" name="invitationChannels" value="whatsapp" disabled={!hasWhatsAppTemplates} />שלח גם ב־WhatsApp</label> : null}
          {canSendEmail ? <button type="submit" className="quick-action-btn quick-action-primary">שלח הזמנה</button> : <span className="muted">שמור תוכן מייל כדי לאפשר שליחה.</span>}
        {confirmOpen ? <div className="bulk-modal-backdrop" role="presentation">
          <section className="bulk-modal attendance-invitation-confirm" role="dialog" aria-modal="true" aria-labelledby="attendance-invitation-confirm-title">
            <h3 id="attendance-invitation-confirm-title">אישור שליחת הזמנה</h3>
            <p className="muted">במפגש יש {studentCount} תלמידים. לפי פרטי הקשר הקיימים, השליחה יכולה להגיע ל:</p>
            <div className="attendance-invitation-count-grid">
              <div><strong>{emailCount}</strong><span>כתובות מייל</span></div>
              <div><strong>{whatsappCount}</strong><span>מספרי WhatsApp</span></div>
            </div>
            <p className="muted">המערכת תשלח רק לערוצים שסומנו בטופס ולפרטי קשר שקיימים בפועל.</p>
            <div className="quick-actions">
              <button type="button" className="quick-action-btn quick-action-outline" onClick={() => setConfirmOpen(false)}>ביטול</button>
              <button type="button" className="quick-action-btn quick-action-primary" onClick={confirmSend}>כן, שלח הזמנה</button>
            </div>
          </section>
        </div> : null}
      </form>
      {(
        <section className="attendance-invitation-history" aria-label="היסטוריית שליחות">
          <h4>היסטוריית שליחות במפגש</h4>
          {sendHistory.length ? <div className="attendance-invitation-history-list">
            {sendHistory.map((item) => (
              <div className="attendance-invitation-history-row" key={item.id}>
                <strong>{item.channel === "whatsapp" ? "WhatsApp" : "מייל"}</strong>
                <span>{item.sentCount} נשלחו · {item.failedCount} נכשלו · {item.missingCount} ללא פרטי קשר</span>
                <small>{item.templateName ? `תבנית: ${item.templateName} · ` : ""}{new Date(item.createdAt).toLocaleString("he-IL")}</small>
              </div>
            ))}
          </div> : <p className="muted">עדיין לא בוצעו שליחות במפגש הזה.</p>}
        </section>
      )}
    </details>
  );
}
