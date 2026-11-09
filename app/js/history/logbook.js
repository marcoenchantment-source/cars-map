// Logbook sheet: totals, every saved trip (tap to see it on the map, two-tap delete) and a
// small "peek" card in the bottom slot while a trip is shown. Place names are looked up lazily
// with the search module's reverseGeocode and cached into the trip.
import { bigDistance, tripPlaces, tripTotals, tripWhen } from './stats.js';
import { withPlaceNames } from './tripsModel.js';

const SHEET_ID = 'logbook';
const CONFIRM_MS = 3000;
const GEOCODE_GAP_MS = 1100; // public geocoders allow about one request a second
const GEOCODE_PER_OPEN = 12;

function placeName(place) {
  if (!place || typeof place !== 'object') return '';
  const name = typeof place.name === 'string' && place.name ? place.name : place.label;
  return typeof name === 'string' ? name : '';
}

export function createLogbook(ctx, tripStore, drivenLayer) {
  const { ui, store, geo } = ctx;
  const tried = new Set();
  let hints = new Map(); // trip id → hint element while the sheet is open
  let queueRunning = false;
  let peek = null;

  const units = () => store.get().settings.units;

  // ------------------------------------------------------------ lazy place names
  async function nameTrip(trip) {
    const last = trip.line[trip.line.length - 1];
    const from = trip.from ? '' : placeName(await ctx.actions.call('reverseGeocode', trip.line[0]));
    const to = trip.to ? '' : placeName(await ctx.actions.call('reverseGeocode', last));
    if (!from && !to) return;
    tripStore.update(trip.id, (t) => withPlaceNames(t, { from, to }));
    const hint = hints.get(trip.id);
    const updated = tripStore.get(trip.id);
    if (hint && updated) hint.textContent = tripPlaces(updated) || hint.textContent;
  }

  async function runQueue() {
    if (queueRunning || !ctx.actions.has('reverseGeocode') || !store.get().online) return;
    queueRunning = true;
    try {
      const todo = tripStore.list().filter((t) => (!t.from || !t.to) && !tried.has(t.id)).slice(0, GEOCODE_PER_OPEN);
      for (const trip of todo) {
        if (ui.sheet.currentId() !== SHEET_ID) break;
        tried.add(trip.id);
        try {
          await nameTrip(trip);
        } catch (err) {
          console.warn('[history] place lookup failed', err);
        }
        await new Promise((r) => setTimeout(r, GEOCODE_GAP_MS));
      }
    } finally {
      queueRunning = false;
    }
  }

  // ------------------------------------------------------------ peek card + map focus
  function closePeek() {
    if (!peek) return;
    peek.remove();
    peek = null;
    drivenLayer?.highlight(null);
  }

  function fitTrip(trip) {
    const bbox = geo.bboxOf(trip.line);
    const base = ctx.mapView.hudPadding();
    const peekTop = peek?.getBoundingClientRect().top;
    const bottom = Number.isFinite(peekTop) ? Math.max(base.bottom, window.innerHeight - peekTop + 24) : base.bottom;
    const padding = { ...base, bottom: Math.min(bottom, window.innerHeight * 0.55) };
    ctx.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding, maxZoom: 16, pitch: 0, bearing: 0, duration: ctx.mapView.reduceMotion ? 0 : 900,
    });
  }

  function showTrip(listed) {
    const trip = tripStore.get(listed.id) ?? listed; // names may have arrived since the row was drawn
    ui.sheet.close(SHEET_ID);
    closePeek();
    store.set({ follow: false });
    drivenLayer?.highlight(trip.id);
    const d = geo.formatDistance(trip.distance, units());
    peek = ui.el(
      'div',
      { class: 'trip-peek', role: 'region', 'aria-label': 'Trip on the map' },
      ui.el('span', { class: 'trip-peek-icon', 'aria-hidden': 'true' }, ui.icon('route', { size: 22 })),
      ui.el(
        'div',
        { class: 'trip-peek-text' },
        ui.el('strong', { text: tripWhen(trip.startedAt) }),
        ui.el('span', { class: 'num', text: `${d.text} · ${geo.formatDuration(trip.duration)}` }),
        tripPlaces(trip) ? ui.el('span', { class: 'trip-peek-places', text: tripPlaces(trip) }) : null,
      ),
      ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Logbook', on: { click: () => open() } }),
      ui.iconButton('close', 'Stop showing this trip', closePeek, { className: 'icon-btn trip-peek-close' }),
    );
    document.getElementById('bottom-slot')?.append(peek);
    requestAnimationFrame(() => fitTrip(trip));
  }

  // ------------------------------------------------------------ sheet
  function deleteButton(trip, onDeleted) {
    let armed = null;
    const btn = ui.el('button', {
      type: 'button', class: 'icon-btn trip-delete', 'aria-label': 'Delete trip', title: 'Delete trip',
      on: {
        click: (e) => {
          e.stopPropagation();
          if (armed) {
            clearTimeout(armed);
            tripStore.remove(trip.id);
            onDeleted();
            return;
          }
          btn.classList.add('is-armed');
          btn.setAttribute('aria-label', 'Tap again to delete this trip');
          btn.textContent = 'Delete?';
          armed = setTimeout(() => {
            armed = null;
            btn.classList.remove('is-armed');
            btn.setAttribute('aria-label', 'Delete trip');
            ui.clear(btn).append(ui.icon('trash', { size: 20 }));
          }, CONFIRM_MS);
        },
      },
    }, ui.icon('trash', { size: 20 }));
    return btn;
  }

  function tripRow(trip, rerender) {
    const d = geo.formatDistance(trip.distance, units());
    const hint = ui.el('span', { class: 'row-hint', text: tripPlaces(trip) || 'Finding place names…' });
    if (!ctx.actions.has('reverseGeocode') && !tripPlaces(trip)) hint.textContent = `Top speed ${geo.speedForDisplay(trip.maxSpeed, units())} ${units() === 'imperial' ? 'mph' : 'km/h'}`;
    hints.set(trip.id, hint);
    return ui.el(
      'div',
      { class: 'trip-row' },
      ui.el(
        'button',
        { type: 'button', class: 'row trip-main', on: { click: () => showTrip(trip) } },
        ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: tripWhen(trip.startedAt) }), hint),
        ui.el('span', { class: 'trip-meta' }, ui.el('span', { class: 'row-meta', text: d.text }), ui.el('span', { class: 'trip-dur', text: geo.formatDuration(trip.duration) })),
      ),
      deleteButton(trip, rerender),
    );
  }

  function stat(value, unit, label) {
    return ui.el(
      'div',
      { class: 'logbook-stat' },
      ui.el('span', { class: 'logbook-stat-value' }, value, unit ? ui.el('small', { text: ` ${unit}` }) : null),
      ui.el('span', { class: 'logbook-stat-label', text: label }),
    );
  }

  function emptyState() {
    return ui.el(
      'div',
      { class: 'card logbook-empty' },
      ui.el('span', { class: 'logbook-empty-icon', 'aria-hidden': 'true' }, ui.icon('history', { size: 34 })),
      ui.el('strong', { text: 'No trips yet' }),
      ui.el('p', { class: 'muted small', text: 'Your drives are saved here automatically, starting with your first trip. Every road you drive then glows on the map.' }),
    );
  }

  function render(body) {
    const scroll = body.scrollTop;
    ui.clear(body);
    hints = new Map();
    const trips = tripStore.list();
    const rerender = () => render(body);
    const s = store.get().settings;
    if (trips.length) {
      const t = tripTotals(trips);
      const driven = bigDistance(t.distance, units());
      const explored = bigDistance(t.uniqueKm * 1000, units());
      body.append(
        ui.el('div', { class: 'logbook-stats' }, stat(driven.value, driven.unit, 'Driven'), stat(String(t.count), '', t.count === 1 ? 'Trip' : 'Trips'), stat(explored.value, explored.unit, 'Roads explored')),
      );
    }
    body.append(
      ui.el('div', { class: 'list' }, ui.toggleRow({
        id: 'logbook-driven', label: 'Show roads I have driven', hint: 'A soft violet trail on the map',
        checked: s.showDrivenRoads,
        onChange: (v) => store.set((st) => ({ settings: { ...st.settings, showDrivenRoads: v } })),
      })),
    );
    if (!trips.length) {
      body.append(emptyState());
      return;
    }
    body.append(
      ui.el('p', { class: 'section-title', text: 'Trips' }),
      ui.el('div', { class: 'list' }, trips.map((trip) => tripRow(trip, rerender))),
      ui.el('p', { class: 'muted small', text: 'Trips are kept on this phone only. The oldest are removed when the logbook gets full.' }),
    );
    body.scrollTop = scroll;
  }

  function open() {
    closePeek();
    ui.sheet.open({
      id: SHEET_ID,
      title: 'Logbook',
      size: 'tall',
      render: (body) => {
        render(body);
        runQueue();
      },
      onClose: () => {
        hints = new Map();
      },
    });
  }

  store.select((s) => s.mode, (mode) => mode !== 'explore' && closePeek());
  document.addEventListener('carsmap:sheet', (e) => e.detail?.open && closePeek());

  return Object.freeze({ open });
}
