"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { upsertStudentNote } from "../lib/notes";
import { getCurrentAppUser, requireTeamUser } from "../lib/rbac";
import { createSavedView, deleteSavedView, updateSavedView } from "../lib/saved-views";
import { sanitizeQueryString } from "../lib/student-view";

function clean(v) {
  return String(v || "").trim();
}

async function requireViewManager() {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    redirect("/unauthorized");
  }
  return user;
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

export async function saveStudentViewAction(formData) {
  const user = await requireViewManager();
  const viewId = clean(formData.get("viewId"));
  const name = clean(formData.get("name"));
  const folderName = clean(formData.get("folderName"));
  const nextQuery = sanitizeQueryString(formData.get("queryString"));
  const returnPath = clean(formData.get("returnPath")) || "/";

  if (!name || !nextQuery) {
    redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}saved=0`);
  }

  const finalViewId = viewId || crypto.randomUUID();
  if (viewId) {
    await updateSavedView({ id: finalViewId, ownerUserId: user.clerk_user_id, name, folderName, queryString: nextQuery });
    revalidatePath("/");
    revalidatePath("/views");
    redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}savedViewId=${finalViewId}&updated=1`);
  }

  await createSavedView({ id: finalViewId, ownerUserId: user.clerk_user_id, name, folderName, queryString: nextQuery });
  revalidatePath("/");
  revalidatePath("/views");
  redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}savedViewId=${finalViewId}&saved=1`);
}

export async function deleteStudentViewAction(formData) {
  const user = await requireViewManager();
  const viewId = clean(formData.get("viewId"));
  sanitizeQueryString(formData.get("nextQuery"));
  const returnPath = clean(formData.get("returnPath")) || "/views";

  if (viewId) {
    await deleteSavedView({ id: viewId, ownerUserId: user.clerk_user_id });
    revalidatePath("/");
    revalidatePath("/views");
  }

  redirect(`${returnPath}${returnPath.includes("?") ? "&" : "?"}deleted=1`);
}

