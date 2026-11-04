import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftDate,summarizeSales} from '../public/sales-summary.js';
const record=(day,sold,cancelled,site_id='site')=>({day,site_id,entries:[{sku:'pouch-set',sold,cancelled,refunded:0}]});
test('sales dashboard excludes today, calculates weighted ratios and averages only entered dates',()=>{
 const result=summarizeSales([record('2026-11-02',100,10),record('2026-11-02',900,0,'another'),record('2026-11-01',100,10),record('2026-10-20',20,2),record('2026-11-03',9999,999),record('2026-09-01',9999,999)],'2026-11-03');
 const [yesterday,week,month]=result.periods;assert.equal(yesterday.sold,1000);assert.equal(yesterday.rate,1);assert.equal(week.sold,1100);assert.equal(week.rate,1.8);assert.equal(week.enteredDays,2);assert.equal(week.averageSold,550);assert.equal(week.enteredSites,3);assert.equal(week.expectedSites,28);assert.equal(month.sold,1120);assert.equal(month.enteredDays,3);
});
test('missing days remain missing; explicit zero records count as entered; date ranges cross year and leap boundaries',()=>{
 const empty=summarizeSales([],'2026-01-01');assert.equal(empty.end,'2025-12-31');assert.equal(empty.periods[1].start,'2025-12-25');assert.equal(empty.periods[0].averageSold,null);assert.equal(empty.periods[0].rate,null);
 const zero=summarizeSales([record('2025-12-31',0,2)],'2026-01-01').periods[0];assert.equal(zero.enteredDays,1);assert.equal(zero.averageCancelled,2);assert.equal(zero.rate,null);assert.equal(shiftDate('2024-03-01',-1),'2024-02-29');
});
test('fixed prices include pouch; color option ranks use revenue and entered day averages',()=>{
 const entries=[{sku:'essential-28-silver',sold:3,cancelled:1,refunded:0},{sku:'essential-20-black',sold:4,cancelled:0,refunded:0},{sku:'pouch-set',sold:2,cancelled:0,refunded:1}];
 const p=summarizeSales([{day:'2026-11-03',site_id:'a',entries},record('2026-11-02',0,0)],'2026-11-04').periods[1];
 assert.equal(p.revenue,870800);assert.equal(p.refundAmount,167900);assert.equal(p.netRevenue,702900);assert.equal(p.averageRevenue,435400);
 assert.equal(p.optionRankings[0].id,'essential-28-silver');assert.equal(p.optionRankings[0].rank,1);assert.equal(p.optionRankings[0].averageRevenue,208500);assert.equal(p.optionRankings[1].id,'essential-20-black');assert.equal(p.optionRankings[2].price,28900);assert.equal(p.optionRankings.at(-1).rank,null);
});
