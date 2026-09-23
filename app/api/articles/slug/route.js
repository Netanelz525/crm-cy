import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";

export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function clean(value) {
  return String(value || "").trim();
}

function fallbackSlug(title) {
  const transliteration = {
    א: "a", ב: "b", ג: "g", ד: "d", ה: "h", ו: "v", ז: "z", ח: "h", ט: "t", י: "y",
    כ: "k", ך: "k", ל: "l", מ: "m", ם: "m", נ: "n", ן: "n", ס: "s", ע: "a", פ: "p",
    ף: "p", צ: "ts", ץ: "ts", ק: "q", ר: "r", ש: "sh", ת: "t"
  };
  const value = clean(title).toLowerCase().split("").map((char) => transliteration[char] || char).join("");
  const slug = value
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || `article-${Date.now().toString(36)}`;
}

function normalizeSlug(value, title) {
  const slug = clean(value).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || fallbackSlug(title);
}

export async function POST(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_manager && !user.is_super_admin)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = clean(body?.title);
  if (!title) return NextResponse.json({ error: "חסרה כותרת." }, { status: 400 });

  if (!OPENAI_API_KEY) return NextResponse.json({ slug: fallbackSlug(title), source: "fallback" });
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        max_tokens: 40,
        messages: [
          { role: "system", content: "Create URL slugs for Hebrew CRM knowledge articles. Return only lowercase English ASCII letters, numbers, and hyphens. Translate the meaning naturally and keep it concise. Never include a slash, punctuation, markdown, or explanation." },
          { role: "user", content: title }
        ]
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || "AI request failed");
    return NextResponse.json({ slug: normalizeSlug(payload?.choices?.[0]?.message?.content, title), source: "ai" });
  } catch (error) {
    console.error("Article slug suggestion failed", error?.message || error);
    return NextResponse.json({ slug: fallbackSlug(title), source: "fallback" });
  }
}
