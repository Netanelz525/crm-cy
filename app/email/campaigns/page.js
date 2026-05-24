import Link from "next/link";
import { redirect } from "next/navigation";
import { listRecentEmailCampaigns } from "../../../lib/email-campaigns";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { clean, CLASS_LABELS, INSTITUTIONS } from "../../../lib/student-view";

const RECIPIENT_MODE_LABELS = {
  parents: "הורים בלבד",
  father: "אב בלבד",
  mother: "אם בלבד",
  student: "תלמיד בלבד",
  all: "הורים ותלמידים"
};

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  return INSTITUTIONS[key] || clean(value) || "-";
}

function classLabel(value) {
  const key = clean(value).toUpperCase();
  return CLASS_LABELS[key] || clean(value) || "-";
}

function recipientModeLabel(value) {
  return RECIPIENT_MODE_LABELS[clean(value)] || clean(value) || "-";
}

function campaignTimestamp(campaign) {
  return clean(campaign.sent_at || campaign.created_at);
}

function formatCampaignDate(value) {
  const stamp = clean(value);
  if (!stamp) return "-";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem"
  }).format(date);
}

function normalizeDateInput(value) {
  const cleaned = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : "";
}

function sortCampaigns(campaigns, sortBy) {
  const items = [...campaigns];
  switch (sortBy) {
    case "oldest":
      return items.sort((a, b) => new Date(campaignTimestamp(a) || 0).getTime() - new Date(campaignTimestamp(b) || 0).getTime());
    case "opens":
      return items.sort((a, b) => {
        const aRate = Number(a.sent_count || 0) > 0 ? Number(a.opened_count || 0) / Number(a.sent_count || 0) : 0;
        const bRate = Number(b.sent_count || 0) > 0 ? Number(b.opened_count || 0) / Number(b.sent_count || 0) : 0;
        return bRate - aRate;
      });
    case "recipients":
      return items.sort((a, b) => Number(b.total_recipients || 0) - Number(a.total_recipients || 0));
    case "sent":
      return items.sort((a, b) => Number(b.sent_count || 0) - Number(a.sent_count || 0));
    default:
      return items.sort((a, b) => new Date(campaignTimestamp(b) || 0).getTime() - new Date(campaignTimestamp(a) || 0).getTime());
  }
}

