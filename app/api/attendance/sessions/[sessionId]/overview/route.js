import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '../../../../../../lib/rbac';
import { getAttendanceRoster } from '../../../../../../lib/attendance';
import { buildAttendanceDashboard } from '../../../../../../lib/attendance-dashboard.mjs';
export const dynamic='force-dynamic';
export async function GET(request,{params}) {
  const user=await getCurrentAppUser();
  if(!user || user.access_status!=='approved' || (!user.is_team_member&&!user.is_manager&&!user.is_super_admin)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const {sessionId}=await params;
  const roster=await getAttendanceRoster(sessionId);
  if(!roster)return NextResponse.json({error:'Not found'},{status:404});
  return NextResponse.json(buildAttendanceDashboard(roster),{headers:{'Cache-Control':'private, no-store'}});
}
