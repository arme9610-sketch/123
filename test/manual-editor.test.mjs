import test from 'node:test';
import assert from 'node:assert/strict';
import {parseManual,normalizeManualBlocks,serializeManual,manualText,renderManual} from '../public/manual-editor.js';
test('legacy text is preserved, including HTML-looking content',()=>{const original='<script>alert(1)</script>\n업무 절차';assert.deepEqual(parseManual(original),[{type:'text',text:original}]);assert.equal(manualText(original),original);assert.ok(!renderManual(parseManual(original)).includes('<script>'));});
test('all block types survive save/reopen and remain searchable as text',()=>{const blocks=[{type:'h1',text:'포장 안내'},{type:'toggle',text:'주의사항',body:'완충재 3겹'},{type:'table',text:'',rows:[['상품','수량'],['캐리어','2']]},{type:'check',text:'검수',checked:true},{type:'divider',text:''}];const saved=serializeManual(blocks);assert.deepEqual(parseManual(saved),blocks);assert.match(manualText(saved),/완충재 3겹/);assert.match(manualText(saved),/캐리어 2/);assert.match(renderManual(blocks),/<details>/);assert.match(renderManual(blocks),/<th>상품<\/th>/);});
test('malformed structured data falls back to literal text safely',()=>{for(const value of ['DAYON_BLOCKS_V1\n{','DAYON_BLOCKS_V1\n[{"type":"script","text":"bad"}]','DAYON_BLOCKS_V1\n[{"type":"table","text":"","rows":[[{}]]}]'])assert.equal(manualText(value),value);});
test('reject empty documents and storage overflow',()=>{assert.throws(()=>serializeManual([{type:'divider',text:''}]),/내용/);assert.throws(()=>serializeManual([{type:'text',text:'가'.repeat(20000)}]),/너무/);});
test('all rendered text, toggle bodies and table cells are escaped',()=>{const html=renderManual([{type:'toggle',text:'<img onerror=x>',body:'<svg onload=x>'},{type:'table',text:'',rows:[['<script>']]},{type:'number',text:'<iframe>\n둘째'}]);assert.ok(!/<(img|svg|script|iframe)/.test(html));assert.match(html,/&lt;script&gt;/);assert.match(html,/<ol>/);});

test('existing multiline blocks become independent paragraphs without changing their words',()=>{
 const original=[{type:'text',text:'첫째\n둘째\n\n넷째'},{type:'bullet',text:'목록 1\n목록 2'}];
 const result=normalizeManualBlocks(original);assert.equal(result.length,6);assert.deepEqual(result.map(b=>b.text),['첫째','둘째','','넷째','목록 1','목록 2']);assert.equal(original.length,2);
 assert.equal(manualText(serializeManual(result)),'첫째\n둘째\n\n넷째\n목록 1\n목록 2');
});
test('legacy toggle bodies migrate to editable children and nested blocks survive reopening',()=>{
 const blocks=normalizeManualBlocks([{type:'toggle',text:'반품 안내',body:'접수 절차\n주의사항'}]);
 assert.deepEqual(blocks[0].children,[{type:'text',text:'접수 절차'},{type:'text',text:'주의사항'}]);assert.ok(!('body' in blocks[0]));
 blocks[0].children[1]={type:'toggle',text:'추가 안내',children:[{type:'h2',text:'배송비'},{type:'text',text:'3000원'}]};
 const saved=serializeManual(blocks);assert.deepEqual(parseManual(saved),blocks);assert.match(manualText(saved),/3000원/);assert.match(renderManual(blocks),/<h2>배송비<\/h2>/);
});
test('explicit soft breaks and table cells stay within their blocks',()=>{
 const original=[{type:'text',text:'같은 문단\n부드러운 줄바꿈',softBreaks:true},{type:'table',text:'',rows:[['한 셀\n두 줄']]}];assert.deepEqual(normalizeManualBlocks(original),original);
});
test('nested content is escaped and child-only text makes a valid document',()=>{
 const blocks=[{type:'toggle',text:'',children:[{type:'text',text:'<script>alert(1)</script>'}]}];assert.deepEqual(parseManual(serializeManual(blocks)),blocks);assert.ok(!renderManual(blocks).includes('<script>'));
});
test('normalization does not discard an over-limit legacy toggle body',()=>{
 const blocks=normalizeManualBlocks([{type:'toggle',text:'보존',body:Array.from({length:201},(_,i)=>String(i)).join('\n')}]);assert.match(blocks[0].children.map(b=>b.text).join('\n'),/200$/);
});

