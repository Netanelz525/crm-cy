import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getEmailCampaignById,
  listEmailCampaignDeliveries,
  renderEmailHtml
} from "../../../../lib/email-campaigns";
import { requireAuthenticatedUser } from "../../../../lib/rbac";
import { clean, CLASS_LABELS, INSTITUTIONS } from "../../../../lib/student-view";
import { reopenEmailCampaignAction } from "../../actions";

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  return INSTITUTIONS[key] || clean(value) || "-";
}

function classLabel(value) {
  const key = clean(value).toUpperCase();
  return CLASS_LABELS[key] || clean(value) || "-";
}

function certaintyLabel(level, status) {
  const numeric = Number(level || 0);
  if (status === "unsubscribed") return "הוסר";
  if (status === "failed") return "נכשל";
  if (numeric >= 4) return "נלחץ";
  if (numeric >= 3) return "נפתח";
  if (numeric >= 2) return "נשלח";
  if (numeric >= 1) return "בתור";
  return "אין ודאות";
}

function formatDateTime(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("he-IL");
}

function buildDeliveryPreviewHtml(campaign, delivery) {
  const subject = clean(delivery?.subject) || clean(campaign?.subject);
  const html = clean(delivery?.body_html) || clean(campaign?.body_html);
  const text = clean(delivery?.body_text) || clean(campaign?.body_text);
  return renderEmailHtml({ subject, html, content: text });
}

function relatedStudentNames(delivery) {
  return Array.isArray(delivery?.related_student_names) && delivery.related_student_names.length
    ? delivery.related_student_names.join(", ")
    : clean(delivery?.student_name) || "-";
}

export default async function EmailCampaignDetailPage({ params, searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.can_view_email_reports) redirect("/unauthorized");

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const campaignId = clean(resolvedParams?.id);
  const selectedDeliveryId = clean(resolvedSearchParams?.delivery);
  const campaign = await getEmailCampaignById(campaignId);
  if (!campaign) notFound();

  const deliveries = await listEmailCampaignDeliveries(campaignId);
  const selectedDelivery = deliveries.find((delivery) => clean(delivery.id) === selectedDeliveryId) || deliveries[0] || null;
  const previewHtml = selectedDelivery ? buildDeliveryPreviewHtml(campaign, selectedDelivery) : renderEmailHtml({
    subject: clean(campaign.subject),
    html: clean(campaign.body_html),
    content: clean(campaign.body_text)
  });
  const openRate = Number(campaign.sent_count || 0) > 0
    ? Math.round((Number(campaign.opened_count || 0) / Number(campaign.sent_count || 0)) * 100)
    : 0;

  return (
    <>
      <div className="card glass email-hero">
        <div>
          <p className="email-kicker">פרטי קמפיין</p>
          <h1>{campaign.subject}</h1>
          <p className="muted">
            {[
              clean(campaign.sender_name) || "-",
              campaign.institution ? institutionLabel(campaign.institution) : "",
              campaign.class_filter ? classLabel(campaign.class_filter) : ""
            ].filter(Boolean).join(" | ")}
          </p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <Link className="chip-link" href="/email/campaigns">חזרה להודעות תפוצה קודמות</Link>
            <Link className="chip-link" href="/email">תפוצה חדשה</Link>
            <a className="chip-link" href={`/api/email/campaigns/${campaignId}/export`}>יצוא לאקסל</a>
            <form action={reopenEmailCampaignAction}>
              <input type="hidden" name="campaignId" value={campaignId} />
              <button type="submit" className="chip-link">שליחה חוזרת</button>
            </form>
          </div>
        </div>
        <div className="email-hero-status">
          <span className={`email-status-${campaign.status === "failed" ? "warn" : "ok"}`}>
            {campaign.status || "draft"}
          </span>
          <small>{campaign.sent_count || 0} נשלחו | {campaign.failed_count || 0} נכשלו | {openRate}% פתיחה</small>
        </div>
      </div>

      <div className="email-layout">
        <section className="email-panel">
          <div className="email-certainty-card">
            <h2>סיכום קמפיין</h2>
            <div className="email-certainty-steps">
              <div><b>{campaign.total_recipients || 0}</b><span>נמענים</span><small>מספר הכתובות הייחודיות שנכנסו לשליחה.</small></div>
              <div><b>{campaign.sent_count || 0}</b><span>נשלחו</span><small>נשלחו בהצלחה דרך Resend.</small></div>
              <div><b>{campaign.opened_count || 0}</b><span>נפתחו</span><small>לפחות פתיחה אחת זוהתה.</small></div>
              <div><b>{campaign.failed_count || 0}</b><span>נכשלו</span><small>נכשלו מול הספק או נפלו במהלך השליחה.</small></div>
            </div>
          </div>

          <div className="email-log-card">
            <div className="email-section-title">
              <h2>נמעני הקמפיין</h2>
              <span>{deliveries.length} רשומות</span>
            </div>
            {!deliveries.length ? (
              <div className="muted">אין נמענים מתועדים לקמפיין הזה.</div>
            ) : (
              deliveries.map((delivery) => (
                <Link
                  key={delivery.id}
                  className={`email-log-row email-log-row-link${clean(selectedDelivery?.id) === clean(delivery.id) ? " active" : ""}`}
                  href={`/email/campaigns/${campaignId}?delivery=${delivery.id}#preview`}
                >
                  <div>
                    <b>{delivery.recipient_name || delivery.student_name || delivery.recipient_email}</b>
                    <small>{delivery.recipient_email} | {certaintyLabel(delivery.certainty_level, delivery.status)}</small>
                    <small>תלמידים קשורים: {relatedStudentNames(delivery)}</small>
                    <small>פתיחות: {delivery.open_count || 0} | נפתח: {formatDateTime(delivery.opened_at)} | נלחץ: {formatDateTime(delivery.clicked_at)}</small>
                    {delivery.error_message ? <small className="email-error-text">{delivery.error_message}</small> : null}
                  </div>
                  <span className={`email-certainty-badge email-certainty-${delivery.certainty_level}`}>
                    {certaintyLabel(delivery.certainty_level, delivery.status)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>

        <aside className="email-panel" id="preview">
          <div className="email-preview-card">
            <div className="email-section-title">
              <h2>ההודעה המלאה שנשלחה</h2>
              <span>{selectedDelivery ? `${selectedDelivery.recipient_name || selectedDelivery.recipient_email}` : "תצוגה כללית"}</span>
            </div>
            {selectedDelivery ? (
              <div className="email-help">
                {selectedDelivery.recipient_email} | נשלח: {formatDateTime(selectedDelivery.sent_at)} | פתיחות: {selectedDelivery.open_count || 0}
              </div>
            ) : null}
            <iframe srcDoc={previewHtml} title="Campaign email preview" />
          </div>
        </aside>
      </div>
    </>
  );
}
