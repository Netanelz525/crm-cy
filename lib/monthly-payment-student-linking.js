import { initDb, sql } from "./db.js";
import { previousPaymentMonth, syncAndLinkPayments } from "./payment-student-links.js";

function clean(value) { return String(value || "").trim(); }

export function assertPaymentLinkingCronAuthorized(request) {
  const secret = clean(process.env.CRON_SECRET);
  if (!secret) throw new Error("Missing CRON_SECRET env variable.");
  return clean(request.headers.get("authorization")) === `Bearer ${secret}`;
}

export async function runMonthlyPaymentStudentLinking({ periodMonth = previousPaymentMonth(), force = false } = {}) {
  await initDb();
  const jobName = "monthly-payment-student-linking";
  const jobKey = clean(periodMonth);
  const claimed = await sql`
    INSERT INTO scheduled_job_runs (job_name, job_key, status)
    VALUES (${jobName}, ${jobKey}, 'started')
    ON CONFLICT (job_name, job_key) DO UPDATE SET
      status = 'started', details_json = '{}'::jsonb, started_at = NOW(), completed_at = NULL
    WHERE ${Boolean(force)} OR scheduled_job_runs.status = 'failed'
      OR (scheduled_job_runs.status = 'started' AND scheduled_job_runs.started_at < NOW() - INTERVAL '10 minutes')
    RETURNING job_name
  `;
  if (!claimed.length) return { ok: true, skipped: true, periodMonth: jobKey };
  try {
    const result = await syncAndLinkPayments({ periodMonth: jobKey });
    await sql`UPDATE scheduled_job_runs SET status = 'completed', details_json = ${JSON.stringify(result)}::jsonb, completed_at = NOW() WHERE job_name = ${jobName} AND job_key = ${jobKey}`;
    return result;
  } catch (error) {
    await sql`UPDATE scheduled_job_runs SET status = 'failed', details_json = ${JSON.stringify({ error: error?.message || "Unknown error" })}::jsonb, completed_at = NOW() WHERE job_name = ${jobName} AND job_key = ${jobKey}`;
    throw error;
  }
}
