import {seoulDate} from './reminders.js';
export function deadlineStatus(item, userId, now = new Date()) {
  if(item.done || item.ownerId !== userId)return '';
  const due=item.dueDate || item.date;
  const days=Math.round((Date.parse(due+'T12:00:00Z')-Date.parse(seoulDate(now)+'T12:00:00Z'))/86400000);
  return days===1?'D-1':days===0?'오늘 마감':days<0?'기한 지남':'';
}
