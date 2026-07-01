import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AttendanceHistoryPanel from "../../../../components/attendance-history-panel";
import OpenAttendanceSessionsPanel from "../../../../components/open-attendance-sessions-panel";
import { getAttendanceSummaryForStudent, listAttendanceHistoryForStudent, listOpenAttendanceSessionsForStudent } from "../../../../lib/attendance";
import { assertStudentAccess, canEditStudentCard, requireAuthenticatedUser } from "../../../../lib/rbac";
import { ENUM_LABELS, FIELD_SECTIONS, getByPath, hasDisplayValue, studentToFormValues } from "../../../../lib/student-fields";
import { listStudentEmailDeliveries } from "../../../../lib/email-campaigns";
import { listStudentEvents } from "../../../../lib/student-events";
import { listStudentDocuments } from "../../../../lib/student-documents";
import { getStudentTagsByStudentIds, listStudentTags } from "../../../../lib/student-tags";
import { listStudentContactLogs } from "../../../../lib/student-contact-logs";
import { ageOf } from "../../../../lib/student-view";
import { getNeonStudentById } from "../../../../lib/neon-students";
import { deleteNeonStudentAction, updateNeonStudentAction, uploadStudentDocumentAction, updateStudentDocumentNameAction, updateStudentOpenAttendanceAction } from "./actions";
import StudentContactLiveClient from "./student-contact-live-client";
import StudentEventsLiveClient from "./student-events-live-client";
import StudentTagsLiveClient from "./student-tags-live-client";

const TOP_EDIT_KEYS = new Set(["currentInstitution", "registration", "class"]);
const ALL_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields);
const TOP_EDIT_FIELDS = ALL_FIELDS.filter((field) => TOP_EDIT_KEYS.has(field.key));

function clean(v) {
  return String(v || "").trim();
}

function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("he-IL");
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function phoneHref(phoneObj) {
  const number = clean(phoneObj?.primaryPhoneNumber).replace(/[^\d]/g, "");
  if (!number) return "";
  const calling = clean(phoneObj?.primaryPhoneCallingCode).replace(/[^\d+]/g, "");
  const prefix = calling || "+";
  return `tel:${prefix}${number}`.replace(/\s+/g, "");
}

function whatsappHref(phoneObj) {
  const number = clean(phoneObj?.primaryPhoneNumber).replace(/[^\d]/g, "");
  if (!number) return "";
  const calling = clean(phoneObj?.primaryPhoneCallingCode).replace(/[^\d]/g, "");
  const whatsappNumber = calling
    ? `${calling}${number.replace(/^0+/, "")}`
    : number.replace(/^0/, "972");
  return whatsappNumber ? `https://wa.me/${whatsappNumber}` : "";
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width="18" height="18" style={{ display: "block" }}>
      <path fill="#25D366" d="M16 3C8.83 3 3 8.73 3 15.77c0 2.25.61 4.46 1.76 6.39L3 29l7.03-1.79A13.14 13.14 0 0 0 16 28.54c7.17 0 13-5.73 13-12.77S23.17 3 16 3Z" />
      <path fill="#fff" d="M23.2 19.38c-.3-.15-1.77-.86-2.05-.96-.27-.1-.47-.15-.67.15-.2.29-.77.96-.94 1.15-.17.2-.35.22-.64.07-.3-.14-1.25-.45-2.38-1.45-.88-.77-1.47-1.72-1.64-2.01-.17-.3-.02-.46.13-.6.13-.13.3-.34.45-.51.15-.17.2-.3.3-.49.1-.2.05-.37-.02-.52-.08-.15-.68-1.61-.93-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.36-.27.3-1.04 1-1.04 2.45s1.07 2.85 1.22 3.04c.15.2 2.1 3.15 5.1 4.42.71.3 1.27.48 1.7.62.72.22 1.37.19 1.89.12.58-.09 1.77-.71 2.02-1.4.25-.69.25-1.28.17-1.4-.07-.13-.27-.2-.57-.35Z" />
    </svg>
  );
}

