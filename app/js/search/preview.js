// Route preview: route option cards, avoid chips, GO and Demo drive. Owns mode 'preview'.
import { isAbort } from '../routing/http.js';
import { sanitizePlace, formatClock, durationParts, trafficChip } from './places.js';

const SHEET_ID = 'route-preview';
const FIT_DELAY_MS = 320; // let the sheet finish sliding in so fitBounds pads for it
const MIN_MAP_BAND_PX = 140;
const AVOIDS = [
  { key: 'avoidTolls', label: 'Tolls', noun: 'tolls' },
  { key: 'avoidMotorways', label: 'Freeways', noun: 'freeways' },
  { key: 'avoidFerries', label: 'Ferries', noun: 'ferries' },
];

const unionBbox = (routes) =>
  routes.reduce((b, r) => [Math.min(b[0], r.bbox[0]), Math.min(b[1], r.bbox[1]), Math.max(b[2], r.bbox[2]), Math.max(b[3], r.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);

export function createPreview(ctx, { services, memory, here }) {
  const { ui, geo, store, bus, actions, mapView } = ctx;
  let session = null; // { place, from, routes, selected, status, error, controller, body, handingOff }

  /**
   * Frame a bbox in the map strip the sheet leaves visible. (mapView.fitBounds caps its bottom
   * padding at half the screen, but this sheet can cover more on a phone.)
   */
  function sheetCover() {
    // Layout box, not getBoundingClientRect: correct even mid slide-in (the slide is a transform).
    const el = document.getElementById('sheet');
    if (!el || el.hidden || !el.offsetParent) return { bottom: 0, left: 0 };
    if (window.matchMedia('(min-width: 900px)').matches) return { bottom: 0, left: el.offsetLeft + el.offsetWidth + 8 };
    return { bottom: Math.max(0, el.offsetParent.clientHeight - el.offsetTop), left: 0 };
  }

  function fitVisible(bbox) {
    if (!session || !bbox?.every(Number.isFinite)) return;
    const map = ctx.map;
    const h = map.getContainer().clientHeight;
    const w = map.getContainer().clientWidth;
    const cover = sheetCover();
    const top = Math.min(h * 0.4, (document.querySelector('.hud-top')?.getBoundingClientRect().bottom ?? 80) + 16);
    let bottom = Math.max(cover.bottom, 24) + 16;
    if (h - top - bottom < MIN_MAP_BAND_PX) bottom = Math.max(16, h - top - MIN_MAP_BAND_PX);
    const left = Math.min(w * 0.6, cover.left + 28);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top, bottom, left, right: 28 }, maxZoom: 16, pitch: 0, bearing: 0, duration: mapView.reduceMotion ? 0 : 900,
    });
  }
  const fitLater = (bbox) => setTimeout(() => mapSafe('frame route', () => fitVisible(bbox)), FIT_DELAY_MS);

  /** Map drawing must never break route planning (the style can be mid-reload, e.g. a theme switch). */
  function mapSafe(what, fn) {
    try {
      fn();
      return true;
    } catch (err) {
      console.warn(`[search] couldn't ${what} yet: ${err?.message ?? err}`);
      return false;
    }
  }

  function drawRoutes(routes, index) {
    if (mapSafe('draw routes', () => mapView.routes.showRoutes(routes, index))) return;
    ctx.map.once('idle', () => {
      if (session?.routes === routes) mapSafe('draw routes', () => mapView.routes.showRoutes(routes, session.selected));
    });
  }

  function selectRoute(i) {
    if (!session || !session.routes[i]) return;
    session.selected = i;
    store.set({ selectedRoute: i });
    drawRoutes(session.routes, i);
    render();
  }

  function tag(text, tone) {
    return ui.el('span', { class: `rp-tag rp-tag-${tone}`, text });
  }

  function routeCard(route, i) {
    const fastest = session.routes[0];
    const extra = Math.round((route.duration - fastest.duration) / 60);
    const chips = [
      i === 0 ? tag('Fastest', 'fast') : extra >= 1 ? tag(`+${extra} min`, 'muted') : null,
      trafficChip(route.trafficDelay) ? tag(trafficChip(route.trafficDelay), 'traffic') : null,
      route.hasTolls ? tag('Tolls', 'muted') : null,
    ].filter(Boolean);
    const arrive = formatClock(new Date(Date.now() + route.duration * 1000));
    const dist = geo.formatDistance(route.distance, store.get().settings.units).text;
    const selected = i === session.selected;
    return ui.el(
      'button',
      {
        type: 'button', role: 'radio', class: 'rp-card', 'aria-checked': String(selected), tabindex: selected ? '0' : '-1',
        'aria-label': `${geo.formatDuration(route.duration)}, ${dist}, arrive ${arrive}${route.summary ? `, ${route.summary}` : ''}`,
        on: { click: () => selectRoute(i) },
      },
      ui.el('span', { class: 'rp-time' }, durationParts(route.duration).map((p) => (p.kind === 'num' ? ui.el('b', { text: p.text }) : ui.el('small', { text: p.text })))),
      ui.el('span', { class: 'rp-mid' },
        chips.length ? ui.el('span', { class: 'rp-tags' }, chips) : null,
        route.summary ? ui.el('span', { class: 'rp-via', text: route.summary }) : null),
      ui.el('span', { class: 'rp-meta' }, ui.el('span', { class: 'rp-arrive', text: arrive }), ui.el('span', { class: 'rp-dist', text: dist })),
    );
  }

  function routeGroup() {
    const group = ui.el('div', { class: 'rp-routes', role: 'radiogroup', 'aria-label': 'Route options' }, session.routes.map(routeCard));
    group.addEventListener('keydown', (e) => {
      const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const n = session.routes.length;
      selectRoute((session.selected + dir + n) % n);
      session.body?.querySelector('.rp-card[aria-checked="true"]')?.focus();
    });
    return group;
  }

  function avoidRow() {
    const s = store.get().settings;
    return ui.el(
      'div',
      { class: 'rp-avoid', role: 'group', 'aria-label': 'Avoid' },
      ui.el('span', { class: 'rp-avoid-label', text: 'Avoid' }),
      AVOIDS.map((a) =>
        ui.el('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(!!s[a.key]), text: a.label,
          on: { click: () => toggleAvoid(a.key) },
        }),
      ),
    );
  }

  function notes() {
    const out = [];
    const route = session.routes[session.selected];
    const s = store.get().settings;
    const missed = AVOIDS.filter((a) => s[a.key] && route && !route.options?.[a.key]).map((a) => a.noun);
    if (missed.length) out.push(ui.el('p', { class: 'rp-note rp-note-warn', text: `Couldn’t plan around ${missed.join(' and ')}: this route may still use them.` }));
    if (!s.tomtomKey) {
      out.push(ui.el('p', { class: 'rp-note', text: 'Times use typical speeds, not live traffic.' }));
    }
    return out;
  }

  function handOff(actionName, args) {
    const s = session;
    if (!s || !s.routes[s.selected]) return;
    bus.emit('voice:prime'); // must run inside the tap: unlocks speech on iPhone
    s.handingOff = true;
    let result;
    try {
      result = actions.call(actionName, ...args(s));
    } catch (err) {
      result = Promise.reject(err);
    }
    Promise.resolve(result)
      .then(() => {
        memory.remember(s.place);
        if (session === s) ui.sheet.close(SHEET_ID);
      })
      .catch((err) => {
        s.handingOff = false;
        console.error(`[search] ${actionName} failed`, err);
        ui.toast(err?.message || 'Navigation couldn’t start. Try again.', { tone: 'bad', ms: 4000 });
      });
  }

  function savePlace(slot) {
    try {
      if (slot === 'home') memory.setHome(session.place);
      else memory.setWork(session.place);
      ui.toast(`Saved as ${slot === 'home' ? 'Home' : 'Work'}`, { tone: 'good' });
    } catch (err) {
      ui.toast(err.message, { tone: 'bad' });
    }
  }

  function actionsBlock() {
    const ready = session.status === 'ready';
    const go = ui.el('button', { type: 'button', class: 'btn btn-go btn-block', disabled: !ready, on: { click: () => handOff('startNavigation', (s) => [s.routes[s.selected], s.place]) } },
      ui.icon('play', { size: 22 }), 'Go');
    const demo = actions.has('startDemoDrive')
      ? ui.el('button', { type: 'button', class: 'btn btn-ghost rp-demo', disabled: !ready, on: { click: () => handOff('startDemoDrive', (s) => [s.routes[s.selected], { destination: s.place }]) } }, ui.icon('car', { size: 18 }), 'Demo drive')
      : null;
    return ui.el('div', { class: 'rp-actions' }, go, demo);
  }

  /** Avoid chips and Save as Home/Work, folded away so the map stays visible on phones. */
  function moreBlock() {
    const s = store.get().settings;
    const active = AVOIDS.filter((a) => s[a.key]).map((a) => a.noun);
    const details = ui.el(
      'details',
      { class: 'rp-more', open: session.moreOpen },
      ui.el('summary', {}, ui.el('span', { text: 'Route options' }), ui.el('span', { class: 'rp-more-hint', text: active.length ? `Avoiding ${active.join(', ')}` : 'Avoid tolls, save place' })),
      ui.el('div', { class: 'rp-more-body' },
        avoidRow(),
        ui.el('div', { class: 'rp-secondary' },
          ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => savePlace('home') } }, ui.icon('home', { size: 16 }), 'Save as Home'),
          ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: () => savePlace('work') } }, ui.icon('work', { size: 16 }), 'Save as Work'))),
    );
    details.addEventListener('toggle', () => {
      if (session) session.moreOpen = details.open;
    });
    return details;
  }

  function statusBlock() {
    if (session.status === 'loading') {
      return ui.el('div', { class: 'rp-loading', role: 'status' },
        ui.el('div', { class: 'rp-skel' }), ui.el('div', { class: 'rp-skel rp-skel-short' }), ui.el('span', { class: 'muted small', text: 'Finding the best routes…' }));
    }
    return ui.el('div', { class: 'srch-state', role: 'alert' },
      ui.el('span', { class: 'srch-state-icon' }, ui.icon('alert', { size: 26 })),
      ui.el('strong', { text: 'No route yet' }),
      ui.el('span', { class: 'muted small', text: session.error }),
      ui.el('button', { type: 'button', class: 'btn btn-sm btn-accent', text: 'Try again', on: { click: () => plan() } }));
  }

  function render() {
    if (!session?.body) return;
    const body = ui.clear(session.body);
    const { place } = session;
    const from = session.fromGps ? '' : ' · from map centre';
    body.append(ui.el('p', { class: 'rp-dest' }, ui.icon('flag', { size: 16 }), ui.el('span', { text: `${place.label || 'Dropped pin'}${from}` })));
    const ready = session.status === 'ready';
    body.append(ready ? routeGroup() : statusBlock(), ...(ready ? notes() : []), actionsBlock(), moreBlock());
  }

  async function plan() {
    const s = session;
    if (!s) return [];
    s.controller?.abort();
    const controller = new AbortController();
    Object.assign(s, { controller, status: 'loading', error: '', routes: [], selected: 0 });
    store.set({ routes: [], selectedRoute: 0 });
    mapSafe('clear routes', () => mapView.routes.clear());
    render();
    try {
      const routes = await services.routes(s.from, s.place, { signal: controller.signal });
      if (session !== s || controller.signal.aborted) return routes;
      Object.assign(s, { routes, status: 'ready' });
      store.set({ routes, selectedRoute: 0 });
      drawRoutes(routes, 0);
      bus.emit('route:ready', { routes, destination: s.place });
      render();
      fitLater(unionBbox(routes));
      return routes;
    } catch (err) {
      if (isAbort(err)) return [];
      if (session === s) {
        Object.assign(s, { status: 'error', error: err?.message || 'Check your signal and try again.' });
        render();
      }
      throw err;
    }
  }

  function toggleAvoid(key) {
    store.set((st) => ({ settings: { ...st.settings, [key]: !st.settings[key] } }));
    plan().catch(() => {}); // errors are shown in the sheet
  }

  function reset() {
    session?.controller?.abort();
    const wasPreview = store.get().mode === 'preview';
    session = null;
    if (!wasPreview) return;
    store.set({ mode: 'explore', routes: [], destination: null, selectedRoute: 0 });
    mapSafe('clear routes', () => mapView.routes.clear());
    mapSafe('remove flag', () => mapView.setDestination(null));
  }

  /** Open the preview for a place and plan routes. Resolves with Route[] (throws a friendly Error). */
  function open(input) {
    const place = sanitizePlace(input);
    if (!place) return Promise.reject(new Error('That place has no usable location. Pick it again from search.'));
    session?.controller?.abort();
    const origin = here();
    if (!origin.fromGps) ui.toast('No GPS fix yet, so the route starts from the map centre.', { tone: 'warn', ms: 4000 });
    const s = { place, from: origin.point, fromGps: origin.fromGps, routes: [], selected: 0, status: 'loading', error: '', controller: null, body: null, handingOff: false };
    session = null; // so the previous sheet's onClose doesn't reset the new preview
    ui.sheet.open({
      id: SHEET_ID,
      title: place.name,
      size: 'auto',
      render: (body) => {
        s.body = body;
      },
      onClose: () => {
        if (session === s && !s.handingOff) reset();
        else if (session === s) session = null;
      },
    });
    session = s;
    memory.remember(place);
    store.set({ mode: 'preview', destination: place, routes: [], selectedRoute: 0 });
    mapSafe('place flag', () => mapView.setDestination(place));
    fitLater(geo.bboxOf([origin.point, [place.lng, place.lat]]));
    return plan();
  }

  bus.on('route:pick', (e) => {
    if (session?.status === 'ready' && Number.isInteger(e?.index)) selectRoute(e.index);
  });
  // Navigation started some other way (e.g. the copilot): get out of the way.
  store.select((st) => st.mode, (mode) => {
    if (session && (mode === 'navigate' || mode === 'race')) {
      session.handingOff = true;
      ui.sheet.close(SHEET_ID);
    }
  });

  return Object.freeze({ open, isOpen: () => !!session });
}
