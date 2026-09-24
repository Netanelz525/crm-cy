import Link from "next/link";
import { redirect } from "next/navigation";
import AttendanceRosterClient from "../attendance-roster-client";
import AttendanceEmailSendSubmit from "../attendance-email-send-submit";
import AttendanceMessageComposer from "../attendance-message-composer";
import {
  saveAttendanceSessionDetailsAction,
  saveAttendanceSessionResponsibilityAction,
  saveAttendanceSessionInvitationAction,
  saveAttendanceSessionStatusesAction,
  saveAttendanceSessionMessagingAction,
  saveAttendanceSessionStudentsAction,
  setAttendanceSessionManualStudentAction,
  sendAttendanceSessionEmailsAction,
  sendAttendanceSessionWhatsAppAction,
  sendAttendanceSessionWhatsAppApprovedTemplateAction,
  sendAttendanceInvitationAction,
  setAttendanceSessionLockAction,
  syncAttendanceSessionStudentsAction
} from "../actions";
import {
  ATTENDANCE_EMAIL_RECIPIENT_LABELS,
  ATTENDANCE_SELECTABLE_SESSION_TYPE_ORDER,
  ATTENDANCE_SESSION_TYPE_LABELS,
  getAttendanceRoster,
  listAttendanceResponsibleUsers
} from "../../../lib/attendance";
import { ATTENDANCE_EXPORT_SORT_LABELS as PDF_SORT_LABELS } from "../../../lib/attendance-exports";
import { getCurrentAppUser, signInRedirectUrl } from "../../../lib/rbac";
import { getResendConfigStatus } from "../../../lib/resend";
import { listWhatsAppCoexistenceApprovedTemplates } from "../../../lib/attendance-whatsapp";
import ResponsibleUserPicker from "../responsible-user-picker";
import AttendanceCallTeam from "../attendance-call-team";
import AttendanceInvitationConfig from "../attendance-invitation-config";
import { getCallTeam } from "../../../lib/attendance-calls";
import AttendanceStudentPicker from "../attendance-student-picker";
import CustomStatusEditor from "../custom-status-editor";
import { listNeonStudentsByFilters } from "../../../lib/neon-students";
import { CLASS_LABELS, INSTITUTIONS } from "../../../lib/student-view";

function clean(value) {
  return String(value || "").trim();
}

function isInvitationTemplateName(value) {
  const name = clean(value).toLowerCase();
  return name.startsWith("general_meeting_invitation") || name.includes("meeting_invitation");
}

