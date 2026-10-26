'use client';
import { useActionState } from 'react';
import { saveCommandAction } from './actions';
export default function CommandEditor({command,users}) {
  const [state,action,pending]=useActionState(saveCommandAction,{});
  return <form action={action} style={{display:'grid',gap:14}} autoComplete="off">
    {command&&<input type="hidden" name="id" value={command.id}/>}
    <label>שם הפקודה<input name="name" required maxLength={100} defaultValue={command?.name||''} placeholder="לדוגמה: פתיחת מזגן"/></label>
    <label>תיאור לצוות<input name="description" maxLength={500} defaultValue={command?.description||''}/></label>
    <label><input type="checkbox" name="enabled" defaultChecked={command?.enabled??true}/> הפקודה פעילה</label>
    <fieldset><legend>משתמשים שיוכלו להפעיל</legend><p className="muted">סופר אדמין יכול להפעיל את כל הפקודות הפעילות.</p>
      <div style={{display:'grid',gap:8,maxHeight:240,overflow:'auto'}}>{users.map(user=><label key={user.clerk_user_id}><input type="checkbox" name="allowedUserIds" value={user.clerk_user_id} defaultChecked={command?.allowed_user_ids?.includes(user.clerk_user_id)||false}/> {user.display_name} · {user.email}</label>)}</div>
    </fieldset>
    <fieldset><legend>{command?'החלפת הגדרת הבקשה (רשות)':'הגדרת הבקשה'}</legend>
      {command&&<p className="muted">הכתובת והטוקנים השמורים אינם מוצגים. השאר את הגדרת הבקשה ריקה כדי לשמור אותם; הזנת בקשה חדשה תחליף את כל ההגדרה.</p>}
      <label>הדבקת cURL<textarea name="curl" rows={4} dir="ltr" spellCheck={false} placeholder={'curl -X POST https://api.example.com/device/on -H \'Authorization: Bearer TOKEN\''}/></label>
      <p className="muted">או הזן בקשה בשדות הבאים. ההפעלה מתבצעת דרך HTTPS מהשרת.</p>
      <label>כתובת היעד<input name="url" type="url" dir="ltr" placeholder="https://api.example.com/device/on"/></label>
      <label>שיטה<select name="method" defaultValue="POST">{['GET','POST','PUT','PATCH','DELETE'].map(method=><option key={method}>{method}</option>)}</select></label>
      <label>כותרות JSON (כולל טוקן במידת הצורך)<textarea name="headers" rows={3} dir="ltr" spellCheck={false} placeholder={'{"Authorization":"Bearer TOKEN","Content-Type":"application/json"}'}/></label>
      <label>גוף הבקשה<textarea name="body" rows={3} dir="ltr" spellCheck={false}/></label>
    </fieldset>
    {state.error&&<p role="alert" style={{color:'#b42318'}}>{state.error}</p>}
    <button type="submit" className="btn" disabled={pending}>{pending?'שומר…':command?'שמור שינויים':'הוסף פקודה'}</button>
  </form>;
}
