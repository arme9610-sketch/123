export const salesSiteNames=Object.freeze(['카페24','쿠팡윙','스마트스토어','지오코리아']);
export function combineSalesEntry(e){return {sku:e.sku,sold:e.sold,cancelled:e.cancelled+e.refunded,refunded:0};}
export function salesTotals(entries){return entries.reduce((sum,e)=>({sold:sum.sold+e.sold,cancelled:sum.cancelled+e.cancelled+e.refunded}),{sold:0,cancelled:0});}
export function cancellationRate(sold,cancelled){return sold>0?Math.round(cancelled/sold*1000)/10:null;}
export function rateLabel(sold,cancelled){const rate=cancellationRate(sold,cancelled);return rate===null?'—':`${rate}%`;}
