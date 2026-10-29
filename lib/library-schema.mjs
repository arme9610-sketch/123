export const librarySchema = `
CREATE TABLE IF NOT EXISTS library_documents (
 id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,content TEXT NOT NULL,
 author_id TEXT NOT NULL REFERENCES users(id),updated_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS library_resources (
 id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,filename TEXT NOT NULL,
 size INTEGER NOT NULL,data TEXT NOT NULL,author_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_created_index ON messages(created_at,id);
CREATE INDEX IF NOT EXISTS items_done_index ON items(done,date);
`;
