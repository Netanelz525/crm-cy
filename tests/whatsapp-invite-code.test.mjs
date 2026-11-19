import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";

test("limited invited users can link once while unapproved and unrelated viewers cannot", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE app_users(clerk_user_id text primary key,access_status text,role text,linked_student_class text,linked_student_id text);
      CREATE TABLE whatsapp_link_codes(code text primary key,clerk_user_id text,expires_at timestamptz,used_at timestamptz);
      CREATE TABLE whatsapp_user_links(clerk_user_id text primary key,whatsapp_wa_id text unique,phone_number text,profile_name text,is_active boolean,updated_at timestamptz);
      INSERT INTO app_users VALUES ('student','approved','viewer',NULL,'s1'),('viewer','approved','viewer',NULL,NULL),('pending','pending','editor',NULL,NULL);
      INSERT INTO whatsapp_link_codes VALUES ('STUDENT123','student',NOW()+INTERVAL '1 hour',NULL),('VIEWER1234','viewer',NOW()+INTERVAL '1 hour',NULL),('PENDING123','pending',NOW()+INTERVAL '1 hour',NULL);
    `);
    const sql = async (parts,...values) => (await db.query(parts.reduce((q,p,i)=>q+(i?`$${i}`:"")+p,""),values)).rows;
    const context = vm.createContext({ Date, Buffer });
    const module = new vm.SourceTextModule(await fs.readFile(new URL("../lib/whatsapp.js",import.meta.url),"utf8"),{context});
    await module.link(() => new vm.SyntheticModule(["sql","initDb"],function(){this.setExport("sql",sql);this.setExport("initDb",async()=>{});},{context}));
    await module.evaluate();
    const consume = (code) => module.namespace.consumeWhatsAppLinkCode({code,waId:"972500000000"});
    await assert.rejects(consume("VIEWER1234"));
    await assert.rejects(consume("PENDING123"));
    const result = await consume(" student123 ");
    assert.equal(result.clerkUserId,"student");
    await assert.rejects(consume("STUDENT123"));
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM whatsapp_user_links")).rows[0].n,1);
  } finally { await db.close(); }
});
