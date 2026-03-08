"use server";

import { redirect } from "next/navigation";
import { upsertStudentNote } from "../lib/notes";
import { requireTeamUser } from "../lib/rbac";

function clean(v) {
  return String(v || "").trim();
}

export async function quickUpdateNoteAction(formData) {
  const user = await requireTeamUser();
  const studentId = clean(formData.get("studentId"));
  const noteText = clean(formData.get("noteText"));
  const noteStatus = clean(formData.get("noteStatus"));
  const directDebitActive = clean(formData.get("directDebitActive"));
  const next = clean(formData.get("next")) || "/";

  await upsertStudentNote({
    studentId,
    noteText,
    noteStatus,
    directDebitActive,
    signedByUserId: user.clerk_user_id
  });

  redirect(next.includes("?") ? `${next}&quickUpdated=1` : `${next}?quickUpdated=1`);
}

