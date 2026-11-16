// The Grid floor: one tile of thin glowing lines that the 'grid' style layer repeats over the
// land (style.js). Each tile has a bright edge line with a soft halo, plus three faint lines
// between, so the floor reads as big squares split into smaller ones, brighter where lines cross.
import { PALETTES } from './style.js';

export const GRID_TILE = 128; // css px
const MINOR_LINES = [32, 64, 96];

/**
 * Draw one theme's tile.
 * @param {'light'|'dark'} theme
 * @param {number} ratio device pixels per css pixel
 * @returns {ImageData}
 */
export function drawGridTile(theme, ratio = 1) {
  const p = PALETTES[theme] ?? PALETTES.light;
  const px = Math.round(GRID_TILE * ratio);
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(px, px)
    : Object.assign(document.createElement('canvas'), { width: px, height: px });
  const g = canvas.getContext('2d');
  g.scale(ratio, ratio);
  g.fillStyle = p.grid;
  const line = (pos, width, alpha) => {
    g.globalAlpha = alpha;
    g.fillRect(pos - width / 2, 0, width, GRID_TILE);
    g.fillRect(0, pos - width / 2, GRID_TILE, width);
  };
  for (const pos of MINOR_LINES) line(pos, 0.9, p.gridAlpha * 0.4);
  // The main line sits on the tile edge, half on each side, so neighbouring tiles join it up.
  for (const pos of [0, GRID_TILE]) {
    line(pos, 6, p.gridAlpha * 0.16);
    line(pos, 1.6, p.gridAlpha);
  }
  return g.getImageData(0, 0, px, px);
}

/** Give the map both themes' tiles, now and whenever the style asks for one it lacks. */
export function installGrid(map) {
  const ratio = Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
  const themeOf = (id) => Object.keys(PALETTES).find((t) => PALETTES[t].gridImage === id);
  const add = (theme) => {
    const id = PALETTES[theme].gridImage;
    if (map.hasImage(id)) return;
    try {
      map.addImage(id, drawGridTile(theme, ratio), { pixelRatio: ratio });
    } catch (err) {
      console.warn('[map] grid floor unavailable', err?.message); // the map still works without it
    }
  };
  const addAll = () => Object.keys(PALETTES).forEach(add);
  map.on('style.load', addAll);
  map.on('styleimagemissing', (e) => {
    const theme = themeOf(e?.id);
    if (theme) add(theme);
  });
  if (map.isStyleLoaded()) addAll();
}
