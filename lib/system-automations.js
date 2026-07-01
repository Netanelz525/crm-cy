import { initDb, sql } from "./db.js";

function clean(value) {
  return String(value || "").trim();
}

const AUTOMATION_DEFINITIONS = [
  {
    jobName: "weekly_backup_delivery",
    title: "גיבוי שבועי",
    kind: "cron",
    path: "/api/cron/weekly-backup",
    schedule: "כל יום חמישי ב-19:00 UTC",
    target: "משתמשי super_admin עם גיבוי שבועי פעיל",
    description: "מייצר גיבוי CRM ושולח לפי העדפות Email / Telegram."
  },
  {
    jobName: "student-event-reminders",
    title: "תזכורות אירועים לתגית צוות חכמי",
    kind: "cron",
    path: "/api/cron/event-reminders",
    schedule: "כל יום חמישי ב-19:10 UTC",
    target: "משתמשים שהכרטיס המקושר שלהם מסומן בתגית צוות חכמי",
    description: "שולח מייל עם אירועים ב-10 הימים הקרובים וב-10 הימים האחרונים."
  }
];

function mapRunRow(row) {
  return {
    jobName: clean(row?.job_name),
    jobKey: clean(row?.job_key),
    status: clean(row?.status) || "started",
    details: row?.details_json && typeof row.details_json === "object" ? row.details_json : {},
    startedAt: row?.started_at || null,
    completedAt: row?.completed_at || null
  };
}

export function formatAutomationRunSummary(run) {
  const details = run?.details && typeof run.details === "object" ? run.details : {};
  const parts = [];

  if (Number.isFinite(Number(details.recipients))) parts.push(`נמענים: ${Number(details.recipients)}`);
  if (Number.isFinite(Number(details.sentCount))) parts.push(`נשלחו: ${Number(details.sentCount)}`);
  if (Number.isFinite(Number(details.upcomingCount))) parts.push(`קרובים: ${Number(details.upcomingCount)}`);
  if (Number.isFinite(Number(details.recentPastCount))) parts.push(`עברו: ${Number(details.recentPastCount)}`);
  if (details.channels && typeof details.channels === "object") {
    const channelText = Object.entries(details.channels)
      .map(([channel, count]) => `${channel}: ${Number(count || 0)}`)
      .join(", ");
    if (channelText) parts.push(`ערוצים: ${channelText}`);
  }
  if (details.message) parts.push(`שגיאה: ${clean(details.message)}`);
  if (details.error) parts.push(`שגיאה: ${clean(details.error)}`);

  return parts.join(" | ") || "אין פרטים נוספים.";
}

export async function listSystemAutomationsOverview() {
  await initDb();
  const rows = await sql`
    SELECT
      job_name,
      job_key,
      status,
      details_json,
      started_at,
      completed_at
    FROM scheduled_job_runs
    ORDER BY started_at DESC
    LIMIT 40
  `;

  const runs = rows.map(mapRunRow);
  const runsByJob = new Map();
  for (const run of runs) {
    if (!runsByJob.has(run.jobName)) runsByJob.set(run.jobName, []);
    runsByJob.get(run.jobName).push(run);
  }

  return AUTOMATION_DEFINITIONS.map((definition) => {
    const history = (runsByJob.get(definition.jobName) || []).slice(0, 8);
    return {
      ...definition,
      latestRun: history[0] || null,
      history
    };
  });
}
