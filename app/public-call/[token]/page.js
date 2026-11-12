import {publicCallState} from '../../../lib/attendance-calls';
import AttendanceCallClient from '../../call-desk/attendance/attendance-call-client';
export const dynamic='force-dynamic';
export const metadata={title:'חפ״ק שיחות',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function PublicCallPage({params,searchParams}){const {token}=await params;const selectedStatus=String((await searchParams)?.status||"");let state;try{state=await publicCallState(token);}catch{return <section className="card"><h1>החפ״ק אינו זמין</h1><p>המנהל סגר את הקישור או החליף אותו. יש לפנות למנהל לקבלת קישור פעיל.</p></section>;}return <AttendanceCallClient initialStatus={selectedStatus} sessionId={state.sessionId} title={state.title} statusOptions={state.statusOptions} locked={false} publicToken={token}/>;}
