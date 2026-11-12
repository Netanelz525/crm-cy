export function callPhone(value){
 const raw=String(value&&typeof value==='object'?value.primaryPhoneNumber||'':value||'').trim();
 let digits=raw.replace(/\D/g,'');if(!digits)return '';
 const international=/^\s*(\+|00)/.test(raw);if(/^00/.test(digits))digits=digits.slice(2);
 const code=String(value?.primaryPhoneCallingCode||'972').replace(/\D/g,'').replace(/^00/,'')||'972';
 if(international){if(digits.startsWith(code+'0'))digits=code+digits.slice(code.length).replace(/^0+/,'');}
 else if(digits.startsWith(code)){digits=code+digits.slice(code.length).replace(/^0+/,'');}
 else digits=code+digits.replace(/^0+/,'');
 return /^[1-9]\d{6,14}$/.test(digits)?'+'+digits:'';
}
