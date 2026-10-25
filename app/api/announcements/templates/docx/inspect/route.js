import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../../../lib/rbac";
import { inspectAnnouncementDocx, MAX_DOCX_IMPORT_BYTES } from "../../../../../../lib/docx-template";

export const runtime = "nodejs";

export async function POST(request) {
  const user = await getCurrentAppUser();
  if (!user) return NextResponse.json({ error: "יש להתחבר למערכת." }, { status: 401 });
  if (!user.is_super_admin) return NextResponse.json({ error: "אין הרשאה לנהל תבניות." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("docxFile");
    if (!file || typeof file.arrayBuffer !== "function" || !/\.docx$/i.test(file.name || "")) throw new Error("יש לבחור קובץ Word מסוג DOCX.");
    if (file.size > MAX_DOCX_IMPORT_BYTES) throw new Error("ניתן להעלות קובץ Word עד 4MB.");
    const { fields } = inspectAnnouncementDocx(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ fields }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "לא ניתן לזהות את שדות המסמך." }, { status: 400 });
  }
}
