import {AppError,jsonBody} from './security.mjs';
const sequenceColumn = kind => kind === 'postgres' ? 'seq' : 'rowid';
export async function chatStatus(connection,kind,userId) {
 const column=sequenceColumn(kind);
 const row=await connection.get(`SELECT COALESCE(MAX(${column}),0) latest,COALESCE((SELECT last_seq FROM chat_reads WHERE user_id=?),0) read_through FROM messages`,[userId]);
 const readThrough=Number(row.read_through),latest=Number(row.latest);
 const unread=Number((await connection.get(`SELECT count(*) count FROM messages WHERE ${column}>? AND user_id<>?`,[readThrough,userId])).count);
 return {readThrough,latest,unread};
}
export function chatRoutes({db,auth,json,changed,publish}) {
 return async(req,res,url)=>{
  if(url.pathname!=='/api/chat/read'||req.method!=='POST')return false;
  const user=await auth(req,true),body=await jsonBody(req);
  if(!Number.isSafeInteger(body.through)||body.through<0)throw new AppError(422,'읽은 메시지 위치를 확인해 주세요.');
  const result=await db.transaction(async connection=>{
   const before=await chatStatus(connection,db.kind,user.id),through=Math.min(body.through,before.latest);
   if(through>before.readThrough){
    await connection.run('INSERT INTO chat_reads(user_id,last_seq) VALUES(?,0) ON CONFLICT(user_id) DO NOTHING',[user.id]);
    await connection.run('UPDATE chat_reads SET last_seq=CASE WHEN last_seq<? THEN ? ELSE last_seq END WHERE user_id=?',[through,through,user.id]);
    await changed(connection);
   }
   return {updated:through>before.readThrough,chat:await chatStatus(connection,db.kind,user.id)};
  });
  if(result.updated)await publish();json(res,200,{chat:result.chat});return true;
 };
}
