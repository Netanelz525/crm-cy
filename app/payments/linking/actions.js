"use server";

import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../../lib/rbac";
import { deletePaymentRecordLink, upsertPaymentRecordLink } from "../../../lib/payment-links";

function clean(value) { return String(value || "").trim(); }
function backUrl(formData, key, message) {
  const target = clean(formData.get("returnTo")) || "/payments/linking";
  return `${target}${target.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
}

async function requirePaymentManager() {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin)) redirect("/unauthorized");
  return user;
}

export async function savePaymentLinkAction(formData) {
  const user = await requirePaymentManager();
  let errorMessage = "";
  try {
    await upsertPaymentRecordLink({
      recordType: clean(formData.get("recordType")),
      provider: clean(formData.get("provider")),
      connectionId: clean(formData.get("connectionId")),
      externalRecordId: clean(formData.get("externalRecordId")),
      studentId: clean(formData.get("studentId")),
      payerType: clean(formData.get("payerType")),
      payerName: clean(formData.get("payerName")),
      payerEmail: clean(formData.get("payerEmail")),
      payerPhone: clean(formData.get("payerPhone")),
      notes: clean(formData.get("notes")),
      recordSnapshot: JSON.parse(clean(formData.get("recordSnapshot")) || "{}"),
      linkedByUserId: user.clerk_user_id
    });
  } catch (error) {
    errorMessage = error?.message || "שמירת השיוך נכשלה.";
  }
  redirect(backUrl(formData, errorMessage ? "error" : "notice", errorMessage || "השיוך נשמר בהצלחה."));
}

export async function deletePaymentLinkAction(formData) {
  await requirePaymentManager();
  let errorMessage = "";
  try {
    await deletePaymentRecordLink({ id: formData.get("linkId") });
  } catch (error) {
    errorMessage = error?.message || "הסרת השיוך נכשלה.";
  }
  redirect(backUrl(formData, errorMessage ? "error" : "notice", errorMessage || "השיוך הוסר."));
}
