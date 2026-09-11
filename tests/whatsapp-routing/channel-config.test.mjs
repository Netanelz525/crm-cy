import test from "node:test";
import assert from "node:assert/strict";
import {
  coexistenceWhatsAppConfig,
  isCoexistenceWhatsAppConfigured,
  operationalWhatsAppConfig
} from "../../lib/whatsapp-channel-config.mjs";

const env = {
  WHATSAPP_GRAPH_VERSION: "v23.0",
  WHATSAPP_PHONE_NUMBER_ID: "operational-phone",
  WHATSAPP_ACCESS_TOKEN: "operational-token",
  WHATSAPP_COEX_API_BASE: "https://api.dualhook.test/",
  WHATSAPP_COEX_API_VERSION: "v25.0",
  WHATSAPP_COEX_PHONE_NUMBER_ID: "broadcast-phone",
  WHATSAPP_COEX_WABA_ID: "broadcast-waba",
  WHATSAPP_COEX_ACCESS_TOKEN: "broadcast-token"
};

test("operational bot always uses the Meta Graph channel", () => {
  const config = operationalWhatsAppConfig(env);
  assert.equal(config.messagesUrl, "https://graph.facebook.com/v23.0/operational-phone/messages");
  assert.equal(config.accessToken, "operational-token");
});

test("human broadcast always uses the isolated coexistence channel", () => {
  const config = coexistenceWhatsAppConfig(env);
  assert.equal(config.messagesUrl, "https://api.dualhook.test/v25.0/broadcast-phone/messages");
  assert.equal(config.templatesUrl, "https://api.dualhook.test/v25.0/broadcast-waba/message_templates");
  assert.equal(config.accessToken, "broadcast-token");
});

test("coexistence never falls back to operational credentials", () => {
  assert.throws(() => coexistenceWhatsAppConfig({
    ...env,
    WHATSAPP_COEX_ACCESS_TOKEN: "",
    WHATSAPP_ACCESS_TOKEN: "must-not-be-used"
  }), /WHATSAPP_COEX_ACCESS_TOKEN/);
  assert.equal(isCoexistenceWhatsAppConfigured({ ...env, WHATSAPP_COEX_ACCESS_TOKEN: "" }), false);
});
