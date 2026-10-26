import { requireAuthenticatedUser,listAppUsers } from '../../lib/rbac';
import { listCommands,listCommandRuns,canRunCommand } from '../../lib/commands';
import { runCommandAction } from './actions';
import CommandEditor from './command-editor';
import RunButton from './run-button';
export const runtime='nodejs';
const messages={saved:'הפקודה נשמרה.',sent:'נקודת הקצה אישרה את קבלת הבקשה.',failed:'ההפעלה לא אושרה. יש לבדוק את מצב המכשיר לפני ניסיון נוסף.',denied:'אין הרשאה להפעלת הפקודה.',unavailable:'הפקודה אינה זמינה, אין הרשאה, או שהיא הופעלה ב־30 השניות האחרונות.'};
export default async function CommandsPage({searchParams}) {
  const user=await requireAuthenticatedUser();
  if(user.access_status!=='approved')return <div className="card"><h1>פקודות</h1><p>נדרש חשבון מאושר.</p></div>;
  const [commands,runs,allUsers,params]=await Promise.all([listCommands(user),listCommandRuns(user),user.is_super_admin?listAppUsers():[],searchParams]);
  const users=allUsers.filter(item=>item.access_status==='approved');
  return <main style={{display:'grid',gap:20}}>
    <section className="card glass"><h1>פקודות</h1><p>הפעלת פעולות שהוגדרו עבורך במערכת.</p>{messages[params?.result]&&<p role="status">{messages[params.result]}</p>}</section>
    {user.is_super_admin&&<details className="card glass"><summary><strong>הוספת פקודה חדשה</strong></summary><CommandEditor users={users}/></details>}
    {!commands.length&&<section className="card glass">אין פקודות זמינות עבורך כרגע.</section>}
    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16}}>{commands.map(command=><article className="card glass" key={command.id}>
      <h2>{command.name}</h2><p style={{whiteSpace:'pre-wrap'}}>{command.description}</p>
      {!command.enabled&&<p>הפקודה מושבתת</p>}
      {canRunCommand(user,command)&&<form action={runCommandAction}><input type="hidden" name="id" value={command.id}/><RunButton/></form>}
      {user.is_super_admin&&<details style={{marginTop:16}}><summary>ניהול והגדרת הרשאות</summary><CommandEditor command={command} users={users}/></details>}
    </article>)}</section>
    <section className="card glass"><h2>היסטוריית הפעלות</h2><p className="muted">אישור קבלת הבקשה אינו אימות של מצב המכשיר. הפעלה שנותרה ללא תשובה לא תישלח שוב אוטומטית.</p>
      {!runs.length?<p>עדיין לא בוצעו הפעלות.</p>:<div style={{overflowX:'auto'}}><table><thead><tr><th>פקודה</th><th>מפעיל</th><th>מועד</th><th>תוצאה</th></tr></thead><tbody>{runs.map(run=><tr key={run.id}><td>{run.name}</td><td>{run.display_name||'משתמש שהוסר'}</td><td>{new Date(run.created_at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</td><td>{run.status==='succeeded'?'הבקשה התקבלה':run.status==='failed'?'ההפעלה לא אושרה':Date.now()-new Date(run.created_at).getTime()>60000?'לא התקבלה תוצאה סופית':'בהפעלה'}{run.http_status?` (${run.http_status})`:''}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
