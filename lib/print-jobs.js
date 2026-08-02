import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  ackPrintQueueMessage,
  isPrintQueueConfigured,
  publishPrintJobToQueue,
  pullPrintJobFromQueue,
  retryPrintQueueMessage
} from "./cloudflare-queue";
import { initDb, sql } from "./db";
import { deleteObjectFromR2, getObjectBytesFromR2, isR2Configured, uploadBufferToR2 } from "./r2";
import { buildResendFromAddress, sendResendEmail } from "./resend";

export const MAX_PRINT_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_PRINT_COPIES = 99;
export const DEFAULT_PRINT_PLAN = "booklet";
export const DEFAULT_OUTPUT_MODE = "print";
export const PRINT_CREDIT_PACKAGES = [
  { key: "10", pages: 10, amountAgorot: 400, label: "10 דפים", priceLabel: "4 ש״ח" },
  { key: "20", pages: 20, amountAgorot: 800, label: "20 דפים", priceLabel: "8 ש״ח" },
  { key: "40", pages: 40, amountAgorot: 1600, label: "40 דפים", priceLabel: "16 ש״ח" }
];
export const PRINT_PLAN_LABELS = {
  booklet: "חוברת A3, מימין לשמאל, קיפול/הידוק",
  duplex: "A4 רגיל דו-צדדי",
  "corner-staple": "A4 רגיל, מימין לשמאל, הידוק פינה ימנית עליונה",
  "convert-pdf": "המרת קובץ ל-PDF"
};
export const OUTPUT_MODE_LABELS = {
  email: "שליחה במייל בלבד",
  print: "הדפסה"
};

function clean(value) {
  return String(value || "").trim();
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizePrintPlan(value) {
  const plan = clean(value);
  if (plan === "corner-staple-rtl") return "corner-staple";
  if (["booklet", "duplex", "corner-staple", "convert-pdf"].includes(plan)) return plan;
  return DEFAULT_PRINT_PLAN;
}

export function printPlanLabel(value) {
  const plan = normalizePrintPlan(value);
  return PRINT_PLAN_LABELS[plan] || PRINT_PLAN_LABELS[DEFAULT_PRINT_PLAN];
}

export function normalizeOutputMode(value) {
  const mode = clean(value);
  if (["email", "print"].includes(mode)) return mode;
  return DEFAULT_OUTPUT_MODE;
}

export function outputModeLabel(value) {
  const mode = normalizeOutputMode(value);
  return OUTPUT_MODE_LABELS[mode] || OUTPUT_MODE_LABELS[DEFAULT_OUTPUT_MODE];
}

function mapPrintJobRow(row, { includeFile = false } = {}) {
  if (!row) return null;
  return {
    id: clean(row.id),
    fileName: clean(row.file_name),
    contentType: clean(row.content_type) || "application/octet-stream",
    fileSizeBytes: Number(row.file_size_bytes || 0),
    outputMode: normalizeOutputMode(row.output_mode),
    outputModeLabel: outputModeLabel(row.output_mode),
    sourceType: clean(row.source_type),
    sourceId: clean(row.source_id),
    sourceMetadata: parseJson(row.source_metadata_json, {}),
    copies: Math.max(1, Math.min(MAX_PRINT_COPIES, Number(row.copies || 1) || 1)),
    printPlan: normalizePrintPlan(row.print_plan),
    printPlanLabel: printPlanLabel(row.print_plan),
    pageCount: Number(row.page_count || 0) || null,
    printedPageCount: Number(row.printed_page_count || 0) || null,
    creditPagesCharged: Number(row.credit_pages_charged || 0),
    fileStorage: clean(row.file_storage) || (clean(row.r2_object_key) ? "r2" : "neon"),
    r2ObjectKey: clean(row.r2_object_key),
    queuePublishedAt: row.queue_published_at || null,
    queuePublishError: clean(row.queue_publish_error),
    queueMessageId: clean(row.queue_message_id),
    queueLeaseId: clean(row.queue_lease_id),
    queueLeaseClaimedAt: row.queue_lease_claimed_at || null,
    queueAcknowledgedAt: row.queue_acknowledged_at || null,
    queueAckError: clean(row.queue_ack_error),
    fileBase64Length: Number(row.file_base64_length || (includeFile ? clean(row.file_base64).length : 0)),
    ...(includeFile ? { fileBase64: clean(row.file_base64) } : {}),
    status: clean(row.status) || "pending",
    uploadedByUserId: clean(row.uploaded_by_user_id),
    uploadedByDisplayName: clean(row.uploaded_by_display_name) || clean(row.uploaded_by_user_id) || "לא ידוע",
    uploadedByEmail: clean(row.uploaded_by_email),
    claimedByTokenId: clean(row.claimed_by_token_id),
    claimedAt: row.claimed_at || null,
    completedAt: row.completed_at || null,
    receiptSentAt: row.receipt_sent_at || null,
    receiptEmailId: clean(row.receipt_email_id),
    receiptError: clean(row.receipt_error),
    createdAt: row.created_at || null
  };
}

export function canUsePrintQueue(user) {
  return Boolean(user?.can_use_print_queue || user?.is_team_member || user?.is_manager || user?.is_super_admin || user?.is_print_only || user?.is_marei_mekomot);
}

export function hasUnlimitedPrintCredit(user) {
  return canUsePrintQueue(user);
}

export function canAccessPrintFeature(user) {
  return Boolean(user?.clerk_user_id);
}

export function printCreditPurchaseMessage() {
  return [
    "אין לך מספיק קרדיט הדפסה.",
    "אפשר לקנות חבילת הדפסה:",
    ...PRINT_CREDIT_PACKAGES.map((pack) => `${pack.priceLabel} עבור ${pack.pages} דפים`)
  ].join("\n");
}

export function estimatePrintCreditPages({ pageCount, copies = 1, printPlan = DEFAULT_PRINT_PLAN } = {}) {
  const safePageCount = Math.max(1, Math.floor(Number(pageCount || 1) || 1));
  const safeCopies = normalizeCopies(copies);
  const plan = normalizePrintPlan(printPlan);
  const extraPerCopy = plan === "corner-staple" ? 1 : plan === "booklet" ? 2 : 0;
  return (safePageCount + extraPerCopy) * safeCopies;
}

function buildPrintJobObjectKey(id, fileName) {
  const safeName = clean(fileName).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120) || "print-job";
  return `print-jobs/${id}/${safeName}`;
}

