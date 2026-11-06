import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {openStorage} from '../lib/database.mjs';
import {backupSnapshot,encryptBackup,decryptBackup,rehearseBackup} from '../lib/backup.mjs';
import {validateAttachments} from '../lib/inbound-attachments.mjs';
import {utils,write} from '../public/vendor/xlsx.js';
import {inboundAttachmentCell} from '../public/inbound-attachments.js';
const engines=process.env.MOA_TEST_DATABASE_URL?['postgres']:['sqlite'];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII=','base64');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const workbook=utils.book_new();utils.book_append_sheet(workbook,utils.aoa_to_sheet([['입고상품','수량'],['카빈',30]]),'입고');
const excel=Buffer.from(write(workbook,{type:'array',bookType:'xlsx'}));
const upload=(filename,bytes)=>({filename,data:bytes.toString('base64')});
async function fixture(t,engine){
 const dataDir=await mkdtemp('/tmp/dayon-files-'),setupToken='files-'+randomUUID();let app,base,auth={},pool,schema,databaseUrl='';
 if(engine==='postgres'){
  const url=new URL(process.env.MOA_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.searchParams.get('sslmode'),'disable');
  const {default:pg}=await import('pg');pool=new pg.Pool({connectionString:url.toString(),ssl:false});schema='files_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-csearch_path='+schema);databaseUrl=url.toString();
 }
 async function start(){app=await createApp({dataDir,databaseUrl,setupToken,secureCookie:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
 await start();t.after(async()=>{await app.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dataDir,{recursive:true,force:true});});
 async function req(route,method='GET',body,headers=auth){
  const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const bytes=Buffer.from(await response.arrayBuffer());return {status:response.status,data:response.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes.toString()):bytes,headers:response.headers};
 }
 const setup=await req('/api/setup','POST',{setupToken,name:'파일 담당',username:'files',password:'Test-file-password-123'});
 auth={cookie:setup.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':setup.data.csrfToken};
 const itemBody={title:'카빈 수입',type:'inbound',qty:30,date:'2026-11-03',warehouseDate:'2026-11-06',ownerId:setup.data.user.id};
 return {req,auth,itemBody,async restart(){await app.close();await start();},async database(fn){const db=await openStorage({dataDir,databaseUrl});try{return await fn(db);}finally{await db.close();}}};
}
for(const engine of engines){
 test(engine+': inbound files are saved atomically, shared on the import row and survive restart and backup',async t=>{
  const f=await fixture(t,engine),files=[upload('수량표.xlsx',excel),upload('입고 사진.png',png),upload('패킹리스트.pdf',pdf)];
  const created=await f.req('/api/items','POST',{...f.itemBody,newAttachments:files});assert.equal(created.status,201,JSON.stringify(created.data));let item=created.data.item;
  assert.equal(item.attachments.length,3);assert.ok(item.attachments.every(file=>!('data' in file)));
  await f.restart();const saved=(await f.req('/api/state')).data.items.find(i=>i.id===item.id);assert.deepEqual(saved.attachments,item.attachments);
  for(const file of saved.attachments){
   const route='/api/items/'+item.id+'/attachments/'+file.id+'/download';assert.equal((await f.req(route,'GET',undefined,{})).status,401);
   const download=await f.req(route);assert.equal(download.status,200);assert.deepEqual(download.data,Buffer.from(files.find(v=>v.filename===file.filename).data,'base64'));assert.match(download.headers.get('content-disposition'),/filename\*=UTF-8/);assert.equal(download.headers.get('cache-control'),'private, no-store');
  }
  const snapshot=await f.database(backupSnapshot);assert.equal(snapshot.tables.inbound_attachments.length,3);assert.equal((await rehearseBackup(snapshot)).counts.inbound_attachments,3);
  const cell=inboundAttachmentCell(saved,s=>String(s).replaceAll('<','&lt;'));assert.match(cell,/data-inbound-table-files/);assert.match(cell,/\.pdf/);assert.match(cell,/\.png/);assert.match(cell,/다운로드/);
  const dropped=await f.req('/api/items/'+item.id,'DELETE',{version:item.version});assert.equal(dropped.status,200);assert.equal((await f.req('/api/items/'+item.id+'/attachments/'+item.attachments[0].id+'/download')).status,404);
 });
 test(engine+': attachment writes check permissions, versions, parent identity and completed inbound records',async t=>{
  const f=await fixture(t,engine);let item=(await f.req('/api/items','POST',f.itemBody)).data.item;const path='/api/items/'+item.id+'/attachments',body={version:item.version,newAttachments:[upload('수량.csv',Buffer.from('상품,수량\n카빈,30'))]};
  assert.equal((await f.req(path,'POST',body,{})).status,401);assert.equal((await f.req(path,'POST',body,{cookie:f.auth.cookie})).status,403);
  const races=await Promise.all([f.req(path,'POST',body),f.req(path,'POST',body)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);item=races.find(r=>r.status===200).data.item;
  const file=item.attachments[0],other=(await f.req('/api/items','POST',{...f.itemBody,title:'다른 입고'})).data.item;
  assert.equal((await f.req('/api/items/'+other.id+'/attachments/'+file.id+'/download')).status,404);
  assert.equal((await f.req('/api/items/'+other.id+'/attachments','POST',{version:other.version,removeAttachmentIds:[file.id]})).status,409);
  item=(await f.req('/api/items/'+item.id+'/toggle','POST',{version:item.version})).data.item;
  const added=await f.req(path,'POST',{version:item.version,newAttachments:[upload('완료사진.png',png)]});assert.equal(added.status,200);item=added.data.item;assert.equal(item.done,true);assert.equal(item.attachments.length,2);
  item=(await f.req(path,'POST',{version:item.version,removeAttachmentIds:[file.id]})).data.item;assert.equal(item.attachments.length,1);
  const task=(await f.req('/api/items','POST',{...f.itemBody,type:'task'})).data.item;assert.equal((await f.req('/api/items/'+task.id+'/attachments','POST',{version:task.version,newAttachments:[upload('문서.pdf',pdf)]})).status,422);
 });
 test(engine+': invalid attachments roll back event edits and preserve existing files',async t=>{
  const f=await fixture(t,engine);const before=(await f.req('/api/state')).data.items.length;
  for(const file of [upload('unsafe.html',Buffer.from('<html>')),upload('fake.png',Buffer.from('not an image')),upload('../수량.csv',Buffer.from('test')),upload('empty.csv',Buffer.alloc(0))])assert.equal((await f.req('/api/items','POST',{...f.itemBody,newAttachments:[file]})).status,422);
  assert.equal((await f.req('/api/state')).data.items.length,before);
  const file=upload('수량.csv',Buffer.from('상품,수량\n카빈,30')),item=(await f.req('/api/items','POST',{...f.itemBody,newAttachments:Array(5).fill(file)})).data.item;
  assert.equal(item.attachments.length,5);
  const denied=await f.req('/api/items/'+item.id,'PUT',{...f.itemBody,title:'실패할 수정',version:item.version,newAttachments:[file]});assert.equal(denied.status,422);
  const saved=(await f.req('/api/state')).data.items.find(i=>i.id===item.id);assert.equal(saved.title,item.title);assert.equal(saved.version,item.version);assert.equal(saved.attachments.length,5);
  assert.throws(()=>validateAttachments({newAttachments:[upload('large.csv',Buffer.alloc(5*1024*1024+1))]},'inbound'),error=>error.status===422);
 });
 test(engine+': optional resource PIN gates file bytes, title changes, password reset and removal on the server',async t=>{
  const f=await fixture(t,engine),bytes=Buffer.from('confidential quantities'),body={title:'입고 자료',category:'수입',filename:'수량.csv',data:bytes.toString('base64')};
  const plain=await f.req('/api/resources','POST',body);assert.equal(plain.status,201);assert.equal((await f.req('/api/resources/'+plain.data.id+'/download')).status,200);
  for(const password of ['123','abcd',1234,null])assert.equal((await f.req('/api/resources','POST',{...body,password})).status,422);
  const created=await f.req('/api/resources','POST',{...body,password:'0427'});assert.equal(created.status,201);const path='/api/resources/'+created.data.id;
  let item=(await f.req('/api/resources')).data.results.find(file=>file.id===created.data.id);assert.equal(item.password_protected,1);assert.ok(!('pin_hash' in item));assert.ok(!('password' in item));
  assert.equal((await f.req(path+'/download')).status,403);assert.equal((await f.req(path+'/download?password=0427')).status,403);
  assert.equal((await f.req(path+'/download','POST',{password:'0427'},{})).status,401);assert.equal((await f.req(path+'/download','POST',{password:'0427'},{cookie:f.auth.cookie})).status,403);
  assert.equal((await f.req(path+'/download','POST',{password:'9999'})).status,403);
  assert.equal((await f.req(path+'/download','POST',{password:'0427'})).data.toString(),bytes.toString());
  assert.equal((await f.req(path,'PUT',{title:'변경 제목',version:item.version,password:'9999',newPassword:'1234'})).status,403);
  assert.equal((await f.req(path,'PUT',{title:'변경 제목',version:item.version,password:'0427',newPassword:'1234'})).status,200);
  assert.equal((await f.req(path,'PUT',{title:'충돌 제목',version:item.version,password:'1234'})).status,409);
  await f.restart();item=(await f.req('/api/resources')).data.results.find(file=>file.id===created.data.id);assert.equal(item.title,'변경 제목');assert.equal(item.password_protected,1);
  assert.equal((await f.req(path+'/download','POST',{password:'0427'})).status,403);assert.deepEqual((await f.req(path+'/download','POST',{password:'1234'})).data,bytes);
  assert.equal((await f.req(path,'DELETE',{password:'9999'})).status,403);
  const snapshot=await f.database(backupSnapshot),row=snapshot.tables.library_resources.find(r=>r.id===item.id);assert.notEqual(row.pin_hash,'1234');assert.match(row.pin_hash,/^[a-f0-9]+:[a-f0-9]+$/);assert.equal((await rehearseBackup(snapshot)).ok,true);
  const encrypted=await encryptBackup(snapshot,'Backup-test-password'),restored=await decryptBackup(encrypted,'Backup-test-password');assert.equal(restored.tables.library_resources.find(r=>r.id===item.id).pin_hash,row.pin_hash);
  assert.equal((await f.req(path,'PUT',{title:'보호 해제',version:item.version,password:'1234',newPassword:''})).status,200);assert.deepEqual((await f.req(path+'/download')).data,bytes);
 });
 test(engine+': PIN guessing limits survive restart and expire without affecting unprotected files',async t=>{
  const f=await fixture(t,engine),created=await f.req('/api/resources','POST',{title:'잠금 자료',filename:'test.txt',category:'일반',data:Buffer.from('secret').toString('base64'),password:'0001'}),path='/api/resources/'+created.data.id;
  for(let i=0;i<5;i++)assert.equal((await f.req(path+'/download','POST',{password:'1111'})).status,403);
  await f.restart();assert.equal((await f.req(path+'/download','POST',{password:'0001'})).status,429);
  assert.equal((await f.req(path,'PUT',{title:'우회',version:1,password:'0001',newPassword:''})).status,429);
  await f.database(db=>db.run('UPDATE resource_access_attempts SET window_until=0 WHERE resource_id=?',[created.data.id]));
  assert.equal((await f.req(path+'/download','POST',{password:'0001'})).status,200);
  assert.equal((await f.req(path,'DELETE',{password:'0001'})).status,200);
 });
}
for(const engine of engines){
 test(engine+': resources and inbound attachments share the 25MB quota and deletion releases space',async t=>{
  const f=await fixture(t,engine),bytes=Buffer.alloc(5*1024*1024,65),file=upload('large.csv',bytes),resource={...file,title:'용량 검증',category:'일반'};let first;
  for(let i=0;i<4;i++){const result=await f.req('/api/resources','POST',resource);assert.equal(result.status,201);first??=result.data.id;}
  const created=await f.req('/api/items','POST',{...f.itemBody,newAttachments:[file]});assert.equal(created.status,201);let item=created.data.item;
  assert.equal((await f.req('/api/resources')).data.usedBytes,25*1024*1024);
  const tiny=upload('추가.csv',Buffer.from('a,1'));
  assert.equal((await f.req('/api/resources','POST',{...tiny,title:'초과',category:'일반'})).status,409);
  assert.equal((await f.req('/api/items/'+item.id+'/attachments','POST',{version:item.version,newAttachments:[tiny]})).status,409);
  assert.equal((await f.req('/api/resources/'+first,'DELETE')).status,200);
  const attached=await f.req('/api/items/'+item.id+'/attachments','POST',{version:item.version,newAttachments:[tiny]});assert.equal(attached.status,200);assert.equal(attached.data.item.attachments.length,2);
 });
 test(engine+': existing resources migrate without a PIN and old backups remain restorable',async t=>{
  const f=await fixture(t,engine),bytes=Buffer.from('legacy file'),created=await f.req('/api/resources','POST',{title:'기존 파일',filename:'legacy.txt',category:'일반',data:bytes.toString('base64')});assert.equal(created.status,201);
  await f.database(async db=>{await db.run('ALTER TABLE library_resources DROP COLUMN pin_hash');await db.run('ALTER TABLE library_resources DROP COLUMN version');});
  await f.restart();const file=(await f.req('/api/resources')).data.results[0];assert.equal(file.version,1);assert.equal(file.password_protected,0);assert.deepEqual((await f.req('/api/resources/'+file.id+'/download')).data,bytes);
  const snapshot=await f.database(backupSnapshot);delete snapshot.tables.inbound_attachments;for(const row of snapshot.tables.library_resources){delete row.pin_hash;delete row.version;}
  const encrypted=await encryptBackup(snapshot,'Legacy-backup-password'),restored=await decryptBackup(encrypted,'Legacy-backup-password');assert.deepEqual(restored.tables.inbound_attachments,[]);assert.equal(restored.tables.library_resources[0].pin_hash,null);assert.equal((await rehearseBackup(restored)).ok,true);
 });
}
