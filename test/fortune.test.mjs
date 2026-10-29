import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyFortune} from '../public/fortune.js';
test('one person gets the same fortune throughout a Seoul day',()=>{
 const first=dailyFortune('person-a',new Date('2026-10-28T15:00:00Z'));
 const last=dailyFortune('person-a',new Date('2026-10-29T14:59:59Z'));
 assert.deepEqual(first,last);assert.equal(first.day,'2026-10-29');
 assert.equal(typeof first.message,'string');assert.ok(first.message.length<80);assert.ok(first.practice.length>0);
});
test('a new encouragement starts exactly at midnight in Seoul',()=>{
 const before=dailyFortune('person-a',new Date('2026-10-29T14:59:59Z'));
 const after=dailyFortune('person-a',new Date('2026-10-29T15:00:00Z'));
 assert.notEqual(before.message,after.message);assert.equal(after.day,'2026-10-30');
});
test('consecutive days do not repeat even across year and rotation boundaries',()=>{
 for(const user of ['existing-user','다른 사용자','']){
  let previous;
  for(let day=0;day<370;day++){
   const current=dailyFortune(user,new Date(Date.UTC(2026,0,1+day)));
   if(previous)assert.notEqual(current.message,previous.message);
   previous=current;
  }
 }
});
