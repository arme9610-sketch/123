import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

const setupToken = 'test-only-bootstrap-token-47';
const password = 'Test-Only-Password-47';
const adminDetails = { name: '김민지', username: 'admin', password, setupToken };

async function fixture(t, { initialize = true } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'moa-api-test-'));
  let app;
  let base;
  async function start() {
    app = await createApp({ dataDir, setupToken, secureCookie: false });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  await start();
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(route, { method = 'GET', body, auth, headers = {} } = {}) {
    const res = await fetch(base + route, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  function authOf(result) {
    assert.ok(result.status >= 200 && result.status < 300, 'authentication should succeed');
    assert.equal(typeof result.data.csrfToken, 'string');
    const cookie = result.headers.get('set-cookie');
    assert.ok(cookie?.includes('HttpOnly'), 'session cookie must be inaccessible to JavaScript');
    assert.match(cookie, /SameSite=(Strict|Lax)/i);
    return { cookie: cookie.split(';')[0], csrfToken: result.data.csrfToken, user: result.data.user };
  }
  const admin = initialize ? authOf(await request('/api/setup', { method: 'POST', body: adminDetails })) : null;
  return { request, authOf, admin, dataDir, get base() { return base; }, async restart() { await app.close(); await start(); } };
}

function validItem(ownerId, overrides = {}) {
  return { title: '화이트 머그컵 입고', type: 'inbound', qty: 17, ownerId, date: '2026-11-03', note: '검수 후 입고', tracking: '', ...overrides };
}
async function inviteAndJoin(f, username = 'worker', name = '이준호') {
  const invite = await f.request('/api/invitations', { method: 'POST', auth: f.admin, body: { username, name } });
  assert.ok(invite.status >= 200 && invite.status < 300, 'administrator can invite a team member');
  assert.equal(typeof invite.data.inviteToken, 'string');
  const joined = await f.request('/api/join', { method: 'POST', body: { inviteToken: invite.data.inviteToken, password } });
  return { member: f.authOf(joined), inviteToken: invite.data.inviteToken };
}

test('bootstrap is protected; workspace APIs require a signed-in session', async t => {
  const f = await fixture(t, { initialize: false });
  assert.equal((await f.request('/api/status')).data.initialized, false);
  assert.equal((await f.request('/api/state')).status, 401);
  assert.equal((await f.request('/api/events')).status, 401);
  const badSetup = await f.request('/api/setup', { method: 'POST', body: { ...adminDetails, setupToken: 'incorrect-bootstrap-token' } });
  assert.ok(badSetup.status >= 400 && badSetup.status < 500);
  assert.equal((await f.request('/api/status')).data.initialized, false);
  const setup = await f.request('/api/setup', { method: 'POST', body: adminDetails });
  const admin = f.authOf(setup);
  assert.equal(admin.user.role, 'admin');
  assert.equal((await f.request('/api/status')).data.initialized, true);
  const duplicate = await f.request('/api/setup', { method: 'POST', body: adminDetails });
  assert.ok(duplicate.status >= 400 && duplicate.status < 500, 'initialization may only happen once');
  const failedLogin = await f.request('/api/login', { method: 'POST', body: { username: 'admin', password: 'invalid-password' } });
  assert.equal(failedLogin.status, 401);
  const state = await f.request('/api/state', { auth: admin });
  assert.equal(state.status, 200);
  assert.equal(state.data.users.length, 1);
  assert.equal(state.data.items.length, 0, 'new shared workspace must not contain fictional user records');
  assert.equal(state.data.messages.length, 0);
  assert.ok(!JSON.stringify(state.data).includes(password));
  assert.ok(!Object.keys(state.data.users[0]).some(k => /password|hash|salt|token/i.test(k)));
});

test('session writes require CSRF and reject cross-site origins; logout revokes the session', async t => {
  const f = await fixture(t);
  const input = validItem(f.admin.user.id);
  const absent = await f.request('/api/items', { method: 'POST', body: input, headers: { Cookie: f.admin.cookie } });
  assert.equal(absent.status, 403);
  const forged = await f.request('/api/items', { method: 'POST', body: input, auth: { ...f.admin, csrfToken: 'forged-token' } });
  assert.equal(forged.status, 403);
  const crossSite = await f.request('/api/items', { method: 'POST', body: input, auth: f.admin, headers: { Origin: 'https://another-company.example' } });
  assert.equal(crossSite.status, 403);
  assert.equal((await f.request('/api/state', { auth: f.admin })).data.items.length, 0);
  assert.equal((await f.request('/api/session', { auth: f.admin })).status, 200);
  const loggedOut = await f.request('/api/logout', { method: 'POST', auth: f.admin });
  assert.ok(loggedOut.status >= 200 && loggedOut.status < 300);
  assert.equal((await f.request('/api/state', { auth: f.admin })).status, 401);
  assert.equal((await f.request('/api/session', { auth: f.admin })).status, 401);
});

test('two employees share tasks and inventory; stale completion cannot count an inbound twice', async t => {
  const f = await fixture(t);
  const { member } = await inviteAndJoin(f);
  const create = await f.request('/api/items', { method: 'POST', auth: f.admin, body: validItem(member.user.id) });
  assert.ok(create.status >= 200 && create.status < 300);
  const item = create.data.item;
  assert.equal(item.requesterId, f.admin.user.id);
  assert.equal(item.ownerId, member.user.id);
  assert.equal(item.owner, '이준호');
  const remote = (await f.request('/api/state', { auth: member })).data;
  assert.equal(remote.items[0].id, item.id);
  assert.equal(remote.stock[item.title] || 0, 0, 'planned stock is not available inventory');
  const completions = await Promise.all([f.admin, member].map(auth => f.request(`/api/items/${item.id}/toggle`, { method: 'POST', auth, body: { version: item.version } })));
  assert.equal(completions.filter(r => r.status >= 200 && r.status < 300).length, 1);
  assert.equal(completions.filter(r => r.status === 409).length, 1, 'same item version can only be changed once');
  const completed = (await f.request('/api/state', { auth: member })).data;
  assert.equal(completed.stock[item.title], 17);
  assert.equal(completed.items[0].done, true);
  const lockedEdit = await f.request(`/api/items/${item.id}`, { method: 'PUT', auth: member, body: { ...validItem(member.user.id), qty: 200, version: completed.items[0].version } });
  assert.ok(lockedEdit.status >= 400 && lockedEdit.status < 500, 'completed inbound must not silently rewrite inventory');
  const undo = await f.request(`/api/items/${item.id}/toggle`, { method: 'POST', auth: member, body: { version: completed.items[0].version } });
  assert.ok(undo.status >= 200 && undo.status < 300);
  const undone = (await f.request('/api/state', { auth: f.admin })).data;
  assert.equal(undone.stock[item.title] || 0, 0);
  assert.equal(undone.items[0].done, false);
  const updated = await f.request(`/api/items/${item.id}`, { method: 'PUT', auth: member, body: { ...validItem(member.user.id), qty: 20, version: undone.items[0].version } });
  assert.ok(updated.status >= 200 && updated.status < 300);
  assert.equal((await f.request('/api/state', { auth: f.admin })).data.items[0].qty, 20);
});

test('invalid records never enter the workspace', async t => {
  const f = await fixture(t);
  for (const invalid of [{ qty: 0 }, { qty: 1.5 }, { date: '2026-02-31' }, { type: 'unknown' }, { ownerId: 'missing-user' }, { title: ' ' }]) {
    const result = await f.request('/api/items', { method: 'POST', auth: f.admin, body: validItem(f.admin.user.id, invalid) });
    assert.ok(result.status >= 400 && result.status < 500, `invalid ${Object.keys(invalid)[0]} must be rejected`);
  }
  assert.equal((await f.request('/api/state', { auth: f.admin })).data.items.length, 0);
  for (const text of ['', ' ', 'a'.repeat(2001)]) {
    const result = await f.request('/api/messages', { method: 'POST', auth: f.admin, body: { text } });
    assert.ok(result.status >= 400 && result.status < 500);
  }
  assert.equal((await f.request('/api/state', { auth: f.admin })).data.messages.length, 0);
});

test('invitations are admin-only, revocable, single-use, and limited to four staff', async t => {
  const f = await fixture(t);
  const { member, inviteToken } = await inviteAndJoin(f);
  const reused = await f.request('/api/join', { method: 'POST', body: { inviteToken, password } });
  assert.ok(reused.status >= 400 && reused.status < 500);
  const forbidden = await f.request('/api/invitations', { method: 'POST', auth: member, body: { name: '박서연', username: 'worker2' } });
  assert.equal(forbidden.status, 403);
  await inviteAndJoin(f, 'worker2', '박서연');
  const pending = await f.request('/api/invitations', { method: 'POST', auth: f.admin, body: { name: '최도윤', username: 'worker3' } });
  assert.ok(pending.status >= 200 && pending.status < 300);
  const overLimit = await f.request('/api/invitations', { method: 'POST', auth: f.admin, body: { name: '다섯째', username: 'worker4' } });
  assert.ok(overLimit.status >= 400 && overLimit.status < 500, 'pending invites must reserve a staff slot');
  const list = await f.request('/api/invitations', { auth: f.admin });
  assert.equal(list.status, 200);
  const invitation = list.data.invitations.find(i => i.username === 'worker3');
  assert.ok(invitation);
  assert.ok(!JSON.stringify(list.data).includes(pending.data.inviteToken), 'raw invitation tokens are shown only once');
  const revoked = await f.request(`/api/invitations/${invitation.id}`, { method: 'DELETE', auth: f.admin });
  assert.ok(revoked.status >= 200 && revoked.status < 300);
  const revokedJoin = await f.request('/api/join', { method: 'POST', body: { inviteToken: pending.data.inviteToken, password } });
  assert.ok(revokedJoin.status >= 400 && revokedJoin.status < 500);
  await inviteAndJoin(f, 'worker3', '최도윤');
  assert.equal((await f.request('/api/state', { auth: member })).data.users.length, 4);
});

test('team messages notify a second session through SSE and remain after server restart', async t => {
  const f = await fixture(t);
  const { member } = await inviteAndJoin(f);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  t.after(() => { clearTimeout(timeout); controller.abort(); });
  const response = await fetch(f.base + '/api/events', { headers: { Cookie: member.cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  // Read the initial flush before mutating, so the connection is established.
  await reader.read();
  const created = await f.request('/api/items', { method: 'POST', auth: member, body: validItem(member.user.id, { type: 'task', title: '발송 일정 확인' }) });
  assert.ok(created.status >= 200 && created.status < 300);
  const sent = await f.request('/api/messages', { method: 'POST', auth: f.admin, body: { text: '오늘 머그컵 입고 확인 부탁드려요.' } });
  assert.ok(sent.status >= 200 && sent.status < 300);
  assert.equal(sent.data.message.userId, f.admin.user.id);
  let event = '';
  while (!event.includes('event: change')) {
    const next = await reader.read();
    assert.equal(next.done, false, 'event connection remains live');
    event += new TextDecoder().decode(next.value);
  }
  assert.match(event, /revision/);
  assert.equal((await f.request('/api/state', { auth: member })).data.messages[0].text, '오늘 머그컵 입고 확인 부탁드려요.');
  controller.abort();
  clearTimeout(timeout);
  await reader.cancel().catch(() => {});
  await f.restart();
  const login = f.authOf(await f.request('/api/login', { method: 'POST', body: { username: 'worker', password } }));
  const restored = await f.request('/api/state', { auth: login });
  assert.equal(restored.data.users.length, 2);
  assert.equal(restored.data.items[0].title, '발송 일정 확인');
  assert.equal(restored.data.items[0].requesterId, member.user.id);
  assert.equal(restored.data.messages[0].text, '오늘 머그컵 입고 확인 부탁드려요.');
});

test('passwords and bearer credentials are not stored as plaintext; data stays outside static routes', async t => {
  const f = await fixture(t);
  const invite = await f.request('/api/invitations', { method: 'POST', auth: f.admin, body: { name: '이준호', username: 'worker' } });
  assert.ok(invite.status >= 200 && invite.status < 300);
  const rawSession = f.admin.cookie.slice(f.admin.cookie.indexOf('=') + 1);
  const entries = await readdir(f.dataDir, { withFileTypes: true });
  const databaseFiles = entries.filter(e => e.isFile() && /\.(?:sqlite|db)(?:-wal|-shm)?$/.test(e.name));
  assert.ok(databaseFiles.length > 0, 'shared state uses an on-disk database');
  for (const file of databaseFiles) {
    const bytes = await readFile(path.join(f.dataDir, file.name));
    for (const secret of [password, rawSession, invite.data.inviteToken]) assert.equal(bytes.includes(Buffer.from(secret)), false, 'database must store credential hashes only');
  }
  for (const route of ['/server.mjs', '/data/setup-token', '/data/moa.sqlite']) {
    const result = await f.request(route);
    assert.ok(result.status === 403 || result.status === 404, 'server files and setup credentials must not be publicly served');
  }
});


test('logging out closes the live stream and prevents reconnecting with the revoked cookie', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  t.after(() => { clearTimeout(timeout); controller.abort(); });
  const response = await fetch(f.base + '/api/events', { headers: { Cookie: f.admin.cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await reader.read();
  const loggedOut = await f.request('/api/logout', { method: 'POST', auth: f.admin });
  assert.equal(loggedOut.status, 200);
  let next = await reader.read();
  while (!next.done) next = await reader.read();
  assert.equal(next.done, true);
  assert.equal((await f.request('/api/events', { auth: f.admin })).status, 401);
  clearTimeout(timeout);
});
