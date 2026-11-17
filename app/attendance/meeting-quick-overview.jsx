'use client';
import {useEffect,useRef,useState} from 'react';
export default function MeetingQuickOverview({sessionId}) {
  const element=useRef(null);
  const [visible,setVisible]=useState(false),[data,setData]=useState(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'100px'});
    observer.observe(element.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!visible)return;
    const controller=new AbortController();let loading=false;
    async function load(){
      if(loading||document.visibilityState==='hidden')return;
      loading=true;
      try {const response=await fetch(`/api/attendance/sessions/${encodeURIComponent(sessionId)}/overview`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();const result=await response.json();setData(result);setFailed(false);}
      catch(error){if(error.name!=='AbortError')setFailed(true);}
      finally{loading=false;}
    }
    load();const timer=setInterval(load,60000);return()=>{controller.abort();clearInterval(timer);};
  },[sessionId,visible,retry]);
  return <section ref={element} className="meeting-quick-overview" aria-label="פילוח נוכחות מהיר">
    <strong>מצב נוכחות {data ? `· ${data.total} תלמידים` : ''}</strong>
    {data ? <div className="meeting-quick-counts">{data.statuses.map(item=><span key={item.value} className={item.value==='found'?'is-found':item.value==='missing'?'is-missing':''}>{item.label}: <b>{item.count}</b> <small>({item.percentage}%)</small></span>)}</div> : !failed ? <small>טוען פילוח…</small> : null}
    {failed ? <div role="status"><small>{data?'הפילוח לא התרענן.':'לא ניתן לטעון פילוח.'}</small> <button type="button" onClick={()=>setRetry(x=>x+1)}>נסה שוב</button></div> : null}
  </section>;
}