async function storePrintJobFile({ id, buffer, fileName, contentType }) {
  if (!isR2Configured()) {
    return {
      fileStorage: "neon",
      r2ObjectKey: "",
      fileBase64: buffer.toString("base64")
    };
  }

  const objectKey = buildPrintJobObjectKey(id, fileName);
  await uploadBufferToR2({
    key: objectKey,
    buffer,
    contentType,
    contentDisposition: `attachment; filename="${clean(fileName).replace(/"/g, "_")}"`
  });
  return {
    fileStorage: "r2",
    r2ObjectKey: objectKey,
    fileBase64: ""
  };
}

async function publishPrintJobQueueMessage(id) {
  try {
    const result = await publishPrintJobToQueue(id);
    if (result?.skipped) return;
    await sql`
      UPDATE print_jobs
      SET queue_published_at = NOW(), queue_publish_error = ''
      WHERE id = ${clean(id)}
    `;
  } catch (error) {
    await sql`
      UPDATE print_jobs
      SET queue_publish_error = ${clean(error?.message) || "Cloudflare Queue publish failed"}
      WHERE id = ${clean(id)}
    `;
  }
}

export async function getPrintCreditBalance(userId) {
  await initDb();
  const normalizedUserId = clean(userId);
  if (!normalizedUserId) return 0;
  await sql`
    INSERT INTO print_credit_accounts (user_id, balance_pages)
    VALUES (${normalizedUserId}, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
  const rows = await sql`
    SELECT balance_pages
    FROM print_credit_accounts
    WHERE user_id = ${normalizedUserId}
    LIMIT 1
  `;
  return Math.max(0, Number(rows[0]?.balance_pages || 0));
}

export async function listPrintCreditTransactions(userId, { limit = 20 } = {}) {
  await initDb();
  const normalizedUserId = clean(userId);
  if (!normalizedUserId) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = await sql`
    SELECT id, user_id, delta_pages, balance_after, reason, amount_agorot, package_key, print_job_id, metadata, created_by_user_id, created_at
    FROM print_credit_transactions
    WHERE user_id = ${normalizedUserId}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    id: clean(row.id),
    userId: clean(row.user_id),
    deltaPages: Number(row.delta_pages || 0),
    balanceAfter: Number(row.balance_after || 0),
    reason: clean(row.reason),
    amountAgorot: Number(row.amount_agorot || 0),
    packageKey: clean(row.package_key),
    printJobId: clean(row.print_job_id),
    metadata: row.metadata || {},
    createdByUserId: clean(row.created_by_user_id),
    createdAt: row.created_at || null
  }));
}

