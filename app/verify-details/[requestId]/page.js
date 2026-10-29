import Link from 'next/link';
import {auth,currentUser} from '@clerk/nextjs/server';
import {googleRecipientEmails} from '../../../lib/detail-request-fields';
import {recipientDetailView} from '../../../lib/detail-requests';
import DetailResponseClient from './response-client';
export const runtime='nodejs';
export default async function VerifyDetailsPage({params}){
 const {requestId}=await params,session=await auth();
 if(!session.userId)return <section className="card glass"><h1>אימות ועדכון פרטים</h1><p>יש להיכנס עם חשבון Google של כתובת המייל שאליה נשלחה הבקשה.</p><Link className="btn" href={'/sign-in?redirect_url='+encodeURIComponent('/verify-details/'+requestId)}>כניסה באמצעות חשבון Google</Link></section>;
 const user=await currentUser(),emails=googleRecipientEmails(user);
 if(!emails.length)return <section className="card"><h1>נדרש חשבון Google</h1><p>התחבר באמצעות Google עם כתובת המייל שאליה נשלחה הבקשה. ניתן להחליף חשבון דרך תמונת המשתמש.</p></section>;
 const request=await recipientDetailView(requestId,emails);
 if(!request)return <section className="card"><h1>הבקשה אינה זמינה לחשבון זה</h1><p>ודא שחשבון Google הוא של כתובת המייל שאליה נשלחה הבקשה. אם הכתובת במערכת שגויה, פנה לצוות.</p></section>;
 return <section className="card glass" style={{maxWidth:680,margin:'auto'}}><h1>{request.title}</h1>{request.closed_at?<p>הבקשה נסגרה ולא ניתן להשיב לה.</p>:request.status!=='pending'?<p>המענה לבקשה כבר נשמר. תודה!</p>:<><h2>פרטי {request.student_label}</h2><p style={{whiteSpace:'pre-wrap'}}>{request.instructions}</p><p className="muted">מוצגים רק השדות שנבחרו לבקשה זו.</p><DetailResponseClient request={request}/></>}</section>;
}
