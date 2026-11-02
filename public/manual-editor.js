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
export function createManualEditor(root){
 let blocks=[],preview=false;
 const options=type=>Object.entries(blockTypes).map(([key,label])=>`<option value="${key}" ${key===type?'selected':''}>${label}</option>`).join('');
 function draw(focus=-1){
 root.innerHTML=`<div class="manual-toolbar"><label>블록 추가<select data-add-type aria-label="추가할 블록 종류">${options('text')}</select></label><button type="button" data-action="add">＋ 추가</button><button type="button" data-action="preview" aria-pressed="${preview}">${preview?'편집으로 돌아가기':'읽기 미리보기'}</button></div><p class="manual-help">블록 종류를 바꾸거나 위·아래로 옮길 수 있어요. 목록은 한 줄에 한 항목씩 입력하세요.</p><div class="manual-blocks">${preview?`<article class="manual-preview">${renderManual(blocks)}</article>`:blocks.map((b,i)=>`<section class="manual-block" data-index="${i}"><div class="manual-block-tools"><select data-field="type" aria-label="${i+1}번 블록 종류">${options(b.type)}</select><button type="button" data-action="up" aria-label="${i+1}번 블록 위로 이동" ${i===0?'disabled':''}>↑</button><button type="button" data-action="down" aria-label="${i+1}번 블록 아래로 이동" ${i===blocks.length-1?'disabled':''}>↓</button><button type="button" data-action="remove" aria-label="${i+1}번 블록 삭제">삭제</button></div>${b.type==='divider'?'<hr>':b.type==='table'?`<div class="manual-table-scroll"><table>${(b.rows||[]).map((r,y)=>`<tr>${r.map((c,x)=>`<td><input data-row="${y}" data-col="${x}" aria-label="${y+1}행 ${x+1}열" value="${esc(c)}"></td>`).join('')}</tr>`).join('')}</table></div><div class="manual-table-tools"><button type="button" data-action="row">＋ 행</button><button type="button" data-action="col">＋ 열</button><button type="button" data-action="remove-row">마지막 행 삭제</button><button type="button" data-action="remove-col">마지막 열 삭제</button><small>첫 행은 표 머리글 · 최대 30행, 10열</small></div>`:`${b.type==='check'?`<label class="manual-check"><input type="checkbox" data-field="checked" ${b.checked?'checked':''}>완료</label>`:''}<textarea data-field="text" class="manual-block-input manual-${b.type}" aria-label="${i+1}번 ${blockTypes[b.type]}" placeholder="${b.type==='toggle'?'접을 내용의 제목':blockTypes[b.type]+' 입력'}">${esc(b.text)}</textarea>${b.type==='toggle'?`<details open><summary>접을 내용 편집</summary><textarea data-field="body" aria-label="토글 펼친 내용" placeholder="펼쳤을 때 보일 내용을 입력하세요.">${esc(b.body||'')}</textarea></details>`:''}`}</section>`).join('')}</div>`;
 if(focus>=0)root.querySelector(`[data-index="${focus}"] textarea, [data-index="${focus}"] input`)?.focus();
 }
 function update(e){const section=e.target.closest('[data-index]');if(!section)return;const b=blocks[Number(section.dataset.index)],t=e.target;if(t.dataset.row!==undefined)b.rows[+t.dataset.row][+t.dataset.col]=t.value;else if(t.dataset.field&&t.dataset.field!=='type')b[t.dataset.field]=t.type==='checkbox'?t.checked:t.value;}
 root.addEventListener('input',update);
 root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.dataset.row!==undefined)e.preventDefault();});
 root.addEventListener('change',e=>{update(e);if(e.target.dataset.field==='type'){const b=blocks[+e.target.closest('[data-index]').dataset.index];b.type=e.target.value;if(b.type==='table'&&!b.rows)b.rows=[['',''],['','']];draw();}});
 root.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,index=Number(button.closest('[data-index]')?.dataset.index),b=blocks[index];
 if(action==='add'){if(blocks.length>=200){alert('블록은 최대 200개까지 추가할 수 있습니다.');return;}const type=root.querySelector('[data-add-type]').value;blocks.push({type,text:'',...(type==='table'?{rows:[['',''],['','']]}:{})});preview=false;draw(blocks.length-1);return;}
 if(action==='preview'){preview=!preview;draw();return;}
 if(action==='up'&&index>0)[blocks[index-1],blocks[index]]=[blocks[index],blocks[index-1]];
 if(action==='down'&&index<blocks.length-1)[blocks[index+1],blocks[index]]=[blocks[index],blocks[index+1]];
 if(action==='remove'){if((b.text||b.body||b.rows?.some(r=>r.some(Boolean)))&&!confirm('이 블록을 삭제할까요?'))return;blocks.splice(index,1);if(!blocks.length)blocks.push({type:'text',text:''});}
 if(action==='row'&&b.rows.length<30)b.rows.push(b.rows[0].map(()=>''));
 if(action==='col'&&b.rows[0].length<10)b.rows.forEach(r=>r.push(''));
 if(action==='remove-row'&&b.rows.length>1){if(b.rows.at(-1).some(Boolean)&&!confirm('내용이 있는 마지막 행을 삭제할까요?'))return;b.rows.pop();}
 if(action==='remove-col'&&b.rows[0].length>1){if(b.rows.some(r=>r.at(-1))&&!confirm('내용이 있는 마지막 열을 삭제할까요?'))return;b.rows.forEach(r=>r.pop());}
 draw();
 });
 return {load(content){blocks=parseManual(content);preview=false;draw();},serialize(){return serializeManual(blocks);}};
}
