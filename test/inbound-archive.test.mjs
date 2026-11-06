import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {openStorage} from '../lib/database.mjs';
import {initializeInboundArchive,purgeInboundArchive,inboundArchiveExpiry} from '../lib/inbound-archive.mjs';
const day=86400000;
async function fixture(t){
 const dataDir=await mkdtemp('/tmp/dayon-archive-');let app,base,clock=new Date('2026-11-06T03:00:00.000Z'),auth={};
 async function start(){app=await createApp({dataDir,databaseUrl:'',setupToken:'archive-fixture',secureCookie:false,now:()=>clock});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
 await start();t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
 async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:{...auth,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const raw=Buffer.from(await r.arrayBuffer());return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const setup=await req('/api/setup','POST',{setupToken:'archive-fixture',username:'archive',name:'입고 담당',password:'Archive-fixture-password'});auth={cookie:setup.cookie,'X-CSRF-Token':setup.data.csrfToken};
 async function create(type='inbound',extra={}){return (await req('/api/items','POST',{title:type+' 수입 확인',type,qty:30,date:'2026-11-06',warehouseDate:type==='inbound'?'2026-11-06':null,ownerId:setup.data.user.id,...extra})).data.item;}
 async function toggle(item){return req('/api/items/'+item.id+'/toggle','POST',{version:item.version});}
 return {req,create,toggle,get now(){return clock;},set now(value){clock=new Date(value);},async restart(){await app.close();await start();},async database(fn){const db=await openStorage({dataDir,databaseUrl:''});try{return await fn(db);}finally{await db.close();}}};
}
test('completed inbound and files survive until exactly seven days, then are permanently removed; other work and XP survive',async t=>{
 const f=await fixture(t),file={filename:'수량.csv',data:Buffer.from('상품,수량\n카빈,30').toString('base64')};
 let item=await f.create('inbound',{newAttachments:[file]});item=(await f.toggle(item)).data.item;
 assert.equal(item.archiveExpiresAt,'2026-11-13T03:00:00.000Z');assert.equal(item.completedAt,'2026-11-06T03:00:00.000Z');
 const task=(await f.toggle(await f.create('task'))).data.item;
 const path='/api/items/'+item.id+'/attachments/'+item.attachments[0].id+'/download';
 f.now=new Date(f.now.getTime()+7*day-1);
 let archive=(await f.req('/api/archive')).data.results;assert.ok(archive.some(i=>i.id===item.id));assert.equal(archive.find(i=>i.id===item.id).attachments.length,1);assert.equal((await f.req(path)).status,200);
 f.now=new Date(f.now.getTime()+1);
 archive=(await f.req('/api/archive')).data.results;assert.ok(!archive.some(i=>i.id===item.id));assert.ok(archive.some(i=>i.id===task.id));assert.equal((await f.req(path)).status,404);
 const state=(await f.req('/api/state')).data;assert.ok(!state.items.some(i=>i.id===item.id));assert.ok(state.items.some(i=>i.id===task.id));
 await f.database(async db=>{assert.equal(Number((await db.get('SELECT COUNT(*) n FROM inbound_attachments')).n),0);assert.equal(Number((await db.get('SELECT COUNT(*) n FROM contribution_awards WHERE item_id=?',[item.id])).n),1);});
 assert.equal((await f.toggle(item)).status,404);
});
test('undo cancels expiry, preserves files past the old deadline, and recompletion starts a new full week',async t=>{
 const f=await fixture(t);let item=await f.create('inbound',{newAttachments:[{filename:'수량.csv',data:Buffer.from('a,1').toString('base64')}]});item=(await f.toggle(item)).data.item;const oldExpiry=item.archiveExpiresAt;
 f.now=new Date(f.now.getTime()+6*day);item=(await f.toggle(item)).data.item;assert.equal(item.done,false);assert.equal(item.archiveExpiresAt,null);assert.equal(item.completedAt,null);
 f.now=new Date(f.now.getTime()+2*day);let state=(await f.req('/api/state')).data;assert.ok(state.items.some(i=>i.id===item.id&&!i.done));assert.equal(state.items.find(i=>i.id===item.id).attachments.length,1);
 item=(await f.toggle(item)).data.item;assert.equal(item.archiveExpiresAt,inboundArchiveExpiry(f.now));assert.ok(item.archiveExpiresAt>oldExpiry);
 const expiry=item.archiveExpiresAt;await f.restart();state=(await f.req('/api/state')).data;assert.equal(state.items.find(i=>i.id===item.id).archiveExpiresAt,expiry);
 f.now=expiry;await f.restart();assert.ok(!(await f.req('/api/state')).data.items.some(i=>i.id===item.id));
});
test('old completed inbound receives a full week once, while incomplete and non-inbound rows are never targeted',async t=>{
 const f=await fixture(t),old=await f.create(),pending=await f.create(),task=await f.create('task');
 await f.database(async db=>{
  await db.run('UPDATE items SET done=1,completed_at=?,archive_expires_at=NULL WHERE id IN (?,?)',['2020-01-01T00:00:00.000Z',old.id,task.id]);
  await initializeInboundArchive(db,f.now);const row=await db.get('SELECT archive_expires_at FROM items WHERE id=?',[old.id]);assert.equal(row.archive_expires_at,inboundArchiveExpiry(f.now));
  await initializeInboundArchive(db,new Date(f.now.getTime()+day));assert.equal((await db.get('SELECT archive_expires_at FROM items WHERE id=?',[old.id])).archive_expires_at,row.archive_expires_at);
  await db.run('UPDATE items SET archive_expires_at=? WHERE id IN (?,?)',['2000-01-01T00:00:00.000Z',pending.id,task.id]);
  assert.equal(await purgeInboundArchive(db,new Date(row.archive_expires_at)),1);assert.ok(await db.get('SELECT id FROM items WHERE id=?',[pending.id]));assert.ok(await db.get('SELECT id FROM items WHERE id=?',[task.id]));
 });
});
