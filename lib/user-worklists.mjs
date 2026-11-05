import {AppError,jsonBody} from './security.mjs';
export const worklistSchema=`CREATE TABLE IF NOT EXISTS user_worklists(user_id TEXT PRIMARY KEY REFERENCES users(id),entries TEXT NOT NULL,version INTEGER NOT NULL,editor_id TEXT NOT NULL REFERENCES users(id),author TEXT NOT NULL,updated_at TEXT NOT NULL);`;
export async function worklistSnapshot(c){return (await c.all('SELECT * FROM user_worklists ORDER BY user_id')).map(row=>({...row,entries:JSON.parse(row.entries)}));}
export function worklistRoutes({db,auth,json,changed,publish,now}){return async(req,res,url)=>{
 const match=url.pathname.match(/^\/api\/user-worklists\/([^/]+)$/);if(!match||req.method!=='PUT')return false;
 const actor=await auth(req,true),body=await jsonBody(req),userId=match[1];
 if(!Number.isSafeInteger(body.version)||body.version<0||!Array.isArray(body.entries)||body.entries.length>20||body.entries.some(line=>typeof line!=='string'||!line.trim()||line.trim().length>200))throw new AppError(422,'업무는 한 줄에 하나씩, 최대 20개·각 200자로 입력해 주세요.');
 const entries=body.entries.map(line=>line.trim());
 const record=await db.transaction(async c=>{
  if(!await c.get('SELECT id FROM users WHERE id=?',[userId]))throw new AppError(422,'등록된 사용자를 선택해 주세요.');
  const current=await c.get('SELECT * FROM user_worklists WHERE user_id=?',[userId]);
  if((current?.version||0)!==body.version)throw new AppError(409,'다른 직원이 먼저 수정했습니다. 창을 다시 열어 최신 업무를 확인해 주세요.');
  if(current&&JSON.stringify(entries)===current.entries)return {...current,entries};
  const updatedAt=now().toISOString(),version=body.version+1;
  if(current)await c.run('UPDATE user_worklists SET entries=?,version=?,editor_id=?,author=?,updated_at=? WHERE user_id=?',[JSON.stringify(entries),version,actor.id,actor.name,updatedAt,userId]);
  else await c.run('INSERT INTO user_worklists(user_id,entries,version,editor_id,author,updated_at) VALUES(?,?,?,?,?,?)',[userId,JSON.stringify(entries),version,actor.id,actor.name,updatedAt]);
  await changed(c);return {user_id:userId,entries,version,editor_id:actor.id,author:actor.name,updated_at:updatedAt};
 });await publish();json(res,200,{record});return true;
};}
