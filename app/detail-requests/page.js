import Link from 'next/link';
import {requireAuthenticatedUser} from '../../lib/rbac';
import {requireDetailManager,listDetailBatches} from '../../lib/detail-requests';
import {listNeonStudentsByFilters} from '../../lib/neon-students';
import {ENUM_LABELS} from '../../lib/student-fields';
import CreateDetailsClient from './create-client';
export const runtime='nodejs';
export default async function DetailRequestsPage({searchParams}){
 const user=await requireAuthenticatedUser();try{requireDetailManager(user);}catch{return <div className="card">אין הרשאה לניהול בקשות.</div>;}
 const params=await searchParams,filters=Object.fromEntries(['institution','class','registration','famliystatus','healthInsurance','q'].map(key=>[key,String(params?.[key]||'')]));
 const requestedIds=(Array.isArray(params?.studentIds)?params.studentIds:[params?.studentIds]).filter(value=>typeof value==='string'&&value.length<201).slice(0,201);
 const [students,batches]=await Promise.all([listNeonStudentsByFilters({...filters,studentIds:requestedIds,limit:201}),listDetailBatches(user)]);
 return <div style={{display:'grid',gap:20}}><section className="card glass"><h1>בקשות לאימות ולעדכון פרטים</h1><p>בחירת תלמידים ושדות, שליחת קישור אישי במייל ומעקב אחר אישור או עדכון.</p></section>
 <section className="card glass"><h2>בקשה חדשה</h2><form method="get" style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'end'}}>{[['institution','מוסד','currentInstitution'],['class','שיעור','class'],['registration','רישום','registration'],['famliystatus','מצב משפחתי','familystatus'],['healthInsurance','קופת חולים','healthInsurance']].map(([key,label,enumKey])=><label key={key}>{label}<select name={key} defaultValue={filters[key]}><option value="">הכל</option>{Object.entries(ENUM_LABELS[enumKey]||{}).map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>)}<label>חיפוש שם או פרטים<input name="q" defaultValue={filters.q}/></label><button className="btn">החל מסננים</button></form><p className="muted">מוצגות עד 201 תוצאות. ניתן לבחור עד 200 תלמידים בכל בקשה; צמצם במסננים לפי הצורך.</p><CreateDetailsClient initialSelected={requestedIds.length>0} key={JSON.stringify({...filters,requestedIds})} students={students.map(student=>({id:student.id,label:student.label,email:student.email?.primaryEmail,fatherEmail:student.fatherEmail?.primaryEmail,motherEmail:student.motherEmail?.primaryEmail}))} canSend={user.can_send_emails} canParents={user.can_email_parents}/></section>
 <section className="card glass"><h2>בקשות קודמות</h2>{!batches.length&&<p>עדיין לא נוצרו בקשות.</p>}{batches.map(batch=><div key={batch.id} style={{padding:14,borderBottom:'1px solid #d6e2ef'}}><Link href={'/detail-requests/'+batch.id}>{batch.title}</Link><p>{batch.total} תלמידים · {batch.approved} אושרו · {batch.updated} עודכנו · {batch.total-batch.approved-batch.updated} ממתינים {batch.closed_at?'· סגורה':''}</p></div>)}</section></div>;
}
