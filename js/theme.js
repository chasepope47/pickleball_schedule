const THEME_KEY = 'ss_theme';
const html      = document.documentElement;
const iconDark  = document.getElementById('themeIconDark');
const iconLight = document.getElementById('themeIconLight');

export function applyTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  iconDark.style.display  = theme === 'dark' ? 'block' : 'none';
  iconLight.style.display = theme === 'dark' ? 'none'  : 'block';
}

document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

try { applyTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { applyTheme('dark'); }
