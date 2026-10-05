import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { fallbackArticleSlug, normalizeArticleSlug } from "../../../../lib/article-slug.js";

export const runtime = "nodejs";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function clean(value) {
  return String(value || "").trim();
}

function normalizeSlug(value, title) {
  const slug = clean(value).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || fallbackArticleSlug(title);
}

export async function POST(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_manager && !user.is_super_admin)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = clean(body?.title);
  if (!title) return NextResponse.json({ error: "חסרה כותרת." }, { status: 400 });

  if (!OPENAI_API_KEY) return NextResponse.json({ slug: fallbackArticleSlug(title), source: "fallback" });
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
    return NextResponse.json({ slug: normalizeArticleSlug(normalizeSlug(payload?.choices?.[0]?.message?.content, title), title), source: "ai" });
  } catch (error) {
    console.error("Article slug suggestion failed", error?.message || error);
    return NextResponse.json({ slug: fallbackArticleSlug(title), source: "fallback" });
  }
}
