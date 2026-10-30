export function seoulDate(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
}
export function dueReminders(items, userId, now = new Date()) {
  if (!userId) return [];
  const day = seoulDate(now);
  return items.filter(item => item.ownerId === userId && !item.done && (item.dueDate || item.date) <= day)
    .map(item => ({ ...item, overdue: (item.dueDate || item.date) < day }))
    .sort((a,b) => (a.dueDate||a.date).localeCompare(b.dueDate||b.date) || a.title.localeCompare(b.title,'ko') || String(a.id).localeCompare(String(b.id)));
}
export function reminderKey(item, now = new Date()) {
  return `${seoulDate(now)}:${item.id}:${item.version}:${item.dueDate||item.date}`;
}
