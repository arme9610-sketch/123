import {salesTotals,cancellationRate} from './sales-math.js';
export function shiftDate(day,offset){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export function summarizeSales(records,today){
 const end=shiftDate(today,-1);
 return {today,end,periods:[1,7,30].map(days=>{
  const start=shiftDate(today,-days),selected=records.filter(r=>r.day>=start&&r.day<=end),totals=salesTotals(selected.flatMap(r=>r.entries));
  const enteredDays=new Set(selected.map(r=>r.day)).size;
  return {days,start,end,enteredDays,enteredSites:selected.length,expectedSites:days*4,sold:totals.sold,cancelled:totals.cancelled,rate:cancellationRate(totals.sold,totals.cancelled),averageSold:enteredDays?Math.round(totals.sold/enteredDays*10)/10:null,averageCancelled:enteredDays?Math.round(totals.cancelled/enteredDays*10)/10:null};
 })};
}