export async function addPrintCreditPackage({ userId, packageKey, createdByUserId = "", metadata = {}, transactionId = "" } = {}) {
  await initDb();
  const normalizedUserId = clean(userId);
  const pack = PRINT_CREDIT_PACKAGES.find((item) => item.key === clean(packageKey));
  if (!normalizedUserId || !pack) throw new Error("חבילת הדפסה לא תקינה.");
  await sql`
    INSERT INTO print_credit_accounts (user_id, balance_pages)
    VALUES (${normalizedUserId}, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
  const creditTransactionId = clean(transactionId) || crypto.randomUUID();
  const rows = await sql`
    WITH existing AS (
      SELECT id
      FROM print_credit_transactions
      WHERE id = ${creditTransactionId}
      LIMIT 1
    ),
    updated_account AS (
      UPDATE print_credit_accounts
      SET
        balance_pages = balance_pages + ${pack.pages},
        updated_at = NOW()
      WHERE user_id = ${normalizedUserId}
        AND NOT EXISTS (SELECT 1 FROM existing)
      RETURNING balance_pages
    ),
    inserted_transaction AS (
      INSERT INTO print_credit_transactions (
        id,
        user_id,
        delta_pages,
        balance_after,
        reason,
        amount_agorot,
        package_key,
        metadata,
        created_by_user_id
      )
      SELECT
        ${creditTransactionId},
        ${normalizedUserId},
        ${pack.pages},
        balance_pages,
        'purchase',
        ${pack.amountAgorot},
        ${pack.key},
        ${metadata || {}},
        ${clean(createdByUserId) || null}
      FROM updated_account
      RETURNING id, balance_after
    )
    SELECT
      COALESCE(
        (SELECT balance_after FROM inserted_transaction),
        (SELECT balance_pages FROM print_credit_accounts WHERE user_id = ${normalizedUserId}),
        0
      ) AS balance_after,
      EXISTS (SELECT 1 FROM inserted_transaction) AS inserted
  `;
  const balanceAfter = Math.max(0, Number(rows[0]?.balance_after || 0));
  const inserted = rows[0]?.inserted === true;
  return { ...pack, balanceAfter, transactionId: creditTransactionId, alreadyApplied: !inserted };
}

async function debitPrintCredit({ userId, pages, printJobId = "", metadata = {} } = {}) {
  const normalizedUserId = clean(userId);
  const debitPages = Math.max(0, Math.floor(Number(pages || 0)));
  if (!normalizedUserId || debitPages <= 0) return { chargedPages: 0, balanceAfter: await getPrintCreditBalance(normalizedUserId) };
  await sql`
    INSERT INTO print_credit_accounts (user_id, balance_pages)
    VALUES (${normalizedUserId}, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
  const rows = await sql`
    UPDATE print_credit_accounts
    SET
      balance_pages = balance_pages - ${debitPages},
      updated_at = NOW()
    WHERE user_id = ${normalizedUserId}
      AND balance_pages >= ${debitPages}
    RETURNING balance_pages
  `;
  if (!rows.length) {
    const balance = await getPrintCreditBalance(normalizedUserId);
    throw new Error(`${printCreditPurchaseMessage()}\nיתרה נוכחית: ${balance} דפים. נדרשים: ${debitPages} דפים.`);
  }
  const balanceAfter = Math.max(0, Number(rows[0]?.balance_pages || 0));
  await sql`
    INSERT INTO print_credit_transactions (
      id,
      user_id,
      delta_pages,
      balance_after,
      reason,
      print_job_id,
      metadata
    )
    VALUES (
      ${crypto.randomUUID()},
      ${normalizedUserId},
      ${-debitPages},
      ${balanceAfter},
      'print',
      ${clean(printJobId) || null},
      ${metadata || {}}
    )
  `;
  return { chargedPages: debitPages, balanceAfter };
}

function normalizeCopies(value) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(MAX_PRINT_COPIES, Math.floor(numeric)));
}

