# CRM on Vercel (Clerk + Neon)

מיגרציה מלאה ל־Vercel:
- אפליקציה: Next.js (App Router)
- אימות: Clerk
- הרשאות: RBAC (`admin`, `editor`, `viewer`)
- DB: Neon Postgres
- נתוני תלמידים: Neon Postgres (`neon_students`)

## מה מוכן בקוד

- כניסה/הרשמה עם Clerk (`/sign-in`, `/sign-up`)
- עמוד תלמידים (`/`) עם:
  - חיפוש לפי שם
  - חיפוש לפי ת"ז
  - שליפה לפי מוסד
  - פילטרים/מיון
  - עריכה מהירה של מידע פנימי מהרשימה
- עמוד כרטיס תלמיד (`/students/[id]`) עם עריכת מידע פנימי
- עמוד ניהול הרשאות (`/admin`) למנהלים בלבד
- אתחול טבלאות אוטומטי ב־DB בהפעלה ראשונה

## משתני סביבה (Vercel)

העתק מ־`.env.example`:

- Clerk:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
  - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
  - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
  - `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/`
  - `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/`
- DB:
  - `DATABASE_URL` (Neon)
- Roles bootstrap:
  - `BOOTSTRAP_ADMIN_EMAILS=you@example.com`
- App URL:
  - `CRM_BASE_URL=https://your-domain.example` (אופציונלי, עבור קישורים בהתראות)

## חיבור מהיר ל־Vercel

1. דחוף את הקוד ל־GitHub.
2. ב־Vercel: `New Project` ובחר את הריפו.
3. Framework: `Next.js`.
4. הזן את כל ה־ENV מהסעיף למעלה.
5. Deploy.

## התקנה מקומית

```bash
npm install
npm run dev
```

גישה:
- `http://localhost:3000`

## הרשאות וגישה (מודל חדש)

- זיהוי משתמשים מתבצע לפי אימייל Clerk מול `email.primaryEmail` בכרטיס תלמיד ב־Neon.
- ברירת מחדל: לכל משתמש גישה רק לכרטיס התלמיד שלו (`/students/{id}`), בלי גישה לחיפוש.
- רק משתמשים שתלמידם שייך ל־`class=TEAM` יכולים:
  - לחפש תלמידים
  - לעדכן מידע פנימי
  - לאשר משתמשים לא מוכרים בעמוד `/admin`

## הערות

- הקבצים המקומיים הישנים (`server.js`, `users.local.json` וכו') נשארו רק לתאימות/היסטוריה.
- המערכת החדשה משתמשת ב־Clerk + Neon, לא בקבצי JSON מקומיים.

## CRM API על Neon

ניהול הטוקנים מתבצע ב־`/admin`.

Endpoints ראשוניים:

- `GET /api/crm/students?q=כהן&limit=10&offset=0`
- `GET /api/crm/students?institution=CY`
- `GET /api/crm/students?tz=123456789`
- `GET /api/crm/students/{id}`
- `GET /api/crm/export?resource=all`
- `GET /api/crm/export?resource=neon_students`
- `POST /api/crm/students`
- `PATCH /api/crm/students/{id}`
- `DELETE /api/crm/students/{id}`

דוגמאות:

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/crm/students?q=כהן&limit=5"

curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/crm/students?institution=CY&limit=20"

curl -X POST \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"fullName":{"firstName":"אברהם","lastName":"כהן"},"currentInstitution":"CY","class":"A","email":{"primaryEmail":"a@example.com"}}' \
  "http://localhost:3000/api/crm/students"

curl -X PATCH \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"class":"B","registration":"DATOT"}' \
  "http://localhost:3000/api/crm/students/<student-id>"

curl -X DELETE \
  -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3000/api/crm/students/<student-id>"

curl -H "Authorization: Bearer <BACKUP_TOKEN>" \
  "http://localhost:3000/api/crm/export?resource=all"
