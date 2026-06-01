import { NextResponse } from "next/server";
import { initDb, sql } from "../../../../../../lib/db";

function clean(value) {
  return String(value || "").trim();
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const messageId = clean(resolvedParams?.messageId);
  const kind = clean(resolvedParams?.kind);
  const origin = new URL(request.url).origin;
  if (!messageId || !["view", "xlsx", "pdf"].includes(kind)) {
    return NextResponse.redirect(new URL("/", origin));
  }

  await initDb();
  const rows = await sql`
    SELECT metadata
    FROM ai_chat_messages
    WHERE id = ${messageId}
      AND role = 'assistant'
    LIMIT 1
  `;
  const metadata = rows[0]?.metadata || {};
  const target = kind === "view"
    ? clean(metadata.viewUrl)
    : kind === "xlsx"
      ? clean(metadata.exportUrl)
      : clean(metadata.pdfUrl);

  if (!target) {
    return NextResponse.redirect(new URL("/", origin));
  }

  return NextResponse.redirect(new URL(target, origin));
}
