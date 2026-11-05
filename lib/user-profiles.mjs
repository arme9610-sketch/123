import {AppError,jsonBody} from './security.mjs';
export const profileSchema=`CREATE TABLE IF NOT EXISTS user_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL,mime TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);`;
export function profileRoutes({db,auth,json,changed,publish,now}){return async(req,res,url)=>{
 const match=url.pathname.match(/^\/api\/user-profiles\/([^/]+)\/avatar$/);if(!match||!['GET','PUT'].includes(req.method))return false;
 const actor=await auth(req,req.method==='PUT'),userId=match[1];
 if(req.method==='GET'){
  const profile=await db.get('SELECT data,mime FROM user_profiles WHERE user_id=?',[userId]);if(!profile)throw new AppError(404,'등록된 프로필 사진이 없습니다.');
  res.writeHead(200,{'Content-Type':profile.mime,'Cache-Control':'private, no-store'});res.end(Buffer.from(profile.data,'base64'));return true;
 }
 if(actor.id!==userId)throw new AppError(403,'본인의 프로필 사진만 변경할 수 있습니다.');
 const body=await jsonBody(req);
 if(!Number.isSafeInteger(body.version)||body.version<0||typeof body.data!=='string'||body.data.length>700000||!['image/png','image/jpeg','image/webp'].includes(body.mime))throw new AppError(422,'PNG·JPG·WebP 사진을 선택해 주세요.');
 const bytes=Buffer.from(body.data,'base64');
 const valid=body.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):body.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(bytes.length<16||bytes.length>512*1024||bytes.toString('base64')!==body.data||!valid)throw new AppError(422,'올바른 이미지 파일을 선택해 주세요.');
 const profile=await db.transaction(async c=>{
  const current=await c.get('SELECT version FROM user_profiles WHERE user_id=?',[userId]);if((current?.version||0)!==body.version)throw new AppError(409,'사진이 먼저 변경되었습니다. 새로고침 후 다시 선택해 주세요.');
  const version=body.version+1,at=now().toISOString();
  if(current)await c.run('UPDATE user_profiles SET data=?,mime=?,version=?,updated_at=? WHERE user_id=?',[body.data,body.mime,version,at,userId]);
  else await c.run('INSERT INTO user_profiles(user_id,data,mime,version,updated_at) VALUES(?,?,?,?,?)',[userId,body.data,body.mime,version,at]);
  await changed(c);return {version};
 });await publish();json(res,200,profile);return true;
};}
