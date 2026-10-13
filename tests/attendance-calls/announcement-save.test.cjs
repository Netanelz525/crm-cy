const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

test("editing a dated announcement saves title and fields without corrupting its date", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE announcements (
      id text PRIMARY KEY, title text, announcement_date date, body_text text, body_html text,
      layout_override_json jsonb, template_id text, template_key text, template_fields_json jsonb,
      print_job_id text, queued_at timestamptz, updated_at timestamptz);
      INSERT INTO announcements(id,title,announcement_date,template_id,template_fields_json)
      VALUES ('test','old','2026-10-13','template','{"source":"old"}');`);
    const source = fs.readFileSync(path.join(__dirname, "../../lib/announcements.js"), "utf8");
    const dateFn = source.slice(source.indexOf("function announcementDateValue"), source.indexOf("function stripHtml"));
    const updateFn = source.slice(source.indexOf("export async function updateAnnouncement("), source.indexOf("export async function markAnnouncementPrintQueued")).replace("export ", "");
    const sql = async (parts, ...values) => (await db.query(parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows;
    const getAnnouncementById = async id => {
      const row = (await db.query("SELECT * FROM announcements WHERE id=$1", [id])).rows[0];
      return {id:row.id,title:row.title,announcementDate:row.announcement_date,templateId:row.template_id,
        templateFields:row.template_fields_json,queuedAt:row.queued_at,printJobId:row.print_job_id};
    };
    const api = new Function("sql", "getAnnouncementById", `
      const initDb=async()=>{};
      const clean=value=>String(value || "").trim();
      const sanitizeAnnouncementHtml=value=>clean(value);
      const stripHtml=value=>clean(value);
      const parseLayout=value=>value || {};
      ${dateFn}
${updateFn}
return {updateAnnouncement,announcementDateValue};
    `)(sql, getAnnouncementById);
    const saved = await api.updateAnnouncement("test", {title:"שם מעודכן",bodyText:"תוכן חדש",templateFields:{source:"מקור חדש",note:""}});
    assert.equal(saved.title,"שם מעודכן");
    assert.deepEqual(saved.templateFields,{source:"מקור חדש",note:""});
    assert.equal(api.announcementDateValue(saved.announcementDate),"2026-10-13");
    assert.equal(api.announcementDateValue(null),null);
    assert.equal(api.announcementDateValue("2026-10-13"),"2026-10-13");
    assert.throws(()=>api.announcementDateValue("2026-02-30"));
    assert.throws(()=>api.announcementDateValue(new Date("invalid")));
    await api.updateAnnouncement("test", {title:"ללא תאריך",announcementDate:null});
    assert.equal((await getAnnouncementById("test")).announcementDate,null);
  } finally { await db.close(); }
});
