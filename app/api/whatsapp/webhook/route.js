import { NextResponse } from "next/server";

function clean(value) {
  return String(value || "").trim();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = clean(searchParams.get("hub.mode"));
  const verifyToken = clean(searchParams.get("hub.verify_token"));
  const challenge = clean(searchParams.get("hub.challenge"));

  if (
    mode === "subscribe"
    && verifyToken
    && verifyToken === clean(process.env.WHATSAPP_VERIFY_TOKEN)
  ) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  console.log("WhatsApp webhook received:", JSON.stringify(body || {}));
  return NextResponse.json({ ok: true });
}
