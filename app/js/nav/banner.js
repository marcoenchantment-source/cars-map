// Manoeuvre banner (#nav-banner-slot): big flame arrow, huge distance, road name, "Then" chip,
// and a Re-routing state. Rebuilds the arrow only when the upcoming step changes.
import { arrowFor, svgEl } from './arrows.js';
import { shortLabel } from './maneuver.js';

const THEN_CHIP_M = 150;
const IMMINENT_M = 60;

function rerouteGlyph() {
  const ring = svgEl('path', {
    d: 'M24 8a16 16 0 1 1-14.4 9', fill: 'none', stroke: 'currentColor', 'stroke-width': 5, 'stroke-linecap': 'round',
  });
  const tip = svgEl('polygon', { points: '4,12 15,13 10,23', fill: 'currentColor' });
  return svgEl('svg', { viewBox: '0 0 48 48', width: 56, height: 56, class: 'nav-arrow-svg nav-spin', 'aria-hidden': 'true' }, ring, tip);
}

export function createBanner({ ui, geo }) {
  const slot = document.getElementById('nav-banner-slot');
  const arrowBox = ui.el('div', { class: 'nav-arrow' });
  const distV = ui.el('span', { class: 'nav-dist-v' });
  const distU = ui.el('span', { class: 'nav-dist-u' });
  const road = ui.el('div', { class: 'nav-road' });
  const thenArrow = ui.el('span', { class: 'nav-then-arrow' });
  const then = ui.el('div', { class: 'nav-then', hidden: true }, ui.el('span', { class: 'nav-then-label', text: 'Then' }), thenArrow);
  const live = ui.el('span', { class: 'sr-only', 'aria-live': 'polite' });
  const root = ui.el(
    'section',
    { class: 'nav-banner', 'aria-label': 'Next manoeuvre', hidden: true, dataset: { state: 'guide' } },
    arrowBox,
    ui.el('div', { class: 'nav-banner-text' }, ui.el('div', { class: 'nav-dist num' }, distV, distU), road),
    then,
    live,
  );
  slot?.append(root);
  let key = '';

  function showReroute() {
    if (key === 'reroute') return;
    key = 'reroute';
    root.dataset.state = 'reroute';
    root.dataset.imminent = 'false';
    ui.clear(arrowBox).append(rerouteGlyph());
    distV.textContent = 'Re-routing…';
    distU.textContent = '';
    road.textContent = 'Finding a new way from here';
    then.hidden = true;
    live.textContent = 'Re-routing';
  }

  function showStep(route, progress, destination) {
    const steps = route.steps;
    const step = steps[progress.stepIndex];
    if (!step) return;
    const k = `${route.id}:${progress.stepIndex}`;
    if (k === key) return;
    key = k;
    root.dataset.state = 'guide';
    ui.clear(arrowBox).append(arrowFor(step, { size: 60 }));
    const name = step.type === 'arrive' ? String(destination?.name ?? '').trim() || 'Destination' : step.road || shortLabel(step);
    road.textContent = name;
    const next = steps[progress.stepIndex + 1];
    const close = next && next.along - step.along < THEN_CHIP_M;
    then.hidden = !close;
    if (close) ui.clear(thenArrow).append(arrowFor(next, { size: 24, className: 'nav-then-svg' }));
    live.textContent = step.instruction;
  }

  return Object.freeze({
    setVisible(v) {
      root.hidden = !v;
      if (!v) key = '';
    },
    update({ route, progress, units, rerouting, destination }) {
      if (rerouting) return showReroute();
      if (!route || !progress) return;
      showStep(route, progress, destination);
      const d = geo.formatDistance(progress.distanceToManeuver, units);
      if (distV.textContent !== d.value) distV.textContent = d.value;
      if (distU.textContent !== d.unit) distU.textContent = d.unit;
      root.dataset.imminent = String(progress.distanceToManeuver < IMMINENT_M);
    },
  });
}
