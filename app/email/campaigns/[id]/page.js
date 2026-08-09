import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getEmailCampaignById,
  isEmailCampaignFavorite,
  listEmailCampaignDeliveries,
  renderEmailHtml
} from "../../../../lib/email-campaigns";
import { requireAuthenticatedUser } from "../../../../lib/rbac";
import { ENUM_LABELS } from "../../../../lib/student-fields";
import { clean, CLASS_LABELS, INSTITUTIONS } from "../../../../lib/student-view";
import {
  removeFavoriteEmailCampaignAction,
  reopenEmailCampaignAction,
  saveFavoriteEmailCampaignAction
} from "../../actions";

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  if (key === "PAYMENTS") return "דוח תשלומים";
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
  return date.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
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

const RECIPIENT_ROLE_LABELS = {
  father: "אבא",
  mother: "אמא",
  student: "תלמיד"
};

function enumLabel(group, value) {
  const key = clean(value).toUpperCase();
  return ENUM_LABELS[group]?.[key] || clean(value);
}

function valuesList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value) ? [clean(value)] : [];
}

function filterSummaryItems(campaign) {
  const filters = campaign?.filter_json && typeof campaign.filter_json === "object" ? campaign.filter_json : {};
  const items = [];
  const addList = (label, values, formatter = (item) => item) => {
    const list = valuesList(values).map(formatter).filter(Boolean);
    if (list.length) items.push({ label, value: list.join(", ") });
  };

  addList("מוסדות", filters.institution || campaign.institution, institutionLabel);
  addList("שיעורים", filters.class || campaign.class_filter, classLabel);
  addList("רישום", filters.registration, (value) => enumLabel("registration", value));
  addList("סטטוס משפחתי", filters.familystatus, (value) => enumLabel("familystatus", value));
  addList("תוויות", filters.tagIds);
  addList("נמענים", filters.recipientRoles || filters.recipientMode || campaign.recipient_mode, (value) => RECIPIENT_ROLE_LABELS[clean(value)] || clean(value));
  if (clean(filters.q)) items.push({ label: "חיפוש", value: clean(filters.q) });
  items.push({
    label: "היקף שליחה",
    value: clean(filters.sendScope || campaign.send_scope) === "filtered" ? "כל הרשומות שסוננו" : "רשומות שנבחרו"
  });
  if (Array.isArray(filters.targetStudentIds) && filters.targetStudentIds.length) {
    items.push({ label: "תלמידים שנכנסו לשליחה", value: `${filters.targetStudentIds.length}` });
  }
  return items;
}

function buildUniqueCampaignStudents(deliveries = []) {
  const students = new Map();
  const sentStatuses = new Set(["sent", "opened"]);

  for (const delivery of deliveries) {
    const ids = Array.isArray(delivery?.related_student_ids) ? delivery.related_student_ids.map(clean) : [];
    const names = Array.isArray(delivery?.related_student_names) ? delivery.related_student_names.map(clean) : [];
    if (!ids.length && (clean(delivery?.student_id) || clean(delivery?.student_name))) {
      ids.push(clean(delivery?.student_id));
      names.push(clean(delivery?.student_name));
    }

    ids.forEach((id, index) => {
      const name = names[index] || clean(delivery?.student_name) || id || "תלמיד";
      const key = id || name;
      if (!key) return;
      const current = students.get(key) || {
        id,
        name,
        emails: new Set(),
        sentEmails: new Set(),
        statuses: new Set()
      };
      current.name = current.name || name;
      current.id = current.id || id;
      if (clean(delivery?.recipient_email)) current.emails.add(clean(delivery.recipient_email));
      if (sentStatuses.has(clean(delivery?.status)) && clean(delivery?.recipient_email)) {
        current.sentEmails.add(clean(delivery.recipient_email));
      }
      if (clean(delivery?.status)) current.statuses.add(clean(delivery.status));
      students.set(key, current);
    });
  }

  return Array.from(students.values())
    .map((student) => ({
      ...student,
      emails: Array.from(student.emails),
      sentEmails: Array.from(student.sentEmails),
      statuses: Array.from(student.statuses)
    }))
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name), "he"));
}

