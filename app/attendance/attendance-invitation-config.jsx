"use client";

const roles = [
  ["student", "תלמיד"],
  ["father", "אב"],
  ["mother", "אם"]
];

export default function AttendanceInvitationConfig({ session, templates = [], templateError = "", saveAction, sendAction }) {
  const emailRoles = session?.invitationEmailRecipientRoles || ["student", "father", "mother"];
  const whatsappRoles = session?.invitationWhatsAppRecipientRoles || ["student"];
  const canSendEmail = Boolean(session?.invitationEmailBody);
  const canSendWhatsApp = Boolean(session?.invitationWhatsAppTemplateName);
  return (
    <details className="card attendance-message-panel">
      <summary className="attendance-message-summary">
        <div>
          <h3>הזמנה לאירוע</h3>
          <span className="muted">הגדר פעם אחת תבנית מייל ותבנית WhatsApp. במוקד השיחות השליחה תתבצע בלחיצה אחת.</span>
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
        <label>
          <span className="muted">תבנית WhatsApp מאושרת של בוט התפוצה</span>
          <select name="invitationWhatsAppTemplateName" defaultValue={session.invitationWhatsAppTemplateName || ""}>
            <option value="">ללא שליחת WhatsApp</option>
            {templates.map((template) => <option key={template.name} value={template.name}>{template.name}</option>)}
          </select>
          {templateError ? <small className="error">{templateError}</small> : null}
          {!templateError && !templates.length ? <small className="muted">לא נמצאה כרגע תבנית הזמנה מאושרת של בוט התפוצה.</small> : null}
        </label>
        <input type="hidden" name="invitationWhatsAppTemplateLanguage" value={session.invitationWhatsAppTemplateLanguage || "he"} />
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend>נמענים ב־WhatsApp</legend>
          <div className="attendance-filter-toolbar">
            {roles.map(([value, label]) => <label className="attendance-filter-chip active" key={`wa-${value}`}><input type="checkbox" name="invitationWhatsAppRecipientRoles" value={value} defaultChecked={whatsappRoles.includes(value)} />{label}</label>)}
          </div>
        </fieldset>
        <label style={{ gridColumn: "1 / -1" }}>
          <span className="muted">קובץ מצורף להזמנה (אופציונלי, JPG / PNG / PDF עד 30MB)</span>
          <input type="file" name="invitationAttachment" accept="image/jpeg,image/png,application/pdf" />
        </label>
        {session.invitationAttachment ? <label className="attendance-filter-chip"><input type="checkbox" name="removeInvitationAttachment" value="1" />הסר את הקובץ הקיים: {session.invitationAttachment.fileName}</label> : null}
        <div className="quick-actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="quick-action-btn quick-action-outline">שמור הגדרות הזמנה</button>
        </div>
      </form>
      <form action={sendAction} className="quick-actions" style={{ marginTop: 12 }}>
        <input type="hidden" name="sessionId" value={session.id} />
        {canSendEmail ? <input type="hidden" name="invitationChannels" value="email" /> : null}
        {canSendWhatsApp ? <input type="hidden" name="invitationChannels" value="whatsapp" /> : null}
        {canSendEmail || canSendWhatsApp ? <button type="submit" className="quick-action-btn quick-action-primary">שלח הזמנה לכל תלמידי המפגש</button> : <span className="muted">שמור לפחות תבנית מייל או תבנית WhatsApp כדי לאפשר שליחה.</span>}
      </form>
    </details>
  );
}
