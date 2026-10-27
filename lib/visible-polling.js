// Keep foreground updates at the same rate, without waking the server from hidden tabs.
export function startVisiblePolling(poll,{intervalMs,onPause=()=>{},document:doc=globalThis.document,window:win=globalThis.window,setInterval:schedule=globalThis.setInterval,clearInterval:clear=globalThis.clearInterval}={}) {
  let stopped=false,inFlight=false;
  async function refresh() {
    if(stopped||doc.visibilityState!=='visible'||inFlight)return;
    inFlight=true;
    try {await poll();} finally {inFlight=false;}
  }
  function visibilityChanged(){if(doc.visibilityState==='visible')void refresh();else onPause();}
  const timer=schedule(()=>void refresh(),intervalMs);
  doc.addEventListener('visibilitychange',visibilityChanged);
  win.addEventListener('focus',refresh);
  void refresh();
  return ()=>{stopped=true;clear(timer);doc.removeEventListener('visibilitychange',visibilityChanged);win.removeEventListener('focus',refresh);onPause();};
}