```

Scopes:

- `students:read`
- `students:write`
- `students:delete`
- `backup:read`

כרגע token מסוג:

- `read` נותן `students:read`
- `write` נותן `students:read, students:write`
- `delete` נותן `students:read, students:delete`
- `full` נותן `students:read, students:write, students:delete`
- `backup` נותן `backup:read`

מגבלות נוכחיות:

- כרגע ה־API מכסה רק את resource של `students`
- החיפוש הוא אפליקטיבי על ה־mirror ב־Neon, לא full-text index ייעודי
- `limit` מוגבל ל־`500` לבקשה
- אין עדיין versioning כמו `/api/v1`
- אין rate limiting
- אין עדיין webhooks או change feed לאובייקטים
- אובייקטים עתידיים כמו פניות/לידים עדיין לא נחשפו, אבל מבנה ה־`resource` וה־`scopes` הוכן לזה

## גיבוי JSON

דרך API:

```bash
curl -H "Authorization: Bearer <BACKUP_TOKEN>" \
  "http://localhost:3000/api/crm/export?resource=all"
```

או להורדה כקובץ:

```bash
curl -L -H "Authorization: Bearer <BACKUP_TOKEN>" \
  "http://localhost:3000/api/crm/export?resource=all&download=1" \
  -o crm-export.json
