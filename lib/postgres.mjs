function configurationError(message) {
  return Object.assign(new Error(message), { code: 'DAYON_CONFIG' });
}

export function postgresConfig(databaseUrl) {
  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw configurationError('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw configurationError('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode === 'disable' && !local) throw configurationError('TLS is required for remote PostgreSQL connections.');
  if (sslmode && !['disable', 'require', 'verify-ca', 'verify-full', 'prefer', 'allow'].includes(sslmode)) {
    throw configurationError('Unsupported PostgreSQL TLS configuration.');
  }
  // URL SSL options otherwise override pg's explicit TLS verification object.
  for (const name of [...parsed.searchParams.keys()]) {
    if (name.toLowerCase().startsWith('ssl')) parsed.searchParams.delete(name);
  }
  return {
    connectionString: parsed.toString(),
    ssl: local && sslmode === 'disable' ? false : { rejectUnauthorized: true },
    max: 5, connectionTimeoutMillis: 10_000, query_timeout: 15_000,
    statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000,
    idleTimeoutMillis: 10_000, allowExitOnIdle: true, application_name: 'dayon',
  };
}

const schema = `
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,expires_at BIGINT NOT NULL,seq BIGSERIAL UNIQUE);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,title TEXT NOT NULL,type TEXT NOT NULL,qty INTEGER NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),requester_id TEXT NOT NULL REFERENCES users(id),date TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',tracking TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,seq BIGSERIAL UNIQUE);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),text TEXT NOT NULL,created_at TEXT NOT NULL,seq BIGSERIAL UNIQUE);
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value BIGINT NOT NULL);
INSERT INTO metadata(key,value) VALUES('revision',0) ON CONFLICT(key) DO NOTHING;
`;

function executor(client) {
  function query(sql, values = []) {
    let index = 0;
    return client.query(sql.replace(/\?/g, () => '$' + (++index)), values);
  }
  return {
    get: async (...args) => (await query(...args)).rows[0],
    all: async (...args) => (await query(...args)).rows,
    run: async (...args) => ({ changes: (await query(...args)).rowCount }),
  };
}

export async function openPostgres(databaseUrl) {
  const config = postgresConfig(databaseUrl);
  const { default: pg } = await import('pg');
  const pool = new pg.Pool(config);
  pool.on('error', error => console.error('PostgreSQL connection error:', error.code || error.name));
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize first-start migrations; IF NOT EXISTS alone can race in pg catalogs.
      await client.query('SELECT pg_advisory_xact_lock(714343431)');
      await client.query(schema);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  } catch (error) { await pool.end(); throw error; }
  const direct = executor(pool);
  return {
    ...direct, kind: 'postgres', itemOrder: 'items.seq', invitationOrder: 'seq',
    messageQuery: 'SELECT m.*,u.name FROM (SELECT * FROM messages ORDER BY seq DESC LIMIT 500) m JOIN users u ON u.id=m.user_id ORDER BY m.seq',
    async transaction(callback, { readOnly = false } = {}) {
      const client = await pool.connect();
      try {
        await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
        if (!readOnly) await client.query("SELECT value FROM metadata WHERE key='revision' FOR UPDATE");
        const value = await callback(executor(client));
        await client.query('COMMIT');
        return value;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
