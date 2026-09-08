"use client";
import { useEffect, useState } from "react";
import { FIELD_SECTIONS, ENUM_LABELS } from "../../../lib/student-fields";

export default function CallStudentEditor({lead,request,disabled,onSaved,onClose,onBusy}) {
  const [original,setOriginal]=useState(null), [values,setValues]=useState({}), [version,setVersion]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[query,setQuery]=useState("");
  useEffect(()=>{
    let alive=true;
    request({kind:"details",studentId:lead.studentId,token:lead.token}).then(result=>{
      if(alive){setOriginal(result.values);setValues(result.values);setVersion(result.version);}
    }).catch(failure=>{if(alive)setError(failure.message);});
    return()=>{alive=false;};
  },[lead.studentId,lead.token]);
  async function save(event){
    event.preventDefault();if(busy || disabled)return;
    const fields=Object.fromEntries(Object.entries(values).filter(([key,value])=>value!==(original[key] || "")));
    if(!Object.keys(fields).length){setError("לא שונו פרטים.");return;}
    setBusy(true);onBusy(true);setError("");
    try{await request({kind:"update_student",studentId:lead.studentId,token:lead.token,version,fields});await onSaved();}
    catch(failure){setError(failure.message || "השמירה נכשלה.");}finally{setBusy(false);onBusy(false);}
  }
  return <section className="card"><h3>עדכון פרטי {lead.name}</h3>
    <p className="muted">השינויים נשמרים בכרטיס התלמיד במערכת. ניתן לשמור רק במהלך ההקצאה ובמפגש פתוח.</p>
    {error?<p role="alert" className="error">{error}</p>:null}
    {!original?<p>טוען פרטי תלמיד…</p>:<form onSubmit={save}>
      <fieldset disabled={busy || disabled} style={{border:0,padding:0}}>
        <label>חיפוש שדה<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="שם, טלפון, מוסד…"/></label>
        {FIELD_SECTIONS.map(section=>{
          const fields=section.fields.filter(field=>!query || field.label.includes(query.trim()));
          if(!fields.length)return null;
          return <details key={section.title} open={Boolean(query)||undefined}><summary>{section.title}</summary><div className="grid">
            {fields.map(field=><label key={field.key}>{field.label}
              {field.enum?<select value={values[field.key]||""} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}>
                <option value="">ללא ערך</option>{Object.entries(ENUM_LABELS[field.enum] || {}).map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select>:field.isList || field.key==='note'?<textarea value={values[field.key]||""} maxLength={4000} placeholder={field.isList?"ערכים מופרדים בפסיקים":""} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}/>:<input type={field.type||"text"} min={field.type==='number'?0:undefined} value={values[field.key]||""} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}/>}
            </label>)}
          </div></details>;
        })}
        <button type="submit">{busy?"שומר פרטים…":"שמור פרטי תלמיד"}</button>
      </fieldset>
    </form>}
    <button type="button" disabled={busy} onClick={onClose}>סגור עריכה</button>
  </section>;
}