function isImageContentType(contentType) {
  return clean(contentType).toLowerCase().startsWith("image/");
}

async function countDocumentPages(buffer, contentType, fileName) {
  const type = clean(contentType).toLowerCase();
  const name = clean(fileName).toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    try {
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return Math.max(1, pdf.getPageCount());
    } catch {
      return null;
    }
  }
  if (isImageContentType(type)) return 1;
  return null;
}

export async function createPrintJob({ file, copies = 1, printPlan = DEFAULT_PRINT_PLAN, uploadedByUserId, user = null }) {
  await initDb();
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("יש לבחור קובץ להדפסה.");
  }

  const fileName = clean(file.name);
  const contentType = clean(file.type) || "application/octet-stream";
  const fileSizeBytes = Number(file.size || 0);
  const normalizedCopies = normalizeCopies(copies);
  if (!fileName) throw new Error("שם הקובץ חסר.");
  if (!fileSizeBytes) throw new Error("הקובץ ריק.");
  if (fileSizeBytes > MAX_PRINT_FILE_BYTES) {
    throw new Error("אפשר לשלוח להדפסה קבצים עד 30MB.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return createPrintJobFromBuffer({
    buffer,
    fileName,
    contentType,
    copies: normalizedCopies,
    printPlan,
    uploadedByUserId,
    user
  });
}

export async function createPrintJobFromBuffer({
  buffer,
  fileName,
  contentType = "application/octet-stream",
  outputMode = DEFAULT_OUTPUT_MODE,
  sourceType = "",
  sourceId = "",
  sourceMetadata = {},
  copies = 1,
  printPlan = DEFAULT_PRINT_PLAN,
  uploadedByUserId,
  user = null
}) {
  await initDb();
  const normalizedBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const normalizedFileName = clean(fileName);
  const normalizedContentType = clean(contentType) || "application/octet-stream";
  const fileSizeBytes = normalizedBuffer.length;
  const normalizedOutputMode = normalizeOutputMode(outputMode);
  const normalizedCopies = normalizeCopies(copies);
  const normalizedPrintPlan = normalizePrintPlan(printPlan);
  if (!normalizedFileName) throw new Error("שם הקובץ חסר.");
  if (!fileSizeBytes) throw new Error("הקובץ ריק.");
  if (fileSizeBytes > MAX_PRINT_FILE_BYTES) {
    throw new Error("אפשר לשלוח להדפסה קבצים עד 30MB.");
  }

  const pageCount = await countDocumentPages(normalizedBuffer, normalizedContentType, normalizedFileName);
  const creditPages = normalizedOutputMode !== "print" || hasUnlimitedPrintCredit(user)
    ? 0
    : estimatePrintCreditPages({ pageCount, copies: normalizedCopies, printPlan: normalizedPrintPlan });
  const id = crypto.randomUUID();

  if (creditPages > 0) {
    await debitPrintCredit({
      userId: uploadedByUserId,
      pages: creditPages,
      metadata: {
        printJobId: id,
        fileName: normalizedFileName,
        pageCount: pageCount || 1,
        copies: normalizedCopies,
        printPlan: normalizedPrintPlan
      }
    });
  }

  const storedFile = await storePrintJobFile({
    id,
    buffer: normalizedBuffer,
    fileName: normalizedFileName,
    contentType: normalizedContentType
  });

  await sql`
    INSERT INTO print_jobs (
      id,
      file_name,
      content_type,
      file_size_bytes,
      output_mode,
      source_type,
      source_id,
      source_metadata_json,
      copies,
      print_plan,
      page_count,
      credit_pages_charged,
      file_base64,
      file_storage,
      r2_object_key,
      status,
      uploaded_by_user_id,
      created_at
    )
    VALUES (
      ${id},
      ${normalizedFileName},
      ${normalizedContentType},
      ${fileSizeBytes},
      ${normalizedOutputMode},
      ${clean(sourceType)},
      ${clean(sourceId)},
      ${JSON.stringify(sourceMetadata && typeof sourceMetadata === "object" ? sourceMetadata : {})}::jsonb,
      ${normalizedCopies},
      ${normalizedPrintPlan},
      ${pageCount},
      ${creditPages},
      ${storedFile.fileBase64},
      ${storedFile.fileStorage},
      ${storedFile.r2ObjectKey || null},
      'pending',
      ${clean(uploadedByUserId) || null},
      NOW()
    )
  `;

  await publishPrintJobQueueMessage(id);
  return getPrintJobById(id);
}

