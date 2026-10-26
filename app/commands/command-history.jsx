export const outcomeLabels={http_received:'תקין',accepted:'השרת קיבל את הבקשה לעיבוד',api_error:'השרת דיווח על שגיאה בתשובת API',http_error:'השרת החזיר שגיאת HTTP',redirect_blocked:'השרת הפנה לכתובת אחרת; ההפניה נחסמה',unexpected_html:'התקבל עמוד HTML במקום תשובת API',invalid_json:'התקבלה תשובת JSON לא תקינה',response_incomplete:'החיבור נסגר לפני השלמת התשובה',response_too_large:'התשובה גדולה מדי לבדיקה',timeout:'לא התקבלה תשובה מלאה בזמן',network_error:'שגיאת חיבור לשרת',request_error:'לא ניתן להשלים את הבקשה או לפענח את הגדרתה'};
export const commandMessages={saved:'הפקודה נשמרה.',sent:'הפקודה נשלחה והתקבלה תשובה תקינה.',failed:'הבקשה לא אושרה או שלא ניתן לאמת את תשובתה. פרטים בהיסטוריה.',denied:'אין הרשאה להפעלת הפקודה.',unavailable:'הפקודה אינה זמינה, אין הרשאה, או שהיא הופעלה ב־30 השניות האחרונות.'};
export function CommandResult({result}) {
  if(!commandMessages[result])return null;
  const success=['sent','saved'].includes(result),failure=['failed','denied'].includes(result);
  return <p role={failure?'alert':'status'} style={{padding:'10px 14px',borderRadius:10,color:success?'#166534':failure?'#991b1b':'#475569',background:success?'#dcfce7':failure?'#fee2e2':'#f1f5f9'}}>{success?'✓ ':failure?'✕ ':''}{commandMessages[result]}</p>;
}
export default function CommandHistory({runs}) {
  return <section className="card glass"><h2>היסטוריית הפעלות</h2>
    {!runs.length?<p>עדיין לא בוצעו הפעלות.</p>:<div style={{display:'grid',gap:12}}>{runs.map(run=>{
      const success=run.status==='succeeded',failure=run.status==='failed';
      return <article key={run.id} style={{padding:14,border:'1px solid #dce5ee',borderRadius:12,minWidth:0}}>
        <strong>{run.name}</strong><p className="muted">{run.display_name||'משתמש שהוסר'} · {new Date(run.created_at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}</p>
        <p style={{color:success?'#166534':failure?'#991b1b':'#475569',fontWeight:700}}>{success?'✓ תקין':failure?'✕ שגיאה':'בהפעלה'}{run.http_status?` · HTTP ${run.http_status}`:''}</p>
        {(failure||run.response_code==='accepted')&&<p>{outcomeLabels[run.response_code]||'ההפעלה לא אושרה'}</p>}
        <details><summary>הצג תשובת שרת</summary>
          {run.response?<><p dir="ltr">HTTP {run.http_status||'—'} · {run.response.contentType||'ללא סוג תוכן'}</p><pre dir="ltr" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:400,overflow:'auto',background:'#f8fafc',padding:12,borderRadius:8}}>{run.response.body||'השרת החזיר תשובה ללא גוף.'}</pre>{run.response.truncated&&<p>התשובה ארוכה; מוצג החלק שנשמר עד מגבלת הגודל.</p>}</>:<p>{run.http_status?'תוכן התשובה לא נשמר בהפעלה זו. תשובות מהפעלות חדשות יוצגו כאן.':'לא התקבלה תשובת שרת להצגה.'}</p>}
          <p className="muted">מפתחות וטוקנים מוסתרים. התשובה מוצגת כטקסט בלבד.</p>
          <p className="muted">מזהה הפעלה: <code style={{overflowWrap:'anywhere'}}>{run.id}</code></p>
        </details>
      </article>;
    })}</div>}
  </section>;
}
