import { notFound } from "next/navigation";
import {
  deleteUserAction,
  generateUserTelegramLinkCodeAction,
  generateUserWhatsAppLinkCodeAction,
  unlinkUserTelegramAction,
  unlinkUserWhatsAppAction,
  updateUserAgentPreferencesAction,
  updateUserWeeklyBackupPreferencesAction,
  updateUserRoleAction
} from "../../actions";
import UserSettingsClient from "../../user-settings-client";
import { getAppUserByClerkUserId, requireSuperAdmin } from "../../../../lib/rbac";

export default async function AdminUserSettingsPage({ params }) {
  const currentUser = await requireSuperAdmin();
  const user = await getAppUserByClerkUserId(decodeURIComponent(params.userId || ""));
  if (!user) notFound();

  return (
    <UserSettingsClient
      user={user}
      currentUserId={currentUser.clerk_user_id}
      onGenerateTelegramCode={generateUserTelegramLinkCodeAction}
      onGenerateWhatsAppCode={generateUserWhatsAppLinkCodeAction}
      onUnlinkTelegram={unlinkUserTelegramAction}
      onUnlinkWhatsApp={unlinkUserWhatsAppAction}
      onSaveRole={updateUserRoleAction}
      onSavePreferences={updateUserAgentPreferencesAction}
      onSaveWeeklyBackupPreferences={updateUserWeeklyBackupPreferencesAction}
      onDeleteUser={deleteUserAction}
    />
  );
}
