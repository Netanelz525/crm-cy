"use client";

const roles = [
  ["student", "תלמיד"],
  ["father", "אב"],
  ["mother", "אם"]
];

export default function AttendanceInvitationConfig({ session, templates = [], templateError = "", saveAction, sendAction }) {
  const emailRoles = session?.invitationEmailRecipientRoles || ["student", "father", "mother"];
  const canSendEmail = Boolean(session?.invitationEmailBody);
  const hasWhatsAppTemplates = templates.length > 0;
  return (
    <details className="card attendance-message-panel">
      <summary className="attendance-message-summary">
        <div>
          <h3>הזמנה לאירוע</h3>
          <span className="muted">הגדר את ההודעה פעם אחת. אותו קובץ ישמש למייל ול־WhatsApp; השליחה ל־WhatsApp מופעלת בנפרד.</span>
        </div>
        <span className="attendance-message-summary-action">פתח הגדרות הזמנה</span>
      </summary>
      <form action={saveAction} encType="multipart/form-data" className="grid attendance-message-grid">
        <input type="hidden" name="sessionId" value={session.id} />
        <label>
          <span className="muted">נושא מייל להזמנה</span>
          <input name="invitationEmailSubject" defaultValue={session.invitationEmailSubject || ""} placeholder="הזמנה לאירוע" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="muted">תוכן מייל להזמנה</span>
          <textarea name="invitationEmailBody" defaultValue={session.invitationEmailBody || ""} rows={5} placeholder="שלום, נשמח להזמינכם..." />
        </label>
        <fieldset style={{ border: 0, padding: 0, gridColumn: "1 / -1" }}>
          <legend>נמענים במייל</legend>
          <div className="attendance-filter-toolbar">
            {roles.map(([value, label]) => <label className="attendance-filter-chip active" key={`email-${value}`}><input type="checkbox" name="invitationEmailRecipientRoles" value={value} defaultChecked={emailRoles.includes(value)} />{label}</label>)}
          </div>
        </fieldset>
        <input type="hidden" name="invitationWhatsAppTemplateName" value={session.invitationWhatsAppTemplateName || ""} />
        <input type="hidden" name="invitationWhatsAppTemplateLanguage" value={session.invitationWhatsAppTemplateLanguage || "he"} />
        <div className="attendance-invitation-channel-note" style={{ gridColumn: "1 / -1" }}>
          <strong>שליחה ב־WhatsApp</strong>
          <span className="muted">התבנית המאושרת המתאימה תיבחר אוטומטית לפי הקובץ המצורף: תמונה, PDF או הודעה ללא קובץ.</span>
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
      <form action={sendAction} className="quick-actions" style={{ marginTop: 12 }}>
        <input type="hidden" name="sessionId" value={session.id} />
        {canSendEmail ? <input type="hidden" name="invitationChannels" value="email" /> : null}
        {canSendEmail ? <label className="attendance-filter-chip"><input type="checkbox" name="invitationChannels" value="whatsapp" disabled={!hasWhatsAppTemplates} />שלח גם ב־WhatsApp</label> : null}
        {canSendEmail ? <button type="submit" className="quick-action-btn quick-action-primary">שלח הזמנה</button> : <span className="muted">שמור תוכן מייל כדי לאפשר שליחה.</span>}
      </form>
    </details>
  );
}