test('images persist as inline images and legacy image links convert without executing HTML',()=>{
 const blocks=[{type:'image',text:'제품 <사진>',src:'/api/resources/abc-123/preview'}];
 const saved=serializeManual(blocks);assert.deepEqual(parseManual(saved),blocks);assert.match(manualText(saved),/제품 <사진>/);
 const html=renderManual(blocks);assert.match(html,/<img src="\/api\/resources\/abc-123\/preview"/);assert.match(html,/alt="제품 &lt;사진&gt;"/);assert.ok(!html.includes('<a '));
 const legacy=normalizeManualBlocks([{type:'text',text:'설명\n![사진](https://example.com/photo.png)\n/api/resources/abc-123/download'}]);
 assert.deepEqual(legacy.map(b=>b.type),['text','image','image']);assert.equal(legacy[2].src,'/api/resources/abc-123/preview');
 assert.match(renderManual([{type:'text',text:'https://example.com/photo.jpg'}]),/<img /);
 for(const src of ['javascript:alert(1)','data:image/svg+xml,bad','//evil.test/a.png','/api/resources/a/delete','https://example.com/a.svg'])assert.throws(()=>serializeManual([{type:'image',text:'사진',src}]));
});

test('image file uploads and pasted images appear in the editor and survive saving',async()=>{
 const {createManualEditor}=await import('../public/manual-editor.js');
 const originalDocument=globalThis.document,originalWindow=globalThis.window;
 const events=new Map(),root={innerHTML:'',addEventListener:(type,fn)=>events.set(type,fn),querySelectorAll:()=>[],querySelector:()=>null};let changes=0,uploads=0;
 globalThis.document={addEventListener(){}};globalThis.window={addEventListener(){}};
 try{
  const ui=createManualEditor(root,{onChange:()=>changes++,uploadImage:async()=>{uploads++;return '/api/resources/image-'+uploads+'/preview';}});
  ui.load('문서 내용');assert.match(root.innerHTML,/이미지 올리기/);
  events.get('change')({target:{type:'file',matches:()=>true,files:[{name:'상품.png',type:'image/png',size:100}],dataset:{}}});
  assert.throws(()=>ui.serialize(),/업로드/);await new Promise(r=>setImmediate(r));
  assert.match(root.innerHTML,/<img src="\/api\/resources\/image-1\/preview"/);assert.equal(parseManual(ui.serialize())[1].type,'image');
  let prevented=false;events.get('paste')({preventDefault(){prevented=true;},clipboardData:{files:[{name:'붙여넣기.png',type:'image/png',size:100}]}});
  await new Promise(r=>setImmediate(r));assert.equal(prevented,true);assert.equal(uploads,2);assert.equal(changes,2);
  const content=ui.serialize();ui.load(content);assert.match(root.innerHTML,/image-2\/preview/);
 }finally{globalThis.document=originalDocument;globalThis.window=originalWindow;}
});

test('image widths persist and render safely without inline styles',()=>{
 for(const width of [10,25,50,75,100]){
  const blocks=[{type:'image',text:'사진',src:'/api/resources/photo/preview',width}];
  assert.deepEqual(normalizeManualBlocks(parseManual(serializeManual(blocks))),blocks);
  assert.match(renderManual(blocks),new RegExp('class="manual-image-width-'+width+'"'));
  assert.ok(!renderManual(blocks).includes('style='));
 }
 for(const width of [0,9,101,-1,50.5,'50',NaN])assert.throws(()=>serializeManual([{type:'image',text:'사진',src:'/api/resources/photo/preview',width}]));
});

test('image size slider updates the document and reset restores automatic sizing',async()=>{
 const {createManualEditor}=await import('../public/manual-editor.js');
 const originalDocument=globalThis.document,originalWindow=globalThis.window,events=new Map();
 const img={className:''},label={textContent:''},section={dataset:{index:'0'},querySelector:selector=>selector==='.manual-image img'?img:label};let changes=0;
 const root={innerHTML:'',addEventListener:(type,fn)=>events.set(type,fn),querySelectorAll:()=>[],querySelector:()=>null};
 globalThis.document={addEventListener(){}};globalThis.window={addEventListener(){}};
 try{
  const ui=createManualEditor(root,{onChange:()=>changes++});ui.load(serializeManual([{type:'image',text:'사진',src:'/api/resources/photo/preview'}]));
  assert.match(root.innerHTML,/이미지 너비/);
  events.get('input')({target:{closest:()=>section,dataset:{field:'image-width'},value:'45'}});
  assert.equal(img.className,'manual-image-width-45');assert.equal(label.textContent,'45%');assert.equal(parseManual(ui.serialize())[0].width,45);assert.equal(changes,1);
  ui.load(ui.serialize());assert.match(root.innerHTML,/value="45"/);
  events.get('click')({target:{closest:()=>({dataset:{action:'image-original'},closest:()=>section})}});
  assert.equal(parseManual(ui.serialize())[0].width,undefined);assert.match(root.innerHTML,/>자동<\/output>/);assert.equal(changes,2);
 }finally{globalThis.document=originalDocument;globalThis.window=originalWindow;}
});
