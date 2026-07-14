import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import { listAppUsers } from "./rbac";
import { getStudentTagsByStudentIds } from "./student-tags";

export const TASK_STATUS_OPTIONS = [
  { value: "pending", label: "ממתין" },
  { value: "in_progress", label: "בתהליך" },
  { value: "done", label: "בוצע" }
];

export const TASK_LINK_TYPES = [
  { value: "student", label: "תלמיד" },
  { value: "payment_mandate", label: "הוראת קבע בעייתית" }
];

function clean(value) {
  return String(value || "").trim();
}

function normalizeTagName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function hasOfficeLabel(user) {
  const labels = [
    ...(Array.isArray(user?.staff_labels) ? user.staff_labels : []),
    ...(Array.isArray(user?.tagNames) ? user.tagNames : []),
    ...(Array.isArray(user?.tags) ? user.tags.map((tag) => tag?.name) : [])
  ];
  return labels.some((label) => normalizeTagName(label) === "משרד");
}

function normalizeStatus(value) {
  const status = clean(value);
  return TASK_STATUS_OPTIONS.some((option) => option.value === status) ? status : "pending";
}

function normalizeLinkType(value) {
  const linkType = clean(value);
  return TASK_LINK_TYPES.some((option) => option.value === linkType) ? linkType : "student";
}

function parseSnapshot(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function stableJson(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pickMandateSnapshot(item = {}) {
  return {
    checkedAt: new Date().toISOString(),
    provider: clean(item.provider),
    providerLabel: clean(item.providerLabel),
    connectionId: clean(item.connectionId),
    connectionLabel: clean(item.connectionLabel),
    mandateId: clean(item.mandateId || item.id),
    customerName: clean(item.customerName),
    email: clean(item.email),
    phone: clean(item.phone),
    donorId: clean(item.donorId),
    status: clean(item.status),
    statusLabel: clean(item.statusLabel),
    issueKind: clean(item.issueKind),
    errorText: clean(item.errorText),
    amount: item.amount ?? null,
    amountIls: item.amountIls ?? null,
    originalAmount: item.originalAmount ?? null,
    originalCurrency: clean(item.originalCurrency || item.currency),
    nextChargeDate: item.nextChargeDate || null,
    createdAt: item.createdAt || null,
    recurringCode: clean(item.recurringCode),
    paymentMethodLast4: clean(item.paymentMethodLast4),
    paymentMethodExpiry: clean(item.paymentMethodExpiry),
    city: clean(item.city),
    address: clean(item.address),
    group: clean(item.group),
    comments: clean(item.comments),
    historyCount: Number(item.historyCount || 0),
    successCount: Number(item.successCount || 0),
    totalHistoryAmount: item.totalHistoryAmount ?? null
  };
}

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    status: normalizeStatus(row.status),
    linkedType: normalizeLinkType(row.linked_type),
    studentId: row.student_id || "",
    studentName: row.student_name || "",
    studentClass: row.student_class || "",
    studentInstitution: row.student_institution || "",
    studentEmail: row.student_email || "",
    studentFatherEmail: row.student_father_email || "",
    studentMotherEmail: row.student_mother_email || "",
    studentPhone: row.student_phone || "",
    studentFatherPhone: row.student_father_phone || "",
    studentMotherPhone: row.student_mother_phone || "",
    paymentMandateId: row.payment_mandate_id || "",
    paymentProvider: row.payment_provider || "",
    paymentConnectionId: row.payment_connection_id || "",
    paymentConnectionLabel: row.payment_connection_label || "",
    paymentCustomerName: row.payment_customer_name || "",
    paymentCustomerEmail: row.payment_customer_email || "",
    sourceSnapshot: parseSnapshot(row.source_snapshot),
    createdByUserId: row.created_by_user_id || "",
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignees: Array.isArray(row.assignees) ? row.assignees.filter(Boolean) : []
  };
}

