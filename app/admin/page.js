import Link from "next/link";
import { requireTeamUser } from "../../lib/rbac";
import { AdminAreaLinkCard } from "./admin-ui";

export default async function AdminPage() {
  const currentUser = await requireTeamUser();

  return (
    <>
      <div className="card glass">
        <h1>ניהול מערכת</h1>
        <p className="muted">
          מכאן בוחרים לאיזה אזור ניהול לעבור. כל תחום קיבל עמוד ייעודי כדי שהעבודה תהיה נקייה ומהירה יותר.
          <br />
          מחובר: {currentUser.display_name}
        </p>
        {currentUser.is_super_admin ? (
          <div className="student-meta-line">
            <span className="meta-chip meta-chip-strong">סופר אדמין</span>
          </div>
        ) : null}
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/">
            חזרה למסך הראשי
          </Link>
        </div>
      </div>

      <section style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <AdminAreaLinkCard
          title="הרשאות ואישורי משתמשים"
          description="אישור משתמשים ממתינים, הרשאות, וגישה מהירה לכל המשתמשים במערכת."
          href="/admin/access"
          cta="פתח ניהול הרשאות"
          badge="למנהלים"
        />
        <AdminAreaLinkCard
          title="גישת API וטוקנים"
          description="יצירת טוקנים, תיעוד endpointים, וסקירה של שימושים קיימים והיסטוריים."
          href="/admin/api-access"
          cta="פתח אזור API"
          badge="למנהלים"
        />
        {currentUser.is_super_admin ? (
          <AdminAreaLinkCard
            title="משתמשים וסוכנים"
            description="חיפוש משתמשים, כניסה לעמודי משתמש, וניהול חיבורים אישיים של סוכנים."
            href="/admin/users"
            cta="פתח ניהול משתמשים"
            badge="סופר אדמין"
          />
        ) : null}
        {currentUser.is_super_admin ? (
          <AdminAreaLinkCard
            title="תהליכים אוטומטיים"
            description="סקירת cron jobs, ריצות אחרונות, וסטטוס של תהליכי מערכת."
            href="/admin/automations"
            cta="פתח אוטומציות"
            badge="סופר אדמין"
          />
        ) : null}
        {currentUser.is_super_admin ? (
          <AdminAreaLinkCard
            title="מערכות תשלום"
            description="הגדרת חיבורי נדרים פלוס ו-Stripe לדוחות העסקאות של המערכת."
            href="/admin/payments"
            cta="פתח חיבורי תשלום"
            badge="סופר אדמין"
          />
        ) : null}
        <AdminAreaLinkCard
          title="תלמידים שנמחקו זמנית"
          description="צפייה בתלמידים שנמחקו, שחזורם, או מחיקה סופית לפני תום חלון השחזור."
          href="/admin/deleted-students"
          cta="פתח אזור מחיקה זמני"
          badge="למנהלים"
        />
      </section>
    </>
  );
}
