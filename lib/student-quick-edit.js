import {FIELD_SECTIONS,ENUM_LABELS} from './student-fields';
const definitions=Object.fromEntries(FIELD_SECTIONS.flatMap(section=>section.fields).map(field=>[field.key,field]));
const columns={missing:['tznum','dateofbirth','dadPhone.primaryPhoneNumber','dadPhone.primaryPhoneCallingCode','fatherEmail.primaryEmail','momPhone.primaryPhoneNumber','momPhone.primaryPhoneCallingCode','motherEmail.primaryEmail'],class:['class'],tznum:['tznum'],fatherTz:['tzaba'],motherTz:['tzMotherNum'],institution:['currentInstitution'],registration:['registration'],macAddress:['macAddress'],studentPhone:['phone.primaryPhoneNumber','phone.primaryPhoneCallingCode'],dadPhone:['dadPhone.primaryPhoneNumber','dadPhone.primaryPhoneCallingCode'],momPhone:['momPhone.primaryPhoneNumber','momPhone.primaryPhoneCallingCode'],studentEmail:['email.primaryEmail'],fatherEmail:['fatherEmail.primaryEmail'],motherEmail:['motherEmail.primaryEmail'],address:FIELD_SECTIONS.find(section=>section.title==='כתובת').fields.map(field=>field.key),bankDetails:['bankNum','senif','accountNum']};
export function studentQuickFields(columnKey){
 const keys=columnKey?.startsWith('field:')?[columnKey.slice(6)]:columns[columnKey]||[];
 return keys.map(key=>definitions[key]).filter(Boolean);
}
function setPath(target,key,value){const parts=key.split('.');let object=target;for(const part of parts.slice(0,-1))object=object[part]??={};object[parts.at(-1)]=value;}
export function studentQuickPatch(student,columnKey,values){
 const fields=studentQuickFields(columnKey);if(!fields.length||!values||typeof values!=='object'||Array.isArray(values))throw Error('השדה אינו ניתן לעריכה.');
 if(Object.keys(values).some(key=>!fields.some(field=>field.key===key)))throw Error('נשלחו שדות שאינם שייכים לעריכה.');
 const patch={};
 for(const field of fields){
  if(!Object.hasOwn(values,field.key))continue;
  if(typeof values[field.key]!=='string')throw Error('ערך השדה אינו תקין.');
  let value=values[field.key].trim();if(value.length>10000)throw Error('ערך השדה ארוך מדי.');
  if(field.enum){if(value&&!Object.hasOwn(ENUM_LABELS[field.enum]||{},value))throw Error('יש לבחור ערך מהרשימה.');value=value||null;}
  else if(field.type==='date'){if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('התאריך אינו תקין.');value=value?value+'T00:00:00.000Z':null;}
  else if(field.type==='number'){if(value&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))))throw Error('יש להזין מספר שלם וחיובי.');value=value===''?null:Number(value);}
  else if(field.isList)value=value.split(/[,\n]/).map(item=>item.trim()).filter(Boolean);
  setPath(patch,field.key,value);
 }
 if(!Object.keys(patch).length)throw Error('לא נבחר ערך לעדכון.');
 if(patch.fullName){const name={...student.fullName,...patch.fullName};patch.name=[name.firstName,name.lastName].filter(Boolean).join(' ');}
 return patch;
}