async function ensureTasksReady() {
  await initDb();
}

export function taskStatusLabel(status) {
  return TASK_STATUS_OPTIONS.find((option) => option.value === normalizeStatus(status))?.label || "ממתין";
}

export function taskLinkTypeLabel(linkType) {
  return TASK_LINK_TYPES.find((option) => option.value === normalizeLinkType(linkType))?.label || "תלמיד";
}

export async function listAssignableTaskUsers() {
  const users = await listAppUsers();
  const assignableUsers = users
    .filter((user) => user.access_status === "approved")
    .filter((user) => user.is_team_member || user.is_manager || user.is_super_admin);
  const tagMap = await getStudentTagsByStudentIds(assignableUsers.map((user) => user.linked_student_id));
  return assignableUsers
    .map((user) => {
      const tags = tagMap[clean(user.linked_student_id)] || [];
      return {
        id: user.clerk_user_id,
        name: user.display_name || user.email,
        email: user.email,
        role: user.role,
        linkedStudentId: user.linked_student_id || "",
        staffLabels: Array.isArray(user.staff_labels) ? user.staff_labels : [],
        tags,
        tagNames: tags.map((tag) => tag.name),
        isOfficeStaff: hasOfficeLabel({ ...user, tags })
      };
    })
    .sort((a, b) => clean(a.name).localeCompare(clean(b.name), "he"));
}

export async function listOfficeTaskEmailUsers() {
  const users = await listAssignableTaskUsers();
  return users.filter((user) => user.isOfficeStaff && clean(user.email));
}

export async function listTasks({
  taskId = "",
  status = "",
  assignedTo = "",
  linkedType = "",
  studentId = "",
  mandateId = "",
  q = "",
  limit = 200
} = {}) {
  await ensureTasksReady();
  const safeStatus = normalizeStatus(status);
  const shouldFilterStatus = Boolean(clean(status));
  const safeLinkType = normalizeLinkType(linkedType);
  const shouldFilterLinkType = Boolean(clean(linkedType));
  const term = clean(q);
  const likeTerm = `%${term}%`;
  const maxRows = Math.max(1, Math.min(500, Number(limit) || 200));

  const rows = await sql`
    SELECT
      t.*,
      ns.full_name AS student_name,
      ns.class AS student_class,
      ns.current_institution AS student_institution,
      ns.primary_email AS student_email,
      ns.father_email AS student_father_email,
      ns.mother_email AS student_mother_email,
      ns.student_phone AS student_phone,
      ns.father_phone AS student_father_phone,
      ns.mother_phone AS student_mother_phone,
      creator.display_name AS created_by_name,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', au.clerk_user_id,
            'name', au.display_name,
            'email', au.email,
            'role', au.role
          )
        ) FILTER (WHERE au.clerk_user_id IS NOT NULL),
        '[]'::jsonb
      ) AS assignees
    FROM crm_tasks t
    LEFT JOIN neon_students ns ON ns.student_id = t.student_id
    LEFT JOIN app_users creator ON creator.clerk_user_id = t.created_by_user_id
    LEFT JOIN crm_task_assignees ta ON ta.task_id = t.id
    LEFT JOIN app_users au ON au.clerk_user_id = ta.assignee_user_id
    WHERE (${shouldFilterStatus} = FALSE OR t.status = ${safeStatus})
      AND (${clean(taskId)} = '' OR t.id = ${clean(taskId)})
      AND (${shouldFilterLinkType} = FALSE OR t.linked_type = ${safeLinkType})
      AND (${clean(studentId)} = '' OR t.student_id = ${clean(studentId)})
      AND (${clean(mandateId)} = '' OR t.payment_mandate_id = ${clean(mandateId)})
      AND (${clean(assignedTo)} = '' OR EXISTS (
        SELECT 1 FROM crm_task_assignees sub
        WHERE sub.task_id = t.id
          AND sub.assignee_user_id = ${clean(assignedTo)}
      ))
      AND (${term} = '' OR (
        t.title ILIKE ${likeTerm}
        OR t.id ILIKE ${likeTerm}
        OR COALESCE(t.description, '') ILIKE ${likeTerm}
        OR COALESCE(ns.full_name, '') ILIKE ${likeTerm}
        OR COALESCE(t.payment_customer_name, '') ILIKE ${likeTerm}
        OR COALESCE(t.payment_customer_email, '') ILIKE ${likeTerm}
        OR COALESCE(t.payment_mandate_id, '') ILIKE ${likeTerm}
      ))
    GROUP BY
      t.id,
      ns.full_name,
      ns.class,
      ns.current_institution,
      ns.primary_email,
      ns.father_email,
      ns.mother_email,
      ns.student_phone,
      ns.father_phone,
      ns.mother_phone,
      creator.display_name
    ORDER BY
      CASE t.status WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END ASC,
      t.updated_at DESC
    LIMIT ${maxRows}
  `;
  return rows.map(mapTaskRow).filter(Boolean);
}

