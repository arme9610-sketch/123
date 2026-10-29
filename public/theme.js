(() => {
  const key = 'dayon-theme';
  const preference = matchMedia('(prefers-color-scheme: dark)');
  function read() { try { return localStorage.getItem(key); } catch { return null; } }
  function sync() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const path = dark ? 'M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z' : 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-label', dark ? '주간 모드로 전환' : '야간 모드로 전환');
      button.setAttribute('aria-pressed', String(dark));
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg><span>${dark ? '야간 모드' : '주간 모드'}</span>`;
    });
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#141416' : '#f5f5f7');
  }
  function apply(value) { document.documentElement.dataset.theme = value; sync(); }
  apply(['light','dark'].includes(read()) ? read() : preference.matches ? 'dark' : 'light');
  window.DayonTheme = { sync };
  document.addEventListener('DOMContentLoaded', sync);
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, next); } catch { /* Current-page mode still works. */ }
    apply(next);
  });
  preference.addEventListener('change', () => { if (!['light','dark'].includes(read())) apply(preference.matches ? 'dark' : 'light'); });
  window.addEventListener('storage', event => { if(event.key === key) apply(['light','dark'].includes(event.newValue) ? event.newValue : preference.matches ? 'dark' : 'light'); });
})();
