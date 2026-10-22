export type Theme = 'dark' | 'light';

/** Also read by public/theme-init.js, which applies the saved theme before first paint. */
export const THEME_KEY = 'videoadjust-theme';

// Matches --bg in tokens.css, so the browser chrome follows the page.
const THEME_COLOR: Record<Theme, string> = { dark: '#0e0f0d', light: '#f6f7f2' };

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err: unknown) {
    // The switch still works for this page; the choice is not remembered.
    console.warn('could not save the theme choice', err);
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

/** Wires the header switch: checked means light, unchecked the dark default. */
export function mountThemeSwitch(button: HTMLButtonElement): void {
  const sync = (theme: Theme) => {
    applyTheme(theme);
    button.setAttribute('aria-checked', String(theme === 'light'));
  };
  sync(savedTheme());
  button.addEventListener('click', () => {
    const next: Theme = button.getAttribute('aria-checked') === 'true' ? 'dark' : 'light';
    sync(next);
    saveTheme(next);
  });
}
