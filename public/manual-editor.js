const PREFIX='DAYON_BLOCKS_V1\n';
export const blockTypes={text:'텍스트',h1:'제목 1',h2:'제목 2',h3:'제목 3',toggle:'토글',bullet:'글머리 기호 목록',number:'번호 목록',check:'체크리스트',quote:'인용문',callout:'콜아웃',divider:'구분선',table:'표',image:'이미지'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function manualImageSource(value){
 if(typeof value!=='string')return '';
 if(/^\/api\/resources\/[a-zA-Z0-9-]+\/(?:preview|download)$/.test(value))return value.replace(/\/download$/,'/preview');
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&/\.(png|jpe?g|webp|gif)$/i.test(url.pathname)?url.href:'';}catch{return '';}
}
function linkedImage(text){
 const value=text.trim(),match=value.match(/^!?\[([^\]]*)\]\(([^\s)]+)\)$/),src=manualImageSource(match?match[2]:value);
 return src?{type:'image',text:match?.[1]||'이미지',src}:null;
}
function imageMarkup(b){const src=manualImageSource(b.src);return src?`<figure class="manual-image"><img src="${esc(src)}" alt="${esc(b.text)}" class="${Number.isInteger(b.width)&&b.width>=10&&b.width<=100?'manual-image-width-'+b.width:''}" loading="lazy" referrerpolicy="no-referrer">${b.text?`<figcaption>${esc(b.text)}</figcaption>`:''}</figure>`:'<p class="privacy">이미지를 올려 주세요.</p>';}
const MAX_BLOCKS=200;
function validBlocks(blocks,depth=0,counter={value:0}){
 return depth<=12&&Array.isArray(blocks)&&blocks.every(b=>{
  if(++counter.value>MAX_BLOCKS||!b||!Object.hasOwn(blockTypes,b.type)||typeof b.text!=='string')return false;
  if(b.width!==undefined&&(!Number.isInteger(b.width)||b.width<10||b.width>100))return false;
  if(b.type==='image'&&(typeof b.src!=='string'||(b.src&&!manualImageSource(b.src))))return false;
  if(b.body!==undefined&&typeof b.body!=='string')return false;
  if(b.rows!==undefined&&(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>30||!b.rows.every(r=>Array.isArray(r)&&r.length>0&&r.length===b.rows[0].length&&r.length<=10&&r.every(c=>typeof c==='string'))))return false;
  return b.children===undefined||(b.type==='toggle'&&validBlocks(b.children,depth+1,counter));
 });
}
export function parseManual(content=''){
 if(content.startsWith(PREFIX)){try{const data=JSON.parse(content.slice(PREFIX.length));if(data.length&&validBlocks(data))return data;}catch{}}
 return [{type:'text',text:content}];
}
export function normalizeManualBlocks(source){
 function normalize(items){return items.flatMap(original=>{
  const b=JSON.parse(JSON.stringify(original));
  if(b.type==='text'){const image=linkedImage(b.text);if(image)return [image];}
  if(b.type==='toggle'){
   const lines=b.text.split(/\r?\n/);b.text=lines.shift();
   b.children=[...lines.map(text=>({type:'text',text})),...(b.body?b.body.split(/\r?\n/).map(text=>({type:'text',text})):[]),...normalize(b.children||[])];delete b.body;
   if(!b.children.length)b.children=[{type:'text',text:''}];return [b];
  }
  if(b.type==='image'||b.type==='table'||b.type==='divider'||b.softBreaks)return [b];
  return b.text.split(/\r?\n/).map(text=>b.type==='text'?(linkedImage(text)||{...b,text}):({...b,text}));
 });}
 const result=normalize(source);if(validBlocks(result))return result;
 function preserve(items){return items.map(original=>{const b=JSON.parse(JSON.stringify(original));if(b.type==='toggle'){b.children=[...(b.body?[{type:'text',text:b.body}]:[]),...preserve(b.children||[])];delete b.body;if(!b.children.length)b.children=[{type:'text',text:''}];}return b;});}
 return preserve(source);
}
function blocksText(blocks){return blocks.map(b=>[b.text,b.src,b.body,...(b.rows||[]).map(r=>r.join(' ')),b.children?blocksText(b.children):''].filter(Boolean).join('\n')).join('\n');}
export function manualText(content){return blocksText(parseManual(content));}
export function serializeManual(blocks){
 if(!validBlocks(blocks))throw new Error('문단은 200개, 토글 중첩은 12단계까지 저장할 수 있습니다. 문서를 나누어 주세요.');
 if(!blocksText(blocks).trim())throw new Error('매뉴얼 내용을 입력해 주세요.');
 const value=PREFIX+JSON.stringify(blocks);if(value.length>20000)throw new Error('내용이 너무 깁니다. 매뉴얼을 나누어 저장해 주세요.');return value;
}
export function renderManual(blocks){return blocks.map(b=>{
 const text=esc(b.text),body=esc(b.body||'');
 if(b.type==='image')return imageMarkup(b);
 if(b.type==='text'){const image=linkedImage(b.text);if(image)return imageMarkup(image);}
 if(/^h[123]$/.test(b.type))return `<${b.type}>${text}</${b.type}>`;
 if(b.type==='divider')return '<hr>';
 if(b.type==='toggle')return `<details><summary>${text||'토글'}</summary><div class="manual-lines">${body}${b.children?renderManual(b.children):''}</div></details>`;
 if(b.type==='table')return `<div class="manual-table-scroll"><table>${(b.rows||[]).map((r,i)=>`<tr>${r.map(c=>`<${i?'td':'th'}>${esc(c)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</table></div>`;
 if(b.type==='bullet'||b.type==='number'){const tag=b.type==='bullet'?'ul':'ol';return `<${tag}>${b.text.split('\n').map(t=>`<li>${esc(t)}</li>`).join('')}</${tag}>`;}
 if(b.type==='check')return `<p class="manual-lines">${b.checked?'☑':'☐'} ${text}</p>`;
 if(b.type==='quote')return `<blockquote class="manual-lines">${text}</blockquote>`;
 return `<p class="manual-lines ${b.type==='callout'?'manual-callout':''}">${text}</p>`;
 }).join('');}
export function createManualEditor(root,{onChange=()=>{},uploadImage}={}) {
 let blocks=[],preview=false,menu=null,dragPath=null,uploading=false,uploadEpoch=0;
 const expanded=new Set();
 const icons={text:'T',h1:'H1',h2:'H2',h3:'H3',toggle:'▸',bullet:'•',number:'1.',check:'☑',quote:'❞',callout:'☞',divider:'—',table:'▦',image:'▧'};
 function locate(path){const parts=String(path).split('.').map(Number);let siblings=blocks;for(const index of parts.slice(0,-1))siblings=siblings[index].children;const index=parts.at(-1);return {siblings,index,b:siblings[index]};}
 function pathFor(path,index){const parts=String(path).split('.');parts[parts.length-1]=index;return parts.join('.');}
 function count(items=blocks){return items.reduce((total,b)=>total+1+(b.children?count(b.children):0),0);}
 function notify(){onChange();}
 function resize(input){input.style.height='auto';input.style.height=input.scrollHeight+'px';}
 function focusBlock(path,position=null){const input=root.querySelector(`[data-index="${path}"] > .manual-block-content textarea, [data-index="${path}"] > .manual-block-content [data-row]`);input?.focus();if(position!==null&&input?.setSelectionRange)input.setSelectionRange(position,position);}
 function textInput(path,label,placeholder){return `<textarea rows="1" data-field="text" data-path="${path}" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" class="manual-block-input"></textarea>`;}
 function menuMarkup(path){
  if(menu?.path!==path)return '';
  const {siblings,index,b}=locate(path),adding=menu.mode==='add';
  return `<div class="manual-block-menu" role="menu" aria-label="${adding?'블록 추가':'블록 옵션'}"><p>${adding?'아래에 추가':'블록 종류 변경'}</p>${Object.entries(blockTypes).map(([type,label])=>`<button type="button" role="menuitem" data-action="${adding?'insert':'convert'}" data-type="${type}"><span>${icons[type]}</span>${label}${!adding&&b.type===type?'<small>✓</small>':''}</button>`).join('')}${adding?'':`<div class="manual-menu-actions"><button type="button" role="menuitem" data-action="up" ${index===0?'disabled':''}>↑ 위로 이동</button><button type="button" role="menuitem" data-action="down" ${index===siblings.length-1?'disabled':''}>↓ 아래로 이동</button><button type="button" role="menuitem" data-action="duplicate">복제</button><button type="button" role="menuitem" data-action="remove" class="manual-remove">삭제</button></div>`}</div>`;
 }
 function blockMarkup(b,path){
  let content='',children='';const label=path.split('.').map(n=>+n+1).join('-');
  if(b.type==='image')content=`${imageMarkup(b)}<div class="manual-image-size"><label>이미지 너비<input type="range" min="10" max="100" step="1" value="${b.width??100}" data-field="image-width" aria-label="${label}번 이미지 너비"></label><output data-image-width-label>${b.width?b.width+'%':'자동'}</output><button type="button" data-action="image-original">원본 크기</button></div>${textInput(path,`${label}번 이미지 설명`,'이미지 설명')}${uploadImage?`<label class="manual-image-upload">이미지 변경<input type="file" data-image-upload data-image-path="${path}" accept="image/png,image/jpeg,image/webp,image/gif" ${uploading?'disabled':''}></label>`:''}`;
  else if(b.type==='divider')content='<hr>';
  else if(b.type==='table')content=`<div class="manual-table-scroll"><table>${(b.rows||[['',''],['','']]).map((row,y)=>`<tr>${row.map((c,x)=>`<td><input data-row="${y}" data-col="${x}" aria-label="${y+1}행 ${x+1}열" value="${esc(c)}"></td>`).join('')}</tr>`).join('')}</table></div><div class="manual-table-tools"><button type="button" data-action="row">＋ 행</button><button type="button" data-action="col">＋ 열</button><button type="button" data-action="remove-row">마지막 행 삭제</button><button type="button" data-action="remove-col">마지막 열 삭제</button><small>첫 행은 머리글 · 최대 30행, 10열</small></div>`;
  else if(b.type==='toggle'){
   content=`<div class="manual-toggle-title"><button type="button" data-action="toggle" class="manual-toggle-arrow" aria-label="${label}번 토글 ${expanded.has(b)?'접기':'펼치기'}" aria-expanded="${expanded.has(b)}">${expanded.has(b)?'▾':'▸'}</button>${textInput(path,`${label}번 토글 제목`,'토글 제목')}</div>`;
   children=`<div class="manual-toggle-body" ${expanded.has(b)?'':'hidden'}>${(b.children||[]).map((child,i)=>blockMarkup(child,`${path}.${i}`)).join('')}<button type="button" class="manual-add-paragraph" data-action="append-child">＋ 토글 안에 문단 추가</button></div>`;
  }else content=`${b.type==='check'?`<input type="checkbox" data-field="checked" class="manual-checkbox" aria-label="${label}번 할 일 완료" ${b.checked?'checked':''}>`:''}${textInput(path,`${label}번 ${blockTypes[b.type]}`,b.type==='text'?'내용을 입력하세요. / 로 블록 선택':blockTypes[b.type]+' 입력')}`;
  return `<div class="manual-block manual-type-${b.type}" data-index="${path}"><div class="manual-block-gutter"><button type="button" data-action="add-menu" class="manual-block-add" aria-label="${label}번 문단 아래 블록 추가" aria-haspopup="menu" aria-expanded="${menu?.path===path&&menu.mode==='add'}">＋</button><button type="button" draggable="true" data-action="options-menu" class="manual-block-handle" aria-label="${label}번 문단 옵션" aria-haspopup="menu" aria-expanded="${menu?.path===path&&menu.mode==='options'}" title="클릭하여 종류 변경 · 끌어서 이동">⠿</button></div><div class="manual-block-content">${content}</div>${children}${menuMarkup(path)}</div>`;
 }
 function draw(focus=null){
  root.innerHTML=`<div class="manual-editor-view"><button type="button" data-action="preview" aria-pressed="${preview}">${preview?'편집으로 돌아가기':'읽기 미리보기'}</button>${uploadImage?`<label class="manual-image-upload">${uploading?'이미지 업로드 중…':'＋ 이미지 올리기'}<input type="file" data-image-upload accept="image/png,image/jpeg,image/webp,image/gif" ${uploading?'disabled':''}></label>`:''}</div>${preview?`<article class="manual-preview">${renderManual(blocks)}</article>`:`<div class="manual-blocks">${blocks.map((b,i)=>blockMarkup(b,String(i))).join('')}</div><button type="button" class="manual-add-paragraph" data-action="append">＋ 새 문단</button>`}`;
  root.querySelectorAll('textarea[data-path]').forEach(input=>{input.value=locate(input.dataset.path).b.text;resize(input);});
  if(focus!==null)focusBlock(focus);
 }
 function hideMenu(){menu=null;root.querySelector('.manual-block-menu')?.remove();root.querySelectorAll('[aria-haspopup="menu"]').forEach(b=>b.setAttribute('aria-expanded','false'));}
 function addBlock(path,type='text',inside=false){
  if(count()>=MAX_BLOCKS){alert('문단은 최대 200개까지 추가할 수 있습니다.');return;}
  let siblings,index,newPath;
  if(path===null){siblings=blocks;index=blocks.length;newPath=String(index);}
  else {const item=locate(path);siblings=inside?(item.b.children||=[]):item.siblings;index=inside?siblings.length:item.index+1;newPath=inside?`${path}.${index}`:pathFor(path,index);}
  const b={type,text:'',...(type==='image'?{src:''}:{}),...(type==='table'?{rows:[['',''],['','']]}:{}),...(type==='toggle'?{children:[{type:'text',text:''}]}:{})};
  if(type==='toggle'&&count()+2>MAX_BLOCKS)return;
  siblings.splice(index,0,b);if(type==='toggle')expanded.add(b);menu=null;preview=false;draw(newPath);notify();
 }
 function splitInput(path,value,start,end=start){
  const {siblings,index,b}=locate(path),lines=value.split(/\r?\n/);if(lines.length===1)return false;
  if(count()+lines.length-1>MAX_BLOCKS){alert('문단은 최대 200개까지 추가할 수 있습니다. 내용을 나누어 입력해 주세요.');return false;}
  b.text=lines[0];delete b.softBreaks;
  const type=['bullet','number','check'].includes(b.type)?b.type:'text';
  siblings.splice(index+1,0,...lines.slice(1).map(text=>({type,text})));
  const before=value.slice(0,start),line=before.split(/\r?\n/).length-1,position=before.split(/\r?\n/).at(-1).length;
  menu=null;draw(pathFor(path,index+line));focusBlock(pathFor(path,index+line),position);notify();return true;
 }
 function update(event){
  const input=event.target,section=input.closest('[data-index]');if(!section)return;
  const path=section.dataset.index,{b}=locate(path);
  if(input.dataset.field==='image-width'){const width=Number(input.value);if(!Number.isInteger(width)||width<10||width>100)return;b.width=width;const img=section.querySelector('.manual-image img');if(img)img.className='manual-image-width-'+width;section.querySelector('[data-image-width-label]').textContent=width+'%';notify();return;}
  if(input.dataset.row!==undefined)b.rows[+input.dataset.row][+input.dataset.col]=input.value;
  else if(input.dataset.field==='text'){
   if(!event.isComposing&&!b.softBreaks&&input.value.includes('\n')&&splitInput(path,input.value,input.selectionStart))return;
   b.text=input.value;
  }else if(input.dataset.field==='checked')b.checked=input.checked;
  if(input.tagName==='TEXTAREA')resize(input);notify();
 }
 root.addEventListener('input',update);
 root.addEventListener('compositionend',update);
 async function insertImage(file,path){
  if(!file||!uploadImage||uploading)return;
  if(!/^(image\/(png|jpeg|webp|gif))$/.test(file.type)||file.size>5*1024*1024){alert('PNG·JPG·WebP·GIF 이미지를 5MB 이하로 올려 주세요.');return;}
  if(path===undefined&&count()>=MAX_BLOCKS){alert('문단은 최대 200개까지 추가할 수 있습니다.');return;}
  const generation=uploadEpoch,target=path===undefined?null:locate(path).b;uploading=true;draw();
  try{
   const src=manualImageSource(await uploadImage(file));if(!src)throw new Error('이미지 주소를 확인해 주세요.');
   if(generation!==uploadEpoch)return;
   if(target){if(locate(path).b!==target)return;target.src=src;target.type='image';}
   else {if(count()>=MAX_BLOCKS)throw new Error('문단은 최대 200개까지 추가할 수 있습니다.');blocks.push({type:'image',text:file.name||'이미지',src});}
   preview=false;notify();
  }catch(error){if(generation===uploadEpoch)alert(error.message);}
  finally{if(generation===uploadEpoch){uploading=false;draw();}}
 }
 root.addEventListener('change',e=>{if(e.target.type==='checkbox')update(e);if(e.target.matches?.('[data-image-upload]'))insertImage(e.target.files?.[0],e.target.dataset.imagePath);});
 root.addEventListener('paste',e=>{
  const file=[...(e.clipboardData?.files||[])].find(file=>file.type.startsWith('image/'));if(file&&uploadImage){e.preventDefault();insertImage(file);return;}
  const input=e.target;if(input.dataset.field!=='text')return;
  const text=e.clipboardData.getData('text/plain');if(!text.includes('\n'))return;
  const value=input.value.slice(0,input.selectionStart)+text+input.value.slice(input.selectionEnd),position=input.selectionStart+text.length;
  e.preventDefault();splitInput(input.dataset.path,value,position);
 });
 root.addEventListener('keydown',e=>{
  if(e.key==='Escape'){hideMenu();return;}
  if(e.isComposing||e.keyCode===229)return;
  const input=e.target,section=input.closest('[data-index]');if(!section)return;
  const path=section.dataset.index,{siblings,index,b}=locate(path);
  if(e.key==='Enter'&&input.dataset.row!==undefined){e.preventDefault();return;}
  if(input.dataset.field!=='text')return;
  if(e.key==='/'&&!input.value){e.preventDefault();menu={path,mode:'options'};draw();root.querySelector('.manual-block-menu button')?.focus();return;}
  if(e.key==='Enter'&&e.shiftKey){b.softBreaks=true;return;}
  if(e.key==='Enter'){
   e.preventDefault();if(count()>=MAX_BLOCKS)return;
   const start=input.selectionStart,end=input.selectionEnd,rest=b.text.slice(end);b.text=b.text.slice(0,start);
   siblings.splice(index+1,0,{type:['bullet','number','check'].includes(b.type)?b.type:'text',text:rest});menu=null;const next=pathFor(path,index+1);draw(next);focusBlock(next,0);notify();
  }
  if(e.key==='Backspace'&&!input.value&&siblings.length>1&&!b.children?.some(child=>blocksText([child]).trim())){e.preventDefault();siblings.splice(index,1);menu=null;draw(pathFor(path,Math.max(0,index-1)));notify();}
 });
 root.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action,path=button.closest('[data-index]')?.dataset.index;
  if(action==='preview'){preview=!preview;menu=null;draw();return;}
  if(action==='append'){addBlock(null);return;}
  const {siblings,index,b}=locate(path);
  if(action==='add-menu'||action==='options-menu'){
   const mode=action==='add-menu'?'add':'options';menu=menu?.path===path&&menu.mode===mode?null:{path,mode};draw();if(menu)root.querySelector('.manual-block-menu button')?.focus();return;
  }
  if(action==='image-original'){delete b.width;draw();notify();return;}
  if(action==='insert'){addBlock(path,button.dataset.type);return;}
  if(action==='append-child'){addBlock(path,'text',true);return;}
  if(action==='toggle'){expanded.has(b)?expanded.delete(b):expanded.add(b);draw();return;}
  if(action==='convert'){
   const type=button.dataset.type;
   if(b.type==='toggle'&&type!=='toggle'&&b.children?.length){siblings.splice(index+1,0,...b.children);delete b.children;}
   if(type==='toggle'&&b.type!=='toggle'){
    if(count()>=MAX_BLOCKS)return;
    b.children=[{type:'text',text:b.body||''}];delete b.body;expanded.add(b);
   }
   b.type=type;if(type==='image'&&!b.src)b.src=manualImageSource(b.text);if(type==='table'&&!b.rows)b.rows=[[b.text,''],['','']];
  }
  if(action==='up'&&index>0)[siblings[index-1],siblings[index]]=[siblings[index],siblings[index-1]];
  if(action==='down'&&index<siblings.length-1)[siblings[index+1],siblings[index]]=[siblings[index],siblings[index+1]];
  if(action==='duplicate'){if(count()+count([b])>MAX_BLOCKS)return;siblings.splice(index+1,0,JSON.parse(JSON.stringify(b)));}
  if(action==='remove'){
   if(blocksText([b]).trim()&&!confirm('이 문단과 포함된 내용을 삭제할까요?'))return;
   siblings.splice(index,1);if(!siblings.length)siblings.push({type:'text',text:''});
  }
  if(action==='row'&&b.rows.length<30)b.rows.push(b.rows[0].map(()=>''));
  if(action==='col'&&b.rows[0].length<10)b.rows.forEach(r=>r.push(''));
  if(action==='remove-row'&&b.rows.length>1){if(b.rows.at(-1).some(Boolean)&&!confirm('내용이 있는 마지막 행을 삭제할까요?'))return;b.rows.pop();}
  if(action==='remove-col'&&b.rows[0].length>1){if(b.rows.some(r=>r.at(-1))&&!confirm('내용이 있는 마지막 열을 삭제할까요?'))return;b.rows.forEach(r=>r.pop());}
  menu=null;draw();notify();
 });
 document.addEventListener('pointerdown',e=>{if(menu&&!e.target.closest('.manual-block-menu,.manual-block-gutter'))hideMenu();});
 root.addEventListener('dragstart',e=>{if(!e.target.matches('[data-action="options-menu"]'))return;dragPath=e.target.closest('[data-index]').dataset.index;e.dataTransfer.setData('text/plain',dragPath);e.dataTransfer.effectAllowed='move';hideMenu();});
 root.addEventListener('dragover',e=>{if(dragPath===null||!e.target.closest('[data-index]'))return;e.preventDefault();root.querySelectorAll('.manual-drop-target').forEach(el=>el.classList.remove('manual-drop-target'));e.target.closest('[data-index]').classList.add('manual-drop-target');});
 root.addEventListener('drop',e=>{
  if(dragPath===null)return;e.preventDefault();const target=e.target.closest('[data-index]');
  if(target){const path=target.dataset.index;if(path!==dragPath&&!path.startsWith(dragPath+'.')){const source=locate(dragPath),destination=locate(path);const [b]=source.siblings.splice(source.index,1);destination.siblings.splice(destination.index,0,b);if(!source.siblings.length)source.siblings.push({type:'text',text:''});menu=null;draw();notify();}}
  dragPath=null;
 });
 root.addEventListener('dragend',()=>{dragPath=null;root.querySelectorAll('.manual-drop-target').forEach(el=>el.classList.remove('manual-drop-target'));});
 window.addEventListener('resize',()=>{if(!root.closest('[hidden]'))root.querySelectorAll('textarea').forEach(resize);});
 return {load(content){uploadEpoch++;uploading=false;blocks=normalizeManualBlocks(parseManual(content));expanded.clear();preview=false;menu=null;draw();},serialize(){if(uploading)throw new Error('이미지 업로드가 끝난 뒤 저장해 주세요.');return serializeManual(blocks);},snapshot(){return JSON.stringify(blocks);},layout(){root.querySelectorAll('textarea').forEach(resize);}};
}
