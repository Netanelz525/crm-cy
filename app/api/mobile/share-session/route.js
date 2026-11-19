import { listAnnouncementTemplates } from "../../../../lib/announcements";
import { randomBytes, createHash } from "node:crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { canAccessPrintFeature, canUseColorPrint, PRINT_PLAN_LABELS, getPrintCreditBalance, hasUnlimitedPrintCredit } from "../../../../lib/print-jobs";
import { getCurrentAppUser, assertStudentAccess } from "../../../../lib/rbac";
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
      const canAssign = Boolean(user.is_team_member || user.is_manager || user.is_super_admin);
      const students = canAssign ? await sql`SELECT student_id AS id,full_name AS name
        FROM neon_students ORDER BY full_name` : [];
      return Response.json({
        token, expiresAt: Date.now() + 86400000, userId: user.clerk_user_id,
        canPrint: canAccessPrintFeature(user), canAssign,
        templates: user.can_use_announcement_templates && canAccessPrintFeature(user) ? (await listAnnouncementTemplates({ user }))
          .filter((template) => template.docxObjectKey && !(template.fields || []).some((field) => field.type === "image"))
          .map((template) => ({ id: template.id, name: template.name, fields: template.fields })) : [],
        plans: Object.entries(PRINT_PLAN_LABELS).filter(([id]) => !id.endsWith("-color") || canUseColorPrint(user))
          .map(([id, name]) => ({ id, name })),
        students: students.filter((student) => assertStudentAccess(user, student.id)),
        creditBalance: canAccessPrintFeature(user) && !hasUnlimitedPrintCredit(user) ? await getPrintCreditBalance(user.clerk_user_id) : null
      }, { headers });
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
