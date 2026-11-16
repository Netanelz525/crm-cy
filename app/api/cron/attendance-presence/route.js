import { NextResponse } from 'next/server';
import { runAttendancePresenceAutomatic } from '../../../../lib/attendance';
import { authorizePresenceCron } from '../../../../lib/attendance-presence-cron-auth.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request) {
  if (!await authorizePresenceCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { return NextResponse.json(await runAttendancePresenceAutomatic()); }
  catch { return NextResponse.json({ ok: false }, { status: 500 }); }
}
