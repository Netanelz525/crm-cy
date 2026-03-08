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
