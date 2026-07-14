import { NextResponse } from "next/server";
import { requireAuthenticatedUser, assertStudentAccess } from "../../../../lib/rbac";
import { getTaskAttachmentFile } from "../../../../lib/task-attachments";
import { getTaskById } from "../../../../lib/tasks";

function clean(value) {
  return String(value || "").trim();
}

function asciiFallbackFilename(value) {
  return (clean(value).replace(/[^\x20-\x7E]+/g, "_").replace(/["\\;]+/g, "_").trim() || "attachment");
}

export async function GET(_request, { params }) {
  const user = await requireAuthenticatedUser();
  const resolvedParams = await params;
  const file = await getTaskAttachmentFile(resolvedParams?.id);
  if (!file) {
    return NextResponse.json({ error: "הקובץ לא נמצא." }, { status: 404 });
  }

  const task = await getTaskById(file.attachment.taskId);
  if (!task) {
    return NextResponse.json({ error: "המשימה לא נמצאה." }, { status: 404 });
  }

  const canView = user.is_team_member || user.is_manager || user.is_super_admin || assertStudentAccess(user, task.studentId);
  if (!canView) {
    return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  }

  const filename = file.attachment.fileName || "attachment";
  return new Response(file.bytes, {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.bytes.byteLength),
      "content-disposition": `inline; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    }
  });
}
