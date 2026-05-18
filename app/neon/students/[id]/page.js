import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AttendanceHistoryPanel from "../../../../components/attendance-history-panel";
import { getAttendanceSummaryForStudent, listAttendanceHistoryForStudent } from "../../../../lib/attendance";
import { assertStudentAccess, canEditStudentCard, requireAuthenticatedUser } from "../../../../lib/rbac";
import { ENUM_LABELS, FIELD_SECTIONS, getByPath, hasDisplayValue, studentToFormValues } from "../../../../lib/student-fields";
import { listStudentDocuments } from "../../../../lib/student-documents";
import { getStudentTagTheme, getStudentTagsByStudentIds, listStudentTags } from "../../../../lib/student-tags";
import { listStudentContactLogs } from "../../../../lib/student-contact-logs";
import { ageOf } from "../../../../lib/student-view";
import { getNeonStudentById } from "../../../../lib/neon-students";
import { addStudentContactAction, deleteNeonStudentAction, removeStudentTagAction, updateNeonStudentAction, updateStudentTagsAction, uploadStudentDocumentAction, updateStudentDocumentNameAction } from "./actions";

const TOP_EDIT_KEYS = new Set(["currentInstitution", "registration", "class"]);
const ALL_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields);
const TOP_EDIT_FIELDS = ALL_FIELDS.filter((field) => TOP_EDIT_KEYS.has(field.key));

function clean(v) {
  return String(v || "").trim();
}

function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("he-IL");
}

