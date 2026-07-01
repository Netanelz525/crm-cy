import { exportCrmData } from "./crm-export.js";
import { initDb, sql } from "./db.js";
import { sendResendEmail } from "./resend.js";
import { ENUM_LABELS, FIELD_SECTIONS, getByPath } from "./student-fields.js";
import { sendTelegramDocumentFile } from "./telegram.js";
import * as XLSX from "xlsx";

const EXCEL_CELL_TEXT_LIMIT = 32767;

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCountLines(payload) {
  return Object.entries(payload?.counts || {})
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
}

function buildJsonBackupFile(payload) {
  const exportedAt = clean(payload?.exportedAt).replace(/[:.]/g, "-");
  const filename = `crm-backup-${exportedAt || Date.now()}.json`;
  const json = JSON.stringify(payload, null, 2);
  return {
    filename,
    buffer: Buffer.from(json, "utf8")
  };
}

function normalizeCellValue(value) {
  let normalized = "";
  if (value === null || value === undefined) return "";
  if (value instanceof Date) normalized = value.toISOString();
  else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") normalized = value;
  else if (Array.isArray(value)) {
    normalized = value
      .map((item) => normalizeNestedCellValue(item))
      .filter((item) => item !== "")
      .join(", ");
  } else if (typeof value === "object") {
    normalized = Object.entries(value)
      .map(([key, nestedValue]) => {
        const rendered = normalizeNestedCellValue(nestedValue);
        return rendered === "" ? "" : `${key}: ${rendered}`;
      })
      .filter(Boolean)
      .join(", ");
  } else {
    normalized = String(value);
  }

  if (typeof normalized !== "string") return normalized;
  if (normalized.length <= EXCEL_CELL_TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, EXCEL_CELL_TEXT_LIMIT - 15)}... [truncated]`;
}

function normalizeNestedCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeNestedCellValue(item))
      .filter((item) => item !== "")
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nestedValue]) => {
        const rendered = normalizeNestedCellValue(nestedValue);
        return rendered === "" ? "" : `${key}: ${rendered}`;
      })
      .filter(Boolean)
      .join(", ");
  }
  return String(value);
}

const STUDENT_DISPLAY_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields || []);

function fieldLabel(fieldKey) {
  const field = STUDENT_DISPLAY_FIELDS.find((item) => item.key === fieldKey);
  return clean(field?.label) || clean(fieldKey);
}

function formatEnumDisplay(enumName, rawValue) {
  const raw = clean(rawValue);
  if (!raw) return "";
  const label = clean(ENUM_LABELS?.[enumName]?.[raw]);
  return label ? `${label} (${raw})` : raw;
}

function formatFieldDisplay(field, rawValue) {
  if (field?.enum) return formatEnumDisplay(field.enum, rawValue);
  return normalizeCellValue(rawValue);
}

function buildStudentDisplayColumns(row) {
  const source = row?.payload && typeof row.payload === "object" ? row.payload : row;
  const extras = {};

  for (const field of STUDENT_DISPLAY_FIELDS) {
    const rawValue = getByPath(source, field.key);
    const normalizedRaw = normalizeCellValue(rawValue);
    if (normalizedRaw === "") continue;

    const headerBase = `${fieldLabel(field.key)}__display`;
    extras[headerBase] = formatFieldDisplay(field, rawValue);

    if (field.enum) {
      extras[`${fieldLabel(field.key)}__actual`] = normalizedRaw;
    }
  }

  return extras;
}

function enrichRowForExcel(tableName, row) {
  const baseRow = row && typeof row === "object" && !Array.isArray(row) ? row : { value: row };
  if (tableName !== "neon_students") return baseRow;
  return {
    ...baseRow,
    ...buildStudentDisplayColumns(baseRow)
  };
}

function collectSheetHeaders(rows) {
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) seen.add(key);
    }
  }
  return [...seen];
}

function sanitizeSheetName(name, usedNames) {
  const base = clean(name).replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || "Sheet";
  let candidate = base;
  let counter = 2;
  while (usedNames.has(candidate)) {
    const suffix = `-${counter}`;
    candidate = `${base.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`;
    counter += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function buildExcelBackupFile(payload) {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const exportedAt = clean(payload?.exportedAt).replace(/[:.]/g, "-");
  const filename = `crm-backup-${exportedAt || Date.now()}.xlsx`;
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};

  const summaryRows = [
    { field: "exportedAt", value: clean(payload?.exportedAt) },
    { field: "source", value: clean(payload?.source) },
    { field: "resource", value: clean(payload?.resource) }
  ];

  for (const [tableName, count] of Object.entries(payload?.counts || {})) {
    summaryRows.push({
      field: `${tableName}_count`,
      value: count
    });
  }

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, sanitizeSheetName("summary", usedNames));

  for (const [tableName, rows] of Object.entries(data)) {
    const safeRows = Array.isArray(rows) ? rows.map((row) => enrichRowForExcel(tableName, row)) : [];
    const headers = collectSheetHeaders(safeRows);
    const aoa = [headers];

    for (const row of safeRows) {
      aoa.push(headers.map((header) => normalizeCellValue(row?.[header])));
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [[]]);
    XLSX.utils.book_append_sheet(workbook, sheet, sanitizeSheetName(tableName, usedNames));
  }

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true
  });

  return {
    filename,
    buffer
  };
}

function buildSummaryText(payload) {
  const exportedAt = clean(payload?.exportedAt) || new Date().toISOString();
  const counts = formatCountLines(payload);
  return [
    "גיבוי שבועי של מערכת ה-CRM מוכן.",
    `זמן יצוא: ${exportedAt}`,
    "",
    "טבלאות שנכללו:",
    counts || "- ללא רשומות"
  ].join("\n");
}

export function assertCronAuthorized(request) {
  const secret = clean(process.env.CRON_SECRET);
  if (!secret) {
    throw new Error("Missing CRON_SECRET env variable.");
  }
  return clean(request.headers.get("authorization")) === `Bearer ${secret}`;
}

function currentJobKey() {
  return new Date().toISOString().slice(0, 10);
}

async function claimJobRun(jobName, jobKey) {
  await initDb();
  const rows = await sql`
    INSERT INTO scheduled_job_runs (job_name, job_key, status)
    VALUES (${jobName}, ${jobKey}, 'started')
    ON CONFLICT (job_name, job_key) DO UPDATE
    SET
      status = 'started',
      details_json = '{}'::jsonb,
      started_at = NOW(),
      completed_at = NULL
    WHERE scheduled_job_runs.status = 'failed'
      OR (
        scheduled_job_runs.status = 'started'
        AND scheduled_job_runs.started_at < NOW() - INTERVAL '10 minutes'
      )
    RETURNING job_name
  `;
  return rows.length > 0;
}

async function finalizeJobRun(jobName, jobKey, status, details = {}) {
  await sql`
    UPDATE scheduled_job_runs
    SET
      status = ${status},
      details_json = ${JSON.stringify(details)}::jsonb,
      completed_at = NOW()
    WHERE job_name = ${jobName}
      AND job_key = ${jobKey}
  `;
}

async function listWeeklyBackupRecipients() {
  await initDb();
  return sql`
    SELECT
      u.clerk_user_id,
      u.display_name,
      u.email,
      u.weekly_backup_enabled,
      u.weekly_backup_delivery,
      t.telegram_chat_id,
      t.telegram_username
    FROM app_users u
    LEFT JOIN telegram_user_links t
      ON t.clerk_user_id = u.clerk_user_id
      AND t.is_active = TRUE
    WHERE LOWER(COALESCE(u.role, '')) = 'super_admin'
      AND COALESCE(u.weekly_backup_enabled, FALSE) = TRUE
    ORDER BY u.created_at ASC
  `;
}

function resolveChannels(recipient) {
  const delivery = clean(recipient.weekly_backup_delivery).toLowerCase();
  if (delivery === "both") return ["email", "telegram"];
  if (delivery === "email") return ["email"];
  if (delivery === "telegram") return recipient.telegram_chat_id ? ["telegram"] : ["email"];
  return recipient.telegram_chat_id ? ["telegram"] : ["email"];
}

async function deliverBackupToRecipient(recipient, backupFile, summaryText, subject) {
  const channels = resolveChannels(recipient);
  const delivered = [];
  const skipped = [];
  const files = [
    {
      filename: backupFile.json.filename,
      buffer: backupFile.json.buffer,
      contentType: "application/json"
    },
    {
      filename: backupFile.excel.filename,
      buffer: backupFile.excel.buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  ];

  for (const channel of channels) {
    if (channel === "email") {
      const to = clean(recipient.email);
      if (!to) {
        skipped.push("email");
        continue;
      }
      await sendResendEmail({
        to,
        subject,
        text: summaryText,
        html: `<div dir="rtl" lang="he"><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(summaryText)}</pre></div>`,
        attachments: files.map((file) => ({
          filename: file.filename,
          content: file.buffer.toString("base64")
        }))
      });
      delivered.push("email");
      continue;
    }

    if (channel === "telegram") {
      const chatId = clean(recipient.telegram_chat_id);
      if (!chatId) {
        skipped.push("telegram");
        continue;
      }
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        await sendTelegramDocumentFile(
          chatId,
          {
            filename: file.filename,
            content: file.buffer,
            contentType: file.contentType
          },
          i === 0
            ? { caption: summaryText }
            : {}
        );
      }
      delivered.push("telegram");
    }
  }

  return { delivered, skipped };
}

export async function runWeeklyBackupJob({ force = false } = {}) {
  const jobName = "weekly_backup_delivery";
  const jobKey = force ? `manual-${new Date().toISOString()}` : currentJobKey();

  const claimed = await claimJobRun(jobName, jobKey);
  if (!claimed) {
    return {
      ok: true,
      skipped: true,
      reason: "already_ran_today",
      jobKey
    };
  }

  const payload = await exportCrmData("all");
  const backupFile = {
    json: buildJsonBackupFile(payload),
    excel: buildExcelBackupFile(payload)
  };
  const summaryText = buildSummaryText(payload);
  const subject = `גיבוי שבועי CRM - ${clean(payload.exportedAt).slice(0, 10) || jobKey}`;
  const recipients = await listWeeklyBackupRecipients();
  const results = [];

  try {
    for (const recipient of recipients) {
      const delivery = await deliverBackupToRecipient(recipient, backupFile, summaryText, subject);
      results.push({
        clerk_user_id: recipient.clerk_user_id,
        display_name: clean(recipient.display_name),
        email: clean(recipient.email),
        delivered: delivery.delivered,
        skipped: delivery.skipped
      });
    }

    await finalizeJobRun(jobName, jobKey, "completed", {
      recipients: results,
      counts: payload.counts
    });

    return {
      ok: true,
      skipped: false,
      jobKey,
      exportedAt: payload.exportedAt,
      counts: payload.counts,
      recipients: results
    };
  } catch (error) {
    await finalizeJobRun(jobName, jobKey, "failed", {
      message: error?.message || "Weekly backup delivery failed"
    });
    throw error;
  }
}
