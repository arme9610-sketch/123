import {calendarEntries} from './calendar.js';
export function renderHomeCalendar(items,today,escape){
 const year=Number(today.slice(0,4)),month=Number(today.slice(5,7)),prefix=today.slice(0,7),start=new Date(Date.UTC(year,month-1,1)).getUTCDay(),days=new Date(Date.UTC(year,month,0)).getUTCDate();
 const events=calendarEntries(items),dates=new Set(events.map(event=>event.date)),count=events.filter(event=>event.date.startsWith(prefix)).length,todayCount=events.filter(event=>event.date===today).length;
 const cells=Array.from({length:Math.ceil((start+days)/7)*7},(_,index)=>{
  const day=index-start+1;if(day<1||day>days)return '<span class="mini-calendar-blank"></span>';
  const date=prefix+'-'+String(day).padStart(2,'0');return `<span class="${date===today?'mini-calendar-today':''} ${dates.has(date)?'mini-calendar-event':''}">${day}</span>`;
 }).join('');
 return `<button type="button" class="panel home-mini-calendar" data-page="공용 달력" aria-label="${escape(prefix)} 공용 달력 보기. 오늘 ${todayCount}개 일정"><div class="mini-calendar-copy"><span>일정이 한눈에</span><h2>공용 달력</h2><p>오늘 ${todayCount}개 일정 · 이번 달 ${count}개 일정</p><b>전체 달력 보기 <span aria-hidden="true">↗</span></b></div><div class="mini-calendar-month" aria-hidden="true"><h3>${year}년 ${month}월</h3><div class="mini-calendar-week">${['일','월','화','수','목','금','토'].map(day=>`<span>${day}</span>`).join('')}</div><div class="mini-calendar-days">${cells}</div></div></button>`;
}
