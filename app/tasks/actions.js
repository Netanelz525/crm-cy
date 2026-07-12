"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPaymentMandateDetails } from "../../lib/payment-systems";
import { requireAttendanceUser } from "../../lib/rbac";
import { buildResendFromAddress, sendResendEmail } from "../../lib/resend";
import {
  createTask,
  deleteTask,
  getTaskById,
  listAssignableTaskUsers,
  updateTask,
  updateTaskPaymentSnapshot,
  updateTaskStatus
} from "../../lib/tasks";

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

function getBaseUrl() {
  const configured = clean(process.env.CRM_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = clean(process.env.VERCEL_URL);
  return vercelUrl ? `https://${vercelUrl}`.replace(/\/+$/, "") : "";
}

function taskUrl(taskId) {
  const path = `/tasks?taskId=${encodeURIComponent(clean(taskId))}`;
  const baseUrl = getBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : path;
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendTaskCreatedEmail({ taskId, title, description, assigneeUserIds }) {
  const assigneeSet = new Set((assigneeUserIds || []).map(clean).filter(Boolean));
  if (!assigneeSet.size) return "";

  const users = await listAssignableTaskUsers();
  const recipients = users
    .filter((user) => assigneeSet.has(clean(user.id)))
    .map((user) => clean(user.email).toLowerCase())
    .filter(Boolean);
  const uniqueRecipients = [...new Set(recipients)];
  if (!uniqueRecipients.length) return "לא נמצאו כתובות מייל לאחראים שנבחרו.";

  const url = taskUrl(taskId);
  try {
    await sendResendEmail({
      to: uniqueRecipients,
      from: buildResendFromAddress("מערכת CRM"),
      subject: `משימה חדשה לטיפול: ${clean(title)}`,
      text: [
        "נוצרה משימה חדשה שהוגדרת כאחראי עליה.",
        "",
        `כותרת: ${clean(title)}`,
        clean(description) ? `פירוט: ${clean(description)}` : "",
        "",
        `פתיחה במערכת: ${url}`
      ].filter(Boolean).join("\n"),
      html: [
        "<div dir=\"rtl\" style=\"font-family:Arial,sans-serif;line-height:1.7\">",
        "<h2>משימה חדשה לטיפול</h2>",
        `<p><b>כותרת:</b> ${escapeHtml(title)}</p>`,
        clean(description) ? `<p><b>פירוט:</b></p><div style=\"white-space:pre-wrap;border:1px solid #d7e1ef;border-radius:10px;padding:12px;background:#f8fbff\">${escapeHtml(description)}</div>` : "",
        `<p><a href=\"${escapeHtml(url)}\" style=\"display:inline-block;padding:10px 14px;border-radius:10px;background:#0b4f8c;color:#fff;text-decoration:none;font-weight:bold\">פתח את המשימה במערכת</a></p>`,
        "</div>"
      ].join(""),
      idempotencyKey: `task-created-${taskId}`
    });
    return "";
  } catch (error) {
    return clean(error?.message) || "שליחת המייל לאחראים נכשלה.";
  }
}

export async function createTaskAction(formData) {
  const currentUser = await requireAttendanceUser();
  const returnTo = safeRedirect(formData.get("returnTo"));
  const assigneeUserIds = parseAssignees(formData);
  let taskId = "";
  let mailWarning = "";
  try {
    const sourceSnapshotRaw = clean(formData.get("sourceSnapshot"));
    taskId = await createTask({
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
      assigneeUserIds,
      createdByUserId: currentUser.clerk_user_id
    });
    mailWarning = await sendTaskCreatedEmail({
      taskId,
      title: formData.get("title"),
      description: formData.get("description"),
      assigneeUserIds
    });
  } catch (error) {
    const params = new URLSearchParams();
    params.set("error", clean(error?.message) || "שמירת המשימה נכשלה");
    redirect(`/tasks?${params.toString()}`);
  }
  revalidatePath("/tasks");
  const params = new URLSearchParams();
  params.set("taskCreated", "1");
  if (taskId) params.set("taskId", taskId);
  if (mailWarning) params.set("taskMailWarning", mailWarning);
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${params.toString()}`);
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

export async function refreshTaskPaymentMandateAction(formData) {
  await requireAttendanceUser();
  const taskId = clean(formData.get("taskId"));
  const returnTo = safeRedirect(formData.get("returnTo"), `/tasks?taskId=${encodeURIComponent(taskId)}`);
  const task = await getTaskById(taskId);
  if (!task || task.linkedType !== "payment_mandate") {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskRefreshError=${encodeURIComponent("המשימה אינה מקושרת להוראת קבע.")}`);
  }
  if (!task.paymentConnectionId || !task.paymentMandateId) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskRefreshError=${encodeURIComponent("חסרים פרטי חיבור או מספר הוראת קבע.")}`);
  }

  try {
    const latest = await getPaymentMandateDetails({
      connectionId: task.paymentConnectionId,
      mandateId: task.paymentMandateId
    });
    const changed = await updateTaskPaymentSnapshot(taskId, latest);
    revalidatePath("/tasks");
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskRefreshed=${changed ? "changed" : "same"}&taskId=${encodeURIComponent(taskId)}`);
  } catch (error) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskRefreshError=${encodeURIComponent(clean(error?.message) || "בדיקת הוראת הקבע מול הסליקה נכשלה.")}`);
  }
}
