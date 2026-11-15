export default function AttendanceLockDateField({ value = '', effectiveDate = '' }) {
  return <label>
    <span className="muted">תאריך נעילה אוטומטית (אופציונלי)</span>
    <input name="autoLockDate" type="date" defaultValue={value} />
    <small className="muted">ללא תאריך: נעילה שלושה ימים לאחר תאריך המפגש. הנעילה חלה בתחילת היום לפי שעון ישראל.{effectiveDate ? ` כעת: ${effectiveDate}.` : ''} מנהל יכול לשנות את המועד בהמשך.</small>
  </label>;
}