export default async function EmailCampaignDetailPage({ params, searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.can_view_email_reports) redirect("/unauthorized");

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const campaignId = clean(resolvedParams?.id);
  const selectedDeliveryId = clean(resolvedSearchParams?.delivery);
  const favoriteSaved = clean(resolvedSearchParams?.favoriteSaved) === "1";
  const favoriteRemoved = clean(resolvedSearchParams?.favoriteRemoved) === "1";
  const error = clean(resolvedSearchParams?.error);
  const campaign = await getEmailCampaignById(campaignId);
  if (!campaign) notFound();

  const deliveries = await listEmailCampaignDeliveries(campaignId);
  const uniqueStudents = buildUniqueCampaignStudents(deliveries);
  const sentUniqueStudentsCount = uniqueStudents.filter((student) => student.sentEmails.length).length;
  const filterItems = filterSummaryItems(campaign);
  const isFavorite = await isEmailCampaignFavorite(user.clerk_user_id, campaignId);
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
            <Link className="chip-link" href="/email/campaigns">חזרה לארכיון התפוצות</Link>
            <a className="chip-link" href={`/api/email/campaigns/${campaignId}/export`}>הורד דוח אקסל</a>
            <form action={reopenEmailCampaignAction}>
              <input type="hidden" name="campaignId" value={campaignId} />
              <button type="submit" className="chip-link">פתח כטיוטה לשליחה מחדש</button>
            </form>
            {isFavorite ? (
              <form action={removeFavoriteEmailCampaignAction}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <input type="hidden" name="returnTo" value={`/email/campaigns/${campaignId}`} />
                <button type="submit" className="chip-link">הסר מקמפיינים מועדפים</button>
              </form>
            ) : (
              <form action={saveFavoriteEmailCampaignAction}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <input type="hidden" name="returnTo" value={`/email/campaigns/${campaignId}`} />
                <button type="submit" className="chip-link">שמור בקמפיינים מועדפים</button>
              </form>
            )}
          </div>
        </div>
        <div className="email-hero-status">
          <span className={`email-status-${campaign.status === "failed" ? "warn" : "ok"}`}>
            {campaign.status || "draft"}
          </span>
          <small>{campaign.sent_count || 0} נשלחו | {campaign.failed_count || 0} נכשלו | {openRate}% פתיחה</small>
        </div>
      </div>

      {favoriteSaved ? <div className="ok">הקמפיין נשמר במועדפים ויופיע במסך המיילים.</div> : null}
      {favoriteRemoved ? <div className="ok">הקמפיין הוסר מרשימת המועדפים.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      <div className="email-layout">
        <section className="email-panel">
          <div className="email-certainty-card">
            <h2>סיכום קמפיין</h2>
            <div className="email-certainty-steps">
              <div><b>{campaign.total_recipients || 0}</b><span>נמענים</span><small>מספר הכתובות הייחודיות שנכנסו לשליחה.</small></div>
              <div><b>{uniqueStudents.length}</b><span>תלמידים</span><small>כרטיסי תלמיד ייחודיים שמופיעים בקמפיין.</small></div>
              <div><b>{sentUniqueStudentsCount}</b><span>תלמידים נשלחו</span><small>כרטיסי תלמיד שלפחות מייל אחד נשלח עבורם.</small></div>
              <div><b>{campaign.sent_count || 0}</b><span>נשלחו</span><small>נשלחו בהצלחה דרך Resend.</small></div>
              <div><b>{campaign.opened_count || 0}</b><span>נפתחו</span><small>לפחות פתיחה אחת זוהתה.</small></div>
              <div><b>{campaign.failed_count || 0}</b><span>נכשלו</span><small>נכשלו מול הספק או נפלו במהלך השליחה.</small></div>
            </div>
          </div>

          <div className="email-log-card">
            <div className="email-section-title">
              <h2>הגדרות המסנן שנשמרו</h2>
              <span>{filterItems.length} פרטים</span>
            </div>
            <div className="email-filter-tags">
              {filterItems.map((item) => (
                <span key={`${item.label}-${item.value}`} className="email-filter-pill">
                  <b>{item.label}</b>
                  {item.value}
                </span>
              ))}
            </div>
          </div>

          <div className="email-log-card">
            <div className="email-section-title">
              <h2>תלמידים ייחודיים בקמפיין</h2>
              <span>{uniqueStudents.length} כרטיסים | {sentUniqueStudentsCount} נשלחו בפועל</span>
            </div>
            {!uniqueStudents.length ? (
              <div className="muted">אין כרטיסי תלמיד משויכים לקמפיין הזה.</div>
            ) : (
              uniqueStudents.map((student) => (
                <div key={student.id || student.name} className="email-log-row">
                  <div>
                    {student.id ? (
                      <Link className="student-link" href={`/neon/students/${student.id}`}>{student.name || student.id}</Link>
                    ) : (
                      <b>{student.name}</b>
                    )}
                    <small>{student.emails.length} כתובות בקמפיין | {student.sentEmails.length} נשלחו בהצלחה</small>
                    <small>{student.emails.join(" | ")}</small>
                  </div>
                  <span className={`email-certainty-badge ${student.sentEmails.length ? "email-certainty-2" : ""}`}>
                    {student.sentEmails.length ? "נשלח" : "לא נשלח"}
                  </span>
                </div>
              ))
            )}
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
