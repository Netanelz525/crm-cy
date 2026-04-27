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
  await sql`ALTER TABLE app_users ALTER COLUMN agent_telegram_enabled SET DEFAULT TRUE`;
  await sql`ALTER TABLE app_users ALTER COLUMN agent_whatsapp_enabled SET DEFAULT TRUE`;
  await sql`UPDATE app_users SET agent_telegram_enabled = COALESCE(agent_telegram_enabled, TRUE)`;
  await sql`UPDATE app_users SET agent_whatsapp_enabled = COALESCE(agent_whatsapp_enabled, TRUE)`;
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
    agent_telegram_enabled: user.agent_telegram_enabled !== false,
    agent_whatsapp_enabled: user.agent_whatsapp_enabled !== false,
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
      clerk_user_id,
      email,
      display_name,
      role,
      access_status,
      linked_student_id,
      linked_student_class,
      can_edit_own_card,
      preferred_agent_channel,
      agent_telegram_enabled,
      agent_whatsapp_enabled,
      approved_by_user_id,
      created_at,
      updated_at
    FROM app_users
    WHERE clerk_user_id = ${userId}
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
      can_edit_own_card
    FROM app_users
    WHERE clerk_user_id = ${userId}
    LIMIT 1
  `;
  const existing = existingRows[0] || null;

  const nextLinkedStudentId = linkedStudentId || existing?.linked_student_id || null;
  const nextLinkedStudentClass = linkedStudentClass || existing?.linked_student_class || null;
  const nextStatus = (hasLinkedStudent || superAdminEmail) ? "approved" : existing?.access_status || "pending";
  const nextCanEditOwnCard = hasLinkedStudent ? true : Boolean(existing?.can_edit_own_card);
  const nextRole = superAdminEmail ? "super_admin" : clean(existing?.role).toLowerCase() || "viewer";

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
        can_edit_own_card
      )
      VALUES (
        ${userId},
        ${email},
        ${displayName},
        ${nextRole},
        ${nextStatus},
        ${nextLinkedStudentId},
        ${nextLinkedStudentClass},
        ${nextCanEditOwnCard}
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
