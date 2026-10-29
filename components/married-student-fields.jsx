'use client';
import {useEffect,useRef,useState} from 'react';
import WeddingDateInput from './wedding-date-input';
export default function MarriedStudentFields({student={}}){
 const root=useRef(null),[married,setMarried]=useState(String(student.famliystatus||'').toUpperCase()==='MARRIED'),[wedding,setWedding]=useState(student.weddingDate||'');
 useEffect(()=>{const form=root.current?.closest('form');if(!form)return;const update=()=>{const field=form.elements.namedItem('famliystatus');if(field)setMarried(field.value==='MARRIED');};update();form.addEventListener('change',update);return()=>form.removeEventListener('change',update);},[]);
 return <div ref={root}><section className="card" style={{display:married?'block':'none'}}><fieldset disabled={!married} style={{border:0,padding:0}}><h3>פרטי משפחה לתלמיד נשוי</h3><label>מספר ילדים<input type="number" min={0} step={1} name="childrenCount" defaultValue={student.childrenCount??''}/></label><h4>תאריך נישואים</h4><WeddingDateInput value={wedding} onChange={setWedding} name="weddingDate"/></fieldset></section></div>;
}
