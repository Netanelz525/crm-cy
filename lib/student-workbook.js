import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import path from 'node:path';
import {gematriyaStrToNum} from '@hebcal/core';
import {FIELD_SECTIONS,ENUM_LABELS} from './student-fields.js';
import {weddingFromGregorian,weddingMonths} from './wedding-date.js';

const norm=value=>String(value??'').normalize('NFKC').replace(/[\u0591-\u05c7]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const xml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const unxml=value=>String(value??'').replace(/&(?:amp|lt|gt|quot|apos);/g,char=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[char]));
const attr=(tag,name)=>unxml(tag.match(new RegExp('\\b'+name+'="([^"]*)"'))?.[1]||'');
const get=(student,key)=>key.split('.').reduce((value,part)=>value?.[part],student);
const fields=FIELD_SECTIONS.flatMap(section=>section.fields);
const aliases=new Map();
for(const field of fields){aliases.set(norm(field.key),field.key);aliases.set(norm(field.label),field.key);}
for(const [key,labels]of Object.entries({tznum:['תז','מספר זהות','תעודת זהות','מספר תעודת זהות','תז תלמיד','מספר זהות תלמיד','student id number','national id','identity number'],weddingDate:['תאריך חתונה','תאריך חתונה לועזי','תאריך חתונה לועזי יום חודש שנה','תאריך נישואים','תאריך נישואין','תאריך נישואין לועזי','wedding date'],weddingDay:['יום עברי','יום חתונה עברי','יום נישואים עברי'],weddingMonth:['חודש עברי','חודש חתונה עברי','חודש נישואים עברי'],weddingYear:['שנה עברית','שנת נישואים עברית'],childrenCount:['מס ילדים','ילדים','כמות ילדים','children count'],bankNum:['בנק','מס בנק','bank number','bank'],senif:['מספר סניף','מס סניף','branch'],accountNum:['מס חשבון','חשבון בנק','מספר חשבון בנק','bank account'],'fullName.firstName':['first name'],'fullName.lastName':['last name'],'email.primaryEmail':['אימייל','מייל','דואל','דואר אלקטרוני','email'],'phone.primaryPhoneNumber':['טלפון','טלפון תלמיד','מספר טלפון','phone']}))for(const label of labels)aliases.set(norm(label),key);
export function studentIdentityKey(value){const text=String(value??'').normalize('NFKC').trim().replace(/^'/,'').replace(/[\s\-\u200e\u200f]/g,'');return /^\d{5,9}$/.test(text)?text.padStart(9,'0'):'';}
export function isStudentWorkbookRequest(text){return /(?:אקסל|excel|xlsx|גיליון|spreadsheet|טבלה|קובץ)/iu.test(text)&&/(?:מלא|מלאי|מילוי|תשלים|השלם|להשלים|השלמת|עדכון|תעדכן|עדכן|fill|complete|populate)/iu.test(text);}
function assertZipSize(bytes){
 // Bound decompressed size before any workbook parser opens the ZIP.
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('הקובץ אינו קובץ XLSX תקין.');let offset=bytes.readUInt32LE(end+16),size=0;const count=bytes.readUInt16LE(end+10);if(count>3000||count===65535)throw Error('האקסל גדול מדי לעיבוד במייל.');
 for(let i=0;i<count;i++){if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('מבנה האקסל אינו תקין.');size+=bytes.readUInt32LE(offset+24);if(size>25*1024*1024)throw Error('האקסל גדול מדי לאחר פתיחה.');offset+=46+bytes.readUInt16LE(offset+28)+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);}
}
function cellValue(sheet,row,col){return sheet[XLSX.utils.encode_cell({r:row,c:col})]?.v;}
function listValues(formula,wb){
 let ref=unxml(formula).replace(/^=/,'');if(ref.startsWith('"')&&ref.endsWith('"'))return ref.slice(1,-1).split(',');
 const named=wb.Workbook?.Names?.find(item=>item.Name===ref);if(named)ref=named.Ref.replace(/^=/,'');
 const match=ref.match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);if(!match)return [];
 const sheet=wb.Sheets[(match[1]||match[2]).replace(/''/g,"'")];if(!sheet)return [];const range=XLSX.utils.decode_range(match[3]+match[4]+':'+match[5]+match[6]);if((range.e.r-range.s.r+1)*(range.e.c-range.s.c+1)>500)return [];
 const out=[];for(let r=range.s.r;r<=range.e.r;r++)for(let c=range.s.c;c<=range.e.c;c++){const value=cellValue(sheet,r,c);if(value!==undefined&&value!=='')out.push(value);}return out;
}
function validations(source,wb){
 const entries=[...source.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)].map(match=>({type:attr(match[1],'type'),operator:attr(match[1],'operator')||'between',sqref:attr(match[1],'sqref'),formula:unxml(match[2].match(/<formula1>([\s\S]*?)<\/formula1>/)?.[1]||''),formula2:unxml(match[2].match(/<formula2>([\s\S]*?)<\/formula2>/)?.[1]||'')}));
 for(const match of source.matchAll(/<x14:dataValidation\b([^>]*)>([\s\S]*?)<\/x14:dataValidation>/g))entries.push({type:attr(match[1],'type'),operator:attr(match[1],'operator')||'between',sqref:unxml(match[2].match(/<xm:sqref>([\s\S]*?)<\/xm:sqref>/)?.[1]||''),formula:unxml(match[2].match(/<xm:f>([\s\S]*?)<\/xm:f>/)?.[1]||'')});
 return entries.filter(entry=>entry.sqref).map(entry=>({...entry,ranges:entry.sqref.split(/\s+/).map(ref=>XLSX.utils.decode_range(ref)),values:entry.type==='list'?listValues(entry.formula,wb):[]}));
}
const validationAt=(lists,row,col)=>lists.find(item=>item.ranges.some(range=>row>=range.s.r&&row<=range.e.r&&col>=range.s.c&&col<=range.e.c));
function allowedValue(value,key,lists,row,col){const list=validationAt(lists,row,col);if(!list)return {value};
 if(['whole','decimal','textLength'].includes(list.type)){
  const actual=list.type==='textLength'?String(value).length:Number(value),min=Number(list.formula),max=Number(list.formula2);let valid=Number.isFinite(actual)&&Number.isFinite(min);
  if(list.type==='whole')valid=valid&&Number.isInteger(actual);
  const compare={between:actual>=min&&actual<=max,notBetween:actual<min||actual>max,equal:actual===min,notEqual:actual!==min,lessThan:actual<min,lessThanOrEqual:actual<=min,greaterThan:actual>min,greaterThanOrEqual:actual>=min};
  return valid&&compare[list.operator]?{value}:{error:true};
 }
 if(list.type==='custom'){
  if(value?.date&&/LEN\(|MID\(/i.test(list.formula)){
   const raw=value.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||raw<'1900-01-01'||(/TODAY\(/i.test(list.formula)&&raw>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date())))return {error:true};
   return {value};
  }
  // Never evaluate formulas supplied in attachments or silently bypass unknown validators.
  return {error:true};
 }
 if(list.type!=='list')return {error:true};if(!list.values.length)return {error:true};
 let match=list.values.find(item=>norm(item)===norm(value));
 if(match===undefined&&key==='bankNum')match=list.values.find(item=>String(item).match(/^\s*0*(\d+)\s*[-–]/)?.[1]===String(Number(value)));
 if(match===undefined&&['weddingDay','weddingYear'].includes(key))match=list.values.find(item=>{let num=/^\d+$/.test(String(item))?Number(item):gematriyaStrToNum(String(item).replace(/[׳״]/g,match=>match==='׳'?"'":'"'));if(key==='weddingYear'&&num<1000)num+=5000;return num===Number(value);});
 if(match===undefined&&key==='weddingMonth')match=list.values.find(item=>norm(item).replace(/ו/g,'')===norm(value).replace(/ו/g,''));
 return match===undefined?{error:true}:{value:match};}
function fieldValue(student,key){
 if((key.startsWith('wedding')||key==='childrenCount')&&student.famliystatus!=='MARRIED')return null;
 if(key.startsWith('wedding')){if(!student.weddingDate)return null;try{const date=weddingFromGregorian(student.weddingDate);return key==='weddingDate'?{date:date.gregorian}:key==='weddingDay'?date.day:key==='weddingYear'?date.year:weddingMonths(date.year).find(month=>month.value===date.month)?.label;}catch{return null;}}
 const field=fields.find(item=>item.key===key),value=get(student,key);if(value===undefined||value===null||value==='')return null;
 if(field?.type==='date')return {date:String(value).slice(0,10)};
 if(field?.enum)return ENUM_LABELS[field.enum]?.[value]||value;
 return Array.isArray(value)?value.join(', '):value;
}
function patchCells(source,changes){
 const remaining=new Map(changes);
 source=source.replace(/<c\b[^>]*\br="([^"]+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,(old,address)=>{if(!remaining.has(address))return old;const next=remaining.get(address);remaining.delete(address);return next;});
 const byRow=new Map();for(const[address,cell]of remaining){const row=Number(address.match(/\d+$/)[0]);if(!byRow.has(row))byRow.set(row,[]);byRow.get(row).push([address,cell]);}
 return source.replace(/<row\b([^>]*\br="(\d+)"[^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g,(old,attributes,row,body='')=>{const extra=byRow.get(Number(row));if(!extra)return old;let content=body;for(const[address,cell]of extra){const col=XLSX.utils.decode_cell(address).c;let inserted=false;content=content.replace(/<c\b[^>]*\br="([^"]+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,(existing,target)=>{if(!inserted&&XLSX.utils.decode_cell(target).c>col){inserted=true;return cell+existing;}return existing;});if(!inserted)content+=cell;}return `<row${attributes}>${content}</row>`;});
}
function dateStyles(source){let styles=source;const xfs=styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);if(!xfs)throw Error('סגנונות התאריך באקסל אינם נתמכים.');const entries=[...xfs[1].matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match=>match[0]);const cache=new Map();let formatId=Math.max(163,...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(match=>Number(match[1])))+1;let used=false;
 return {style(base=0){if(cache.has(base))return cache.get(base);used=true;const original=entries[base]||entries[0];let next=original.replace(/\bnumFmtId="\d+"/,'numFmtId="'+formatId+'"').replace(/\sapplyNumberFormat="[^"]*"/,'');next=next.replace('<xf ','<xf applyNumberFormat="1" ');const index=entries.length;entries.push(next);cache.set(base,index);return index;},finish(){if(!used)return source;const fmt=`<numFmt numFmtId="${formatId}" formatCode="dd/mm/yyyy"/>`;if(/<numFmts\b[^>]*\/>/.test(styles))styles=styles.replace(/<numFmts\b[^>]*\/>/,`<numFmts count="1">${fmt}</numFmts>`);else if(styles.includes('</numFmts>'))styles=styles.replace(/<numFmts\b([^>]*)>([\s\S]*?)<\/numFmts>/,(_m,a,body)=>`<numFmts${a.replace(/count="\d+"/,'count="'+((body.match(/<numFmt\b/g)||[]).length+1)+'"')}>${body}${fmt}</numFmts>`);else styles=styles.replace(/(<styleSheet\b[^>]*>)/,'$1<numFmts count="1">'+fmt+'</numFmts>');return styles.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,`<cellXfs count="${entries.length}">${entries.join('')}</cellXfs>`);}};
}
export async function completeStudentWorkbook({bytes,filename,students,overwrite=false}){
 bytes=Buffer.from(bytes);if(!/\.xlsx$/i.test(filename)||bytes.length>10*1024*1024)throw Error('ניתן להשלים קובץ XLSX עד 10MB.');assertZipSize(bytes);
 const zip=await JSZip.loadAsync(bytes);if(Object.keys(zip.files).some(name=>/vbaProject\.bin$/i.test(name)))throw Error('אין תמיכה בקובצי מאקרו.');const wb=XLSX.read(bytes,{type:'buffer',cellStyles:true,cellFormula:true,cellDates:false});if(wb.Workbook?.WBProps?.date1904)throw Error('לוח התאריכים של הקובץ אינו נתמך כרגע.');
 const ids=new Map();for(const student of students){const id=studentIdentityKey(student.tznum);if(id){if(!ids.has(id))ids.set(id,[]);ids.get(id).push(student);}}
 const relations=await zip.file('xl/_rels/workbook.xml.rels')?.async('string'),book=await zip.file('xl/workbook.xml')?.async('string'),style=await zip.file('xl/styles.xml')?.async('string');if(!relations||!book||!style)throw Error('מבנה קובץ האקסל אינו נתמך.');const styles=dateStyles(style),report={matched:0,filled:0,missing:0,notFound:0,ambiguous:0,invalid:0,skippedSheets:[],unsupported:new Set(),issues:[]};let totalRows=0;
 for(const sheetTag of book.match(/<sheet\b[^>]*\/?\s*>/g)||[]){const name=attr(sheetTag,'name'),relId=attr(sheetTag,'r:id'),relation=(relations.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(tag=>attr(tag,'Id')===relId);const target=relation&&attr(relation,'Target');if(!target||attr(relation,'TargetMode')==='External')continue;const filePath=target.startsWith('/')?target.slice(1):path.posix.normalize('xl/'+target);if(!filePath.startsWith('xl/worksheets/'))continue;const entry=zip.file(filePath),sheet=wb.Sheets[name];if(!entry||!sheet?.['!ref'])continue;let source=await entry.async('string');const bounds=XLSX.utils.decode_range(sheet['!ref']);if(bounds.e.r>10000||bounds.e.c>150)throw Error('הגיליון גדול מדי לעיבוד אוטומטי במייל.');
 let header=null;for(let row=bounds.s.r;row<=Math.min(bounds.e.r,bounds.s.r+39);row++){const columns=[];for(let col=bounds.s.c;col<=bounds.e.c;col++){const label=cellValue(sheet,row,col);if(label!==undefined&&label!=='')columns.push({col,label:String(label),key:aliases.get(norm(label))});}if(columns.filter(item=>item.key==='tznum').length===1&&columns.filter(item=>item.key).length>=2){header={row,columns};break;}}
 if(!header)continue;if(!/<sheetData(?:\s|>)/.test(source)||source.includes('<sheetProtection')){report.skippedSheets.push(name);continue;}const lists=validations(source,wb),changes=new Map(),idCol=header.columns.find(item=>item.key==='tznum').col;for(const column of header.columns)if(!column.key)report.unsupported.add(column.label);
 for(let row=header.row+1;row<=bounds.e.r;row++){const raw=cellValue(sheet,row,idCol);if(raw===undefined||raw==='')continue;if(++totalRows>500)throw Error('אפשר להשלים עד 500 תלמידים בכל קובץ.');const id=studentIdentityKey(raw),matches=ids.get(id)||[];if(!id||matches.length!==1){const type=!id?'invalid':matches.length>1?'ambiguous':'notFound';report[type]++;report.issues.push(`${name}: שורה ${row+1} — ${type==='invalid'?'מספר זהות לא תקין':type==='ambiguous'?'כמה תלמידים בעלי אותו מספר זהות':'לא נמצאה התאמה לפי מספר הזהות'}`);continue;}report.matched++;const student=matches[0];
 for(const column of header.columns){const {key,col}=column;if(!key||key==='tznum')continue;const address=XLSX.utils.encode_cell({r:row,c:col}),cell=sheet[address];if(cell?.f||(!overwrite&&cell?.v!==undefined&&cell.v!==null&&cell.v!==''))continue;if(sheet['!merges']?.some(range=>row>=range.s.r&&row<=range.e.r&&col>=range.s.c&&col<=range.e.c))continue;
 let value=fieldValue(student,key);if(value===null||value===undefined||value===''){report.missing++;continue;}const check=allowedValue(value,key,lists,row,col);if(check.error){report.missing++;report.issues.push(`${name}: שורה ${row+1}, ${column.label} — הערך במערכת אינו תואם לכללי האימות בקובץ`);continue;}value=check.value;
 const validation=validationAt(lists,row,col);
 if(value?.date&&validation?.type==='custom'&&/LEN\(|MID\(/i.test(validation.formula)){const [year,month,day]=value.date.split('-');value=day+'/'+month+'/'+year;}
 const columnStyle=(source.match(/<col\b[^>]*\/?\s*>/g)||[]).find(tag=>col+1>=Number(attr(tag,'min'))&&col+1<=Number(attr(tag,'max')));
 const existing=source.match(new RegExp('<c\\b[^>]*\\br="'+address+'"[^>]*'))?.[0]||'',base=Number(attr(existing,'s')||attr(columnStyle||'','style')||sheet['!cols']?.[col]?.style||0);let s=base?` s="${base}"`:'';let content;
 if(value?.date){const date=String(value.date);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){report.missing++;continue;}s=` s="${styles.style(base)}"`;content=`<v>${(Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000}</v>`;}
 else if(typeof value==='number'&&Number.isFinite(value)){content=`<v>${value}</v>`;}
 else {s+=' t="inlineStr"';content=`<is><t xml:space="preserve">${xml(value)}</t></is>`;}
 changes.set(address,`<c r="${address}"${s}>${content}</c>`);report.filled++;
 }}if(changes.size)zip.file(filePath,patchCells(source,changes));
 }
 if(!totalRows)throw Error('לא נמצאה טבלת תלמידים עם עמודת תעודת זהות וכותרות מזוהות. יש לציין כותרות ברורות בשורה אחת.');zip.file('xl/styles.xml',styles.finish());
 const output=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});return {bytes:output,filename:filename.replace(/\.xlsx$/i,' - הושלם.xlsx'),report:{...report,unsupported:[...report.unsupported]}};
}
