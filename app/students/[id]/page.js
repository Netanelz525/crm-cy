import { notFound, redirect } from "next/navigation";
import { getNoteByStudentId } from "../../../lib/notes";
import { assertStudentAccess, canEditStudentCard, requireAuthenticatedUser } from "../../../lib/rbac";
import { getStudentById } from "../../../lib/twenty";
import { updateNoteAction } from "./actions";

const NOTE_STATUSES = {
  NOT_RELEVANT: "Not relevant",
  OTHER: "Other",
  CONTACTED: "Contacted"
};

function clean(v) {
  return String(v || "").trim();
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function noteStatusLabel(v) {
  return NOTE_STATUSES[clean(v)] || "-";
}

function boolLabel(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "-";
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
        <h1>Student Card</h1>
        <p className="muted">
          {student?.fullName?.firstName || ""} {student?.fullName?.lastName || ""} | ID: {studentId}
        </p>
      </div>

      <div className="card">
        <div className="grid">
          <div>
            <b>TZ:</b> {student.tznum || "-"}
          </div>
          <div>
            <b>Class:</b> {student.class || "-"}
          </div>
          <div>
            <b>Institution:</b> {student.currentInstitution || "-"}
          </div>
          <div>
            <b>Student phone:</b> {phoneText(student.phone)}
          </div>
          <div>
            <b>Father phone:</b> {phoneText(student.dadPhone)}
          </div>
          <div>
            <b>Mother phone:</b> {phoneText(student.momPhone)}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Internal Info</h3>
        <p className="muted">
          Status: {noteStatusLabel(note?.note_status)} | Direct debit: {boolLabel(note?.direct_debit_active)} | Signed by:{" "}
          {note?.signed_by_display_name || note?.signed_by_email || "-"}
        </p>
        <p>{note?.note_text || "-"}</p>

        {canEditStudentCard(currentUser, studentId) && (
          <form action={updateNoteAction}>
            <input type="hidden" name="studentId" value={studentId} />
            <textarea name="noteText" defaultValue={note?.note_text || ""} placeholder="Internal note" />
            <div className="grid">
              <select name="noteStatus" defaultValue={note?.note_status || ""}>
                <option value="">Select status</option>
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
                <option value="">Direct debit</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <button type="submit">Save internal info</button>
          </form>
        )}
      </div>
    </>
  );
}
