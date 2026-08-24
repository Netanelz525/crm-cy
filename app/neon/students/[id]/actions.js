"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveOpenAttendanceRecordForStudent } from "../../../../lib/attendance";
import { DELETE_CONFIRMATION_TEXT, softDeleteStudentById } from "../../../../lib/deleted-students";
import {
  ensureStaffWhatsAppInviteUser,
  ensureStudentWhatsAppInviteUser,
  requireAuthenticatedUser,
  assertStudentAccess
} from "../../../../lib/rbac";
import { buildResendFromAddress, sendResendEmail } from "../../../../lib/resend";
import { createStudentContactLog } from "../../../../lib/student-contact-logs";
import { createStudentDocument, getStudentDocumentById, updateStudentDocumentName } from "../../../../lib/student-documents";
import { createTaskAttachment } from "../../../../lib/task-attachments";
import { toFormData } from "../../../../lib/student-fields";
import { getNeonStudentById, updateNeonStudentViaTwenty } from "../../../../lib/neon-students";
import { addStudentTagToStudent, removeStudentTagFromStudent, replaceStudentTags } from "../../../../lib/student-tags";
import { createTask, listOfficeTaskEmailUsers } from "../../../../lib/tasks";
import { buildWhatsAppDeepLink, createWhatsAppLinkCode } from "../../../../lib/whatsapp";
import { linkPaymentToStudent, unlinkPaymentFromStudent } from "../../../../lib/payment-student-links";

function clean(v) {
  return String(v || "").trim();
}

export async function linkStudentPaymentAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!(user?.is_team_member || user?.is_manager || user?.is_super_admin)) redirect("/unauthorized");
  const studentId = clean(formData.get("studentId"));
  const paymentRecordId = clean(formData.get("paymentRecordId"));
  if (studentId && paymentRecordId) {
    await linkPaymentToStudent({ paymentRecordId, studentId, userId: user.clerk_user_id });
    revalidatePath(`/neon/students/${studentId}`);
  }
  redirect(`/neon/students/${encodeURIComponent(studentId)}?paymentLinked=1#payments`);
}

export async function unlinkStudentPaymentAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!(user?.is_team_member || user?.is_manager || user?.is_super_admin)) redirect("/unauthorized");
  const studentId = clean(formData.get("studentId"));
  const paymentRecordId = clean(formData.get("paymentRecordId"));
  if (studentId && paymentRecordId) {
    await unlinkPaymentFromStudent({ paymentRecordId, studentId });
    revalidatePath(`/neon/students/${studentId}`);
  }
  redirect(`/neon/students/${encodeURIComponent(studentId)}?paymentUnlinked=1#payments`);
}

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function studentDisplayName(student) {
  return [
    clean(student?.fullName?.firstName),
    clean(student?.fullName?.lastName)
  ].filter(Boolean).join(" ") || clean(student?.label) || clean(student?.name) || "תלמיד";
}

const ALLOWED_STUDENT_REQUEST_TYPES = new Set([
  "אישור לימודים",
  "קבלות תרומות/תשלומים"
]);

function appendStudentMessage(studentId, params) {
  const searchParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    const next = clean(value);
    if (next) searchParams.set(key, next);
  });
  return `/neon/students/${encodeURIComponent(studentId)}?${searchParams.toString()}`;
}

function getBaseUrl() {
  const configured = clean(process.env.CRM_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = clean(process.env.VERCEL_URL);
  return vercelUrl ? `https://${vercelUrl}`.replace(/\/+$/, "") : "";
}

function appendWhatsAppInviteResult(studentId, params) {
  const searchParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    const next = clean(value);
    if (next) searchParams.set(key, next);
  });
  return `/neon/students/${encodeURIComponent(studentId)}?${searchParams.toString()}#whatsapp-agent`;
}

export async function generateStudentWhatsAppAgentLinkAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_super_admin) redirect("/unauthorized");

  const studentId = clean(formData.get("studentId"));
  const canPrint = clean(formData.get("canPrint")) === "1";
  if (!studentId) redirect("/neon?error=לא נבחר תלמיד");

  const student = await getNeonStudentById(studentId);
  if (!student) redirect(`/neon/students/${studentId}?error=${encodeURIComponent("התלמיד לא נמצא")}`);

  const inviteUser = await ensureStudentWhatsAppInviteUser({
    studentId,
    studentName: studentDisplayName(student),
    studentClass: clean(student?.class),
    canPrint,
    approvedByUserId: user.clerk_user_id
  });
  const code = await createWhatsAppLinkCode(inviteUser.clerk_user_id, 60);
  revalidatePath(`/neon/students/${studentId}`);
  redirect(appendWhatsAppInviteResult(studentId, {
    waCode: code.code,
    waLink: buildWhatsAppDeepLink(code.code),
    waTarget: "student",
    waPrint: canPrint ? "1" : "0",
    waExpiresAt: code.expiresAt
  }));
}

export async function generateStaffWhatsAppAgentLinkAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_super_admin) redirect("/unauthorized");

  const studentId = clean(formData.get("studentId"));
  const displayName = clean(formData.get("displayName"));
  const email = clean(formData.get("email"));
  if (!studentId) redirect("/neon?error=לא נבחר תלמיד");
  if (!email) {
    redirect(appendWhatsAppInviteResult(studentId, {
      waError: "כדי ליצור חיבור לאיש צוות צריך להזין מייל."
    }));
  }

  const inviteUser = await ensureStaffWhatsAppInviteUser({
    email,
    displayName,
    approvedByUserId: user.clerk_user_id
  });
  const code = await createWhatsAppLinkCode(inviteUser.clerk_user_id, 60);
  revalidatePath(`/neon/students/${studentId}`);
  redirect(appendWhatsAppInviteResult(studentId, {
    waCode: code.code,
    waLink: buildWhatsAppDeepLink(code.code),
    waTarget: "staff",
    waStaff: inviteUser.display_name || email,
    waExpiresAt: code.expiresAt
  }));
}

export async function updateNeonStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const raw = Object.fromEntries(formData.entries());
  const data = toFormData(raw, { preserveEmptyEnums: true });

  if (!Object.keys(data).length) {
    redirect(`/neon/students/${studentId}?edit=1&error=לא הוזנו נתונים לשמירה`);
  }

  try {
    await updateNeonStudentViaTwenty(studentId, data);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "שמירת התלמיד נכשלה");
    redirect(`/neon/students/${studentId}?edit=1&error=${message}`);
  }

  redirect(`/neon/students/${studentId}?updated=1`);
}

