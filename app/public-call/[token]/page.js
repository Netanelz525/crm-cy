import {cache} from 'react';
import {publicCallState} from '../../../lib/attendance-calls';
import AttendanceCallClient from '../../call-desk/attendance/attendance-call-client';
export const dynamic='force-dynamic';

// Metadata and the page share one request-scoped lookup. Never expose student data
// or the secret URL itself in preview metadata.
const readCallState=cache(async token=>{
  try{return await publicCallState(token);}catch{return null;}
});

export async function generateMetadata({params}) {
  const {token}=await params;
  const state=await readCallState(token);
  const title=state ? `חפ״ק שיחות · ${state.title}` : 'חפ״ק אינו זמין';
  const description=state ? `מרכז השיחות למפגש ״${state.title}״` : 'הקישור נסגר או הוחלף. יש לפנות למנהל לקבלת קישור פעיל.';
  return {
    title,description,
    robots:{index:false,follow:false},referrer:'no-referrer',
    openGraph:{title,description,type:'website',locale:'he_IL',siteName:'CRM CY'},
    twitter:{card:'summary',title,description}
  };
}

export default async function PublicCallPage({params,searchParams}) {
  const {token}=await params;
  const selectedStatus=String((await searchParams)?.status||'');
  const state=await readCallState(token);
  if(!state)return <section className="card"><h1>החפ״ק אינו זמין</h1><p>המנהל סגר את הקישור או החליף אותו. יש לפנות למנהל לקבלת קישור פעיל.</p></section>;
  return <AttendanceCallClient initialStatus={selectedStatus} sessionId={state.sessionId} title={state.title} statusOptions={state.statusOptions} locked={false} publicToken={token}/>;
}
