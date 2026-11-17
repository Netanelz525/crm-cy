import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const text=await readFile(new URL('../app/attendance/actions.js',import.meta.url),'utf8');
const start=text.indexOf('export async function restoreAttendanceMessagePresetAction(');
const source=text.slice(start).replace(/^export /,'');
test('loading an old invitation restores its content and attachment without renaming the cloned meeting',async()=>{
 const updates=[];
 const action=vm.runInNewContext(`(${source})`,{
  clean:v=>String(v||'').trim(),requireAttendanceUser:async()=>({}),
  getAttendanceMessagePreset:async(sessionId,id)=>{assert.equal(sessionId,'new');assert.equal(id,'saved');return {id,channel:'invitation',payload:{title:'Original title',invitationMessage:'saved body',attachment:{objectKey:'synthetic/photo.png'}}};},
  getAttendanceSessionById:async()=>({title:'New meeting title'}),
  updateAttendanceSessionInvitation:async(id,payload)=>updates.push({id,payload}),
  revalidatePath:()=>{},redirect:url=>{const error=Error('redirect');error.url=url;throw error;}
 });
 const form=new FormData();form.set('sessionId','new');form.set('messagePresetId','saved');
 await assert.rejects(action(form),e=>e.url==='/attendance/new?messagePresetId=saved');
 assert.equal(updates[0].payload.title,'New meeting title');assert.equal(updates[0].payload.invitationMessage,'saved body');assert.equal(updates[0].payload.attachment.objectKey,'synthetic/photo.png');
});