export async function getPrintJobById(id, { includeFile = false } = {}) {
  await initDb();
  const rows = await sql`
    SELECT
      p.id,
      p.file_name,
      p.content_type,
      p.file_size_bytes,
      p.output_mode,
      p.source_type,
      p.source_id,
      p.source_metadata_json,
      p.copies,
      p.print_plan,
      p.page_count,
      p.printed_page_count,
      p.credit_pages_charged,
      p.file_base64,
      p.file_storage,
      p.r2_object_key,
      p.queue_published_at,
      p.queue_publish_error,
      p.queue_message_id,
      p.queue_lease_id,
      p.queue_lease_claimed_at,
      p.queue_acknowledged_at,
      p.queue_ack_error,
      LENGTH(p.file_base64) AS file_base64_length,
      p.status,
      p.uploaded_by_user_id,
      p.claimed_by_token_id,
      p.claimed_at,
      p.completed_at,
      p.receipt_sent_at,
      p.receipt_email_id,
      p.receipt_error,
      p.created_at,
      u.display_name AS uploaded_by_display_name,
      u.email AS uploaded_by_email
    FROM print_jobs p
    LEFT JOIN app_users u
      ON u.clerk_user_id = p.uploaded_by_user_id
    WHERE p.id = ${clean(id)}
    LIMIT 1
  `;
  return mapPrintJobRow(rows[0] || null, { includeFile });
}

