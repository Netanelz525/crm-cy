import { initDb, sql } from "./db.js";
import { assertCronAuthorized as assertWeeklyBackupAuthorized, runWeeklyBackupJob } from "./weekly-backup.js";
import { runStudentEventReminderJob } from "./event-reminders.js";

function clean(value) {
  return String(value || "").trim();
}

function currentJobKey() {
  return new Date().toISOString().slice(0, 10);
}

function isThursdayInJerusalem(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short"
  }).format(date);
  return weekday === "Thu";
}

function isStaleStartedRun(run) {
  if (clean(run?.status).toLowerCase() !== "started") return false;
  const startedAt = new Date(run?.started_at || "");
  if (Number.isNaN(startedAt.getTime())) return true;
  return Date.now() - startedAt.getTime() > 10 * 60 * 1000;
}

async function getRunState(jobName, jobKey) {
  await initDb();
  const rows = await sql`
    SELECT status, started_at
    FROM scheduled_job_runs
    WHERE job_name = ${clean(jobName)}
      AND job_key = ${clean(jobKey)}
    LIMIT 1
  `;
  const row = rows[0] || null;
  if (!row) return null;
  return {
    status: clean(row.status).toLowerCase(),
    started_at: row.started_at,
    stale: isStaleStartedRun(row)
  };
}

function shouldRecoverRun(run) {
  if (!run) return true;
  if (run.status === "failed") return true;
  if (run.status === "started" && run.stale) return true;
  return false;
}

export function assertCronAuthorized(request) {
  return assertWeeklyBackupAuthorized(request);
}

export async function runAutomationRecoveryJob() {
  const now = new Date();
  const jobKey = currentJobKey();

  if (!isThursdayInJerusalem(now)) {
    return {
      ok: true,
      skipped: true,
      reason: "not_thursday",
      jobKey
    };
  }

  const results = {};

  const weeklyBackupRun = await getRunState("weekly_backup_delivery", jobKey);
  if (shouldRecoverRun(weeklyBackupRun)) {
    results.weeklyBackup = await runWeeklyBackupJob({ force: false });
  } else {
    results.weeklyBackup = {
      ok: true,
      skipped: true,
      reason: `already_${weeklyBackupRun.status}`,
      jobKey
    };
  }

  const reminderRun = await getRunState("student-event-reminders", jobKey);
  if (shouldRecoverRun(reminderRun)) {
    results.studentEventReminders = await runStudentEventReminderJob({ force: false });
  } else {
    results.studentEventReminders = {
      ok: true,
      skipped: true,
      reason: `already_${reminderRun.status}`,
      jobKey
    };
  }

  return {
    ok: true,
    skipped: false,
    jobKey,
    results
  };
}
