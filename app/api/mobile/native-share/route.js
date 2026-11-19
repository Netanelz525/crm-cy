import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { ensureDbFeature, sql } from "../../../../lib/db";
import { getAppUserByClerkUserId } from "../../../../lib/rbac";
import { canAccessPrintFeature, createPrintJobFromBuffer } from "../../../../lib/print-jobs";
import { getAnnouncementTemplateById, canUseAnnouncementTemplate, createAnnouncement, markAnnouncementPrintQueued } from "../../../../lib/announcements";
import { renderAnnouncementDocx } from "../../../../lib/announcement-pdf";
import { convertAnnouncementDocxToPdf } from "../../../../lib/announcement-converter";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!/^[a-f0-9]{64}$/.test(token)) return Response.json({ error: "יש לחדש התחברות באפליקציה" }, { status: 401, headers });
    const sessions = await sql`SELECT user_id,session_id FROM mobile_share_sessions
      WHERE token_hash=${createHash("sha256").update(token).digest("hex")} AND expires_at>NOW()`;
    if (!sessions.length) return Response.json({ error: "יש לחדש התחברות באפליקציה" }, { status: 401, headers });
    const user = await getAppUserByClerkUserId(sessions[0].user_id);
    const session = await (await clerkClient()).sessions.getSession(sessions[0].session_id);
    if (session.status !== "active" || session.userId !== sessions[0].user_id || user?.access_status !== "approved") {
      return Response.json({ error: "יש לחדש התחברות באפליקציה" }, { status: 401, headers });
    }
    if (Number(request.headers.get("content-length") || 0) > 850000) throw new Error("חלק קובץ גדול מדי");
    const body = await request.json();
    if (!/^[a-f0-9-]{36}$/i.test(body.id || "")) throw new Error("מזהה שיתוף אינו תקין");
    if (!["print", "template"].includes(body.destination)) throw new Error("פעולה אינה נתמכת");
    if (body.destination === "print" && !canAccessPrintFeature(user)) throw new Error("אין הרשאת הדפסה");
    if (body.destination === "template" && (!user.can_use_announcement_templates || !canAccessPrintFeature(user))) throw new Error("אין הרשאה להדפסת תבניות");
    await ensureDbFeature("native-share-queue", "1", async () => {
      await sql`CREATE TABLE IF NOT EXISTS native_share_jobs (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'uploading',
        metadata JSONB NOT NULL,result JSONB,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS native_share_chunks (
        job_id TEXT REFERENCES native_share_jobs(id) ON DELETE CASCADE,
        part INT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(job_id,part)
      )`;
    });
    const metadata = {
      destination: body.destination, templateId: String(body.templateId || ""),
      name: String(body.name || "").slice(0, 200), type: String(body.type || "").slice(0, 100),
      copies: Number(body.copies || 1), printPlan: String(body.printPlan || ""),
      size: Number(body.size), parts: Number(body.parts)
    };
    if (!metadata.name || !Number.isInteger(metadata.size) || metadata.size <= 0 || metadata.size > 10 * 1024 * 1024 ||
        !Number.isInteger(metadata.parts) || metadata.parts < 1 || metadata.parts > 24) throw new Error("גודל קובץ אינו נתמך");
    await sql`INSERT INTO native_share_jobs(id,user_id,metadata) VALUES(${body.id},${user.clerk_user_id},${JSON.stringify(metadata)}::jsonb)
      ON CONFLICT(id) DO NOTHING`;
    const jobs = await sql`SELECT * FROM native_share_jobs WHERE id=${body.id} AND user_id=${user.clerk_user_id}`;
    const job = jobs[0];
    if (!job) throw new Error("אין הרשאה לשיתוף");
    if (Object.keys(metadata).some((key) => job.metadata[key] !== metadata[key])) throw new Error("פרטי השיתוף השתנו");
    if (job.status === "done") return Response.json({ ok: true, completed: true }, { headers });
    if (job.status === "processing") return Response.json({ error: "השליחה בעיבוד. יש לבדוק את תור ההדפסה או כרטיס התלמיד לפני ניסיון נוסף." }, { status: 409, headers });
    if (body.action === "chunk") {
      if (!Number.isInteger(body.part) || body.part < 0 || body.part >= metadata.parts ||
          typeof body.data !== "string" || body.data.length > 700000 || !/^[A-Za-z0-9+/=]+$/.test(body.data)) throw new Error("חלק קובץ אינו תקין");
      await sql`INSERT INTO native_share_chunks(job_id,part,data) VALUES(${body.id},${body.part},${body.data})
        ON CONFLICT(job_id,part) DO UPDATE SET data=EXCLUDED.data`;
      return Response.json({ ok: true }, { headers });
    }
    if (body.action !== "finish") throw new Error("פעולה אינה תקינה");
    const chunks = await sql`SELECT part,data FROM native_share_chunks WHERE job_id=${body.id} ORDER BY part`;
    if (chunks.length !== metadata.parts || chunks.some((chunk, index) => chunk.part !== index)) throw new Error("ההעלאה טרם הושלמה");
    const buffer = Buffer.from(chunks.map((chunk) => chunk.data).join(""), "base64");
    if (buffer.length !== metadata.size) throw new Error("גודל הקובץ אינו תואם");
    const claimed = await sql`UPDATE native_share_jobs SET status='processing',updated_at=NOW()
      WHERE id=${body.id} AND status='uploading' RETURNING id`;
    if (!claimed.length) return Response.json({ error: "השליחה כבר בעיבוד" }, { status: 409, headers });
    try {
      if (metadata.destination === "print") {
        await createPrintJobFromBuffer({ buffer, fileName: metadata.name, contentType: metadata.type,
          copies: metadata.copies, printPlan: metadata.printPlan, user, uploadedByUserId: user.clerk_user_id,
          sourceType: "native-share", sourceId: body.id });
      } else {
        const template = await getAnnouncementTemplateById(metadata.templateId);
        if (!template || !canUseAnnouncementTemplate(user, template) || !template.docxObjectKey ||
            (template.fields || []).some((field) => field.type === "image")) throw new Error("תבנית אינה זמינה");
        const input = JSON.parse(buffer.toString("utf8"));
        const values = {};
        for (const field of template.fields || []) {
          const value = String(input[field.key] || "");
          if ((field.required && !value.trim()) || value.length > (field.maxLength || 100000)) throw new Error("שדה בתבנית אינו תקין");
          values[field.key] = value;
        }
        const title = template.name || "מסמך מתבנית";
        const announcement = {
          id: body.id, title, templateFields: values,
          bodyText: Object.values(values).join("\n")
        };
        if (!announcement.bodyText.trim()) throw new Error("הטקסט ריק");
        const docx = await renderAnnouncementDocx({ announcement, template });
        const pdf = await convertAnnouncementDocxToPdf(docx, title + ".docx");
        await createAnnouncement({ ...announcement, templateId: template.id, templateKey: template.templateKey,
          createdByUserId: user.clerk_user_id });
        const job = await createPrintJobFromBuffer({
          buffer: pdf, fileName: title + ".pdf", contentType: "application/pdf",
          copies: metadata.copies, printPlan: metadata.printPlan, user, uploadedByUserId: user.clerk_user_id,
          sourceType: "native-share", sourceId: body.id
        });
        await markAnnouncementPrintQueued(announcement.id, job.id);
      }
    } catch {
      // A side effect may already have occurred. Do not retry the operation.
      return Response.json({ error: "השליחה דורשת בדיקה בתור ההדפסה או בכרטיס התלמיד." }, { status: 409, headers });
    }
    await sql`UPDATE native_share_jobs SET status='done',updated_at=NOW() WHERE id=${body.id}`;
    await sql`DELETE FROM native_share_chunks WHERE job_id=${body.id}`;
    return Response.json({ ok: true, completed: true }, { headers });
  } catch (error) {
    return Response.json({ error: error?.message || "שליחת השיתוף נכשלה" }, { status: 400, headers });
  }
}
