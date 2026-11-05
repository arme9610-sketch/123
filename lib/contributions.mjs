import {contributionTier,contributionTiers} from '../public/contribution-tiers.js';
import {randomUUID} from 'node:crypto';
import {seoulDate} from './business-days.mjs';
import {AppError} from './security.mjs';

export const contributionSchema=`CREATE TABLE IF NOT EXISTS contribution_awards(
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL,item_title TEXT NOT NULL,item_type TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(id),owner_name TEXT NOT NULL,
 actor_id TEXT REFERENCES users(id),actor_name TEXT NOT NULL,
 completed_at TEXT NOT NULL,month TEXT NOT NULL,reversed_at TEXT,reversed_by TEXT REFERENCES users(id));
 CREATE UNIQUE INDEX IF NOT EXISTS contribution_item ON contribution_awards(item_id);
 CREATE INDEX IF NOT EXISTS contribution_month_owner ON contribution_awards(month,owner_id);`;

export function contributionLevel(xp){
 const level=Math.min(50,Math.floor((1+Math.sqrt(1+8*xp))/2)),start=level*(level-1)/2,required=level===50?null:level;
 const tier=contributionTier(level),next=contributionTiers.find(t=>t.min>level),nextTier=next?{...next,remaining:next.min*(next.min-1)/2-xp}:null;
 return {level,title:tier.title,tier: tier.id,tierName:tier.name,nextTier,xp,progress:level===50?null:xp-start,required,remaining:required===null?0:required-(xp-start)};
}
export async function awardContribution(c,item,actor,date){
 if(item.done)return;
 if(await c.get('SELECT 1 FROM contribution_awards WHERE item_id=?',[item.id]))return;
 const at=date.toISOString();
 await c.run('INSERT INTO contribution_awards(id,item_id,item_title,item_type,owner_id,owner_name,actor_id,actor_name,completed_at,month) VALUES(?,?,?,?,?,?,?,?,?,?)',
  [randomUUID(),item.id,item.title,item.type,item.ownerId,item.owner,actor.id,actor.name,at,seoulDate(date).slice(0,7)]);
}
export async function initializeContributions(db){
 await db.transaction(async c=>{
  if(await c.get("SELECT 1 FROM metadata WHERE key='contributions_initialized'"))return;
  const items=await c.all('SELECT i.*,u.name owner_name FROM items i JOIN users u ON u.id=i.owner_id WHERE i.done=1 AND i.completed_at IS NOT NULL');
  for(const item of items){
   const date=new Date(item.completed_at);if(!Number.isFinite(date.getTime()))continue;
   await c.run('INSERT INTO contribution_awards(id,item_id,item_title,item_type,owner_id,owner_name,actor_id,actor_name,completed_at,month) VALUES(?,?,?,?,?,?,NULL,?,?,?)',
    ['legacy-'+item.id,item.id,item.title,item.type,item.owner_id,item.owner_name,'기존 완료 기록',date.toISOString(),seoulDate(date).slice(0,7)]);
  }
  await c.run("INSERT INTO metadata(key,value) VALUES('contributions_initialized',1)");
 });
}
export async function contributionSnapshot(c,{month,userId='',offset=0}){
 const users=await c.all('SELECT id,name FROM users ORDER BY name,id'),counts=await c.all('SELECT owner_id,item_type,COUNT(*) xp FROM contribution_awards WHERE month=? AND reversed_at IS NULL GROUP BY owner_id,item_type',[month]);
 const members=users.map(u=>{const own=counts.filter(row=>row.owner_id===u.id),sum=rows=>rows.reduce((n,row)=>n+Number(row.xp),0);return {...u,...contributionLevel(sum(own)),completed:sum(own.filter(row=>!['stock-edit','sales-edit','manual'].includes(row.item_type))),stockEdits:sum(own.filter(row=>row.item_type==='stock-edit')),salesEdits:sum(own.filter(row=>row.item_type==='sales-edit')),manual:sum(own.filter(row=>row.item_type==='manual'))};}).sort((a,b)=>b.xp-a.xp||a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id));
 let rank=0,previous=null;members.forEach((u,i)=>{if(u.xp!==previous)rank=i+1;previous=u.xp;u.rank=u.xp?rank:null;});
 if(userId&&!members.some(u=>u.id===userId))throw new AppError(422,'등록된 사용자를 선택해 주세요.');
 const where='month=?'+(userId?' AND owner_id=?':''),values=userId?[month,userId]:[month];
 const logs=await c.all(`SELECT * FROM contribution_awards WHERE ${where} ORDER BY completed_at DESC,id DESC LIMIT 50 OFFSET ?`,[...values,offset]);
 const total=Number((await c.get(`SELECT COUNT(*) n FROM contribution_awards WHERE ${where}`,values)).n);
 return {month,members,leaders:members.filter(u=>u.xp>0&&u.xp===members[0]?.xp),logs,total,nextOffset:offset+logs.length<total?offset+logs.length:null};
}
