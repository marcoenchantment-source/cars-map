// Arrival sheet: trip summary, a 1–5 star rating with notes (saved to storage 'feedback'),
// "Copy trip report" for pasting to Claude, and Done back to the map.
import { formatClock, speedUnit } from './format.js';
import { buildTripReport } from './report.js';
import { saveFeedback } from './feedback.js';

const SHEET_ID = 'nav-arrival';
const MAX_NOTES = 1000;

function stat(ui, label, value, unit = '') {
  return ui.el(
    'div',
    { class: 'nav-arr-stat' },
    ui.el('span', { class: 'nav-arr-stat-label', text: label }),
    ui.el('span', { class: 'nav-arr-stat-value num' }, value, unit ? ui.el('small', { text: ` ${unit}` }) : null),
  );
}

async function copyText(text, fallbackBox, ui) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    ui.toast('Trip report copied. Paste it to Claude.', { tone: 'good' });
  } catch {
    fallbackBox.hidden = false;
    const area = fallbackBox.querySelector('textarea');
    area.value = text;
    area.focus();
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    ui.toast(copied ? 'Trip report copied.' : 'Select the text below and copy it.', { tone: copied ? 'good' : 'info' });
  }
}

export function createArrival(ctx, { internal, controller }) {
  const { ui, store, storage, config, mapView, geo } = ctx;

  function finish() {
    if (controller.isActive()) return; // a new drive already started
    const s = store.get();
    if (s.mode === 'navigate') store.set({ mode: 'explore' });
    if (s.destination) store.set({ destination: null });
    mapView.ready.then(() => {
      if (!controller.isActive()) mapView.setDestination(null);
    });
  }

  function render(body, api, info, state) {
    const { trip, destination } = info;
    const units = store.get().settings.units;
    const unit = speedUnit(units);
    const name = String(destination?.name ?? '').trim() || 'Your destination';
    const dist = geo.formatDistance(trip.distance, units);

    const stars = [1, 2, 3, 4, 5].map((n) =>
      ui.el('button', {
        type: 'button', class: 'nav-star', 'aria-label': `${n} star${n > 1 ? 's' : ''}`, 'aria-pressed': 'false',
        on: { click: () => setRating(n) },
      }, ui.icon('star', { size: 30 })),
    );
    function setRating(n) {
      state.rating = n;
      stars.forEach((b, i) => b.setAttribute('aria-pressed', String(i < n)));
    }
    const notes = ui.el('textarea', {
      class: 'input nav-arr-notes', rows: 3, maxlength: MAX_NOTES, placeholder: 'What worked? What went wrong? (optional)', 'aria-label': 'Notes about this drive',
      on: { input: (e) => (state.notes = e.target.value) },
    });
    const fallback = ui.el('div', { class: 'stack', hidden: true },
      ui.el('p', { class: 'small muted', text: 'Copying is blocked here. Press and hold the text, then choose Copy.' }),
      ui.el('textarea', { class: 'input nav-arr-report', rows: 8, readonly: true, 'aria-label': 'Trip report text' }),
    );
    const report = () => buildTripReport({
      ...info, rating: state.rating, notes: state.notes, units, appVersion: config.APP_VERSION, userAgent: navigator.userAgent,
    });

    body.append(
      ui.el('div', { class: 'nav-arr-hero' },
        ui.el('div', { class: 'nav-arr-flag' }, ui.icon('flag', { size: 28 })),
        ui.el('div', { class: 'nav-arr-place' },
          ui.el('strong', { text: name }),
          ui.el('span', { class: 'muted small', text: `Arrived ${formatClock(trip.endedAt)}${trip.simulated ? ' · demo drive' : ''}` }),
        ),
      ),
      ui.el('div', { class: 'nav-arr-grid' },
        stat(ui, 'Time', geo.formatDuration(trip.duration)),
        stat(ui, 'Distance', dist.value, dist.unit),
        stat(ui, 'Average', String(geo.speedForDisplay(trip.avgSpeed, units)), unit),
        stat(ui, 'Top speed', String(geo.speedForDisplay(trip.maxSpeed, units)), unit),
      ),
      ui.el('h3', { class: 'section-title', text: 'Rate this drive' }),
      ui.el('div', { class: 'nav-stars', role: 'group', 'aria-label': 'Rating' }, stars),
      notes,
      ui.el('button', { type: 'button', class: 'btn btn-ghost btn-block', on: { click: () => copyText(report(), fallback, ui) } },
        ui.icon('copy', { size: 20 }), 'Copy trip report'),
      fallback,
      ui.el('button', { type: 'button', class: 'btn btn-accent btn-block nav-arr-done', text: 'Done', on: { click: () => api.close() } }),
    );
  }

  function open(info) {
    const state = { rating: 0, notes: '' };
    const persist = () => {
      if (state.rating > 0 || state.notes.trim()) saveFeedback(storage, { ...info, rating: state.rating, notes: state.notes.slice(0, MAX_NOTES) });
    };
    ui.sheet.open({
      id: SHEET_ID,
      title: "You've arrived",
      render: (body, api) => render(body, api, info, state),
      onClose: () => {
        persist();
        finish();
      },
    });
  }

  internal.on('arrived', (info) => {
    try {
      open(info);
    } catch (err) {
      console.error('[nav] arrival sheet failed', err);
      ui.toast("You've arrived.", { tone: 'good' });
    }
  });
}
