import {backupSnapshot,rehearseBackup} from '../lib/backup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {verifyInitialBackup} from '../lib/admin.mjs';
import {bootstrapOwner} from '../lib/admin-schema.mjs';
import {openStorage} from '../lib/database.mjs';
const password='Admin-test-password-123',setupToken='admin-test-setup-token';
async function fixture(t){
 const dir=await mkdtemp('/tmp/dayon-admin-test-');let app,base;
 async function start(){app=await createApp({dataDir:dir,setupToken});await new Promise((r,j)=>{app.server.once('error',j);app.server.listen(0,'127.0.0.1',r);});base='http://127.0.0.1:'+app.server.address().port;}
 await start();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 async function req(path,method='GET',body,user){const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{cookie:user.cookie,'X-CSRF-Token':user.csrfToken}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const auth=r=>{assert.ok(r.status<300,JSON.stringify(r.data));return {...r.data,cookie:r.cookie};};
 const owner=auth(await req('/api/setup','POST',{setupToken,name:'이기정',username:'gijeong1312',password}));
 const login=async username=>auth(await req('/api/login','POST',{username,password}));
 async function join(username){const invite=await req('/api/invitations','POST',{name:username,username},owner);assert.equal(invite.status,201);return auth(await req('/api/join','POST',{inviteToken:invite.data.inviteToken,password}));}
 const account=async id=>(await req('/api/state','GET',undefined,owner)).data.users.find(u=>u.id===id);
 return {dir,owner,req,join,login,account,get base(){return base;},async restart(){await app.close();await start();}};
}
test('owner delegates coadmins; operators cannot escalate; blocks revoke all sessions and active streams',async t=>{
 const f=await fixture(t),{owner}=f;assert.equal(owner.user.accessRole,'owner');
 let co=await f.join('coadmin'),op=await f.join('operator'),peer=await f.join('peeradmin');
 const access=(user,target,body)=>f.req('/api/admin/users/'+target.user.id+'/access','POST',body,user);
 assert.equal((await f.req('/api/admin/summary','GET',undefined,op)).status,403);
 assert.equal((await access(op,co,{accessRole:'admin',active:true,version:1})).status,403);
 for(const user of [co,peer])assert.equal((await access(owner,user,{accessRole:'admin',active:true,version:1})).status,200);
 assert.equal((await f.req('/api/state','GET',undefined,co)).status,401);co=await f.login('coadmin');peer=await f.login('peeradmin');
 assert.equal((await access(co,owner,{accessRole:'operator',active:false,version:1})).status,403);
 assert.equal((await access(owner,owner,{accessRole:'operator',active:false,version:1})).status,403);
 assert.equal((await access(co,peer,{accessRole:'operator',active:false,version:2})).status,403);
 assert.equal((await access(co,op,{accessRole:'admin',active:true,version:1})).status,403);
 const second=await f.login('operator'),controller=new AbortController();t.after(()=>controller.abort());
 const stream=await fetch(f.base+'/api/events',{headers:{cookie:op.cookie},signal:controller.signal}),reader=stream.body.getReader();await reader.read();
 assert.equal((await access(co,op,{accessRole:'operator',active:false,version:1})).status,200);
 let next;do{next=await reader.read();}while(!next.done);assert.equal(next.done,true);
 for(const user of [op,second])assert.equal((await f.req('/api/state','GET',undefined,user)).status,401);
 assert.equal((await f.req('/api/login','POST',{username:'operator',password})).status,401);
 assert.equal((await access(owner,op,{accessRole:'operator',active:true,version:1})).status,409);
 assert.equal((await access(co,op,{accessRole:'operator',active:true,version:2})).status,200);
 op=await f.login('operator');assert.equal((await f.req('/api/state','GET',undefined,op)).status,200);
 assert.equal((await f.req('/api/admin/users/'+op.user.id+'/logout-all','POST',{version:3},co)).status,200);
 assert.equal((await f.req('/api/session','GET',undefined,op)).status,401);
 await f.restart();assert.equal((await f.login('coadmin')).user.accessRole,'admin');
 const audit=(await f.req('/api/admin/summary','GET',undefined,owner)).data.logs;assert.ok(audit.some(l=>l.action==='logout_all'));assert.ok(audit.some(l=>l.action==='account_access'));
});
test('only the owner can create encrypted backups; real isolated restore verifies all data and rejects tampering',async t=>{
 const f=await fixture(t),op=await f.join('operator'),backupPassword='Separate-backup-password-123';
 await f.req('/api/items','POST',{title:'복원 검증용 업무',type:'task',qty:1,date:'2026-11-03',ownerId:op.user.id},op);
 await f.req('/api/manuals','POST',{title:'검증 문서',category:'일반',content:'비공개 테스트 자료'},op);
 await f.req('/api/resources','POST',{title:'검증 파일',filename:'test.txt',category:'일반',data:Buffer.from('검증').toString('base64')},op);
 const before=(await f.req('/api/state','GET',undefined,f.owner)).data;
 assert.equal((await f.req('/api/admin/backups/export','POST',{currentPassword:password,backupPassword},op)).status,403);
 assert.equal((await f.req('/api/admin/backups/export','POST',{currentPassword:'wrong-password',backupPassword},f.owner)).status,403);
 const exported=await f.req('/api/admin/backups/export','POST',{currentPassword:password,backupPassword},f.owner);assert.equal(exported.status,200,JSON.stringify(exported.data));
 const {backup,verification}=exported.data;assert.equal(verification.ok,true);assert.equal(verification.liveDataChanged,false);assert.equal(verification.counts.items,1);assert.equal(verification.counts.library_resources,1);assert.equal(verification.sessionsRestored,false);
 for(const value of ['非公開','비공개 테스트 자료',password,'password_hash'])assert.ok(!JSON.stringify(backup).includes(value));
 const verify=(file,pass)=>f.req('/api/admin/backups/verify','POST',{currentPassword:password,backupPassword:pass,backup:file},f.owner);
 assert.equal((await verify(backup,backupPassword)).status,200);assert.equal((await verify(backup,'Wrong-backup-password-123')).status,422);
 const tampered={...backup,data:(backup.data[0]==='A'?'B':'A')+backup.data.slice(1)};assert.equal((await verify(tampered,backupPassword)).status,422);
 const after=(await f.req('/api/state','GET',undefined,f.owner)).data;assert.deepEqual(after.items,before.items);assert.deepEqual(after.officeStock,before.officeStock);assert.equal((await f.req('/api/session','GET',undefined,op)).status,200);
});
test('legacy bootstrap requires both exact name and username and never re-promotes on restart',async t=>{
 const dir=await mkdtemp('/tmp/dayon-owner-migrate-');t.after(()=>rm(dir,{recursive:true,force:true}));
 const db=await openStorage({dataDir:dir,databaseUrl:''});
 await db.run('INSERT INTO users(id,name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',['wrong','동명이인','gijeong1312','hash','member',new Date().toISOString()]);
 await bootstrapOwner(db);assert.equal((await db.get('SELECT access_role FROM account_access WHERE user_id=?',['wrong'])).access_role,'operator');
 await db.run('UPDATE users SET name=? WHERE id=?',['이기정','wrong']);await bootstrapOwner(db);assert.equal((await db.get('SELECT access_role FROM account_access WHERE user_id=?',['wrong'])).access_role,'owner');
 await verifyInitialBackup(db);assert.equal((await db.get("SELECT value FROM metadata WHERE key='initial_backup_restore_verified_v1'")).value,1);
 assert.equal((await db.get("SELECT count(*) n FROM admin_audit WHERE action='owner_assigned'")).n,1);
 await db.run("UPDATE account_access SET access_role='operator' WHERE user_id='wrong'");await bootstrapOwner(db);assert.equal((await db.get('SELECT access_role FROM account_access WHERE user_id=?',['wrong'])).access_role,'operator');
 await db.close();
});

test('PostgreSQL-shaped snapshots normalize bigint counters and retain message sequence gaps in SQLite rehearsal',async t=>{
 const f=await fixture(t);await f.req('/api/messages','POST',{text:'순서 검증'},f.owner);
 const db=await openStorage({dataDir:f.dir,databaseUrl:''});
 const snapshot=await backupSnapshot(db);await db.close();
 const pg={kind:'postgres',transaction:async fn=>fn({all:async query=>{
  const table=query.match(/FROM ([a-z_]+)$/)[1];return snapshot.tables[table].map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,(['seq','last_seq'].includes(key)||(table==='metadata'&&key==='value'))?String(value):value])));
 }})};
 const normalized=await backupSnapshot(pg);normalized.tables.messages[0].seq=7;
 const result=await rehearseBackup(normalized);assert.equal(result.ok,true);assert.equal(result.counts.messages,1);assert.equal(result.liveDataChanged,false);
});
