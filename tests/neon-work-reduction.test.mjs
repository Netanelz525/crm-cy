import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureSchemaGuard} from '../lib/db-feature-schema.js';
import {startVisiblePolling} from '../lib/visible-polling.js';

test('feature migrations survive server restarts without repeating DDL and upgrade independently',async()=>{
 const versions=new Map();let migrations=0,reads=0;
 const sql=async(strings,...args)=>{const query=strings.join('?');if(query.startsWith('SELECT')){reads++;return versions.has(args[0])?[{version:versions.get(args[0])}]:[];}versions.set(args[0],args[1]);return [];};
 const dependencies={sql,initDb:async()=>{}};
 let ensure=createFeatureSchemaGuard(dependencies);
 await Promise.all([ensure('commands','v1',async()=>{migrations++;}),ensure('commands','v1',async()=>{migrations++;})]);
 assert.equal(migrations,1);assert.equal(reads,1);
 ensure=createFeatureSchemaGuard(dependencies);await ensure('commands','v1',async()=>{migrations++;});assert.equal(migrations,1);assert.equal(reads,2);
 await ensure('replies','v1',async()=>{migrations++;});await ensure('commands','v2',async()=>{migrations++;});assert.equal(migrations,3);assert.equal(versions.get('feature:replies'),'v1');assert.equal(versions.get('feature:commands'),'v2');
});
test('failed migrations never mark completion and can be retried in the same server',async()=>{
 const versions=new Map();const sql=async(strings,...args)=>{if(strings.join('').startsWith('SELECT'))return [];versions.set(args[0],args[1]);return [];};
 const ensure=createFeatureSchemaGuard({sql,initDb:async()=>{}});
 await assert.rejects(ensure('tokens','v1',async()=>{throw Error('migration failed');}));assert.equal(versions.size,0);
 await ensure('tokens','v1',async()=>{});assert.equal(versions.get('feature:tokens'),'v1');
});
function surface(){const handlers=new Map();return {visibilityState:'visible',addEventListener:(name,callback)=>handlers.set(name,callback),removeEventListener:(name,callback)=>{assert.equal(handlers.get(name),callback);handlers.delete(name);},fire:name=>handlers.get(name)?.(),handlers};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('foreground polling keeps its cadence, sleeps when hidden, resumes immediately, and cleans up',async()=>{
 const doc=surface(),win=surface();let tick,calls=0,pauses=0,cleared=false;
 const stop=startVisiblePolling(async()=>{calls++;},{document:doc,window:win,intervalMs:10000,onPause:()=>pauses++,setInterval:(fn,ms)=>{assert.equal(ms,10000);tick=fn;return 17;},clearInterval:id=>{assert.equal(id,17);cleared=true;}});
 await settle();assert.equal(calls,1);tick();await settle();assert.equal(calls,2);
 doc.visibilityState='hidden';doc.fire('visibilitychange');tick();win.fire('focus');await settle();assert.equal(calls,2);assert.equal(pauses,1);
 doc.visibilityState='visible';doc.fire('visibilitychange');await settle();assert.equal(calls,3);
 stop();tick();await settle();assert.equal(calls,3);assert(cleared);assert.equal(doc.handlers.size,0);assert.equal(win.handlers.size,0);
});
test('slow requests cannot overlap even when a timer and focus arrive together',async()=>{
 const doc=surface(),win=surface();let tick,finish,calls=0;
 const stop=startVisiblePolling(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},{document:doc,window:win,intervalMs:10000,setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}});
 tick();win.fire('focus');assert.equal(calls,1);finish();await settle();tick();assert.equal(calls,2);stop();finish();await settle();
});
test('a tab opened in the background makes no initial database request',async()=>{
 const doc=surface(),win=surface();doc.visibilityState='hidden';let calls=0;
 const stop=startVisiblePolling(async()=>calls++,{document:doc,window:win,intervalMs:10000,setInterval:()=>1,clearInterval:()=>{}});await settle();assert.equal(calls,0);doc.visibilityState='visible';doc.fire('visibilitychange');await settle();assert.equal(calls,1);stop();
});
