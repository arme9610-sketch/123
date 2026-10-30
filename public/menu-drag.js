// Pointer events support mouse, pen and touch without a separate drag library.
export function enableMenuDrag(list, { onDrop, onCancel }) {
  const dialog = list.closest('dialog');
  let drag = null;
  function position() {
    if (!drag) return;
    const siblings = [...list.children].filter(row => row !== drag.row);
    const next = siblings.find(row => {
      const box = row.getBoundingClientRect();
      return drag.y < box.top + box.height / 2;
    });
    list.insertBefore(drag.row, next || null);
  }
  function scroll() {
    if (!drag) return;
    const box = dialog.getBoundingClientRect();
    const delta = drag.y < box.top + 75 ? -8 : drag.y > box.bottom - 75 ? 8 : 0;
    if (delta) { dialog.scrollTop += delta; position(); }
    drag.frame = requestAnimationFrame(scroll);
  }
  function finish(cancelled) {
    if (!drag) return;
    const current = drag;
    drag = null;
    cancelAnimationFrame(current.frame);
    current.row.classList.remove('is-dragging');
    if (list.hasPointerCapture(current.id)) list.releasePointerCapture(current.id);
    if (cancelled) onCancel();
    else onDrop([...list.children].map(row => row.dataset.menuName), current.name);
  }
  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-menu-drag]');
    if (!handle || drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const row = handle.closest('li');
    drag = { id: event.pointerId, row, name: row.dataset.menuName, y: event.clientY };
    row.classList.add('is-dragging');
    list.setPointerCapture(event.pointerId);
    drag.frame = requestAnimationFrame(scroll);
  });
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); drag.y = event.clientY; position();
  });
  list.addEventListener('pointerup', event => { if (event.pointerId === drag?.id) finish(false); });
  list.addEventListener('pointercancel', event => { if (event.pointerId === drag?.id) finish(true); });
  list.addEventListener('lostpointercapture', () => finish(true));
  dialog.addEventListener('close', () => finish(true));
  dialog.addEventListener('cancel', () => finish(true));
}
