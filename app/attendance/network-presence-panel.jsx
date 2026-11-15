'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PRESENCE_MESSAGES } from '../../lib/presence-messages.mjs';
import { syncAttendanceNetworkPresenceAction } from './actions';

export default function NetworkPresencePanel({ sessionId, result, syncedAt, disabledReason = '' }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState('');
  const router = useRouter();
  const activeStatus = status || result?.status;
  function sync() {
    const form = new FormData(); form.set('sessionId', sessionId);
    setStatus('');
    startTransition(async () => {
      try { const response = await syncAttendanceNetworkPresenceAction(form); setStatus(response.status); }
      catch { setStatus('failed'); }
      router.refresh();
    });
  }
  return <section className="card attendance-network-panel" aria-label="סנכרון נוכחות מהרשת">
    <div><h3>נוכחות מהרשת הפנימית</h3><p className="muted">מכשיר מחובר מסמן תלמיד כ״נמצא״. סימון קיים נשמר, ואי־חיבור לרשת אינו מסמן היעדרות.</p></div>
    <button type="button" className="quick-action-btn quick-action-primary" disabled={pending || Boolean(disabledReason)} onClick={sync}>{pending ? 'בודק נוכחות ברשת…' : 'סנכרן נוכחות מהרשת'}</button>
    <div role="status" aria-live="polite">
      {disabledReason ? <p className="muted">{disabledReason}</p> : null}
      {activeStatus === 'complete' && result?.status === 'complete' ? <p>נבדקו {result.checkedStudents} תלמידים; {result.connected} מחוברים; עודכנו {result.updated} סימונים חדשים. יתר הסימונים נשמרו.</p> : null}
      {result?.status === 'complete' && (result.missingMac || result.invalidMac || result.duplicateStudents) ? <p className="muted">לא נבדקו: {result.missingMac || 0} ללא כתובת MAC, {result.invalidMac || 0} עם כתובת לא תקינה, {result.duplicateStudents || 0} עם כתובת משותפת לתלמיד נוסף.</p> : null}
      {pending ? null : activeStatus === 'running' ? <p>סנכרון ברקע. אפשר לרענן בעוד מספר שניות.</p> : PRESENCE_MESSAGES[activeStatus] ? <p>{PRESENCE_MESSAGES[activeStatus]}</p> : null}
      {syncedAt ? <small className="muted">סנכרון מוצלח אחרון: {new Date(syncedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</small> : null}
    </div>
  </section>;
}
