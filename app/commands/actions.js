'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAppUser } from '../../lib/rbac';
import { saveCommand,runCommand,saveCommandKey,duplicateCommand } from '../../lib/commands';
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
      if(!headers || typeof headers!=='object' || Array.isArray(headers))return {error:'כותרות הבקשה צריכות להיות אובייקט JSON.'};
      let body=String(form.get('body')||'');
      const bodyFormat=String(form.get('bodyFormat')||'text');
      if(bodyFormat==='json' && (String(form.get('method')).toUpperCase()!=='GET'||body.trim())) {
        body=body.trim()?body:'{}';
        try {JSON.parse(body);}catch{return {error:'גוף הבקשה אינו JSON תקין.'};}
        if(!Object.keys(headers||{}).some(name=>name.toLowerCase()==='content-type'))headers={...headers,'Content-Type':'application/json'};
      }
      requestConfig=validateCommandRequest({url,method:form.get('method'),headers,body,bodyFormat,responseType:String(form.get('responseType')||'auto')});
    }
    const keyId=String(form.get('keyId')||'');
    if(keyId==='__new')return {error:'יש לשמור את המפתח במאגר לפני שמירת הפקודה.'};
    await saveCommand(user,{responseType:String(form.get('responseType')||'auto'),keyId:keyId||null,keyType:String(form.get('keyType')||'bearer'),keyParameter:String(form.get('keyParameter')||'').trim(),id:String(form.get('id')||'')||null,name:form.get('name'),description:form.get('description'),enabled:form.get('enabled')==='on',allowedUserIds:form.getAll('allowedUserIds').map(String),requestConfig});
  } catch(error) {
    // Never surface infrastructure errors: driver errors may contain SQL parameters/secrets.
    return {error:error instanceof CommandValidationError?error.message:'שמירת הפקודה נכשלה. יש לבדוק את ההגדרות ולנסות שוב.'};
  }
  revalidatePath('/commands');const id=String(form.get('id')||'');if(id)revalidatePath('/commands/'+encodeURIComponent(id));redirect(id?'/commands/'+encodeURIComponent(id)+'?result=saved':'/commands?result=saved');
}
export async function runCommandAction(form) {
  const user=await getCurrentAppUser();let code='failed';
  try {code=(await runCommand(user,String(form.get('id')||''))).code;}catch{}
  const id=String(form.get('id')||'');revalidatePath('/commands');if(id)revalidatePath('/commands/'+encodeURIComponent(id));redirect('/commands/'+encodeURIComponent(id)+'?result='+code);
}

export async function saveCommandKeyAction(_previous,form) {
  const user=await getCurrentAppUser();
  if(!user?.is_super_admin || user.access_status!=='approved')return {error:'אין הרשאה לניהול מאגר המפתחות.'};
  try {
    const savedKey=await saveCommandKey(user,{id:String(form.get('vaultId')||'')||null,name:form.get('vaultName'),value:String(form.get('vaultValue')||''),enabled:form.get('vaultEnabled')==='on'});
    revalidatePath('/commands');return {savedKey};
  } catch(error) {return {error:error instanceof CommandValidationError?error.message:'שמירת המפתח נכשלה.'};}
}

export async function duplicateCommandAction(form) {
  const user=await getCurrentAppUser();
  let id;try {id=await duplicateCommand(user,String(form.get('id')||''));}
  catch {redirect('/commands?result=failed');}
  revalidatePath('/commands');redirect('/commands/'+encodeURIComponent(id)+'?result=duplicated');
}
