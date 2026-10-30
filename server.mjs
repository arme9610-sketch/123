import {officeRoutes,officeSnapshot,officeLogs,validateOffice} from './lib/office-stock.mjs';
import {generateRecurring} from './lib/recurring.mjs';
import {seoulDate} from './lib/business-days.mjs';
import {chatRoutes,chatStatus} from './lib/chat.mjs';
import { featureRoutes } from './lib/workspace-features.mjs';
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openStorage, publicUser, itemRow, itemQuery, messageRow } from './lib/database.mjs';
import { token, hash, safeEqual, passwordHash, verifyPassword, AppError, requireText, validateUsername, validatePassword, jsonBody } from './lib/security.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const sessionAge = 7 * 24 * 60 * 60 * 1000;
const invitationAge = 24 * 60 * 60 * 1000;
const sessionQuery = 'SELECT sessions.*,users.id,users.name,users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?';

export async function createApp({
  now = () => new Date(),
  dataDir = process.env.MOA_DATA_DIR || path.join(projectRoot, 'data'),
  setupToken = process.env.MOA_SETUP_TOKEN,
  secureCookie = process.env.MOA_SECURE_COOKIE === '1',
  databaseUrl = process.env.DATABASE_URL,
  requireDatabase = process.env.MOA_REQUIRE_DATABASE_URL === '1',
} = {}) {
  if (requireDatabase && (typeof databaseUrl !== 'string' || !databaseUrl.trim())) {
    throw Object.assign(new Error('DATABASE_URL is required for this deployment.'), { code: 'DAYON_CONFIG' });
  }
  const db = await openStorage({ dataDir, databaseUrl });
  const streams = new Set(), attempts = new Map();
  const initialized = async (connection = db) => !!(await connection.get('SELECT 1 FROM users LIMIT 1'));
  try {
    if (!setupToken && !(await initialized())) {
      if (db.kind === 'postgres') {
        throw Object.assign(new Error('MOA_SETUP_TOKEN is required for initial PostgreSQL setup.'), { code: 'DAYON_CONFIG' });
      }
      const tokenFile = path.join(dataDir, 'setup-token');
      if (existsSync(tokenFile)) {
        if (lstatSync(tokenFile).isSymbolicLink()) throw new Error('Setup-token file cannot be a symlink.');
        setupToken = readFileSync(tokenFile, 'utf8').trim();
      } else {
        setupToken = token();
        writeFileSync(tokenFile, setupToken + '\n', { mode: 0o600, flag: 'wx' });
      }
    }
  } catch (error) { await db.close(); throw error; }

  const revision = async (connection = db) => Number((await connection.get("SELECT value FROM metadata WHERE key='revision'")).value);
  const changed = connection => connection.run("UPDATE metadata SET value=value+1 WHERE key='revision'");
  function sessionHash(req) {
    const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('moa_session='))?.slice(12);
    return raw && raw.length <= 100 ? hash(raw) : null;
  }
  async function session(req) {
    const digest = sessionHash(req);
    return digest ? (await db.get(sessionQuery, [digest, Date.now()])) || null : null;
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  async function publish() {
    const currentRevision = await revision();
    await Promise.all([...streams].map(async entry => {
      if (entry.res.destroyed || !(await db.get(sessionQuery, [entry.hash, Date.now()]))) {
        entry.res.end(); streams.delete(entry); return;
      }
      if (!entry.res.writableEnded) entry.res.write(`event: change\ndata: ${JSON.stringify({ revision: currentRevision })}\n\n`);
    }));
  }
  async function setSession(res, user) {
    const raw = token(), csrfToken = token();
    await db.transaction(async connection => {
      await connection.run('DELETE FROM sessions WHERE expires_at<=?', [Date.now()]);
      await connection.run('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)', [hash(raw), user.id, csrfToken, Date.now() + sessionAge]);
    });
    res.setHeader('Set-Cookie', `moa_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionAge / 1000}${secureCookie ? '; Secure' : ''}`);
    return { user: publicUser(user), csrfToken };
  }
  function originCheck(req) {
    const origin = req.headers.origin, expected = `${secureCookie ? 'https' : 'http'}://${req.headers.host}`;
    if ((origin && origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, '다른 사이트에서 보낸 요청은 허용되지 않습니다.');
    }
  }
  async function auth(req, write = false) {
    const user = await session(req);
    if (!user) throw new AppError(401, '로그인이 필요합니다.');
    if (write) {
      originCheck(req);
      if (!safeEqual(req.headers['x-csrf-token'] || '', user.csrf_token)) throw new AppError(403, '인증 정보를 새로 불러온 후 다시 시도해 주세요.');
    }
    return user;
  }
  function limit(req) {
    const key = req.socket.remoteAddress || 'unknown', now = Date.now();
    let hit = attempts.get(key);
    if (!hit || hit.until < now) { hit = { count: 0, until: now + 15 * 60 * 1000 }; attempts.set(key, hit); }
    if (++hit.count > 30) throw new AppError(429, '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    if (attempts.size > 10000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  }
  async function checkCapacity(connection) {
    await connection.run('DELETE FROM invitations WHERE expires_at<=?', [Date.now()]);
    const users = Number((await connection.get('SELECT count(*) n FROM users')).n);
    const invitations = Number((await connection.get('SELECT count(*) n FROM invitations')).n);
    if (users + invitations >= 4) throw new AppError(409, '직원은 초대 대기 중인 계정을 포함해 최대 4명입니다.');
  }
  async function getItem(id, connection = db) {
    const row = await connection.get(`${itemQuery} WHERE items.id=?`, [id]);
    if (!row) throw new AppError(404, '일정을 찾을 수 없습니다.');
    return itemRow(row);
  }
  async function validateItem(body) {
    const title = requireText(body.title, '내용', 100), type = body.type, qty = body.qty;
    const ownerId = body.ownerId, date = body.date, note = body.note ?? '', tracking = body.tracking ?? '';
    if (!['task', 'inbound', 'shipment', 'meeting', 'office'].includes(type)) throw new AppError(422, '올바른 일정 구분을 선택해 주세요.');
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000000) throw new AppError(422, '수량은 1~1,000,000 사이 정수로 입력해 주세요.');
    if (typeof ownerId !== 'string' || !(await db.get('SELECT 1 FROM users WHERE id=?', [ownerId]))) throw new AppError(422, '등록된 담당자를 선택해 주세요.');
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 2000 || Number(date.slice(0, 4)) > 2200) throw new AppError(422, '올바른 날짜를 입력해 주세요.');
    const parsed = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new AppError(422, '올바른 날짜를 입력해 주세요.');
    if (typeof note !== 'string' || note.length > 2000 || typeof tracking !== 'string' || tracking.length > 100) throw new AppError(422, '메모는 2,000자, 운송장 정보는 100자 이내로 입력해 주세요.');
    const priority=body.priority ?? 'normal', dueDate=body.dueDate ?? date;
    if(!['normal','urgent'].includes(priority))throw new AppError(422,'우선순위는 보통 또는 긴급으로 선택해 주세요.');
    if(typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < date || Number(dueDate.slice(0,4)) > 2200)throw new AppError(422,'마감일은 요청일 이후로 선택해 주세요.');
    const due=new Date(dueDate+'T12:00:00Z');
    if(!Number.isFinite(due.getTime()) || due.toISOString().slice(0,10)!==dueDate)throw new AppError(422,'올바른 마감일을 입력해 주세요.');
    const warehouseDate=type==='inbound'?((body.warehouseDate==null||body.warehouseDate==='')?null:body.warehouseDate):null;
    if(warehouseDate!==null){
      if(typeof warehouseDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(warehouseDate)||warehouseDate<'2000-01-01'||warehouseDate>'2200-12-31')throw new AppError(422,'올바른 창고 입고 날짜를 입력해 주세요.');
      const warehouse=new Date(warehouseDate+'T12:00:00Z');
      if(!Number.isFinite(warehouse.getTime())||warehouse.toISOString().slice(0,10)!==warehouseDate)throw new AppError(422,'올바른 창고 입고 날짜를 입력해 주세요.');
    }
    return { ...(type==='office'?validateOffice(body):{officeSku:null,officeOperation:null,officeBucket:null}), title, type, qty, ownerId, date, dueDate, priority, warehouseDate, note: note.trim(), tracking: tracking.trim() };
  }
  function checkVersion(body, current) {
    if (!Number.isSafeInteger(body.version) || body.version !== current.version) throw new AppError(409, '다른 직원이 먼저 수정했습니다. 최신 내용을 확인한 후 다시 시도해 주세요.');
  }

  const chat = chatRoutes({db,auth,json,changed,publish});
  const office = officeRoutes({db,auth,json,changed,publish});
  const features = featureRoutes({db,auth,json,changed,publish});
  async function api(req, res, url) {
    if (await office(req,res,url) || await chat(req,res,url) || await features(req,res,url)) return;
    const route = url.pathname, method = req.method;
    if (route === '/api/status' && method === 'GET') return json(res, 200, { initialized: await initialized() });
    if (route === '/api/setup' && method === 'POST') {
      originCheck(req); limit(req);
      const body = await jsonBody(req);
      if (await initialized()) throw new AppError(409, '이미 초기 설정이 완료되었습니다.');
      if (typeof body.setupToken !== 'string' || !setupToken || !safeEqual(body.setupToken, setupToken)) throw new AppError(403, '초기 설정 키가 올바르지 않습니다.');
      const name = requireText(body.name, '이름', 30), username = validateUsername(body.username);
      const encoded = await passwordHash(validatePassword(body.password));
      const user = { id: randomUUID(), name, username, role: 'admin' };
      await db.transaction(async connection => {
        if (await initialized(connection)) throw new AppError(409, '이미 초기 설정이 완료되었습니다.');
        await connection.run('INSERT INTO users(id,name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', [user.id, name, username, encoded, 'admin', new Date().toISOString()]);
        await changed(connection);
      });
      await publish();
      return json(res, 201, await setSession(res, user));
    }
    if (route === '/api/login' && method === 'POST') {
      originCheck(req); limit(req);
      const body = await jsonBody(req), username = validateUsername(body.username), password = validatePassword(body.password);
      const user = await db.get('SELECT * FROM users WHERE username=?', [username]);
      const valid = await verifyPassword(password, user?.password_hash || '00000000000000000000000000000000:' + '0'.repeat(128));
      if (!user || !valid) throw new AppError(401, '아이디 또는 비밀번호를 확인해 주세요.');
      return json(res, 200, await setSession(res, user));
    }
    if (route === '/api/join' && method === 'POST') {
      originCheck(req); limit(req);
      const body = await jsonBody(req), password = validatePassword(body.password), inviteToken = requireText(body.inviteToken, '초대 코드', 100);
      const invitation = await db.get('SELECT * FROM invitations WHERE token_hash=? AND expires_at>?', [hash(inviteToken), Date.now()]);
      if (!invitation) throw new AppError(403, '만료되었거나 사용할 수 없는 초대 코드입니다.');
      const encoded = await passwordHash(password);
      const user = { id: randomUUID(), name: invitation.name, username: invitation.username, role: 'member' };
      await db.transaction(async connection => {
        const current = await connection.get('SELECT * FROM invitations WHERE id=? AND expires_at>?', [invitation.id, Date.now()]);
        if (!current) throw new AppError(409, '초대 코드가 이미 사용되었거나 만료되었습니다.');
        if (Number((await connection.get('SELECT count(*) n FROM users')).n) >= 4) throw new AppError(409, '직원은 최대 4명입니다.');
        await connection.run('INSERT INTO users(id,name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', [user.id, user.name, user.username, encoded, 'member', new Date().toISOString()]);
        await connection.run('DELETE FROM invitations WHERE id=?', [invitation.id]);
        await changed(connection);
      });
      await publish(); return json(res, 201, await setSession(res, user));
    }
    if (route === '/api/session' && method === 'GET') {
      const user = await auth(req);
      return json(res, 200, { user: publicUser(user), csrfToken: user.csrf_token });
    }
    if (route === '/api/logout' && method === 'POST') {
      const user = await auth(req, true);
      await db.transaction(connection => connection.run('DELETE FROM sessions WHERE token_hash=?', [user.token_hash]));
      for (const entry of streams) if (entry.hash === user.token_hash) { entry.res.end(); streams.delete(entry); }
      res.setHeader('Set-Cookie', `moa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie ? '; Secure' : ''}`);
      return json(res, 200, { ok: true });
    }
    if (route === '/api/state' && method === 'GET') {
      const user=await auth(req);
      await db.transaction(async connection => { if (await generateRecurring(connection,seoulDate(now()))) await changed(connection); });
      const result = await db.transaction(async connection => {
        const users = await connection.all('SELECT id,name,username FROM users ORDER BY name,id');
        const items = (await connection.all(`${itemQuery} ORDER BY items.date,${db.itemOrder}`)).map(itemRow);
        const messages = (await connection.all(db.messageQuery)).map(messageRow), stock = Object.create(null);
        for (const item of items) if (item.type === 'inbound' && item.done) stock[item.title] = (stock[item.title] || 0) + item.qty;
        const recurring = await connection.all('SELECT s.*,o.name owner,r.name requester FROM recurring_tasks s JOIN users o ON o.id=s.owner_id JOIN users r ON r.id=s.requester_id ORDER BY s.start_date,s.id');
        return {officeStockLogs:await officeLogs(connection),officeStock:await officeSnapshot(connection), recurring: recurring.map(s => ({id:s.id,title:s.title,ownerId:s.owner_id,owner:s.owner,requesterId:s.requester_id,requester:s.requester,startDate:s.start_date,stoppedDate:s.stopped_date,version:s.version})), users, items, messages, stock, chat:await chatStatus(connection,db.kind,user.id), revision: await revision(connection) };
      }, { readOnly: true });
      return json(res, 200, result);
    }
    if (route === '/api/events' && method === 'GET') {
      const user = await auth(req), initialRevision = await revision();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: change\ndata: ${JSON.stringify({ revision: initialRevision })}\n\n`);
      const entry = { res, hash: user.token_hash }; streams.add(entry);
      let checking = false;
      const heartbeat = setInterval(async () => {
        if (checking || res.writableEnded) return;
        checking = true;
        try {
          if (!(await db.get(sessionQuery, [entry.hash, Date.now()]))) { res.end(); return; }
          if (!res.writableEnded) res.write(': keepalive\n\n');
        } catch { res.end(); }
        finally { checking = false; }
      }, 15000);
      heartbeat.unref();
      res.on('close', () => { clearInterval(heartbeat); streams.delete(entry); });
      return;
    }
    if (route === '/api/recurring' && method === 'POST') {
      const user = await auth(req,true), body = await jsonBody(req);
      const item = await validateItem({...body,type:'task',qty:1,tracking:''});
      if (item.date < seoulDate(now()) || item.date > seoulDate(new Date(now().getTime()+366*86400000))) throw new AppError(422,'반복 시작일은 오늘부터 1년 이내로 선택해 주세요.');
      const id = randomUUID();
      await db.transaction(async connection => {
        await connection.run('INSERT INTO recurring_tasks(id,title,owner_id,requester_id,start_date,note,priority,due_offset) VALUES(?,?,?,?,?,?,?,?)',[id,item.title,item.ownerId,user.id,item.date,item.note,item.priority,Math.round((Date.parse(item.dueDate)-Date.parse(item.date))/86400000)]);
        await generateRecurring(connection,seoulDate(now())); await changed(connection);
      });
      await publish(); return json(res,201,{id});
    }
    const stopMatch = route.match(/^\/api\/recurring\/([^/]+)\/stop$/);
    if (stopMatch && method === 'POST') {
      await auth(req,true); const body = await jsonBody(req);
      await db.transaction(async connection => {
        const current = await connection.get('SELECT * FROM recurring_tasks WHERE id=?',[stopMatch[1]]);
        if (!current) throw new AppError(404,'반복업무를 찾을 수 없습니다.');
        checkVersion(body,current);
        await generateRecurring(connection,seoulDate(now()));
        await connection.run('UPDATE recurring_tasks SET stopped_date=?,version=version+1 WHERE id=?',[seoulDate(now()),current.id]);
        await changed(connection);
      });
      await publish(); return json(res,200,{stopped:true});
    }
    const detailsMatch = route.match(/^\/api\/items\/([^/]+)\/details$/);
    if (detailsMatch && method === 'PATCH') {
      await auth(req,true); const body = await jsonBody(req);
      if (typeof body.note !== 'string' || body.note.length > 2000 || !Array.isArray(body.checklist) || body.checklist.length > 30 || body.checklist.some(c => !c || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 200 || typeof c.done !== 'boolean')) throw new AppError(422,'메모는 2,000자, 체크리스트는 항목당 200자·30개까지 입력해 주세요.');
      const item = await db.transaction(async connection => {
        const current = await getItem(detailsMatch[1],connection); checkVersion(body,current);
        await connection.run('UPDATE items SET note=?,checklist=?,version=version+1 WHERE id=?',[body.note.trim(),JSON.stringify(body.checklist.map(c=>({text:c.text.trim(),done:c.done}))),current.id]);
        await changed(connection); return getItem(current.id,connection);
      });
      await publish(); return json(res,200,{item});
    }
    if (route === '/api/items' && method === 'POST') {
      const user = await auth(req, true), body = await jsonBody(req), item = await validateItem(body), id = randomUUID();
      await db.transaction(async connection => {
        await connection.run('INSERT INTO items(id,title,type,qty,owner_id,requester_id,date,note,tracking,priority,due_date,office_sku,office_operation,office_bucket,warehouse_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, item.title, item.type, item.qty, item.ownerId, user.id, item.date, item.note, item.tracking, item.priority, item.dueDate,item.officeSku,item.officeOperation,item.officeBucket,item.warehouseDate]);
        await changed(connection);
      });
      await publish(); return json(res, 201, { item: await getItem(id) });
    }
    const itemMatch = route.match(/^\/api\/items\/([^/]+)(\/toggle)?$/);
    if (itemMatch && ((method === 'PUT' && !itemMatch[2]) || (method === 'POST' && itemMatch[2]))) {
      await auth(req, true);
      const body = await jsonBody(req), updated = itemMatch[2] ? null : await validateItem(body);
      const item = await db.transaction(async connection => {
        const current = await getItem(itemMatch[1], connection); checkVersion(body, current);
        if (itemMatch[2]) await connection.run('UPDATE items SET done=?,completed_at=?,version=version+1 WHERE id=? AND version=?', [current.done ? 0 : 1, current.done ? null : new Date().toISOString(), current.id, current.version]);
        else {
          if (current.seriesId && (updated.type !== 'task' || updated.date !== current.date)) throw new AppError(422,'반복업무의 구분과 발생일은 변경할 수 없습니다.');
          if (current.done) throw new AppError(409, '완료를 취소한 후 수정해 주세요.');
          await connection.run('UPDATE items SET title=?,type=?,qty=?,owner_id=?,date=?,note=?,tracking=?,priority=?,due_date=?,office_sku=?,office_operation=?,office_bucket=?,warehouse_date=?,version=version+1 WHERE id=? AND version=?', [updated.title, updated.type, updated.qty, updated.ownerId, updated.date, updated.note, updated.tracking, updated.priority, updated.dueDate, updated.officeSku,updated.officeOperation,updated.officeBucket,updated.warehouseDate,current.id, current.version]);
        }
        if (body.applyToSeries === true && current.seriesId && !itemMatch[2]) {
          await connection.run('UPDATE recurring_tasks SET title=?,owner_id=?,note=?,priority=?,due_offset=?,version=version+1 WHERE id=? AND stopped_date IS NULL',[updated.title,updated.ownerId,updated.note,updated.priority,Math.round((Date.parse(updated.dueDate)-Date.parse(updated.date))/86400000),current.seriesId]);
        }
        await changed(connection);
        return getItem(current.id, connection);
      });
      await publish(); return json(res, 200, { item });
    }
    if (route === '/api/messages' && method === 'POST') {
      const user = await auth(req, true), body = await jsonBody(req), text = requireText(body.text, '메시지', 2000), id = randomUUID(), createdAt = new Date().toISOString();
      await db.transaction(async connection => {
        await connection.run('INSERT INTO messages(id,user_id,text,created_at) VALUES(?,?,?,?)', [id, user.id, text, createdAt]);
        await changed(connection);
      });
      await publish(); return json(res, 201, { message: messageRow(await db.get(`SELECT m.*,m.${db.kind==='postgres'?'seq':'rowid'} AS message_sequence,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?`,[id])) });
    }
    if (route === '/api/invitations' && method === 'GET') {
      await auth(req);
      const invitations = (await db.all(`SELECT id,name,username,expires_at FROM invitations WHERE expires_at>? ORDER BY ${db.invitationOrder}`, [Date.now()])).map(i => ({ id: i.id, name: i.name, username: i.username, expiresAt: new Date(Number(i.expires_at)).toISOString() }));
      return json(res, 200, { invitations });
    }
    if (route === '/api/invitations' && method === 'POST') {
      await auth(req, true);
      const body = await jsonBody(req), name = requireText(body.name, '이름', 30), username = validateUsername(body.username), inviteToken = token(), expiresAt = Date.now() + invitationAge;
      await db.transaction(async connection => {
        await checkCapacity(connection);
        if ((await connection.get('SELECT 1 FROM users WHERE username=?', [username])) || (await connection.get('SELECT 1 FROM invitations WHERE username=?', [username]))) throw new AppError(409, '이미 사용 중이거나 초대된 아이디입니다.');
        await connection.run('INSERT INTO invitations(id,token_hash,name,username,expires_at) VALUES(?,?,?,?,?)', [randomUUID(), hash(inviteToken), name, username, expiresAt]);
        await changed(connection);
      });
      await publish(); return json(res, 201, { inviteToken, name, username, expiresAt: new Date(expiresAt).toISOString() });
    }
    const inviteMatch = route.match(/^\/api\/invitations\/([^/]+)$/);
    if (inviteMatch && method === 'DELETE') {
      await auth(req, true);
      await db.transaction(async connection => {
        const result = await connection.run('DELETE FROM invitations WHERE id=?', [inviteMatch[1]]);
        if (!result.changes) throw new AppError(404, '초대를 찾을 수 없습니다.');
        await changed(connection);
      });
      await publish(); return json(res, 200, { ok: true });
    }
    throw new AppError(404, '요청한 기능을 찾을 수 없습니다.');
  }

  let closing;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      if (closing) throw new AppError(503, '서버를 재시작하고 있습니다. 잠시 후 다시 시도해 주세요.');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError(405, '허용되지 않는 요청 방식입니다.');
      const publicRoot = path.join(projectRoot, 'public'), decoded = decodeURIComponent(url.pathname);
      const file = path.resolve(publicRoot, '.' + decoded), target = file === publicRoot ? path.join(publicRoot, 'index.html') : file;
      if (!target.startsWith(publicRoot + path.sep)) throw new AppError(403, '접근할 수 없습니다.');
      const actual = await realpath(target);
      if (!actual.startsWith(publicRoot + path.sep)) throw new AppError(403, '접근할 수 없습니다.');
      const contents = await readFile(actual);
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(actual)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      if (status === 500) console.error('Request failed:', error.code || error.name);
      json(res, status, { error: status === 500 ? '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' : error.status ? error.message : '파일을 찾을 수 없습니다.' });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  function close() {
    if (!closing) closing = (async () => {
      for (const entry of streams) entry.res.end();
      await new Promise((resolve, reject) => server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
      await db.close();
    })();
    return closing;
  }
  return { server, close, dataDir, storage: db.kind };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const app = await createApp();
    app.server.once('error', async error => {
      console.error('DAYON could not listen:', error.code || error.name);
      await app.close(); process.exitCode = 1;
    });
    app.server.listen(Number(process.env.PORT) || 3000, process.env.HOST || '0.0.0.0', () => console.log('DAYON running on port ' + (process.env.PORT || 3000)));
    const shutdown = () => app.close().then(() => process.exit(0));
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(error.code === 'DAYON_CONFIG' ? error.message : 'DAYON could not initialize storage: ' + (error.code || error.name));
    process.exitCode = 1;
  }
}
