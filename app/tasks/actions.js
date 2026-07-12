"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAttendanceUser } from "../../lib/rbac";
import { createTask, deleteTask, updateTask, updateTaskStatus } from "../../lib/tasks";

function clean(value) {
  return String(value || "").trim();
}

function safeRedirect(path, fallback = "/tasks") {
  const target = clean(path);
  if (!target || !target.startsWith("/") || target.startsWith("//")) return fallback;
  return target;
}

function parseAssignees(formData) {
  return formData.getAll("assigneeUserIds").map(clean).filter(Boolean);
}

export async function createTaskAction(formData) {
  const currentUser = await requireAttendanceUser();
  const returnTo = safeRedirect(formData.get("returnTo"));
  try {
    const sourceSnapshotRaw = clean(formData.get("sourceSnapshot"));
    await createTask({
      title: formData.get("title"),
      description: formData.get("description"),
      status: formData.get("status"),
      linkedType: formData.get("linkedType"),
      studentId: formData.get("studentId"),
      paymentMandateId: formData.get("paymentMandateId"),
      paymentProvider: formData.get("paymentProvider"),
      paymentConnectionId: formData.get("paymentConnectionId"),
      paymentConnectionLabel: formData.get("paymentConnectionLabel"),
      paymentCustomerName: formData.get("paymentCustomerName"),
      paymentCustomerEmail: formData.get("paymentCustomerEmail"),
      sourceSnapshot: sourceSnapshotRaw || {},
      assigneeUserIds: parseAssignees(formData),
      createdByUserId: currentUser.clerk_user_id
    });
  } catch (error) {
    const params = new URLSearchParams();
    params.set("error", clean(error?.message) || "שמירת המשימה נכשלה");
    redirect(`/tasks?${params.toString()}`);
  }
  revalidatePath("/tasks");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskCreated=1`);
}

export async function updateTaskAction(formData) {
  const currentUser = await requireAttendanceUser();
  const taskId = clean(formData.get("taskId"));
  const returnTo = safeRedirect(formData.get("returnTo"));
  try {
    await updateTask(taskId, {
      title: formData.get("title"),
      description: formData.get("description"),
      status: formData.get("status"),
      assigneeUserIds: parseAssignees(formData),
      updatedByUserId: currentUser.clerk_user_id
    });
  } catch (error) {
    const params = new URLSearchParams();
    params.set("error", clean(error?.message) || "עדכון המשימה נכשל");
    redirect(`/tasks?${params.toString()}`);
  }
  revalidatePath("/tasks");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskUpdated=1`);
}

export async function updateTaskStatusAction(formData) {
  await requireAttendanceUser();
  const taskId = clean(formData.get("taskId"));
  const status = clean(formData.get("status"));
  const returnTo = safeRedirect(formData.get("returnTo"));
  await updateTaskStatus(taskId, status);
  revalidatePath("/tasks");
  redirect(returnTo);
}

export async function deleteTaskAction(formData) {
  await requireAttendanceUser();
  const taskId = clean(formData.get("taskId"));
  const returnTo = safeRedirect(formData.get("returnTo"));
  await deleteTask(taskId);
  revalidatePath("/tasks");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskDeleted=1`);
}