```

פקודת גיבוי מלאה של מאגר ה־CRM ב־Neon ל־`stdout`:

```bash
npm run backup:json
```

או:

```bash
node /Users/netanelzevin/Documents/crm/scripts/backup-crm-json.mjs
```

כתיבה לקובץ לפי בחירה:

```bash
npm run backup:json -- --out ./backups/manual-export.json
```

אפשר גם מכל מקום במחשב:

```bash
node /Users/netanelzevin/Documents/crm/scripts/backup-crm-json.mjs --out /tmp/crm-backup.json
```

או לשלב ב-pipeline:

```bash
node /Users/netanelzevin/Documents/crm/scripts/backup-crm-json.mjs > /tmp/crm-backup.json
```

אם צריך קובץ env אחר:

```bash
node /Users/netanelzevin/Documents/crm/scripts/backup-crm-json.mjs --env /path/to/.env.local --out /tmp/crm-backup.json
```

הגיבוי כולל:

- `app_users`
- `student_internal_notes`
- `saved_student_views`
- `neon_user_preferences`
- `neon_students`
- `api_tokens`

## שיוך תגובות WhatsApp למפגשים

כל שליחה מתוך מפגש שומרת את מזהה הודעת WhatsApp עם המפגש, התלמיד והמספר שאליו נשלחה. כפתורי תשובה מהירה נושאים קוד נסתר לכל בחירה, גם כאשר בתבנית אין משתני טקסט. במסך השליחה ממפים כל כפתור לסטטוס הרצוי לפי סדר הכפתורים בתבנית.

תגובת טקסט להודעה מסוימת משויכת לפי מזהה ההודעה המקורית. טקסט ללא ציטוט משויך להודעת המפגש האחרונה שנשלחה לאותו מספר לפני זמן התגובה. כל שיוך טקסט מוגבל לחמש שעות ממועד השליחה; הודעה מצוטטת שאינה מוכרת אינה מועברת למפגש אחר. תגובות נשמרות בהיסטוריה ליד התלמיד, ומפגש נעול אינו מקבל שינויי סטטוס. היכולת לעקוב לפי מזהי הודעות חלה על שליחות חדשות לאחר העדכון; כפתורים ישנים עם קוד מפגש ממשיכים להיות מזוהים.

## גיבוי שבועי אוטומטי ב-Vercel

מדיניות הגיבוי: רשומות CRM בלבד, ללא תוכן קבצים. היצוא השבועי, יצוא ה־API ופקודת `backup:json` אינם כוללים העלאות הדפסה זמניות, עמודות Base64 או נתונים בינאריים, ותוכן קבצים מצורפים בתוך JSON. נשמרים נתוני תלמידים, הרשאות, רשומות טקסט, ומטא־דאטה והפניות לקבצים ב־R2. היצוא אינו מוריד או מגבה את קובצי R2 עצמם. שדות קובץ שהושמטו אינם ניתנים לשחזור מהגיבוי הזה.

בסיום טיפול בהדפסה, גם בכישלון, תוכן הקובץ נמחק מ־Neon ומ־R2 לפי מקום אחסונו. נשמרת רשומת העבודה בלבד. בכישלון נשלח למעלה הקובץ מייל המנחה להעלות אותו מחדש. כשל במחיקה מ־R2 מוחזר כשגיאה כדי לאפשר ניסיון ניקוי חוזר, והמפתח נמחק מהרשומה רק אחרי שהמחיקה הצליחה.

נוסף cron route:

- `GET /api/cron/weekly-backup`
- `GET /api/cron/event-reminders`

הגדרות:

- בקובץ [vercel.json](/Users/netanelzevin/Documents/crm/vercel.json) הוגדר cron שבועי ליום חמישי ב-`19:00 UTC`
- בקובץ [vercel.json](/Users/netanelzevin/Documents/crm/vercel.json) הוגדר גם cron נוסף לתזכורות אירועים ב-`19:10 UTC`
- ב-Vercel צריך להגדיר `CRON_SECRET` כדי שהקריאה תגיע עם `Authorization: Bearer <CRON_SECRET>`
- מקבלי הגיבוי הם רק משתמשים בתפקיד `super_admin`
- לכל סופר אדמין אפשר להגדיר בעמוד `/admin/users/{id}` אם לקבל את הגיבוי ב-`Email`, `Telegram`, או `Email + Telegram`

תזכורות אירועים:

- נשלחות בכל יום חמישי למשתמשי מערכת שהכרטיס המקושר שלהם מסומן בתגית `צוות חכמי`
- המייל כולל שני מקטעים: אירועים ב-10 הימים הקרובים, ואירועים שחלו ב-10 הימים האחרונים
- האירועים משתמשים באותה לוגיקת תאריך עברי של המערכת, כולל איחוד אדר בשנה רגילה והעברת ל׳ ל-א׳ בחודש הבא כשצריך

מה נשלח:

- קובץ JSON מצורף עם כל טבלאות ה-CRM
- ללא תמונות
- עם מניעת הרצה כפולה לאותו יום כדי לצמצם כפילויות ב-cron

שליחת WhatsApp ממפגש באמצעות מערכת חיצונית: [תיעוד ה־API](docs/attendance-whatsapp-api.md).

### יצירת תבנית הודעה ממסמך Word

ב־`/announcements` → ניהול תבניות Word ו־Google Docs → יצירת תבנית חדשה,
בוחרים העלאת DOCX (עד 4MB). במסמך מסמנים שדות בסוגריים מסולסלים, למשל `{t}` או `{שם}`.
המערכת מזהה שדות ייחודיים גם בטבלאות, בכותרות ובתחתיות העמוד, ומבקשת תווית למשתמש
וסוג קלט (שורה אחת או רב־שורות) עבור כל שדה. התוויות מגדירות את טופס יצירת ההודעה;
מזהי השדות נשארים תואמים למסמך. הקובץ נשמר ב־R2 בעת יצירת התבנית.
היצירה והזיהוי זמינים לסופר־אדמין, בהתאם להרשאות ניהול התבניות הקיימות.

### פקודות מאובטחות לצוות

`/commands` מציג לכל משתמש מאושר רק את הפקודות הפעילות שהוקצו לו. סופר אדמין יוצר, משנה הרשאות ומשבית פקודות. ניתן להדביק בקשת `curl` עם `-X`, `-H`, `--data`/`--data-raw`/`--data-binary` או להזין URL, שיטה, כותרות JSON וגוף בקשה. אין הרצת shell או גישה לקבצים. בקשות מוגבלות ל־HTTPS ציבורי בפורט 443; הפניות אינן נעקבות וכתובות DNS נבדקות ונקבעות בחיבור עצמו.

כל הגדרת הבקשה מוצפנת ב־AES-256-GCM במסד הנתונים. מומלץ להגדיר `COMMANDS_ENCRYPTION_KEY` כמפתח שרת קבוע; בהיעדרו נעשה שימוש במפתח `CLERK_SECRET_KEY` עם הפרדת תחום. שינוי המפתח מחייב הזנה מחדש של הגדרות הפקודות. מפתח ההצפנה אינו נשמר במסד. גם סופר אדמין אינו מקבל את הסודות השמורים בחזרה לדפדפן: ניתן להחליף הגדרה או להשאיר אותה ללא שינוי. טבלאות `system_commands`, `system_command_keys` ו־`system_command_runs` נוצרות אוטומטית בכניסה הראשונה. ההיסטוריה כוללת מפעיל, שעה ותוצאת HTTP בלבד, ללא תוכן תשובה או בקשה. קיימים חלון של 30 שניות בין הפעלות אותה פקודה, מגבלת רשת של 15 שניות וללא ניסיון חוזר אוטומטי. אישור HTTP אינו אישור של מצב המכשיר הפיזי. מכשיר שזמין רק ברשת מקומית דורש שער HTTPS ציבורי מאובטח.

### קובץ תלמידים נפרד בגיבוי השבועי

הגיבוי השבועי כולל בנוסף ל־JSON ולאקסל הכללי קובץ `crm-students-*.xlsx` עצמאי. הגיליון `תלמידים` כולל את כל רשומות `neon_students` עם עמודות שטוחות, תוויות בעברית, שדות נוספים ומספר הרשומות. מזהים ומספרי טלפון נשמרים כטקסט. `נתוני מקור` שומר את הרשומות המקוריות ללא תוכן קבצים, כולל פיצול ערכים ארוכים לחלקים כדי למנוע אובדן במגבלת התאים של Excel. הקובץ נשלח ראשון בטלגרם ומצורף גם במייל לפי ערוצי הגיבוי שהוגדרו. חסר בטבלת התלמידים או אי התאמה במספר הרשומות מכשילים את הגיבוי במקום לשלוח קובץ ריק בטעות.


מאגר המפתחות באותו מסך מאפשר שימוש חוזר במפתח בכמה פקודות. הערך נשמר מוצפן בנפרד מהבקשה, אינו מוחזר לדפדפן ומוזרק רק בזמן ההפעלה. ניתן לצרפו כ־Authorization Bearer, בכותרת מותאמת או בפרמטר query. החלפת ערך במאגר מעדכנת את כל הפקודות המקושרות; השבתת מפתח חוסמת אותן. ניתן לטעון דוגמת cURL לשדות: URL, שיטה, כותרות ו־JSON, עם זיהוי מפתחות נפוצים והפרדתם לשדה המפתח. גם הוספת מפתח מתוך טופס הפקודה נשמרת במאגר המשותף. דוגמת cURL להעתקה משתמשת ב־`{{COMMAND_KEY}}` עבור המפתח הנבחר. בקשות קיימות ללא מפתח משותף ממשיכות לעבוד.

לכל פקודה קישור `/commands/{id}` עם הרשאות זהות לרשימה, כפתור העתקת קישור והיסטוריה מסוננת לאותה פקודה. פתיחת הקישור לעולם אינה מפעילה פעולה; ההפעלה מתבצעת ב־POST מאומת בלבד. ניתן לחפש פקודות לפי שם ותיאור ברשימה.

בקשות JSON ריקות נשלחות כ־`{}` עם `Content-Type: application/json`; קיימת התאמה אוטומטית לבקשות POST ריקות ישנות לנתיבי `/api/mdm/`. קידומת Bearer שנכללה בערך המפתח אינה מוכפלת. השליחה קובעת Content-Length לפי UTF-8, ממתינה לסיום התשובה ובודקת שגיאות API נפוצות גם ב־HTTP 200. תשובות HTML, JSON פגום, הפניה או חיבור שנקטע מדווחות בנפרד. סיכום המבנה לסופר אדמין אינו כולל ערכי מפתחות, גוף בקשה או ערכי פרמטרים. בהיסטוריה נשמרת קטגוריית תוצאה בלבד, ללא תוכן תשובה. מזהה ההפעלה נשלח בכותרת `X-CRM-Command-Run-Id` להצלבה עם השרת. קבלת HTTP תקין עדיין אינה מאמתת ביצוע במכשיר.


בכל פקודה ניתן לבחור את סוג התשובה הצפויה בשדה נפרד: `API / JSON`, `דף אינטרנט`, או `אוטומטי`. השדה נשמר בנפרד מהבקשה, ולכן ניתן לשנות אותו בלי לחשוף או להזין מחדש URL ומפתחות. מצב API דוחה HTML ותוכן שאינו JSON; מצב דף אינטרנט מאפשר HTML תקין. מזהים שנראים כמפתחות בנתיב ה־URL מוסתרים גם בסיכום המבנה.
