import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { initDb, sql } from "./db";
import { getStudentByPrimaryEmail } from "./twenty";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export async function getCurrentAppUser() {
  await initDb();
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
      approved_by_user_id,
      created_at,
      updated_at
    FROM app_users
    WHERE clerk_user_id = ${userId}
    LIMIT 1
  `;
  const existing = existingRows[0] || null;

  const nextLinkedStudentId = linkedStudentId || existing?.linked_student_id || null;
  const nextLinkedStudentClass = linkedStudentClass || existing?.linked_student_class || null;
  const nextStatus = hasLinkedStudent ? "approved" : existing?.access_status || "pending";
  const nextCanEditOwnCard = hasLinkedStudent ? true : Boolean(existing?.can_edit_own_card);

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
        'viewer',
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
        access_status = ${nextStatus},
        linked_student_id = ${nextLinkedStudentId},
        linked_student_class = ${nextLinkedStudentClass},
        can_edit_own_card = ${nextCanEditOwnCard},
        updated_at = NOW()
      WHERE clerk_user_id = ${userId}
    `;
  }

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
      approved_by_user_id,
      created_at,
      updated_at
    FROM app_users
    WHERE clerk_user_id = ${userId}
    LIMIT 1
  `;
  const user = rows[0] || null;
  if (!user) return null;

  const isTeamMember = String(user.linked_student_class || "").trim().toUpperCase() === "TEAM";
  const role = String(user.role || "").toLowerCase();
  const isManager = role === "admin" || role === "editor";
  return {
    ...user,
    can_edit_own_card: Boolean(user.can_edit_own_card),
    is_team_member: isTeamMember,
    is_manager: isManager
  };
}

export async function requireAuthenticatedUser() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireTeamUser() {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member) redirect("/unauthorized");
  return user;
}

export function assertStudentAccess(user, studentId) {
  if (!user) return false;
  if (user.is_team_member || user.is_manager) return true;
  return String(user.linked_student_id || "") === String(studentId || "");
}

export function canEditStudentCard(user, studentId) {
  if (!user) return false;
  if (user.is_team_member || user.is_manager) return true;
  return assertStudentAccess(user, studentId) && Boolean(user.linked_student_id);
}

export async function listPendingUnknownUsers() {
  await initDb();
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
  return sql`
    SELECT
      clerk_user_id,
      email,
      display_name,
      role,
      access_status,
      linked_student_id,
      linked_student_class,
      can_edit_own_card,
      created_at,
      updated_at
    FROM app_users
    ORDER BY updated_at DESC
  `;
}

export async function approveUnknownUser(targetClerkUserId, approvedByUserId, withEdit = false) {
  await initDb();
  await sql`
    UPDATE app_users
    SET
      access_status = 'approved',
      can_edit_own_card = ${Boolean(withEdit)},
      approved_by_user_id = ${approvedByUserId},
      updated_at = NOW()
    WHERE clerk_user_id = ${targetClerkUserId}
      AND linked_student_id IS NULL
  `;
}

export async function setOwnCardEditPermission(targetClerkUserId, enabled) {
  await initDb();
  await sql`
    UPDATE app_users
    SET
      can_edit_own_card = ${Boolean(enabled)},
      updated_at = NOW()
    WHERE clerk_user_id = ${targetClerkUserId}
      AND COALESCE(UPPER(linked_student_class), '') <> 'TEAM'
  `;
}
