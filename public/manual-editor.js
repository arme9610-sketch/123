const PREFIX='DAYON_BLOCKS_V1\n';
export const blockTypes={text:'텍스트',h1:'제목 1',h2:'제목 2',h3:'제목 3',toggle:'토글',bullet:'글머리 기호 목록',number:'번호 목록',check:'체크리스트',quote:'인용문',callout:'콜아웃',divider:'구분선',table:'표'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function parseManual(content=''){
 if(content.startsWith(PREFIX)){try{const data=JSON.parse(content.slice(PREFIX.length));if(Array.isArray(data)&&data.length&&data.length<=200&&data.every(b=>b&&Object.hasOwn(blockTypes,b.type)&&typeof b.text==='string'&&(b.body===undefined||typeof b.body==='string')&&(b.rows===undefined||(Array.isArray(b.rows)&&b.rows.length>0&&b.rows.length<=30&&b.rows.every(r=>Array.isArray(r)&&r.length>0&&r.length===b.rows[0].length&&r.length<=10&&r.every(c=>typeof c==='string'))))))return data;}catch{}}
 return [{type:'text',text:content}];
}
export function manualText(content){return parseManual(content).map(b=>[b.text,b.body,...(b.rows||[]).map(r=>r.join(' '))].filter(Boolean).join('\n')).join('\n');}
export function serializeManual(blocks){
 if(!blocks.some(b=>b.text.trim()||b.body?.trim()||b.rows?.some(r=>r.some(c=>c.trim()))))throw new Error('매뉴얼 내용을 입력해 주세요.');
 const value=PREFIX+JSON.stringify(blocks);if(value.length>20000)throw new Error('내용이 너무 깁니다. 매뉴얼을 나누어 저장해 주세요.');return value;
}
export function renderManual(blocks){return blocks.map(b=>{
 const text=esc(b.text),body=esc(b.body||'');
 if(/^h[123]$/.test(b.type))return `<${b.type}>${text}</${b.type}>`;
 if(b.type==='divider')return '<hr>';
 if(b.type==='toggle')return `<details><summary>${text||'토글'}</summary><div class="manual-lines">${body}</div></details>`;
 if(b.type==='table')return `<div class="manual-table-scroll"><table>${(b.rows||[]).map((r,i)=>`<tr>${r.map(c=>`<${i?'td':'th'}>${esc(c)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</table></div>`;
 if(b.type==='bullet'||b.type==='number'){const tag=b.type==='bullet'?'ul':'ol';return `<${tag}>${b.text.split('\n').map(t=>`<li>${esc(t)}</li>`).join('')}</${tag}>`;}
 if(b.type==='check')return `<p class="manual-lines">${b.checked?'☑':'☐'} ${text}</p>`;
 if(b.type==='quote')return `<blockquote class="manual-lines">${text}</blockquote>`;
 return `<p class="manual-lines ${b.type==='callout'?'manual-callout':''}">${text}</p>`;
 }).join('');}
export function createManualEditor(root,{onChange=()=>{}}={}) {
 let blocks=[],preview=false,menu=null,dragIndex=null;
 const expanded=new Set();
 const icons={text:'T',h1:'H1',h2:'H2',h3:'H3',toggle:'▸',bullet:'•',number:'1.',check:'☑',quote:'❞',callout:'☞',divider:'—',table:'▦'};
 function notify(){onChange();}
 function resize(input){input.style.height='auto';input.style.height=input.scrollHeight+'px';}
 function focusBlock(index,field='text',position=null){
  const input=root.querySelector(`[data-index="${index}"] [data-field="${field}"], [data-index="${index}"] [data-row]`);
  input?.focus();if(position!==null&&input?.setSelectionRange)input.setSelectionRange(position,position);
 }
 function textInput(field,label,placeholder,extra=''){
  return `<textarea rows="1" data-field="${field}" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" class="manual-block-input ${extra}"></textarea>`;
 }
 function menuMarkup(i){
  if(menu?.index!==i)return '';
  const adding=menu.mode==='add';
  return `<div class="manual-block-menu" role="menu" aria-label="${adding?'블록 추가':'블록 옵션'}"><p>${adding?'아래에 추가':'블록 종류 변경'}</p>${Object.entries(blockTypes).map(([type,label])=>`<button type="button" role="menuitem" data-action="${adding?'insert':'convert'}" data-type="${type}"><span>${icons[type]}</span>${label}${!adding&&blocks[i].type===type?'<small>✓</small>':''}</button>`).join('')}${adding?'':`<div class="manual-menu-actions"><button type="button" role="menuitem" data-action="up" ${i===0?'disabled':''}>↑ 위로 이동</button><button type="button" role="menuitem" data-action="down" ${i===blocks.length-1?'disabled':''}>↓ 아래로 이동</button><button type="button" role="menuitem" data-action="duplicate">복제</button><button type="button" role="menuitem" data-action="remove" class="manual-remove">삭제</button></div>`}</div>`;
 }
 function blockMarkup(b,i){
  let content='';
  if(b.type==='divider')content='<hr>';
  else if(b.type==='table')content=`<div class="manual-table-scroll"><table>${(b.rows||[['',''],['','']]).map((row,y)=>`<tr>${row.map((c,x)=>`<td><input data-row="${y}" data-col="${x}" aria-label="${y+1}행 ${x+1}열" value="${esc(c)}"></td>`).join('')}</tr>`).join('')}</table></div><div class="manual-table-tools"><button type="button" data-action="row">＋ 행</button><button type="button" data-action="col">＋ 열</button><button type="button" data-action="remove-row">마지막 행 삭제</button><button type="button" data-action="remove-col">마지막 열 삭제</button><small>첫 행은 머리글 · 최대 30행, 10열</small></div>`;
  else if(b.type==='toggle')content=`<div class="manual-toggle-title"><button type="button" data-action="toggle" class="manual-toggle-arrow" aria-label="${i+1}번 토글 ${expanded.has(b)?'접기':'펼치기'}" aria-expanded="${expanded.has(b)}">${expanded.has(b)?'▾':'▸'}</button>${textInput('text',`${i+1}번 토글 제목`,'토글 제목')}</div><div class="manual-toggle-body" ${expanded.has(b)?'':'hidden'}>${textInput('body',`${i+1}번 토글 내용`,'펼쳤을 때 보일 내용을 입력하세요.')}</div>`;
  else content=`${b.type==='check'?`<input type="checkbox" data-field="checked" class="manual-checkbox" aria-label="${i+1}번 할 일 완료" ${b.checked?'checked':''}>`:''}${textInput('text',`${i+1}번 ${blockTypes[b.type]}`,b.type==='text'?'내용을 입력하세요. / 로 블록 선택':blockTypes[b.type]+' 입력')}`;
  return `<div class="manual-block manual-type-${b.type}" data-index="${i}"><div class="manual-block-gutter"><button type="button" data-action="add-menu" class="manual-block-add" aria-label="${i+1}번 문단 아래 블록 추가" aria-haspopup="menu" aria-expanded="${menu?.index===i&&menu.mode==='add'}">＋</button><button type="button" draggable="true" data-action="options-menu" class="manual-block-handle" aria-label="${i+1}번 문단 옵션" aria-haspopup="menu" aria-expanded="${menu?.index===i&&menu.mode==='options'}" title="클릭하여 종류 변경 · 끌어서 이동">⠿</button></div><div class="manual-block-content">${content}</div>${menuMarkup(i)}</div>`;
 }
 function draw(focus=-1){
  root.innerHTML=`<div class="manual-editor-view"><button type="button" data-action="preview" aria-pressed="${preview}">${preview?'편집으로 돌아가기':'읽기 미리보기'}</button></div>${preview?`<article class="manual-preview">${renderManual(blocks)}</article>`:`<div class="manual-blocks">${blocks.map(blockMarkup).join('')}</div><button type="button" class="manual-add-paragraph" data-action="append">＋ 새 문단</button>`}`;
  root.querySelectorAll('textarea[data-field]').forEach(input=>{input.value=blocks[+input.closest('[data-index]').dataset.index][input.dataset.field]||'';resize(input);});
  if(focus>=0)focusBlock(focus);
 }
 function hideMenu(){menu=null;root.querySelector('.manual-block-menu')?.remove();root.querySelectorAll('[aria-haspopup="menu"]').forEach(b=>b.setAttribute('aria-expanded','false'));}
 function addBlock(index,type='text'){
  if(blocks.length>=200){alert('블록은 최대 200개까지 추가할 수 있습니다.');return;}
  blocks.splice(index,0,{type,text:'',...(type==='table'?{rows:[['',''],['','']]}:{})});
  menu=null;preview=false;draw(index);notify();
 }
 function update(event){
  const input=event.target,section=input.closest('[data-index]');if(!section)return;
  const b=blocks[+section.dataset.index];
  if(input.dataset.row!==undefined)b.rows[+input.dataset.row][+input.dataset.col]=input.value;
  else if(input.dataset.field)b[input.dataset.field]=input.type==='checkbox'?input.checked:input.value;
  if(input.tagName==='TEXTAREA')resize(input);notify();
 }
 root.addEventListener('input',update);
 root.addEventListener('change',e=>{if(e.target.type==='checkbox')update(e);});
 root.addEventListener('keydown',e=>{
  if(e.key==='Escape'){hideMenu();return;}
  if(e.isComposing)return;
  const input=e.target,section=input.closest('[data-index]');if(!section)return;
  const index=+section.dataset.index,b=blocks[index];
  if(e.key==='Enter'&&input.dataset.row!==undefined){e.preventDefault();return;}
  if(input.dataset.field!=='text')return;
  if(e.key==='/'&&!input.value){e.preventDefault();menu={index,mode:'options'};draw();root.querySelector('.manual-block-menu button')?.focus();return;}
  if(e.key==='Enter'&&!e.shiftKey){
   e.preventDefault();if(blocks.length>=200)return;
   const start=input.selectionStart,end=input.selectionEnd,rest=b.text.slice(end);b.text=b.text.slice(0,start);
   blocks.splice(index+1,0,{type:['bullet','number','check'].includes(b.type)?b.type:'text',text:rest});menu=null;draw(index+1);focusBlock(index+1,'text',0);notify();
  }
  if(e.key==='Backspace'&&!input.value&&blocks.length>1){e.preventDefault();blocks.splice(index,1);menu=null;draw(Math.max(0,index-1));notify();}
 });
 root.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action,index=Number(button.closest('[data-index]')?.dataset.index),b=blocks[index];
  if(action==='add-menu'||action==='options-menu'){
   const mode=action==='add-menu'?'add':'options';menu=menu?.index===index&&menu.mode===mode?null:{index,mode};draw();
   if(menu)root.querySelector('.manual-block-menu button')?.focus();return;
  }
  if(action==='preview'){preview=!preview;menu=null;draw();return;}
  if(action==='append'){addBlock(blocks.length);return;}
  if(action==='insert'){addBlock(index+1,button.dataset.type);return;}
  if(action==='toggle'){expanded.has(b)?expanded.delete(b):expanded.add(b);draw();return;}
  if(action==='convert'){
   b.type=button.dataset.type;if(b.type==='table'&&!b.rows)b.rows=[[b.text,''],['','']];
   if(b.type==='toggle')expanded.add(b);
  }
  if(action==='up'&&index>0)[blocks[index-1],blocks[index]]=[blocks[index],blocks[index-1]];
  if(action==='down'&&index<blocks.length-1)[blocks[index+1],blocks[index]]=[blocks[index],blocks[index+1]];
  if(action==='duplicate'){if(blocks.length>=200)return;blocks.splice(index+1,0,JSON.parse(JSON.stringify(b)));}
  if(action==='remove'){
   if((b.text||b.body||b.rows?.some(r=>r.some(Boolean)))&&!confirm('이 문단을 삭제할까요?'))return;
   blocks.splice(index,1);if(!blocks.length)blocks.push({type:'text',text:''});
  }
  if(action==='row'&&b.rows.length<30)b.rows.push(b.rows[0].map(()=>''));
  if(action==='col'&&b.rows[0].length<10)b.rows.forEach(r=>r.push(''));
  if(action==='remove-row'&&b.rows.length>1){if(b.rows.at(-1).some(Boolean)&&!confirm('내용이 있는 마지막 행을 삭제할까요?'))return;b.rows.pop();}
  if(action==='remove-col'&&b.rows[0].length>1){if(b.rows.some(r=>r.at(-1))&&!confirm('내용이 있는 마지막 열을 삭제할까요?'))return;b.rows.forEach(r=>r.pop());}
  menu=null;draw();notify();
 });
 document.addEventListener('pointerdown',e=>{if(menu&&!e.target.closest('.manual-block-menu,.manual-block-gutter'))hideMenu();});
 root.addEventListener('dragstart',e=>{if(!e.target.matches('[data-action="options-menu"]'))return;dragIndex=+e.target.closest('[data-index]').dataset.index;e.dataTransfer.setData('text/plain',String(dragIndex));e.dataTransfer.effectAllowed='move';hideMenu();});
 root.addEventListener('dragover',e=>{if(dragIndex===null||!e.target.closest('[data-index]'))return;e.preventDefault();root.querySelectorAll('.manual-drop-target').forEach(el=>el.classList.remove('manual-drop-target'));e.target.closest('[data-index]').classList.add('manual-drop-target');});
 root.addEventListener('drop',e=>{if(dragIndex===null)return;e.preventDefault();const target=e.target.closest('[data-index]');if(target){const index=+target.dataset.index;blocks.splice(index,0,blocks.splice(dragIndex,1)[0]);menu=null;draw();notify();}dragIndex=null;});
 root.addEventListener('dragend',()=>{dragIndex=null;root.querySelectorAll('.manual-drop-target').forEach(el=>el.classList.remove('manual-drop-target'));});
 window.addEventListener('resize',()=>{if(!root.closest('[hidden]'))root.querySelectorAll('textarea').forEach(resize);});
 return {load(content){blocks=parseManual(content);if(!content.startsWith(PREFIX)&&content.includes('\n')&&content.split('\n').length<=200)blocks=content.split('\n').map(text=>({type:'text',text}));expanded.clear();preview=false;menu=null;draw();},serialize(){return serializeManual(blocks);},snapshot(){return JSON.stringify(blocks);},layout(){root.querySelectorAll('textarea').forEach(resize);}};
}
