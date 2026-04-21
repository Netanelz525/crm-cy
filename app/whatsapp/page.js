import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../lib/rbac";
import { getWhatsAppLinkByClerkUserId, isWhatsAppConfigured } from "../../lib/whatsapp";
import { generateWhatsAppLinkCodeAction, unlinkWhatsAppAction } from "./actions";
import WhatsAppSettingsClient from "./whatsapp-settings-client";

export default async function WhatsAppPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in");
  if (!user.is_team_member && !user.is_manager) redirect("/unauthorized");

  const whatsappLink = await getWhatsAppLinkByClerkUserId(user.clerk_user_id);
  const configured = isWhatsAppConfigured();
  const businessNumber = process.env.WHATSAPP_BUSINESS_DISPLAY_NUMBER || "";

  return (
    <>
      {!configured ? (
        <div className="card muted">
          חסרים `WHATSAPP_PHONE_NUMBER_ID` או `WHATSAPP_ACCESS_TOKEN` ב־ENV. בלי זה אי אפשר לחבר את WhatsApp.
        </div>
      ) : null}
      <WhatsAppSettingsClient
        isLinked={Boolean(whatsappLink?.whatsapp_wa_id)}
        linkedWaId={whatsappLink?.whatsapp_wa_id || ""}
        businessNumber={businessNumber}
        onGenerateCode={generateWhatsAppLinkCodeAction}
        onUnlink={unlinkWhatsAppAction}
      />
    </>
  );
}