function renderPhoneValue(phoneObj) {
  const text = phoneText(phoneObj);
  const callHref = phoneHref(phoneObj);
  const waHref = whatsappHref(phoneObj);
  const phoneDisplay = (
    <span dir="ltr" style={{ unicodeBidi: "isolate", display: "inline-block" }}>
      <span aria-hidden="true" style={{ marginInlineEnd: 6 }}>☎</span>
      {text}
    </span>
  );

  if (!callHref || text === "-") return phoneDisplay;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span>{phoneDisplay}</span>
      <a href={callHref} aria-label={`חייג אל ${text}`}>חיוג</a>
      {waHref ? (
        <a href={waHref} target="_blank" rel="noopener noreferrer" aria-label={`פתח WhatsApp אל ${text}`} title="WhatsApp">
          <WhatsAppIcon />
        </a>
      ) : null}
    </span>
  );
}

function emailHref(value) {
  const email = clean(value);
  return email && email.includes("@") ? `mailto:${email}` : "";
}

function renderEmailValue(value) {
  if (Array.isArray(value)) {
    const emails = value.map(clean).filter(Boolean);
    if (!emails.length) return "-";
    return emails.map((email, index) => (
      <span key={`${email}-${index}`}>
        {index > 0 ? ", " : ""}
        <a href={`mailto:${email}`}>{email}</a>
      </span>
    ));
  }

  const email = clean(value);
  const href = emailHref(email);
  if (!href) return email || "-";
  return <a href={href}>{email}</a>;
}

function formatDisplayValue(field, value) {
  if (!hasDisplayValue(value)) return "-";
  if (field.type === "phone") {
    return renderPhoneValue(value);
  }
  if (String(field?.key || "").toLowerCase().includes("email")) {
    return renderEmailValue(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  if (field.type === "date") return formatDate(value);
  if (field.enum && ENUM_LABELS[field.enum]) return ENUM_LABELS[field.enum][String(value)] || String(value);
  if (typeof value === "boolean") return value ? "כן" : "לא";
  return String(value);
}

const PHONE_GROUPS = [
  { prefix: "phone", label: "טלפון תלמיד" },
  { prefix: "dadPhone", label: "טלפון אב" },
  { prefix: "momPhone", label: "טלפון אם" }
];

function isPhoneSubField(key) {
  return /^(phone|dadPhone|momPhone)\./.test(String(key || ""));
}

function isAdvancedOnlyField(fieldKey) {
  return /\.additional(Phones|Emails)$/.test(String(fieldKey || ""));
}

function visibleSections(student) {
  return FIELD_SECTIONS.map((section) => {
    const normalFields = section.fields
      .filter((field) => !isPhoneSubField(field.key))
      .filter((field) => field.key !== "childrenCount" || isMarried(student?.famliystatus))
      .map((field) => ({ field, value: getByPath(student, field.key) }))
      .filter((row) => hasDisplayValue(row.value));

    const phoneFields = PHONE_GROUPS
      .filter((group) => section.fields.some((f) => String(f.key).startsWith(`${group.prefix}.`)))
      .map((group) => ({
        field: { key: `${group.prefix}.__combined`, label: group.label, type: "phone" },
        value: getByPath(student, group.prefix)
      }))
      .filter((row) => hasDisplayValue(row.value?.primaryPhoneNumber));

    return { ...section, fields: [...normalFields, ...phoneFields] };
  }).filter((section) => section.fields.length > 0);
}

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  return ENUM_LABELS.currentInstitution?.[key] || clean(value) || "-";
}

function registrationLabel(value) {
  const key = clean(value).toUpperCase();
  return ENUM_LABELS.registration?.[key] || clean(value) || "-";
}

function classLabel(value) {
  const key = clean(value).toUpperCase();
  return ENUM_LABELS.class?.[key] || clean(value) || "-";
}

function documentKindLabel(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "id") return "תעודת זהות";
  if (normalized === "tuition") return "שכר לימוד";
  if (normalized === "medical") return "מסמך רפואי";
  return "מסמך כללי";
}

