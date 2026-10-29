import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
const password='Fixture-password-only-123',setupToken='fixture-setup-only-key';
const engines=process.env.MOA_TEST_DATABASE_URL?['postgres']:['sqlite'];
async function fixture(t,engine){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'dayon-features-'));let databaseUrl='',pool,schema,app,base;
 if(engine==='postgres'){
  const testUrl=new URL(process.env.MOA_TEST_DATABASE_URL);if(!['localhost','127.0.0.1','[::1]'].includes(testUrl.hostname)||testUrl.searchParams.get('sslmode')!=='disable')throw new Error('Feature PostgreSQL tests require an isolated loopback database.');
  const {default:pg}=await import('pg');pool=new pg.Pool({connectionString:process.env.MOA_TEST_DATABASE_URL,ssl:false});schema='feature_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);
  const url=new URL(process.env.MOA_TEST_DATABASE_URL);url.searchParams.set('options','-csearch_path='+schema);databaseUrl=url.toString();
 }
 async function start(){app=await createApp({dataDir,databaseUrl,setupToken,secureCookie:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
 await start();t.after(async()=>{await app.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dataDir,{recursive:true,force:true});});
 async function request(route,{method='GET',body,user}={}){
  const res=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrfToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const bytes=Buffer.from(await res.arrayBuffer());let data;try{data=JSON.parse(bytes.toString());}catch{data=bytes;}return {status:res.status,data,headers:res.headers};
 }
 function account(r){assert.ok(r.status<300,JSON.stringify(r.data));return {...r.data,cookie:r.headers.get('set-cookie').split(';')[0]};}
 const admin=account(await request('/api/setup',{method:'POST',body:{name:'관리자',username:'admin',password,setupToken}}));
 const invite=await request('/api/invitations',{method:'POST',body:{name:'직원',username:'member'},user:admin});const member=account(await request('/api/join',{method:'POST',body:{inviteToken:invite.data.inviteToken,password}}));
 return {request,admin,member,async restart(){await app.close();await start();},async insertMessages(){
  const now='2026-01-01T01:00:00.000Z',rows=Array.from({length:502},(_,i)=>[randomUUID(),admin.user.id,i===0?'Old shipment 100%_ done':'new message '+i,now]);
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');for(const row of rows)await client.query(`INSERT INTO ${schema}.messages(id,user_id,text,created_at) VALUES($1,$2,$3,$4)`,row);await client.query('COMMIT');}finally{client.release();}}
  else {const db=new DatabaseSync(path.join(dataDir,'moa.sqlite'));db.exec('BEGIN');const insert=db.prepare('INSERT INTO messages(id,user_id,text,created_at) VALUES(?,?,?,?)');for(const row of rows)insert.run(...row);db.exec('COMMIT');db.close();}
 }};
}
for(const engine of engines){
 test(engine+': archives find completed records and undo removes them',async t=>{
  const f=await fixture(t,engine),input={title:'상품 발송 기록',note:'거래처 Alpha',tracking:'CJ123',date:'2026-10-29',type:'shipment',ownerId:f.member.user.id,qty:3};
  const item=(await f.request('/api/items',{method:'POST',user:f.admin,body:input})).data.item;
  assert.equal((await f.request('/api/archive',{user:f.member})).data.results.length,0);
  await f.request('/api/items/'+item.id+'/toggle',{method:'POST',user:f.member,body:{version:item.version}});
  const found=await f.request('/api/archive?q=alpha&type=shipment&from=2026-10-29&to=2026-10-29&ownerId='+f.member.user.id,{user:f.member});assert.equal(found.data.results.length,1);assert.ok(found.data.results[0].completedAt);
  assert.equal((await f.request('/api/archive?q=no-match',{user:f.member})).data.results.length,0);
  assert.equal((await f.request('/api/archive?from=2026-02-31',{user:f.member})).status,422);
  await f.request('/api/items/'+item.id+'/toggle',{method:'POST',user:f.admin,body:{version:found.data.results[0].version}});assert.equal((await f.request('/api/archive',{user:f.admin})).data.results.length,0);
 });
 test(engine+': chat search reaches older than recent 500 and treats wildcards literally',async t=>{
  const f=await fixture(t,engine);await f.insertMessages();
  const recent=(await f.request('/api/state',{user:f.admin})).data.messages;assert.equal(recent.length,500);assert.ok(!recent.some(m=>m.text.includes('Old shipment')));
  const found=await f.request('/api/messages/search?q=SHIPMENT&from=2026-01-01&to=2026-01-01&authorId='+f.admin.user.id,{user:f.member});assert.equal(found.data.results.length,1);assert.match(found.data.results[0].text,/Old shipment/);
  assert.equal((await f.request('/api/messages/search?q='+encodeURIComponent('%_'),{user:f.member})).data.results.length,1);
  const first=(await f.request('/api/messages/search',{user:f.member})).data;assert.equal(first.results.length,50);assert.equal(first.hasMore,true);
  const next=(await f.request('/api/messages/search?offset=50',{user:f.member})).data;assert.equal(next.results.length,50);assert.ok(!next.results.some(m=>first.results.some(n=>m.id===n.id)));
  assert.equal((await f.request('/api/messages/search')).status,401);
 });
 test(engine+': all employees can write and edit manuals with stale edit protection',async t=>{
  const f=await fixture(t,engine),body={title:'포장 매뉴얼',category:'발송',content:'유리 제품은 완충재 2겹'};
  assert.equal((await f.request('/api/manuals',{method:'POST',body})).status,401);
  const created=await f.request('/api/manuals',{method:'POST',user:f.member,body});assert.equal(created.status,201);
  const doc=(await f.request('/api/manuals?q='+encodeURIComponent('완충재'),{user:f.member})).data.results[0];assert.equal(doc.title,body.title);
  assert.equal((await f.request('/api/manuals/'+doc.id,{method:'PUT',user:f.member,body:{...body,version:doc.version,content:'완충재 3겹'}})).status,200);
  assert.equal((await f.request('/api/manuals/'+doc.id,{method:'PUT',user:f.admin,body:{...body,version:doc.version}})).status,409);
  await f.restart();const saved=(await f.request('/api/manuals',{user:f.member})).data.results[0];assert.equal(saved.content,'완충재 3겹');
  assert.equal((await f.request('/api/manuals/'+saved.id,{method:'DELETE',user:f.member,body:{version:saved.version}})).status,200);assert.equal((await f.request('/api/manuals',{user:f.admin})).data.results.length,0);
 });
 test(engine+': files survive restart, download exact bytes and require authentication',async t=>{
  const f=await fixture(t,engine),bytes=Buffer.from('업무양식,수량\n컵,3'),body={title:'발송 양식',category:'양식',filename:'발송양식.csv',data:bytes.toString('base64')};
  assert.equal((await f.request('/api/resources',{method:'POST',body})).status,401);
  assert.equal((await f.request('/api/resources',{method:'POST',user:f.admin,body:{...body,filename:'run.html'}})).status,422);
  const created=await f.request('/api/resources',{method:'POST',user:f.member,body});assert.equal(created.status,201);await f.restart();
  const list=await f.request('/api/resources?q='+encodeURIComponent('양식'),{user:f.member});assert.equal(list.data.results[0].id,created.data.id);assert.equal(list.data.usedBytes,bytes.length);assert.ok(!('data' in list.data.results[0]));
  const route='/api/resources/'+created.data.id+'/download';assert.equal((await f.request(route)).status,401);
  const file=await f.request(route,{user:f.member});assert.deepEqual(file.data,bytes);assert.match(file.headers.get('content-disposition'),/attachment/);
  assert.equal((await f.request('/api/resources/'+created.data.id,{method:'DELETE'})).status,401);
  assert.equal((await f.request('/api/resources/'+created.data.id,{method:'DELETE',user:f.member})).status,200);assert.equal((await f.request(route,{user:f.member})).status,404);
 });
 test(engine+': resource size and total quota are enforced and released after deletion',async t=>{
  const f=await fixture(t,engine),data=Buffer.alloc(5*1024*1024,65).toString('base64');
  const body={title:'용량 검증',category:'일반',filename:'large.txt',data};let first;
  for(let i=0;i<5;i++){const created=await f.request('/api/resources',{method:'POST',user:f.admin,body});assert.equal(created.status,201);first??=created.data.id;}
  assert.equal((await f.request('/api/resources',{method:'POST',user:f.admin,body})).status,409);
  const tooLarge=await f.request('/api/resources',{method:'POST',user:f.admin,body:{...body,data:Buffer.alloc(5*1024*1024+1,65).toString('base64')}});assert.equal(tooLarge.status,422);
  await f.request('/api/resources/'+first,{method:'DELETE',user:f.admin});assert.equal((await f.request('/api/resources',{method:'POST',user:f.admin,body})).status,201);
 });

 test(engine+': chat unread state is personal, durable and never rewinds',async t=>{
  const f=await fixture(t,engine);
  const first=(await f.request('/api/messages',{method:'POST',user:f.admin,body:{text:'첫 번째 알림'}})).data.message;
  assert.ok(first.sequence>0);
  assert.equal((await f.request('/api/state',{user:f.member})).data.chat.unread,1);
  assert.equal((await f.request('/api/state',{user:f.admin})).data.chat.unread,0);
  await f.request('/api/messages',{method:'POST',user:f.member,body:{text:'직접 보낸 메시지'}});
  const second=(await f.request('/api/messages',{method:'POST',user:f.admin,body:{text:'두 번째 알림'}})).data.message;
  assert.equal((await f.request('/api/state',{user:f.member})).data.chat.unread,2);
  assert.equal((await f.request('/api/chat/read',{method:'POST',user:f.member,body:{through:first.sequence}})).data.chat.unread,1);
  await f.request('/api/chat/read',{method:'POST',user:f.member,body:{through:0}});
  assert.equal((await f.request('/api/state',{user:f.member})).data.chat.readThrough,first.sequence);
  await f.restart();assert.equal((await f.request('/api/state',{user:f.member})).data.chat.unread,1);
  await f.request('/api/chat/read',{method:'POST',user:f.member,body:{through:second.sequence,userId:f.admin.user.id}});
  assert.equal((await f.request('/api/state',{user:f.member})).data.chat.unread,0);
  assert.equal((await f.request('/api/state',{user:f.admin})).data.chat.unread,1,'reading cannot modify another account cursor');
  const unauth=await f.request('/api/chat/read',{method:'POST',body:{through:second.sequence}});assert.equal(unauth.status,401);
  const invalid=await f.request('/api/chat/read',{method:'POST',user:f.member,body:{through:-1}});assert.equal(invalid.status,422);
  const forged=await f.request('/api/chat/read',{method:'POST',user:{...f.member,csrfToken:'invalid'},body:{through:second.sequence}});assert.equal(forged.status,403);
  await f.request('/api/chat/read',{method:'POST',user:f.member,body:{through:1000000}});
  const latest=(await f.request('/api/state',{user:f.member})).data.chat;assert.equal(latest.readThrough,latest.latest,'cannot acknowledge unsent future messages');
 });
 test(engine+': unread counts cover messages outside the recent history window',async t=>{
  const f=await fixture(t,engine);await f.insertMessages();
  const before=(await f.request('/api/state',{user:f.member})).data;
  assert.equal(before.messages.length,500);assert.equal(before.chat.unread,502);
  await f.request('/api/chat/read',{method:'POST',user:f.member,body:{through:before.chat.latest}});
  assert.equal((await f.request('/api/state',{user:f.member})).data.chat.unread,0);
 });

}
