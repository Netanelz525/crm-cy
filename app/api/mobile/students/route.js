import { getCurrentAppUser, assertStudentAccess } from '../../../../lib/rbac';
import { searchStudentsByText } from '../../../../lib/twenty';
export const runtime = 'nodejs';
export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || user.access_status !== 'approved' || !(user.is_team_member || user.is_manager || user.is_super_admin)) return Response.json({ error: 'אין הרשאה' }, { status: 403 });
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 100);
  const students = q.length >= 2 ? await searchStudentsByText(q, 20) : [];
  return Response.json({ students: students.filter(student => assertStudentAccess(user, student.id)).map(student => ({ id: student.id, label: student.label || student.name })) }, { headers: { 'Cache-Control': 'no-store' } });
}
