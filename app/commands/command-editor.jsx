'use client';
import { useActionState,useState,useEffect } from 'react';
import { saveCommandAction,saveCommandKeyAction } from './actions';
import {parseCurlInput,extractCurlKey,commandCurlExample} from '../../lib/command-request-input';
const fieldset={minWidth:0,padding:14,border:'1px solid #d6e2ef',borderRadius:12,display:'grid',gap:12};
const checkbox={width:18,height:18,flexShrink:0,margin:0};
export default function CommandEditor({command,users,keys=[]}) {
  const [state,action,pending]=useActionState(saveCommandAction,{});
  const [keyState,keyAction,keyPending]=useActionState(saveCommandKeyAction,{});
  const [search,setSearch]=useState(''),[curl,setCurl]=useState(''),[importError,setImportError]=useState('');
  const [url,setUrl]=useState(''),[method,setMethod]=useState('POST'),[headers,setHeaders]=useState(''),[body,setBody]=useState(''),[bodyFormat,setBodyFormat]=useState('json');
  const [keyId,setKeyId]=useState(command?.key_id||''),[keyType,setKeyType]=useState(command?.key_type||'bearer'),[keyParameter,setKeyParameter]=useState(command?.key_parameter||'');
  const [vaultName,setVaultName]=useState(''),[vaultValue,setVaultValue]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{if(keyState.savedKey){setKeyId(keyState.savedKey.id);setVaultValue('');setVaultName('');}},[keyState.savedKey]);
  const availableKeys=keyState.savedKey&&!keys.some(key=>key.id===keyState.savedKey.id)?[...keys,keyState.savedKey]:keys;
  function importCurl(){
    try {
      const extracted=extractCurlKey(parseCurlInput(curl)),config=extracted.config;
      setUrl(config.url);setMethod(config.method);setHeaders(JSON.stringify(config.headers,null,2));
      try {setBody(config.body?JSON.stringify(JSON.parse(config.body),null,2):'');setBodyFormat('json');}catch{setBody(config.body);setBodyFormat('text');}
      if(extracted.type){setKeyType(extracted.type);setKeyParameter(extracted.parameter);if(!keyId||keyId==='__new'){setKeyId('__new');setVaultValue(extracted.value==='{{COMMAND_KEY}}'?'':extracted.value);}}
      setCurl('');setImportError('');
    } catch {setImportError('לא ניתן לפענח את הדוגמה. יש להדביק בקשת cURL אחת עם URL, כותרות וגוף בקשה נתמכים.');}
  }
  let example='';try{const exampleBody=bodyFormat==='json'&&method!=='GET'&&!body.trim()?'{}':body;const exampleHeaders=JSON.parse(headers||'{}');if(bodyFormat==='json'&&(exampleBody.trim())&&!Object.keys(exampleHeaders).some(name=>name.toLowerCase()==='content-type'))exampleHeaders['Content-Type']='application/json';example=commandCurlExample({url,method,headers:exampleHeaders,body:exampleBody},{hasKey:Boolean(keyId),type:keyType,parameter:keyParameter});}catch{}
  return <form action={action} style={{display:'grid',gap:14}} autoComplete="off">
    {command&&<input type="hidden" name="id" value={command.id}/>}
    <label>שם הפקודה<input name="name" required maxLength={100} defaultValue={command?.name||''} placeholder="לדוגמה: פתיחת מזגן"/></label>
    <label>תיאור לצוות<input name="description" maxLength={500} defaultValue={command?.description||''}/></label>
    <label style={{display:'flex',gap:8,alignItems:'center'}}><input style={checkbox} type="checkbox" name="enabled" defaultChecked={command?.enabled??true}/> הפקודה פעילה</label>
    <fieldset style={fieldset}><legend>משתמשים שיוכלו להפעיל</legend><p className="muted">סופר אדמין יכול להפעיל את כל הפקודות הפעילות.</p>
      <label>חיפוש משתמש<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="חיפוש לפי שם או דוא״ל"/></label>
      <div style={{display:'grid',gap:8,maxHeight:240,overflow:'auto'}}>{users.map(user=><label key={user.clerk_user_id} style={{display:`${user.display_name} ${user.email}`.toLowerCase().includes(search.trim().toLowerCase())?'flex':'none',alignItems:'center',gap:8,overflowWrap:'anywhere'}}><input style={checkbox} type="checkbox" name="allowedUserIds" value={user.clerk_user_id} defaultChecked={command?.allowed_user_ids?.includes(user.clerk_user_id)||false}/> {user.display_name} · {user.email}</label>)}</div>
    </fieldset>
    <fieldset style={fieldset}><legend>מפתח לפקודה</legend>
      <label>מפתח ממאגר המפתחות<select name="keyId" value={keyId} onChange={event=>setKeyId(event.target.value)}><option value="">ללא מפתח שמור</option>{availableKeys.map(key=><option key={key.id} value={key.id}>{key.name}{!key.enabled?' (מושבת)':''}</option>)}<option value="__new">הוספת מפתח חדש למאגר</option></select></label>
      {keyId==='__new'&&<div style={{display:'grid',gap:10}}>
        <label>שם המפתח במאגר<input name="vaultName" maxLength={100} value={vaultName} onChange={event=>setVaultName(event.target.value)} placeholder="לדוגמה: בקרי המזגנים"/></label>
        <label>ערך המפתח<input name="vaultValue" type="password" autoComplete="new-password" dir="ltr" maxLength={8192} value={vaultValue} onChange={event=>setVaultValue(event.target.value)}/></label>
        <input type="hidden" name="vaultEnabled" value="on"/>
        <button type="submit" className="btn" formAction={keyAction} formNoValidate disabled={keyPending||!vaultName.trim()||!vaultValue.trim()}>{keyPending?'שומר מפתח…':'שמור מפתח ובחר אותו לפקודה'}</button>
        {keyState.error&&<p role="alert">{keyState.error}</p>}
      </div>}
      {keyId&&<><label>אופן צירוף המפתח<select name="keyType" value={keyType} onChange={event=>setKeyType(event.target.value)}><option value="bearer">Authorization: Bearer</option><option value="header">כותרת מותאמת (למשל X-API-Key)</option><option value="query">פרמטר בכתובת</option></select></label>{keyType!=='bearer'&&<label>{keyType==='header'?'שם הכותרת':'שם הפרמטר'}<input name="keyParameter" value={keyParameter} onChange={event=>setKeyParameter(event.target.value)} required dir="ltr" maxLength={80} placeholder={keyType==='header'?'X-API-Key':'api_key'}/></label>}</>}
      <p className="muted">אותו מפתח יכול לשמש כמה פקודות. ערכו נוסף לבקשה בשרת בלבד.</p>
    </fieldset>
    <fieldset style={fieldset}><legend>{command?'החלפת הגדרת הבקשה (רשות)':'הגדרת הבקשה'}</legend>
      {command&&<p className="muted">השאר את כתובת הבקשה ריקה כדי לשמור את ההגדרה הקיימת. בחירת מפתח, סוג התשובה והרשאות מתעדכנים גם בלי החלפת הבקשה.</p>}
      <details><summary>טעינת דוגמת cURL לשדות</summary><label>דוגמת cURL<textarea value={curl} onChange={event=>setCurl(event.target.value)} rows={5} dir="ltr" spellCheck={false} placeholder={'curl -X POST https://api.example.com/device/on -H \'Authorization: Bearer TOKEN\' -H \'Content-Type: application/json\' --data-raw \'{"on":true}\''}/></label><button className="btn" type="button" onClick={importCurl} disabled={!curl.trim()}>טען cURL לשדות</button>{importError&&<p role="alert">{importError}</p>}</details>
      <p className="muted">הבקשה נשלחת מהשרת לכתובת HTTPS ציבורית.</p>
      <label>סוג התשובה הצפויה<select name="responseType" defaultValue={command?.response_type||'auto'}><option value="auto">אוטומטי לפי סוג הבקשה</option><option value="api">API / JSON — צפויה תשובת API</option><option value="web">דף אינטרנט — HTML מותר</option></select></label>
      <label>כתובת היעד<input name="url" type="url" dir="ltr" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://api.example.com/device/on"/></label>
      <label>שיטה<select name="method" value={method} onChange={event=>setMethod(event.target.value)}>{['GET','POST','PUT','PATCH','DELETE'].map(item=><option key={item}>{item}</option>)}</select></label>
      <label>כותרות נוספות JSON (ללא המפתח השמור)<textarea name="headers" rows={3} dir="ltr" spellCheck={false} value={headers} onChange={event=>setHeaders(event.target.value)} placeholder={'{"Content-Type":"application/json"}'}/></label>
      <label>סוג גוף הבקשה<select name="bodyFormat" value={bodyFormat} onChange={event=>setBodyFormat(event.target.value)}><option value="json">JSON</option><option value="text">טקסט / פורמט אחר</option></select></label>
      <label>{bodyFormat==='json'?'גוף הבקשה JSON':'גוף הבקשה'}<textarea name="body" rows={6} dir="ltr" spellCheck={false} value={body} onChange={event=>setBody(event.target.value)} placeholder={bodyFormat==='json'?'{"on":true}':''}/></label>
      <details><summary>דוגמת cURL מהשדות</summary><p className="muted">המפתח השמור מיוצג באמצעות {'{{COMMAND_KEY}}'}.</p><textarea readOnly aria-label="דוגמת cURL מהשדות" value={example} rows={7} dir="ltr"/><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(example);setCopied(true);}catch{setCopied(false);}}} disabled={!example}>{copied?'הועתק':'העתק דוגמה'}</button></details>
    </fieldset>
    {state.error&&<p role="alert" style={{color:'#b42318'}}>{state.error}</p>}
    <button type="submit" className="btn" disabled={pending||keyPending}>{pending?'שומר…':command?'שמור שינויים':'הוסף פקודה'}</button>
  </form>;
}
