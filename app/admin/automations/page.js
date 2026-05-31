import { requireSuperAdmin } from "../../../lib/rbac";
import { AdminPageHeader } from "../admin-ui";
import SystemAutomationsCard from "../system-automations-card";

export default async function AdminAutomationsPage() {
  await requireSuperAdmin();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <AdminPageHeader
        title="תהליכים אוטומטיים"
        description="מסך ייעודי לצפייה ב-cron jobs, בריצות אחרונות, ובתקינות של משימות המערכת."
      />
      <SystemAutomationsCard />
    </div>
  );
}
