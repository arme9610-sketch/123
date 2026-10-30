import {officeSchema,officeStockColumns} from './office-stock.mjs';
import {officeCatalog} from '../public/office-catalog.js';
import {recurringSchema} from './recurring.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { librarySchema } from './library-schema.mjs';

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
  if (!db.prepare("PRAGMA table_info(items)").all().some(column => column.name === "completed_at")) db.exec("ALTER TABLE items ADD COLUMN completed_at TEXT");
  for (const [name, definition] of [['series_id','TEXT'], ['checklist',"TEXT NOT NULL DEFAULT '[]'"], ['priority',"TEXT NOT NULL DEFAULT 'normal'"], ['due_date','TEXT'],['office_sku','TEXT'],['office_operation','TEXT'],['office_bucket','TEXT'],['warehouse_date','TEXT']]) {
    if (!db.prepare('PRAGMA table_info(items)').all().some(column => column.name === name)) db.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
  }
  db.exec(recurringSchema);
  for (const [name, definition] of [['priority',"TEXT NOT NULL DEFAULT 'normal'"], ['due_offset','INTEGER NOT NULL DEFAULT 0']]) {
    if (!db.prepare('PRAGMA table_info(recurring_tasks)').all().some(column => column.name === name)) db.exec(`ALTER TABLE recurring_tasks ADD COLUMN ${name} ${definition}`);
  }
  db.exec(officeSchema);
  for(const [table,columns] of [['office_stock',officeStockColumns]])for(const column of columns)if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  for(const sku of officeCatalog)db.prepare('INSERT INTO office_stock(sku) VALUES(?) ON CONFLICT(sku) DO NOTHING').run(sku.id);
  db.exec(librarySchema);
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

export function publicUser(row) { return { id: row.id, name: row.name, username: row.username }; }
export function itemRow(row) {
  return { id: row.id, title: row.title, type: row.type, qty: row.qty, ownerId: row.owner_id, owner: row.owner,
    requesterId: row.requester_id, requester: row.requester, date: row.date, requestDate: row.date, dueDate: row.due_date || row.date, priority: row.priority || 'normal', note: row.note,
    warehouseDate:row.warehouse_date||null, officeSku:row.office_sku||null,officeOperation:row.office_operation||null,officeBucket:row.office_bucket||null, seriesId: row.series_id || null, seriesActive: !!row.series_id && !row.stopped_date, checklist: JSON.parse(row.checklist || '[]'), tracking: row.tracking, completedAt: row.completed_at || null, done: !!row.done, version: row.version };
}
export const itemQuery = 'SELECT items.*,o.name owner,r.name requester,s.stopped_date FROM items JOIN users o ON o.id=items.owner_id JOIN users r ON r.id=items.requester_id LEFT JOIN recurring_tasks s ON s.id=items.series_id';
export function messageRow(row) {
  return { id: row.id, sequence: Number(row.message_sequence ?? row.seq ?? 0), userId: row.user_id, name: row.name, text: row.text, createdAt: row.created_at,
    time: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date(row.created_at)) };
}