function todayInputValue() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
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
    const text = phoneText(value);
    const href = phoneHref(value);
    const phoneDisplay = (
      <span dir="ltr" style={{ unicodeBidi: "isolate", display: "inline-block" }}>
        <span aria-hidden="true" style={{ marginInlineEnd: 6 }}>☎</span>
        {text}
      </span>
    );
    if (!href || text === "-") return phoneDisplay;
    return <a href={href}>{phoneDisplay}</a>;
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
  const tagsUpdated = clean(resolvedSearchParams?.tagsUpdated) === "1";
  const contactSaved = clean(resolvedSearchParams?.contactSaved) === "1";
  const errorText = clean(resolvedSearchParams?.error);

  const sections = visibleSections(student);
  const editValues = studentToFormValues(student);
  const studentName = `${student?.fullName?.firstName || ""} ${student?.fullName?.lastName || ""}`.trim() || student?.label || "-";
  const showChildrenCount = isMarried(student?.famliystatus);
  const [documents, availableTags, studentTagsMap, attendanceSummary, attendanceHistory] = await Promise.all([
    listStudentDocuments(studentId),
    listStudentTags(),
    getStudentTagsByStudentIds([studentId]),
    getAttendanceSummaryForStudent(studentId),
    listAttendanceHistoryForStudent(studentId)
  ]);
  const assignedTags = studentTagsMap[studentId] || [];
  const assignedTagIds = new Set(assignedTags.map((tag) => tag.id));
  const contactLogs = await listStudentContactLogs(studentId, 8);
  const latestContact = contactLogs[0] || null;
  const defaultContactDate = todayInputValue();
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
            {assignedTags.length ? (
              <div className="student-meta-line" style={{ marginTop: 10 }}>
                {assignedTags.map((tag) => (
                  <form key={tag.id} action={removeStudentTagAction} className="student-tag-chip-form">
                    <input type="hidden" name="studentId" value={studentId} />
                    <input type="hidden" name="tagId" value={tag.id} />
                    <button type="submit" className="student-tag-chip-button" title={`הסר תווית ${tag.name}`}>
                      <span style={getStudentTagTheme(tag)}>{tag.name}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  </form>
                ))}
              </div>
            ) : null}
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
      {tagsUpdated ? <div className="ok">תגיות התלמיד עודכנו בהצלחה.</div> : null}
      {contactSaved ? <div className="ok">רשומת יצירת הקשר נשמרה בהצלחה.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="card">
        <h3>תגיות תלמיד</h3>
        {!assignedTags.length ? (
          <p className="muted">עדיין לא שויכו תגיות לתלמיד הזה.</p>
        ) : (
          <div className="student-meta-line">
            {assignedTags.map((tag) => (
              <form key={tag.id} action={removeStudentTagAction} className="student-tag-chip-form">
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="tagId" value={tag.id} />
                <button type="submit" className="student-tag-chip-button" title={`הסר תווית ${tag.name}`}>
                  <span style={getStudentTagTheme(tag)}>{tag.name}</span>
                  <span aria-hidden="true">×</span>
                </button>
              </form>
            ))}
          </div>
        )}
        {canManageStudent ? (
          !availableTags.length ? (
            <p className="muted" style={{ marginTop: 12 }}>כדי לשייך תגיות, צריך קודם ליצור אותן במסך התלמידים הראשי.</p>
          ) : (
            <form action={updateStudentTagsAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="studentId" value={studentId} />
              <div className="column-grid">
                {availableTags.map((tag) => (
                  <label key={tag.id} className="column-item">
                    <input type="checkbox" name="tagIds" value={tag.id} defaultChecked={assignedTagIds.has(tag.id)} />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
              <div className="quick-actions" style={{ marginTop: 12 }}>
                <button type="submit">שמור תגיות</button>
                <Link className="chip-link" href="/neon">פתח ניהול תגיות</Link>
              </div>
            </form>
          )
        ) : null}
      </div>

      <details key={`linked-records-${editMode ? "edit" : "view"}`} className="card linked-records-panel">
        <summary className="linked-records-toggle">
          <div>
            <h3>רשומות מקושרות</h3>
            <p className="muted" style={{ marginBottom: 0 }}>מסמכי תלמיד ורשומות נוספות המשויכים לכרטיס.</p>
          </div>
          <div className="linked-records-summary">
            <span className="linked-record-pill">מסמכים: {documents.length}</span>
            <span className="linked-record-pill">רשומות עתידיות: בקרוב</span>
            <span className="linked-record-pill">יצירת קשר: {contactLogs.length}</span>
          </div>
        </summary>
        <div className="linked-record-card contact-log-card">
          <div className="linked-record-card-top">
            <b>יצירת קשר אחרונה</b>
            <span className="linked-record-pill">{latestContact ? formatDate(latestContact.contactDate) : "עדיין לא תועד"}</span>
          </div>
          <div className="linked-record-meta">{latestContact ? latestContact.noteText : "עדיין אין תיעוד יצירת קשר לתלמיד הזה."}</div>
          {latestContact?.createdByDisplayName || latestContact?.createdByEmail ? (
            <div className="linked-record-meta">תועד על ידי: {latestContact.createdByDisplayName || latestContact.createdByEmail}</div>
          ) : null}
        </div>
        <form action={addStudentContactAction} className="grid" style={{ marginBottom: 12 }}>
          <input type="hidden" name="studentId" value={studentId} />
          <input type="date" name="contactDate" defaultValue={defaultContactDate} />
          <input name="noteText" placeholder="תיעוד קצר של השיחה או יצירת הקשר" />
          <button type="submit">הוסף יצירת קשר</button>
        </form>
        {canManageDocuments ? (
          <form action={uploadStudentDocumentAction} className="grid" style={{ marginBottom: 12 }}>
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
        <AttendanceHistoryPanel embedded summary={attendanceSummary} history={attendanceHistory} />
        <div className="linked-records-grid">
          {!contactLogs.length ? (
            <div className="linked-record-card placeholder">
              <b>יצירת קשר</b>
              <div className="linked-record-meta">עדיין לא תועדה יצירת קשר עם התלמיד.</div>
              <div className="linked-record-meta">כאן יופיעו התאריך והסיכום הקצר של כל שיחה או פניה.</div>
            </div>
          ) : (
            contactLogs.map((contact) => (
              <div key={contact.id} className="linked-record-card">
                <div className="linked-record-card-top">
                  <b>יצירת קשר</b>
                  <span className="linked-record-pill">{formatDate(contact.contactDate)}</span>
                </div>
                <div className="linked-record-meta">{contact.noteText || "-"}</div>
                <div className="linked-record-meta">
                  תועד: {contact.createdByDisplayName || contact.createdByEmail || "-"}
                </div>
              </div>
            ))
          )}
          {!documents.length ? (
            <div className="linked-record-card">
              <b>מסמכים</b>
              <div className="linked-record-meta">אין מסמכים משויכים לתלמיד.</div>
              <div className="linked-record-meta">ברגע שיעלו קבצים הם יופיעו כאן כחלק מהרשומות המקושרות.</div>
            </div>
          ) : (
            documents.map((doc) => (
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
            ))
          )}
          <div className="linked-record-card placeholder">
            <b>רשומות נוספות</b>
            <div className="linked-record-meta">כאן נוכל להציג בהמשך פריטים נוספים שייקשרו לתלמיד מתוך המערכת.</div>
            <div className="linked-record-meta">המבנה כבר מוכן כדי שהכרטיס ימשיך לגדול בלי לשנות את חוויית השימוש.</div>
          </div>
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
