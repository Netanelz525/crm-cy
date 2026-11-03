import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {canManagePersonalTools} from '../lib/personal-access.js';
async function actions(channel,getUser,writes){
 const context=vm.createContext({process:{env:{}}});
 const stubs={'next/cache':{revalidatePath:()=>{}},'../../lib/rbac':{requireAuthenticatedUser:getUser},'../../lib/personal-access':{canManagePersonalTools}};
 stubs['../../lib/'+channel]=channel==='whatsapp'?{getWhatsAppLinkByClerkUserId:async()=>{writes.push('read');return null;},createWhatsAppLinkCode:async()=>{writes.push('code');return {code:'demo'};},buildWhatsAppDeepLink:()=>'',unlinkWhatsAppByClerkUserId:async()=>writes.push('unlink')}:{getTelegramLinkByClerkUserId:async()=>{writes.push('read');return null;},createTelegramLinkCode:async()=>{writes.push('code');return {code:'demo'};},buildTelegramDeepLink:()=>'',unlinkTelegramByClerkUserId:async()=>writes.push('unlink'),setTelegramWebhook:async()=>writes.push('webhook')};
 const module=new vm.SourceTextModule(await fs.readFile(new URL('../app/'+channel+'/actions.js',import.meta.url),'utf8'),{context});await module.link(async name=>new vm.SyntheticModule(Object.keys(stubs[name]),function(){for(const [key,value]of Object.entries(stubs[name]))this.setExport(key,value);},{context}));await module.evaluate();return module.namespace;
}
test('student accounts cannot create, inspect or unlink agent connections through server actions',async()=>{
 for(const channel of ['whatsapp','telegram']){let user={access_status:'approved',linked_student_id:'student',can_use_print_queue:true},writes=[];const api=await actions(channel,async()=>user,writes);const prefix=channel==='whatsapp'?'WhatsApp':'Telegram';await assert.rejects(api['generate'+prefix+'LinkCodeAction']());await assert.rejects(api['unlink'+prefix+'Action']());if(channel==='telegram')await assert.rejects(api.setupTelegramWebhookAction());assert.equal(writes.length,0);user={access_status:'approved',is_manager:true,clerk_user_id:'manager'};assert.equal((await api['generate'+prefix+'LinkCodeAction']()).ok,true);assert.deepEqual(writes,['read','code']);}
});

test('actual account route redirects a student only to their own card and actual navigation hides tools and unassigned calls',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);const {transform}=require('next/dist/build/swc');const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 let user={clerk_user_id:'student-user',access_status:'approved',linked_student_id:'own-card'},hasCalls=false;
 async function loadPage(path){const compiled=await transform(await fs.readFile(new URL('../'+path,import.meta.url),'utf8'),{filename:path,jsc:{parser:{syntax:path.endsWith('.tsx')?'typescript':'ecmascript',jsx:true,tsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});const exports={};vm.runInNewContext(compiled.code,{exports,require:name=>{if(name==='react/jsx-runtime')return require(name);if(name==='next/link')return {__esModule:true,default:props=>React.createElement('a',props)};if(name==='@clerk/nextjs')return {ClerkProvider:({children})=>children,UserButton:()=>null};if(name.endsWith('/rbac'))return {getCurrentAppUser:async()=>user,signInRedirectUrl:async()=>'/sign-in'};if(name==='next/navigation')return {redirect:url=>{throw Error('REDIRECT:'+url);}};if(name.endsWith('/personal-access'))return {canManagePersonalTools};if(name.endsWith('/attendance-calls'))return {canAccessCallDesk:async()=>hasCalls};return {};}});return exports.default;}
 const Account=await loadPage('app/account/page.js');await assert.rejects(Account(),/REDIRECT:\/neon\/students\/own-card/);
 const Layout=await loadPage('app/layout.tsx');let html=renderToStaticMarkup(await Layout({children:React.createElement('p',null,'כרטיס תלמיד')}));assert(!html.includes('href="/commands"'));assert(!html.includes('href="/call-desk"'));assert(!html.includes('סוכן'));assert(html.includes('href="/account"'));hasCalls=true;html=renderToStaticMarkup(await Layout({children:null}));assert(html.includes('href="/call-desk"'));assert(!html.includes('href="/commands"'));
});
