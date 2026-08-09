import crypto from "crypto";
import { NextResponse } from "next/server";
import { recordResendEmailEvent } from "../../../../lib/email-campaigns";

function clean(value) {
  return String(value || "").trim();
}

function decodeSvixSecret(secret) {
  const raw = clean(secret);
  const value = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  return Buffer.from(value, "base64");
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(clean(left));
  const rightBuffer = Buffer.from(clean(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyResendWebhookSignature({ payload, headers }) {
  const secret = clean(process.env.RESEND_WEBHOOK_SECRET);
  if (!secret) return { ok: false, reason: "missing_secret" };

  const svixId = clean(headers.get("svix-id"));
  const svixTimestamp = clean(headers.get("svix-timestamp"));
  const svixSignature = clean(headers.get("svix-signature"));
  if (!svixId || !svixTimestamp || !svixSignature) return { ok: false, reason: "missing_headers" };

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return { ok: false, reason: "bad_timestamp" };
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > 300) return { ok: false, reason: "stale_timestamp" };

  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", decodeSvixSecret(secret))
    .update(signedContent)
    .digest("base64");

  const signatures = svixSignature
    .split(" ")
    .flatMap((part) => part.split(","))
    .map((part) => clean(part))
    .filter(Boolean)
    .map((part) => part.replace(/^v\d+,/, "").replace(/^v\d+=/, ""))
    .map((part) => part.includes(",") ? part.split(",").pop() : part)
    .filter(Boolean);

  const matched = signatures.some((signature) => timingSafeEqualText(signature, expected));
  return matched ? { ok: true } : { ok: false, reason: "bad_signature" };
}

export async function POST(request) {
  const payload = await request.text();
  const signature = verifyResendWebhookSignature({ payload, headers: request.headers });
  if (!signature.ok) {
    return NextResponse.json({ ok: false, error: signature.reason }, { status: 401 });
  }

  let eventPayload = null;
  try {
    eventPayload = JSON.parse(payload);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const result = await recordResendEmailEvent(eventPayload);
  return NextResponse.json(result, { status: result.ok || result.ignored ? 200 : 400 });
}
