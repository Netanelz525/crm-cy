'use client';
import WeddingDateInput from '../../components/wedding-date-input';
import {useState,useRef,useEffect} from 'react';
import {createPortal} from 'react-dom';
import {ENUM_LABELS,studentToFormValues} from '../../lib/student-fields';
import {studentQuickFields} from '../../lib/student-quick-edit';
import {quickEditStudentAction} from './quick-edit-action';
export default function QuickStudentCell({student,columnKey,label,children,onSaved}){
 const [open,setOpen]=useState(false),[values,setValues]=useState({}),[pending,setPending]=useState(false),[error,setError]=useState('');
 const dialog=useRef(null),trigger=useRef(null);const fields=studentQuickFields(columnKey);
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 function close(){if(pending)return;setOpen(false);trigger.current?.focus();}
 if(!fields.length||fields.some(field=>field.marriedOnly)&&student.famliystatus!=='MARRIED')return children;
 return <><span className="quick-student-value quick-student-editable"><span className="quick-student-text">{children}</span><button ref={trigger} type="button" className="quick-student-pencil" aria-label={'עריכת '+label+' עבור '+student.label} title={'עריכת '+label} onClick={()=>{setValues(studentToFormValues(student));setError('');setOpen(true);}}>✎</button></span>
 {open&&createPortal(<dialog ref={dialog} className="quick-student-dialog" onCancel={event=>{event.preventDefault();close();}} aria-label={'עריכת '+label}>
 <form onSubmit={async event=>{event.preventDefault();setPending(true);setError('');try{const selected=Object.fromEntries(fields.map(field=>[field.key,values[field.key]||'']));const result=await quickEditStudentAction({studentId:student.id,columnKey,values:selected});if(!result.ok){setError(result.error);return;}onSaved(result.student);setOpen(false);trigger.current?.focus();}catch{setError('השמירה נכשלה. ניתן לנסות שוב.');}finally{setPending(false);}}}>
 <h2>עריכת {label}</h2><p>{student.label}</p>
 {fields.map(field=>field.key==='weddingDate'?<fieldset key={field.key} style={{border:0,padding:0}}><legend>{field.label}</legend><WeddingDateInput disabled={pending} value={values[field.key]||''} onChange={value=>setValues({...values,[field.key]:value})}/></fieldset>:<label key={field.key}>{field.label}{field.enum?<select autoFocus={fields[0]===field} disabled={pending} value={values[field.key]||''} onChange={event=>setValues({...values,[field.key]:event.target.value})}><option value="">ללא ערך</option>{Object.entries(ENUM_LABELS[field.enum]||{}).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select>:<input autoFocus={fields[0]===field} disabled={pending} type={field.type==='date'?'date':field.type==='number'?'number':'text'} min={field.type==='number'?0:undefined} maxLength={10000} value={values[field.key]||''} onChange={event=>setValues({...values,[field.key]:event.target.value})}/>}</label>)}
 {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}<div className="quick-actions"><button type="submit" disabled={pending}>{pending?'שומר…':'שמור'}</button><button type="button" className="btn btn-ghost" disabled={pending} onClick={close}>ביטול</button></div>
 </form></dialog>,document.body)}</>;
}
