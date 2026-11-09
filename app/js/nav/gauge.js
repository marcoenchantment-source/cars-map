// Speed gauge (#hud-left): a 270° arc that fills with speed, big numerals in the middle,
// plus a small "GPS weak" pill above it when the signal drops during a drive.
import { svgEl } from './arrows.js';
import { speedUnit } from './format.js';

// Arc from 135° (bottom-left) clockwise through the top to 45° (bottom-right), r = 40.
const ARC = 'M19.72 76.28A40 40 0 1 1 76.28 76.28';
const SCALE = { metric: 140, imperial: 90 };
const HOT = { metric: 110, imperial: 70 };

export function createGauge({ ui, geo }) {
  const host = document.getElementById('hud-left');
  const track = svgEl('path', { d: ARC, class: 'nav-gauge-track', pathLength: 100, fill: 'none' });
  const arc = svgEl('path', { d: ARC, class: 'nav-gauge-arc', pathLength: 100, fill: 'none', 'stroke-dasharray': '0 100' });
  const svg = svgEl('svg', { viewBox: '0 0 96 96', class: 'nav-gauge-svg', 'aria-hidden': 'true' }, track, arc);
  const value = ui.el('span', { class: 'nav-gauge-v num', text: '0' });
  const unit = ui.el('span', { class: 'nav-gauge-u', text: 'km/h' });
  const root = ui.el('div', { class: 'nav-gauge', role: 'img', 'aria-label': 'Speed 0 km/h', hidden: true }, svg, ui.el('div', { class: 'nav-gauge-read' }, value, unit));
  const gpsPill = ui.el('div', { class: 'nav-gps-pill', role: 'status', hidden: true }, ui.icon('locate', { size: 16 }), ui.el('span', { text: 'GPS weak' }));
  host?.append(gpsPill, root);
  let shown = -1;
  let shownUnits = '';

  return Object.freeze({
    setVisible(v) {
      root.hidden = !v;
      if (!v) gpsPill.hidden = true;
    },
    setGpsWeak(weak) {
      gpsPill.hidden = !weak || root.hidden;
    },
    update(mps, units = 'metric') {
      const u = units === 'imperial' ? 'imperial' : 'metric';
      const v = geo.speedForDisplay(mps, u);
      if (v === shown && u === shownUnits) return;
      shown = v;
      shownUnits = u;
      value.textContent = String(v);
      unit.textContent = speedUnit(u);
      const pct = Math.max(0, Math.min(100, (v / SCALE[u]) * 100));
      arc.style.strokeDasharray = `${pct.toFixed(1)} 100`; // style (not attribute) so CSS can animate it
      root.dataset.hot = String(v >= HOT[u]);
      root.setAttribute('aria-label', `Speed ${v} ${speedUnit(u)}`);
    },
  });
}
