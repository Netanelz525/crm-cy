import test from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import * as docx from '../lib/docx-template.js';

function fixture(body, {header='',footer=''}={}) {
 const zip=new PizZip();
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${header?'<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>':''}${footer?'<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>':''}</Types>`);
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${header?'<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>':''}${footer?'<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>':''}</Relationships>`);
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr>${header?'<w:headerReference w:type="default" r:id="rIdHeader"/>':''}${footer?'<w:footerReference w:type="default" r:id="rIdFooter"/>':''}</w:sectPr></w:body></w:document>`);
 if(header)zip.file('word/header1.xml',`<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${header}</w:hdr>`);
 if(footer)zip.file('word/footer1.xml',`<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${footer}</w:ftr>`);
 return zip.generate({type:'nodebuffer',compression:'DEFLATE'});
}
const p=text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sample=()=>fixture(p('{t}')+'<w:tbl><w:tr><w:tc>'+p('{שם}')+'</w:tc></w:tr></w:tbl>'+p('{t}'),{header:p('{7}'),footer:p('{חתימה}')});

test('detects unique single-brace fields throughout tables, headers and footers, with Hebrew and numeric IDs',()=>{
 const inspected=docx.inspectAnnouncementDocx(sample());
 assert.deepEqual(inspected.fields.map(f=>f.templateFieldId).sort(),['t','שם','7','חתימה'].sort());
 assert.equal(new Set(inspected.fields.map(f=>f.key)).size,4);assert(inspected.fields.every(f=>f.label===''));
});
test('Word split runs are detected and render with existing formatting preserved',()=>{
 const bytes=fixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{</w:t></w:r><w:r><w:t>t</w:t></w:r><w:r><w:t>}</w:t></w:r></w:p>');
 const inspected=docx.inspectAnnouncementDocx(bytes);assert.equal(inspected.fields[0].templateFieldId,'t');
 const rendered=docx.renderDocxTemplate(inspected.buffer,{t:'שלום עולם'});const xml=new PizZip(rendered).file('word/document.xml').asText();
 assert(xml.includes('שלום עולם'));assert(xml.includes('<w:b/>'));assert(!xml.includes('{t}'));
});
test('user labels map to each exact document ID and generated DOCX replaces every occurrence',()=>{
 const inspected=docx.inspectAnnouncementDocx(sample());
 const fields=docx.mappedDocxFields(inspected.fields,inspected.fields.map(f=>({...f,label:'תווית '+f.templateFieldId,type:f.templateFieldId==='t'?'multiline':'text'})));
 assert(fields.every(f=>f.label.startsWith('תווית ')));
 const values=Object.fromEntries(fields.map(f=>[f.templateFieldId,'ערך '+f.templateFieldId]));
 const zip=new PizZip(docx.renderDocxTemplate(inspected.buffer,values));
 for(const name of ['word/document.xml','word/header1.xml','word/footer1.xml'])assert(!/\{[^{}]+\}/.test(zip.file(name).asText()));
});
test('missing labels, forged field IDs, duplicate mappings and unsupported types cannot be saved',()=>{
 const {fields}=docx.inspectAnnouncementDocx(sample());const mapped=fields.map(f=>({...f,label:'תווית'}));
 for(const input of [[],mapped.map(f=>({...f,label:''})),mapped.map(f=>({...f,templateFieldId:'fake'})),mapped.map(f=>({...f,type:'image'})),mapped.map(()=>mapped[0])])assert.throws(()=>docx.mappedDocxFields(fields,input));
});
test('empty, malformed, oversized, broken placeholders and unsupported control tags fail clearly',()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('not docx'),Buffer.alloc(docx.MAX_DOCX_IMPORT_BYTES+1),fixture(p('אין שדות')),fixture(p('{t')),fixture(p('{#items}')+p('{name}')+p('{/items}')),fixture(p('{__proto__}'))])assert.throws(()=>docx.inspectAnnouncementDocx(bytes));
});

async function loadAction(overrides={}) {
 const uploads=[],saved=[],redirects=[];
 const file={name:'example.docx',type:docx.DOCX_CONTENT_TYPE,size:sample().length,arrayBuffer:async()=>sample()};
 const implementation={requireAuthenticatedUser:async()=>({is_super_admin:true,clerk_user_id:'user-1'}),isR2Configured:()=>true,uploadBufferToR2:async value=>uploads.push(value),createAnnouncementTemplate:async value=>{saved.push(value);return value;},revalidatePath:()=>{},redirect:url=>{redirects.push(url);throw Error('REDIRECT:'+url);},...docx,...overrides};
 const source=await fs.readFile(new URL('../app/announcements/actions.js',import.meta.url),'utf8');
 const imports=new Map([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)].map(m=>[m[2],m[1].split(',').map(x=>x.trim()).filter(Boolean)]));
 const context=vm.createContext({Buffer,crypto:{randomUUID},console});const module=new vm.SourceTextModule(source,{context});
 await module.link(async name=>{const names=imports.get(name);return new vm.SyntheticModule(names,function(){for(const key of names)this.setExport(key,implementation[key]||(()=>{throw Error('Unexpected call '+key);}));},{context});});
 await module.evaluate();
 const form=new Map([['name','תבנית בדיקה'],['templateSource','docx'],['category','sources'],['docxFile',file],['fieldCount','4']]);
 docx.inspectAnnouncementDocx(sample()).fields.forEach((f,i)=>{form.set('fieldTemplateFieldId:'+i,f.templateFieldId);form.set('fieldLabel:'+i,'תווית '+f.templateFieldId);form.set('fieldType:'+i,'text');});
 const request={get:key=>form.get(key),getAll:()=>[]};
 return{action:module.namespace.createAnnouncementTemplateAction,request,uploads,saved,form,redirects};
}
test('create action uploads normalized DOCX and saves labels and Word metadata together',async()=>{
 const f=await loadAction();await assert.rejects(f.action(f.request),/templateCreated=1/);
 assert.equal(f.uploads.length,1);assert.equal(f.saved.length,1);assert(f.saved[0].docx.key.includes('announcement-templates/'));assert.equal(f.saved[0].fields.length,4);assert.equal(f.saved[0].googleDocsUrl,undefined);
});
test('server rescans the actual submitted file and rejects missing labels before uploading',async()=>{
 const f=await loadAction();f.form.set('fieldLabel:0','');await assert.rejects(f.action(f.request),/REDIRECT/);assert.equal(f.uploads.length,0);assert.equal(f.saved.length,0);
});
test('Word creation requires the same super-admin permission as existing template management',async()=>{
 const f=await loadAction({requireAuthenticatedUser:async()=>({is_super_admin:false})});await assert.rejects(f.action(f.request),/unauthorized/);assert.equal(f.uploads.length,0);assert.equal(f.saved.length,0);
});

test('inspection endpoint requires super-admin and returns field metadata without storing the document',async()=>{
 const source=await fs.readFile(new URL('../app/api/announcements/templates/docx/inspect/route.js',import.meta.url),'utf8');
 for(const [user,status] of [[null,401],[{is_super_admin:false},403],[{is_super_admin:true},200]]){
  let reads=0;const context=vm.createContext({Buffer});const module=new vm.SourceTextModule(source,{context});
  const stubs={'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status||200})}},'../../../../../../lib/rbac':{getCurrentAppUser:async()=>user},'../../../../../../lib/docx-template':docx};
  await module.link(async name=>new vm.SyntheticModule(Object.keys(stubs[name]),function(){for(const[k,v]of Object.entries(stubs[name]))this.setExport(k,v);},{context}));await module.evaluate();
  const response=await module.namespace.POST({formData:async()=>{reads++;return new Map([['docxFile',{name:'fixture.docx',size:sample().length,arrayBuffer:async()=>sample()}]]);}});
  assert.equal(response.status,status);assert.equal(reads,status===200?1:0);if(status===200)assert.equal(response.body.fields.length,4);
 }
});

test('new DOCX metadata and field labels are persisted in one insert with no post-insert read',async()=>{
 const source=await fs.readFile(new URL('../lib/announcements.js',import.meta.url),'utf8');const queries=[];
 const sql=async(strings,...values)=>{const query=strings.join('?');queries.push({query,values});return [{id:'new-template',name:'Word',engine:'docx-template',docx_object_key:'templates/fixture.docx',fields_json:[{key:'field_1',templateFieldId:'t',label:'תוכן',type:'text'}]}];};
 const context=vm.createContext({Date});const module=new vm.SourceTextModule(source,{context});
 const stubs={'./db':{initDb:async()=>{},sql},'./announcement-template-catalog':{ANNOUNCEMENT_TEMPLATE_CATALOG:[],announcementTemplateCatalogRank:()=>0}};
 await module.link(async name=>new vm.SyntheticModule(Object.keys(stubs[name]),function(){for(const[k,v]of Object.entries(stubs[name]))this.setExport(k,v);},{context}));await module.evaluate();
 const result=await module.namespace.createAnnouncementTemplate({id:'new-template',name:'Word',fields:[{key:'field_1',templateFieldId:'t',label:'תוכן',type:'text'}],docx:{key:'templates/fixture.docx',fileName:'fixture.docx',contentType:docx.DOCX_CONTENT_TYPE},createdByUserId:'user-1'});
 assert.equal(queries.length,1);assert(queries[0].query.includes('docx_object_key'));assert(queries[0].query.includes('RETURNING *'));assert(queries[0].values.includes('docx-template'));assert.equal(result.docxObjectKey,'templates/fixture.docx');assert.equal(result.fields[0].label,'תוכן');
});


test('import bounds expanded archive size and the number of unique fields',()=>{
 const zip=new PizZip(fixture(p('{t}')));zip.file('word/media/large.bin',Buffer.alloc(41*1024*1024));
 assert.throws(()=>docx.inspectAnnouncementDocx(zip.generate({type:'nodebuffer',compression:'DEFLATE'})),/גדול מדי/);
 assert.throws(()=>docx.inspectAnnouncementDocx(fixture(Array.from({length:101},(_,i)=>p('{field_'+i+'}')).join(''))));
});
