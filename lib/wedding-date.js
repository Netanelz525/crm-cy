import {HDate} from '@hebcal/core';
export const HEBREW_WEDDING_MONTHS=[{value:7,label:'תשרי'},{value:8,label:'חשוון'},{value:9,label:'כסלו'},{value:10,label:'טבת'},{value:11,label:'שבט'},{value:12,label:'אדר'},{value:13,label:'אדר ב׳'},{value:1,label:'ניסן'},{value:2,label:'אייר'},{value:3,label:'סיוון'},{value:4,label:'תמוז'},{value:5,label:'אב'},{value:6,label:'אלול'}];
export function weddingMonths(year){const leap=HDate.isLeapYear(Number(year)||new HDate().getFullYear());return HEBREW_WEDDING_MONTHS.filter(month=>month.value!==13||leap).map(month=>month.value===12&&leap?{...month,label:'אדר א׳'}:month);}
export function weddingFromGregorian(value){
 const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw Error('יש לבחור תאריך לועזי תקין.');
 const [year,month,day]=raw.split('-').map(Number),date=new Date(0);date.setFullYear(year,month-1,day);date.setHours(12,0,0,0);
 if(year<1||year>9999||date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)throw Error('התאריך הלועזי אינו תקין.');
 const hebrew=new HDate(date);return {gregorian:raw,day:hebrew.getDate(),month:hebrew.getMonth(),year:hebrew.getFullYear(),hebrewLabel:hebrew.renderGematriya()};
}
export function weddingFromHebrew(dayValue,monthValue,yearValue){
 const day=Number(dayValue),month=Number(monthValue),year=Number(yearValue);
 if(!Number.isInteger(day)||!Number.isInteger(month)||!Number.isInteger(year)||year<3761||year>13759||day<1||!weddingMonths(year).some(item=>item.value===month)||day>HDate.daysInMonth(month,year))throw Error('התאריך העברי אינו תקין לשנה ולחודש שנבחרו.');
 const date=new HDate(day,month,year).greg();const gregorian=[String(date.getFullYear()).padStart(4,'0'),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');return weddingFromGregorian(gregorian);
}
export function weddingDateLabel(value){if(!value)return '—';try{const date=weddingFromGregorian(value),[year,month,day]=date.gregorian.split('-');return `${date.hebrewLabel} · ${day}.${month}.${year}`;}catch{return String(value);}}