export default async function EmailCampaignListPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.can_view_email_reports) redirect("/unauthorized");

  const resolvedSearchParams = await searchParams;
  const filters = {
    q: clean(resolvedSearchParams?.q),
    institution: clean(resolvedSearchParams?.institution),
    status: clean(resolvedSearchParams?.status),
    recipientMode: clean(resolvedSearchParams?.recipientMode),
    dateFrom: normalizeDateInput(resolvedSearchParams?.dateFrom),
    dateTo: normalizeDateInput(resolvedSearchParams?.dateTo),
    sortBy: clean(resolvedSearchParams?.sortBy) || "newest"
  };
  const searchNeedle = filters.q.toLowerCase();

  const campaigns = await listRecentEmailCampaigns(100);
  const filteredCampaigns = sortCampaigns(
    campaigns.filter((campaign) => {
      const haystack = [
        clean(campaign.subject),
        clean(campaign.sender_name),
        clean(campaign.institution),
        clean(campaign.class_filter),
        clean(campaign.status),
        clean(campaign.recipient_mode)
        ].join(" ").toLowerCase();
      const sentOrCreated = campaignTimestamp(campaign);
      const campaignDate = sentOrCreated ? new Date(sentOrCreated) : null;
      if (searchNeedle && !haystack.includes(searchNeedle)) return false;
      if (filters.institution && clean(campaign.institution) !== filters.institution) return false;
      if (filters.status && clean(campaign.status) !== filters.status) return false;
      if (filters.recipientMode && clean(campaign.recipient_mode) !== filters.recipientMode) return false;
      if (filters.dateFrom) {
        if (!campaignDate || Number.isNaN(campaignDate.getTime())) return false;
        const fromDate = new Date(`${filters.dateFrom}T00:00:00`);
        if (campaignDate < fromDate) return false;
      }
      if (filters.dateTo) {
        if (!campaignDate || Number.isNaN(campaignDate.getTime())) return false;
        const toDate = new Date(`${filters.dateTo}T23:59:59`);
        if (campaignDate > toDate) return false;
      }
      return true;
    }),
    filters.sortBy
  );

  const totals = filteredCampaigns.reduce((acc, campaign) => {
    acc.recipients += Number(campaign.total_recipients || 0);
    acc.sent += Number(campaign.sent_count || 0);
    acc.failed += Number(campaign.failed_count || 0);
    acc.opened += Number(campaign.opened_count || 0);
    return acc;
  }, { recipients: 0, sent: 0, failed: 0, opened: 0 });
  const openRate = totals.sent > 0 ? Math.round((totals.opened / totals.sent) * 100) : 0;
  const uniqueStatuses = Array.from(new Set(campaigns.map((campaign) => clean(campaign.status)).filter(Boolean)));
  const hasActiveFilters = Boolean(filters.q || filters.institution || filters.status || filters.recipientMode || filters.dateFrom || filters.dateTo || filters.sortBy !== "newest");

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
            <Link className="chip-link" href="/email?compose=1">תפוצה חדשה</Link>
          </div>
        </div>
      </div>

      <details className="email-filter-card display-settings" open={hasActiveFilters}>
        <summary>
          סינון ומיון קמפיינים
          {hasActiveFilters ? " • יש סינון פעיל" : ""}
        </summary>
        <form action="/email/campaigns" method="get" style={{ display: "grid", gap: 14 }}>
          <div className="email-form-grid">
            <label>
              חיפוש חופשי
              <input name="q" defaultValue={filters.q} placeholder="נושא, שולח, מוסד או סטטוס" />
            </label>
            <label>
              מוסד
              <select name="institution" defaultValue={filters.institution}>
                <option value="">כל המוסדות</option>
                {Object.entries(INSTITUTIONS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              סטטוס
              <select name="status" defaultValue={filters.status}>
                <option value="">כל הסטטוסים</option>
                {uniqueStatuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
            <label>
              סוג נמענים
              <select name="recipientMode" defaultValue={filters.recipientMode}>
                <option value="">כל הסוגים</option>
                {Object.entries(RECIPIENT_MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              מתאריך
              <input type="date" name="dateFrom" defaultValue={filters.dateFrom} />
            </label>
            <label>
              עד תאריך
              <input type="date" name="dateTo" defaultValue={filters.dateTo} />
            </label>
            <label>
              מיון
              <select name="sortBy" defaultValue={filters.sortBy}>
                <option value="newest">החדשים ביותר</option>
                <option value="oldest">הישנים ביותר</option>
                <option value="opens">אחוז פתיחה גבוה</option>
                <option value="sent">נשלחו בהצלחה</option>
                <option value="recipients">כמות נמענים</option>
              </select>
            </label>
          </div>
          <button type="submit">עדכן תצוגה</button>
        </form>
      </details>

      <div className="email-certainty-card">
        <h2>תמונת מצב</h2>
        <div className="email-certainty-steps">
          <div><b>{filteredCampaigns.length}</b><span>קמפיינים</span><small>מספר הקמפיינים אחרי הסינון הנוכחי.</small></div>
          <div><b>{totals.recipients}</b><span>נמענים</span><small>סה״כ כתובות שנכנסו לקמפיינים המוצגים.</small></div>
          <div><b>{totals.sent}</b><span>נשלחו</span><small>כמה הודעות נשלחו בפועל דרך Resend.</small></div>
          <div><b>{openRate}%</b><span>פתיחה ממוצעת</span><small>יחס פתיחות מתוך כלל ההודעות שנשלחו בתצוגה.</small></div>
        </div>
      </div>

      <div className="email-log-card">
        <div className="email-section-title">
          <h2>קמפיינים</h2>
          <span>{filteredCampaigns.length} רשומות</span>
        </div>
        {!filteredCampaigns.length ? (
          <div className="muted">לא נמצאו קמפיינים לפי הסינון שבחרת.</div>
        ) : (
          filteredCampaigns.map((campaign) => {
            const delivered = Number(campaign.sent_count || 0);
            const opens = Number(campaign.opened_count || 0);
            const openRate = delivered > 0 ? Math.round((opens / delivered) * 100) : 0;
            return (
              <Link key={campaign.id} href={`/email/campaigns/${campaign.id}`} className="email-log-row email-log-row-link">
                <div>
                  <b>{campaign.subject}</b>
                  <small>
                    {[
                      formatCampaignDate(campaignTimestamp(campaign)),
                      campaign.sender_name || "-",
                      campaign.institution ? institutionLabel(campaign.institution) : "",
                      campaign.class_filter ? classLabel(campaign.class_filter) : "",
                      campaign.recipient_mode ? recipientModeLabel(campaign.recipient_mode) : ""
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
