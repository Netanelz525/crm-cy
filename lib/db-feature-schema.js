// Feature versions live in Postgres, so a fresh server does not repeat DDL.
// Migrations must remain idempotent: simultaneous first starts can both see a missing marker.
export function createFeatureSchemaGuard({sql,initDb}) {
  const pending=new Map();
  return function ensureFeatureSchema(key,version,migrate) {
    const cacheKey=key+':'+version;
    if(!pending.has(cacheKey)) {
      const work=(async()=>{
        await initDb();
        const rows=await sql`SELECT version FROM crm_schema_meta WHERE key=${'feature:'+key} LIMIT 1`;
        if(rows[0]?.version===version)return;
        await migrate();
        // Record completion only after every migration statement succeeds.
        await sql`INSERT INTO crm_schema_meta(key,version,updated_at) VALUES(${'feature:'+key},${version},NOW())
          ON CONFLICT(key) DO UPDATE SET version=EXCLUDED.version,updated_at=NOW()`;
      })();
      pending.set(cacheKey,work);
      work.catch(()=>{if(pending.get(cacheKey)===work)pending.delete(cacheKey);});
    }
    return pending.get(cacheKey);
  };
}
