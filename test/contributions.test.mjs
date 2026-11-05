import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {contributionLevel} from '../lib/contributions.mjs';
import {backupSnapshot,rehearseBackup,encryptBackup,decryptBackup} from '../lib/backup.mjs';
import {openStorage} from '../lib/database.mjs';
const password='Contribution-password-123',setupToken='contribution-fixture-key';

test('levels use 1,2,3 experience, all title boundaries, and cap at level 50',()=>{
 for(let level=1;level<=50;level++){
  const xp=level*(level-1)/2,result=contributionLevel(xp);
  assert.equal(result.level,level);assert.equal(result.required,level===50?null:level);
  if(level>1)assert.equal(contributionLevel(xp-1).level,level-1);
 }
 assert.equal(contributionLevel(0).title,'업무초보자');assert.equal(contributionLevel(45).title,'업무숙련자');
 assert.equal(contributionLevel(190).title,'업무베테랑');assert.equal(contributionLevel(435).title,'업무마스터');assert.equal(contributionLevel(780).title,'업무의 신');
 assert.equal(contributionLevel(100000).level,50);assert.equal(contributionLevel(1225).required,null);
 assert.deepEqual([0,1,2,3,5,6].map(xp=>contributionLevel(xp).level),[1,2,2,3,3,4]);
});
async function fixture(t){
 const dir=await mkdtemp('/tmp/dayon-contribution-');let app,base,clock=new Date('2026-11-30T14:59:00Z');
 async function start(){app=await createApp({dataDir:dir,setupToken,now:()=>clock});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
 await start();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 async function req(path,method='GET',body,user=owner){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(user?{cookie:user.cookie,'X-CSRF-Token':user.csrfToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 let owner=null;const setup=await req('/api/setup','POST',{setupToken,name:'직원 A',username:'owner',password},null);owner={...setup.data,cookie:setup.cookie};
 const invite=await req('/api/invitations','POST',{name:'직원 B',username:'worker'});
 const joined=await req('/api/join','POST',{inviteToken:invite.data.inviteToken,password},null),worker={...joined.data,cookie:joined.cookie};
 async function create(ownerId=worker.user.id,type='task'){
  const result=await req('/api/items','POST',{title:'기여도 '+type,type,qty:500,date:'2026-11-30',ownerId,...(type==='office'?{officeSku:'pouch-set',officeOperation:'return'}:{})});assert.equal(result.status,201);return result.data.item;
 }
 async function toggle(item,actor=owner){const r=await req('/api/items/'+item.id+'/toggle','POST',{version:item.version},actor);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.item;}
 return {dir,req,owner,worker,create,toggle,setDate:date=>{clock=new Date(date);},restart:async()=>{await app.close();await start();}};
}

test('completion credits the assignee, not clicker or quantity; cancellations, races and deleted tasks retain an auditable history',async t=>{
 const f=await fixture(t);
 assert.equal((await f.req('/api/contributions','GET',undefined,null)).status,401);
 assert.equal((await f.req('/api/contributions?month=2026-13')).status,422);
 let item=await f.create();const original=item;
 const outcomes=await Promise.all([f.req('/api/items/'+item.id+'/toggle','POST',{version:item.version}),f.req('/api/items/'+item.id+'/toggle','POST',{version:item.version},f.worker)]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);item=outcomes.find(r=>r.status===200).data.item;
 let report=(await f.req('/api/contributions')).data;
 assert.equal(report.members.find(u=>u.id===f.worker.user.id).xp,1);assert.equal(report.members.find(u=>u.id===f.owner.user.id).xp,0);
 assert.equal(report.logs[0].owner_id,f.worker.user.id);assert.equal(report.logs[0].item_title,original.title);
 const actor=outcomes[0].status===200?f.owner:f.worker;assert.equal(report.logs[0].actor_id,actor.user.id);
 item=await f.toggle(item);report=(await f.req('/api/contributions')).data;assert.equal(report.members.find(u=>u.id===f.worker.user.id).xp,1);assert.equal(report.logs.length,1);
 item=await f.toggle(item);report=(await f.req('/api/contributions')).data;assert.equal(report.members.find(u=>u.id===f.worker.user.id).xp,1);assert.equal(report.logs.length,1);
 assert.equal((await f.req('/api/items/'+item.id,'DELETE',{version:item.version})).status,200);
 report=(await f.req('/api/contributions')).data;assert.equal(report.members.find(u=>u.id===f.worker.user.id).xp,1);
 const self=await f.create(f.owner.user.id);await f.toggle(self);report=(await f.req('/api/contributions')).data;assert.equal(report.leaders.length,2);
 for(const type of ['office','shipment','inbound','meeting'])await f.toggle(await f.create(f.owner.user.id,type));
 report=(await f.req('/api/contributions')).data;assert.equal(report.members.find(u=>u.id===f.owner.user.id).xp,5);assert.equal(report.members[0].level,3);
 const filtered=(await f.req('/api/contributions?userId='+f.worker.user.id)).data;assert.ok(filtered.logs.every(log=>log.owner_id===f.worker.user.id));assert.equal(filtered.logs.length,1);
 assert.equal((await f.req('/api/contributions?userId=unknown')).status,422);
 await f.restart();assert.equal((await f.req('/api/contributions')).data.members[0].xp,5);
 const db=await openStorage({dataDir:f.dir,databaseUrl:''});try{const snapshot=await backupSnapshot(db);assert.ok(snapshot.tables.contribution_awards.length);assert.equal((await rehearseBackup(snapshot)).ok,true);
  delete snapshot.tables.contribution_awards;const old=await decryptBackup(await encryptBackup(snapshot,password),password);assert.deepEqual(old.tables.contribution_awards,[]);
 }finally{await db.close();}
});

test('Seoul month changes reset levels while prior-month logs remain available',async t=>{
 const f=await fixture(t);let november=await f.toggle(await f.create());
 assert.equal((await f.req('/api/contributions')).data.month,'2026-11');
 f.setDate('2026-11-30T15:00:00Z');let report=(await f.req('/api/contributions')).data;
 assert.equal(report.month,'2026-12');assert.equal(report.members.find(u=>u.id===f.worker.user.id).level,1);assert.equal(report.members[0].xp,0);assert.equal(report.leaders.length,0);
 assert.equal((await f.req('/api/contributions?month=2026-11')).data.members[0].xp,1);
 november=await f.toggle(november);assert.equal((await f.req('/api/contributions')).data.members[0].xp,0);
 november=await f.toggle(november);assert.equal((await f.req('/api/contributions')).data.members[0].xp,0);assert.equal((await f.req('/api/contributions?month=2026-11')).data.members[0].xp,1);
 for(let i=0;i<6;i++)november=await f.toggle(november);assert.equal((await f.req('/api/contributions')).data.members[0].xp,0);assert.equal((await f.req('/api/contributions?month=2026-11')).data.total,1);
 await f.toggle(await f.create());assert.equal((await f.req('/api/contributions')).data.members[0].xp,1);
});

test('existing dated completions are backfilled once and logs paginate without losing records',async t=>{
 const f=await fixture(t);await f.toggle(await f.create());
 const raw=new DatabaseSync(f.dir+'/moa.sqlite');raw.exec("DELETE FROM contribution_awards;DELETE FROM metadata WHERE key='contributions_initialized'");raw.close();
 await f.restart();let report=(await f.req('/api/contributions')).data;assert.equal(report.members[0].xp,1);assert.equal(report.logs[0].actor_name,'기존 완료 기록');
 await f.restart();report=(await f.req('/api/contributions')).data;assert.equal(report.total,1);
 const db=await openStorage({dataDir:f.dir,databaseUrl:''});try{await db.transaction(async c=>{for(let i=0;i<55;i++)await c.run('INSERT INTO contribution_awards(id,item_id,item_title,item_type,owner_id,owner_name,actor_name,completed_at,month) VALUES(?,?,?,?,?,?,?,?,?)',['extra-'+i,'item-'+i,'테스트 업무 '+i,'task',f.worker.user.id,'직원 B','직원 A','2026-11-30T14:59:00.000Z','2026-11']);});}finally{await db.close();}
 report=(await f.req('/api/contributions')).data;assert.equal(report.logs.length,50);assert.equal(report.nextOffset,50);assert.equal(report.total,56);
 const next=(await f.req('/api/contributions?offset=50')).data;assert.equal(next.logs.length,6);assert.equal(next.nextOffset,null);assert.equal(new Set([...report.logs,...next.logs].map(log=>log.id)).size,56);
});

test('stock edits, sales edits and manual descriptions each credit exactly one XP to the saving user',async t=>{
 const f=await fixture(t);const workerId=f.worker.user.id;
 let stock=(await f.req('/api/state')).data.officeStock.find(s=>s.id==='pouch-set');
 const saveStock=body=>f.req('/api/office-stock/pouch-set','PUT',body,f.worker);
 const stockBody={version:stock.version,goodQty:3,returnedQty:2,serviceQty:0,defectiveQty:0};
 assert.equal((await saveStock(stockBody)).status,200);
 let report=(await f.req('/api/contributions')).data;assert.equal(report.members.find(u=>u.id===workerId).xp,1);assert.equal(report.members.find(u=>u.id===workerId).stockEdits,1);assert.match(report.logs[0].item_title,/사무실 재고 수정/);
 assert.equal((await saveStock({...stockBody,version:stock.version+1})).status,200);assert.equal((await saveStock(stockBody)).status,409);
 assert.equal((await f.req('/api/contributions')).data.members.find(u=>u.id===workerId).xp,1);
 const day=(await f.req('/api/daily-sales?day=2026-11-29')).data,siteId=day.sites[0].id;
 const {officeCatalog}=await import('../public/office-catalog.js');
 const entries=officeCatalog.map(s=>({sku:s.id,sold:s.id==='pouch-set'?10:0,cancelled:0,refunded:0}));
 let saved=await f.req('/api/daily-sales','PUT',{day:'2026-11-29',siteId,version:0,entries},f.worker);assert.equal(saved.status,200);
 report=(await f.req('/api/contributions')).data;assert.equal(report.members.find(u=>u.id===workerId).xp,2);assert.equal(report.members.find(u=>u.id===workerId).salesEdits,1);
 const same=await f.req('/api/daily-sales','PUT',{day:'2026-11-29',siteId,version:saved.data.record.version,entries:[...entries].reverse()},f.worker);assert.equal(same.status,200);
 assert.equal((await f.req('/api/contributions')).data.members.find(u=>u.id===workerId).xp,2);
 entries.find(e=>e.sku==='pouch-set').cancelled=1;
 saved=await f.req('/api/daily-sales','PUT',{day:'2026-11-29',siteId,version:same.data.record.version,entries},f.owner);assert.equal(saved.status,200);
 report=(await f.req('/api/contributions')).data;assert.equal(report.members.find(u=>u.id===f.owner.user.id).xp,1);
 const {randomUUID}=await import('node:crypto');const body={requestId:randomUUID(),description:'거래처 정산 자료를 확인했습니다.'};
 assert.equal((await f.req('/api/contributions/manual','POST',body,null)).status,401);
 assert.equal((await f.req('/api/contributions/manual','POST',{...body,description:' '})).status,422);
 assert.equal((await f.req('/api/contributions/manual','POST',{...body,xp:100},f.worker)).status,422);
 assert.equal((await f.req('/api/contributions/manual','POST',body,f.worker)).status,201);
 assert.equal((await f.req('/api/contributions/manual','POST',body,f.worker)).status,201);
 assert.equal((await f.req('/api/contributions/manual','POST',{...body,description:'다른 업무'},f.worker)).status,409);
 report=(await f.req('/api/contributions')).data;const worker=report.members.find(u=>u.id===workerId);assert.equal(worker.xp,3);assert.equal(worker.manual,1);assert.equal(worker.completed,0);
 const log=report.logs.find(log=>log.item_type==='manual');assert.equal(log.item_title,body.description);assert.equal(log.owner_id,workerId);
 f.setDate('2026-11-30T15:00:00Z');await f.req('/api/contributions/manual','POST',{requestId:randomUUID(),description:'12월 업무 기록'},f.worker);
 report=(await f.req('/api/contributions')).data;assert.equal(report.month,'2026-12');assert.equal(report.members.find(u=>u.id===workerId).xp,1);
});
