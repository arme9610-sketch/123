import test from 'node:test';
import assert from 'node:assert/strict';
import {menuPages, normalizeMenuOrder, moveMenu} from '../public/menu-order.js';

test('saved menus retain valid preferences while restoring missing and new entries', () => {
  const result = normalizeMenuOrder(['채팅', '업무', '채팅', 'removed-menu', null]);
  assert.deepEqual(result.slice(0, 2), ['채팅', '업무']);
  assert.equal(result.length, menuPages.length);
  assert.deepEqual(new Set(result), new Set(menuPages));
  for (const invalid of [null, {}, '업무', 42]) assert.deepEqual(normalizeMenuOrder(invalid), menuPages);
});

test('movement preserves all menus and ignores moves beyond either edge', () => {
  const original = [...menuPages];
  const moved = moveMenu(original, 2, -1);
  assert.equal(moved[1], original[2]);
  assert.equal(moved[2], original[1]);
  assert.deepEqual(original, menuPages);
  assert.deepEqual(moveMenu(moved, 1, 1), original);
  for (const [index, direction] of [[0, -1], [original.length - 1, 1], [-1, 1], [99, -1], [1, 2]]) assert.deepEqual(moveMenu(original, index, direction), original);
});

test('renaming inbound inventory to imports preserves the user menu position',()=>{
 const order=normalizeMenuOrder(['채팅','입고 · 재고','업무']);assert.deepEqual(order.slice(0,3),['채팅','수입','업무']);assert.equal(order.filter(name=>name==='수입').length,1);assert.ok(order.includes('사무실 재고'));
});
