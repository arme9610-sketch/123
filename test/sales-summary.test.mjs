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

test('sales share donut uses all quantities as denominator and ranks by units rather than price',async()=>{
 const {salesShares,salesShareDonut}=await import('../public/sales-share.js');
 const input=[{id:'essential-20-black',label:'수량 1위',sold:12,revenue:1188000},...Array.from({length:6},(_,i)=>({id:'option-'+i,label:'다른 옵션 '+i,sold:11,revenue:2000000})),{id:'pouch-set',label:'파우치',sold:2,revenue:57800}];
 const shares=salesShares(input);assert.equal(shares.total,80);assert.equal(shares.rows[0].sold,12);assert.equal(shares.rows[0].rank,1);assert.equal(shares.rows[0].share,15);assert.equal(shares.rows[1].rank,2);assert.equal(shares.rows.at(-1).rank,8);
 assert.ok(Math.abs(shares.rows.reduce((sum,o)=>sum+o.share,0)-100)<1e-9);
 const svg=salesShareDonut(shares,String);assert.ok(svg.includes('stroke-dasharray="15 85"'));assert.ok(svg.includes('12개 / 80개 (15%)'));assert.equal((svg.match(/class="sales-share-slice"/g)||[]).length,8);
 const zero=salesShares([{id:'pouch-set',sold:0}]);assert.equal(zero.total,0);assert.equal(zero.rows.length,0);assert.ok(!salesShareDonut(zero,String).includes('NaN'));
 const single=salesShares([{id:'pouch-set',label:'파우치',sold:1}]);assert.equal(single.rows[0].share,100);
});

test('home sales cards show quantity, cancellation and saved-price revenue, with missing days kept empty',async()=>{
 const {createSalesDashboard}=await import('../public/sales-dashboard.js');
 const original=globalThis.document,root={outerHTML:''};
 globalThis.document={querySelector:()=>root,addEventListener(){}};
 try{
  const source=summarizeSales([record('2026-11-03',12,2)],'2026-11-04');
  const dashboard=createSalesDashboard({api:async()=>source,escape:String,getUser:()=>({id:'tester'}),getToday:()=>source.today});
  dashboard.render();await new Promise(resolve=>setTimeout(resolve,0));const html=dashboard.render();
  assert.ok(html.includes('<h2>판매량</h2>'));assert.ok(html.includes('판매 개수'));assert.ok(html.includes('취소·환불'));assert.ok(html.includes('매출'));
  assert.ok(html.includes(Math.round(source.periods[0].revenue).toLocaleString('ko-KR')+'원'));
  dashboard.clear();source.periods=source.periods.map(p=>({...p,enteredDays:0}));dashboard.render();await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(dashboard.render().includes('<dd>—</dd>'));assert.ok(!dashboard.render().includes('NaN'));
 }finally{globalThis.document=original;}
});
