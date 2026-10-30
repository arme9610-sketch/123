import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {deadlineStatus} from '../public/task-priority.js';
import {dueReminders} from '../public/reminders.js';
test('D-1 follows Seoul calendar day, distinguishes overdue, and hides completed/other users',()=>{
 const item={id:'a',date:'2026-10-01',dueDate:'2026-11-01',ownerId:'owner',done:false};
 assert.equal(deadlineStatus(item,'owner',new Date('2026-10-30T14:59:59Z')),'');
 assert.equal(deadlineStatus(item,'owner',new Date('2026-10-30T15:00:00Z')),'D-1');
 assert.equal(deadlineStatus(item,'other',new Date('2026-10-31T03:00:00Z')),'');
 assert.equal(deadlineStatus({...item,done:true},'owner',new Date('2026-10-31T03:00:00Z')),'');
 assert.equal(deadlineStatus(item,'owner',new Date('2026-10-31T15:00:00Z')),'오늘 마감');
 assert.equal(deadlineStatus(item,'owner',new Date('2026-11-01T15:00:00Z')),'기한 지남');
 assert.equal(dueReminders([item],'owner',new Date('2026-10-30T03:00:00Z')).length,0);
 assert.equal(dueReminders([item],'owner',new Date('2026-11-01T03:00:00Z')).length,1);
});
for(const engine of process.env.MOA_TEST_DATABASE_URL?['postgres']:['sqlite']){
 test(engine+': priority and separate deadlines persist, reject invalid input, and propagate to recurring occurrences',async t=>{
  const dir=await mkdtemp('/tmp/dayon-priority-');let app,base,pool,schema,databaseUrl='',day='2026-10-30';const setupToken=randomUUID();
  if(engine==='postgres'){const url=new URL(process.env.MOA_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));const {default:pg}=await import('pg');pool=new pg.Pool({connectionString:url.toString(),ssl:false});schema='priority_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-csearch_path='+schema);databaseUrl=url.toString();}
  async function start(){app=await createApp({dataDir:dir,databaseUrl,setupToken,now:()=>new Date(day+'T03:00:00Z')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
  await start();t.after(async()=>{await app.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});});
  const response=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setupToken,name:'담당자',username:'priority',password:randomUUID()})});const user=await response.json();const headers={'Content-Type':'application/json',cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':user.csrfToken};
  async function request(path,method='GET',body){const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
  const body={title:'긴급 점검',type:'task',qty:1,ownerId:user.user.id,date:day,dueDate:'2026-11-02',priority:'urgent'};
  const created=await request('/api/items','POST',body);assert.equal(created.status,201);const item=created.data.item;assert.equal(item.priority,'urgent');assert.equal(item.requestDate,day);assert.equal(item.dueDate,'2026-11-02');
  for(const values of [{priority:'critical'},{dueDate:'2026-10-29'},{dueDate:'2026-02-30'},{dueDate:'invalid'}])assert.equal((await request('/api/items','POST',{...body,...values})).status,422);
  const legacy=await request('/api/items','POST',{...body,priority:undefined,dueDate:undefined});assert.equal(legacy.data.item.priority,'normal');assert.equal(legacy.data.item.dueDate,day);
  await app.close();await start();let state=(await request('/api/state')).data;assert.equal(state.items.find(i=>i.id===item.id).dueDate,'2026-11-02');
  let edited=await request('/api/items/'+item.id,'PUT',{...body,priority:'normal',dueDate:'2026-11-03',version:item.version});assert.equal(edited.status,200);assert.equal(edited.data.item.priority,'normal');assert.equal(edited.data.item.dueDate,'2026-11-03');
  const series=await request('/api/recurring','POST',body);assert.equal(series.status,201);day='2026-11-02';state=(await request('/api/state')).data;const recurring=state.items.filter(i=>i.seriesId===series.data.id);assert.deepEqual(recurring.map(i=>[i.date,i.dueDate,i.priority]),[['2026-10-30','2026-11-02','urgent'],['2026-11-02','2026-11-05','urgent']]);
 });
}
