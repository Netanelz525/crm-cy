'use server';
import {auth,currentUser} from '@clerk/nextjs/server';
import {revalidatePath} from 'next/cache';
import {googleRecipientEmails,DetailRequestError} from '../../../lib/detail-request-fields';
import {respondDetailRequest} from '../../../lib/detail-requests';
export async function respondToDetailRequestAction(id,values,revision){
 const session=await auth();if(!session.userId)return {ok:false,error:'יש להתחבר עם חשבון Google.'};
 const user=await currentUser(),emails=googleRecipientEmails(user);if(!emails.length)return {ok:false,error:'יש להתחבר לחשבון Google המתאים.'};
 try{await respondDetailRequest({userId:session.userId,emails},String(id),values,String(revision));revalidatePath('/verify-details/'+id);revalidatePath('/detail-requests');revalidatePath('/neon');return {ok:true};}catch(error){return {ok:false,error:error instanceof DetailRequestError?error.message:'שמירת המענה נכשלה. יש לנסות שוב.'};}
}
