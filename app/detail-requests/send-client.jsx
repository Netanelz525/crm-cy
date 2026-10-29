'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {sendDetailRequestChunkAction} from './actions';
export default function SendDetailsClient({id}){const [pending,setPending]=useState(false),[message,setMessage]=useState('');const router=useRouter();return <div><button disabled={pending} className="btn" onClick={async()=>{setPending(true);setMessage('שולח…');try{let count=0,first=true;while(true){const result=await sendDetailRequestChunkAction(id,first);first=false;if(!result.ok){setMessage(result.error);break;}count+=result.processed;setMessage(`נבדקו ${count} הודעות. הודעות שנמסרו כבר לא נשלחות שוב.`);if(!result.processed)break;}router.refresh();}catch{setMessage('השליחה נעצרה. ניתן להמשיך בלחיצה נוספת.');}finally{setPending(false);}}}>{pending?'שולח…':'המשך שליחה / נסה שוב הודעות שנכשלו'}</button><p role="status">{message}</p></div>;}
