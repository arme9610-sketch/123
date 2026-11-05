import {calendarColorClass,calendarColorPicker} from './calendar-colors.js';
export function calendarEntries(items){
 return items.flatMap(item=>[
  {item,date:item.date,milestone:item.type==='inbound'?'인천 ETA':''},
  ...(item.type==='inbound'&&item.warehouseDate?[{item,date:item.warehouseDate,milestone:'창고 입고'}]:[])
 ]);
}
export function calendarDayItems(items,date){
 const events=calendarEntries(items).filter(e=>e.date===date),grouped=new Map();
 for(const event of events){if(!grouped.has(event.item.id))grouped.set(event.item.id,{item:event.item,milestones:[]});if(event.milestone)grouped.get(event.item.id).milestones.push(event.milestone);}
 return [...grouped.values()];
}
export function createCalendarDay({escape:esc,getItems,add,edit,remove,setColor}){
 const dialog=document.querySelector('#calendar-day-dialog');let selected='';
 function refresh(){if(!dialog.open||!selected)return;const rows=calendarDayItems(getItems(),selected);
  dialog.innerHTML=`<div class="dialog-title"><h2>${esc(selected)} 일정</h2><button type="button" data-calendar-close aria-label="날짜 일정 닫기">✕</button></div><p class="privacy">날짜 칸을 누르면 그날의 모든 일정을 확인하고 추가·수정·삭제할 수 있습니다.</p><button type="button" class="primary" data-calendar-add>＋ 이 날짜에 일정 추가</button><div class="calendar-day-items">${rows.length?rows.map(({item,milestones})=>`<article><div><b class="calendar-item-title ${calendarColorClass(item.calendarColor)}">${esc(item.title)}</b><small>${esc(({task:'업무',office:'사무실 입·출고',inbound:'수입',shipment:'발송',meeting:'일정'})[item.type])}${milestones.length?' · '+esc(milestones.join(' · ')):''} · ${esc(item.owner)} · ${item.done?'완료':'예정'}</small>${item.type==='inbound'?`<small>ETA ${esc(item.date)} · 창고 입고 ${esc(item.warehouseDate||'미정')}</small>`:''}</div><div>${calendarColorPicker(item.calendarColor,{name:"calendar-color-"+item.id,itemId:item.id})}<button type="button" data-calendar-edit="${item.id}">${item.done?'상세':'수정'}</button><button type="button" class="danger-button" data-calendar-delete="${item.id}">삭제</button></div></article>`).join(''):'<p class="empty">등록된 일정이 없습니다. 위 버튼으로 추가하세요.</p>'}</div>`;
 }
 function open(date){selected=date;if(!dialog.open)dialog.showModal();refresh();}
 document.addEventListener('click',e=>{const cell=e.target.closest('[data-calendar-day]');if(cell)open(cell.dataset.calendarDay);});
 document.addEventListener('keydown',e=>{const cell=e.target.closest('[data-calendar-day]');if(cell&&['Enter',' '].includes(e.key)){e.preventDefault();open(cell.dataset.calendarDay);}});
 dialog.addEventListener('change',async e=>{
  const select=e.target.closest('[data-calendar-color]');if(!select||!setColor)return;
  select.disabled=true;const group=select.closest?.('fieldset');if(group)group.disabled=true;try{await setColor(select.dataset.calendarColor,select.value);}finally{refresh();}
 });
 dialog.addEventListener('click',async e=>{
  if(e.target.closest('[data-calendar-close]'))dialog.close();
  if(e.target.closest('[data-calendar-add]')){dialog.close();add(selected);}
  const change=e.target.closest('[data-calendar-edit]');if(change){dialog.close();edit(change.dataset.calendarEdit);}
  const drop=e.target.closest('[data-calendar-delete]');if(drop){drop.disabled=true;await remove(drop.dataset.calendarDelete);refresh();}
 });
 return {refresh,clear(){selected='';dialog.close();}};
}
