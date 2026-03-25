# CRM on Vercel (Clerk + Neon)

מיגרציה מלאה ל־Vercel:
- אפליקציה: Next.js (App Router)
- אימות: Clerk
- הרשאות: RBAC (`admin`, `editor`, `viewer`)
- DB: Neon Postgres
- נתוני תלמידים: Twenty GraphQL

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
- Twenty:
  - `TWENTY_API_URL=https://api.twenty.com/graphql`
  - `TWENTY_API_TOKEN=...`

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

- זיהוי משתמשים מתבצע לפי אימייל Clerk מול `email.primaryEmail` בכרטיס תלמיד ב־Twenty.
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
```

Scopes:

- `students:read`
- `students:write`
- `students:delete`

כרגע token מסוג:

- `read` נותן `students:read`
- `write` נותן `students:read, students:write`
- `delete` נותן `students:read, students:delete`
- `full` נותן `students:read, students:write, students:delete`

מגבלות נוכחיות:

- כרגע ה־API מכסה רק את resource של `students`
- החיפוש הוא אפליקטיבי על ה־mirror ב־Neon, לא full-text index ייעודי
- `limit` מוגבל ל־`500` לבקשה
- אין עדיין versioning כמו `/api/v1`
- אין rate limiting
- אין עדיין webhooks או change feed לאובייקטים
- אובייקטים עתידיים כמו פניות/לידים עדיין לא נחשפו, אבל מבנה ה־`resource` וה־`scopes` הוכן לזה

## גיבוי JSON

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
- `neon_students`
- `api_tokens`
