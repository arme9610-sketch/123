import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createApp } from '../server.mjs';

const connectionString = process.env.MOA_TEST_DATABASE_URL;
assert.ok(connectionString, 'MOA_TEST_DATABASE_URL must name a dedicated loopback PostgreSQL database; no PostgreSQL tests may silently skip.');
const configuredUrl = new URL(connectionString);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(configuredUrl.hostname), 'PostgreSQL integration tests only use an explicitly configured local test database.');
assert.equal(configuredUrl.searchParams.get('sslmode'), 'disable', 'The loopback test database must explicitly use sslmode=disable.');
const setupToken = 'test-only-postgres-bootstrap-key-47';
const password = 'Test-Only-Postgres-Password-47';
const adminDetails = { setupToken, name: '김민지', username: 'admin', password };

function client(base) {
  return async (route, { method = 'GET', body, auth, headers = {} } = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };
}
function authOf(result) {
  assert.ok(result.status >= 200 && result.status < 300, `Authentication returns a successful response (got ${result.status}).`);
  assert.equal(typeof result.data.csrfToken, 'string');
  const cookie = result.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  return { cookie: cookie.split(';')[0], csrfToken: result.data.csrfToken, user: result.data.user };
}
async function listen(app) {
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${app.server.address().port}`;
}
async function fixture(t, { initialize = true, start = true } = {}) {
  const schema = 'dayon_test_' + randomUUID().replaceAll('-', '');
  const administrator = new pg.Pool({ connectionString, ssl: false, max: 1 });
  await administrator.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(connectionString);
  scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const databaseUrl = scoped.toString();
  const directories = [];
  const extraApps = [];
  let app, base, request, dataDir;
  t.after(async () => {
    try {
      for (const other of extraApps) await other.close();
      if (app) await app.close();
    } finally {
      try { await administrator.query(`DROP SCHEMA ${schema} CASCADE`); }
      finally {
        await administrator.end();
        for (const directory of directories) await rm(directory, { recursive: true, force: true });
      }
    }
  });
  async function freshDirectory() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dayon-pg-test-'));
    directories.push(directory);
    return directory;
  }
  async function launch(key) {
    dataDir = await freshDirectory();
    app = await createApp({ dataDir, databaseUrl, setupToken: key, secureCookie: false });
    assert.equal(app.storage, 'postgres');
    base = await listen(app);
    request = client(base);
  }
  if (start) await launch(setupToken);
  const admin = initialize && start ? authOf(await request('/api/setup', { method: 'POST', body: adminDetails })) : null;
  return {
    admin, administrator, databaseUrl, freshDirectory,
    get request() { return request; },
    get base() { return base; },
    get dataDir() { return dataDir; },
    async restartFromEmptyDirectory() { await app.close(); app = null; await launch(undefined); },
    async secondServer() {
      const other = await createApp({ dataDir: await freshDirectory(), databaseUrl, secureCookie: false });
      extraApps.push(other);
      return client(await listen(other));
    },
  };
}
function item(ownerId, overrides = {}) {
  return { title: '무료 체험 입고', type: 'inbound', qty: 23, ownerId, date: '2026-11-03', note: '외부 DB 보존 검증', tracking: '', ...overrides };
}
async function join(f, username = 'worker', name = '이준호') {
  const invitation = await f.request('/api/invitations', { method: 'POST', auth: f.admin, body: { username, name } });
  assert.equal(invitation.status, 201);
  return authOf(await f.request('/api/join', { method: 'POST', body: { inviteToken: invitation.data.inviteToken, password } }));
}

test('PostgreSQL: first setup requires a persistent key and cannot fall back to a local database', async t => {
  const f = await fixture(t, { initialize: false, start: false });
  const dataDir = await f.freshDirectory();
  await assert.rejects(createApp({ databaseUrl: f.databaseUrl, dataDir, setupToken: '' }), /MOA_SETUP_TOKEN/);
  assert.deepEqual(await readdir(dataDir), [], 'An external database must not generate a local SQLite database or temporary setup key.');
});

test('PostgreSQL: only one administrator can be created during concurrent first-time setup', async t => {
  const f = await fixture(t, { initialize: false });
  assert.equal((await f.request('/api/state')).status, 401);
  const responses = await Promise.all(['admin_one', 'admin_two'].map(username => f.request('/api/setup', { method: 'POST', body: { ...adminDetails, username } })));
  assert.equal(responses.filter(result => result.status === 201).length, 1);
  assert.equal(responses.filter(result => result.status === 409).length, 1);
  const admin = authOf(responses.find(result => result.status === 201));
  const state = await f.request('/api/state', { auth: admin });
  assert.equal(state.data.users.length, 1);
  assert.equal(state.data.users[0].role, undefined);
  assert.deepEqual(await readdir(f.dataDir), [], 'PostgreSQL state stays outside the ephemeral application filesystem.');
});

test('PostgreSQL: employee data, sessions and chat survive a new application filesystem', async t => {
  const f = await fixture(t);
  const member = await join(f);
  const created = await f.request('/api/items', { method: 'POST', auth: f.admin, body: item(member.user.id) });
  assert.equal(created.status, 201);
  assert.equal(created.data.item.requesterId, f.admin.user.id);
  const sent = await f.request('/api/messages', { method: 'POST', auth: member, body: { text: '서버가 다시 켜져도 이 기록은 남아야 해요.' } });
  assert.equal(sent.status, 201);
  await f.restartFromEmptyDirectory();
  assert.equal((await f.request('/api/status')).data.initialized, true);
  assert.equal((await f.request('/api/session', { auth: member })).status, 200, 'Existing sessions persist in PostgreSQL.');
  const login = authOf(await f.request('/api/login', { method: 'POST', body: { username: 'worker', password } }));
  const restored = await f.request('/api/state', { auth: login });
  assert.equal(restored.data.users.length, 2);
  assert.equal(restored.data.items[0].ownerId, member.user.id);
  assert.equal(restored.data.items[0].title, '무료 체험 입고');
  assert.equal(restored.data.messages[0].text, sent.data.message.text);
  assert.deepEqual(await readdir(f.dataDir), [], 'A redeployed app must not require retained disk files.');
});

test('PostgreSQL: concurrent completion across database clients counts incoming stock once', async t => {
  const f = await fixture(t);
  const member = await join(f);
  const secondRequest = await f.secondServer();
  const created = await f.request('/api/items', { method: 'POST', auth: f.admin, body: item(member.user.id) });
  assert.equal(created.status, 201);
  const original = created.data.item;
  const toggled = await Promise.all([
    f.request(`/api/items/${original.id}/toggle`, { method: 'POST', auth: f.admin, body: { version: original.version } }),
    secondRequest(`/api/items/${original.id}/toggle`, { method: 'POST', auth: member, body: { version: original.version } }),
  ]);
  assert.deepEqual(toggled.map(result => result.status).sort(), [200, 409]);
  const shared = (await secondRequest('/api/state', { auth: member })).data;
  assert.equal(shared.stock[original.title], 23);
  assert.equal(shared.items[0].done, true);
  assert.equal(shared.items[0].version, original.version + 1);
  const locked = await f.request(`/api/items/${original.id}`, { method: 'PUT', auth: f.admin, body: { ...item(member.user.id), qty: 500, version: shared.items[0].version } });
  assert.equal(locked.status, 409);
  const undone = await secondRequest(`/api/items/${original.id}/toggle`, { method: 'POST', auth: member, body: { version: shared.items[0].version } });
  assert.equal(undone.status, 200);
  assert.equal((await f.request('/api/state', { auth: f.admin })).data.stock[original.title] || 0, 0);
});

test('PostgreSQL: simultaneous invitations cannot reserve more than four staff slots', async t => {
  const f = await fixture(t);
  const secondRequest = await f.secondServer();
  const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? secondRequest : f.request)('/api/invitations', {
    method: 'POST', auth: f.admin, body: { username: `worker_${i}`, name: `직원 ${i}` },
  })));
  const accepted = responses.filter(result => result.status === 201);
  assert.equal(accepted.length, 3);
  assert.equal(responses.filter(result => result.status === 409).length, 3);
  const joins = await Promise.all([f.request, secondRequest].map(request => request('/api/join', { method: 'POST', body: { inviteToken: accepted[0].data.inviteToken, password } })));
  assert.equal(joins.filter(result => result.status === 201).length, 1, 'A token can be consumed by only one concurrent request.');
  assert.ok(joins.some(result => result.status === 409 || result.status === 403));
  const member = authOf(joins.find(result => result.status === 201));
  assert.equal((await f.request('/api/invitations', { auth: member })).status, 200);
  assert.equal((await f.request('/api/invitations', { method: 'POST', auth: member, body: { username: 'over_limit', name: '정원 초과' } })).status, 409);
  for (const invite of accepted.slice(1)) assert.equal((await f.request('/api/join', { method: 'POST', body: { inviteToken: invite.data.inviteToken, password } })).status, 201);
  assert.equal((await f.request('/api/state', { auth: member })).data.users.length, 4);
});

test('PostgreSQL: authentication, CSRF and invalid records remain enforced', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/state')).status, 401);
  const noCsrf = await f.request('/api/items', { method: 'POST', headers: { Cookie: f.admin.cookie }, body: item(f.admin.user.id) });
  assert.equal(noCsrf.status, 403);
  const forged = await f.request('/api/items', { method: 'POST', auth: { ...f.admin, csrfToken: 'forged' }, body: item(f.admin.user.id) });
  assert.equal(forged.status, 403);
  const crossSite = await f.request('/api/items', { method: 'POST', auth: f.admin, headers: { Origin: 'https://other-company.invalid' }, body: item(f.admin.user.id) });
  assert.equal(crossSite.status, 403);
  for (const invalid of [{ qty: 0 }, { qty: 0.5 }, { type: 'unknown' }, { date: '2026-02-31' }, { ownerId: 'missing' }, { title: '' }]) {
    const response = await f.request('/api/items', { method: 'POST', auth: f.admin, body: item(f.admin.user.id, invalid) });
    assert.ok(response.status >= 400 && response.status < 500);
  }
  assert.equal((await f.request('/api/state', { auth: f.admin })).data.items.length, 0);
  assert.equal((await f.request('/api/logout', { method: 'POST', auth: f.admin })).status, 200);
  assert.equal((await f.request('/api/session', { auth: f.admin })).status, 401);
});

test('PostgreSQL: change events reach another employee after a committed message', async t => {
  const f = await fixture(t);
  const member = await join(f);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  t.after(() => { clearTimeout(timeout); controller.abort(); });
  const response = await fetch(f.base + '/api/events', { headers: { Cookie: member.cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await reader.read();
  const created = await f.request('/api/messages', { method: 'POST', auth: f.admin, body: { text: '실시간으로 전달되는 외부 DB 채팅' } });
  assert.equal(created.status, 201);
  let event = '';
  while (!event.includes('event: change')) {
    const next = await reader.read();
    assert.equal(next.done, false);
    event += new TextDecoder().decode(next.value);
  }
  const shared = await f.request('/api/state', { auth: member });
  assert.equal(shared.data.messages[0].id, created.data.message.id);
  assert.equal(shared.data.messages[0].name, f.admin.user.name);
  controller.abort(); clearTimeout(timeout);
  await reader.cancel().catch(() => {});
});

test('PostgreSQL: unreachable or insecure external storage never silently creates SQLite files', async t => {
  const f = await fixture(t, { initialize: false, start: false });
  const dataDir = await f.freshDirectory();
  const unreachable = new URL(f.databaseUrl); unreachable.port = '1';
  await assert.rejects(createApp({ databaseUrl: unreachable.toString(), setupToken, dataDir }));
  assert.deepEqual(await readdir(dataDir), []);
  const remote = 'postgresql://test_user:test_password@database.invalid/dayon?sslmode=disable';
  await assert.rejects(createApp({ databaseUrl: remote, setupToken, dataDir }), /TLS|SSL|secure|loopback|localhost|보안|원격|sslmode/i);
  assert.deepEqual(await readdir(dataDir), []);
});
