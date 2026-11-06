'use server';
import {listNeonStudentsByFilters} from '../../lib/neon-students';
import {revalidatePath} from 'next/cache';
import {requireAuthenticatedUser} from '../../lib/rbac';
import {DetailRequestError} from '../../lib/detail-request-fields';
import {createDetailBatch,appendDetailStudents,sendDetailChunk,closeDetailBatch,reopenDetailBatch,requireDetailManager} from '../../lib/detail-requests';
export async function createDetailRequestAction(input){try{const id=await createDetailBatch(await requireAuthenticatedUser(),input);revalidatePath('/detail-requests');return {ok:true,id};}catch(error){return {ok:false,error:error instanceof DetailRequestError?error.message:'יצירת הבקשה נכשלה. יש לנסות שוב.'};}}
export async function sendDetailRequestChunkAction(id,retry=false){try{const result=await sendDetailChunk(await requireAuthenticatedUser(),String(id),Boolean(retry));revalidatePath('/detail-requests/'+id);return {ok:true,...result};}catch{return {ok:false,error:'השליחה לא הושלמה. ניתן להמשיך מעמוד הבקשה.'};}}
export async function closeDetailRequestAction(form){if(form.get('confirmCloseAll')!=='yes')throw new DetailRequestError('יש לאשר במפורש סגירת קבלת תשובות לכל התלמידים.');await closeDetailBatch(await requireAuthenticatedUser(),String(form.get('id')||''));revalidatePath('/detail-requests');revalidatePath('/detail-requests/'+form.get('id'));}

export async function searchDetailStudentsAction(query){
 try{
  requireDetailManager(await requireAuthenticatedUser());
  const q=typeof query==='string'?query.trim():'';
  if(q.length<2||q.length>150)return {ok:false,error:'יש להזין לפחות שני תווים ועד 150 תווים לחיפוש.'};
  const students=await listNeonStudentsByFilters({q,limit:21});
  return {ok:true,hasMore:students.length>20,students:students.slice(0,20).map(student=>({id:student.id,label:student.label,email:student.email?.primaryEmail,fatherEmail:student.fatherEmail?.primaryEmail,motherEmail:student.motherEmail?.primaryEmail}))};
 }catch{return {ok:false,error:'חיפוש התלמידים נכשל. אפשר לנסות שוב.'};}
}

export async function reopenDetailRequestAction(form){const id=String(form.get('id')||'');await reopenDetailBatch(await requireAuthenticatedUser(),id);revalidatePath('/detail-requests');revalidatePath('/detail-requests/'+id);}

export async function appendDetailStudentsAction(id,input){try{const result=await appendDetailStudents(await requireAuthenticatedUser(),String(id),input);revalidatePath('/detail-requests');revalidatePath('/detail-requests/'+id);return {ok:true,...result};}catch(error){return {ok:false,error:error instanceof DetailRequestError?error.message:'הוספת התלמידים נכשלה. יש לנסות שוב.'};}}
export async function sendAddedDetailRequestsAction(id,requestIds){try{return {ok:true,...await sendDetailChunk(await requireAuthenticatedUser(),String(id),false,requestIds)};}catch{return {ok:false,error:'השליחה לא הושלמה. ניתן להמשיך מעמוד הבקשה.'};}}
