// Long-press the map: drop a pin, name the spot, offer Directions / Save as Home or Work.
import { isAbort } from '../routing/http.js';
import { sanitizePlace } from './places.js';

const SHEET_ID = 'dropped-pin';

function pinElement() {
  const node = document.createElement('div');
  node.className = 'cm-pin-drop';
  node.setAttribute('aria-hidden', 'true');
  node.append(document.createElement('span'));
  return node;
}

export function createPinDrop(ctx, { services, memory, openPreview }) {
  const { ui, bus, store } = ctx;
  let marker = null;
  let controller = null;

  function removePin() {
    controller?.abort();
    controller = null;
    marker?.remove();
    marker = null;
  }

  function render(body, api, place, status) {
    ui.clear(body);
    const coords = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
    const save = (slot) => {
      try {
        if (slot === 'home') memory.setHome(place);
        else memory.setWork(place);
        ui.toast(`Saved as ${slot === 'home' ? 'Home' : 'Work'}`, { tone: 'good' });
        api.close();
      } catch (err) {
        ui.toast(err.message, { tone: 'bad' });
      }
    };
    body.append(
      ui.el('p', { class: 'rp-dest' }, ui.icon('pin', { size: 16 }),
        ui.el('span', { text: status === 'loading' ? 'Finding the address…' : place.label || 'No street address here' })),
      ui.el('p', { class: 'muted small num', text: coords }),
      ui.el('button', { type: 'button', class: 'btn btn-accent btn-block', on: { click: () => openPreview(place) } }, ui.icon('route', { size: 20 }), 'Directions'),
      ui.el('div', { class: 'rp-secondary' },
        ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => save('home') } }, ui.icon('home', { size: 16 }), 'Save as Home'),
        ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => save('work') } }, ui.icon('work', { size: 16 }), 'Save as Work')),
    );
  }

  async function drop(lngLat) {
    removePin();
    let place = sanitizePlace({ name: 'Dropped pin', label: '', lng: lngLat[0], lat: lngLat[1], source: 'pin' });
    let sheetBody = null;
    let sheetApi = null;
    ui.sheet.open({
      id: SHEET_ID,
      title: 'Dropped pin',
      size: 'auto',
      render: (body, api) => {
        sheetBody = body;
        sheetApi = api;
        render(body, api, place, 'loading');
      },
      onClose: removePin,
    });
    // After open: opening replaces any previous sheet, whose onClose clears the old pin.
    marker = new maplibregl.Marker({ element: pinElement(), anchor: 'bottom' }).setLngLat(lngLat).addTo(ctx.map);
    const mine = new AbortController();
    controller = mine;
    try {
      const found = await services.reverse(lngLat, { signal: mine.signal });
      if (controller !== mine) return;
      if (found) place = found;
    } catch (err) {
      if (isAbort(err) || controller !== mine) return;
      console.warn(`[search] reverse geocode failed: ${err.message}`);
    }
    if (ui.sheet.currentId() !== SHEET_ID || !sheetBody) return;
    sheetApi.setTitle(place.name);
    render(sheetBody, sheetApi, place, 'done');
  }

  bus.on('map:longpress', (e) => {
    const p = e?.lngLat;
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    if (['navigate', 'race'].includes(store.get().mode)) return; // never distract the driver
    drop([p[0], p[1]]).catch((err) => console.error('[search] pin drop failed', err));
  });

  return Object.freeze({ drop, removePin });
}
