'use server';
import {revalidatePath} from 'next/cache';
import {requireAuthenticatedUser} from '../../lib/rbac';
import {DetailRequestError} from '../../lib/detail-request-fields';
import {createDetailBatch,sendDetailChunk,closeDetailBatch} from '../../lib/detail-requests';
export async function createDetailRequestAction(input){try{const id=await createDetailBatch(await requireAuthenticatedUser(),input);revalidatePath('/detail-requests');return {ok:true,id};}catch(error){return {ok:false,error:error instanceof DetailRequestError?error.message:'יצירת הבקשה נכשלה. יש לנסות שוב.'};}}
export async function sendDetailRequestChunkAction(id,retry=false){try{const result=await sendDetailChunk(await requireAuthenticatedUser(),String(id),Boolean(retry));revalidatePath('/detail-requests/'+id);return {ok:true,...result};}catch{return {ok:false,error:'השליחה לא הושלמה. ניתן להמשיך מעמוד הבקשה.'};}}
export async function closeDetailRequestAction(form){await closeDetailBatch(await requireAuthenticatedUser(),String(form.get('id')||''));revalidatePath('/detail-requests');revalidatePath('/detail-requests/'+form.get('id'));}
