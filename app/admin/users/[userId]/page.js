import Link from "next/link";
import { listMyCallSessions } from "../../../../lib/attendance-calls";
import { notFound } from "next/navigation";
import {
  deleteUserAction,
  generateUserTelegramLinkCodeAction,
  generateUserWhatsAppLinkCodeAction,
  unlinkUserTelegramAction,
  unlinkUserWhatsAppAction,
  updateUserAgentPreferencesAction,
  updateUserWeeklyBackupPreferencesAction,
  updateUserRoleAction,
  updateUserPrintColorPermissionAction
} from "../../actions";
import UserSettingsClient from "../../user-settings-client";
import { getAppUserByClerkUserId, requireSuperAdmin } from "../../../../lib/rbac";

export default async function AdminUserSettingsPage({ params }) {
  const currentUser = await requireSuperAdmin();
  const user = await getAppUserByClerkUserId(decodeURIComponent((await params).userId || ""));
  if (!user) notFound();

  const callSessions = user.access_status === "approved" ? await listMyCallSessions(user) : [];

  return (
    <>
    <section className="card"><h2>מפגשים באזור השיחות של המשתמש</h2>
      <p>הרשימה מחושבת לפי חשבון המשתמש וכרטיס התלמיד המקושר אליו.</p>
      {callSessions.length ? callSessions.map(session => <p key={session.id}><Link href={`/call-desk/attendance/${session.id}`}>{session.title || "מפגש"}</Link>{session.is_locked ? " · נעול" : " · פתוח"}</p>) : <p>אין מפגשים משויכים לחשבון זה.</p>}
    </section>
    <UserSettingsClient
      user={user}
      currentUserId={currentUser.clerk_user_id}
      onGenerateTelegramCode={generateUserTelegramLinkCodeAction}
      onGenerateWhatsAppCode={generateUserWhatsAppLinkCodeAction}
      onUnlinkTelegram={unlinkUserTelegramAction}
      onUnlinkWhatsApp={unlinkUserWhatsAppAction}
      onSaveRole={updateUserRoleAction}
      onSavePreferences={updateUserAgentPreferencesAction}
      onSavePrintColorPermission={updateUserPrintColorPermissionAction}
      onSaveWeeklyBackupPreferences={updateUserWeeklyBackupPreferencesAction}
      onDeleteUser={deleteUserAction}
    />
    </>
  );
}
