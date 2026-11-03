const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function buildDetailRequestEmail(item,url){
 const title=String(item.title||''),student=String(item.student_label||''),instructions=String(item.instructions||'').trim();
 const safeUrl=escapeHtml(url),paragraph=text=>escapeHtml(text).replace(/\r\n?|\n/g,'<br />');
 return {
  text:`${title}\n\nבקשה בנוגע לפרטי ${student}.\n${instructions}\n\nלצפייה בשדות ולאישור או עדכון, היכנסו עם חשבון Google של כתובת המייל שאליה נשלחה ההודעה:\n${url}\n\nאין להשיב להודעה זו עם פרטים אישיים.`,
  html:`<div dir="rtl" align="right" style="direction:rtl;text-align:right;">
  <p style="margin:0 0 20px;">שלום,</p>
  <p style="margin:0 0 20px;">נשלחה אליכם בקשה לאימות או לעדכון הפרטים של <strong>${escapeHtml(student)}</strong>.</p>
  ${instructions?`<div dir="rtl" align="right" style="background:#f3f7fc;border:1px solid #d7e1ef;border-radius:10px;padding:18px;margin:0 0 24px;direction:rtl;text-align:right;">${paragraph(instructions)}</div>`:''}
  <p style="margin:0 0 20px;">לצפייה בפרטים ולאישור או לעדכון שלהם, לחצו על הכפתור והיכנסו עם חשבון <span dir="ltr" style="direction:ltr;display:inline-block;">Google</span> המשויך לכתובת המייל שאליה נשלחה הודעה זו.</p>
  <table role="presentation" dir="rtl" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td align="center" bgcolor="#155a96" style="background:#155a96;border-radius:10px;padding:0;border:0;"><a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.5;font-weight:bold;color:#ffffff;text-decoration:none;direction:rtl;">לפתיחת הבקשה ולאישור הפרטים</a></td></tr></table>
  <p style="margin:0 0 18px;font-size:14px;color:#5a6f86;">אם הכפתור אינו נפתח, אפשר <a href="${safeUrl}" style="color:#155a96;text-decoration:underline;">לפתוח את הבקשה בקישור זה</a>.</p>
  <p style="margin:0;padding-top:18px;border-top:1px solid #d7e1ef;font-size:13px;color:#5a6f86;">לשמירה על פרטיותכם, אין להשיב למייל זה עם פרטים אישיים. הפרטים יוצגו ויעודכנו רק במערכת לאחר ההזדהות.</p>
  </div>`
 };
}
