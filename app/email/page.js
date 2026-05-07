import { redirect } from "next/navigation";
import Link from "next/link";
import EmailComposerClient from "./email-composer-client";
import {
  buildDefaultSenderNameForStudents,
  getEmailCandidateStudents,
  listRecentEmailCampaigns,
  listRecentEmailDeliveries,
  summarizeEmailCandidates
} from "../../lib/email-campaigns";
import { getResendConfigStatus } from "../../lib/resend";
import { requireEmailSender } from "../../lib/rbac";
import { clean, CLASS_LABELS, INSTITUTIONS } from "../../lib/student-view";
import { ENUM_LABELS } from "../../lib/student-fields";
import { sendEmailCampaignAction } from "./actions";

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
  if (status === "failed") return "נכשל";
  if (numeric >= 4) return "נלחץ";
  if (numeric >= 3) return "נפתח";
  if (numeric >= 2) return "נשלח";
  if (numeric >= 1) return "בתור";
  return "אין ודאות";
}

export default async function EmailPage({ searchParams }) {
  const user = await requireEmailSender();
  if (!user) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const filters = {
    institution: clean(resolvedSearchParams?.institution),
    class: clean(resolvedSearchParams?.class),
    registration: clean(resolvedSearchParams?.registration),
    familystatus: clean(resolvedSearchParams?.familystatus),
    q: clean(resolvedSearchParams?.q),
    recipientMode: clean(resolvedSearchParams?.recipientMode) || "parents",
    selectedStudentIds: Array.isArray(resolvedSearchParams?.studentIds)
      ? resolvedSearchParams.studentIds.map(clean).filter(Boolean)
      : clean(resolvedSearchParams?.studentIds) ? [clean(resolvedSearchParams.studentIds)] : []
  };

  const subject = clean(resolvedSearchParams?.subject) || "עדכון חשוב ממערכת התלמידים";
  const initialHtml = clean(resolvedSearchParams?.contentHtml) || "<p>שלום,</p><p>רצינו לעדכן אותך בנושא חשוב.</p><p>בברכה,<br>משרד הישיבה</p>";
  const sent = clean(resolvedSearchParams?.sent);
  const failed = clean(resolvedSearchParams?.failed);
  const skipped = clean(resolvedSearchParams?.skipped);
  const error = clean(resolvedSearchParams?.error);

  const resendStatus = getResendConfigStatus();
  const students = await getEmailCandidateStudents(filters);
  const senderName = user.can_edit_email_sender
    ? (clean(resolvedSearchParams?.senderName) || buildDefaultSenderNameForStudents(students))
    : buildDefaultSenderNameForStudents(students);
  const summary = summarizeEmailCandidates(students, filters.recipientMode);
  const recentDeliveries = user.can_view_email_reports ? await listRecentEmailDeliveries(20) : [];
  const recentCampaigns = user.can_view_email_reports ? await listRecentEmailCampaigns(8) : [];

  return (
    <>
      <div className="card glass email-hero">
        <div>
          <p className="email-kicker">מרכז מיילים</p>
          <h1>שליחת הודעות לתלמידים והורים</h1>
          <p className="muted">
            הרשימה נבנית מתוך תלמידים מסומנים ומסוננים, עם איחוד כתובות כפולות, מעקב פתיחה ודוח שליחה.
          </p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <Link className="chip-link" href="/neon">חזרה למסך תלמידים</Link>
          </div>
        </div>
        <div className="email-hero-status">
          <span className={resendStatus.configured ? "email-status-ok" : "email-status-warn"}>
            {resendStatus.configured ? "Resend מחובר" : "חסר Resend API key"}
          </span>
          <small>{resendStatus.fromEmail}</small>
        </div>
      </div>

      {sent ? (
        <div className="ok">
          השליחה הסתיימה: {sent} נשלחו, {failed || 0} נכשלו, {skipped || 0} דולגו.
        </div>
      ) : null}
      {error ? <div className="card muted">{error}</div> : null}

      <form className="email-filter-card" action="/email" method="get">
        <h2>סינון נמענים</h2>
        <div className="email-form-grid">
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
            שיעור
            <select name="class" defaultValue={filters.class}>
              <option value="">כל השיעורים</option>
              {Object.entries(ENUM_LABELS.class || {}).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            רישום
            <select name="registration" defaultValue={filters.registration}>
              <option value="">כל מצבי הרישום</option>
              {Object.entries(ENUM_LABELS.registration || {}).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            מצב משפחתי
            <select name="familystatus" defaultValue={filters.familystatus}>
              <option value="">כל המצבים</option>
              {Object.entries(ENUM_LABELS.familystatus || {}).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            למי לשלוח
            <select name="recipientMode" defaultValue={filters.recipientMode}>
              <option value="parents">הורים בלבד</option>
              <option value="father">אב בלבד</option>
              <option value="mother">אם בלבד</option>
              <option value="student">תלמיד בלבד</option>
              <option value="all">שניהם</option>
            </select>
          </label>
          <label>
            חיפוש תלמיד
            <input name="q" defaultValue={filters.q} placeholder="שם, מייל או טלפון" />
          </label>
        </div>
        <input type="hidden" name="subject" value={subject} />
        <input type="hidden" name="senderName" value={senderName} />
        <input type="hidden" name="contentHtml" value={initialHtml} />
        <button type="submit">עדכן רשימה</button>
      </form>

      <form action={sendEmailCampaignAction} encType="multipart/form-data">
        <input type="hidden" name="institution" value={filters.institution} />
        <input type="hidden" name="class" value={filters.class} />
        <input type="hidden" name="registration" value={filters.registration} />
        <input type="hidden" name="familystatus" value={filters.familystatus} />
        <input type="hidden" name="q" value={filters.q} />
        <input type="hidden" name="recipientMode" value={filters.recipientMode} />
        <EmailComposerClient
          institutionSelected={Boolean(filters.institution)}
          recipientMode={filters.recipientMode}
          students={students}
          summary={summary}
          initialSubject={subject}
          initialHtml={initialHtml}
          initialSenderName={senderName}
          senderNameEditable={user.can_edit_email_sender}
          resendConfigured={resendStatus.configured}
        />
      </form>

      <div className="email-layout" style={{ marginTop: 18 }}>
        <section className="email-panel">
          <div className="email-certainty-card">
            <h2>מדרג ודאות</h2>
            <div className="email-certainty-steps">
              <div><b>0</b><span>אין כתובת</span><small>לא נמצא אימייל מתאים לנמען.</small></div>
              <div><b>1</b><span>בתור</span><small>נוצרה רשומת שליחה.</small></div>
              <div><b>2</b><span>נשלח</span><small>Resend קיבל את ההודעה.</small></div>
              <div><b>3</b><span>נפתח</span><small>פיקסל המעקב נטען לפחות פעם אחת.</small></div>
              <div><b>4</b><span>נלחץ</span><small>נלחץ קישור מתוך המייל.</small></div>
            </div>
          </div>
        </section>

        {user.can_view_email_reports ? (
          <aside className="email-panel">
            <div className="email-log-card">
              <h2>קמפיינים אחרונים</h2>
              {!recentCampaigns.length ? (
                <div className="muted">עדיין אין קמפיינים מתועדים.</div>
              ) : (
                recentCampaigns.map((campaign) => {
                  const delivered = Number(campaign.sent_count || 0);
                  const opens = Number(campaign.opened_count || 0);
                  const openRate = delivered > 0 ? Math.round((opens / delivered) * 100) : 0;
                  return (
                    <div key={campaign.id} className="email-log-row">
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
                    </div>
                  );
                })
              )}
            </div>

            <div className="email-log-card">
              <h2>שליחות אחרונות</h2>
              {!recentDeliveries.length ? (
                <div className="muted">עדיין אין שליחות מתועדות.</div>
              ) : (
                recentDeliveries.map((delivery) => (
                  <div key={delivery.id} className="email-log-row">
                    <div>
                      <b>{delivery.recipient_name || delivery.student_name || delivery.recipient_email}</b>
                      <small>{delivery.recipient_email} | {delivery.subject}</small>
                      <small>{delivery.sender_name || "-"} | פתיחות: {delivery.open_count || 0}</small>
                      {delivery.error_message ? <small className="email-error-text">{delivery.error_message}</small> : null}
                    </div>
                    <span className={`email-certainty-badge email-certainty-${delivery.certainty_level}`}>
                      {certaintyLabel(delivery.certainty_level, delivery.status)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}
