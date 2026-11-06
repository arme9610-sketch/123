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

test('donut alone groups options after the top ten without changing rankings or its full-sales denominator',async()=>{
 const {salesShares,topDonutShares,salesShareDonut}=await import('../public/sales-share.js');
 const shares=salesShares(Array.from({length:15},(_,i)=>({id:'option-'+i,label:'옵션 '+i,sold:15-i})));
 const chart=topDonutShares(shares);assert.equal(shares.rows.length,15);assert.equal(chart.rows.length,11);assert.equal(chart.total,120);
 assert.equal(chart.rows.at(-1).label,'기타 (5개 옵션)');assert.equal(chart.rows.at(-1).sold,15);assert.equal(chart.rows.at(-1).share,12.5);
 assert.equal(chart.rows[0].sold,15);assert.equal(chart.rows[0].share,12.5);assert.equal(chart.rows.reduce((sum,row)=>sum+row.sold,0),120);
 assert.ok(Math.abs(chart.rows.reduce((sum,row)=>sum+row.share,0)-100)<1e-9);
 const html=salesShareDonut(shares,String);assert.equal((html.match(/data-sales-share /g)||[]).length,11);assert.ok(html.includes('기타 (5개 옵션)'));assert.ok(html.includes('data-percent="12.5%"'));
});

test('yesterday versus two days ago compares option units and excludes sites missing either day',async()=>{
 const {compareDailySales}=await import('../public/sales-changes.js');
 const sites=[{id:'a',name:'카페24'},{id:'b',name:'쿠팡윙'}],current='2026-11-04',previous='2026-11-03';
 const entries=(red,pouch)=>[{sku:'cabin-20-red',sold:red},{sku:'pouch-set',sold:pouch}];
 const report=compareDailySales([{day:previous,site_id:'a',entries:entries(12,0)},{day:current,site_id:'a',entries:entries(7,10)},{day:current,site_id:'b',entries:entries(100,100)}],sites,current,previous);
 assert.equal(report.comparedSites.length,1);assert.equal(report.currentTotal,17);assert.equal(report.previousTotal,12);
 const red=report.options.find(o=>o.id==='cabin-20-red');assert.equal(red.delta,-5);assert.equal(red.previous,12);assert.equal(red.current,7);assert.equal(red.percent,-41.7);
 const pouch=report.options.find(o=>o.id==='pouch-set');assert.equal(pouch.delta,10);assert.equal(pouch.percent,null);
 assert.equal(compareDailySales([],sites,current,previous).comparedSites.length,0);
 const zero=compareDailySales([{day:previous,site_id:'a',entries:entries(0,0)},{day:current,site_id:'a',entries:entries(0,0)}],sites,current,previous);assert.equal(zero.comparedSites.length,1);assert.ok(zero.options.every(o=>o.delta===0));
});

test('revenue impact ranks small expensive changes above larger cheap changes without a unit cutoff',async()=>{
 const {compareDailySales}=await import('../public/sales-changes.js');
 const rows=(day,cabin,pouch)=>({day,site_id:'a',entries:[{sku:'cabin-20-red',sold:cabin},{sku:'pouch-set',sold:pouch}]});
 const report=compareDailySales([rows('2026-11-03',10,0),rows('2026-11-04',8,6)], [{id:'a'}],'2026-11-04','2026-11-03');
 assert.equal(report.options[0].id,'cabin-20-red');assert.equal(report.options[0].revenueDelta,-318000);
 assert.equal(report.previousRevenue,1590000);assert.equal(report.currentRevenue,1445400);assert.equal(report.revenueDelta,-144600);assert.equal(report.revenuePercent,-9.1);
 assert.ok(report.insight.drivers[0].includes('318,000원'));
});

test('analysis explains a forty percent revenue loss, zero baseline and incomplete comparisons honestly',async()=>{
 const {analyzeSalesChanges,compareDailySales}=await import('../public/sales-changes.js');
 const report={comparedSites:[{id:'a'}],expectedSites:4,currentRevenue:6000000,previousRevenue:10000000,revenueDelta:-4000000,revenuePercent:-40,options:[{label:'카빈',previous:40,current:0,revenueDelta:-5000000},{label:'파우치',previous:0,current:10,revenueDelta:1000000}]};
 const insight=analyzeSalesChanges(report);assert.match(insight.title,/긴급/);assert.match(insight.summary,/4,000,000원 감소/);assert.match(insight.summary,/-40%/);assert.match(insight.drivers[0],/100%/);assert.ok(insight.actions.some(v=>v.includes('ROAS')));assert.ok(insight.actions.some(v=>v.includes('품절')));assert.ok(insight.actions.some(v=>v.includes('1\/4')));
 const empty=compareDailySales([],[{id:'a'}],'2026-11-04','2026-11-03');assert.equal(empty.revenuePercent,null);assert.equal(empty.insight.title,'비교 데이터 부족');
 const zero=analyzeSalesChanges({...report,currentRevenue:100,previousRevenue:0,revenueDelta:100,revenuePercent:null});assert.match(zero.summary,/계산하지 않습니다/);
});

