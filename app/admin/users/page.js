import { listAppUsers, requireSuperAdmin } from "../../../lib/rbac";
import { AdminPageHeader } from "../admin-ui";
import UserManagementClient from "../user-management-client";

export default async function AdminUsersPage() {
  await requireSuperAdmin();
  const users = await listAppUsers();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <AdminPageHeader
        title="משתמשים וסוכנים"
        description="חיפוש מהיר בכל המשתמשים, צפייה בסיכום הרשאות, וכניסה לעמוד ההגדרות המלא של כל משתמש."
      />
      <UserManagementClient users={users} />
    </div>
  );
}
