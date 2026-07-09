import Link from "next/link";
import { redirect } from "next/navigation";
import AttachmentsInputClient from "../../attachments-input-client";
import FinalSendSubmitClient from "../../final-send-submit-client";
import {
  buildPreviewMessageParts,
  getEmailCampaignDraft,
  normalizeCustomRecipients,
  renderEmailHtml
} from "../../../../lib/email-campaigns";
import { buildPaymentExportSearchParams } from "../../../../lib/payment-report";
import { getResendConfigStatus } from "../../../../lib/resend";
import { requireEmailSender } from "../../../../lib/rbac";
import { sendPaymentEmailCampaignAction } from "../../actions";

function clean(value) {
  return String(value || "").trim();
}

export default async function PaymentEmailConfirmPage({ searchParams }) {
  const user = await requireEmailSender();
  if (!user) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const draftId = clean(resolvedSearchParams?.draft);
  const draftRecord = await getEmailCampaignDraft(draftId);
  const draft = draftRecord?.draft_json || null;
  if (!draft) {
    redirect("/email/payments?error=" + encodeURIComponent("טיוטת המייל לא נמצאה. יש ליצור אישור חדש."));
  }

  const recipients = normalizeCustomRecipients(draft?.customRecipients);
  const selectedIdSet = new Set((Array.isArray(draft?.selectedRecipientIds) ? draft.selectedRecipientIds : []).map(clean).filter(Boolean));
  const targets = clean(draft?.sendScope) === "filtered"
    ? recipients
    : recipients.filter((recipient) => selectedIdSet.has(clean(recipient.id)));
  const subject = clean(draft?.subject);
  const bodyHtml = clean(draft?.bodyHtml);
  const bodyText = clean(draft?.bodyText);
  const includeGreeting = draft?.includeGreeting !== false;
  const senderName = user.can_edit_email_sender ? (clean(draft?.senderName) || "מחלקת תרומות") : "מחלקת תרומות";
  const savedAttachments = Array.isArray(draft?.attachments) ? draft.attachments : [];
  const error = clean(resolvedSearchParams?.error);
  const resendStatus = getResendConfigStatus();
  const reportType = clean(draft?.reportConfig?.reportType) === "mandates" ? "mandates" : "transactions";
  const reportQuery = buildPaymentExportSearchParams({
    reportType,
    dateFrom: clean(draft?.reportConfig?.dateFrom),
    dateTo: clean(draft?.reportConfig?.dateTo),
    providers: Array.isArray(draft?.reportConfig?.providers) ? draft.reportConfig.providers : [],
    connectionIds: Array.isArray(draft?.reportConfig?.connectionIds) ? draft.reportConfig.connectionIds : [],
    mandateStatus: clean(draft?.reportConfig?.mandateStatus),
    searchTerm: clean(draft?.reportConfig?.searchTerm),
    sortBy: clean(draft?.reportConfig?.sortBy) || "date",
    sortDir: clean(draft?.reportConfig?.sortDir) || "desc"
  });
  const editQuery = clean(draft?.reportConfig?.singleRecipientId)
    ? `${reportQuery}&singleRecipientId=${encodeURIComponent(clean(draft.reportConfig.singleRecipientId))}`
    : reportQuery;

  if (!subject) redirect(`/email/payments?error=${encodeURIComponent("יש להזין נושא למייל.")}`);
  if (!bodyHtml && !bodyText) redirect(`/email/payments?error=${encodeURIComponent("יש להזין תוכן למייל.")}`);
  if (!targets.length) redirect(`/email/payments?error=${encodeURIComponent("לא נבחרו נמענים לשליחה.")}`);

  const firstTarget = targets[0];
  const previewContent = buildPreviewMessageParts({
    subject,
    bodyText,
    bodyHtml,
    includeGreeting,
    recipientName: firstTarget.name || firstTarget.email,
    recipientRoleLabel: "נמען",
    student: null
  });
  const previewHtml = renderEmailHtml({
    subject: previewContent.subject,
    html: previewContent.html,
    content: previewContent.text
  });

  return (
    <>
      <div className="card glass email-hero">
        <div>
          <p className="email-kicker">אישור סופי</p>
          <h1>בדיקה אחרונה לפני שליחת המייל לנמעני הדוח</h1>
          <p className="muted">
            כאן בודקים את רשימת הנמענים שנמשכה מתוך דוח {reportType === "mandates" ? "הוראות הקבע" : "העסקאות"}, מאשרים, והמערכת משלימה את השליחה ברקע.
          </p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <Link className="chip-link" href={`/email/payments?${editQuery}`}>חזור לעריכת המייל</Link>
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
          <form action={sendPaymentEmailCampaignAction} className="email-compose-card">
            <input type="hidden" name="draftId" value={draftId} />

            <div className="email-certainty-card">
              <h2>סיכום שליחה</h2>
              <div className="email-certainty-steps">
                <div><b>{targets.length}</b><span>נמענים</span><small>{clean(draft?.sendScope) === "filtered" ? "כל כתובות המייל מהדוח יישלחו." : "רק הנמענים שסומנו יישלחו."}</small></div>
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
              <span>{firstTarget.name || firstTarget.email}</span>
            </div>
            <iframe srcDoc={previewHtml} title="Payment email final preview" />
          </div>

          <div className="email-log-card">
            <div className="email-section-title">
              <h2>רשימת נמענים</h2>
              <span>{targets.length} כתובות</span>
            </div>
            {targets.map((target) => (
              <div key={target.email} className="email-log-row">
                <div>
                  <b>{target.name || target.email}</b>
                  <small>{target.email}</small>
                  <small>{[target.sourceLabel, target.providerLabel, target.extraLabel].filter(Boolean).join(" | ")}</small>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
