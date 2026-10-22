// Applies the saved theme before first paint. It is a same-origin file because the CSP
// (script-src 'self') blocks inline scripts. Dark is the default; storage that throws
// (private mode, blocked site data) also means dark. src/ui/theme.ts owns the toggle.
(function () {
  let theme = 'dark';
  try {
    if (localStorage.getItem('videoadjust-theme') === 'light') theme = 'light';
  } catch {
    // Storage is unavailable: keep the dark default.
  }
  document.documentElement.dataset.theme = theme;
  // Same values as THEME_COLOR in src/ui/theme.ts (each theme's --bg).
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f1ea' : '#121110');
})();
