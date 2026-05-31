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

async function getRunStatus(jobName, jobKey) {
  await initDb();
  const rows = await sql`
    SELECT status
    FROM scheduled_job_runs
    WHERE job_name = ${clean(jobName)}
      AND job_key = ${clean(jobKey)}
    LIMIT 1
  `;
  return clean(rows[0]?.status).toLowerCase();
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

  const weeklyBackupStatus = await getRunStatus("weekly_backup_delivery", jobKey);
  if (!weeklyBackupStatus) {
    results.weeklyBackup = await runWeeklyBackupJob({ force: false });
  } else {
    results.weeklyBackup = {
      ok: true,
      skipped: true,
      reason: `already_${weeklyBackupStatus}`,
      jobKey
    };
  }

  const reminderStatus = await getRunStatus("student-event-reminders", jobKey);
  if (!reminderStatus) {
    results.studentEventReminders = await runStudentEventReminderJob({ force: false });
  } else {
    results.studentEventReminders = {
      ok: true,
      skipped: true,
      reason: `already_${reminderStatus}`,
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
