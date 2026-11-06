const retentionMs=7*24*60*60*1000;
export const inboundArchiveExpiry=date=>new Date(date.getTime()+retentionMs).toISOString();
export async function initializeInboundArchive(db,date){
 // Previously completed arrivals receive a full recovery week when this policy
 // is introduced. Never infer an expiry from a missing historical timestamp.
 return db.transaction(c=>c.run("UPDATE items SET archive_expires_at=? WHERE type='inbound' AND done=1 AND archive_expires_at IS NULL",[inboundArchiveExpiry(date)]));
}
export async function purgeInboundArchive(db,date){
 return db.transaction(async c=>{
  const result=await c.run("DELETE FROM items WHERE type='inbound' AND done=1 AND archive_expires_at IS NOT NULL AND archive_expires_at<=?",[date.toISOString()]);
  if(result.changes)await c.run("UPDATE metadata SET value=value+1 WHERE key='revision'");
  return result.changes;
 });
}
