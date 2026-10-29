import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'moa.sqlite');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
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

export async function openStorage({ dataDir, databaseUrl }) {
  if (databaseUrl !== undefined && databaseUrl !== null && databaseUrl !== '') {
    const { openPostgres } = await import('./postgres.mjs');
    return openPostgres(databaseUrl);
  }
  const raw = openDatabase(dataDir);
  const direct = {
    get: async (sql, values = []) => raw.prepare(sql).get(...values),
    all: async (sql, values = []) => raw.prepare(sql).all(...values),
    run: async (sql, values = []) => raw.prepare(sql).run(...values),
  };
  // Keep an async transaction exclusive even while its callback awaits operations.
  let queue = Promise.resolve();
  function exclusive(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }
  return {
    kind: 'sqlite', itemOrder: 'items.rowid', invitationOrder: 'rowid',
    messageQuery: 'SELECT m.*,u.name FROM (SELECT rowid AS seq,* FROM messages ORDER BY rowid DESC LIMIT 500) m JOIN users u ON u.id=m.user_id ORDER BY m.seq',
    get: (...args) => exclusive(() => direct.get(...args)),
    all: (...args) => exclusive(() => direct.all(...args)),
    run: (...args) => exclusive(() => direct.run(...args)),
    transaction: (callback) => exclusive(async () => {
      raw.exec('BEGIN IMMEDIATE');
      try { const value = await callback(direct); raw.exec('COMMIT'); return value; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    }),
    close: () => exclusive(() => raw.close()),
  };
}

export function publicUser(row) { return { id: row.id, name: row.name, username: row.username, role: row.role }; }
export function itemRow(row) {
  return { id: row.id, title: row.title, type: row.type, qty: row.qty, ownerId: row.owner_id, owner: row.owner,
    requesterId: row.requester_id, requester: row.requester, date: row.date, note: row.note,
    tracking: row.tracking, done: !!row.done, version: row.version };
}
export const itemQuery = 'SELECT items.*,o.name owner,r.name requester FROM items JOIN users o ON o.id=items.owner_id JOIN users r ON r.id=items.requester_id';
export function messageRow(row) {
  return { id: row.id, userId: row.user_id, name: row.name, text: row.text, createdAt: row.created_at,
    time: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(row.created_at)) };
}
