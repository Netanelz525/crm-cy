function clean(value) {
  return String(value || "").trim();
}

function required(value, name) {
  const normalized = clean(value);
  if (!normalized) throw new Error(`Missing ${name} env variable.`);
  return normalized;
}

export function operationalWhatsAppConfig(env = process.env) {
  const version = clean(env.WHATSAPP_GRAPH_VERSION) || "v23.0";
  const phoneNumberId = required(env.WHATSAPP_PHONE_NUMBER_ID, "WHATSAPP_PHONE_NUMBER_ID");
  return {
    baseUrl: "https://graph.facebook.com",
    version,
    phoneNumberId,
    accessToken: required(env.WHATSAPP_ACCESS_TOKEN, "WHATSAPP_ACCESS_TOKEN"),
    messagesUrl: `https://graph.facebook.com/${version}/${phoneNumberId}/messages`
  };
}

export function coexistenceWhatsAppConfig(env = process.env) {
  const baseUrl = (clean(env.DUALHOOK_API_BASE_URL) || clean(env.WHATSAPP_COEX_API_BASE) || "https://api.dualhook.com").replace(/\/+$/, "");
  const version = clean(env.DUALHOOK_API_VERSION) || clean(env.WHATSAPP_COEX_API_VERSION) || "v25.0";
  const phoneNumberId = required(env.DUALHOOK_PHONE_NUMBER_ID || env.WHATSAPP_COEX_PHONE_NUMBER_ID, "DUALHOOK_PHONE_NUMBER_ID or WHATSAPP_COEX_PHONE_NUMBER_ID");
  const wabaId = required(env.DUALHOOK_WABA_ID || env.WHATSAPP_COEX_WABA_ID, "DUALHOOK_WABA_ID or WHATSAPP_COEX_WABA_ID");
  return {
    baseUrl,
    version,
    phoneNumberId,
    wabaId,
    accessToken: required(env.DUALHOOK_API_KEY || env.WHATSAPP_COEX_ACCESS_TOKEN, "DUALHOOK_API_KEY or WHATSAPP_COEX_ACCESS_TOKEN"),
    messagesUrl: `${baseUrl}/${version}/${phoneNumberId}/messages`,
    templatesUrl: `${baseUrl}/${version}/${wabaId}/message_templates`
  };
}

export function isCoexistenceWhatsAppConfigured(env = process.env) {
  return Boolean(
    clean(env.DUALHOOK_API_KEY || env.WHATSAPP_COEX_ACCESS_TOKEN)
    && clean(env.DUALHOOK_PHONE_NUMBER_ID || env.WHATSAPP_COEX_PHONE_NUMBER_ID)
    && clean(env.DUALHOOK_WABA_ID || env.WHATSAPP_COEX_WABA_ID)
  );
}
