// The "Where to?" pill and the search sheet: quick chips, saved and recent places, live results.
import { isAbort } from '../routing/http.js';
import { CATEGORIES } from './geocoder.js';
import { iconForKind } from './places.js';
import { parseAddressQuery, hasExactMatch } from './addresses.js';

const DEBOUNCE_MS = 250;
const QUICK = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'work', label: 'Work', icon: 'work' },
  { id: 'fuel', label: 'Servo', icon: 'fuel' },
  { id: 'cafe', label: 'Coffee', icon: 'star' },
  { id: 'parking', label: 'Parking', icon: 'car' },
  { id: 'food', label: 'Food', icon: 'spark' },
];

/**
 * @param {object} ctx app context
 * @param {{services: object, memory: object, here: Function, onPick: Function}} deps
 */
export function createSearchUi(ctx, { services, memory, here, onPick }) {
  const { ui, geo, store, bus, actions } = ctx;
  const slot = document.getElementById('search-slot');
  let view = null; // live sheet state while the search sheet is open

  // ------------------------------------------------------------------ pill
  function renderPill() {
    if (!slot) return;
    const home = memory.home();
    const pill = ui.el(
      'div',
      { class: 'srch-pill' },
      ui.el(
        'button',
        { type: 'button', class: 'srch-pill-main', 'aria-label': 'Search for a place', on: { click: () => openSheet() } },
        ui.el('span', { class: 'srch-pill-icon' }, ui.icon('search', { size: 22, strokeWidth: 2.4 })),
        ui.el('span', { class: 'srch-pill-text', text: 'Where to?' }),
      ),
      home
        ? ui.iconButton('home', 'Directions home', () => onPick(home), { className: 'srch-pill-btn', size: 22 })
        : null,
      actions.has('copilotListen')
        ? ui.iconButton('mic', 'Ask the copilot', () => {
            Promise.resolve(actions.call('copilotListen')).catch((err) => ui.toast(err?.message || 'The copilot isn’t available right now.', { tone: 'warn' }));
          }, { className: 'srch-pill-btn srch-pill-mic', size: 22 })
        : null,
    );
    ui.clear(slot).append(pill);
  }

  // ------------------------------------------------------------------ sheet
  function distanceText(place) {
    const m = geo.haversine(here().point, [place.lng, place.lat]);
    return geo.formatDistance(m, store.get().settings.units).text;
  }

  function placeRow(place, { iconName, hint, onClick } = {}) {
    return ui.el(
      'button',
      { type: 'button', class: 'row srch-row', on: { click: onClick ?? (() => choose(place)) } },
      ui.el('span', { class: 'row-icon' }, ui.icon(iconName ?? iconForKind(place.kind), { size: 20 })),
      ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: place.name }), ui.el('span', { class: 'row-hint', text: hint ?? place.label })),
      ui.el('span', { class: 'row-meta', text: distanceText(place) }),
    );
  }

  function stateCard(iconName, title, body, action) {
    return ui.el(
      'div',
      { class: 'srch-state' },
      ui.el('span', { class: 'srch-state-icon' }, ui.icon(iconName, { size: 26 })),
      ui.el('strong', { text: title }),
      body ? ui.el('span', { class: 'muted small', text: body }) : null,
      action ? ui.el('button', { type: 'button', class: 'btn btn-sm btn-accent', text: action.label, on: { click: action.onClick } }) : null,
    );
  }

  function renderIdle(list) {
    const saved = [
      memory.home() ? placeRow(memory.home(), { iconName: 'home', hint: `Home · ${memory.home().label || memory.home().name}` }) : null,
      memory.work() ? placeRow(memory.work(), { iconName: 'work', hint: `Work · ${memory.work().label || memory.work().name}` }) : null,
    ].filter(Boolean);
    if (saved.length) list.append(ui.el('p', { class: 'section-title', text: 'Saved' }), ui.el('div', { class: 'list' }, saved));
    const recents = memory.recents();
    if (recents.length) {
      list.append(
        ui.el('div', { class: 'spread srch-head' }, ui.el('p', { class: 'section-title', text: 'Recent' }),
          ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Clear', on: { click: () => { memory.clearRecents(); renderList(); } } })),
        ui.el('div', { class: 'list' }, recents.map((p) => placeRow(p, { iconName: 'history' }))),
      );
    }
    if (!saved.length && !recents.length) {
      list.append(stateCard('search', 'Search for a place', 'Try a street, a suburb or a business. Tap a chip for servos, coffee and more nearby.'));
    }
  }

  /** A note when a typed house number isn't in the free map data (and no TomTom key is set). */
  function addressNote(query, results) {
    const parsed = parseAddressQuery(query);
    if (!parsed || hasExactMatch(results, parsed) || results.some((p) => p.source === 'estimate' || p.source === 'tomtom')) return null;
    return stateCard(
      'pin',
      `Couldn’t find No. ${parsed.number}`,
      'Showing the street and nearby numbers. Check the number, or add the suburb.',
    );
  }

  function renderList() {
    if (!view) return;
    const list = ui.clear(view.list);
    const { status, results, query, error, pickFor } = view;
    view.hint.hidden = !pickFor;
    view.hint.textContent = pickFor ? `Search for your ${pickFor} address, then tap it to save.` : '';
    if (status === 'loading') {
      list.append(ui.el('div', { class: 'srch-skel', 'aria-label': 'Searching', role: 'status' }, [0, 1, 2].map(() => ui.el('div', { class: 'srch-skel-row' }))));
    } else if (status === 'error') {
      list.append(stateCard('alert', 'Search isn’t answering', error, { label: 'Try again', onClick: () => runSearch(query, { now: true }) }));
    } else if (status === 'done' && results.length === 0) {
      list.append(stateCard('search', `Nothing found for “${query}”`, 'Check the spelling, or add the suburb (for example “Hay Street Subiaco”).'));
    } else if (status === 'done') {
      const missing = addressNote(query, results);
      if (missing) list.append(missing);
      list.append(ui.el('div', { class: 'list' }, results.map((p) => placeRow(p))));
    } else {
      renderIdle(list);
    }
  }

  async function runSearch(query, { now = false, category = null } = {}) {
    if (!view) return;
    clearTimeout(view.timer);
    view.controller?.abort();
    const q = query.trim();
    view.query = q;
    if (!q && !category) {
      Object.assign(view, { status: 'idle', results: [] });
      renderList();
      return;
    }
    const start = async () => {
      if (!view) return;
      const controller = new AbortController();
      view.controller = controller;
      view.status = 'loading';
      renderList();
      const mine = view;
      try {
        const results = category
          ? await services.searchCategory(category, { signal: controller.signal })
          : await services.search(q, { signal: controller.signal, fallbackOnEmpty: now });
        if (view !== mine || controller.signal.aborted) return;
        Object.assign(view, { status: 'done', results, error: '' });
      } catch (err) {
        if (isAbort(err) || view !== mine) return;
        Object.assign(view, { status: 'error', results: [], error: err?.message || 'Check your signal and try again.' });
      }
      renderList();
    };
    if (now) start();
    else view.timer = setTimeout(start, DEBOUNCE_MS);
  }

  function choose(place) {
    const pickFor = view?.pickFor;
    if (pickFor) {
      try {
        if (pickFor === 'home') memory.setHome(place);
        else memory.setWork(place);
        ui.toast(`${pickFor === 'home' ? 'Home' : 'Work'} saved. Tap ${pickFor === 'home' ? 'Home' : 'Work'} any time to head there.`, { tone: 'good' });
      } catch (err) {
        ui.toast(err.message, { tone: 'bad' });
        return;
      }
      Object.assign(view, { pickFor: null });
      view.input.value = '';
      runSearch('');
      return;
    }
    bus.emit('place:selected', place);
    onPick(place);
  }

  function quick(id) {
    if (!view) return;
    if (id === 'home' || id === 'work') {
      const saved = id === 'home' ? memory.home() : memory.work();
      if (saved) {
        onPick(saved);
        return;
      }
      view.pickFor = id;
      view.input.value = '';
      view.input.placeholder = `Your ${id} address`;
      view.input.focus();
      runSearch('');
      return;
    }
    view.input.value = CATEGORIES[id].label;
    runSearch(CATEGORIES[id].label, { now: true, category: id });
  }

  function buildSheet(body, query, pickFor) {
    const input = ui.el('input', {
      type: 'search', class: 'srch-input', value: query, placeholder: 'Search places or addresses',
      'aria-label': 'Search places or addresses', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    });
    const clearBtn = ui.iconButton('close', 'Clear search', () => {
      input.value = '';
      clearBtn.hidden = true;
      runSearch('');
      input.focus();
    }, { className: 'icon-btn srch-clear', size: 20 });
    clearBtn.hidden = !query;
    input.addEventListener('input', () => {
      clearBtn.hidden = !input.value;
      runSearch(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (view?.status === 'done' && view.results.length && view.query === input.value.trim()) choose(view.results[0]);
      else runSearch(input.value, { now: true });
    });
    const chips = ui.el('div', { class: 'srch-chips', role: 'group', 'aria-label': 'Quick searches' },
      QUICK.map((c) => ui.el('button', { type: 'button', class: 'chip', on: { click: () => quick(c.id) } }, ui.icon(c.icon, { size: 18 }), c.label)));
    const hint = ui.el('p', { class: 'srch-hint', hidden: true });
    const list = ui.el('div', { class: 'srch-list', 'aria-live': 'polite' });
    body.append(
      ui.el('div', { class: 'srch-bar' }, ui.el('label', { class: 'srch-field' }, ui.icon('search', { size: 20 }), input, clearBtn), chips),
      hint,
      list,
    );
    view = { input, list, hint, status: 'idle', results: [], query: '', error: '', pickFor, timer: null, controller: null };
    if (query) runSearch(query, { now: true });
    else renderList();
    // Focus after the sheet slides in (iOS only shows the keyboard for focus close to the tap).
    input.focus({ preventScroll: true });
    setTimeout(() => view?.input === input && input.focus({ preventScroll: true }), 280);
  }

  function openSheet({ query = '', pickFor = null } = {}) {
    ui.sheet.open({
      id: 'search',
      title: 'Where to?',
      size: 'tall',
      render: (body) => buildSheet(body, query, pickFor),
      onClose: () => {
        clearTimeout(view?.timer);
        view?.controller?.abort();
        view = null;
      },
    });
  }

  renderPill();
  memory.subscribe(renderPill);
  bus.on('app:ready', renderPill); // the copilot registers its mic action after us
  return Object.freeze({ openSheet, renderPill });
}
