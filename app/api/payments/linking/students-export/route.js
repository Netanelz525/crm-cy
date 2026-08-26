import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../../lib/rbac";

function clean(value) { return String(value || "").trim(); }

export async function POST(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager && !user.is_super_admin)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const students = Array.isArray(body.students) ? body.students : [];
    const rows = students.map((student) => [
      clean(student.name),
      clean(student.institution),
      clean(student.className),
      clean(student.tznum),
      student.hasTransaction ? "כן" : "לא",
      student.mandateStatus || "לא",
      student.recommended ? "כן" : "לא"
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([["שם תלמיד", "מוסד", "שיעור", "ת״ז", "עסקה משויכת", "הוראת קבע", "מומלץ ליצירת קשר"], ...rows]);
    worksheet["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 24 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "תלמידים");
    const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(content, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": "attachment; filename=students-payment-linking.xlsx"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "ייצוא התלמידים נכשל." }, { status: 500 });
  }
}
