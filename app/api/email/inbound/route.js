import crypto from "crypto";
import { NextResponse } from "next/server";
import { processResendInboundEmail, getResendAgentEmail } from "../../../../lib/email-agent";

function clean(value) {
  return String(value || "").trim();
}

function decodeSvixSecret(secret) {
  const raw = clean(secret).replace(/^whsec_/, "");
  return Buffer.from(raw, "base64");
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySignature(payload, headers) {
  const secret = clean(process.env.RESEND_INBOUND_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SECRET);
  if (!secret) return { ok: false, reason: "missing_secret" };
  const id = clean(headers.get("svix-id"));
  const timestamp = clean(headers.get("svix-timestamp"));
  const signature = clean(headers.get("svix-signature"));
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: "stale_timestamp" };
  const expected = crypto.createHmac("sha256", decodeSvixSecret(secret)).update(`${id}.${timestamp}.${payload}`).digest("base64");
  const matched = signature
    .split(" ")
    .map((part) => part.replace(/^v\d+[=,]/, ""))
    .some((value) => timingSafeEqualText(value, expected));
  return matched ? { ok: true } : { ok: false, reason: "bad_signature" };
}

export async function POST(request) {
  const rawPayload = await request.text();
  const verification = verifySignature(rawPayload, request.headers);
  if (!verification.ok) return NextResponse.json({ ok: false, error: verification.reason }, { status: 401 });

  let eventPayload;
  try {
    eventPayload = JSON.parse(rawPayload);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (clean(eventPayload?.type) !== "email.received") {
    return NextResponse.json({ ok: true, ignored: true, reason: "unsupported_event" });
  }

  const configuredAddress = getResendAgentEmail();
  const result = await processResendInboundEmail(eventPayload);
  return NextResponse.json({ ...result, configuredAddress: configuredAddress || null });
}
