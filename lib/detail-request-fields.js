import {FIELD_SECTIONS,studentToFormValues} from './student-fields';
import {studentQuickPatch} from './student-quick-edit';
export class DetailRequestError extends Error {}
export const DETAIL_FIELDS=FIELD_SECTIONS.flatMap(section=>section.fields);
export function validDetailFields(keys){
 if(!Array.isArray(keys)||!keys.length||keys.length>80)throw new DetailRequestError('יש לבחור שדות.');
 const unique=[...new Set(keys)];if(unique.some(key=>!DETAIL_FIELDS.some(field=>field.key===key)))throw new DetailRequestError('נבחר שדה לא נתמך.');return unique;
}
export function detailValues(student,keys){const all=studentToFormValues(student);return Object.fromEntries(validDetailFields(keys).filter(key=>!DETAIL_FIELDS.find(field=>field.key===key)?.marriedOnly||student.famliystatus==='MARRIED').map(key=>[key,all[key]||'']));}
export function detailPatch(student,keys,values){
 keys=validDetailFields(keys);
 const status=Object.hasOwn(values||{},'famliystatus')&&keys.includes('famliystatus')?values.famliystatus:student.famliystatus;
 keys=keys.filter(key=>!DETAIL_FIELDS.find(field=>field.key===key)?.marriedOnly||status==='MARRIED').sort((a,b)=>(a==='famliystatus'?-1:b==='famliystatus'?1:0));
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(values,key)||typeof values[key]!=='string'))throw new DetailRequestError('יש למלא רק את השדות המבוקשים.');
 let next=student;
 for(const key of keys){if(detailValues(next,[key])[key]===values[key])continue;const patch=studentQuickPatch(next,'field:'+key,{[key]:values[key]});next={...next,...patch};if(key.includes('.')){const root=key.split('.')[0];next[root]={...student[root],...next[root]};student={...student,[root]:next[root]};}}
 return next;
}
export function googleRecipientEmails(user){
 const verified=new Set((user?.emailAddresses||[]).filter(email=>email.verification?.status==='verified').map(email=>String(email.emailAddress).trim().toLowerCase()));
 return [...new Set((user?.externalAccounts||[]).filter(account=>['google','oauth_google'].includes(account.provider)).map(account=>String(account.emailAddress||'').trim().toLowerCase()).filter(email=>verified.has(email)))];
}
