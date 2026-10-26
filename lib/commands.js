import { randomUUID } from 'node:crypto';
import { initDb, sql } from './db.js';
import { encryptCommand, decryptCommand, sendCommand, CommandValidationError, encryptCommandKey, decryptCommandKey, applyCommandKey, validateKeyBinding, prepareCommandRequest, commandResponseType } from './command-request.js';

let ready;
async function ensureTables() {
  if(!ready) ready=(async()=>{
    await initDb();
    await sql`CREATE TABLE IF NOT EXISTS system_command_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, encrypted_value TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS system_commands (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      encrypted_request TEXT NOT NULL, allowed_user_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      enabled BOOLEAN NOT NULL DEFAULT TRUE, last_run_at TIMESTAMPTZ,
      created_by TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE system_commands ADD COLUMN IF NOT EXISTS response_type TEXT NOT NULL DEFAULT 'auto'`;
    await sql`ALTER TABLE system_commands ADD COLUMN IF NOT EXISTS key_id TEXT REFERENCES system_command_keys(id)`;
    await sql`ALTER TABLE system_commands ADD COLUMN IF NOT EXISTS key_type TEXT NOT NULL DEFAULT 'bearer'`;
    await sql`ALTER TABLE system_commands ADD COLUMN IF NOT EXISTS key_parameter TEXT NOT NULL DEFAULT ''`;
    await sql`CREATE TABLE IF NOT EXISTS system_command_runs (
      id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES system_commands(id),
      user_id TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      status TEXT NOT NULL, http_status INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ
    )`;
    await sql`ALTER TABLE system_command_runs ADD COLUMN IF NOT EXISTS response_code TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_command_runs_command_date ON system_command_runs(command_id,created_at DESC)`;
  })().catch(error=>{ready=null;throw error;});
  await ready;
}
export function canRunCommand(user,command) {
  return Boolean(user && user.access_status==='approved' && command.enabled && command.key_available!==false && (user.is_super_admin || command.allowed_user_ids?.includes(user.clerk_user_id)));
}
function requireAdmin(user) {
  if(!user?.is_super_admin || user.access_status!=='approved')throw new CommandValidationError('רק סופר אדמין יכול לנהל פקודות.');
}
export async function listCommands(user) {
  if(!user || user.access_status!=='approved')return [];
  await ensureTables();
  return sql`SELECT id,name,description,enabled,last_run_at,updated_at,
    CASE WHEN ${Boolean(user.is_super_admin)} THEN response_type ELSE NULL END AS response_type,
    (key_id IS NULL OR EXISTS(SELECT 1 FROM system_command_keys k WHERE k.id=system_commands.key_id AND k.enabled)) AS key_available,
    CASE WHEN ${Boolean(user.is_super_admin)} THEN key_id ELSE NULL END AS key_id,
    CASE WHEN ${Boolean(user.is_super_admin)} THEN key_type ELSE NULL END AS key_type,
    CASE WHEN ${Boolean(user.is_super_admin)} THEN key_parameter ELSE NULL END AS key_parameter,
    CASE WHEN ${Boolean(user.is_super_admin)} THEN allowed_user_ids ELSE ARRAY[${user.clerk_user_id}]::TEXT[] END AS allowed_user_ids
    FROM system_commands WHERE ${Boolean(user.is_super_admin)} OR (enabled AND ${user.clerk_user_id}=ANY(allowed_user_ids)) ORDER BY name,id`;
}
export async function listCommandRuns(user,commandId=null) {
  if(!user || user.access_status!=='approved')return [];
  await ensureTables();
  return sql`SELECT r.id,c.name,r.status,r.http_status,r.response_code,r.created_at,r.finished_at,u.display_name
    FROM system_command_runs r JOIN system_commands c ON c.id=r.command_id
    LEFT JOIN app_users u ON u.clerk_user_id=r.user_id
    WHERE (${Boolean(user.is_super_admin)} OR (r.user_id=${user.clerk_user_id} AND c.enabled AND ${user.clerk_user_id}=ANY(c.allowed_user_ids)))
    AND (${commandId}::TEXT IS NULL OR c.id=${commandId})
    ORDER BY r.created_at DESC LIMIT 40`;
}
export async function getCommand(user,id) {
  const commands=await listCommands(user);return commands.find(command=>command.id===id)||null;
}
export async function getCommandRequestSummary(user,id) {
  requireAdmin(user);await ensureTables();
  const rows=await sql`SELECT c.encrypted_request,c.response_type,c.key_type,c.key_parameter,k.encrypted_value FROM system_commands c LEFT JOIN system_command_keys k ON k.id=c.key_id WHERE c.id=${id}`;
  if(!rows.length)return null;
  try {
    const row=rows[0],stored=decryptCommand(row.encrypted_request);let config={...stored,responseType:row.response_type||stored.responseType||'auto'};
    const prefixedBearer=Boolean(row.encrypted_value && row.key_type==='bearer' && /^Bearer\s/i.test(decryptCommandKey(row.encrypted_value)));
    if(row.encrypted_value)config=applyCommandKey(config,decryptCommandKey(row.encrypted_value),{type:row.key_type,parameter:row.key_parameter});
    config=prepareCommandRequest(config);const url=new URL(config.url);
    const parts=url.pathname.split('/');
    const safePath=parts.map((part,index)=>/^(token|key|secret|webhook|process)$/i.test(parts[index-1]||'')||(part.length>=24&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(part))?'[מוסתר]':part).join('/');
    let jsonFields=[];try{const parsed=JSON.parse(config.body);if(parsed&&typeof parsed==='object')jsonFields=Object.keys(parsed);}catch{}
    return {expectedResponse:commandResponseType(config),method:config.method,target:url.origin+safePath,queryNames:[...url.searchParams.keys()],contentType:config.headers['content-type']||'',bodyBytes:Buffer.byteLength(config.body),jsonFields,headerNames:Object.keys(config.headers),emptyJsonNormalized:!stored.body&&config.body==='{}',prefixedBearer};
  }catch{return {unavailable:true};}
}
export async function saveCommand(user,{id,name,description,enabled,allowedUserIds,requestConfig,responseType='auto',keyId=null,keyType="bearer",keyParameter=""}) {
  requireAdmin(user);await ensureTables();
  name=String(name||'').trim();description=String(description||'').trim();
  if(!name || name.length>100 || description.length>500)throw new CommandValidationError('יש להזין שם עד 100 תווים ותיאור עד 500 תווים.');
  const ids=[...new Set(allowedUserIds||[])];if(ids.length>500)throw new CommandValidationError('יותר מדי משתמשים.');
  const approved=await sql`SELECT clerk_user_id FROM app_users WHERE access_status='approved' AND clerk_user_id=ANY(${ids}::TEXT[])`;
  if(approved.length!==ids.length)throw new CommandValidationError('יש לבחור רק משתמשים מאושרים.');
  if(keyId) {
    validateKeyBinding(keyType,keyParameter);
    const keys=await sql`SELECT id FROM system_command_keys WHERE id=${keyId}`;
    if(!keys.length)throw new CommandValidationError('המפתח שנבחר אינו קיים במאגר.');
  }
  if(!['auto','api','web'].includes(responseType))throw new CommandValidationError('סוג התשובה אינו נתמך.');
  const encrypted=requestConfig?encryptCommand(requestConfig):null;
  if(id) {
    const rows=await sql`UPDATE system_commands SET name=${name},description=${description},enabled=${Boolean(enabled)},response_type=${responseType},allowed_user_ids=${ids}::TEXT[],key_id=${keyId},key_type=${keyType},key_parameter=${keyParameter},encrypted_request=COALESCE(${encrypted},encrypted_request),updated_at=NOW() WHERE id=${id} RETURNING id`;
    if(!rows.length)throw new CommandValidationError('הפקודה לא נמצאה.');return id;
  }
  if(!encrypted)throw new CommandValidationError('חסרה הגדרת בקשה.');
  id=randomUUID();await sql`INSERT INTO system_commands(id,name,description,encrypted_request,allowed_user_ids,enabled,created_by,key_id,key_type,key_parameter,response_type)
    VALUES(${id},${name},${description},${encrypted},${ids}::TEXT[],${Boolean(enabled)},${user.clerk_user_id},${keyId},${keyType},${keyParameter},${responseType})`;return id;
}
export async function listCommandKeys(user) {
  requireAdmin(user);await ensureTables();
  return sql`SELECT id,name,enabled,updated_at FROM system_command_keys ORDER BY name,id`;
}
export async function saveCommandKey(user,{id,name,value,enabled=true}) {
  requireAdmin(user);await ensureTables();name=String(name||'').trim();
  if(!name || name.length>100)throw new CommandValidationError('יש להזין שם למפתח עד 100 תווים.');
  const encrypted=value?encryptCommandKey(value):null;
  if(id) {
    const rows=await sql`UPDATE system_command_keys SET name=${name},enabled=${Boolean(enabled)},encrypted_value=COALESCE(${encrypted},encrypted_value),updated_by=${user.clerk_user_id},updated_at=NOW() WHERE id=${id} RETURNING id`;
    if(!rows.length)throw new CommandValidationError('המפתח לא נמצא.');
  } else {
    if(!encrypted)throw new CommandValidationError('יש להזין ערך למפתח חדש.');
    id=randomUUID();await sql`INSERT INTO system_command_keys(id,name,encrypted_value,enabled,created_by,updated_by) VALUES(${id},${name},${encrypted},${Boolean(enabled)},${user.clerk_user_id},${user.clerk_user_id})`;
  }
  return {id,name,enabled:Boolean(enabled)};
}
export async function runCommand(user,id) {
  if(!user || user.access_status!=='approved')return {code:'denied'};
  await ensureTables();
  // The atomic claim rechecks permissions and prevents concurrent/double clicks across users and instances.
  const runId=randomUUID();
  const rows=await sql`WITH claimed AS (
    UPDATE system_commands SET last_run_at=NOW() WHERE id=${id} AND enabled
    AND (${Boolean(user.is_super_admin)} OR ${user.clerk_user_id}=ANY(allowed_user_ids))
    AND (key_id IS NULL OR EXISTS (SELECT 1 FROM system_command_keys k WHERE k.id=system_commands.key_id AND k.enabled))
    AND (last_run_at IS NULL OR last_run_at < NOW()-INTERVAL '30 seconds') RETURNING id,encrypted_request,response_type,key_id,key_type,key_parameter
  ), recorded AS (
    INSERT INTO system_command_runs(id,command_id,user_id,status) SELECT ${runId},id,${user.clerk_user_id},'started' FROM claimed RETURNING id
  ) SELECT c.encrypted_request,c.response_type,c.key_type,c.key_parameter,k.encrypted_value FROM claimed c LEFT JOIN system_command_keys k ON k.id=c.key_id WHERE EXISTS(SELECT 1 FROM recorded)`;
  if(!rows.length)return {code:'unavailable'};
  let result;
  try {
    const row=rows[0];let config=decryptCommand(row.encrypted_request);config.responseType=row.response_type||config.responseType||'auto';
    if(row.encrypted_value)config=applyCommandKey(config,decryptCommandKey(row.encrypted_value),{type:row.key_type,parameter:row.key_parameter});
    result=await sendCommand(config,{requestId:runId});
  }
  catch {result={ok:false,status:null,outcome:'request_error'};}
  await sql`UPDATE system_command_runs SET status=${result.ok?'succeeded':'failed'},http_status=${result.status},response_code=${result.outcome||'http_received'},finished_at=NOW() WHERE id=${runId}`;
  return {code:result.ok?'sent':'failed'};
}
