import { notFound, redirect } from "next/navigation";
import { getNoteByStudentId, upsertStudentNote } from "../../../lib/notes";
import { assertStudentAccess, canEditStudentCard, requireAuthenticatedUser } from "../../../lib/rbac";
import { getStudentById } from "../../../lib/twenty";

const NOTE_STATUSES = {
  NOT_RELEVANT: "לא רלוונטי",
  OTHER: "אחר",
  CONTACTED: "דיברו"
};

function clean(v) {
  return String(v || "").trim();
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "—";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function noteStatusLabel(v) {
  return NOTE_STATUSES[clean(v)] || "—";
}

function boolLabel(v) {
  if (v === true) return "כן";
  if (v === false) return "לא";
  return "—";
}

export async function updateNoteAction(formData) {
  "use server";
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  if (!canEditStudentCard(user, studentId)) {
    redirect("/unauthorized");
  }
  await upsertStudentNote({
    studentId,
    noteText: clean(formData.get("noteText")),
    noteStatus: clean(formData.get("noteStatus")),
    directDebitActive: clean(formData.get("directDebitActive")),
    signedByUserId: user.clerk_user_id
  });
}

export default async function StudentPage({ params }) {
  const currentUser = await requireAuthenticatedUser();
  const resolvedParams = await params;
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

  return (
    <>
      <div className="card">
        <h1>כרטיס תלמיד</h1>
        <p className="muted">
          {student?.fullName?.firstName || ""} {student?.fullName?.lastName || ""} | מזהה: {studentId}
        </p>
      </div>

      <div className="card">
        <div className="grid">
          <div>
            <b>ת"ז:</b> {student.tznum || "—"}
          </div>
          <div>
            <b>שיעור:</b> {student.class || "—"}
          </div>
          <div>
            <b>מוסד:</b> {student.currentInstitution || "—"}
          </div>
          <div>
            <b>טלפון תלמיד:</b> {phoneText(student.phone)}
          </div>
          <div>
            <b>טלפון אב:</b> {phoneText(student.dadPhone)}
          </div>
          <div>
            <b>טלפון אם:</b> {phoneText(student.momPhone)}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>מידע פנימי</h3>
        <p className="muted">
          סטטוס: {noteStatusLabel(note?.note_status)} | הוראת קבע: {boolLabel(note?.direct_debit_active)} | חתם:{" "}
          {note?.signed_by_display_name || note?.signed_by_email || "—"}
        </p>
        <p>{note?.note_text || "—"}</p>

        {canEditStudentCard(currentUser, studentId) && (
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
