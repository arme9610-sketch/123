import Holidays from 'date-holidays';
import KoreanLunarCalendar from 'korean-lunar-calendar';
import {seoulDate} from '../public/reminders.js';
export {seoulDate};
const calendar = new Holidays('KR'), cache = new Map();
export function nextDay(day, offset = 1) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0,10); }
function weekday(day) { return new Date(day + 'T12:00:00Z').getUTCDay(); }
function holidays(year) {
  if (cache.has(year)) return cache.get(year);
  const days = new Set();
  for (const holiday of calendar.getHolidays(year)) {
    if (holiday.type !== 'public' || /설날|추석|석가/.test(holiday.name)) continue;
    for (let day = seoulDate(holiday.start); day < seoulDate(holiday.end); day = nextDay(day)) days.add(day);
  }
  // Use Korean lunar conversion for the full three-day Seollal/Chuseok spans.
  const lunar = new KoreanLunarCalendar();
  for (const [month, day, span] of [[1,1,3],[4,8,1],[8,15,3]]) {
    if (!lunar.setLunarDate(year, month, day, false)) throw new Error('Unsupported Korean holiday year');
    const solar = lunar.getSolarCalendar();
    const center = `${solar.year}-${String(solar.month).padStart(2,'0')}-${String(solar.day).padStart(2,'0')}`;
    const dates = span === 3 ? [nextDay(center,-1),center,nextDay(center)] : [center];
    const substitute = dates.some(d => weekday(d) === 0 || days.has(d)) || (span === 1 && weekday(center) === 6);
    dates.forEach(d => days.add(d));
    if (substitute && year >= (span === 1 ? 2023 : 2014)) {
      let extra = nextDay(dates.at(-1));
      while ([0,6].includes(weekday(extra)) || days.has(extra)) extra = nextDay(extra);
      days.add(extra);
    }
  }
  // Announced national election holidays; newly announced temporary/company holidays
  // can be supplied as comma-separated ISO dates in MOA_HOLIDAYS.
  for (const day of ['2026-06-03','2028-04-12',...(process.env.MOA_HOLIDAYS || '').split(',')]) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days.add(day);
  cache.set(year,days); return days;
}
export function isBusinessDay(day) { return ![0,6].includes(weekday(day)) && !holidays(Number(day.slice(0,4))).has(day); }
