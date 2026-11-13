import Link from 'next/link';
import { classLabel, INSTITUTIONS, phoneHref } from '../lib/student-view';

export function PhoneAttendance({ sessions, showAll }) {
  const open = sessions.filter(session => !session.isLocked);
  return <section className="phone-home" aria-label="נוכחות בנייד">
    <header className="phone-heading"><span className="phone-eyebrow">CRM CY · ניהול יומיומי</span><h1>נוכחות</h1><p>בוחרים מפגש ומסמנים נוכחות.</p></header>
    <nav className="phone-segments" aria-label="סינון מפגשים"><Link href="/attendance" aria-current={!showAll ? 'page' : undefined}>באחריותי</Link><Link href="/attendance?responsible=all" aria-current={showAll ? 'page' : undefined}>כל המפגשים</Link></nav>
    <div className="phone-section-title"><h2>המפגשים שלך</h2><span>{open.length} פתוחים</span></div>
    <div className="phone-card-list">{[...open, ...sessions.filter(session => session.isLocked)].map(session => <Link key={session.id} href={`/attendance/${session.id}`} className="phone-session-card">
      <div className="phone-session-icon" aria-hidden="true">✓</div>
      <div className="phone-card-copy"><span className="phone-card-subtitle">{session.institutionLabel || 'מפגש'}</span><h3>{session.displayTitle || session.title || session.sessionTypeLabel}</h3><p>{[session.sessionDate, session.sessionWeekdayLabel].filter(Boolean).join(' · ')}</p><span className={`phone-status ${session.isLocked ? 'is-locked' : ''}`}>{session.isLocked ? 'נעול לעדכונים' : 'פתוח לסימון נוכחות'}</span></div><span className="phone-chevron" aria-hidden="true">‹</span>
    </Link>)}</div>
    {!sessions.length && <div className="phone-empty"><span aria-hidden="true">✓</span><h2>אין מפגשים להצגה</h2><p>אפשר לעבור לכל המפגשים או לפתוח את כלי הניהול למטה.</p></div>}
  </section>;
}

export function PhoneStudents({ students, query, error }) {
  return <section className="phone-home" aria-label="תלמידים בנייד">
    <header className="phone-heading"><span className="phone-eyebrow">האנשים שבמרכז</span><h1>תלמידים</h1><p>כרטיס אישי, פרטי קשר וכל המידע במקום אחד.</p></header>
    <form action="/neon" className="phone-search" role="search"><label htmlFor="phone-student-search" className="sr-only">חיפוש תלמיד</label><input id="phone-student-search" name="q" defaultValue={query} placeholder="חיפוש לפי שם או מספר טלפון" enterKeyHint="search" type="search" /><button type="submit" aria-label="חפש תלמיד">חיפוש</button></form>
    <div className="phone-section-title"><h2>{query ? 'תוצאות חיפוש' : 'תלמידים'}</h2><Link href="/students/new">הוספת תלמיד +</Link></div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="phone-card-list">{students.slice(0, 100).map(student => <article key={student.id} className="phone-student-card"><Link href={`/neon/students/${student.id}`} className="phone-student-main"><span className="phone-avatar" aria-hidden="true">{String(student.label || '?').trim().slice(0, 1)}</span><div className="phone-card-copy"><h3>{student.label || student.name || 'תלמיד'}</h3><p>{[INSTITUTIONS[student.currentInstitution] || student.currentInstitution, classLabel(student.class)].filter(Boolean).join(' · ')}</p></div><span className="phone-chevron" aria-hidden="true">‹</span></Link>{phoneHref(student.phone) ? <a className="phone-call" href={phoneHref(student.phone)} aria-label={`חיוג אל ${student.label}`}>חיוג</a> : null}</article>)}</div>
    {students.length > 100 ? <p className="phone-hint">מוצגים 100 תלמידים. חיפוש ממוקד יעזור להגיע לכרטיס הרצוי.</p> : null}
    {!students.length && !error ? <div className="phone-empty"><span aria-hidden="true">⌕</span><h2>{query ? 'לא נמצאו תלמידים' : 'את מי מחפשים?'}</h2><p>{query ? 'אפשר לנסות שם אחר או מספר טלפון.' : 'הקלידו שם כדי לפתוח כרטיס תלמיד, או בחרו סינון בכלי הניהול למטה.'}</p></div> : null}
  </section>;
}
