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
