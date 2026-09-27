import Link from "next/link";
import { requireTeamUser } from "../../../../lib/rbac";
import { AdminPageHeader } from "../../../../app/admin/admin-ui";
import { createWhatsAppTemplateAction } from "../actions";

function clean(value) { return String(value ?? "").trim(); }

export default async function NewWhatsAppTemplatePage({ searchParams }) {
  const user = await requireTeamUser();
  if (!user.is_manager) return null;
  const params = await searchParams;
  const error = clean(params?.error);
  return (
    <>
      <AdminPageHeader title="יצירת תבנית WhatsApp חדשה" description="ה־CRM שולח את הגדרת התבנית ל־Dualhook, ומשם היא מוגשת לבדיקה ולאישור של Meta. לאחר האישור היא תופיע אוטומטית ברשימת התבניות." />
      {error ? <div className="notice error">{error}</div> : null}
      <form action={createWhatsAppTemplateAction} className="card glass grid whatsapp-template-create-form">
        <label>שם API באנגלית<input name="name" pattern="[a-z0-9_]{3,512}" placeholder="general_meeting_reminder_v1" required /><small className="muted">אותיות קטנות, מספרים וקו תחתון בלבד.</small></label>
        <label>שפה<input name="language" defaultValue="he" placeholder="he" required /></label>
        <label>קטגוריה<select name="category" defaultValue="UTILITY"><option value="UTILITY">שירותי</option><option value="MARKETING">שיווקי</option><option value="AUTHENTICATION">אימות</option></select></label>
        <label style={{ gridColumn: "1 / -1" }}>תוכן גוף התבנית<textarea name="bodyText" placeholder="שלום {{1}}, פרטי המפגש: {{2}}" rows={6} required /><small className="muted">השתמש ב־{'{{1}}'}, {'{{2}}'} וכן הלאה. הסדר קובע את השדות.</small></label>
        <label style={{ gridColumn: "1 / -1" }}>ערכי דוגמה לפרמטרים<input name="bodyExamples" placeholder="ישראל|מפגש הורים" /><small className="muted">הפרד ערכים באמצעות | כדי ש־Meta תוכל לבדוק את התבנית.</small></label>
        <label>כותרת<select name="headerFormat" defaultValue=""><option value="">ללא כותרת</option><option value="TEXT">טקסט</option><option value="IMAGE">תמונה</option><option value="DOCUMENT">מסמך</option></select></label>
        <label>טקסט כותרת<input name="headerText" placeholder="רלוונטי רק לכותרת טקסט" /></label>
        <label>Header handle<input name="headerHandle" placeholder="נדרש רק אם Meta דורשת דוגמת מדיה" /></label>
        <label>Footer<input name="footerText" placeholder="טקסט תחתון (רשות)" /></label>
        <fieldset style={{ gridColumn: "1 / -1" }}><legend>כפתורי תגובה (רשות)</legend><div className="grid"><input name="buttons" placeholder="כפתור ראשון" /><input name="buttons" placeholder="כפתור שני" /><input name="buttons" placeholder="כפתור שלישי" /></div><small className="muted">כפתורי Quick Reply מיועדים למסלול התפעולי/עדכון סטטוס. תבנית הזמנה צריכה להישאר ללא כפתורים.</small></fieldset>
        <div className="quick-actions" style={{ gridColumn: "1 / -1" }}><button className="primary-btn" type="submit">שלח ל־Dualhook לבדיקה ואישור</button><Link className="quick-action-btn quick-action-outline" href="/admin/whatsapp-templates">ביטול</Link></div>
      </form>
    </>
  );
}
