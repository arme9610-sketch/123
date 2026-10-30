import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {isBusinessDay} from '../lib/business-days.mjs';

test('Korean business days exclude weekends, lunar spans, substitutes and elections',()=>{
 for(const day of ['2026-02-16','2026-02-17','2026-02-18','2026-03-02','2026-05-25','2026-06-03','2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-10-31','2026-11-01','2027-02-06','2027-02-07','2027-02-08','2027-02-09'])assert.equal(isBusinessDay(day),false,day);
 for(const day of ['2026-02-19','2026-10-30','2026-11-02','2027-02-10'])assert.equal(isBusinessDay(day),true,day);
});
for(const engine of process.env.MOA_TEST_DATABASE_URL?['postgres']:['sqlite']){
 test(engine+': daily assignment persists per-day completion, requester, notes and checklists; stop prevents new occurrences',async t=>{
  const dir=await mkdtemp('/tmp/dayon-recurring-');let today='2026-10-02',app,base,pool,schema,databaseUrl='';
  if(engine==='postgres'){
   const url=new URL(process.env.MOA_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.searchParams.get('sslmode'),'disable');
   const {default:pg}=await import('pg');pool=new pg.Pool({connectionString:url.toString(),ssl:false});schema='recurring_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-csearch_path='+schema);databaseUrl=url.toString();
  }
  const setupToken=randomUUID(),password=randomUUID();
  async function start(){app=await createApp({dataDir:dir,databaseUrl,setupToken,now:()=>new Date(today+'T03:00:00Z')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
  await start();t.after(async()=>{await app.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});});
  async function request(path,{method='GET',body,user}={}){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(user?{cookie:user.cookie,'X-CSRF-Token':user.csrfToken}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const a=await request('/api/setup',{method:'POST',body:{name:'김진솔',username:'requester',password,setupToken}});const requester={...a.data,cookie:a.cookie};
  const invitation=await request('/api/invitations',{method:'POST',user:requester,body:{name:'이기정',username:'assignee'}});
  const b=await request('/api/join',{method:'POST',body:{inviteToken:invitation.data.inviteToken,password}});const assignee={...b.data,cookie:b.cookie};
  const input={title:'매일 포장 점검',date:today,ownerId:assignee.user.id,note:'아침 점검'};
  assert.equal((await request('/api/recurring',{method:'POST',body:input})).status,401);
  assert.equal((await request('/api/recurring',{method:'POST',user:requester,body:{...input,date:'2026-10-01'}})).status,422);
  const created=await request('/api/recurring',{method:'POST',body:input,user:requester});assert.equal(created.status,201);
  const seriesId=created.data.id;
  const state=async()=> (await request('/api/state',{user:assignee})).data;
  let first=(await state()).items[0];assert.equal(first.requester,'김진솔');assert.equal(first.owner,'이기정');assert.equal(first.seriesActive,true);
  let update=await request('/api/items/'+first.id+'/details',{method:'PATCH',user:assignee,body:{version:first.version,note:'완료 전 확인',checklist:[{text:'수량 확인',done:true}]}});assert.equal(update.status,200);first=update.data.item;
  assert.equal((await request('/api/items/'+first.id+'/details',{method:'PATCH',user:assignee,body:{version:1,note:'stale',checklist:[]}})).status,409);
  assert.equal((await request('/api/items/'+first.id+'/toggle',{method:'POST',user:assignee,body:{version:first.version}})).status,200);
  today='2026-10-06';await Promise.all([state(),state(),state()]);let snapshot=await state();assert.deepEqual(snapshot.items.map(i=>i.date),['2026-10-02','2026-10-06']);assert.equal(snapshot.items[0].done,true);assert.equal(snapshot.items[1].done,false);assert.deepEqual(snapshot.items[1].checklist,[]);
  let second=snapshot.items[1];update=await request('/api/items/'+second.id,{method:'PUT',user:assignee,body:{...input,type:'task',qty:1,date:second.date,title:'매일 출고 점검',version:second.version,applyToSeries:true}});assert.equal(update.status,200);
  await app.close();await start();snapshot=await state();assert.equal(snapshot.items[0].note,'완료 전 확인');assert.equal(snapshot.items[0].checklist[0].done,true);
  today='2026-10-07';snapshot=await state();assert.equal(snapshot.items.at(-1).title,'매일 출고 점검');
  assert.equal((await request('/api/recurring/'+seriesId+'/stop',{method:'POST',user:requester,body:{version:snapshot.recurring[0].version}})).status,200);
  today='2026-10-12';snapshot=await state();assert.equal(snapshot.items.length,3);assert.equal(snapshot.recurring[0].stoppedDate,'2026-10-07');assert.equal(snapshot.items[0].seriesActive,false);
  // A weekend request is retained as a template and first appears next business day.
  today='2026-10-31';assert.equal((await request('/api/recurring',{method:'POST',user:requester,body:{...input,date:today,title:'주말 요청'}})).status,201);
  assert.equal((await state()).items.length,3);today='2026-11-02';assert.equal((await state()).items.at(-1).date,today);
 });
}
