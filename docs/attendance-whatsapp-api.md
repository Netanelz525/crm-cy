# שליחת WhatsApp ממפגש באמצעות API

כתובת: `https://crm-cy-nu.vercel.app/api/attendance/sessions/{sessionId}/whatsapp`

משתמשים בטוקן API קיים של ה־CRM בכותרת `Authorization: Bearer <TOKEN>`.
אין צורך להעביר מפתח Dualhook או מזהה חשבון פייסבוק למערכת החיצונית.

## גילוי תבניות ומיפוי

`GET` דורש `attendance:read` ומחזיר `item.templates`, `item.statusLabels` ו־`item.isLocked`.
לכל תבנית מוחזרים שם, שפה, הגדרות משתנים, כפתורים בסדר הספק ו־`suggestedResponseStatuses`.
מחרוזת ריקה במיפוי המוצע דורשת בחירת סטטוס מפורשת.

## הפעלת שליחה

`POST` דורש `attendance:write` ו־`Content-Type: application/json`.

```bash
curl -X POST 'https://crm-cy-nu.vercel.app/api/attendance/sessions/SESSION_ID/whatsapp' \
  -H 'Authorization: Bearer YOUR_CRM_API_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{
    "templateName": "bikoret_attendance_update_v1",
    "templateLanguage": "he",
    "recipientRoles": ["student"],
    "targetStatuses": ["missing"]
  }'
```

| שדה | משמעות |
| --- | --- |
| `templateName` | חובה: שם תבנית מאושרת המוחזרת ב־GET |
| `templateLanguage` | שפה, ברירת מחדל `he` |
| `recipientRoles` | `student`, `father`, `mother`; ברירת מחדל `["student"]` |
| `targetStatuses` | סטטוסי התלמידים לשליחה; ברירת מחדל `["missing"]`; מערך ריק = כולם |
| `studentId` | אופציונלי: תלמיד יחיד מתוך המפגש, בכפוף לסינון הסטטוסים |
| `responseStatuses` | מזהי סטטוסים בדיוק לפי סדר הכפתורים ב־GET; כשכל תווית כפתור תואמת סטטוס באופן חד־משמעי ניתן להשמיט והמיפוי אוטומטי |
| `parameterOverrides` | טקסט למשתנים חופשיים לפי מספר משתנה, למשל `{"3":"פרטי הגעה"}`; שמות ופרטי מפגש מתמלאים כמו בממשק |
| `imageId` | מזהה מדיה שהועלתה מראש ל־WhatsApp, לתבנית עם כותרת מדיה |

השליחה משתמשת ברשימת התלמידים ובפרטי הקשר שבמפגש. אין כתובת טלפון חופשית בבקשה.
מפגש נעול אינו מאפשר שליחה דרך נתיב זה. תבניות הזמנה נשלחות במסלול ההזמנה הנפרד.

תשובת הצלחה (`200`) כוללת `resource: "attendanceSessionWhatsAppSend"` ו־`item` עם:
`sessionId`, `templateName`, `templateLanguage`, `completed`, `recipientRoles`, `targetStatuses`, `responseStatuses`,
`sentMessages`, `failedMessages`, `missingRecipients`, `matchedStudents`, `errors`.
זו תשובה לאחר ביצוע, ולא אישור תור. קבלה אצל הספק אינה מבטיחה מסירה בפועל.

קודים: `400` בקשה או מיפוי שגויים; `401` טוקן חסר/שגוי; `403` הרשאה חסרה;
`404` מפגש לא נמצא; `409` מפגש נעול; `502` כשל טעינת תבניות או כישלון כל ניסיונות השליחה.
בהצלחה חלקית מוחזר `200` עם פירוט הכשל. אין מניעת כפילויות לבקשות חוזרות:
אין לחזור אוטומטית על בקשה שהצליחה חלקית או שלא ידועה תוצאתה בלי לבדוק קודם.

## תגובות

כפתורים משויכים מאחורי הקלעים למפגש ולתלמיד ומעדכנים את סטטוס הנוכחות הקיים.
תגובה מצוטטת משויכת להודעה המקורית; טקסט ללא ציטוט משויך להודעה האחרונה לנמען,
עד חמש שעות מהשליחה. נעילת מפגש מונעת עדכון סטטוס.
ניתן לקרוא את הסטטוסים והיסטוריית התגובות דרך `GET /api/attendance/sessions/{sessionId}` עם `attendance:read`.