export async function deleteNeonStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const confirmationText = clean(formData.get("confirmationText"));
  const confirmDelete = clean(formData.get("confirmDelete"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  if (!studentId) {
    redirect("/neon?error=לא נבחר תלמיד למחיקה");
  }

  if (confirmDelete !== "1" || confirmationText !== DELETE_CONFIRMATION_TEXT) {
    redirect(`/neon/students/${studentId}?error=${encodeURIComponent("כדי למחוק תלמיד צריך לסמן אישור ולהקליד בדיוק: אני מאשר")}`);
  }

  try {
    await softDeleteStudentById(studentId, user.clerk_user_id);
    revalidatePath("/");
    revalidatePath("/neon");
    revalidatePath("/admin/deleted-students");
  } catch (error) {
    const message = encodeURIComponent(error?.message || "מחיקת התלמיד נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect("/admin/deleted-students?deleted=1");
}

export async function uploadStudentDocumentAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const file = formData.get("file");
  const displayName = clean(formData.get("displayName"));
  const noteText = clean(formData.get("noteText"));
  const documentKind = clean(formData.get("documentKind")) || "general";

  if (!assertStudentAccess(user, studentId)) {
    redirect("/unauthorized");
  }

  try {
    await createStudentDocument({
      studentId,
      uploadedByUserId: user.clerk_user_id,
      file,
      documentKind,
      displayName,
      noteText
    });
  } catch (error) {
    const message = encodeURIComponent(error?.message || "העלאת המסמך נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?documentUploaded=1`);
}

export async function updateStudentDocumentNameAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const documentId = clean(formData.get("documentId"));
  const displayName = clean(formData.get("displayName"));

  if (!assertStudentAccess(user, studentId)) {
    redirect("/unauthorized");
  }

  try {
    const doc = await getStudentDocumentById(documentId);
    if (!doc || doc.studentId !== studentId) {
      throw new Error("המסמך לא נמצא בכרטיס התלמיד.");
    }
    await updateStudentDocumentName({ id: documentId, displayName });
  } catch (error) {
    const message = encodeURIComponent(error?.message || "עדכון שם המסמך נכשל");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?documentRenamed=1`);
}

export async function updateStudentTagsAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await replaceStudentTags({
      studentId,
      tagIds: formData.getAll("tagIds"),
      assignedByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "עדכון התגיות נכשל");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?tagsUpdated=1`);
}

export async function removeStudentTagAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await removeStudentTagFromStudent({
      studentId,
      tagId: formData.get("tagId")
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "הסרת התווית נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?tagsUpdated=1`);
}

export async function addStudentTagAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await addStudentTagToStudent({
      studentId,
      tagId: formData.get("tagId"),
      tagName: formData.get("newTagName"),
      assignedByUserId: user.clerk_user_id,
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "שמירת התווית נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?tagsUpdated=1`);
}

export async function addStudentContactAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));

  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  try {
    await createStudentContactLog({
      studentId,
      contactDate: formData.get("contactDate"),
      noteText: formData.get("noteText"),
      createdByUserId: user.clerk_user_id
    });
    revalidatePath("/neon");
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "שמירת יצירת הקשר נכשלה");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?contactSaved=1`);
}

export async function updateStudentOpenAttendanceAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const sessionId = clean(formData.get("sessionId"));

  if (!assertStudentAccess(user, studentId)) {
    redirect("/unauthorized");
  }

  try {
    await saveOpenAttendanceRecordForStudent({
      sessionId,
      studentId,
      status: formData.get("status"),
      noteText: formData.get("noteText"),
      markedByUserId: user.clerk_user_id
    });
    revalidatePath("/attendance");
    revalidatePath(`/attendance/${sessionId}`);
    revalidatePath(`/neon/students/${studentId}`);
  } catch (error) {
    const message = encodeURIComponent(error?.message || "עדכון הנוכחות נכשל");
    redirect(`/neon/students/${studentId}?error=${message}`);
  }

  redirect(`/neon/students/${studentId}?attendanceUpdated=1`);
}

export async function submitStudentApprovalReceiptRequestAction(formData) {
  const user = await requireAuthenticatedUser();
  const studentId = clean(formData.get("studentId"));
  const requestType = clean(formData.get("requestType")) || "אישור לימודים";
  const requestText = clean(formData.get("requestText"));
  const attachmentFile = formData.get("requestAttachment");

  if (!assertStudentAccess(user, studentId)) {
    redirect("/unauthorized");
  }

  if (!requestText) {
    redirect(appendStudentMessage(studentId, { requestError: "יש לפרט את הבקשה לפני השליחה." }));
  }

  if (!ALLOWED_STUDENT_REQUEST_TYPES.has(requestType)) {
    redirect(appendStudentMessage(studentId, { requestError: "ניתן להגיש רק בקשה לאישור לימודים או בקשה על קבלות לתשלום." }));
  }

  const student = await getNeonStudentById(studentId);
  if (!student) {
    redirect(appendStudentMessage(studentId, { requestError: "כרטיס התלמיד לא נמצא." }));
  }

  const tznum = normalizeDigits(student?.tznum);
  if (!tznum) {
    redirect(appendStudentMessage(studentId, { requestError: "לא ניתן להגיש בקשה בלי מספר זהות בכרטיס התלמיד. יש לפנות לצוות לעדכון התעודה." }));
  }

  const teamUsers = await listOfficeTaskEmailUsers();
  const assigneeUserIds = teamUsers.map((teamUser) => teamUser.id).filter(Boolean);
  const teamEmails = [...new Set(teamUsers.map((teamUser) => clean(teamUser.email).toLowerCase()).filter(Boolean))];
  const studentName = studentDisplayName(student);
  const title = `בקשת תלמיד: ${requestType} - ${studentName}`;
  const description = [
    `סוג בקשה: ${requestType}`,
    `שם תלמיד: ${studentName}`,
    `ת"ז: ${tznum}`,
    `מוסד: ${clean(student?.currentInstitution) || "-"}`,
    `שיעור: ${clean(student?.class) || "-"}`,
    "",
    "פירוט הבקשה:",
    requestText,
    "",
    `הוגש על ידי: ${clean(user.display_name) || clean(user.email) || user.clerk_user_id}`
  ].join("\n");

  let taskId = "";
  let attachment = null;
  try {
    taskId = await createTask({
      title,
      description,
      status: "pending",
      linkedType: "student",
      studentId,
      assigneeUserIds,
      createdByUserId: user.clerk_user_id,
      sourceSnapshot: {
        source: "student_approval_receipt_request",
        requestType,
        requestedByUserId: user.clerk_user_id,
        studentName,
        tznum
      }
    });
    if (attachmentFile instanceof File && clean(attachmentFile.name)) {
      attachment = await createTaskAttachment({
        taskId,
        uploadedByUserId: user.clerk_user_id,
        file: attachmentFile
      });
    }
  } catch (error) {
    redirect(appendStudentMessage(studentId, { requestError: clean(error?.message) || "פתיחת המשימה נכשלה." }));
  }

  let staffEmailWarning = "";
  if (teamEmails.length) {
      const taskPath = `/tasks?taskId=${encodeURIComponent(taskId)}`;
      const taskUrl = getBaseUrl() ? `${getBaseUrl()}${taskPath}` : taskPath;
      const attachmentPath = attachment?.id ? `/api/task-attachments/${encodeURIComponent(attachment.id)}` : "";
      const attachmentUrl = attachmentPath && getBaseUrl() ? `${getBaseUrl()}${attachmentPath}` : attachmentPath;
    try {
      await sendResendEmail({
        to: teamEmails,
        from: buildResendFromAddress("מערכת CRM"),
        subject: title,
        text: [
          "נפתחה בקשת תלמיד חדשה לקבלת אישורים/קבלות.",
          "",
          description,
          "",
          `משימה: ${taskId}`,
          `פתיחה במערכת: ${taskUrl}`,
          attachmentUrl ? `קובץ מצורף: ${attachment.fileName} - ${attachmentUrl}` : ""
        ].join("\n"),
        html: [
          "<div dir=\"rtl\" style=\"font-family:Arial,sans-serif;line-height:1.7\">",
          "<h2>נפתחה בקשת תלמיד חדשה</h2>",
          `<p><b>תלמיד:</b> ${studentName}</p>`,
          `<p><b>ת"ז:</b> ${tznum}</p>`,
          `<p><b>סוג בקשה:</b> ${requestType}</p>`,
          `<p><b>פירוט:</b></p><div style=\"white-space:pre-wrap;border:1px solid #d7e1ef;border-radius:10px;padding:12px;background:#f8fbff\">${requestText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`,
          attachmentUrl ? `<p><b>קובץ מצורף:</b> <a href=\"${attachmentUrl}\">${attachment.fileName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</a></p>` : "",
          `<p><b>משימה:</b> ${taskId}</p>`,
          "</div>"
        ].join(""),
        idempotencyKey: `student-request-${taskId}`
      });
    } catch (error) {
      staffEmailWarning = clean(error?.message) || "המייל לצוות לא נשלח.";
    }
  } else {
    staffEmailWarning = "לא נמצאו אנשי צוות עם תווית משרד לשליחת מייל.";
  }

  revalidatePath(`/neon/students/${studentId}`);
  redirect(appendStudentMessage(studentId, {
    requestSubmitted: "1",
    staffEmailWarning
  }));
}
