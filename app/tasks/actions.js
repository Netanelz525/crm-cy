"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPaymentMandateDetails } from "../../lib/payment-systems";
import { requireAttendanceUser } from "../../lib/rbac";
import { buildResendFromAddress, sendResendEmail } from "../../lib/resend";
import { createTaskContactLog } from "../../lib/task-contact-logs";
import {
  createTask,
  deleteTask,
  getTaskById,
  listAssignableTaskUsers,
  taskLinkTypeLabel,
  taskStatusLabel,
  TASK_STATUS_OPTIONS,
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

function absoluteUrl(path) {
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

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function normalizePhoneForHref(value) {
  const digits = normalizeDigits(value);
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

function formatMoneyValue(amount, currency = "ILS") {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "";
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: clean(currency) || "ILS" }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${clean(currency) || "ILS"}`;
  }
}

function taskContactOptions(task) {
  const snapshot = task.sourceSnapshot || {};
  const mandate = snapshot.paymentMandateAtCreation || snapshot;
  if (task.linkedType === "payment_mandate") {
    return {
      emails: [{ label: "מייל תורם", value: mandate.email || task.paymentCustomerEmail }],
      phones: [{ label: "טלפון תורם", value: mandate.phone }]
    };
  }
  return {
    emails: [
      { label: "מייל תלמיד", value: task.studentEmail },
      { label: "מייל אב", value: task.studentFatherEmail },
      { label: "מייל אם", value: task.studentMotherEmail }
    ],
    phones: [
      { label: "טלפון תלמיד", value: task.studentPhone },
      { label: "טלפון אב", value: task.studentFatherPhone },
      { label: "טלפון אם", value: task.studentMotherPhone }
    ]
  };
}

function taskDetailRows(task) {
  const snapshot = task.sourceSnapshot || {};
  const mandate = snapshot.paymentMandateAtCreation || snapshot;
  if (task.linkedType === "payment_mandate") {
    return [
      ["סוג קישור", taskLinkTypeLabel(task.linkedType)],
      ["שם תורם", mandate.customerName || task.paymentCustomerName],
      ["מייל", mandate.email || task.paymentCustomerEmail],
      ["טלפון", mandate.phone],
      ["מספר הוראת קבע", mandate.mandateId || task.paymentMandateId],
      ["מקור סליקה", mandate.connectionLabel || task.paymentConnectionLabel],
      ["סטטוס בזמן יצירה", mandate.statusLabel || mandate.status],
      ["סיבת תקלה", mandate.errorText || mandate.issueKind],
      ["סכום", formatMoneyValue(mandate.amountIls ?? mandate.amount ?? mandate.originalAmount, "ILS")],
      ["חיוב הבא", mandate.nextChargeDate],
      ["4 ספרות", mandate.paymentMethodLast4],
      ["תוקף", mandate.paymentMethodExpiry]
    ];
  }
  return [
    ["סוג קישור", taskLinkTypeLabel(task.linkedType)],
    ["שם תלמיד", task.studentName],
    ["שיעור", task.studentClass],
    ["מוסד", task.studentInstitution],
    ["מייל תלמיד", task.studentEmail],
    ["מייל אב", task.studentFatherEmail],
    ["מייל אם", task.studentMotherEmail],
    ["טלפון תלמיד", task.studentPhone],
    ["טלפון אב", task.studentFatherPhone],
    ["טלפון אם", task.studentMotherPhone]
  ];
}

function emailButton(url, label, background = "#0b4f8c") {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin:4px 4px 4px 0;padding:10px 14px;border-radius:10px;background:${background};color:#fff;text-decoration:none;font-weight:bold">${escapeHtml(label)}</a>`;
}

function buildStatusUrl(taskId, status) {
  const params = new URLSearchParams({
    status,
    returnTo: `/tasks?taskId=${clean(taskId)}`
  });
  return absoluteUrl(`/tasks/${encodeURIComponent(clean(taskId))}/status?${params.toString()}`);
}

async function sendTaskCreatedEmail({ taskId, assigneeUserIds }) {
  const assigneeSet = new Set((assigneeUserIds || []).map(clean).filter(Boolean));
  if (!assigneeSet.size) return "";

  const task = await getTaskById(taskId);
  if (!task) return "המשימה נוצרה אך לא נמצאה לצורך שליחת מייל.";

  const users = await listAssignableTaskUsers();
  const recipients = users
    .filter((user) => assigneeSet.has(clean(user.id)))
    .map((user) => clean(user.email).toLowerCase())
    .filter(Boolean);
  const uniqueRecipients = [...new Set(recipients)];
  if (!uniqueRecipients.length) return "לא נמצאו כתובות מייל לאחראים שנבחרו.";

  const url = taskUrl(taskId);
  const contacts = taskContactOptions(task);
  const emails = contacts.emails
    .map((item) => ({ ...item, value: clean(item.value).toLowerCase() }))
    .filter((item) => item.value && item.value.includes("@"));
  const phones = contacts.phones
    .map((item) => ({ ...item, value: normalizePhoneForHref(item.value) }))
    .filter((item) => item.value);
  const detailRows = taskDetailRows(task).filter(([, value]) => clean(value));
  const statusButtons = TASK_STATUS_OPTIONS
    .filter((option) => option.value !== task.status)
    .map((option) => emailButton(buildStatusUrl(taskId, option.value), `סמן ${option.label}`, option.value === "done" ? "#15803d" : "#1769aa"))
    .join("");
  const contactButtons = [
    ...emails.map((item) => emailButton(`mailto:${item.value}`, item.label, "#334155")),
    ...phones.map((item) => emailButton(`tel:+${item.value}`, `חיוג ${item.label.replace("טלפון ", "")}`, "#475569")),
    ...phones.map((item) => emailButton(`https://wa.me/${item.value}`, `WhatsApp ${item.label.replace("טלפון ", "")}`, "#128c7e"))
  ].join("");
  try {
    await sendResendEmail({
      to: uniqueRecipients,
      from: buildResendFromAddress("מערכת CRM"),
      subject: `משימה חדשה לטיפול: ${clean(task.title)}`,
      text: [
        "נוצרה משימה חדשה שהוגדרת כאחראי עליה.",
        "",
        `כותרת: ${clean(task.title)}`,
        `סטטוס: ${taskStatusLabel(task.status)}`,
        ...detailRows.map(([label, value]) => `${label}: ${clean(value)}`),
        clean(task.description) ? `פירוט: ${clean(task.description)}` : "",
        "",
        `פתיחה במערכת: ${url}`
      ].filter(Boolean).join("\n"),
      html: [
        "<div dir=\"rtl\" style=\"font-family:Arial,sans-serif;line-height:1.7\">",
        "<h2>משימה חדשה לטיפול</h2>",
        `<p><b>כותרת:</b> ${escapeHtml(task.title)}</p>`,
        `<p><b>סטטוס:</b> ${escapeHtml(taskStatusLabel(task.status))}</p>`,
        detailRows.length ? [
          "<table style=\"width:100%;border-collapse:collapse;margin:12px 0;background:#f8fbff;border:1px solid #d7e1ef;border-radius:10px;overflow:hidden\">",
          detailRows.map(([label, value]) => `<tr><td style=\"padding:8px 10px;border-bottom:1px solid #d7e1ef;font-weight:bold;width:34%\">${escapeHtml(label)}</td><td style=\"padding:8px 10px;border-bottom:1px solid #d7e1ef\">${escapeHtml(value)}</td></tr>`).join(""),
          "</table>"
        ].join("") : "",
        clean(task.description) ? `<p><b>פירוט:</b></p><div style=\"white-space:pre-wrap;border:1px solid #d7e1ef;border-radius:10px;padding:12px;background:#f8fbff\">${escapeHtml(task.description)}</div>` : "",
        contactButtons ? `<p><b>יצירת קשר:</b><br>${contactButtons}</p>` : "",
        statusButtons ? `<p><b>עדכון סטטוס:</b><br>${statusButtons}</p>` : "",
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

export async function createTaskContactLogAction(formData) {
  const currentUser = await requireAttendanceUser();
  const taskId = clean(formData.get("taskId"));
  const returnTo = safeRedirect(formData.get("returnTo"), `/tasks?taskId=${encodeURIComponent(taskId)}`);
  try {
    await createTaskContactLog({
      taskId,
      contactDate: formData.get("contactDate"),
      noteText: formData.get("noteText"),
      reminderDate: formData.get("reminderDate"),
      createdByUserId: currentUser.clerk_user_id
    });
  } catch (error) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskContactError=${encodeURIComponent(clean(error?.message) || "שמירת יצירת הקשר נכשלה.")}`);
  }
  revalidatePath("/tasks");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}taskContactCreated=1&taskId=${encodeURIComponent(taskId)}`);
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
