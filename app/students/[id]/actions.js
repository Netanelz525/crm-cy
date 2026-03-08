"use server";

import { redirect } from "next/navigation";
import { upsertStudentNote } from "../../../lib/notes";
import { canEditStudentCard, requireAuthenticatedUser } from "../../../lib/rbac";

function clean(v) {
  return String(v || "").trim();
}

export async function updateNoteAction(formData) {
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
