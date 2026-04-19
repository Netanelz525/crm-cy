import { redirect } from "next/navigation";
import TelegramSettingsClient from "./telegram-settings-client";
import {
  generateTelegramLinkCodeAction,
  setupTelegramWebhookAction,
  unlinkTelegramAction
} from "./actions";
import { getCurrentAppUser } from "../../lib/rbac";
import { getTelegramLinkByClerkUserId, isTelegramConfigured } from "../../lib/telegram";

export default async function TelegramPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in");
  if (!user.is_team_member && !user.is_manager) redirect("/unauthorized");

  const telegramLink = await getTelegramLinkByClerkUserId(user.clerk_user_id);
  const botConfigured = isTelegramConfigured();
  const botUsername = process.env.BOT_TELEGRAM_USERNAME || "";

  return (
    <>
      {!botConfigured ? (
        <div className="card muted">
          חסר `BOT_TELEGRAM` ב־ENV. בלי זה אי אפשר לחבר את Telegram.
        </div>
      ) : null}
      <TelegramSettingsClient
        isLinked={Boolean(telegramLink?.telegram_chat_id)}
        linkedChatId={telegramLink?.telegram_chat_id || ""}
        botUsername={botUsername}
        onGenerateCode={generateTelegramLinkCodeAction}
        onSetupWebhook={setupTelegramWebhookAction}
        onUnlink={unlinkTelegramAction}
      />
    </>
  );
}
