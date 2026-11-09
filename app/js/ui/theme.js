// Resolves the light/dark look: by the sun at your position ("auto"), the phone setting,
// or a fixed choice. Writes data-theme on <html> and `theme` in the store.
import { solarElevation, dayOrNight } from '../core/sun.js';

const CHECK_EVERY_MS = 60_000;
const THEME_COLORS = { light: '#1d1b24', dark: '#1d1b24' };

function systemTheme() {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * @param {'auto'|'system'|'light'|'dark'} pref
 * @param {{lat:number,lng:number}|null} position
 * @param {'light'|'dark'|null} previous
 * @returns {'light'|'dark'}
 */
export function resolveTheme(pref, position, previous, now = new Date()) {
  if (pref === 'light' || pref === 'dark') return pref;
  if (pref === 'auto' && position) return dayOrNight(solarElevation(now, position.lat, position.lng), previous);
  if (pref === 'auto') {
    const h = now.getHours();
    return h >= 19 || h < 6 ? 'dark' : 'light';
  }
  return systemTheme();
}

export function initTheme({ store }) {
  const apply = () => {
    const { settings, position, theme } = store.get();
    const next = resolveTheme(settings.theme, position, theme);
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[next]);
    if (next !== theme) store.set({ theme: next });
  };
  apply();
  store.select((s) => s.settings.theme, apply);
  // First fix only: afterwards the minute timer is plenty.
  const off = store.select((s) => s.position, (pos) => {
    if (pos) {
      apply();
      off();
    }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  setInterval(apply, CHECK_EVERY_MS);
}
