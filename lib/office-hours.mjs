import {isBusinessDay,seoulDate} from './business-days.mjs';
export function officeHours(now=new Date()) {
  const date=seoulDate(now);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(now));
  return {date,open:isBusinessDay(date)&&hour>=9&&hour<18};
}
