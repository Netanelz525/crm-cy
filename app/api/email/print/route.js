import { NextResponse } from "next/server";
import { canUseColorPrint, normalizePrintPlan, printPlanLabel } from "../../../../lib/print-jobs";
import { createPrintJobFromStoredDocument } from "../../../../lib/ai-document-agent";
import {
  claimEmailPrintAction,
  completeEmailPrintAction,
  failEmailPrintAction,
  getEmailPrintAction
} from "../../../../lib/email-print-actions";
import { getAppUserByEmail } from "../../../../lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY_OPTIONS = [1, 5, 20, 40];
const PLAN_OPTIONS = [
  "booklet-bw",
  "duplex-bw",
  "corner-staple-bw",
  "single-a4-bw",
  "single-a3-bw",
  "booklet-color",
  "duplex-color",
  "corner-staple-color",
  "single-a4-color",
  "single-a3-color"
];

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function origin() {
  const configured = clean(process.env.CRM_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  return (configured ? (configured.startsWith("http") ? configured : `https://${configured}`) : "https://crm-cy-nu.vercel.app").replace(/\/$/, "");
}

function page(title, body) {
  return new NextResponse(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#eef5fb;font-family:Arial,sans-serif;color:#172554"><main style="max-width:760px;margin:0 auto;padding:28px 16px"><section style="background:#fff;border:1px solid #d7e4f1;border-radius:18px;padding:26px;box-shadow:0 8px 24px rgba(23,37,84,.08)">${body}</section></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function link(href, label, primary = false) {
  const style = primary ? "background:#1769aa;color:#fff;border-color:#1769aa" : "background:#f8fbff;color:#125b97;border-color:#bfdbfe";
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:5px 4px;padding:11px 14px;border:1px solid;border-radius:9px;text-decoration:none;font-weight:700;${style}">${escapeHtml(label)}</a>`;
}

async function showAction(token) {
  const action = await getEmailPrintAction(token);
  if (!action) return page("קישור הדפסה לא נמצא", `<h1>קישור ההדפסה לא נמצא</h1><p>ייתכן שהקישור שגוי או שפג תוקפו.</p>`);
  if (action.status === "completed") return page("ההדפסה נקלטה", `<h1>המסמך כבר נשלח להדפסה</h1><p>העבודה נקלטה במערכת ואין צורך ללחוץ שוב.</p>`);
  if (action.status !== "pending" || new Date(action.expires_at).getTime() <= Date.now()) {
    return page("קישור הדפסה פג", `<h1>קישור ההדפסה אינו פעיל</h1><p>יש לבקש מהבוט לשלוח קישור חדש.</p>`);
  }
  const base = `/api/email/print?token=${encodeURIComponent(token)}`;
  const user = await getAppUserByEmail(action.sender_email);
  const plans = PLAN_OPTIONS.filter((plan) => !plan.endsWith("-color") || canUseColorPrint(user));
  const planLinks = plans.map((plan) => link(`${base}&action=print&printPlan=${encodeURIComponent(plan)}&copies=1`, printPlanLabel(plan))).join("");
  const copyLinks = COPY_OPTIONS.map((copies) => link(`${base}&action=print&printPlan=booklet-bw&copies=${copies}`, `${copies} עותקים`, copies === 1)).join("");
  return page("בחירת הדפסה", `<div style="color:#64748b;font-size:13px">CRM · פעולה מאושרת מתוך מייל צוות</div><h1 style="margin:10px 0 8px;font-size:28px">הדפסת קובץ מצורף</h1><p style="font-size:18px;line-height:1.5"><strong>${escapeHtml(action.file_name)}</strong></p><h2 style="font-size:20px">בחר תוכנית הדפסה</h2><div>${planLinks}</div><h2 style="font-size:20px;margin-top:22px">הדפסה מהירה בחוברת שחור־לבן</h2><div>${copyLinks}</div><p style="color:#64748b;margin-top:22px">כל קישור ניתן לשימוש פעם אחת בלבד ותוקפו מוגבל.</p>`);
}

async function showConfirmation(token, printPlan, copies) {
  const action = await getEmailPrintAction(token);
  if (!action || action.status !== "pending" || new Date(action.expires_at).getTime() <= Date.now()) {
    return page("קישור הדפסה פג", `<h1>קישור ההדפסה אינו פעיל</h1><p>יש לבקש מהבוט לשלוח קישור חדש.</p>`);
  }
  const user = await getAppUserByEmail(action.sender_email);
  if (!user || !(user.is_team_member || user.is_manager || user.is_super_admin)) {
    return page("אין הרשאה", `<h1>אין הרשאה לבצע הדפסה</h1><p>הקישור זמין רק למשתמש צוות מורשה.</p>`);
  }
  if (printPlan.endsWith("-color") && !canUseColorPrint(user)) {
    return page("אין הרשאה", `<h1>אין הרשאה להדפסה בצבע</h1><p>בחר תוכנית שחור־לבן ושלח מחדש.</p>`);
  }
  const executeUrl = `/api/email/print?token=${encodeURIComponent(token)}&action=execute&printPlan=${encodeURIComponent(printPlan)}&copies=${copies}`;
  return page("אישור הדפסה", `<div style="color:#64748b;font-size:13px">CRM · אישור סופי</div><h1 style="margin:10px 0 8px;font-size:28px">אישור שליחה להדפסה</h1><div style="border:1px solid #dbe5f1;border-radius:12px;padding:16px;background:#f8fbff;line-height:1.8"><strong>קובץ:</strong> ${escapeHtml(action.file_name)}<br><strong>תוכנית:</strong> ${escapeHtml(printPlanLabel(printPlan))}<br><strong>עותקים:</strong> ${copies}</div><p style="font-size:16px">בדוק שהפרטים נכונים. לאחר האישור הקובץ יישלח לתור ההדפסה.</p><div style="margin-top:20px">${link(executeUrl, "אישור סופי ושליחה להדפסה", true)}</div><p style="color:#64748b;font-size:13px">אין חיוב או שליחה לפני הלחיצה על הכפתור.</p>`);
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const token = clean(params.get("token"));
  if (!token) return page("קישור חסר", `<h1>חסר קישור פעולה</h1>`);
  const actionName = clean(params.get("action"));
  const printPlan = normalizePrintPlan(params.get("printPlan"));
  const copies = Math.max(1, Math.min(99, Number(params.get("copies")) || 1));
  if (actionName === "print") return showConfirmation(token, printPlan, copies);
  if (actionName !== "execute") return showAction(token);

  const action = await claimEmailPrintAction(token);
  if (!action) return showAction(token);
  const user = await getAppUserByEmail(action.sender_email);
  if (!user || !(user.is_team_member || user.is_manager || user.is_super_admin)) {
    await failEmailPrintAction(token);
    return page("אין הרשאה", `<h1>אין הרשאה לבצע הדפסה</h1><p>הקישור זמין רק למשתמש צוות מורשה.</p>`);
  }
  if (printPlan.endsWith("-color") && !canUseColorPrint(user)) {
    await failEmailPrintAction(token);
    return page("אין הרשאה", `<h1>אין הרשאה להדפסה בצבע</h1><p>בחר תוכנית שחור־לבן ושלח מחדש.</p>`);
  }
  try {
    const job = await createPrintJobFromStoredDocument({
      storedDocument: { fileName: action.file_name, contentType: action.content_type, objectKey: action.object_key, sizeBytes: action.size_bytes },
      user,
      copies,
      printPlan
    });
    await completeEmailPrintAction(token, job.id);
    return page("המסמך נשלח להדפסה", `<h1>המסמך נשלח לתור ההדפסה</h1><p><strong>${escapeHtml(action.file_name)}</strong></p><p>תוכנית: ${escapeHtml(printPlanLabel(printPlan))}<br>עותקים: ${copies}</p><p style="color:#64748b">מספר עבודה: ${escapeHtml(job.id)}</p>`);
  } catch (error) {
    await failEmailPrintAction(token);
    return page("שגיאה בהדפסה", `<h1>לא ניתן היה לשלוח להדפסה</h1><p>${escapeHtml(error?.message || "נסה שוב דרך מסלול ההדפסה.")}</p>`);
  }
}