test('home revenue comparison renders all changed options and automatic action summary',async()=>{
 const {compareDailySales,createSalesChanges}=await import('../public/sales-changes.js');
 const {officeCatalog}=await import('../public/office-catalog.js');
 const original=globalThis.document;globalThis.document={querySelector:()=>({outerHTML:''}),addEventListener(){}};
 try{
  const records=['2026-11-03','2026-11-04'].map((day,i)=>({day,site_id:'a',entries:officeCatalog.map(o=>({sku:o.id,sold:i?0:1}))}));
  const source=compareDailySales(records,[{id:'a'}],'2026-11-04','2026-11-03');
  const panel=createSalesChanges({api:async()=>source,escape:String,getUser:()=>({id:'tester'}),getToday:()=> '2026-11-05'});
  panel.render();await new Promise(resolve=>setTimeout(resolve,0));const html=panel.render();
  assert.match(html,/2일 전 매출/);assert.match(html,/자동 분석 요약/);assert.match(html,/ROAS/);assert.match(html,/연결되지 않아/);
  assert.equal((html.match(/class="sales-change-card /g)||[]).length,officeCatalog.length);assert.ok(!html.includes('5개 이상'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
 }finally{globalThis.document=original;}
});

test('home changes shows four primary cards and expands remaining revenue-ranked cards without refetching',async()=>{
 const {compareDailySales,createSalesChanges}=await import('../public/sales-changes.js');
 const {officeCatalog}=await import('../public/office-catalog.js');
 const original=globalThis.document;let click,fetches=0,expandedClass=false;
 const region={inert:true,classList:{toggle(name,value){assert.equal(name,'is-expanded');expandedClass=value;}}};
 const label={textContent:''},attrs={};const button={setAttribute(k,v){attrs[k]=v;},querySelector:()=>label};
 globalThis.document={querySelector:selector=>selector==='#sales-changes-more'?region:{outerHTML:''},addEventListener(type,fn){if(type==='click')click=fn;}};
 try{
  const source=compareDailySales(['2026-11-03','2026-11-04'].map((day,i)=>({day,site_id:'a',entries:officeCatalog.map(o=>({sku:o.id,sold:i?0:1}))})),[{id:'a'}],'2026-11-04','2026-11-03');
  const panel=createSalesChanges({api:async()=>{fetches++;return source;},escape:String,getUser:()=>({id:'tester'}),getToday:()=> '2026-11-05'});
  panel.render();await new Promise(resolve=>setTimeout(resolve,0));let html=panel.render();
  const count=part=>(part.match(/class="sales-change-card /g)||[]).length;
  assert.equal(count(html.split('id="sales-changes-more"')[0]),4);
  assert.match(html,/class="sales-change-remainder " inert/);assert.match(html,/aria-expanded="false"/);assert.match(html,/TOP 4/);
  assert.equal(count(html),officeCatalog.length);
  const event={target:{closest:selector=>selector==='[data-sales-changes-expand]'?button:null}};
  click(event);assert.equal(region.inert,false);assert.equal(expandedClass,true);assert.equal(attrs['aria-expanded'],'true');assert.equal(label.textContent,'TOP 4만 보기');
  assert.match(panel.render(),/class="sales-change-remainder is-expanded"/);
  click(event);assert.equal(region.inert,true);assert.equal(expandedClass,false);assert.equal(attrs['aria-expanded'],'false');assert.match(label.textContent,/펼쳐보기/);assert.equal(fetches,1);
  panel.clear();
 }finally{globalThis.document=original;}
});

test('cancellation growth alerts independently of revenue growth and includes stock, shipment, SMS and CS checks',async()=>{
 const {compareDailySales}=await import('../public/sales-changes.js');
 const rows=(day,sold,cancelled,refunded=0,site_id='a')=>({day,site_id,entries:[{sku:'cabin-20-red',sold,cancelled,refunded}]});
 const report=compareDailySales([rows('2026-11-03',10,1,1),rows('2026-11-04',20,5,1),rows('2026-11-04',999,999,0,'b')],[{id:'a'},{id:'b'}],'2026-11-04','2026-11-03');
 assert.equal(report.currentRevenue,3180000);assert.ok(report.revenueDelta>0);assert.equal(report.cancellation.previous,2);assert.equal(report.cancellation.current,6);assert.equal(report.cancellation.delta,4);assert.equal(report.cancellation.percent,200);assert.equal(report.cancellation.previousRate,20);assert.equal(report.cancellation.currentRate,30);assert.equal(report.cancellation.rateDelta,10);
 assert.match(report.insight.title,/매출 증가.*취소·환불 증가/);assert.match(report.cancellation.summary,/2개에서 어제 6개/);assert.equal(report.cancellation.drivers[0].id,'cabin-20-red');
 for(const keyword of ['품절','출고 지연','품절 안내 문자','발송 실패','CS','응대 시간'])assert.ok(report.insight.actions.some(action=>action.includes(keyword)),keyword);
 assert.match(report.insight.actions[0],/공통 사이트 1\/2/);
});

test('cancellation rate increase is flagged even when quantity is flat, while decreases do not trigger quantity growth',async()=>{
 const {compareDailySales}=await import('../public/sales-changes.js');
 const row=(day,sold,cancelled)=>({day,site_id:'a',entries:[{sku:'pouch-set',sold,cancelled,refunded:0}]});
 const report=compareDailySales([row('2026-11-03',100,10),row('2026-11-04',50,10)],[{id:'a'}],'2026-11-04','2026-11-03');
 assert.equal(report.cancellation.increased,false);assert.equal(report.cancellation.rateIncreased,true);assert.equal(report.cancellation.rateDelta,10);assert.match(report.insight.title,/취소·환불률 상승/);assert.match(report.cancellation.title,/취소·환불률이 상승/);
 const decline=compareDailySales([row('2026-11-03',100,10),row('2026-11-04',100,2)],[{id:'a'}],'2026-11-04','2026-11-03');assert.equal(decline.cancellation.increased,false);assert.equal(decline.cancellation.rateIncreased,false);assert.equal(decline.cancellation.actions.length,0);
});

test('zero baseline, zero sales and missing comparison data never invent cancellation percentages',async()=>{
 const {compareDailySales}=await import('../public/sales-changes.js');
 const row=(day,sold,cancelled)=>({day,site_id:'a',entries:[{sku:'pouch-set',sold,cancelled,refunded:0}]});
 const report=compareDailySales([row('2026-11-03',0,0),row('2026-11-04',0,3)],[{id:'a'}],'2026-11-04','2026-11-03');
 assert.equal(report.cancellation.delta,3);assert.equal(report.cancellation.percent,null);assert.equal(report.cancellation.previousRate,null);assert.equal(report.cancellation.currentRate,null);assert.equal(report.cancellation.rateDelta,null);assert.equal(report.cancellation.increased,true);assert.match(report.cancellation.summary,/증가율은 계산하지/);assert.ok(report.insight.actions.some(action=>action.includes('품절 안내 문자')));
 const missing=compareDailySales([row('2026-11-04',10,3)],[{id:'a'}],'2026-11-04','2026-11-03');assert.equal(missing.cancellation.increased,false);assert.equal(missing.insight.title,'비교 데이터 부족');
 assert.ok(!JSON.stringify(report).includes('NaN'));assert.ok(!JSON.stringify(report).includes('Infinity'));
});

test('home summary renders cancellation warning and customer notification checks alongside sales gains',async()=>{
 const {compareDailySales,createSalesChanges}=await import('../public/sales-changes.js');const original=globalThis.document;
 globalThis.document={querySelector:()=>({outerHTML:''}),addEventListener(){}};
 try{
  const source=compareDailySales(['2026-11-03','2026-11-04'].map((day,i)=>({day,site_id:'a',entries:[{sku:'pouch-set',sold:i?20:10,cancelled:i?3:1,refunded:0}]})),[{id:'a'}],'2026-11-04','2026-11-03');
  const panel=createSalesChanges({api:async()=>source,escape:String,getUser:()=>({id:'tester'}),getToday:()=> '2026-11-05'});panel.render();await new Promise(resolve=>setTimeout(resolve,0));const html=panel.render();
  assert.match(html,/sales-cancellation is-warning/);assert.match(html,/취소·환불이 늘고 있습니다/);assert.match(html,/품절 안내 문자/);assert.match(html,/CS 문의/);assert.match(html,/주문 건수가 아닌/);assert.match(html,/1개 → 3개/);assert.match(html,/10% → 15%/);assert.ok(!html.includes('NaN'));panel.clear();
 }finally{globalThis.document=original;}
});
