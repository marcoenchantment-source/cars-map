// Music app links. The web app can open a music app or search page; it can't control playback.

export const MUSIC_APPS = Object.freeze({
  spotify: { label: 'Spotify', home: 'https://open.spotify.com/', search: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}` },
  youtube: { label: 'YouTube Music', home: 'https://music.youtube.com/', search: (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}` },
  apple: { label: 'Apple Music', home: 'https://music.apple.com/au/', search: (q) => `https://music.apple.com/au/search?term=${encodeURIComponent(q)}` },
});

const APP_ORDER = ['spotify', 'youtube', 'apple'];

/** URL for one app, searching `query` when given. Unknown apps fall back to Spotify. */
export function musicHref(app, query) {
  const a = MUSIC_APPS[app] ?? MUSIC_APPS.spotify;
  const q = typeof query === 'string' ? query.trim().slice(0, 120) : '';
  return q ? a.search(q) : a.home;
}

export function musicLabel(app) {
  return (MUSIC_APPS[app] ?? MUSIC_APPS.spotify).label;
}

/** One link per app (for the "which app?" chooser). */
export function musicChoices(query = null) {
  return APP_ORDER.map((app) => ({ label: MUSIC_APPS[app].label, href: musicHref(app, query), kind: 'web' }));
}
