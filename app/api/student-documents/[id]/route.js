import { NextResponse } from "next/server";
import { assertStudentAccess, requireAuthenticatedUser } from "../../../../lib/rbac";
import { getStudentDocumentFile } from "../../../../lib/student-documents";

function clean(value) {
  return String(value || "").trim();
}

export async function GET(request, { params }) {
  const user = await requireAuthenticatedUser();
  const resolvedParams = await params;
  const id = clean(resolvedParams?.id);
  const doc = await getStudentDocumentFile(id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (!assertStudentAccess(user, doc.studentId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  return new NextResponse(Buffer.from(doc.bytes), {
    status: 200,
    headers: {
      "content-type": doc.contentType || "application/octet-stream",
      "content-disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`
    }
  });
}
