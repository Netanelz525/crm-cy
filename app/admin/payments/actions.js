"use server";

import { revalidatePath } from "next/cache";
import { createPaymentConnection, setPaymentConnectionActive } from "../../../lib/payment-systems";
import { requireSuperAdmin } from "../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

export async function createNedarimConnectionAction(formData) {
  const currentUser = await requireSuperAdmin();
  await createPaymentConnection({
    provider: "nederim",
    label: clean(formData.get("label")),
    externalId: clean(formData.get("externalId")),
    secret: clean(formData.get("secret")),
    createdByUserId: currentUser.clerk_user_id
  });
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
}

export async function createStripeConnectionAction(formData) {
  const currentUser = await requireSuperAdmin();
  await createPaymentConnection({
    provider: "stripe",
    label: clean(formData.get("label")),
    externalId: clean(formData.get("externalId")),
    secret: clean(formData.get("secret")),
    createdByUserId: currentUser.clerk_user_id
  });
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
}

export async function togglePaymentConnectionAction(formData) {
  const currentUser = await requireSuperAdmin();
  const connectionId = clean(formData.get("connectionId"));
  const active = clean(formData.get("active")) === "1";
  if (!connectionId) return;
  await setPaymentConnectionActive(connectionId, active, currentUser.clerk_user_id);
  revalidatePath("/admin/payments");
  revalidatePath("/payments");
}