export async function getTaskById(taskId) {
  await ensureTasksReady();
  const rows = await sql`
    SELECT
      t.*,
      ns.full_name AS student_name,
      ns.class AS student_class,
      ns.current_institution AS student_institution,
      ns.primary_email AS student_email,
      ns.father_email AS student_father_email,
      ns.mother_email AS student_mother_email,
      ns.student_phone AS student_phone,
      ns.father_phone AS student_father_phone,
      ns.mother_phone AS student_mother_phone,
      creator.display_name AS created_by_name,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', au.clerk_user_id,
            'name', au.display_name,
            'email', au.email,
            'role', au.role
          )
        ) FILTER (WHERE au.clerk_user_id IS NOT NULL),
        '[]'::jsonb
      ) AS assignees
    FROM crm_tasks t
    LEFT JOIN neon_students ns ON ns.student_id = t.student_id
    LEFT JOIN app_users creator ON creator.clerk_user_id = t.created_by_user_id
    LEFT JOIN crm_task_assignees ta ON ta.task_id = t.id
    LEFT JOIN app_users au ON au.clerk_user_id = ta.assignee_user_id
    WHERE t.id = ${clean(taskId)}
    GROUP BY
      t.id,
      ns.full_name,
      ns.class,
      ns.current_institution,
      ns.primary_email,
      ns.father_email,
      ns.mother_email,
      ns.student_phone,
      ns.father_phone,
      ns.mother_phone,
      creator.display_name
    LIMIT 1
  `;
  return mapTaskRow(rows[0] || null);
}

export async function createTask({
  title,
  description = "",
  status = "pending",
  linkedType = "student",
  studentId = "",
  paymentMandateId = "",
  paymentProvider = "",
  paymentConnectionId = "",
  paymentConnectionLabel = "",
  paymentCustomerName = "",
  paymentCustomerEmail = "",
  sourceSnapshot = {},
  assigneeUserIds = [],
  createdByUserId
}) {
  await ensureTasksReady();
  const safeTitle = clean(title);
  if (!safeTitle) throw new Error("חובה להזין כותרת משימה.");

  const safeLinkedType = normalizeLinkType(linkedType);
  const safeStudentId = safeLinkedType === "student" ? clean(studentId) : "";
  const safeMandateId = safeLinkedType === "payment_mandate" ? clean(paymentMandateId) : "";
  if (safeLinkedType === "student" && !safeStudentId) throw new Error("חובה לבחור תלמיד למשימה.");
  if (safeLinkedType === "payment_mandate" && !safeMandateId) throw new Error("חובה לציין מספר הוראת קבע.");

  const id = randomUUID();
  const snapshot = JSON.stringify(parseSnapshot(sourceSnapshot));

  await sql`
    INSERT INTO crm_tasks (
      id,
      title,
      description,
      status,
      linked_type,
      student_id,
      payment_mandate_id,
      payment_provider,
      payment_connection_id,
      payment_connection_label,
      payment_customer_name,
      payment_customer_email,
      source_snapshot,
      created_by_user_id
    )
    VALUES (
      ${id},
      ${safeTitle},
      ${clean(description)},
      ${normalizeStatus(status)},
      ${safeLinkedType},
      ${safeStudentId || null},
      ${safeMandateId || null},
      ${clean(paymentProvider) || null},
      ${clean(paymentConnectionId) || null},
      ${clean(paymentConnectionLabel) || null},
      ${clean(paymentCustomerName) || null},
      ${clean(paymentCustomerEmail).toLowerCase() || null},
      ${snapshot}::jsonb,
      ${clean(createdByUserId) || null}
    )
  `;

  await setTaskAssignees(id, assigneeUserIds, createdByUserId);
  return id;
}