export async function listPrintJobs({ limit = 30 } = {}) {
  await initDb();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const rows = await sql`
    SELECT
      p.id,
      p.file_name,
      p.content_type,
      p.file_size_bytes,
      p.output_mode,
      p.source_type,
      p.source_id,
      p.source_metadata_json,
      p.copies,
      p.print_plan,
      p.page_count,
      p.printed_page_count,
      p.credit_pages_charged,
      p.file_storage,
      p.r2_object_key,
      p.queue_published_at,
      p.queue_publish_error,
      p.queue_message_id,
      p.queue_lease_id,
      p.queue_lease_claimed_at,
      p.queue_acknowledged_at,
      p.queue_ack_error,
      LENGTH(p.file_base64) AS file_base64_length,
      p.status,
      p.uploaded_by_user_id,
      p.claimed_by_token_id,
      p.claimed_at,
      p.completed_at,
      p.receipt_sent_at,
      p.receipt_email_id,
      p.receipt_error,
      p.created_at,
      u.display_name AS uploaded_by_display_name,
      u.email AS uploaded_by_email
    FROM print_jobs p
    LEFT JOIN app_users u
      ON u.clerk_user_id = p.uploaded_by_user_id
    ORDER BY p.created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => mapPrintJobRow(row)).filter(Boolean);
}

export async function claimNextPrintJob({ claimedByTokenId }) {
  await initDb();
  const rows = await sql`
    WITH next_job AS (
      SELECT id
      FROM print_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE print_jobs
    SET
      status = 'claimed',
      claimed_by_token_id = ${clean(claimedByTokenId) || null},
      claimed_at = NOW()
    FROM next_job
    WHERE print_jobs.id = next_job.id
    RETURNING print_jobs.id
  `;

  const id = clean(rows?.[0]?.id);
  return id ? getPrintJobById(id) : null;
}

export async function claimPrintJobById(id, { claimedByTokenId, queueLeaseId = "", queueMessageId = "" } = {}) {
  await initDb();
  const normalizedId = clean(id);
  const normalizedTokenId = clean(claimedByTokenId);
  const normalizedQueueLeaseId = clean(queueLeaseId);
  const normalizedQueueMessageId = clean(queueMessageId);
  if (!normalizedId) throw new Error("Missing print job id.");
  const rows = await sql`
    UPDATE print_jobs
    SET
      status = 'claimed',
      claimed_by_token_id = ${normalizedTokenId || null},
      claimed_at = COALESCE(claimed_at, NOW()),
      queue_lease_id = COALESCE(NULLIF(${normalizedQueueLeaseId}, ''), queue_lease_id),
      queue_message_id = COALESCE(NULLIF(${normalizedQueueMessageId}, ''), queue_message_id),
      queue_lease_claimed_at = CASE
        WHEN ${normalizedQueueLeaseId} <> '' THEN NOW()
        ELSE queue_lease_claimed_at
      END,
      queue_ack_error = CASE
        WHEN ${normalizedQueueLeaseId} <> '' THEN ''
        ELSE queue_ack_error
      END
    WHERE id = ${normalizedId}
      AND (
        status = 'pending'
        OR (
          status = 'claimed'
          AND (${normalizedTokenId} = '' OR claimed_by_token_id = ${normalizedTokenId})
        )
      )
    RETURNING id
  `;
  const claimedId = clean(rows?.[0]?.id);
  return claimedId ? getPrintJobById(claimedId) : null;
}

export async function claimNextPrintJobViaQueue({ claimedByTokenId } = {}) {
  if (!isPrintQueueConfigured()) return { configured: false, job: null };
  await initDb();

  const message = await pullPrintJobFromQueue({ batchSize: 1, visibilityTimeoutMs: 30 * 60 * 1000 });
  if (!message) return { configured: true, job: null };

  if (!message.jobId) {
    if (message.leaseId) await ackPrintQueueMessage(message.leaseId).catch(() => null);
    return { configured: true, job: null };
  }

  try {
    const job = await claimPrintJobById(message.jobId, {
      claimedByTokenId,
      queueLeaseId: message.leaseId,
      queueMessageId: message.messageId
    });

    if (!job) {
      if (message.leaseId) await ackPrintQueueMessage(message.leaseId).catch(() => null);
      return { configured: true, job: null };
    }

    return { configured: true, job };
  } catch (error) {
    if (message.leaseId) await retryPrintQueueMessage(message.leaseId).catch(() => null);
    throw error;
  }
}

async function acknowledgePrintJobQueueMessage(job) {
  if (!job?.queueLeaseId || job.queueAcknowledgedAt) return;
  try {
    const result = await ackPrintQueueMessage(job.queueLeaseId);
    if (result?.skipped) return;
    await sql`
      UPDATE print_jobs
      SET queue_acknowledged_at = NOW(), queue_ack_error = ''
      WHERE id = ${job.id}
    `;
  } catch (error) {
    await sql`
      UPDATE print_jobs
      SET queue_ack_error = ${clean(error?.message) || "Cloudflare Queue ack failed"}
      WHERE id = ${job.id}
    `;
  }
}

export async function deletePrintJob(id) {
  await initDb();
  const normalizedId = clean(id);
  if (!normalizedId) throw new Error("Missing print job id.");
  const job = await getPrintJobById(normalizedId);
  const fallbackPrintedPageCount = job?.pageCount ? job.pageCount * Math.max(1, Number(job.copies || 1)) : null;
  await sql`
    UPDATE print_jobs
    SET
      status = 'completed',
      printed_page_count = COALESCE(printed_page_count, ${fallbackPrintedPageCount}),
      file_base64 = '',
      completed_at = NOW()
    WHERE id = ${normalizedId}
      AND status <> 'completed'
  `;
  if (job?.fileStorage === "r2" && job.r2ObjectKey) {
    await deleteObjectFromR2(job.r2ObjectKey).catch(() => false);
  }
  await acknowledgePrintJobQueueMessage(job);
}

export async function completePrintJob(id, { printedPageCount } = {}) {
  await initDb();
  const normalizedId = clean(id);
  if (!normalizedId) throw new Error("Missing print job id.");
  const job = await getPrintJobById(normalizedId);
  const explicitPrintedPageCount = Number(printedPageCount || 0);
  const fallbackPrintedPageCount = job?.pageCount ? job.pageCount * Math.max(1, Number(job.copies || 1)) : null;
  const finalPrintedPageCount = explicitPrintedPageCount > 0
    ? Math.max(1, Math.floor(explicitPrintedPageCount))
    : fallbackPrintedPageCount;

  await sql`
    UPDATE print_jobs
    SET
      status = 'completed',
      printed_page_count = ${finalPrintedPageCount},
      file_base64 = '',
      completed_at = NOW()
    WHERE id = ${normalizedId}
      AND status <> 'completed'
  `;
  if (job?.fileStorage === "r2" && job.r2ObjectKey) {
    await deleteObjectFromR2(job.r2ObjectKey).catch(() => false);
  }
  await acknowledgePrintJobQueueMessage(job);
}

export async function getPrintJobFileChunk(id, { offset = 0, length = 1000000, claimedByTokenId = "" } = {}) {
  await initDb();
  const normalizedId = clean(id);
  if (!normalizedId) throw new Error("Missing print job id.");
  const normalizedClaimedByTokenId = clean(claimedByTokenId);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLength = Math.max(4, Math.min(1200000, Number(length) || 1000000));
  const rows = await sql`
    SELECT
      file_storage,
      r2_object_key,
      SUBSTRING(file_base64 FROM ${safeOffset + 1} FOR ${safeLength}) AS chunk,
      LENGTH(file_base64) AS total_length
    FROM print_jobs
    WHERE id = ${normalizedId}
      AND status = 'claimed'
      AND (
        ${normalizedClaimedByTokenId} = ''
        OR claimed_by_token_id = ${normalizedClaimedByTokenId}
      )
    LIMIT 1
  `;
  const row = rows?.[0] || null;
  if (!row) return null;

  let chunk = clean(row.chunk);
  let totalLength = Number(row.total_length || 0);
  if (clean(row.file_storage) === "r2" && clean(row.r2_object_key)) {
    const object = await getObjectBytesFromR2(row.r2_object_key);
    const fileBase64 = Buffer.from(object.bytes).toString("base64");
    chunk = fileBase64.slice(safeOffset, safeOffset + safeLength);
    totalLength = fileBase64.length;
  }

  const nextOffset = safeOffset + chunk.length;
  return {
    id: normalizedId,
    offset: safeOffset,
    nextOffset,
    length: chunk.length,
    totalLength,
    done: nextOffset >= totalLength,
    chunk
  };
}

export async function getPrintJobFile(id, { claimedByTokenId = "" } = {}) {
  await initDb();
  const normalizedId = clean(id);
  if (!normalizedId) throw new Error("Missing print job id.");
  const normalizedClaimedByTokenId = clean(claimedByTokenId);
  const rows = await sql`
    SELECT id, file_name, content_type, file_base64, file_storage, r2_object_key, LENGTH(file_base64) AS total_length
    FROM print_jobs
    WHERE id = ${normalizedId}
      AND status = 'claimed'
      AND (
        ${normalizedClaimedByTokenId} = ''
        OR claimed_by_token_id = ${normalizedClaimedByTokenId}
      )
    LIMIT 1
  `;
  const row = rows?.[0] || null;
  if (!row) return null;
  if (clean(row.file_storage) === "r2" && clean(row.r2_object_key)) {
    const object = await getObjectBytesFromR2(row.r2_object_key);
    const fileBase64 = Buffer.from(object.bytes).toString("base64");
    return {
      id: normalizedId,
      fileName: clean(row.file_name) || "print-job",
      contentType: clean(row.content_type) || clean(object.contentType) || "application/octet-stream",
      fileBase64,
      totalLength: fileBase64.length
    };
  }
  return {
    id: normalizedId,
    fileName: clean(row.file_name) || "print-job",
    contentType: clean(row.content_type) || "application/octet-stream",
    fileBase64: clean(row.file_base64),
    totalLength: Number(row.total_length || 0)
  };
}

export async function sendPrintJobReceiptEmail(jobId) {
  const job = await getPrintJobById(jobId);
  if (job?.outputMode === "email") return null;
  if (!job || job.receiptSentAt || !job.uploadedByEmail) return null;
  const file = await getPrintJobFile(job.id);
  if (!file?.fileBase64) return null;

  const pageText = job.pageCount ? `${job.pageCount}` : "לא זוהתה";
  const totalText = job.creditPagesCharged
    ? `${job.creditPagesCharged}`
    : job.pageCount
      ? `${estimatePrintCreditPages({ pageCount: job.pageCount, copies: job.copies, printPlan: job.printPlan })}`
      : "לא זוהתה";
  const text = [
    "הדפסה נקלטה בהצלחה בשרת המקומי.",
    "",
    `קובץ: ${job.fileName}`,
    `סוג הדפסה: ${job.printPlanLabel}`,
    `עותקים: ${job.copies}`,
    `עמודים במסמך: ${pageText}`,
    `סה\"כ עמודי הדפסה לחיוב/כרטיסיה: ${totalText}`,
    `נשלח על ידי: ${job.uploadedByDisplayName}`
  ].join("\n");
  const html = `
    <div dir="rtl" lang="he" style="font-family:Arial,sans-serif;line-height:1.7;color:#10243f">
      <h2 style="margin:0 0 12px">הדפסה נקלטה בהצלחה</h2>
      <p>השרת המקומי קיבל את קובץ ההדפסה.</p>
      <ul>
        <li><b>קובץ:</b> ${escapeHtml(job.fileName)}</li>
        <li><b>סוג הדפסה:</b> ${escapeHtml(job.printPlanLabel)}</li>
        <li><b>עותקים:</b> ${job.copies}</li>
        <li><b>עמודים במסמך:</b> ${escapeHtml(pageText)}</li>
        <li><b>סה"כ עמודי הדפסה:</b> ${escapeHtml(totalText)}</li>
      </ul>
      <p>הקובץ המקורי מצורף למייל הזה.</p>
    </div>
  `;

  try {
    const result = await sendResendEmail({
      to: job.uploadedByEmail,
      from: buildResendFromAddress("מערכת הדפסות"),
      subject: `הדפסה נקלטה: ${job.fileName}`,
      text,
      html,
      attachments: [{
        filename: job.fileName,
        content: file.fileBase64
      }],
      idempotencyKey: `print-job-receipt-${job.id}`
    });
    await sql`
      UPDATE print_jobs
      SET
        receipt_sent_at = NOW(),
        receipt_email_id = ${clean(result?.id)},
        receipt_error = ''
      WHERE id = ${job.id}
    `;
    return result;
  } catch (error) {
    await sql`
      UPDATE print_jobs
      SET receipt_error = ${clean(error?.message) || "שליחת מייל אישור נכשלה"}
      WHERE id = ${job.id}
    `;
    return null;
  }
}

