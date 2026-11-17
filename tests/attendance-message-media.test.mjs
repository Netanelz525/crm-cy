import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const text=await readFile(new URL('../app/attendance/actions.js',import.meta.url),'utf8');
const start=text.indexOf('async function savedWhatsAppMedia('),end=text.indexOf('\nexport async function ',start);
const source=text.slice(start,end);
test('saved WhatsApp media reads bytes from R2 and uploads a fresh file only for the same meeting and template',async()=>{
 const loads=[],uploads=[];
 const fn=vm.runInNewContext(`(${source})`,{
  clean:value=>String(value||'').trim(),File,
  getAttendanceMessagePreset:async(sessionId,id)=>{assert.equal(sessionId,'meeting');assert.equal(id,'preset');return {channel:'whatsapp',payload:{templateName:'approved',attachment:{objectKey:'synthetic/photo.png',fileName:'photo.png',contentType:'image/png'}}};},
  getObjectBytesFromR2:async key=>{loads.push(key);return {bytes:new Uint8Array([1,2,3]),contentType:'image/png'};},
  uploadAttendanceWhatsAppImage:async file=>{uploads.push(file);return 'fresh-media-id';}
 });
 const form=new FormData();form.set('messagePresetId','preset');
 const media=await fn(form,'meeting','whatsappTemplateImage','whatsapp','approved');
 assert.equal(await media.upload(),'fresh-media-id');assert.equal(uploads[0].size,3);assert.equal(uploads[0].type,'image/png');
 assert.deepEqual([...new Uint8Array(await uploads[0].arrayBuffer())],[1,2,3]);
 const mismatched=await fn(form,'meeting','whatsappTemplateImage','whatsapp','other');
 assert.equal(await mismatched.upload(),'');assert.equal(loads.length,1);
});
