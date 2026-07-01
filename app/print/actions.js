"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUsePrintQueue, createPrintJob } from "../../lib/print-jobs";
import { requireAuthenticatedUser } from "../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function createPrintJobAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!canUsePrintQueue(user)) redirect("/unauthorized");

  try {
    await createPrintJob({
      file: formData.get("file"),
      copies: formData.get("copies"),
      uploadedByUserId: user.clerk_user_id
    });
  } catch (error) {
    redirect(`/print?error=${encodeURIComponent(clean(error?.message) || "שליחת המסמך להדפסה נכשלה")}`);
  }

  revalidatePath("/print");
  redirect("/print?uploaded=1");
}
