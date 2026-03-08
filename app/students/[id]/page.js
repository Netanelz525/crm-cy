import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getNoteByStudentId } from "../../../lib/notes";
import { assertStudentAccess, canEditStudentCard, requireAuthenticatedUser } from "../../../lib/rbac";
import { ENUM_LABELS, FIELD_SECTIONS, getByPath, hasDisplayValue, studentToFormValues } from "../../../lib/student-fields";
import { getStudentById } from "../../../lib/twenty";
import { updateNoteAction, updateStudentAction } from "./actions";

const NOTE_STATUSES = {
  NOT_RELEVANT: "לא רלוונטי",
  OTHER: "אחר",
  CONTACTED: "דיברו"
};

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

function formatDisplayValue(field, value) {
  if (!hasDisplayValue(value)) return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (field.type === "date") return formatDate(value);
  if (field.enum && ENUM_LABELS[field.enum]) return ENUM_LABELS[field.enum][String(value)] || String(value);
  if (typeof value === "boolean") return value ? "כן" : "לא";
  return String(value);
}

function noteStatusLabel(v) {
  return NOTE_STATUSES[clean(v)] || "-";
}

function boolLabel(v) {
  if (v === true) return "כן";
  if (v === false) return "לא";
  return "-";
}

function visibleSections(student) {
  return FIELD_SECTIONS.map((section) => {
    const fields = section.fields
      .map((field) => ({ field, value: getByPath(student, field.key) }))
      .filter((row) => hasDisplayValue(row.value));
    return { ...section, fields };
  }).filter((section) => section.fields.length > 0);
}

function EditField({ field, value }) {
  if (field.enum && ENUM_LABELS[field.enum]) {
    return (
      <select name={field.key} defaultValue={value || ""}>
        <option value="">בחר</option>
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

  if (field.isList) {
    return <textarea name={field.key} defaultValue={value || ""} placeholder="הפרדה בפסיק או שורה חדשה" />;
  }

  return <input name={field.key} defaultValue={value || ""} />;
}

export default async function StudentPage({ params, searchParams }) {
  const currentUser = await requireAuthenticatedUser();
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const studentId = resolvedParams.id;

  if (!assertStudentAccess(currentUser, studentId)) {
    if (currentUser.linked_student_id) {
      redirect(`/students/${currentUser.linked_student_id}`);
    }
    redirect("/unauthorized");
  }

  const student = await getStudentById(studentId);
  if (!student) notFound();

  const note = await getNoteByStudentId(studentId);
  const canEdit = canEditStudentCard(currentUser, studentId);
  const editMode = canEdit && clean(resolvedSearchParams?.edit) === "1";
  const updated = clean(resolvedSearchParams?.updated) === "1";
  const internalUpdated = clean(resolvedSearchParams?.internalUpdated) === "1";
  const errorText = clean(resolvedSearchParams?.error);

  const sections = visibleSections(student);
  const editValues = studentToFormValues(student);

  return (
    <>
      <div className="card">
        <h1>כרטיס תלמיד</h1>
        <p className="muted">
          {student?.fullName?.firstName || ""} {student?.fullName?.lastName || ""} | מזהה: {studentId}
        </p>
        <p>
          <Link href="/">חזרה לרשימה</Link>
          {" | "}
          {editMode ? <Link href={`/students/${studentId}`}>חזרה לתצוגה</Link> : canEdit ? <Link href={`/students/${studentId}?edit=1`}>עריכת שדות</Link> : "תצוגה בלבד"}
        </p>
      </div>

      {updated ? <div className="ok">השינויים נשמרו בהצלחה.</div> : null}
      {internalUpdated ? <div className="ok">המידע הפנימי נשמר בהצלחה.</div> : null}
      {errorText ? <div className="card muted">{errorText}</div> : null}

      {editMode ? (
        <form action={updateStudentAction} className="card">
          <input type="hidden" name="studentId" value={studentId} />
          {FIELD_SECTIONS.map((section) => (
            <div key={section.title} className="card" style={{ marginBottom: 12 }}>
              <h3>{section.title}</h3>
              <div className="grid">
                {section.fields.map((field) => (
                  <div key={field.key}>
                    <label>{field.label}</label>
                    <EditField field={field} value={editValues[field.key] || ""} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button type="submit">שמור שינויים ב-CRM</button>
        </form>
      ) : (
        <div className="card">
          <h3>פרטי הכרטיס (רק שדות עם מידע)</h3>
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

      <div className="card">
        <h3>מידע פנימי</h3>
        <p className="muted">
          סטטוס: {noteStatusLabel(note?.note_status)} | הוראת קבע: {boolLabel(note?.direct_debit_active)} | חתם: {" "}
          {note?.signed_by_display_name || note?.signed_by_email || "-"}
        </p>
        <p>{note?.note_text || "-"}</p>

        {canEdit && (
          <form action={updateNoteAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <textarea name="noteText" defaultValue={note?.note_text || ""} placeholder="הערה פנימית" />
            <div className="grid">
              <select name="noteStatus" defaultValue={note?.note_status || ""}>
                <option value="">בחר סטטוס</option>
                {Object.entries(NOTE_STATUSES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                name="directDebitActive"
                defaultValue={
                  note?.direct_debit_active === true ? "true" : note?.direct_debit_active === false ? "false" : ""
                }
              >
                <option value="">הוראת קבע</option>
                <option value="true">כן</option>
                <option value="false">לא</option>
              </select>
            </div>
            <button type="submit">שמור מידע פנימי</button>
          </form>
        )}
      </div>
    </>
  );
}
