'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAppUser } from '../../lib/rbac';
import { saveCommand,runCommand } from '../../lib/commands';
import { parseCommandCurl,validateCommandRequest,CommandValidationError } from '../../lib/command-request';

export async function saveCommandAction(_previous,form) {
  const user=await getCurrentAppUser();
  if(!user?.is_super_admin || user.access_status!=='approved')return {error:'אין הרשאת ניהול פקודות.'};
  let requestConfig;
  try {
    const curl=String(form.get('curl')||'').trim(),url=String(form.get('url')||'').trim();
    if(curl && url)return {error:'יש להזין פקודת cURL או כתובת בשדות הבקשה, לא את שניהם.'};
    if(curl)requestConfig=parseCommandCurl(curl);
    else if(url) {
      let headers;try{headers=JSON.parse(String(form.get('headers')||'{}'));}catch{return {error:'כותרות הבקשה אינן JSON תקין.'};}
      requestConfig=validateCommandRequest({url,method:form.get('method'),headers,body:form.get('body')});
    }
    await saveCommand(user,{id:String(form.get('id')||'')||null,name:form.get('name'),description:form.get('description'),enabled:form.get('enabled')==='on',allowedUserIds:form.getAll('allowedUserIds').map(String),requestConfig});
  } catch(error) {
    // Never surface infrastructure errors: driver errors may contain SQL parameters/secrets.
    return {error:error instanceof CommandValidationError?error.message:'שמירת הפקודה נכשלה. יש לבדוק את ההגדרות ולנסות שוב.'};
  }
  revalidatePath('/commands');redirect('/commands?result=saved');
}
export async function runCommandAction(form) {
  const user=await getCurrentAppUser();let code='failed';
  try {code=(await runCommand(user,String(form.get('id')||''))).code;}catch{}
  revalidatePath('/commands');redirect('/commands?result='+code);
}
