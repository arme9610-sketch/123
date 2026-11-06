import {AppError,passwordHash,verifyPassword} from './security.mjs';
export const resourceSecuritySchema=`CREATE TABLE IF NOT EXISTS resource_access_attempts(resource_id TEXT NOT NULL REFERENCES library_resources(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),attempts INTEGER NOT NULL,window_until BIGINT NOT NULL,PRIMARY KEY(resource_id,user_id));`;
export async function resourcePinHash(value){
 if(value===undefined||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}$/.test(value))throw new AppError(422,'간편 비밀번호는 숫자 4자리로 입력해 주세요.');
 return passwordHash(value);
}
// Return a denial rather than throwing inside a transaction so the failed
// attempt commits. Five failures lock this user's access to this file for 5 min.
export async function checkResourcePin(c,file,user,password){
 if(!file.pin_hash)return null;
 const time=Date.now(),row=await c.get('SELECT attempts,window_until FROM resource_access_attempts WHERE resource_id=? AND user_id=?',[file.id,user.id]);
 const active=row&&Number(row.window_until)>time,attempts=active?row.attempts:0;
 if(attempts>=5)return {denied:true,status:429,message:'비밀번호를 5회 잘못 입력했습니다. 5분 후 다시 시도해 주세요.'};
 if(typeof password==='string'&&/^\d{4}$/.test(password)&&await verifyPassword(password,file.pin_hash)){
  await c.run('DELETE FROM resource_access_attempts WHERE resource_id=? AND user_id=?',[file.id,user.id]);return null;
 }
 await c.run('INSERT INTO resource_access_attempts(resource_id,user_id,attempts,window_until) VALUES(?,?,?,?) ON CONFLICT(resource_id,user_id) DO UPDATE SET attempts=excluded.attempts,window_until=excluded.window_until',[file.id,user.id,attempts+1,active?Number(row.window_until):time+5*60*1000]);
 return {denied:true,status:403,message:'간편 비밀번호가 일치하지 않습니다.'};
}
export function rejectResourceAccess(result){if(result?.denied)throw new AppError(result.status,result.message);}
