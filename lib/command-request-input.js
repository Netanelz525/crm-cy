export class CommandValidationError extends Error {}
// Parse a deliberately limited curl grammar. Nothing is executed in a shell.
export function parseCurlInput(source) {
  if(typeof source!=='string' || source.length>80000) throw new CommandValidationError('פקודת cURL ארוכה מדי.');
  const tokens=[]; let token='',quote='',started=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(quote) { if(c===quote)quote=''; else if(c==='\\' && quote==='"' && ['"','\\'].includes(source[i+1]))token+=source[++i]; else token+=c; started=true; continue; }
    if(c==='"'||c==="'"){quote=c;started=true;} else if(c==='\\'){ if(source[i+1]==='\n')i++; else if(i+1<source.length) {token+=source[++i];started=true;} else throw new CommandValidationError('פקודה לא תקינה.'); }
    else if(/\s/.test(c)){if(started){tokens.push(token);token='';started=false;}}
    else if(/[;|&<>`$]/.test(c))throw new CommandValidationError('יש להדביק בקשת cURL אחת, ללא פקודות shell.');
    else {token+=c;started=true;}
  }
  if(quote)throw new CommandValidationError('מרכאות לא סגורות בפקודה.'); if(started)tokens.push(token);
  if(tokens.shift()!=='curl')throw new CommandValidationError('הפקודה צריכה להתחיל ב־curl.');
  const config={url:'',method:'',headers:{},body:''}; let data=false;
  for(let i=0;i<tokens.length;i++) {
    let flag=tokens[i], value; const eq=flag.indexOf('='); if(flag.startsWith('--')&&eq>0){value=flag.slice(eq+1);flag=flag.slice(0,eq);}
    if(['-s','--silent','-S','--show-error','--compressed'].includes(flag))continue;
    if(['-X','--request','-H','--header','-d','--data','--data-raw','--data-binary','--url'].includes(flag)) {
      value=value??tokens[++i]; if(value===undefined)throw new CommandValidationError('חסר ערך באפשרות cURL.');
      if(flag==='-X'||flag==='--request')config.method=value;
      else if(flag==='-H'||flag==='--header'){const colon=value.indexOf(':');if(colon<1)throw new CommandValidationError('כותרת לא תקינה.');config.headers[value.slice(0,colon).trim()]=value.slice(colon+1).trim();}
      else if(flag==='--url'){if(config.url)throw new CommandValidationError('ניתן להגדיר יעד אחד בלבד.');config.url=value;}
      else {if(data||value.startsWith('@'))throw new CommandValidationError('יש להזין גוף בקשה ישיר אחד, ללא קריאת קובץ.');config.body=value;data=true;}
    } else if(flag.startsWith('-'))throw new CommandValidationError('אפשרות cURL אינה נתמכת. השתמש בשדות הבקשה להזנה ידנית.');
    else {if(config.url)throw new CommandValidationError('ניתן להגדיר יעד אחד בלבד.');config.url=flag;}
  }
  if(data&&!Object.keys(config.headers).some(k=>k.toLowerCase()==='content-type'))config.headers['content-type']='application/x-www-form-urlencoded';
  config.method=config.method||(data?'POST':'GET'); return config;
}
export function extractCurlKey(config) {
  const result={...config,headers:{...config.headers}};
  for(const [name,value] of Object.entries(result.headers)) {
    if(name.toLowerCase()==='authorization' && /^Bearer\s+/i.test(value)) {delete result.headers[name];return {config:result,type:'bearer',parameter:'',value:value.replace(/^Bearer\s+/i,'')};}
    if(/^(x-api-key|api-key|apikey|x-auth-token)$/i.test(name)) {delete result.headers[name];return {config:result,type:'header',parameter:name,value};}
  }
  const url=new URL(result.url);
  for(const [name,value] of url.searchParams)if(/^(access_token|api_key|apikey|token|key)$/i.test(name)){url.searchParams.delete(name);result.url=url.href;return {config:result,type:'query',parameter:name,value};}
  return {config:result};
}
export function commandCurlExample(config,{hasKey=false,type='bearer',parameter=''}={}) {
  const headers=Object.fromEntries(Object.entries(config.headers||{}).map(([name,value])=>[name.toLowerCase(),value]));let url=config.url;
  if(hasKey) {
    if(type==='bearer')headers.authorization='Bearer {{COMMAND_KEY}}';
    else if(type==='header')headers[(parameter||'X-API-Key').toLowerCase()]='{{COMMAND_KEY}}';
    else {try{const parsed=new URL(url);parsed.searchParams.set(parameter||'api_key','{{COMMAND_KEY}}');url=parsed.href.replace(/%7B%7BCOMMAND_KEY%7D%7D/g,'{{COMMAND_KEY}}');}catch{}}
  }
  const quote=text=>"'"+String(text).replace(/'/g,"'\\''")+"'";
  return ['curl -X '+(config.method||'POST')+' '+quote(url||'https://api.example.com/device/on'),...Object.entries(headers).map(([name,value])=>'-H '+quote(`${name}: ${value}`)),...(config.body?['--data-raw '+quote(config.body)]:[])].join(' \\\n  ');
}
