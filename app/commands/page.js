import Link from 'next/link';
import CommandHistory,{CommandResult} from './command-history';
import { requireAuthenticatedUser,listAppUsers } from '../../lib/rbac';
import { listCommands,listCommandRuns,canRunCommand,listCommandKeys } from '../../lib/commands';
import { runCommandAction } from './actions';
import CommandEditor from './command-editor';
import RunButton from './run-button';
import CommandKeyEditor from './command-key-editor';
export const runtime='nodejs';
export default async function CommandsPage({searchParams}) {
  const user=await requireAuthenticatedUser();
  if(user.access_status!=='approved')return <div className="card"><h1>פקודות</h1><p>נדרש חשבון מאושר.</p></div>;
  const [commands,runs,allUsers,keys,params]=await Promise.all([listCommands(user),listCommandRuns(user),user.is_super_admin?listAppUsers():[],user.is_super_admin?listCommandKeys(user):[],searchParams]);
  const users=allUsers.filter(item=>item.access_status==='approved');
  const query=String(params?.q||'').trim();
  const filtered=commands.filter(command=>`${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase()));
  return <main style={{display:'grid',gap:20}}>
    <section className="card glass"><h1>פקודות</h1><p>הפעלת פעולות שהוגדרו עבורך במערכת.</p><CommandResult result={params?.result}/></section>
    {user.is_super_admin&&<details className="card glass"><summary><strong>מאגר מפתחות לפקודות ({keys.length})</strong></summary><p>המפתחות משותפים לפקודות ונשמרים מוצפנים. רק סופר אדמין יכול לנהל אותם.</p>
      <details><summary>הוספת מפתח חדש</summary><CommandKeyEditor/></details>
      {keys.map(key=><details key={key.id} style={{marginTop:16}}><summary>{key.name}{!key.enabled?' — מושבת':''}</summary><CommandKeyEditor record={key}/></details>)}
    </details>}
    {user.is_super_admin&&<details className="card glass"><summary><strong>הוספת פקודה חדשה</strong></summary><CommandEditor users={users} keys={keys}/></details>}
    <section className="card glass"><form action="/commands" method="get" style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end'}}><label style={{flex:1,minWidth:180}}>חיפוש פקודה<input type="search" name="q" defaultValue={query} placeholder="חיפוש לפי שם או תיאור"/></label><button type="submit" className="btn">חפש</button>{query&&<Link href="/commands">נקה חיפוש</Link>}</form>{query&&<p>נמצאו {filtered.length} פקודות.</p>}</section>
    {!filtered.length&&<section className="card glass">אין פקודות זמינות עבורך כרגע.</section>}
    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16}}>{filtered.map(command=><article className="card glass" key={command.id}>
      <h2><Link href={"/commands/"+encodeURIComponent(command.id)}>{command.name}</Link></h2><p><Link href={"/commands/"+encodeURIComponent(command.id)}>פתח עמוד פקודה</Link></p><p style={{whiteSpace:'pre-wrap'}}>{command.description}</p>
      {!command.enabled?<p>הפקודה מושבתת</p>:command.key_available===false?<p>הפקודה אינה זמינה כעת</p>:null}
      {canRunCommand(user,command)&&<form action={runCommandAction}><input type="hidden" name="id" value={command.id}/><RunButton/></form>}
      {user.is_super_admin&&<Link className="btn" style={{display:'inline-block',marginTop:16}} href={"/commands/"+encodeURIComponent(command.id)+"#settings"}>עריכה, הרשאות ושכפול</Link>}
    </article>)}</section>
    <CommandHistory runs={runs}/>
  </main>;
}
