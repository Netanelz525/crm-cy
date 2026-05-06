import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { initDb, sql } from "./db";
import { getStudentByPrimaryEmail } from "./twenty";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function clean(value) {
  return String(value || "").trim();
}

function getSuperAdminEmails() {
  const configured = clean(process.env.SUPER_ADMIN_EMAILS)
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
  return new Set(["netanel.zevin@gmail.com", ...configured]);
}

function isSuperAdminEmail(email) {
  return getSuperAdminEmails().has(normalizeEmail(email));
}

async function ensureAppUserAgentColumns() {
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS preferred_agent_channel TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS agent_telegram_enabled BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS agent_whatsapp_enabled BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS weekly_backup_enabled BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS weekly_backup_delivery TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_send_emails BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_edit_email_sender BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_email_parents BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_view_email_reports BOOLEAN`;
  await sql`ALTER TABLE app_users ALTER COLUMN agent_telegram_enabled SET DEFAULT TRUE`;
  await sql`ALTER TABLE app_users ALTER COLUMN agent_whatsapp_enabled SET DEFAULT TRUE`;
  await sql`ALTER TABLE app_users ALTER COLUMN weekly_backup_enabled SET DEFAULT FALSE`;
  await sql`UPDATE app_users SET agent_telegram_enabled = COALESCE(agent_telegram_enabled, TRUE)`;
  await sql`UPDATE app_users SET agent_whatsapp_enabled = COALESCE(agent_whatsapp_enabled, TRUE)`;
  await sql`UPDATE app_users SET weekly_backup_enabled = COALESCE(weekly_backup_enabled, FALSE)`;
  await sql`
    UPDATE app_users
    SET
      weekly_backup_enabled = TRUE,
      weekly_backup_delivery = COALESCE(NULLIF(weekly_backup_delivery, ''), 'email'),
      can_send_emails = TRUE,
      can_edit_email_sender = TRUE,
      can_email_parents = TRUE,
      can_view_email_reports = TRUE,
      updated_at = NOW()
    WHERE LOWER(COALESCE(role, '')) = 'super_admin'
  `;
  await sql`
    UPDATE app_users
    SET
      role = 'editor',
      updated_at = NOW()
    WHERE UPPER(COALESCE(linked_student_class, '')) = 'TEAM'
      AND LOWER(COALESCE(role, 'viewer')) = 'viewer'
  `;
}

function mapAppUserRow(user) {
  if (!user) return null;
  const isTeamMember = clean(user.linked_student_class).toUpperCase() === "TEAM";
  const role = clean(user.role).toLowerCase();
  const isSuperAdmin = role === "super_admin";
  const isManager = isSuperAdmin || role === "admin" || role === "editor";
  return {
    ...user,
    can_edit_own_card: Boolean(user.can_edit_own_card),
    can_send_emails: Boolean(user.can_send_emails),
    can_edit_email_sender: Boolean(user.can_edit_email_sender),
    can_email_parents: Boolean(user.can_email_parents),
    can_view_email_reports: Boolean(user.can_view_email_reports),
    agent_telegram_enabled: user.agent_telegram_enabled !== false,
    agent_whatsapp_enabled: user.agent_whatsapp_enabled !== false,
    weekly_backup_enabled: user.weekly_backup_enabled === true,
    is_team_member: isTeamMember,
    is_manager: isManager,
    is_super_admin: isSuperAdmin,
    can_use_ai_agents: user.access_status === "approved" && (isTeamMember || isManager)
  };
}

async function fetchAppUserByClerkId(clerkUserId) {
  const userId = clean(clerkUserId);
  if (!userId) return null;
  const rows = await sql`
    SELECT
      u.clerk_user_id,
      u.email,
      u.display_name,
      u.role,
      u.access_status,
      u.linked_student_id,
      u.linked_student_class,
      u.can_edit_own_card,
      u.can_send_emails,
      u.can_edit_email_sender,
      u.can_email_parents,
      u.can_view_email_reports,
      u.preferred_agent_channel,
      u.agent_telegram_enabled,
      u.agent_whatsapp_enabled,
      u.weekly_backup_enabled,
      u.weekly_backup_delivery,
      u.approved_by_user_id,
      u.created_at,
      u.updated_at,
      t.telegram_chat_id,
      t.telegram_username,
      t.linked_at AS telegram_linked_at,
      w.whatsapp_wa_id,
      w.phone_number AS whatsapp_phone_number,
      w.profile_name AS whatsapp_profile_name,
      w.linked_at AS whatsapp_linked_at
    FROM app_users u
    LEFT JOIN telegram_user_links t
      ON t.clerk_user_id = u.clerk_user_id
      AND t.is_active = TRUE
    LEFT JOIN whatsapp_user_links w
      ON w.clerk_user_id = u.clerk_user_id
      AND w.is_active = TRUE
    WHERE u.clerk_user_id = ${userId}
    LIMIT 1
  `;
  return mapAppUserRow(rows[0] || null);
}

export async function getCurrentAppUser() {
  await initDb();
  await ensureAppUserAgentColumns();
  const { userId } = await auth();
  if (!userId) return null;

  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const email = normalizeEmail(clerkUser.emailAddresses?.[0]?.emailAddress || "");
  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() || clerkUser.username || email;

  const linkedStudent = await getStudentByPrimaryEmail(email);
  const linkedStudentId = linkedStudent?.id || null;
  const linkedStudentClass = linkedStudent?.class || null;
  const hasLinkedStudent = Boolean(linkedStudentId);
  const superAdminEmail = isSuperAdminEmail(email);

  const existingRows = await sql`
    SELECT
      clerk_user_id,
      email,
      display_name,
      role,
      access_status,
      linked_student_id,
      linked_student_class,
      can_edit_own_card,
      can_send_emails,
      can_edit_email_sender,
      can_email_parents,
      can_view_email_reports
    FROM app_users
    WHERE clerk_user_id = ${userId}
    LIMIT 1
  `;
  const existing = existingRows[0] || null;

  const nextLinkedStudentId = linkedStudentId || existing?.linked_student_id || null;
  const nextLinkedStudentClass = linkedStudentClass || existing?.linked_student_class || null;
  const nextStatus = (hasLinkedStudent || superAdminEmail) ? "approved" : existing?.access_status || "pending";
  const nextCanEditOwnCard = hasLinkedStudent ? true : Boolean(existing?.can_edit_own_card);
  const existingRole = clean(existing?.role).toLowerCase();
  const isTeamLinked = clean(nextLinkedStudentClass).toUpperCase() === "TEAM";
  const nextRole = superAdminEmail
    ? "super_admin"
    : isTeamLinked
      ? (existingRole && existingRole !== "viewer" ? existingRole : "editor")
      : existingRole || "viewer";

  if (!existing) {
    await sql`
      INSERT INTO app_users (
        clerk_user_id,
        email,
        display_name,
        role,
        access_status,
        linked_student_id,
        linked_student_class,
        can_edit_own_card,
        can_send_emails,
        can_edit_email_sender,
        can_email_parents,
        can_view_email_reports
      )
      VALUES (
        ${userId},
        ${email},
        ${displayName},
        ${nextRole},
        ${nextStatus},
        ${nextLinkedStudentId},
        ${nextLinkedStudentClass},
        ${nextCanEditOwnCard},
        ${isTeamLinked || superAdminEmail},
        ${superAdminEmail},
        ${isTeamLinked || superAdminEmail},
        ${isTeamLinked || superAdminEmail}
      )
    `;
  } else {
    await sql`
      UPDATE app_users
      SET
        email = ${email},
        display_name = ${displayName},
        role = ${nextRole},
        access_status = ${nextStatus},
        linked_student_id = ${nextLinkedStudentId},
        linked_student_class = ${nextLinkedStudentClass},
        can_edit_own_card = ${nextCanEditOwnCard},
        can_send_emails = COALESCE(can_send_emails, ${isTeamLinked || superAdminEmail}),
        can_edit_email_sender = COALESCE(can_edit_email_sender, ${superAdminEmail}),
        can_email_parents = COALESCE(can_email_parents, ${isTeamLinked || superAdminEmail}),
        can_view_email_reports = COALESCE(can_view_email_reports, ${isTeamLinked || superAdminEmail}),
        updated_at = NOW()
      WHERE clerk_user_id = ${userId}
    `;
  }

  return fetchAppUserByClerkId(userId);
}

export async function requireAuthenticatedUser() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireTeamUser() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_super_admin) redirect("/unauthorized");
  return user;
}

export async function requireEmailSender() {
  const user = await requireAuthenticatedUser();
  if (!user.can_send_emails) redirect("/unauthorized");
  return user;
}

export async function requireSuperAdmin() {
  const user = await requireAuthenticatedUser();
  if (!user.is_super_admin) redirect("/unauthorized");
  return user;
}

export function assertStudentAccess(user, studentId) {
  if (!user) return false;
  if (user.is_team_member || user.is_manager || user.is_super_admin) return true;
  return clean(user.linked_student_id) === clean(studentId);
}

export function canEditStudentCard(user, studentId) {
  if (!user) return false;
  if (user.is_team_member || user.is_manager || user.is_super_admin) return true;
  return assertStudentAccess(user, studentId) && Boolean(user.linked_student_id);
}

export async function listPendingUnknownUsers() {
  await initDb();
  await ensureAppUserAgentColumns();
  return sql`
    SELECT
      clerk_user_id,
      email,
      display_name,
      access_status,
      linked_student_id,
      linked_student_class,
      can_edit_own_card,
      created_at,
      updated_at
    FROM app_users
    WHERE access_status = 'pending'
      AND linked_student_id IS NULL
    ORDER BY created_at DESC
  `;
}

export async function listAppUsers() {
  await initDb();
  await ensureAppUserAgentColumns();
  const rows = await sql`
    SELECT
      u.clerk_user_id,
      u.email,
      u.display_name,
      u.role,
      u.access_status,
      u.linked_student_id,
      u.linked_student_class,
      u.can_edit_own_card,
      u.preferred_agent_channel,
      u.agent_telegram_enabled,
      u.agent_whatsapp_enabled,
      u.weekly_backup_enabled,
      u.weekly_backup_delivery,
      u.created_at,
      u.updated_at,
      t.telegram_chat_id,
      t.telegram_username,
      t.linked_at AS telegram_linked_at,
      w.whatsapp_wa_id,
      w.phone_number AS whatsapp_phone_number,
      w.profile_name AS whatsapp_profile_name,
      w.linked_at AS whatsapp_linked_at
    FROM app_users u
    LEFT JOIN telegram_user_links t
      ON t.clerk_user_id = u.clerk_user_id
      AND t.is_active = TRUE
    LEFT JOIN whatsapp_user_links w
      ON w.clerk_user_id = u.clerk_user_id
      AND w.is_active = TRUE
    ORDER BY u.updated_at DESC
  `;
  return rows.map(mapAppUserRow);
}

export async function getAppUserByClerkUserId(clerkUserId) {
  await initDb();
  await ensureAppUserAgentColumns();
  return fetchAppUserByClerkId(clerkUserId);
}

export async function approveUnknownUser(targetClerkUserId, approvedByUserId, withEdit = false) {
  await initDb();
  await ensureAppUserAgentColumns();
  await sql`
    UPDATE app_users
    SET
      access_status = 'approved',
      can_edit_own_card = ${Boolean(withEdit)},
      approved_by_user_id = ${approvedByUserId},
      updated_at = NOW()
    WHERE clerk_user_id = ${clean(targetClerkUserId)}
      AND linked_student_id IS NULL
  `;
}

export async function setOwnCardEditPermission(targetClerkUserId, enabled) {
  await initDb();
  await ensureAppUserAgentColumns();
  await sql`
    UPDATE app_users
    SET
      can_edit_own_card = ${Boolean(enabled)},
      updated_at = NOW()
    WHERE clerk_user_id = ${clean(targetClerkUserId)}
      AND COALESCE(UPPER(linked_student_class), '') <> 'TEAM'
  `;
}

export async function setAppUserRole(targetClerkUserId, role) {
  await initDb();
  await ensureAppUserAgentColumns();
  const normalizedRole = clean(role).toLowerCase();
  if (!["viewer", "editor", "admin", "super_admin"].includes(normalizedRole)) {
    throw new Error("תפקיד לא נתמך.");
  }
  await sql`
    UPDATE app_users
    SET
      role = ${normalizedRole},
      access_status = CASE WHEN ${normalizedRole} = 'super_admin' THEN 'approved' ELSE access_status END,
      weekly_backup_enabled = CASE
        WHEN ${normalizedRole} = 'super_admin' THEN TRUE
        ELSE weekly_backup_enabled
      END,
      weekly_backup_delivery = CASE
        WHEN ${normalizedRole} = 'super_admin' THEN COALESCE(NULLIF(weekly_backup_delivery, ''), 'email')
        ELSE weekly_backup_delivery
      END,
      updated_at = NOW()
    WHERE clerk_user_id = ${clean(targetClerkUserId)}
  `;
}

export async function setUserAgentChannelPreferences(targetClerkUserId, {
  preferredAgentChannel = "",
  telegramEnabled = true,
  whatsappEnabled = true
} = {}) {
  await initDb();
  await ensureAppUserAgentColumns();
  const preferred = clean(preferredAgentChannel).toLowerCase();
  const finalPreferred = ["telegram", "whatsapp"].includes(preferred) ? preferred : null;
  await sql`
    UPDATE app_users
    SET
      preferred_agent_channel = ${finalPreferred},
      agent_telegram_enabled = ${Boolean(telegramEnabled)},
      agent_whatsapp_enabled = ${Boolean(whatsappEnabled)},
      updated_at = NOW()
    WHERE clerk_user_id = ${clean(targetClerkUserId)}
  `;
}

export async function setUserWeeklyBackupPreferences(targetClerkUserId, {
  enabled = false,
  delivery = ""
} = {}) {
  await initDb();
  await ensureAppUserAgentColumns();
  const normalizedDelivery = clean(delivery).toLowerCase();
  const finalDelivery = ["email", "telegram", "both"].includes(normalizedDelivery) ? normalizedDelivery : "email";
  await sql`
    UPDATE app_users
    SET
      weekly_backup_enabled = ${Boolean(enabled)},
      weekly_backup_delivery = ${Boolean(enabled) ? finalDelivery : null},
      updated_at = NOW()
    WHERE clerk_user_id = ${clean(targetClerkUserId)}
  `;
}

export async function deleteAppUser(targetClerkUserId) {
  await initDb();
  await ensureAppUserAgentColumns();
  const normalizedUserId = clean(targetClerkUserId);
  if (!normalizedUserId) return;
  await sql`
    DELETE FROM app_users
    WHERE clerk_user_id = ${normalizedUserId}
  `;
}
