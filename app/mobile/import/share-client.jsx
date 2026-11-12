"use client";
import { useEffect, useState } from 'react';
import PrintUploadClient from '../../print/print-upload-client';
import AnnouncementGeneratorClient from '../../announcements/announcement-generator-client';
import { createQueuedAnnouncementAction } from '../../announcements/actions';

export default function MobileImportClient({ canPrint, canAssign, templates, signatures, printProps }) {
  const [payload, setPayload] = useState(null);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('');
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    function receive(event) {
      try {
        const data = event.detail;
        if (!data || (data.text?.length || 0) > 100000 || (data.data?.length || 0) > 14000000) throw new Error();
        setPayload(data); setMode(data.destination || (data.text ? 'template' : 'print'));
        if (data.data) {
          const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
          setFile(new File([bytes], data.name || 'shared-file', { type: data.type || 'application/octet-stream' }));
        }
      } catch { setError('לא ניתן לקרוא את השיתוף. נסו לשתף מחדש.'); }
    }
    window.addEventListener('crm-mobile-import', receive);
    window.webkit?.messageHandlers?.mobileAuth?.postMessage('importReady');
    return () => window.removeEventListener('crm-mobile-import', receive);
  }, []);
  useEffect(() => {
    if (query.trim().length < 2 || !canAssign) { setStudents([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/mobile/students?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        setStudents((await response.json()).students || []);
      } catch (error) { if (error.name !== 'AbortError') setError('חיפוש התלמידים נכשל. נסו שוב.'); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, canAssign]);
  async function assign(event) {
    event.preventDefault(); if (busy || !file || !studentId) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(event.currentTarget); form.set('file', file);
      const response = await fetch('/api/mobile/student-document', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.webkit?.messageHandlers?.mobileAuth?.postMessage('importCompleted');
      window.location.assign(result.url);
    } catch (error) { setError(error.message); setBusy(false); }
  }
  return <section className="card" style={{display:'grid',gap:16}}>
    <h1>תוכן ששיתפתם מהאייפון</h1>
    {error && <p role="alert" className="error">{error}</p>}
    {!payload ? <p>ממתינים לתוכן מהאפליקציה…</p> : <>
      <p>{file ? `${file.name} · ${(file.size/1024/1024).toFixed(1)}MB` : 'טקסט משותף'}</p>
      <div className="quick-actions">
        {file && canPrint && <button className="btn" onClick={()=>setMode('print')}>הדפסה</button>}
        {file && canAssign && <button className="btn" onClick={()=>setMode('student')}>שיוך לתלמיד</button>}
        {payload.text && templates.length > 0 && <button className="btn" onClick={()=>setMode('template')}>הכנסה לתבנית</button>}
      </div>
      {mode==='print' && (canPrint ? <PrintUploadClient {...printProps} initialFile={file} /> : <p>אין הרשאה להדפסה בחשבון זה.</p>)}
      {mode==='student' && (canAssign ? <form onSubmit={assign} style={{display:'grid',gap:12}}>
        <label>חיפוש תלמיד<input value={query} onChange={e=>{setQuery(e.target.value);setStudentId('');}} placeholder="לפחות שתי אותיות" /></label>
        <label>בחרו תלמיד<select name="studentId" required value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">בחרו תלמיד מהרשימה</option>{students.map(student=><option key={student.id} value={student.id}>{student.label}</option>)}</select></label>
        <label>שם המסמך<input name="displayName" defaultValue={file?.name} maxLength={160}/></label>
        <p className="muted">PDF או תמונה עד 3MB. המסמך יישמר בכרטיס התלמיד שבחרתם.</p>
        <button className="btn btn-primary" disabled={busy || !studentId || !file}>{busy?'משייך…':'אישור שיוך לתלמיד'}</button>
      </form> : <p>אין הרשאה לשיוך לתלמידים בחשבון זה.</p>)}
      {mode==='template' && (templates.length ? <AnnouncementGeneratorClient templates={templates} signatures={signatures} action={createQueuedAnnouncementAction} canUseColor={printProps.canUseColor} sharedText={payload.text || ''} /> : <p>אין תבניות זמינות לחשבון זה.</p>)}
      <button className="btn btn-ghost" onClick={()=>{window.webkit?.messageHandlers?.mobileAuth?.postMessage('importCompleted');window.location.assign('/attendance');}}>סיום ומחיקת העותק המשותף מהאייפון</button>
    </>}
  </section>;
}
