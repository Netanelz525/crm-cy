'use client';
import { useActionState,useEffect,useRef } from 'react';
import { saveCommandKeyAction } from './actions';
export default function CommandKeyEditor({record}) {
  const [state,action,pending]=useActionState(saveCommandKeyAction,{}),form=useRef(null);
  useEffect(()=>{if(state.savedKey)form.current?.reset();},[state.savedKey]);
  return <form ref={form} action={action} autoComplete="off" style={{display:'grid',gap:12}}>
    {record&&<input type="hidden" name="vaultId" value={record.id}/>}
    <label>שם המפתח<input name="vaultName" required maxLength={100} defaultValue={record?.name||''} placeholder="לדוגמה: בקרי המזגנים"/></label>
    <label>{record?'מפתח חדש להחלפה (השאר ריק לשמירת הקיים)':'ערך המפתח'}<input name="vaultValue" type="password" autoComplete="new-password" required={!record} maxLength={8192} dir="ltr"/></label>
    <label style={{display:'flex',gap:8,alignItems:'center'}}><input name="vaultEnabled" type="checkbox" defaultChecked={record?.enabled??true} style={{width:18,height:18,margin:0}}/> המפתח פעיל</label>
    <p className="muted">ערך שמור אינו מוצג. החלפה או השבתה משפיעות על כל הפקודות המשתמשות במפתח.</p>
    {state.error&&<p role="alert">{state.error}</p>}{state.savedKey&&<p role="status">המפתח נשמר במאגר.</p>}
    <button type="submit" className="btn" disabled={pending}>{pending?'שומר…':record?'עדכן מפתח':'שמור מפתח במאגר'}</button>
  </form>;
}
