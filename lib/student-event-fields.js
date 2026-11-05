import {months} from "@hebcal/core";
export const STUDENT_EVENT_TYPE_OPTIONS = [
  { value: "birthday", label: "יום הולדת" },
  { value: "wedding", label: "חתונה" },
  { value: "memorial", label: "יום זיכרון" },
  { value: "other", label: "אחר" }
];

export const STUDENT_EVENT_TYPE_LABELS = Object.fromEntries(
  STUDENT_EVENT_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

export const HEBREW_MONTH_OPTIONS = [
  { value: "TISHREI", label: "תשרי", monthNumber: months.TISHREI },
  { value: "CHESHVAN", label: "חשוון", monthNumber: months.CHESHVAN },
  { value: "KISLEV", label: "כסלו", monthNumber: months.KISLEV },
  { value: "TEVET", label: "טבת", monthNumber: months.TEVET },
  { value: "SHVAT", label: "שבט", monthNumber: months.SHVAT },
  { value: "ADAR_I", label: "אדר", monthNumber: months.ADAR_I },
  { value: "ADAR_II", label: "אדר ב׳", monthNumber: months.ADAR_II },
  { value: "NISAN", label: "ניסן", monthNumber: months.NISAN },
  { value: "IYYAR", label: "אייר", monthNumber: months.IYYAR },
  { value: "SIVAN", label: "סיוון", monthNumber: months.SIVAN },
  { value: "TAMUZ", label: "תמוז", monthNumber: months.TAMUZ },
  { value: "AV", label: "אב", monthNumber: months.AV },
  { value: "ELUL", label: "אלול", monthNumber: months.ELUL }
];


export function normalizeRequestedEvents(events){
 if(!Array.isArray(events)||events.length>20)throw new Error('ניתן להוסיף עד 20 אירועים בכל בקשה.');
 return events.map(event=>{
  if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).some(key=>!['eventType','customEventLabel','noteText','hebrewDay','hebrewMonthCode'].includes(key)))throw new Error('פרטי האירוע אינם תקינים.');
  const eventType=String(event.eventType||''),hebrewMonthCode=String(event.hebrewMonthCode||''),day=String(event.hebrewDay||''),customEventLabel=String(event.customEventLabel||'').trim(),noteText=String(event.noteText||'').trim();
  if(!STUDENT_EVENT_TYPE_OPTIONS.some(option=>option.value===eventType)||!HEBREW_MONTH_OPTIONS.some(option=>option.value===hebrewMonthCode)||!/^([1-9]|[12][0-9]|30)$/.test(day))throw new Error('יש לבחור סוג אירוע, יום וחודש עבריים תקינים.');
  if(customEventLabel.length>150||noteText.length>2000||(eventType==='other'&&!customEventLabel))throw new Error('יש להזין שם לאירוע אחר (עד 150 תווים) והערה עד 2000 תווים.');
  return {eventType,customEventLabel:eventType==='other'?customEventLabel:'',noteText,hebrewDay:Number(day),hebrewMonthCode};
 });
}
export function requestedEventLabel(event){return `${STUDENT_EVENT_TYPE_LABELS[event.eventType]||'אירוע'}${event.customEventLabel?' — '+event.customEventLabel:''} · ${event.hebrewDay} ${HEBREW_MONTH_OPTIONS.find(month=>month.value===event.hebrewMonthCode)?.label||''}`;}
