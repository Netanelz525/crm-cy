import Link from "next/link";
import { redirect } from "next/navigation";
import { listRecentEmailCampaigns } from "../../../lib/email-campaigns";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { clean, CLASS_LABELS, INSTITUTIONS } from "../../../lib/student-view";

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  return INSTITUTIONS[key] || clean(value) || "-";
}

function classLabel(value) {
  const key = clean(value).toUpperCase();
  return CLASS_LABELS[key] || clean(value) || "-";
}

export default async function EmailCampaignListPage() {
  const user = await requireAuthenticatedUser();
  if (!user.can_view_email_reports) redirect("/unauthorized");

  const campaigns = await listRecentEmailCampaigns(100);

  return (
    <>
      <div className="card glass email-hero">
        <div>
          <p className="email-kicker">הודעות תפוצה קודמות</p>
          <h1>ארכיון תפוצות</h1>
          <p className="muted">
            כאן אפשר לפתוח קמפיינים קודמים, לראות דוחות מלאים, ולצאת מהם לשליחה חוזרת כטיוטה חדשה.
          </p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <Link className="chip-link" href="/email">תפוצה חדשה</Link>
          </div>
        </div>
      </div>

      <div className="email-log-card">
        <div className="email-section-title">
          <h2>קמפיינים אחרונים</h2>
          <span>{campaigns.length} רשומות</span>
        </div>
        {!campaigns.length ? (
          <div className="muted">עדיין אין קמפיינים מתועדים.</div>
        ) : (
          campaigns.map((campaign) => {
            const delivered = Number(campaign.sent_count || 0);
            const opens = Number(campaign.opened_count || 0);
            const openRate = delivered > 0 ? Math.round((opens / delivered) * 100) : 0;
            return (
              <Link key={campaign.id} href={`/email/campaigns/${campaign.id}`} className="email-log-row email-log-row-link">
                <div>
                  <b>{campaign.subject}</b>
                  <small>
                    {[
                      campaign.sender_name || "-",
                      campaign.institution ? institutionLabel(campaign.institution) : "",
                      campaign.class_filter ? classLabel(campaign.class_filter) : ""
                    ].filter(Boolean).join(" | ")}
                  </small>
                  <small>{campaign.total_recipients || 0} נמענים | {campaign.sent_count || 0} נשלחו | {campaign.failed_count || 0} נכשלו | {openRate}% פתיחה</small>
                </div>
                <span className={`email-certainty-badge email-certainty-${openRate > 0 ? 3 : 2}`}>
                  {campaign.status || "draft"}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}
