import {randomUUID} from 'node:crypto';
import {AppError,jsonBody,verifyPassword} from './security.mjs';
import {backupSnapshot,encryptBackup,decryptBackup,rehearseBackup} from './backup.mjs';
export const accessLabels={owner:'총괄',admin:'공동관리자',operator:'운영자'};
export function isManager(user){return ['owner','admin'].includes(user.access_role);}
export async function manager(c,userId,ownerOnly=false){
 const user=await c.get('SELECT u.id,u.name,u.password_hash,a.* FROM users u JOIN account_access a ON a.user_id=u.id WHERE u.id=?',[userId]);
 if(!user||user.active!==1||!isManager(user)||(ownerOnly&&user.access_role!=='owner'))throw new AppError(403,'이 작업을 수행할 관리자 권한이 없습니다.');return user;
}
export async function audit(c,user,action,targetId,detail){await c.run('INSERT INTO admin_audit(id,actor_id,actor_name,action,target_id,detail,created_at) VALUES(?,?,?,?,?,?,?)',[randomUUID(),user.id,user.name,action,targetId,JSON.stringify(detail),new Date().toISOString()]);}
export function adminRoutes({db,auth,json,changed,publish}){
 let backupBusy=false;
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/admin/'))return false;
  const user=await auth(req,req.method!=='GET');await manager(db,user.id);
  if(url.pathname==='/api/admin/summary'&&req.method==='GET'){
   const result=await db.transaction(async c=>{
    await manager(c,user.id);
    const accounts=await c.all('SELECT u.id,u.name,u.username,a.access_role,a.active,a.version FROM users u JOIN account_access a ON a.user_id=u.id ORDER BY u.name,u.id');
    const logs=await c.all('SELECT actor_name,action,target_id,detail,created_at FROM admin_audit ORDER BY created_at DESC,id DESC LIMIT 50');return {accounts,logs,backup:{enabled:user.access_role==='owner',automaticBackup:'unverified',providerRestore:'unverified'}};
   },{readOnly:true});json(res,200,result);return true;
  }
  const match=url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/(access|logout-all)$/);
  if(match&&req.method==='POST'){
   const body=await jsonBody(req),targetId=match[1];
   await db.transaction(async c=>{
    const actor=await manager(c,user.id),target=await c.get('SELECT * FROM account_access WHERE user_id=?',[targetId]);
    if(!target)throw new AppError(404,'사용자를 찾을 수 없습니다.');
    if(target.access_role==='owner')throw new AppError(403,'총괄 계정의 권한과 접속 상태는 다른 관리자가 변경할 수 없습니다.');
    if(actor.access_role==='admin'&&(target.access_role!=='operator'||(match[2]==='access'&&body.accessRole!=='operator')))throw new AppError(403,'공동관리자는 운영자 계정만 관리할 수 있습니다.');
    if(targetId===user.id)throw new AppError(403,'자신의 계정은 이 화면에서 변경할 수 없습니다.');
    if(!Number.isSafeInteger(body.version)||body.version!==target.version)throw new AppError(409,'계정 상태가 변경됐습니다. 최신 정보를 불러와 주세요.');
    if(match[2]==='access'){
     if(!['admin','operator'].includes(body.accessRole)||typeof body.active!=='boolean')throw new AppError(422,'권한과 사용 상태를 확인해 주세요.');
     if(body.active&&target.active===0){const count=Number((await c.get('SELECT count(*) n FROM account_access WHERE active=1')).n)+Number((await c.get('SELECT count(*) n FROM invitations WHERE expires_at>?',[Date.now()])).n);if(count>=4)throw new AppError(409,'활성 계정과 대기 초대 정원 4명에 도달해 차단을 해제할 수 없습니다.');}
     await c.run('UPDATE account_access SET access_role=?,active=?,version=version+1 WHERE user_id=?',[body.accessRole,body.active?1:0,targetId]);
     await audit(c,actor,'account_access',targetId,{from:{role:target.access_role,active:target.active===1},to:{role:body.accessRole,active:body.active}});
    }else{
     await c.run('UPDATE account_access SET version=version+1 WHERE user_id=?',[targetId]);await audit(c,actor,'logout_all',targetId,{});
    }
    await c.run('DELETE FROM sessions WHERE user_id=?',[targetId]);await changed(c);
   });await publish();json(res,200,{ok:true});return true;
  }
  if(['/api/admin/backups/export','/api/admin/backups/verify'].includes(url.pathname)&&req.method==='POST'){
   const owner=await manager(db,user.id,true);if(backupBusy)throw new AppError(409,'다른 백업 검증이 진행 중입니다. 잠시 후 다시 시도해 주세요.');backupBusy=true;
   try{
    const body=await jsonBody(req,70*1024*1024);
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>128||!await verifyPassword(body.currentPassword,owner.password_hash))throw new AppError(403,'현재 로그인 비밀번호를 확인해 주세요.');
    const exporting=url.pathname.endsWith('/export');
    const snapshot=exporting?await backupSnapshot(db):await decryptBackup(body.backup,body.backupPassword);
    // Validate password before running an expensive rehearsal.
    const backup=exporting?await encryptBackup(snapshot,body.backupPassword):null;
    let verification;try{verification=await rehearseBackup(snapshot);}catch(error){throw error instanceof AppError?error:new AppError(422,'별도 임시 DB 복원 검증에 실패했습니다. 운영 데이터는 변경하지 않았습니다.');}
    await db.transaction(async c=>{const actor=await manager(c,user.id,true);await audit(c,actor,exporting?'backup_export_verified':'backup_restore_verified',null,{backupCreatedAt:snapshot.createdAt,checkedAt:verification.checkedAt,counts:verification.counts,liveDataChanged:false});await changed(c);});await publish();
    // Re-check authorization immediately before returning sensitive backup material.
    await manager(db,user.id,true);json(res,200,{...(backup?{backup}:{}),verification});return true;
   }finally{backupBusy=false;}
  }
  throw new AppError(404,'요청한 관리자 기능을 찾을 수 없습니다.');
 };
}

// Verify the first real post-migration snapshot on the server without exporting data.
// A randomly generated, disposable encryption key is never saved or sent to a client.
export async function verifyInitialBackup(db){
 if(!await db.get("SELECT value FROM metadata WHERE key='owner_gijeong1312_v1'")||await db.get("SELECT value FROM metadata WHERE key='initial_backup_restore_verified_v1'"))return;
 const owner=await db.get("SELECT u.id,u.name FROM users u JOIN account_access a ON a.user_id=u.id WHERE a.access_role='owner' AND a.active=1");if(!owner)return;
 const temporaryPassword=randomUUID()+randomUUID(),snapshot=await backupSnapshot(db),encrypted=await encryptBackup(snapshot,temporaryPassword),decoded=await decryptBackup(encrypted,temporaryPassword),verification=await rehearseBackup(decoded);
 await db.transaction(async c=>{
  if(await c.get("SELECT value FROM metadata WHERE key='initial_backup_restore_verified_v1'"))return;
  await audit(c,owner,'backup_startup_verified',null,{backupCreatedAt:snapshot.createdAt,checkedAt:verification.checkedAt,counts:verification.counts,liveDataChanged:false,durableBackupCreated:false});
  await c.run("INSERT INTO metadata(key,value) VALUES('initial_backup_restore_verified_v1',1)");await c.run("UPDATE metadata SET value=value+1 WHERE key='revision'");
 });
}