function formatSessionAudience(session) {
  const institutionLabels = (session?.institutionFilterOptions || []).map((item) => item.label);
  const classLabels = (session?.classFilterOptions || []).map((item) => item.label);
  const registrationLabels = (session?.registrationFilterOptions || []).map((item) => item.label);
  const familyStatusLabels = (session?.familyStatusFilterOptions || []).map((item) => item.label);
  const tagLabels = (session?.tagFilterOptions || []).map((item) => item.label);
  const parts = [];
  if (institutionLabels.length) parts.push(`מוסדות: ${institutionLabels.join(", ")}`);
  if (classLabels.length) parts.push(`שיעורים: ${classLabels.join(", ")}`);
  if (registrationLabels.length) parts.push(`רישום: ${registrationLabels.join(", ")}`);
  if (familyStatusLabels.length) parts.push(`סטטוס משפחתי: ${familyStatusLabels.join(", ")}`);
  if (tagLabels.length) parts.push(`תוויות: ${tagLabels.join(", ")}`);
  return parts.join(" | ");
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AttendanceSessionPage({ params, searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect(await signInRedirectUrl());
  const defaultReplyTo = getResendConfigStatus().defaultReplyTo;
  if (!currentUser.is_team_member && !currentUser.is_manager && !currentUser.is_super_admin) redirect("/unauthorized");

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const sessionId = clean(resolvedParams?.sessionId);
  const created = clean(resolvedSearchParams?.created) === "1";
  const synced = clean(resolvedSearchParams?.synced) === "1";
  const detailsSaved = clean(resolvedSearchParams?.detailsSaved) === "1";
  const studentsSaved = clean(resolvedSearchParams?.studentsSaved) === "1";
  const studentsSavedCount = clean(resolvedSearchParams?.studentsSavedCount);
  const statusesSaved = clean(resolvedSearchParams?.statusesSaved) === "1";
  const messageSaved = clean(resolvedSearchParams?.messageSaved) === "1";
  const lockSaved = clean(resolvedSearchParams?.lockSaved);
  const mailQueued = clean(resolvedSearchParams?.mailQueued) === "1";
  const mailSent = clean(resolvedSearchParams?.mailSent) === "1";
  const sentEmails = clean(resolvedSearchParams?.sentEmails);
  const failedEmails = clean(resolvedSearchParams?.failedEmails);
  const mailError = clean(resolvedSearchParams?.mailError);
  const quickEmailSent = clean(resolvedSearchParams?.quickEmailSent) === "1";
  const quickEmailError = clean(resolvedSearchParams?.quickEmailError);
  const whatsappTemplateSent = clean(resolvedSearchParams?.whatsappTemplateSent) === "1";
  const whatsappTemplateError = clean(resolvedSearchParams?.whatsappTemplateError);
  const invitationSaved = clean(resolvedSearchParams?.invitationSaved) === "1";
  const invitationQueued = clean(resolvedSearchParams?.invitationQueued) === "1";
  const invitationError = clean(resolvedSearchParams?.invitationError);
  const activeStatusFilters = clean(resolvedSearchParams?.statusFilter)
    .split(",")
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  const exportSort = clean(resolvedSearchParams?.exportSort).toLowerCase() || "class_name";
  const roster = sessionId ? await getAttendanceRoster(sessionId) : null;
  const statusOptions = Array.isArray(roster?.session?.statusOptions) ? roster.session.statusOptions : [];
  const canManageSessionLock = currentUser.is_manager || currentUser.is_super_admin;
  const canManageSessionSettings = currentUser.is_manager || currentUser.is_super_admin;
  const responsibleUsers = canManageSessionSettings ? await listAttendanceResponsibleUsers() : [];
  const allStudents = await listNeonStudentsByFilters({ limit: 3000 });
  const manualStudentOptions = allStudents.map((student) => ({
    id: clean(student?.id),
    label: clean(student?.label) || clean(student?.name) || "ללא שם",
    classLabel: clean(CLASS_LABELS[clean(student?.class).toUpperCase()] || student?.class),
    institutionLabel: clean(INSTITUTIONS[clean(student?.currentInstitution).toUpperCase()] || student?.currentInstitution),
    class: clean(student?.class),
    phone: student?.phone || null,
    dadPhone: student?.dadPhone || null,
    momPhone: student?.momPhone || null,
    email: student?.email || null,
    fatherEmail: student?.fatherEmail || null,
    motherEmail: student?.motherEmail || null
  })).filter((student) => student.id);
  let whatsappTemplates = [];
  let whatsappTemplateLoadError = "";
  try {
    whatsappTemplates = await listWhatsAppCoexistenceApprovedTemplates();
  } catch (error) {
    whatsappTemplateLoadError = clean(error?.message) || "לא ניתן לטעון את תבניות WhatsApp המאושרות.";
    console.error("WhatsApp template list failed", whatsappTemplateLoadError);
  }
  const invitationTemplates = whatsappTemplates.filter((template) => isInvitationTemplateName(template.name));
  const attendanceStatusTemplates = whatsappTemplates.filter((template) => !isInvitationTemplateName(template.name));

  if (!roster) {
    return (
      <>
        <div className="card glass">
          <h1>מפגש נוכחות</h1>
          <p className="muted">לא נמצא מפגש נוכחות תואם.</p>
          <div className="quick-actions">
            <Link className="quick-action-btn quick-action-outline" href="/attendance">חזרה למפגשים</Link>
          </div>
        </div>
      </>
    );
  }

  const sessionAudienceSummary = formatSessionAudience(roster.session);
  const callTeam = canManageSessionSettings ? await getCallTeam(sessionId, currentUser) : null;
  const sessionSummary = [
    roster.session.institutionLabel,
    roster.session.displayTitle || roster.session.title || roster.session.sessionTypeLabel || "ללא סוג",
    roster.session.sessionDate,
    roster.session.sessionWeekdayLabel,
    roster.session.sessionHebrewDateLabel,
    roster.session.isLocked ? "נעול" : "פתוח לעדכונים",
    roster.session.visibleToStudents ? "גלוי לתלמידים" : "מוסתר מתלמידים",
    roster.session.responsibleDisplayName ? `אחראי: ${roster.session.responsibleDisplayName}` : "",
    sessionAudienceSummary
  ].filter(Boolean).join(" | ");

  return (
    <>
      <div className="card glass">
        <h1>מפגש נוכחות</h1>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/attendance">חזרה למפגשים</Link>
          <form action={syncAttendanceSessionStudentsAction} className="quick-actions" style={{ marginTop: 0 }}>
            <input type="hidden" name="sessionId" value={roster.session.id} />
            <button type="submit" className="quick-action-btn quick-action-outline">סנכרן תלמידים</button>
          </form>
          {canManageSessionLock ? (
            <form action={setAttendanceSessionLockAction} className="quick-actions" style={{ marginTop: 0 }}>
              <input type="hidden" name="sessionId" value={roster.session.id} />
              <input type="hidden" name="locked" value={roster.session.isLocked ? "0" : "1"} />
              <button type="submit" className={roster.session.isLocked ? "quick-action-btn quick-action-primary" : "quick-action-btn quick-action-outline"}>
                {roster.session.isLocked ? "פתח נעילה" : "נעל מפגש"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {created ? <div className="ok">המפגש נוצר ונפתח להזנת נוכחות.</div> : null}
      {callTeam ? <AttendanceCallTeam sessionId={sessionId} team={callTeam} rosterIds={roster.students.map(s => s.id)} /> : null}
      {synced ? <div className="ok">רשימת תלמידי המפגש סונכרנה מחדש לפי מסנני המפגש.</div> : null}
      {detailsSaved ? <div className="ok">פרטי המפגש נשמרו.</div> : null}
      {studentsSaved ? <div className="ok">רשימת התלמידים הידנית נשמרה. במפגש יש עכשיו {studentsSavedCount || roster?.students?.length || 0} תלמידים.</div> : null}
      {statusesSaved ? <div className="ok">סטטוסי המפגש נשמרו.</div> : null}
      {messageSaved ? <div className="ok">הודעת המפגש נשמרה.</div> : null}
      {lockSaved === "locked" ? <div className="ok">המפגש ננעל. לא ניתן לעדכן סטטוסים עד פתיחת הנעילה.</div> : null}
      {lockSaved === "unlocked" ? <div className="ok">נעילת המפגש נפתחה ואפשר לעדכן סטטוסים.</div> : null}
      {mailQueued ? <div className="ok">שליחת המיילים התחילה ברקע. אפשר לסגור את החלון והמערכת תמשיך.</div> : null}
      {mailSent ? <div className="ok">נשלחו {sentEmails || "0"} מיילים מתוך המפגש{Number(failedEmails || 0) > 0 ? `, ו-${failedEmails} נכשלו` : ""}.</div> : null}
      {mailError ? <div className="error">{mailError}</div> : null}
      {quickEmailSent ? <div className="ok">המייל נשלח לתור השליחה ויישלח ברקע.</div> : null}
      {quickEmailError ? <div className="error">{quickEmailError}</div> : null}
      {whatsappTemplateSent ? <div className="ok">הודעות WhatsApp נשלחו לפי התבנית המאושרת.</div> : null}
      {whatsappTemplateError ? <div className="error">{whatsappTemplateError}</div> : null}
      {invitationSaved ? <div className="ok">הגדרות ההזמנה נשמרו.</div> : null}
      {invitationQueued ? <div className="ok">שליחת ההזמנות התחילה ברקע.</div> : null}
      {invitationError ? <div className="error">{invitationError}</div> : null}

      <details className="card attendance-message-panel">
        <summary className="attendance-message-summary">
          <div>
            <h3>יצוא</h3>
            <span className="muted">PDF לפי המיון הנבחר. פתיחה רק כשצריך להוריד דוח.</span>
          </div>
          <span className="attendance-message-summary-action">פתח יצוא</span>
        </summary>
        <form method="get" className="grid attendance-message-grid">
          {activeStatusFilters.length ? <input type="hidden" name="statusFilter" value={activeStatusFilters.join(",")} /> : null}
          <label>
            <span className="muted">מיון PDF</span>
            <select name="exportSort" defaultValue={PDF_SORT_LABELS[exportSort] ? exportSort : "class_name"}>
              {Object.entries(PDF_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="quick-actions">
            <button type="submit" className="quick-action-btn quick-action-outline">החל מיון</button>
            <a
              className="quick-action-btn quick-action-primary"
              href={`/api/attendance/${roster.session.id}/pdf?sort=${encodeURIComponent(PDF_SORT_LABELS[exportSort] ? exportSort : "class_name")}`}
              target="_blank"
              rel="noreferrer"
            >
              הורד PDF
            </a>
          </div>
        </form>
      </details>

      <details className="card attendance-message-panel" open={studentsSaved || roster.students.length === 0}>
        <summary className="attendance-message-summary">
          <div>
            <h3>ניהול תלמידי המפגש</h3>
            <span className="muted">אפשר להוסיף תלמידים אחד־אחד בחיפוש, גם במפגש ללא מסנן. הסנכרון משאיר גם תלמידים שנבחרו ידנית.</span>
          </div>
          <span className="attendance-message-summary-action">פתח ניהול תלמידים</span>
        </summary>
        <form action={saveAttendanceSessionStudentsAction}>
          <input type="hidden" name="sessionId" value={roster.session.id} />
          <AttendanceStudentPicker
            students={manualStudentOptions}
            rosterStudents={roster.students}
            defaultValues={roster.session.manualStudentIds || []}
            sessionId={roster.session.id}
            saveAction={setAttendanceSessionManualStudentAction}
          />
          <div className="quick-actions">
            <button type="submit" className="quick-action-btn quick-action-primary">שמור תלמידים ידניים</button>
            <span className="muted">מסנני המפגש הקיימים ממשיכים לעבוד בנוסף לבחירה הידנית.</span>
          </div>
        </form>
      </details>

      {canManageSessionSettings ? (
        <details className="card attendance-message-panel attendance-responsibility-panel" open>
          <summary className="attendance-message-summary">
            <div>
              <h3>אחראי מפגש וחשיפה לתלמידים</h3>
              <span className="muted">אפשר לבחור צוות או תלמידים ידנית, או להוסיף בבת אחת לפי מוסד ושיעור. הרשאת מוקד נפרדת קובעת מי רשאי לבצע שיחות בפועל.</span>
            </div>
            <span className="attendance-message-summary-action">פתח ניהול אחראים</span>
          </summary>
          <form className="grid attendance-message-grid" action={saveAttendanceSessionResponsibilityAction}>
            <input type="hidden" name="sessionId" value={roster.session.id} />
            <ResponsibleUserPicker
              users={responsibleUsers}
              students={manualStudentOptions}
              defaultValues={roster.session.responsibleUserIds || []}
            />
            <label className="attendance-visibility-toggle">
              <input
                type="checkbox"
                name="visibleToStudents"
                value="1"
                defaultChecked={roster.session.visibleToStudents}
              />
              <span className="attendance-visibility-box" aria-hidden="true" />
              <span>
                <strong>גלוי לתלמידים</strong>
                <small>
                  {roster.session.visibleToStudents
                    ? "מופעל עכשיו. תלמידים רלוונטיים יראו את המפגש כל עוד הוא פתוח."
                    : "כבוי עכשיו. תלמידים לא יראו את המפגש עד סימון התיבה."}
                </small>
              </span>
            </label>
            <div className="quick-actions">
              <button type="submit" className="quick-action-btn quick-action-primary">שמור אחראים והגדרה</button>
            </div>
          </form>
        </details>
      ) : null}

      <details className="card attendance-message-panel" open={whatsappTemplateSent || Boolean(whatsappTemplateError)}>
        <summary className="attendance-message-summary">
          <div>
            <h3>שליחה נפרדת ב־WhatsApp</h3>
            <span className="muted">בוט התפוצה של Dualhook: בחירת תלמידים או הורים לפי תבנית WhatsApp מאושרת בלבד.</span>
          </div>
          <span className="attendance-message-summary-action">פתח שליחה</span>
        </summary>
        <AttendanceMessageComposer
          sessionId={roster.session.id}
          session={roster.session}
          statusOptions={statusOptions}
          templates={attendanceStatusTemplates}
          saveAction={saveAttendanceSessionMessagingAction}
          emailAction={sendAttendanceSessionEmailsAction}
          whatsappAction={sendAttendanceSessionWhatsAppApprovedTemplateAction}
          whatsappOnly
        />
      </details>

      <AttendanceInvitationConfig
        session={roster.session}
        templates={invitationTemplates}
        templateError={whatsappTemplateLoadError}
        saveAction={saveAttendanceSessionInvitationAction}
        sendAction={sendAttendanceInvitationAction}
      />

      {roster.session.isLocked ? (
        <div className="attendance-lock-banner">
          המפגש נעול לעדכוני סטטוסים. מנהל יכול לפתוח את הנעילה מהכפתור בראש הדף.
        </div>
      ) : null}

      <details className="card attendance-message-panel">
        <summary className="attendance-message-summary">
          <div>
            <h3>פרטי המפגש</h3>
            <span className="muted">{sessionSummary}</span>
          </div>
          <span className="attendance-message-summary-action">ערוך פרטים</span>
        </summary>
        <form className="grid attendance-message-grid" action={saveAttendanceSessionDetailsAction}>
          <input type="hidden" name="sessionId" value={roster.session.id} />
          <label>
            <span className="muted">סוג מפגש</span>
            <select name="sessionType" defaultValue={roster.session.sessionType || ""} required>
              {ATTENDANCE_SELECTABLE_SESSION_TYPE_ORDER.map((value) => (
                <option key={value} value={value}>{ATTENDANCE_SESSION_TYPE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">שם מפגש חופשי</span>
            <input name="title" defaultValue={roster.session.title} placeholder="למשל: ביקורת ערב" />
          </label>
          <label>
            <span className="muted">קהל המפגש</span>
            <select name="communicationAudience" defaultValue={roster.session.communicationAudience || "student"} required>
              <option value="student">המפגש מיועד לתלמידים</option>
              <option value="parents">פנייה להורים בנוגע לתלמיד</option>
              <option value="parent_meeting">פגישה ישירה עם ההורים</option>
            </select>
          </label>
          <label>
            <span className="muted">תאריך</span>
            <input name="sessionDate" type="date" defaultValue={roster.session.sessionDate} required />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">פרטי המפגש ותוכן ההודעה</span>
            <textarea name="sourceNote" rows={5} defaultValue={roster.session.sourceNote} placeholder="הטקסט שיופיע גם במייל וגם ב־WhatsApp" />
            <small className="muted">הטקסט נשמר פעם אחת ומשמש את שני ערוצי ההזמנה.</small>
          </label>
          <div className="quick-actions">
            <button type="submit" className="quick-action-btn quick-action-outline">שמור פרטי מפגש</button>
          </div>
        </form>
      </details>

      <details className="card attendance-message-panel" open={statusesSaved}>
        <summary className="attendance-message-summary">
          <div>
            <h3>סטטוסים למפגש</h3>
            <span className="muted">פותחים רק אם צריך להוסיף סטטוסים ייחודיים.</span>
          </div>
          <span className="attendance-message-summary-action">פתח אפשרויות</span>
        </summary>
        <div>
          <p className="muted">הסטטוסים הייחודיים שייכים למפגש עצמו, ומופיעים מיד בכפתורי הנוכחות, בסינון, בדוחות וגם בשליחת המיילים.</p>
          <form className="grid" action={saveAttendanceSessionStatusesAction}>
            <input type="hidden" name="sessionId" value={roster.session.id} />
            <CustomStatusEditor statuses={roster.session.customStatuses} />
            <div className="quick-actions">
              <button type="submit" className="quick-action-btn quick-action-outline">שמור סטטוסים</button>
            </div>
          </form>
        </div>
      </details>

      <details className="card attendance-message-panel" open={messageSaved || mailQueued || mailSent || Boolean(mailError)}>
        <summary className="attendance-message-summary">
          <div>
            <h3>שליחת הודעות למפגש</h3>
            <span className="muted">פותחים רק כשצריך לשלוח מייל.</span>
          </div>
          <span className="attendance-message-summary-action">פתח אפשרויות</span>
        </summary>
        <form className="grid attendance-message-grid">
          <input type="hidden" name="sessionId" value={roster.session.id} />
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">נושא המייל</span>
            <input name="emailSubject" defaultValue={roster.session.emailSubject} placeholder="לדוגמה: עדכון נוכחות למפגש מנהל" />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">טקסט ההודעה</span>
            <textarea name="personalMessage" rows={4} defaultValue={roster.session.personalMessage} placeholder="לדוגמה: שלום, המערכת לא זיהתה את התלמיד במפגש. נשמח שתעדכנו את מצבו דרך הכפתורים בהודעה." />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>סטטוסים שאפשר לעדכן מתוך ההודעה</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {statusOptions.map(([value, label]) => (
                <label key={`response-${value}`} className={`attendance-filter-chip${roster.session.emailResponseStatuses.includes(value) ? " active" : ""}`}>
                  <input
                    type="checkbox"
                    name="emailResponseStatuses"
                    value={value}
                    defaultChecked={roster.session.emailResponseStatuses.includes(value)}
                    style={{ marginInlineEnd: 6 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>שני סטטוסים לעדכון דרך WhatsApp</b>
            <span className="muted">יש לבחור בדיוק שניים. משמעות הכפתורים תופיע בגוף ההודעה.</span>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {statusOptions.map(([value, label]) => (
                <label key={`whatsapp-response-${value}`} className="attendance-filter-chip">
                  <input type="checkbox" name="whatsappResponseStatuses" value={value} style={{ marginInlineEnd: 6 }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <label className="attendance-visibility-toggle" style={{ gridColumn: "1 / -1" }}>
            <input type="checkbox" name="useGenericWhatsAppTemplate" value="1" />
            <span className="attendance-visibility-box" aria-hidden="true" />
            <span>
              <strong>השתמש בתבנית פנייה כללית</strong>
              <small>פנייה קצרה ללא הסבר על סוג המפגש; מתאימה לכל תלמיד או הורה.</small>
            </span>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <span className="muted">תמונה להודעת WhatsApp (אופציונלי, JPG או PNG עד 5MB)</span>
            <input type="file" name="whatsappImage" accept="image/jpeg,image/png" />
            <small className="muted">מתאים לתבנית הפנייה הכללית או לפגישה ישירה עם ההורים.</small>
          </label>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>למי שולחים במייל</b>
            <span className="muted">
              ב-WhatsApp הנמענים נקבעים לפי קהל המפגש: {roster.session.communicationAudience === "student" ? "התלמיד" : "אב ואם"}.
            </span>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {Object.entries(ATTENDANCE_EMAIL_RECIPIENT_LABELS).map(([value, label]) => (
                <label key={`recipient-${value}`} className={`attendance-filter-chip${roster.session.emailRecipientRoles.includes(value) ? " active" : ""}`}>
                  <input
                    type="checkbox"
                    name="emailRecipientRoles"
                    value={value}
                    defaultChecked={roster.session.emailRecipientRoles.includes(value)}
                    style={{ marginInlineEnd: 6 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <b>שלח לסטטוסים</b>
            <div className="attendance-filter-toolbar" style={{ marginTop: 0 }}>
              {statusOptions.map(([value, label]) => (
                <label key={`target-${value}`} className="attendance-filter-chip">
                  <input
                    type="checkbox"
                    name="targetStatuses"
                    value={value}
                    defaultChecked={value === "missing"}
                    style={{ marginInlineEnd: 6 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="quick-actions">
            <button formAction={saveAttendanceSessionMessagingAction} className="quick-action-btn quick-action-outline">שמור הודעה</button>
            <AttendanceEmailSendSubmit formAction={sendAttendanceSessionEmailsAction} />
            <button formAction={sendAttendanceSessionWhatsAppAction} className="quick-action-btn">שלח WhatsApp למפגש</button>
          </div>
        </form>
      </details>

      <AttendanceRosterClient
        sessionId={roster.session.id}
        students={roster.students}
        statusOptions={statusOptions}
        activeStatusFilters={activeStatusFilters}
        initialStats={roster.stats}
        isLocked={roster.session.isLocked}
        canSendEmails={currentUser.can_send_emails}
        canEmailParents={currentUser.can_email_parents}
        defaultReplyTo={defaultReplyTo}
        returnTo={`/attendance/${roster.session.id}`}
      />
    </>
  );
}