function isMarried(value) {
  return clean(value).toUpperCase() === "MARRIED";
}

function emailStatusLabel(delivery) {
  const numeric = Number(delivery?.certainty_level || 0);
  if (clean(delivery?.status) === "unsubscribed") return "הוסר";
  if (clean(delivery?.status) === "failed") return "נכשל";
  if (numeric >= 4) return "נלחץ";
  if (numeric >= 3) return "נפתח";
  if (numeric >= 2) return "נשלח";
  if (numeric >= 1) return "בתור";
  return "אין ודאות";
}

function EditField({ field, value }) {
  if (field.enum && ENUM_LABELS[field.enum]) {
    const emptyOptionLabel = value ? "נקה בחירה" : "ללא בחירה";
    return (
      <select name={field.key} defaultValue={value || ""}>
        <option value="">{emptyOptionLabel}</option>
        {Object.entries(ENUM_LABELS[field.enum]).map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "date") {
    return <input type="date" name={field.key} defaultValue={value || ""} />;
  }

  if (field.type === "number") {
    return <input type="number" min="0" step="1" name={field.key} defaultValue={value ?? ""} />;
  }

  if (field.isList) {
    return <textarea name={field.key} defaultValue={value || ""} placeholder="הפרדה בפסיק או שורה חדשה" />;
  }

  return <input name={field.key} defaultValue={value || ""} />;
}

export default async function NeonStudentPage({ params, searchParams }) {
  const currentUser = await requireAuthenticatedUser();
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const studentId = resolvedParams.id;

  if (!assertStudentAccess(currentUser, studentId)) {
    if (currentUser.linked_student_id) redirect(`/neon/students/${currentUser.linked_student_id}`);
    redirect("/unauthorized");
  }

  const student = await getNeonStudentById(studentId);
  if (!student) notFound();

  const canManageStudent = Boolean(currentUser?.is_team_member || currentUser?.is_manager);
  const canEdit = canManageStudent && canEditStudentCard(currentUser, studentId);
  const canManageDocuments = assertStudentAccess(currentUser, studentId);
  const editMode = canEdit && clean(resolvedSearchParams?.edit) === "1";
  const advancedMode = editMode && clean(resolvedSearchParams?.advanced) === "1";
  const updated = clean(resolvedSearchParams?.updated) === "1";
  const documentUploaded = clean(resolvedSearchParams?.documentUploaded) === "1";
  const documentRenamed = clean(resolvedSearchParams?.documentRenamed) === "1";
  const attendanceUpdated = clean(resolvedSearchParams?.attendanceUpdated) === "1";
  const errorText = clean(resolvedSearchParams?.error);

  const sections = visibleSections(student);
  const editValues = studentToFormValues(student);
  const studentName = `${student?.fullName?.firstName || ""} ${student?.fullName?.lastName || ""}`.trim() || student?.label || "-";
  const showChildrenCount = isMarried(student?.famliystatus);
  const documents = await listStudentDocuments(studentId);
  const availableTags = await listStudentTags();
  const studentTagsMap = await getStudentTagsByStudentIds([studentId]);
  const assignedTags = studentTagsMap[studentId] || [];
  const emailDeliveries = currentUser.can_view_email_reports ? await listStudentEmailDeliveries(studentId, 8) : [];
  const [attendanceSummary, attendanceHistory, openAttendanceSessions, contactLogs, studentEvents] = await Promise.all([
    getAttendanceSummaryForStudent(studentId),
    listAttendanceHistoryForStudent(studentId, { limit: 8 }),
    listOpenAttendanceSessionsForStudent(studentId, { limit: 8 }),
    listStudentContactLogs(studentId, 8),
    listStudentEvents(studentId, 12)
  ]);
  const deleteLabel = `אני מאשר מחיקה של תלמיד ${studentName}`;

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>כרטיס תלמיד</h1>
            <div className="student-meta-line">
              <span className="meta-chip">מוסד: {institutionLabel(student?.currentInstitution)}</span>
              <span className="meta-chip">רישום: {registrationLabel(student?.registration)}</span>
              <span className="meta-chip">גיל: {ageOf(student?.dateofbirth) ?? "-"}</span>
              <span className="meta-chip meta-chip-strong">שיעור: {classLabel(student?.class)}</span>
            </div>
            <StudentTagsLiveClient
              studentId={studentId}
              initialTags={assignedTags}
              initialAvailableTags={availableTags}
              canManageStudent={canManageStudent}
            />
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/neon">חזרה לרשימת תלמידים</Link>
            {editMode ? (
              <>
                <Link
                  className="btn btn-ghost"
                  href={advancedMode ? `/neon/students/${studentId}?edit=1` : `/neon/students/${studentId}?edit=1&advanced=1`}
                >
                  {advancedMode ? "מעבר לעריכה רגילה" : "עריכה מתקדמת"}
                </Link>
                <Link className="btn btn-close" href={`/neon/students/${studentId}`}>
                  <span className="btn-icon-badge" aria-hidden="true">×</span>
                  <span>סגור עריכה</span>
                </Link>
              </>
            ) : canEdit ? (
              <Link className="btn btn-edit" href={`/neon/students/${studentId}?edit=1`}>
                <span className="btn-icon-badge" aria-hidden="true">✎</span>
                <span>עריכת שדות</span>
              </Link>
            ) : null}
            {canManageStudent ? (
              <details className="student-delete-form">
                <summary className="btn btn-danger">מחק תלמיד</summary>
                <form action={deleteNeonStudentAction} className="card" style={{ marginTop: 8 }}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <div className="muted">התלמיד יוסתר מיד מכל הרשימות ויעבור לאזור מחיקה זמני ל-30 יום.</div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <input type="checkbox" name="confirmDelete" value="1" />
                    <span>{deleteLabel}</span>
                  </label>
                  <input name="confirmationText" placeholder='הקלד "אני מאשר"' style={{ marginTop: 8 }} />
                  <div className="quick-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-danger" type="submit">אשר מחיקה</button>
                    <Link className="btn btn-ghost" href="/admin/deleted-students">פתח אזור מחיקה זמני</Link>
                  </div>
                </form>
              </details>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>מידע תלמיד</h3>
        <p className="muted">{studentName}</p>
        <p className="muted">
          {canManageStudent
            ? "השמירה במסך הזה מעדכנת את נתוני התלמיד במערכת."
            : "בכרטיס האישי ניתן לצפות בפרטים ולנהל מסמכים המשויכים אליך."}
        </p>
      </div>

      {updated ? <div className="ok">השינויים נשמרו בהצלחה.</div> : null}
      {documentUploaded ? <div className="ok">המסמך הועלה ונשמר בכרטיס התלמיד.</div> : null}
      {documentRenamed ? <div className="ok">שם המסמך עודכן.</div> : null}
      {attendanceUpdated ? <div className="ok">הנוכחות עודכנה במפגש הפתוח.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <details key={`linked-records-${editMode ? "edit" : "view"}`} className="card linked-records-panel">
        <summary className="linked-records-toggle">
          <div>
            <h3>רשומות מקושרות</h3>
            <p className="muted" style={{ marginBottom: 0 }}>מסמכי תלמיד ורשומות נוספות המשויכים לכרטיס.</p>
          </div>
          <div className="linked-records-summary">
            <span className="linked-record-pill">מסמכים: {documents.length}</span>
            <span className="linked-record-pill">מיילים: {emailDeliveries.length}</span>
            <span className="linked-record-pill">יצירת קשר: {contactLogs.length}</span>
            <span className="linked-record-pill">אירועים: {studentEvents.length}</span>
          </div>
        </summary>
        <div className="linked-record-groups">
          <StudentEventsLiveClient studentId={studentId} initialEvents={studentEvents} />
          <StudentContactLiveClient studentId={studentId} initialContactLogs={contactLogs} />
          <details className="linked-record-group">
            <summary className="linked-record-group-summary">
              <div>
                <b>מסמכים</b>
                <div className="linked-record-meta">קבצים משויכים לכרטיס התלמיד.</div>
              </div>
              <div className="linked-records-summary">
                <span className="linked-record-pill">רשומות: {documents.length}</span>
              </div>
            </summary>
            <div className="linked-record-group-body">
              {canManageDocuments ? (
                <form action={uploadStudentDocumentAction} className="grid">
                  <input type="hidden" name="studentId" value={studentId} />
                  <input name="displayName" placeholder="שם מסמך" />
                  <select name="documentKind" defaultValue="general">
                    <option value="general">מסמך כללי</option>
                    <option value="id">תעודת זהות</option>
                    <option value="tuition">שכר לימוד</option>
                    <option value="medical">מסמך רפואי</option>
                  </select>
                  <textarea name="noteText" placeholder="הערות למסמך" />
                  <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp" />
                  <button type="submit">העלה מסמך</button>
                </form>
              ) : null}
              {!documents.length ? (
                <div className="linked-record-card">
                  <b>מסמכים</b>
                  <div className="linked-record-meta">אין מסמכים משויכים לתלמיד.</div>
                  <div className="linked-record-meta">ברגע שיעלו קבצים הם יופיעו כאן כחלק מהרשומות המקושרות.</div>
                </div>
              ) : (
                <div className="linked-records-grid">
                  {documents.map((doc) => (
                    <div key={doc.id} className="linked-record-card">
                      <div className="linked-record-card-top">
                        <a className="linked-record-title" href={`/api/student-documents/${doc.id}`} target="_blank">{doc.name}</a>
                        <div className="student-document-title-row">
                          <span className="linked-record-pill">{documentKindLabel(doc.documentKind)}</span>
                          {canManageDocuments ? (
                            <details className="student-document-rename">
                              <summary title="ערוך שם מסמך">✎</summary>
                              <form action={updateStudentDocumentNameAction} className="student-document-rename-form">
                                <input type="hidden" name="studentId" value={studentId} />
                                <input type="hidden" name="documentId" value={doc.id} />
                                <input name="displayName" defaultValue={doc.name} aria-label="שם מסמך" />
                                <button type="submit">שמור</button>
                              </form>
                            </details>
                          ) : null}
                        </div>
                      </div>
                      <div className="linked-record-meta">קובץ מקור: {doc.fileName}</div>
                      <div className="linked-record-meta">הועלה: {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString("he-IL") : "-"}</div>
                      <div className="linked-record-meta">הערות: {doc.noteText || "-"}</div>
                      <div className="linked-record-meta">פורמט: {doc.contentType}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
          <details className="linked-record-group">
            <summary className="linked-record-group-summary">
              <div>
                <b>מיילים</b>
                <div className="linked-record-meta">היסטוריית שליחות, פתיחות ולחיצות.</div>
              </div>
              <div className="linked-records-summary">
                <span className="linked-record-pill">רשומות: {emailDeliveries.length}</span>
              </div>
            </summary>
            <div className="linked-record-group-body">
              {!currentUser.can_view_email_reports ? (
                <div className="linked-record-card placeholder">
                  <b>מיילים</b>
                  <div className="linked-record-meta">היסטוריית מיילים זמינה למשתמשים עם הרשאת דוחות.</div>
                </div>
              ) : !emailDeliveries.length ? (
                <div className="linked-record-card placeholder">
                  <b>מיילים</b>
                  <div className="linked-record-meta">עדיין לא נשלחו מיילים משויכים לתלמיד הזה.</div>
                  <div className="linked-record-meta">כאן יופיעו הודעות, פתיחות ולחיצות מתוך מערכת המיילים.</div>
                </div>
              ) : (
                <div className="linked-records-grid">
                  {emailDeliveries.map((delivery) => (
                    <div key={delivery.id} className="linked-record-card">
                      <div className="linked-record-card-top">
                        <Link className="linked-record-title" href={`/email/campaigns/${delivery.campaign_id}?delivery=${delivery.id}`}>
                          {delivery.subject}
                        </Link>
                        <span className="linked-record-pill">{emailStatusLabel(delivery)}</span>
                      </div>
                      <div className="linked-record-meta">נמען: {delivery.recipient_name || delivery.recipient_email}</div>
                      <div className="linked-record-meta">אימייל: {delivery.recipient_email}</div>
                      <div className="linked-record-meta">פתיחות: {delivery.open_count || 0}</div>
                      <div className="linked-record-meta">נפתח: {delivery.opened_at ? new Date(delivery.opened_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "-"}</div>
                      <div className="linked-record-meta">נלחץ: {delivery.clicked_at ? new Date(delivery.clicked_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "-"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
          <details className="linked-record-group">
            <summary className="linked-record-group-summary">
              <div>
                <b>נוכחות</b>
                <div className="linked-record-meta">היסטוריית מפגשים ונתוני נוכחות.</div>
              </div>
              <div className="linked-records-summary">
                <span className="linked-record-pill">מפגשים: {attendanceSummary?.totalSessions || 0}</span>
                <span className="linked-record-pill">פתוחים: {openAttendanceSessions.length}</span>
              </div>
            </summary>
            <div className="linked-record-group-body">
              <OpenAttendanceSessionsPanel
                studentId={studentId}
                sessions={openAttendanceSessions}
                action={updateStudentOpenAttendanceAction}
              />
              <AttendanceHistoryPanel embedded summary={attendanceSummary} history={attendanceHistory} />
            </div>
          </details>
        </div>
      </details>

      {editMode ? (
        <form action={updateNeonStudentAction}>
          <div className="sticky-save-bar">
            <div className="editor-action-bar">
              <div className="editor-action-bar-group">
                <Link className="btn btn-close" href={`/neon/students/${studentId}`}>
                  <span className="btn-icon-badge" aria-hidden="true">×</span>
                  <span>סגור עריכה</span>
                </Link>
                <span className="editor-action-hint">סרגל הפעולות נשאר זמין לאורך כל העריכה.</span>
              </div>
              <div className="editor-action-bar-group" style={{ justifyContent: "flex-end" }}>
                <input type="hidden" name="studentId" value={studentId} />
                <button className="btn btn-save" type="submit">שמור שינויים</button>
              </div>
            </div>
          </div>

          <div className="card edit-focus-card">
            <h3 className="edit-focus-title">עריכה מהירה</h3>
            <div className="grid">
              {TOP_EDIT_FIELDS.map((field) => (
                <div key={field.key}>
                  <label>{field.label}</label>
                  <EditField field={field} value={editValues[field.key] || ""} />
                </div>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              טלפונים ואימיילים נוספים מוסתרים כברירת מחדל. להצגה שלהם בחר "עריכה מתקדמת".
            </p>
          </div>

          <div className="card">
            {FIELD_SECTIONS.map((section) => {
              const sectionFields = section.fields.filter((field) => {
                if (TOP_EDIT_KEYS.has(field.key)) return false;
                if (field.key === "childrenCount" && !showChildrenCount) return false;
                if (!advancedMode && isAdvancedOnlyField(field.key)) return false;
                return true;
              });
              if (!sectionFields.length) return null;

              return (
                <div key={section.title} className="card" style={{ marginBottom: 12 }}>
                  <h3>{section.title}</h3>
                  <div className="grid">
                    {sectionFields.map((field) => (
                      <div key={field.key}>
                        <label>{field.label}</label>
                        <EditField field={field} value={editValues[field.key] || ""} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </form>
      ) : (
        <div className="card">
          <h3>פרטי הכרטיס</h3>
          {!sections.length ? (
            <div className="muted">לא נמצא מידע להצגה.</div>
          ) : (
            sections.map((section) => (
              <div key={section.title} className="card" style={{ marginBottom: 12 }}>
                <h4>{section.title}</h4>
                <div className="grid">
                  {section.fields.map(({ field, value }) => (
                    <div key={field.key}>
                      <b>{field.label}:</b> {formatDisplayValue(field, value)}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
