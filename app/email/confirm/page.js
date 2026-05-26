import Link from "next/link";
import { redirect } from "next/navigation";
import AttachmentsInputClient from "../attachments-input-client";
import FinalSendSubmitClient from "../final-send-submit-client";
import {
  buildDefaultSenderNameForStudents,
  buildDeliveryTargets,
  buildPreviewMessageParts,
  getEmailCampaignDraft,
  getEmailCandidateStudents,
  normalizeRecipientRoles,
  renderEmailHtml
} from "../../../lib/email-campaigns";
import { getResendConfigStatus } from "../../../lib/resend";
import { requireEmailSender } from "../../../lib/rbac";
import { clean, INSTITUTIONS } from "../../../lib/student-view";
import { sendEmailCampaignAction } from "../actions";

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  return INSTITUTIONS[key] || clean(value) || "-";
}

export default async function EmailConfirmPage({ searchParams }) {
  const user = await requireEmailSender();
  if (!user) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const draftId = clean(resolvedSearchParams?.draft);
  const draftRecord = await getEmailCampaignDraft(draftId);
  const draft = draftRecord?.draft_json || null;
  if (!draft) {
    redirect("/email?error=" + encodeURIComponent("טיוטת המייל לא נמצאה. יש ליצור אישור חדש."));
  }

  const filters = {
    institution: Array.isArray(draft?.institution) ? draft.institution.map(clean).filter(Boolean) : clean(draft?.institution) ? [clean(draft.institution)] : [],
    class: Array.isArray(draft?.class) ? draft.class.map(clean).filter(Boolean) : clean(draft?.class) ? [clean(draft.class)] : [],
    registration: Array.isArray(draft?.registration) ? draft.registration.map(clean).filter(Boolean) : clean(draft?.registration) ? [clean(draft.registration)] : [],
    familystatus: Array.isArray(draft?.familystatus) ? draft.familystatus.map(clean).filter(Boolean) : clean(draft?.familystatus) ? [clean(draft.familystatus)] : [],
    tagIds: Array.isArray(draft?.tagIds) ? draft.tagIds.map(clean).filter(Boolean) : [],
    q: clean(draft?.q),
    recipientRoles: normalizeRecipientRoles(draft?.recipientRoles || draft?.recipientMode),
    sendScope: clean(draft?.sendScope) || "selected",
    selectedStudentIds: Array.isArray(draft?.selectedStudentIds) ? draft.selectedStudentIds.map(clean).filter(Boolean) : []
  };

  const subject = clean(draft?.subject);
  const bodyHtml = clean(draft?.bodyHtml);
  const bodyText = clean(draft?.bodyText);
  const includeGreeting = draft?.includeGreeting !== false;
  const savedAttachments = Array.isArray(draft?.attachments) ? draft.attachments : [];
  const error = clean(resolvedSearchParams?.error);
  const resendStatus = getResendConfigStatus();

  const allStudents = await getEmailCandidateStudents(filters);
  const selectedIdSet = new Set(filters.selectedStudentIds);
  const selectedStudents = filters.sendScope === "filtered"
    ? allStudents
    : allStudents.filter((student) => selectedIdSet.has(clean(student.id)));
  const senderName = user.can_edit_email_sender
    ? (clean(draft?.senderName) || buildDefaultSenderNameForStudents(selectedStudents))
    : buildDefaultSenderNameForStudents(selectedStudents);

  if (!subject) {
    redirect(`/email?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent("יש להזין נושא למייל.")}`);
  }
  if (!bodyHtml && !bodyText) {
    redirect(`/email?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent("יש להזין תוכן למייל.")}`);
  }
  if (!selectedStudents.length) {
    redirect(`/email?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent("לא נבחרו תלמידים לשליחה.")}`);
  }

  const targets = buildDeliveryTargets(selectedStudents, filters.recipientRoles);
  if (!targets.length) {
    redirect(`/email?draft=${encodeURIComponent(draftId)}&error=${encodeURIComponent("לא נמצאו נמענים עם כתובת מייל.")}`);
  }

  const firstTarget = targets[0];
  const previewContent = buildPreviewMessageParts({
    subject,
    bodyText,
    bodyHtml,
    includeGreeting,
    recipientName: firstTarget.recipientName,
    recipientRoleLabel: firstTarget.recipientRoleLabel,
    student: firstTarget.primaryStudent
  });
  const previewHtml = renderEmailHtml({
    subject: previewContent.subject,
    html: previewContent.html,
    content: previewContent.text
  });
  const backHref = `/email?draft=${encodeURIComponent(draftId)}`;

  return (
    <>
      <div className="card glass email-hero">
        <div>
          <p className="email-kicker">אישור סופי</p>
          <h1>בדיקה אחרונה לפני שליחה דרך Resend</h1>
          <p className="muted">
            זהו המייל הסופי שיישלח בפועל. כאן בודקים את רשימת הנמענים והקבצים שכבר נבחרו, מאשרים, והמערכת משלימה את השליחה ברקע.
          </p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <Link className="chip-link" href={backHref}>חזור לעריכת המייל</Link>
          </div>
        </div>
        <div className="email-hero-status">
          <span className={resendStatus.configured ? "email-status-ok" : "email-status-warn"}>
            {resendStatus.configured ? "Resend מחובר" : "חסר Resend API key"}
          </span>
          <small>{senderName}</small>
        </div>
      </div>

      <div className="email-layout">
        <section className="email-panel">
          <form action={sendEmailCampaignAction} className="email-compose-card">
            <input type="hidden" name="draftId" value={draftId} />
            {filters.institution.map((value) => <input key={`institution-${value}`} type="hidden" name="institution" value={value} />)}
            {filters.class.map((value) => <input key={`class-${value}`} type="hidden" name="class" value={value} />)}
            {filters.registration.map((value) => <input key={`registration-${value}`} type="hidden" name="registration" value={value} />)}
            {filters.familystatus.map((value) => <input key={`familystatus-${value}`} type="hidden" name="familystatus" value={value} />)}
            {filters.tagIds.map((tagId) => <input key={tagId} type="hidden" name="tagIds" value={tagId} />)}
            <input type="hidden" name="q" value={filters.q} />
            {filters.recipientRoles.map((value) => <input key={`recipient-${value}`} type="hidden" name="recipientRoles" value={value} />)}
            <input type="hidden" name="sendScope" value={filters.sendScope} />
            <input type="hidden" name="subject" value={subject} />
            <input type="hidden" name="senderName" value={senderName} />
            <input type="hidden" name="bodyHtml" value={bodyHtml} />
            <input type="hidden" name="bodyText" value={bodyText} />
            <input type="hidden" name="includeGreeting" value={includeGreeting ? "1" : "0"} />
            {filters.selectedStudentIds.map((id) => (
              <input key={id} type="hidden" name="studentIds" value={id} />
            ))}

            <div className="email-certainty-card">
              <h2>סיכום שליחה</h2>
              <div className="email-certainty-steps">
                <div><b>{selectedStudents.length}</b><span>תלמידים</span><small>{filters.sendScope === "filtered" ? "כל הרשימה המסוננת תישלח." : "רק התלמידים שסומנו יישלחו."}</small></div>
                <div><b>{targets.length}</b><span>נמענים ייחודיים</span><small>כתובות כפולות אוחדו לפני השליחה.</small></div>
              </div>
            </div>

            {error ? <div className="card muted">{error}</div> : null}

            <div className="email-log-card">
              <h2>פרטי השליחה</h2>
              <div className="email-log-row">
                <div>
                  <b>נושא</b>
                  <small>{subject}</small>
                </div>
              </div>
              <div className="email-log-row">
                <div>
                  <b>שם שולח</b>
                  <small>{senderName}</small>
                </div>
              </div>
              <div className="email-log-row">
                <div>
                  <b>מוסד</b>
                  <small>{filters.institution.length ? filters.institution.map((value) => institutionLabel(value)).join(", ") : "-"}</small>
                </div>
              </div>
            </div>

            <AttachmentsInputClient
              title="קבצים שיצורפו למייל"
              helperText="הקבצים נבחרו בשלב העריכה. כאן אפשר רק לבדוק מה יישלח בפועל לפני האישור הסופי."
              initialFiles={savedAttachments.map((file) => ({ name: file.filename, size: Number(file.sizeBytes || 0), lastModified: 0 }))}
              readOnly
            />

            <label className="email-final-check">
              <input type="checkbox" name="confirmFinalSend" value="1" required />
              אני מאשר שליחה סופית של המייל הזה דרך Resend
            </label>

            <FinalSendSubmitClient resendConfigured={resendStatus.configured} />
          </form>
        </section>

        <aside className="email-panel">
          <div className="email-preview-card">
            <div className="email-section-title">
              <h2>המייל הסופי</h2>
              <span>{firstTarget.recipientName} | {firstTarget.email}</span>
            </div>
            <iframe srcDoc={previewHtml} title="Email final preview" />
          </div>

          <div className="email-log-card">
            <div className="email-section-title">
              <h2>רשימת נמענים</h2>
              <span>{targets.length} כתובות</span>
            </div>
            {targets.map((target) => (
              <div key={target.email} className="email-log-row">
                <div>
                  <b>{target.recipientName || target.email}</b>
                  <small>{target.email} | {target.recipientRoleLabel}</small>
                  <small>תלמידים קשורים: {target.relatedStudents.map((student) => student.name).join(", ")}</small>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
