import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireAuthenticatedUser} from '../../../lib/rbac';
import {getDetailBatch} from '../../../lib/detail-requests';
import {DETAIL_FIELDS} from '../../../lib/detail-request-fields';
import {ENUM_LABELS} from '../../../lib/student-fields';
import {closeDetailRequestAction} from '../actions';
import SendDetailsClient from '../send-client';
const statuses={pending:'ממתין',approved:'אושר ללא שינוי',updated:'עודכן'};const deliveries={pending:'ממתין לשליחה',sending:'בשליחה',sent:'נשלח',failed:'שליחה נכשלה'};
export const runtime='nodejs';
export default async function DetailBatchPage({params}){
 const user=await requireAuthenticatedUser();let batch;try{batch=await getDetailBatch(user,(await params).batchId);}catch{return <div className="card">אין הרשאה.</div>;}if(!batch)notFound();
 const counts=Object.fromEntries(['pending','approved','updated'].map(status=>[status,batch.requests.filter(item=>item.status===status).length]));
 const format=(key,value)=>{const field=DETAIL_FIELDS.find(field=>field.key===key);return ENUM_LABELS[field?.enum]?.[value]||value||'—';};
 return <div style={{display:'grid',gap:20}}><section className="card glass"><Link href="/detail-requests">כל הבקשות</Link><h1>{batch.title}</h1><p>{batch.instructions}</p><p>{batch.requests.length} תלמידים · {counts.pending} ממתינים · {counts.approved} אושרו · {counts.updated} עודכנו</p><p>שדות: {batch.field_keys.map(key=>DETAIL_FIELDS.find(field=>field.key===key)?.label||key).join(', ')}</p>{batch.closed_at?<p>הבקשה סגורה. לא ניתן להשיב לה.</p>:<>{user.can_send_emails&&<SendDetailsClient id={batch.id}/>}<form action={closeDetailRequestAction}><input type="hidden" name="id" value={batch.id}/><button className="btn btn-ghost">סגור בקשה לתשובות נוספות</button></form></>}</section>
 <section className="card glass"><h2>מעקב לפי תלמיד</h2>{batch.requests.map(item=><article key={item.id} style={{padding:16,borderBottom:'1px solid #d6e2ef'}}><h3><Link href={'/neon/students/'+item.student_id}>{item.student_label}</Link> · {statuses[item.status]}</h3><p>{item.deliveries.map(delivery=>`${delivery.email}: ${deliveries[delivery.status]||delivery.status}`).join(' · ')}</p>{item.responded_at&&<p>מענה: {item.responded_email} · {new Date(item.responded_at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</p>}{item.after_values&&<details><summary>פרטים שאושרו ושינויים</summary>{batch.field_keys.map(key=><p key={key}><strong>{DETAIL_FIELDS.find(field=>field.key===key)?.label}: </strong>{item.before_values?.[key]!==item.after_values[key]?<>{format(key,item.before_values?.[key])} ← </>:null}{format(key,item.after_values[key])}</p>)}</details>}</article>)}</section></div>;
}
