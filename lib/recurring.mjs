import {isBusinessDay,nextDay,seoulDate} from './business-days.mjs';
export const recurringSchema = `CREATE TABLE IF NOT EXISTS recurring_tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),requester_id TEXT NOT NULL REFERENCES users(id),start_date TEXT NOT NULL,last_date TEXT,stopped_date TEXT,note TEXT NOT NULL DEFAULT '',checklist TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1);`;
export async function generateRecurring(connection, through = seoulDate()) {
  const templates = await connection.all('SELECT * FROM recurring_tasks WHERE stopped_date IS NULL');
  let count = 0;
  for (const template of templates) {
    let day = template.last_date ? nextDay(template.last_date) : template.start_date;
    for (;day <= through;day = nextDay(day)) {
      if (!isBusinessDay(day)) continue;
      const result = await connection.run("INSERT INTO items(id,title,type,qty,owner_id,requester_id,date,note,series_id,checklist,priority,due_date) VALUES(?,?,'task',1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",[template.id+'--'+day,template.title,template.owner_id,template.requester_id,day,template.note,template.id,template.checklist,template.priority,nextDay(day,template.due_offset)]);
      count += result.changes;
    }
    if (template.start_date <= through && template.last_date !== through) await connection.run('UPDATE recurring_tasks SET last_date=? WHERE id=?',[through,template.id]);
  }
  return count;
}
