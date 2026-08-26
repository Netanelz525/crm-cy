import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../lib/rbac";
import { listAllNeonStudents } from "../../lib/neon-students";
import { listCallAssignments } from "../../lib/student-call-assignments";
import CallDeskClient from "./call-desk-client";

export default async function CallDeskPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in?redirect_url=/call-desk");
  const [students, assignments] = await Promise.all([listAllNeonStudents(), listCallAssignments()]);
  const mine = assignments.filter((item) => (item.assignee_user_id === user.clerk_user_id || (user.linked_student_id && item.assignee_student_id === user.linked_student_id)) && item.status === "pending");
  const byId = new Map(students.map((student) => [student.id, student]));
  return <CallDeskClient students={mine.map((item) => byId.get(item.student_id)).filter(Boolean)} />;
}
