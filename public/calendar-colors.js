export const calendarColors=Object.freeze([
 ['default','기본 색상'],['blue','파랑'],['green','초록'],['purple','보라'],['pink','분홍'],
 ['orange','주황'],['yellow','노랑'],['red','빨강'],['gray','회색']
].map(([id,label])=>Object.freeze({id,label})));
export const validCalendarColor=value=>calendarColors.some(color=>color.id===value);
export const calendarColorClass=value=>validCalendarColor(value)&&value!=='default'?'calendar-color-'+value:'';
export const calendarColorOptions=value=>calendarColors.map(color=>`<option value="${color.id}" ${color.id===(value||'default')?'selected':''}>${color.label}</option>`).join('');

export function calendarColorPicker(value,{name='calendarColor',itemId=null}={}){
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return `<fieldset class="calendar-color-picker"><legend>표시 색상</legend><div class="calendar-color-choices">${calendarColors.map(color=>`<label class="calendar-color-choice"><input type="radio" name="${escape(name)}" value="${color.id}" ${color.id===(value||'default')?'checked':''} ${itemId===null?'':`data-calendar-color="${escape(itemId)}"`}><span class="calendar-color-chip calendar-chip-${color.id}" aria-hidden="true"></span><span>${color.label}</span></label>`).join('')}</div></fieldset>`;
}
