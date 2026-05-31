import { listAppUsers, listPendingUnknownUsers, requireTeamUser } from "../../../lib/rbac";
import { AdminPageHeader } from "../admin-ui";
import AllUsersCard from "../all-users-card";
import PendingUsersCard from "../pending-users-card";

export default async function AdminAccessPage() {
  const currentUser = await requireTeamUser();
  const [pendingUsers, users] = await Promise.all([
    listPendingUnknownUsers(),
    listAppUsers()
  ]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <AdminPageHeader
        title="הרשאות ואישורי משתמשים"
        description="כאן מאשרים משתמשים חדשים, בודקים סטטוסים, ומעדכנים הרשאות בסיסיות לפי תפקיד הגישה שלך."
      />
      <PendingUsersCard pendingUsers={pendingUsers} />
      <AllUsersCard currentUser={currentUser} users={users} />
    </div>
  );
}
