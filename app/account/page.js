import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../lib/rbac";
import { getTelegramLinkByClerkUserId, getTelegramBotUsername, isTelegramConfigured } from "../../lib/telegram";
import { getWhatsAppBusinessNumber, getWhatsAppLinkByClerkUserId, isWhatsAppConfigured } from "../../lib/whatsapp";
import TelegramSettingsClient from "../telegram/telegram-settings-client";
import WhatsAppSettingsClient from "../whatsapp/whatsapp-settings-client";
import {
  generateTelegramLinkCodeAction,
  setupTelegramWebhookAction,
  unlinkTelegramAction
} from "../telegram/actions";
import {
  generateWhatsAppLinkCodeAction,
  unlinkWhatsAppAction
} from "../whatsapp/actions";

export default async function AccountPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in");

  const canUseAiChat = Boolean(user.is_team_member || user.is_manager);
  const telegramLink = canUseAiChat ? await getTelegramLinkByClerkUserId(user.clerk_user_id) : null;
  const whatsappLink = canUseAiChat ? await getWhatsAppLinkByClerkUserId(user.clerk_user_id) : null;
  const botUsername = getTelegramBotUsername();
  const businessNumber = getWhatsAppBusinessNumber();
  const telegramDirectLinkReady = Boolean(isTelegramConfigured() && botUsername);
  const whatsappDirectLinkReady = Boolean(isWhatsAppConfigured() && businessNumber);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card glass">
        <h1 style={{ marginTop: 0 }}>אזור אישי</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          כאן מנהלים את החיבור האישי לסוכן, מעתיקים קישורי כניסה ישירים ל־Telegram ול־WhatsApp,
          ומנתקים ערוצים אם צריך.
        </p>
      </section>

      {!canUseAiChat ? (
        <section className="card muted">
          לחשבון הזה אין כרגע הרשאה לעבוד עם סוכן ה־CRM. אם צריך, מנהל מערכת יכול לפתוח לך Telegram או WhatsApp.
        </section>
      ) : (
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div style={{ display: "grid", gap: 12 }}>
            {!telegramDirectLinkReady ? (
              <div className="card muted">חסר `BOT_TELEGRAM` או `BOT_TELEGRAM_USERNAME` ב־ENV. בלי זה אי אפשר ליצור קישור כניסה ישיר ל־Telegram.</div>
            ) : null}
            <TelegramSettingsClient
              isLinked={Boolean(telegramLink?.telegram_chat_id)}
              linkedChatId={telegramLink?.telegram_chat_id || ""}
              botUsername={botUsername}
              onGenerateCode={generateTelegramLinkCodeAction}
              onSetupWebhook={setupTelegramWebhookAction}
              onUnlink={unlinkTelegramAction}
            />
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {!whatsappDirectLinkReady ? (
              <div className="card muted">חסר `WHATSAPP_BUSINESS_DISPLAY_NUMBER` או חיבור ה־WhatsApp ב־ENV. בלי זה אי אפשר ליצור קישור כניסה ישיר ל־WhatsApp.</div>
            ) : null}
            <WhatsAppSettingsClient
              isLinked={Boolean(whatsappLink?.whatsapp_wa_id)}
              linkedWaId={whatsappLink?.whatsapp_wa_id || ""}
              businessNumber={businessNumber}
              onGenerateCode={generateWhatsAppLinkCodeAction}
              onUnlink={unlinkWhatsAppAction}
            />
          </div>
        </div>
      )}
    </div>
  );
}
