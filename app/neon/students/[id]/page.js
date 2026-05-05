import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { assertStudentAccess, canEditStudentCard, requireAuthenticatedUser } from "../../../../lib/rbac";
import { ENUM_LABELS, FIELD_SECTIONS, getByPath, hasDisplayValue, studentToFormValues } from "../../../../lib/student-fields";
import { listStudentDocuments } from "../../../../lib/student-documents";
import { ageOf } from "../../../../lib/student-view";
import { getNeonStudentById } from "../../../../lib/neon-students";
import { updateNeonStudentAction, uploadStudentDocumentAction, updateStudentDocumentNameAction } from "./actions";

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

function formatDisplayValue(field, value) {
  if (!hasDisplayValue(value)) return "-";
  if (field.type === "phone") {
    const text = phoneText(value);
    const href = phoneHref(value);
    if (!href || text === "-") return text;
    return <a href={href}>{text}</a>;
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
  const errorText = clean(resolvedSearchParams?.error);

  const sections = visibleSections(student);
  const editValues = studentToFormValues(student);
  const studentName = `${student?.fullName?.firstName || ""} ${student?.fullName?.lastName || ""}`.trim() || student?.label || "-";
  const showChildrenCount = isMarried(student?.famliystatus);
  const documents = await listStudentDocuments(studentId);

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>כרטיס תלמיד - Neon Beta</h1>
            <div className="student-meta-line">
              <span className="meta-chip">מוסד: {institutionLabel(student?.currentInstitution)}</span>
              <span className="meta-chip">רישום: {registrationLabel(student?.registration)}</span>
              <span className="meta-chip">גיל: {ageOf(student?.dateofbirth) ?? "-"}</span>
              <span className="meta-chip meta-chip-strong">שיעור: {classLabel(student?.class)}</span>
            </div>
          </div>
          <div className="student-actions student-actions-wrap">
            <Link className="btn btn-ghost" href="/neon">חזרה לרשימת Neon</Link>
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
            <Link className="btn btn-ghost" href={`/students/${studentId}`}>פתח בגרסה הראשית</Link>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>מידע תלמיד</h3>
        <p className="muted">{studentName}</p>
        <p className="muted">
          {canManageStudent
            ? "השמירה במסך הזה מעדכנת את Twenty ואז מרעננת את המראה ב-Neon."
            : "בכרטיס האישי ניתן לצפות בפרטים ולנהל מסמכים המשויכים אליך."}
        </p>
      </div>

      {updated ? <div className="ok">השינויים נשמרו בהצלחה ב-Twenty וב-Neon.</div> : null}
      {documentUploaded ? <div className="ok">המסמך הועלה ונשמר בכרטיס התלמיד.</div> : null}
      {documentRenamed ? <div className="ok">שם המסמך עודכן.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      <div className="card">
        <div className="linked-records-head">
          <div>
            <h3>רשומות מקושרות</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              כרגע מוצגים כאן מסמכי התלמיד, ובהמשך נוכל להוסיף לאותו אזור גם סוגי רשומות נוספים.
            </p>
          </div>
          <div className="linked-records-summary">
            <span className="linked-record-pill">מסמכים: {documents.length}</span>
            <span className="linked-record-pill">רשומות עתידיות: בקרוב</span>
          </div>
        </div>
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
        <div className="linked-records-grid">
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
      </div>

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
