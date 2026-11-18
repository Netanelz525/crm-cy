import { randomBytes, createHash } from "node:crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { ensureDbFeature, sql } from "../../../../lib/db";

export const runtime = "nodejs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export async function POST(request) {
  const headers = { "Cache-Control": "no-store" };
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers });
  }
  try {
    await ensureDbFeature("mobile-share-session", "1", async () => {
      await sql`CREATE TABLE IF NOT EXISTS mobile_share_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )`;
    });
    const body = await request.json();
    if (body.kind === "issue") {
      const user = await getCurrentAppUser();
      const { sessionId } = await auth();
      if (!sessionId || user?.access_status !== "approved") {
        return Response.json({ error: "יש להתחבר באפליקציה" }, { status: 401, headers });
      }
      const token = randomBytes(32).toString("hex");
      await sql`DELETE FROM mobile_share_sessions WHERE expires_at < NOW()`;
      await sql`INSERT INTO mobile_share_sessions(token_hash,user_id,session_id,expires_at)
        VALUES(${hash(token)},${user.clerk_user_id},${sessionId},NOW()+INTERVAL '1 day')`;
      return Response.json({ token, expiresAt: Date.now() + 86400000 }, { headers });
    }
    if (!/^[a-f0-9]{64}$/.test(body.token || "")) throw new Error("Unauthorized");
    const rows = await sql`SELECT user_id,session_id FROM mobile_share_sessions
      WHERE token_hash=${hash(body.token)} AND expires_at>NOW()`;
    if (!rows.length) throw new Error("Unauthorized");
    const client = await clerkClient();
    const source = await client.sessions.getSession(rows[0].session_id);
    if (source.status !== "active" || source.userId !== rows[0].user_id) throw new Error("Unauthorized");
    const ticket = await client.signInTokens.createSignInToken({ userId: rows[0].user_id, expiresInSeconds: 30 });
    return Response.json({ ticket: ticket.token }, { headers });
  } catch {
    return Response.json({ error: "יש לפתוח את CRM CY ולחדש את ההתחברות לשיתוף." }, { status: 401, headers });
  }
}
