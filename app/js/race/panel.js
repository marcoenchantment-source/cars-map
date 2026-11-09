// Bottom-slot panels for track day: the lap timer while racing, and the recorder while
// driving the first lap of a new track. Text only via ui.el (textContent).
import { formatDelta, formatLap } from './laps.js';

const CONFIRM_MS = 3000;

/** Button that needs a second tap within 3 s; the first tap shows `armedText`. */
export function twoTapButton(ui, { text, armedText, className, onConfirm, label }) {
  let timer = null;
  const btn = ui.el('button', { type: 'button', class: className, text, 'aria-label': label ?? text });
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    btn.textContent = text;
    btn.classList.remove('is-armed');
    btn.setAttribute('aria-label', label ?? text);
  };
  btn.addEventListener('click', () => {
    if (timer) {
      reset();
      onConfirm();
      return;
    }
    btn.textContent = armedText;
    btn.classList.add('is-armed');
    btn.setAttribute('aria-label', armedText);
    timer = setTimeout(reset, CONFIRM_MS);
  });
  return btn;
}

function stat(ui, label) {
  const value = ui.el('span', { class: 'race-stat-value', text: '–:––.––' });
  return { node: ui.el('div', { class: 'race-stat' }, ui.el('span', { class: 'race-stat-label', text: label }), value), value };
}

/**
 * @returns {{node: HTMLElement, setClock(ms:number|null): void, setLaps(view): void}}
 */
export function createLapPanel(ui, { onEnd, demo = false, trackName = '' }) {
  const label = ui.el('span', { class: 'race-label', text: 'Cross the line to start' });
  const clock = ui.el('span', { class: 'race-clock', text: '0:00.0' });
  const last = stat(ui, 'Last');
  const best = stat(ui, 'Best');
  const delta = ui.el('span', { class: 'race-delta', hidden: true });
  const end = twoTapButton(ui, { text: 'End', armedText: 'Tap to end', className: 'btn race-end', label: 'End the session', onConfirm: onEnd });
  const node = ui.el(
    'div',
    { class: `race-panel${demo ? ' is-demo' : ''}`, role: 'region', 'aria-label': `Lap timer${trackName ? `, ${trackName}` : ''}` },
    ui.el('div', { class: 'race-now' }, label, clock),
    ui.el('div', { class: 'race-stats', 'aria-live': 'polite' }, last.node, best.node, delta),
    end,
  );
  return {
    node,
    setClock(ms) {
      clock.textContent = ms == null ? '0:00.0' : formatLap(ms, 1);
      clock.classList.toggle('is-idle', ms == null);
    },
    /** view = {count, last, best, delta, started, demo} */
    setLaps(view) {
      const lapNo = view.count + 1;
      label.textContent = view.started ? `${view.demo ? 'Demo · ' : ''}Lap ${lapNo}` : view.demo ? 'Demo · rolling to the line' : 'Cross the line to start';
      last.value.textContent = formatLap(view.last);
      best.value.textContent = formatLap(view.best);
      const hasDelta = Number.isFinite(view.delta);
      delta.hidden = !hasDelta;
      if (hasDelta) {
        delta.textContent = formatDelta(view.delta);
        delta.classList.toggle('is-faster', view.delta < 0);
        delta.classList.toggle('is-slower', view.delta >= 0);
        delta.setAttribute('aria-label', `${view.delta < 0 ? 'Faster' : 'Slower'} than best by ${Math.abs(view.delta / 1000).toFixed(2)} seconds`);
      }
    },
  };
}

/** Panel shown while recording a new track. */
export function createRecordPanel(ui, { onCancel, onFinish }) {
  const distance = ui.el('span', { class: 'race-clock', text: '0.00 km' });
  const hint = ui.el('span', { class: 'race-hint', text: 'Drive one full lap. It closes itself back at the start line.' });
  const finish = ui.el('button', { type: 'button', class: 'btn btn-accent race-finish', text: 'Finish', disabled: true, on: { click: () => onFinish() } });
  const cancel = twoTapButton(ui, { text: 'Cancel', armedText: 'Tap to cancel', className: 'btn race-end', label: 'Cancel recording', onConfirm: onCancel });
  const node = ui.el(
    'div',
    { class: 'race-panel race-record', role: 'region', 'aria-label': 'Recording a track' },
    ui.el('div', { class: 'race-now' }, ui.el('span', { class: 'race-label race-rec', text: 'Recording track' }), distance),
    ui.el('div', { class: 'race-stats' }, hint),
    ui.el('div', { class: 'race-actions' }, finish, cancel),
  );
  return {
    node,
    update({ meters, canFinish, units = 'metric' }) {
      distance.textContent = units === 'imperial' ? `${(meters / 1609.344).toFixed(2)} mi` : `${(meters / 1000).toFixed(2)} km`;
      finish.disabled = !canFinish;
    },
  };
}
