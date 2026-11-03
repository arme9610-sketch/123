import {randomUUID} from 'node:crypto';
export const adminSchema=`CREATE TABLE IF NOT EXISTS account_access(user_id TEXT PRIMARY KEY REFERENCES users(id),access_role TEXT NOT NULL DEFAULT 'operator' CHECK(access_role IN ('owner','admin','operator')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version INTEGER NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS account_single_owner ON account_access(access_role) WHERE access_role='owner';
CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,detail TEXT NOT NULL,created_at TEXT NOT NULL);`;
// One-time grant explicitly requested by the owner; never matched by display name alone.
export async function bootstrapOwner(db){
 await db.transaction(async c=>{
  await c.run("INSERT INTO account_access(user_id) SELECT id FROM users WHERE 1=1 ON CONFLICT(user_id) DO NOTHING");
  if(await c.get("SELECT value FROM metadata WHERE key='owner_gijeong1312_v1'"))return;
  const target=await c.get('SELECT id FROM users WHERE username=? AND name=?',['gijeong1312','이기정']);
  if(target&&!await c.get("SELECT user_id FROM account_access WHERE access_role='owner'")){
   await c.run("UPDATE account_access SET access_role='owner',active=1,version=version+1 WHERE user_id=?",[target.id]);
   await c.run("INSERT INTO metadata(key,value) VALUES('owner_gijeong1312_v1',1)");
   await c.run('INSERT INTO admin_audit(id,actor_id,actor_name,action,target_id,detail,created_at) VALUES(?,?,?,?,?,?,?)',[randomUUID(),target.id,'이기정','owner_assigned',target.id,JSON.stringify({username:'gijeong1312',source:'owner-requested-migration'}),new Date().toISOString()]);
   await c.run("UPDATE metadata SET value=value+1 WHERE key='revision'");
  }
 });
}
