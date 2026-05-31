import { createSoftDeletedStudentRecord, listExpiredSoftDeletedStudents, listSoftDeletedStudents, removeSoftDeletedStudentRecord } from "./deleted-students-store";
import { removeNeonStudentById, upsertNeonStudent } from "./neon-students";
import { deleteStudentById, getStudentById } from "./twenty";

function clean(value) {
  return String(value || "").trim();
}

function studentLabel(student) {
  const firstName = clean(student?.fullName?.firstName);
  const lastName = clean(student?.fullName?.lastName);
  return `${firstName} ${lastName}`.trim() || clean(student?.label) || clean(student?.name) || "תלמיד ללא שם";
}

export const DELETE_CONFIRMATION_TEXT = "אני מאשר";

export async function softDeleteStudentById(studentId, deletedByUserId) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) throw new Error("לא נבחר תלמיד למחיקה");

  const student = await getStudentById(normalizedStudentId, { includeSoftDeleted: true });
  if (!student) throw new Error("התלמיד לא נמצא למחיקה");

  await createSoftDeletedStudentRecord({
    studentId: normalizedStudentId,
    studentName: studentLabel(student),
    deletedByUserId,
    snapshot: student
  });
  await removeNeonStudentById(normalizedStudentId);
  return student;
}

export async function restoreSoftDeletedStudentById(studentId) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) throw new Error("לא נבחר תלמיד לשחזור");

  const deletedRows = await listSoftDeletedStudents();
  const deletedRow = deletedRows.find((row) => clean(row?.student_id) === normalizedStudentId);
  const student = await getStudentById(normalizedStudentId, { includeSoftDeleted: true }) || deletedRow?.snapshot_json;
  if (!student) {
    throw new Error("לא ניתן לשחזר: לא נמצאה תמונת מצב של התלמיד.");
  }
  await removeSoftDeletedStudentRecord(normalizedStudentId);
  await upsertNeonStudent({ ...student, id: normalizedStudentId });
  return student;
}

export async function permanentlyDeleteSoftDeletedStudentById(studentId) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) throw new Error("לא נבחר תלמיד למחיקה סופית");

  await deleteStudentById(normalizedStudentId);
  await removeNeonStudentById(normalizedStudentId);
  await removeSoftDeletedStudentRecord(normalizedStudentId);
}

export async function purgeExpiredSoftDeletedStudents(limit = 50) {
  const expired = await listExpiredSoftDeletedStudents(limit);
  let purgedCount = 0;

  for (const row of expired) {
    try {
      await permanentlyDeleteSoftDeletedStudentById(row.student_id);
      purgedCount += 1;
    } catch (error) {
      if (String(error?.message || "").toLowerCase().includes("not found")) {
        await removeSoftDeletedStudentRecord(row.student_id);
        purgedCount += 1;
        continue;
      }
      throw error;
    }
  }

  return { purgedCount };
}

export { listSoftDeletedStudents };
