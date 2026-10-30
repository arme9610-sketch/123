const basic=[['cream','크림화이트'],['black','트리플블랙'],['silver','스페이스실버'],['gray','다크그레이']];
const metron=[basic[0],['red','바토리레드'],['blue','글레이셔블루'],basic[2]];
export const officeCatalog=Object.freeze([
 ...[20,24,28].flatMap(size=>basic.map(([key,color])=>({id:`essential-${size}-${key}`,model:'에센셜',size:`${size}인치`,color,label:`에센셜 ${size}인치 ${color}`}))),
 ...[20,24,26].flatMap(size=>metron.map(([key,color])=>({id:`metron-${size}-${key}`,model:'메트론',size:`${size}인치`,color,label:`메트론 ${size}인치 ${color}`}))),
 ...[...basic,['red','바토리레드'],['blue','글레이셔블루'],['pink','던핑크']].map(([key,color])=>({id:`cabin-20-${key}`,model:'카빈',size:'20인치',color,label:`카빈 20인치 ${color}`})),
 {id:'pouch-set',model:'파우치세트',size:'단일상품',color:'단일',label:'파우치세트 (단일상품)'}
]);
export const officeOperations={return:'반품 입고',defective:'불량 입고',service:'A/S 입고',issue:'출고'};
export const officeBuckets={good:'정상 재고',returned:'반품 재고',service:'A/S 재고',defective:'불량 재고'};
export function stockBucket(operation,bucket='good'){return operation==='defective'?'defective':operation==='return'?'returned':operation==='service'?'service':bucket;}
