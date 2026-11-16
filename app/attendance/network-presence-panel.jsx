'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PRESENCE_MESSAGES } from '../../lib/presence-messages.mjs';
import { syncAttendanceNetworkPresenceAction, setAttendancePresenceAutomaticAction, refreshAttendancePresenceAutomaticAction } from './actions';

export default function NetworkPresencePanel({ sessionId, result, syncedAt, disabledReason = '', autoUntil = null, nextAt = null }) {
  const [pending, startTransition] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const automatic = Boolean(autoUntil && new Date(autoUntil).getTime() > now);
  const [status, setStatus] = useState('');
  const router = useRouter();
  const activeStatus = status || result?.status;
  useEffect(() => { setStatus(''); }, [syncedAt, result?.status]);
  useEffect(() => {
    if (!automatic) return;
    let stopped = false;
    let running = false;
    async function refresh() {
      if (running || stopped) return;
      running = true;
      try { await refreshAttendancePresenceAutomaticAction(sessionId); }
      catch { /* Persisted provider errors remain visible after refresh. */ }
      finally { running = false; if (!stopped) router.refresh(); }
    }
    // The server claims only due intervals, so screen and background triggers cannot double-sync.
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => { stopped = true; clearInterval(timer); };
  }, [automatic, sessionId, router]);

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
    <button type="button" className="quick-action-btn quick-action-primary" disabled={pending || toggling || Boolean(disabledReason)} onClick={sync}>{pending ? 'בודק נוכחות ברשת…' : 'סנכרן נוכחות מהרשת'}</button>
    <label className="attendance-auto-presence-toggle" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0' }}>
      <input type="checkbox" role="switch" checked={automatic} disabled={pending || toggling || (!automatic && Boolean(disabledReason))} onChange={event => {
        const enabled = event.target.checked;
        const form = new FormData(); form.set('sessionId', sessionId); form.set('enabled', String(enabled));
        startToggle(async () => {
          try { await setAttendancePresenceAutomaticAction(form); setNow(Date.now()); }
          catch { setStatus('failed'); }
          router.refresh();
        });
      }} className="attendance-presence-switch" />
      <span>סנכרון אוטומטי כל חצי שעה למשך 4 שעות
        <small className="muted" style={{ display: 'block' }}>{automatic ? `פעיל עד ${new Date(autoUntil).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })}; לאחר מכן יכבה אוטומטית.` : 'בהפעלה תתבצע בדיקה מיידית. ממשיך לפעול גם כשהאפליקציה סגורה.'}</small>
      </span>
    </label>
    <div role="status" aria-live="polite">
      {disabledReason ? <p className="muted">{disabledReason}</p> : null}
      {activeStatus === 'complete' && result?.status === 'complete' ? <p>נבדקו {result.checkedStudents} תלמידים; {result.connected} מחוברים; עודכנו {result.updated} סימונים חדשים. יתר הסימונים נשמרו.</p> : null}
      {result?.status === 'complete' && (result.missingMac || result.invalidMac || result.duplicateStudents) ? <p className="muted">לא נבדקו: {result.missingMac || 0} ללא כתובת MAC, {result.invalidMac || 0} עם כתובת לא תקינה, {result.duplicateStudents || 0} עם כתובת משותפת לתלמיד נוסף.</p> : null}
      {pending ? null : activeStatus === 'running' ? <p>סנכרון ברקע. אפשר לרענן בעוד מספר שניות.</p> : PRESENCE_MESSAGES[activeStatus] ? <p>{PRESENCE_MESSAGES[activeStatus]}</p> : null}
      {automatic && nextAt ? <p className="muted">{new Date(nextAt).getTime() >= new Date(autoUntil).getTime() ? 'החלון יסתיים לפני בדיקה נוספת.' : `הבדיקה הבאה מתוכננת ל־${new Date(nextAt).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })}${new Date(nextAt).getTime() < now ? ' — ממתינה להפעלה.' : ''}`}</p> : null}
      {syncedAt ? <small className="muted">סנכרון מוצלח אחרון: {new Date(syncedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</small> : null}
    </div>
  </section>;
}
