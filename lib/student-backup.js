import * as XLSX from 'xlsx';
import { FIELD_SECTIONS, ENUM_LABELS } from './student-fields.js';
import { stripBackupFileContent } from './backup-policy.js';

const fields=FIELD_SECTIONS.flatMap(section=>section.fields||[]);
const metadataLabels={id:'מזהה רשומה',student_id:'מזהה תלמיד',created_at:'נוצר בתאריך',updated_at:'עודכן בתאריך'};
const CELL_LIMIT=30000;
function flatten(value,prefix='',output={}) {
  for(const [key,item] of Object.entries(value||{})) {
    const path=prefix?`${prefix}.${key}`:key;
    if(item && typeof item==='object' && !Array.isArray(item) && !(item instanceof Date)) {
      if(Object.keys(item).length)flatten(item,path,output);else output[path]='{}';
    } else output[path]=item;
  }
  return output;
}
function cell(value) {
  if(value===null||value===undefined)return '';
  if(value instanceof Date)return value.toISOString();
  const result=typeof value==='object'?JSON.stringify(value):value;
  return typeof result==='string'&&result.length>CELL_LIMIT?`${result.slice(0,CELL_LIMIT)}… (הערך המלא בגיליון נתוני מקור)`:result;
}
export function buildStudentBackupFile(payload) {
  const source=payload?.data?.neon_students;
  if(!Array.isArray(source))throw Error('גיבוי התלמידים נעצר: טבלת neon_students חסרה ביצוא.');
  if(payload?.counts?.neon_students!==source.length)throw Error('גיבוי התלמידים נעצר: מספר הרשומות אינו תואם את נתוני היצוא.');
  const rows=source.map(row=>stripBackupFileContent(row));
  const flattened=rows.map(row=>flatten(row));
  const present=new Set(flattened.flatMap(row=>Object.keys(row)));
  const preferred=['id','student_id',...fields.map(field=>`payload.${field.key}`),'created_at','updated_at'];
  const keys=[...new Set([...preferred.filter(key=>present.has(key)),...present])];
  if(!keys.length)keys.push('id');
  const used=new Set();
  const headers=keys.map(key=>{
    const field=fields.find(field=>`payload.${field.key}`===key);
    let label=field?.label||metadataLabels[key]||key.replace(/^payload\./,'');
    if(used.has(label))label=`${label} (${key})`;used.add(label);return label;
  });
  const data=[['גיבוי פרטי תלמידים'],['מועד יצוא',payload.exportedAt,'מספר רשומות',rows.length],[],headers];
  for(const row of flattened)data.push(keys.map(key=>{
    const field=fields.find(field=>`payload.${field.key}`===key),value=row[key];
    return field?.enum&&ENUM_LABELS[field.enum]?.[value]?`${ENUM_LABELS[field.enum][value]} (${value})`:cell(value);
  }));
  const workbook=XLSX.utils.book_new();
  workbook.Workbook={Views:[{RTL:true}]};
  const sheet=XLSX.utils.aoa_to_sheet(data);
  for(const [address,value] of Object.entries(sheet))if(!address.startsWith('!') && value.t==='s')value.z='@';
  sheet['!cols']=keys.map(key=>({wch:/note|address|email/i.test(key)?36:24}));
  sheet['!rows']=[{hpt:28},{hpt:22},{hpt:10},{hpt:28}];
  sheet['!autofilter']={ref:XLSX.utils.encode_range({r:3,c:0},{r:Math.max(3,data.length-1),c:keys.length-1})};
  XLSX.utils.book_append_sheet(workbook,sheet,'תלמידים');
  // Raw records are split at Excel's cell limit, rather than silently truncating long notes/arrays.
  const raw=[['מספר רשומה','מזהה תלמיד','חלק','מספר חלקים','נתוני מקור JSON']];
  rows.forEach((row,index)=>{
    const json=JSON.stringify(row),chunks=[];
    for(let start=0;start<json.length;) {
      let end=Math.min(start+CELL_LIMIT,json.length);
      if(end<json.length && /[\uD800-\uDBFF]/.test(json[end-1]))end--;
      chunks.push(json.slice(start,end));start=end;
    }
    chunks.forEach((chunk,part)=>raw.push([index+1,String(row.student_id??row.id??''),part+1,chunks.length,chunk]));
  });
  const rawSheet=XLSX.utils.aoa_to_sheet(raw);
  for(const [address,value] of Object.entries(rawSheet))if(!address.startsWith('!') && value.t==='s')value.z='@';rawSheet['!cols']=[{wch:16},{wch:28},{wch:10},{wch:14},{wch:100}];
  XLSX.utils.book_append_sheet(workbook,rawSheet,'נתוני מקור');
  const exportedAt=String(payload.exportedAt||Date.now()).replace(/[:.]/g,'-');
  return {filename:`crm-students-${exportedAt}.xlsx`,buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true}),count:rows.length};
}
