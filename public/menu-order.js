export const menuPages = Object.freeze(['오늘', '업무', '공용 달력', '수입', '사무실 재고', '판매 · 취소/환불', '채팅', '아카이브', '문서', '자료실', '사용자']);

export function normalizeMenuOrder(saved) {
  const known = Array.isArray(saved) ? saved.map(name=>name==='매뉴얼'?'문서':name==='입고 · 재고'?'수입':name).filter(name => menuPages.includes(name)) : [];
  return [...new Set([...known, ...menuPages])];
}

export function moveMenu(order, index, direction) {
  const result = [...order], target = index + direction;
  if (!Number.isInteger(index) || ![-1, 1].includes(direction) || index < 0 || index >= result.length || target < 0 || target >= result.length) return result;
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
