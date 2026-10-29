import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
export function openDatabase(dataDir) {
 mkdirSync(dataDir,{recursive:true,mode:0o700});
 const file=path.join(dataDir,'moa.sqlite');const db=new DatabaseSync(file);chmodSync(file,0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,title TEXT NOT NULL,type TEXT NOT NULL,qty INTEGER NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),requester_id TEXT NOT NULL REFERENCES users(id),date TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',tracking TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),text TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
 INSERT OR IGNORE INTO metadata(key,value) VALUES('revision',0);`);
 return db;
}
export function transaction(db,fn) {db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
export function publicUser(row) {return {id:row.id,name:row.name,username:row.username,role:row.role};}
export function itemRow(row){return {id:row.id,title:row.title,type:row.type,qty:row.qty,ownerId:row.owner_id,owner:row.owner,requesterId:row.requester_id,requester:row.requester,date:row.date,note:row.note,tracking:row.tracking,done:!!row.done,version:row.version};}
export const itemQuery=`SELECT items.*,o.name owner,r.name requester FROM items JOIN users o ON o.id=items.owner_id JOIN users r ON r.id=items.requester_id`;
export function messageRow(row) {return {id:row.id,userId:row.user_id,name:row.name,text:row.text,createdAt:row.created_at,time:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}).format(new Date(row.created_at))};}
