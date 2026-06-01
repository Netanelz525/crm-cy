"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createPaymentConnection,
  deletePaymentConnection,
  setPaymentConnectionActive,
  testPaymentConnection,
  updatePaymentConnection
} from "../../../lib/payment-systems";
import { requireSuperAdmin } from "../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function createNedarimConnectionAction(formData) {
  const currentUser = await requireSuperAdmin();
  try {
    await createPaymentConnection({
      provider: "nederim",
      label: clean(formData.get("label")),
      externalId: clean(formData.get("externalId")),
      secret: clean(formData.get("secret")),
      createdByUserId: currentUser.clerk_user_id
    });
  } catch (error) {
    redirect(`/admin/payments?error=${encodeURIComponent(error?.message || "יצירת חיבור נדרים נכשלה")}`);
  }
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
  redirect("/admin/payments?created=1");
}

export async function createStripeConnectionAction(formData) {
  const currentUser = await requireSuperAdmin();
  try {
    await createPaymentConnection({
      provider: "stripe",
      label: clean(formData.get("label")),
      externalId: clean(formData.get("externalId")),
      secret: clean(formData.get("secret")),
      createdByUserId: currentUser.clerk_user_id
    });
  } catch (error) {
    redirect(`/admin/payments?error=${encodeURIComponent(error?.message || "יצירת חיבור Stripe נכשלה")}`);
  }
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
  redirect("/admin/payments?created=1");
}

export async function togglePaymentConnectionAction(formData) {
  const currentUser = await requireSuperAdmin();
  const connectionId = clean(formData.get("connectionId"));
  const active = clean(formData.get("active")) === "1";
  if (!connectionId) redirect("/admin/payments?error=לא נבחר חיבור");
  await setPaymentConnectionActive(connectionId, active, currentUser.clerk_user_id);
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
  redirect(`/admin/payments?statusChanged=${active ? "1" : "0"}`);
}

export async function updatePaymentConnectionAction(formData) {
  const currentUser = await requireSuperAdmin();
  const connectionId = clean(formData.get("connectionId"));
  try {
    await updatePaymentConnection({
      id: connectionId,
      label: clean(formData.get("label")),
      externalId: clean(formData.get("externalId")),
      secret: clean(formData.get("secret")),
      updatedByUserId: currentUser.clerk_user_id
    });
  } catch (error) {
    redirect(`/admin/payments?error=${encodeURIComponent(error?.message || "עדכון החיבור נכשל")}`);
  }
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
  redirect("/admin/payments?updated=1");
}

export async function deletePaymentConnectionAction(formData) {
  await requireSuperAdmin();
  const connectionId = clean(formData.get("connectionId"));
  try {
    await deletePaymentConnection(connectionId);
  } catch (error) {
    redirect(`/admin/payments?error=${encodeURIComponent(error?.message || "מחיקת החיבור נכשלה")}`);
  }
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
  redirect("/admin/payments?deleted=1");
}

export async function testPaymentConnectionAction(_prevState, formData) {
  await requireSuperAdmin();
  const connectionId = clean(formData?.get?.("connectionId"));
  try {
    const result = await testPaymentConnection({ id: connectionId });
    return {
      ok: true,
      message: result.message || "בדיקת החיבור הצליחה."
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "בדיקת החיבור נכשלה"
    };
  }
}
