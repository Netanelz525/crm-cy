function clean(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function getConfig() {
  return {
    apiKey: clean(process.env.RESEND_API_KEY),
    fromEmail: clean(process.env.RESEND_FROM_EMAIL) || "CRM <onboarding@resend.dev>",
    replyTo: normalizeEmail(process.env.RESEND_REPLY_TO)
  };
}

function parseEmailAddress(value) {
  const raw = clean(value);
  const match = raw.match(/<([^>]+)>/);
  return normalizeEmail(match?.[1] || raw);
}

export function buildResendFromAddress(displayName = "") {
  const config = getConfig();
  const email = parseEmailAddress(config.fromEmail);
  const name = clean(displayName) || clean(config.fromEmail.split("<")[0]) || "CRM";
  return `${name} <${email}>`;
}

export function getResendConfigStatus() {
  const config = getConfig();
  const missing = [];
  if (!config.apiKey) missing.push("RESEND_API_KEY");

  return {
    configured: missing.length === 0,
    missing,
    fromEmail: config.fromEmail,
    replyTo: config.replyTo
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendResendEmail({ to, subject, text, html, replyTo, from, attachments = [], idempotencyKey = "" }) {
  const config = getConfig();
  const status = getResendConfigStatus();
  if (!status.configured) {
    throw new Error(`חסרים משתני סביבה: ${status.missing.join(", ")}`);
  }

  const recipients = Array.isArray(to) ? to.map(normalizeEmail).filter(Boolean) : [normalizeEmail(to)].filter(Boolean);
  const safeSubject = clean(subject);
  const textBody = clean(text);
  const htmlBody = clean(html);

  if (!recipients.length) throw new Error("חסר נמען לשליחת המייל.");
  if (!safeSubject) throw new Error("חסר נושא למייל.");
  if (!textBody && !htmlBody) throw new Error("חסר תוכן למייל.");

  const payload = {
    from: clean(from) || config.fromEmail,
    to: recipients,
    subject: safeSubject,
    text: textBody || undefined,
    html: htmlBody || undefined,
    reply_to: normalizeEmail(replyTo) || config.replyTo || undefined,
    attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(clean(idempotencyKey) ? { "Idempotency-Key": clean(idempotencyKey) } : {})
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const data = await response.json().catch(() => null);
    if (response.ok) {
      return {
        id: clean(data?.id)
      };
    }

    lastError = new Error(data?.message || data?.error?.message || "שליחת המייל דרך Resend נכשלה");
    if (attempt < 3) {
      await sleep(attempt * 400);
      continue;
    }
  }
  throw lastError || new Error("שליחת המייל דרך Resend נכשלה");
}