export async function listPrintUsageByUser({ limit = 50 } = {}) {
  await initDb();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await sql`
    SELECT
      p.uploaded_by_user_id,
      COALESCE(u.display_name, p.uploaded_by_user_id, 'לא ידוע') AS uploaded_by_display_name,
      COALESCE(u.email, '') AS uploaded_by_email,
      COUNT(*)::int AS jobs_count,
      COUNT(*) FILTER (WHERE p.status = 'completed')::int AS completed_jobs_count,
      COALESCE(SUM(COALESCE(NULLIF(p.credit_pages_charged, 0), p.printed_page_count, p.page_count * p.copies, 0)), 0)::int AS total_print_pages
    FROM print_jobs p
    LEFT JOIN app_users u
      ON u.clerk_user_id = p.uploaded_by_user_id
    GROUP BY p.uploaded_by_user_id, u.display_name, u.email
    ORDER BY total_print_pages DESC, jobs_count DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    uploadedByUserId: clean(row.uploaded_by_user_id),
    uploadedByDisplayName: clean(row.uploaded_by_display_name),
    uploadedByEmail: clean(row.uploaded_by_email),
    jobsCount: Number(row.jobs_count || 0),
    completedJobsCount: Number(row.completed_jobs_count || 0),
    totalPrintPages: Number(row.total_print_pages || 0)
  }));
}
