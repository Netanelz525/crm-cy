"use server";

import { redirect } from "next/navigation";
import { toFormData } from "../../../lib/student-fields";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { createStudentByData } from "../../../lib/twenty";

function clean(v) {
  return String(v || "").trim();
}

export async function createStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const raw = Object.fromEntries(formData.entries());
  const data = toFormData(raw);

  const firstName = clean(raw["fullName.firstName"]);
  const lastName = clean(raw["fullName.lastName"]);
  if (!firstName || !lastName) {
    redirect("/students/new?error=שם פרטי ושם משפחה הם שדות חובה");
  }

  if (!Object.keys(data).length) {
    redirect("/students/new?error=לא הוזנו נתונים לשמירה");
  }

  const created = await createStudentByData(data);
  const studentId = clean(created?.id);

  if (!studentId) {
    redirect("/students/new?error=לא התקבל מזהה תלמיד לאחר שמירה");
  }

  redirect(`/students/${studentId}?created=1`);
}
