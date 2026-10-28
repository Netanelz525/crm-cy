'use server';
import {revalidatePath} from 'next/cache';
import {requireAuthenticatedUser} from '../../lib/rbac';
import {getNeonStudentById,updateNeonStudentViaTwenty} from '../../lib/neon-students';
import {studentQuickPatch} from '../../lib/student-quick-edit';
export async function quickEditStudentAction({studentId,columnKey,values}){
 const user=await requireAuthenticatedUser();
 if(user.access_status!=='approved'||(!user.is_team_member&&!user.is_manager))return {ok:false,error:'אין הרשאה לעריכת תלמידים.'};
 try {
  const current=await getNeonStudentById(String(studentId||''));if(!current)return {ok:false,error:'התלמיד לא נמצא.'};
  const patch=studentQuickPatch(current,columnKey,values);
  const student=await updateNeonStudentViaTwenty(current.id,patch);if(!student)return {ok:false,error:'שמירת התלמיד נכשלה.'};
  revalidatePath('/neon');revalidatePath('/neon/students/'+current.id);
  return {ok:true,student};
 }catch{return {ok:false,error:'השמירה נכשלה. יש לבדוק את הערכים ולנסות שוב.'};}
}
