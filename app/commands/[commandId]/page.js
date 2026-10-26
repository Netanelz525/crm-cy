import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireAuthenticatedUser,listAppUsers} from '../../../lib/rbac';
import {getCommand,listCommandKeys,listCommandRuns,canRunCommand,getCommandRequestSummary,getCommandEditConfig} from '../../../lib/commands';
import {runCommandAction,duplicateCommandAction} from '../actions';
import RunButton from '../run-button';
import CommandEditor from '../command-editor';
import CommandHistory,{CommandResult} from '../command-history';
import CopyCommandLink from '../copy-link';
export const runtime='nodejs';
export default async function CommandPage({params,searchParams}) {
  const user=await requireAuthenticatedUser(),{commandId}=await params;
  const command=await getCommand(user,commandId);if(!command)notFound();
  const [runs,users,keys,summary,requestConfig,result]=await Promise.all([listCommandRuns(user,commandId),user.is_super_admin?listAppUsers():[],user.is_super_admin?listCommandKeys(user):[],user.is_super_admin?getCommandRequestSummary(user,commandId):null,user.is_super_admin?getCommandEditConfig(user,commandId):null,searchParams]);
  return <div style={{display:'grid',gap:20}}><section className="card glass"><Link href="/commands">כל הפקודות</Link><h1>{command.name}</h1><p style={{whiteSpace:'pre-wrap'}}>{command.description}</p><CommandResult result={result?.result}/>{result?.result==='duplicated'&&<p role="status">הפקודה שוכפלה. העותק מושבת וללא הרשאות משתמשים. ניתן לערוך ולהפעיל אותו למטה.</p>}
    <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{canRunCommand(user,command)?<form action={runCommandAction}><input type="hidden" name="id" value={command.id}/><RunButton/></form>:<p>הפקודה אינה זמינה להפעלה כעת.</p>}<CopyCommandLink id={command.id}/>{user.is_super_admin&&<form action={duplicateCommandAction}><input type="hidden" name="id" value={command.id}/><button className="btn" type="submit">שכפל פקודה</button></form>}</div>
    <p className="muted">פתיחת הקישור אינה מפעילה את הפקודה. ההפעלה דורשת התחברות והרשאה.</p>
  </section>
  {user.is_super_admin&&summary&&<section className="card glass"><h2>בדיקת מבנה הבקשה</h2>{summary.unavailable?<p>לא ניתן לקרוא את הגדרת הבקשה.</p>:<><p dir="ltr" style={{overflowWrap:'anywhere'}}>{summary.method} {summary.target}</p><p>בדיקת תשובה: {summary.expectedResponse==='api'?'API':'דף אינטרנט'}</p><p>סוג תוכן: {summary.contentType||'ללא כותרת Content-Type'}</p><p>גודל גוף הבקשה: {summary.bodyBytes} בתים</p><p>שדות JSON: {summary.jsonFields.join(', ')||'ללא שדות'}</p><p>כותרות: {summary.headerNames.join(', ')||'ללא כותרות'}</p>{summary.queryNames.length>0&&<p>שמות פרמטרים: {summary.queryNames.join(', ')}</p>}{summary.emptyJsonNormalized&&<p>בקשת MDM ריקה תישלח כ־JSON ריק {'{}'}, בהתאמה לקיצורים.</p>}{summary.prefixedBearer&&<p>קידומת Bearer שכבר נמצאת במפתח מנורמלת כדי למנוע כפילות.</p>}</>}</section>}
  {user.is_super_admin&&<details className="card glass" open={result?.result==='duplicated'}><summary>ניהול והגדרת הרשאות</summary><CommandEditor key={command.updated_at?.toString()} requestConfig={requestConfig} command={command} users={users.filter(user=>user.access_status==='approved')} keys={keys}/></details>}
  <CommandHistory runs={runs}/></div>;
}
