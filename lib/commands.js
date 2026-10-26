import { randomUUID } from 'node:crypto';
import { initDb, sql } from './db.js';
import { encryptCommand, decryptCommand, sendCommand, CommandValidationError } from './command-request.js';

let ready;
async function ensureTables() {
  if(!ready) ready=(async()=>{
    await initDb();
    await sql`CREATE TABLE IF NOT EXISTS system_commands (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      encrypted_request TEXT NOT NULL, allowed_user_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      enabled BOOLEAN NOT NULL DEFAULT TRUE, last_run_at TIMESTAMPTZ,
      created_by TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS system_command_runs (
      id TEXT PRIMARY KEY, command_id TEXT NOT NULL REFERENCES system_commands(id),
      user_id TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      status TEXT NOT NULL, http_status INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_command_runs_command_date ON system_command_runs(command_id,created_at DESC)`;
  })().catch(error=>{ready=null;throw error;});
  await ready;
}
export function canRunCommand(user,command) {
  return Boolean(user && user.access_status==='approved' && command.enabled && (user.is_super_admin || command.allowed_user_ids?.includes(user.clerk_user_id)));
}
function requireAdmin(user) {
  if(!user?.is_super_admin || user.access_status!=='approved')throw new CommandValidationError('רק סופר אדמין יכול לנהל פקודות.');
}
export async function listCommands(user) {
  if(!user || user.access_status!=='approved')return [];
  await ensureTables();
  return sql`SELECT id,name,description,enabled,last_run_at,updated_at,
    CASE WHEN ${Boolean(user.is_super_admin)} THEN allowed_user_ids ELSE ARRAY[]::TEXT[] END AS allowed_user_ids
    FROM system_commands WHERE ${Boolean(user.is_super_admin)} OR (enabled AND ${user.clerk_user_id}=ANY(allowed_user_ids)) ORDER BY name,id`;
}
export async function listCommandRuns(user) {
  if(!user || user.access_status!=='approved')return [];
  await ensureTables();
  return sql`SELECT r.id,c.name,r.status,r.http_status,r.created_at,r.finished_at,u.display_name
    FROM system_command_runs r JOIN system_commands c ON c.id=r.command_id
    LEFT JOIN app_users u ON u.clerk_user_id=r.user_id
    WHERE ${Boolean(user.is_super_admin)} OR (r.user_id=${user.clerk_user_id} AND c.enabled AND ${user.clerk_user_id}=ANY(c.allowed_user_ids))
    ORDER BY r.created_at DESC LIMIT 40`;
}
export async function saveCommand(user,{id,name,description,enabled,allowedUserIds,requestConfig}) {
  requireAdmin(user);await ensureTables();
  name=String(name||'').trim();description=String(description||'').trim();
  if(!name || name.length>100 || description.length>500)throw new CommandValidationError('יש להזין שם עד 100 תווים ותיאור עד 500 תווים.');
  const ids=[...new Set(allowedUserIds||[])];if(ids.length>500)throw new CommandValidationError('יותר מדי משתמשים.');
  const approved=await sql`SELECT clerk_user_id FROM app_users WHERE access_status='approved' AND clerk_user_id=ANY(${ids}::TEXT[])`;
  if(approved.length!==ids.length)throw new CommandValidationError('יש לבחור רק משתמשים מאושרים.');
  const encrypted=requestConfig?encryptCommand(requestConfig):null;
  if(id) {
    const rows=await sql`UPDATE system_commands SET name=${name},description=${description},enabled=${Boolean(enabled)},allowed_user_ids=${ids}::TEXT[],encrypted_request=COALESCE(${encrypted},encrypted_request),updated_at=NOW() WHERE id=${id} RETURNING id`;
    if(!rows.length)throw new CommandValidationError('הפקודה לא נמצאה.');return id;
  }
  if(!encrypted)throw new CommandValidationError('חסרה הגדרת בקשה.');
  id=randomUUID();await sql`INSERT INTO system_commands(id,name,description,encrypted_request,allowed_user_ids,enabled,created_by)
    VALUES(${id},${name},${description},${encrypted},${ids}::TEXT[],${Boolean(enabled)},${user.clerk_user_id})`;return id;
}
export async function runCommand(user,id) {
  if(!user || user.access_status!=='approved')return {code:'denied'};
  await ensureTables();
  // The atomic claim rechecks permissions and prevents concurrent/double clicks across users and instances.
  const runId=randomUUID();
  const rows=await sql`WITH claimed AS (
    UPDATE system_commands SET last_run_at=NOW() WHERE id=${id} AND enabled
    AND (${Boolean(user.is_super_admin)} OR ${user.clerk_user_id}=ANY(allowed_user_ids))
    AND (last_run_at IS NULL OR last_run_at < NOW()-INTERVAL '30 seconds') RETURNING id,encrypted_request
  ), recorded AS (
    INSERT INTO system_command_runs(id,command_id,user_id,status) SELECT ${runId},id,${user.clerk_user_id},'started' FROM claimed RETURNING id
  ) SELECT encrypted_request FROM claimed WHERE EXISTS(SELECT 1 FROM recorded)`;
  if(!rows.length)return {code:'unavailable'};
  let result;
  try {result=await sendCommand(decryptCommand(rows[0].encrypted_request));}
  catch {result={ok:false,status:null};}
  await sql`UPDATE system_command_runs SET status=${result.ok?'succeeded':'failed'},http_status=${result.status},finished_at=NOW() WHERE id=${runId}`;
  return {code:result.ok?'sent':'failed'};
}
