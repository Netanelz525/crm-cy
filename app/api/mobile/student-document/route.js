import { getCurrentAppUser, assertStudentAccess } from '../../../../lib/rbac';
import { createStudentDocument } from '../../../../lib/student-documents';
import { getStudentById } from '../../../../lib/twenty';
export const runtime = 'nodejs';
export async function POST(request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const user = await getCurrentAppUser();
  if (!user || user.access_status !== 'approved') return Response.json({ error: 'יש להתחבר מחדש' }, { status: 401, headers });
  if (Number(request.headers.get('content-length') || 0) > 4 * 1024 * 1024) return Response.json({ error: 'שיוך מסמך מוגבל ל־3MB' }, { status: 413, headers });
  try {
    const data = await request.formData();
    const studentId = String(data.get('studentId') || '');
    const file = data.get('file');
    if (!assertStudentAccess(user, studentId)) return Response.json({ error: 'אין הרשאה' }, { status: 403, headers });
    if (!file?.size || file.size > 3 * 1024 * 1024) throw new Error('שיוך מסמך מוגבל ל־3MB');
    if (!await getStudentById(studentId)) throw new Error('התלמיד לא נמצא');
    await createStudentDocument({ studentId, file, uploadedByUserId: user.clerk_user_id, displayName: String(data.get('displayName') || file.name).slice(0,160) });
    return Response.json({ url: `/neon/students/${encodeURIComponent(studentId)}?documentUploaded=1` }, { headers });
  } catch (error) { return Response.json({ error: error.message || 'שיוך הקובץ נכשל' }, { status: 400, headers }); }
}