export async function updateTask(taskId, {
  title,
  description = "",
  status = "pending",
  assigneeUserIds = [],
  updatedByUserId = ""
}) {
  await ensureTasksReady();
  const safeTitle = clean(title);
  if (!safeTitle) throw new Error("חובה להזין כותרת משימה.");
  await sql`
    UPDATE crm_tasks
    SET
      title = ${safeTitle},
      description = ${clean(description)},
      status = ${normalizeStatus(status)},
      updated_at = NOW()
    WHERE id = ${clean(taskId)}
  `;
  await setTaskAssignees(taskId, assigneeUserIds, updatedByUserId);
}

export async function updateTaskStatus(taskId, status) {
  await ensureTasksReady();
  await sql`
    UPDATE crm_tasks
    SET status = ${normalizeStatus(status)}, updated_at = NOW()
    WHERE id = ${clean(taskId)}
  `;
}

export async function updateTaskPaymentSnapshot(taskId, latestMandateDetails) {
  await ensureTasksReady();
  const task = await getTaskById(taskId);
  if (!task) throw new Error("המשימה לא נמצאה.");

  const currentSnapshot = parseSnapshot(task.sourceSnapshot);
  const createdSnapshot = currentSnapshot.paymentMandateAtCreation || currentSnapshot;
  const latestSnapshot = pickMandateSnapshot(latestMandateDetails);
  const compareCreated = { ...createdSnapshot };
  const compareLatest = { ...latestSnapshot };
  delete compareCreated.checkedAt;
  delete compareLatest.checkedAt;
  const changed = stableJson(compareCreated) !== stableJson(compareLatest);
  const nextSnapshot = {
    ...currentSnapshot,
    paymentMandateAtCreation: createdSnapshot,
    latestPaymentMandateSnapshot: latestSnapshot,
    latestPaymentMandateCheckedAt: latestSnapshot.checkedAt,
    latestPaymentMandateChanged: changed
  };

  await sql`
    UPDATE crm_tasks
    SET source_snapshot = ${JSON.stringify(nextSnapshot)}::jsonb,
        updated_at = NOW()
    WHERE id = ${clean(taskId)}
  `;

  return changed;
}

export async function deleteTask(taskId) {
  await ensureTasksReady();
  await sql`DELETE FROM crm_tasks WHERE id = ${clean(taskId)}`;
}

async function setTaskAssignees(taskId, assigneeUserIds = [], assignedByUserId = "") {
  const uniqueIds = [...new Set((assigneeUserIds || []).map(clean).filter(Boolean))];
  await sql`DELETE FROM crm_task_assignees WHERE task_id = ${clean(taskId)}`;
  for (const assigneeUserId of uniqueIds) {
    await sql`
      INSERT INTO crm_task_assignees (task_id, assignee_user_id, assigned_by_user_id)
      VALUES (${clean(taskId)}, ${assigneeUserId}, ${clean(assignedByUserId) || null})
      ON CONFLICT (task_id, assignee_user_id) DO NOTHING
    `;
  }
}
