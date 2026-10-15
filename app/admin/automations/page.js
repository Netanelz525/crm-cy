import { requireSuperAdmin } from "../../../lib/rbac";
import { AdminPageHeader } from "../admin-ui";
import SystemAutomationsCard from "../system-automations-card";

export const maxDuration = 300;

export default async function AdminAutomationsPage({ searchParams }) {
  await requireSuperAdmin();
  const { runStatus } = await searchParams || {};

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <AdminPageHeader
        title="תהליכים אוטומטיים"
        description="מסך ייעודי לצפייה ב-cron jobs, בריצות אחרונות, ובתקינות של משימות המערכת."
      />
      {runStatus === "completed" ? <div className="ok" role="status">התהליך הסתיים. תוצאת ההרצה מופיעה בהיסטוריה.</div> : null}
      {runStatus === "failed" ? <div className="error" role="alert">הפעלת התהליך נכשלה. בדוק את פרטי הריצה בהיסטוריה.</div> : null}
      <SystemAutomationsCard />
    </div>
  );
}
