# נוכחות מהרשת ונעילת מפגשים

מפגש תלמידים בתאריך של היום מבצע בדיקת רשת בעת יצירתו. כפתור „סנכרן נוכחות מהרשת” מאפשר בדיקה חוזרת. השרת בודק את המצב הנוכחי בלבד; מפגשים בתאריך אחר ומפגשי הורים אינם מסונכרנים.

נשלחות כתובות MAC בלבד, ללא שמות או מזהי תלמיד. מחובר לרשת מסומן „נמצא” רק אם אין לתלמיד רשומת נוכחות שמורה. רשומה ידנית, הערה או סימון קיים אינם נדרסים. מכשיר שאינו מחובר אינו מוכיח היעדרות ואינו משנה את הנוכחות. כתובות לא תקינות, כתובות חסרות וכתובות המשויכות ליותר מתלמיד אחד מדולגות ומוצגות בסיכום.

## הגדרת שרת

- `MAC_PRESENCE_API_URL`: כתובת HTTPS של נקודת הקצה.
- `MAC_PRESENCE_API_KEY`: המפתח מתוך הגדרת השירות, כמשתנה שרת סודי בלבד.

כתובת ברירת המחדל נלקחה ממסמך השירות: `https://unifi.kfilter.net/attendance/public/mac-presence`. פתיחת הכתובת בדפדפן אינה בדיקת API: נדרשת בקשת POST עם JSON ומפתח.

אם הנתיב מוגן ב־Cloudflare Access, נדרשת הרשאת שירות מתאימה. ניתן להגדיר `MAC_PRESENCE_CF_ACCESS_CLIENT_ID` ו־`MAC_PRESENCE_CF_ACCESS_CLIENT_SECRET` יחד, כמשתני שרת סודיים. לחלופין, מנהל התשתית יכול לאשר החרגה נקודתית של נתיב ה־API ב־Access, תוך שמירת אימות מפתח ה־API בשירות עצמו. אין להסיר הגנה מכל הדומיין.

החיבור אינו עוקב אחרי הפניות. הפניה ל־Cloudflare Access מוצגת כשגיאת גישה מפורשת; HTTP 200 של דף HTML אינו נחשב הצלחה. רק תשובת JSON תקינה לפי חוזה השירות מאשרת חיבור. למנהלים מוצג כפתור „בדיקת חיבור ללא שינוי נוכחות”, המשתמש בכתובת MAC מלאכותית ואינו מעדכן תלמידים.

אין להשתמש בקידומת `NEXT_PUBLIC_`, להכניס מפתח לקוד או לתעד אותו בלוגים. המפתח נשלח בכותרת `X-API-Key`; הפניות HTTP אינן נעקבות. הבדיקה נעשית במנות של עד 200 כתובות, עם זמן המתנה מוגבל והגנה מסנכרונים מקבילים. רק לאחר שכל התשובות אומתו, התוצאה נשמרת באופן אטומי. תקלה אינה מכשילה יצירת מפגש ואינה מאפסת נתוני נוכחות.

## נעילה

ברירת המחדל לכל המפגשים, גם קיימים: נעילה בתחילת היום השלישי לאחר תאריך המפגש, לפי שעון ישראל. לדוגמה, מפגש בתאריך 15 בחודש ננעל ב־18 בחודש בשעה 00:00. מנהל יכול לקבוע תאריך נעילה אחר בעת יצירה או בפרטי המפגש; ניקוי השדה מחזיר לברירת המחדל. נעילה ידנית ממשיכה לחול גם אם המועד האוטומטי עתידי. פתיחת נעילה לאחר שחלף המועד מעניקה שלושה ימים נוספים מהיום.

הנעילה מחושבת בכל גישה ונאכפת גם ב־PostgreSQL על הוספה, שינוי ומחיקה של רשומות נוכחות, כך שאינה תלויה במשימת cron. מוקד השיחות וקישורי התגובה משתמשים באותו מועד. מחיקת מפגש שלם בידי מורשה עדיין אפשרית; הנעילה אינה מדיניות שמירת נתונים.

## אימות

בדיקות מול PostgreSQL מקומי (PGlite) מכסות שמירת סימונים והערות, סנכרון חוזר, כשל במנה מאוחרת ללא שמירה חלקית, תחרות עם סימון ידני ונעילה במהלך בדיקה, תאריך נעילה מותאם, נעילה ידנית ומחיקת מפגש עם רשומות נעולות. בדיקות נוספות מכסות מנות API, זהויות MAC, כשלי ספק ותגובה לא תקינה.

## Automatic four-hour window
The meeting panel provides a switch instead of the connection diagnostic button.
Enabling it runs a presence sync immediately and persists a four-hour deadline with
checks due every 30 minutes. Turning it off cancels further automatic writes;
expired windows do not restart without an explicit user action. Locked meetings,
meetings for another Israel date and parent meetings are excluded. Existing
attendance and notes remain protected by the same insert-only synchronizer.

`/api/cron/attendance-presence` uses GitHub Actions OIDC (restricted to this repository, main branch and the exact scheduled workflow) and
a five-minute scheduler to claim due meetings atomically. Checks normally start
within five minutes of their due time; provider errors remain visible on the meeting
and the next interval can retry. Scheduling does not depend on an open browser.

The network panel now refreshes while its four-hour window is active. Once a
minute it asks the authenticated server to claim any due interval for this meeting
only; the same atomic claim is shared with the background scheduler. This provides
a fallback for delayed GitHub schedules while the page is open, and displays the
next due time. Background scheduling can still be delayed by GitHub when the app
is closed; there is no exact-time delivery guarantee.

New records inserted by Wi-Fi synchronization store `presence_source='wifi'`,
`network_marked_at`, and a human-readable automatic-mark note. Saved manual records
and notes are untouched. Existing historical records without reliable provenance
are not retroactively attributed to Wi-Fi. Changing a record's status manually
changes its current source to manual while preserving the historical network time.
