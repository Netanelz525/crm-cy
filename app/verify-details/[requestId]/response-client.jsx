'use client';
import WeddingDateInput from '../../../components/wedding-date-input';
import {weddingDateLabel} from '../../../lib/wedding-date';
import {useState} from 'react';
import {DETAIL_FIELDS} from '../../../lib/detail-request-fields';
import {ENUM_LABELS} from '../../../lib/student-fields';
import {respondToDetailRequestAction} from './actions';
export default function DetailResponseClient({request}){
 const [values,setValues]=useState(request.values),[pending,setPending]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const married=Object.hasOwn(values,'famliystatus')?values.famliystatus==='MARRIED':request.is_married;
 const visibleKeys=request.field_keys.filter(key=>!DETAIL_FIELDS.find(field=>field.key===key)?.marriedOnly||married);
 if(done)return <div role="status"><h2>תודה, המענה נשמר בהצלחה</h2><p>האישור או העדכון נרשמו במערכת.</p></div>;
 return <form style={{display:'grid',gap:16}} onSubmit={async event=>{event.preventDefault();if(pending)return;setPending(true);setError('');try{const result=await respondToDetailRequestAction(request.id,Object.fromEntries(visibleKeys.map(key=>[key,values[key]||''])),request.revision);if(result.ok)setDone(true);else setError(result.error);}catch{setError('השמירה לא הושלמה. בדוק את החיבור ונסה שוב.');}finally{setPending(false);}}}>
 {visibleKeys.map(key=>{const field=DETAIL_FIELDS.find(field=>field.key===key);const value=values[key]||'',disabled=pending||request.mode==='verify';if(key==='weddingDate')return <fieldset key={key} style={{border:'1px solid #d6e2ef',borderRadius:12,padding:14}}><legend>{field.label}</legend>{request.mode==='verify'?<p>{weddingDateLabel(value)}</p>:<WeddingDateInput disabled={disabled} value={value} onChange={value=>setValues({...values,[key]:value})}/>}</fieldset>;return <label key={key}>{field.label}{request.mode==='verify'?<div style={{padding:12,background:'#f3f7fc',borderRadius:10,whiteSpace:'pre-wrap'}}>{ENUM_LABELS[field.enum]?.[value]||value||'לא הוזן'}</div>:field.enum?<select disabled={disabled} value={value} onChange={event=>setValues({...values,[key]:event.target.value})}><option value="">ללא ערך</option>{Object.entries(ENUM_LABELS[field.enum]||{}).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select>:field.key==='note'||field.isList?<textarea disabled={disabled} value={value} maxLength={10000} onChange={event=>setValues({...values,[key]:event.target.value})}/>:<input disabled={disabled} type={field.type==='date'?'date':field.type==='number'?'number':'text'} min={field.type==='number'?0:undefined} maxLength={10000} value={value} onChange={event=>setValues({...values,[key]:event.target.value})}/>}</label>;})}
 <label style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" required disabled={pending}/>בדקתי את הפרטים ואני מאשר/ת שהם נכונים</label>{error&&<p role="alert" style={{color:'#b42318'}}>{error} <button type="button" onClick={()=>window.location.reload()}>רענן פרטים</button></p>}<button className="btn" disabled={pending}>{pending?'שומר…':request.mode==='verify'?'אישור הפרטים':'אישור ושמירת הפרטים'}</button>
 </form>;
}
