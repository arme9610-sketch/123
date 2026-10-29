import test from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders, reminderKey, seoulDate } from '../public/reminders.js';
const now=new Date('2026-10-29T15:00:00.000Z');
const item=(id,date,extra={})=>({id,date,title:id,ownerId:'person-a',done:false,version:1,type:'task',...extra});
test('reminder dates roll over at midnight in Seoul rather than server UTC',()=>{
 assert.equal(seoulDate(new Date('2026-10-29T14:59:59Z')),'2026-10-29');
 assert.equal(seoulDate(now),'2026-10-30');
 assert.equal(dueReminders([item('due','2026-10-30')],'person-a',now).length,1);
});
test('reminders only contain unfinished assigned records due today or earlier',()=>{
 const items=[item('today','2026-10-30'),item('late','2026-10-28'),item('future','2026-10-31'),item('done','2026-10-29',{done:true}),item('other','2026-10-29',{ownerId:'person-b'})];
 const reminders=dueReminders(items,'person-a',now);
 assert.deepEqual(reminders.map(i=>i.id),['late','today']);
 assert.equal(reminders[0].overdue,true);assert.equal(reminders[1].overdue,false);
 assert.deepEqual(dueReminders(items,null,now),[]);
 assert.equal(items[0].overdue,undefined,'derived reminders must not change stored work');
});
test('inbound, shipment and shared schedules also reach their actual assignee',()=>{
 const items=['task','inbound','shipment','meeting'].map(type=>item(type,'2026-10-30',{type}));
 assert.equal(dueReminders(items,'person-a',now).length,4);
 assert.deepEqual(dueReminders(items,'person-b',now),[]);
});
test('browser reminder receipt stays stable for unchanged work and changes after edits or a new day',()=>{
 const work=item('example','2026-10-29');
 assert.equal(reminderKey(work,now),reminderKey({...work},now));
 assert.notEqual(reminderKey(work,now),reminderKey({...work,version:2},now));
 assert.notEqual(reminderKey(work,now),reminderKey(work,new Date('2026-10-30T15:00:00Z')));
});
