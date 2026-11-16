// Track day sheet: safety note, your tracks (Race / Demo lap / Lap history / Delete), world
// tracks built from OpenStreetMap (search, nearest first), record a new track, and a practice demo.
import { formatLap, formatDelta } from './laps.js';
import { twoTapButton } from './panel.js';
import { lapStats } from './tracksModel.js';
import { loadWorldTracks, findTracks } from './worldTracks.js';
import { renderGroupSection } from './groupSheet.js';

const SHEET_ID = 'race';
const PREVIEW_ID = 'race-preview';

/**
 * @param {object} ctx
 * @param {{tracks: () => object[], onRace: Function, onDemo: Function, onRecord: Function,
 *          onDelete: Function, onPracticeDemo: Function}} handlers
 */
export function createRaceSheet(ctx, handlers) {
  const { ui, geo, store } = ctx;
  let worldQuery = ''; // kept so "Back to tracks" returns to the same search

  const units = () => store.get().settings.units;
  const km = (m) => geo.formatDistance(m, units()).text;

  function safety() {
    return ui.el(
      'div',
      { class: 'race-safety', role: 'note' },
      ui.icon('alert', { size: 22 }),
      ui.el('span', { text: 'For closed circuits and track days only. Never race on public roads.' }),
    );
  }

  function trackHint(track) {
    const len = geo.formatDistance(track.length, units()).text;
    return track.bestLap ? `${len} · Best ${formatLap(track.bestLap)}` : `${len} · No laps yet`;
  }

  /**
   * Small card for one track while the map zooms to it: Race, Demo lap, and for your own
   * tracks Lap history and Delete. "Back to tracks" returns to the list (search kept).
   */
  function openPreview(track, { saved }) {
    const facts = [saved ? null : track.country, `${km(track.length)} lap`, track.bestLap ? `Best ${formatLap(track.bestLap)}` : null].filter(Boolean).join(' · ');
    const back = () => open();
    const render = (body) => {
      ui.clear(body);
      body.append(
        ui.el('p', { class: 'race-preview-facts num', text: facts }),
        ui.el(
          'div',
          { class: 'race-track-actions' },
          ui.el('button', { type: 'button', class: 'btn btn-go', on: { click: () => (saved ? handlers.onRace(track) : handlers.onWorldRace(track)) } }, ui.icon('flag', { size: 22 }), 'Race'),
          ui.el('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => (saved ? handlers.onDemo(track) : handlers.onWorldDemo(track)) } }, ui.icon('play', { size: 18 }), 'Demo lap'),
          saved ? ui.el('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => renderHistory(body, track, () => render(body)) } }, ui.icon('timer', { size: 18 }), 'Lap history') : null,
          saved
            ? twoTapButton(ui, {
              text: 'Delete', armedText: 'Tap again to delete', className: 'btn btn-ghost race-delete', label: `Delete ${track.name}`,
              onConfirm: () => {
                handlers.onDelete(track.id);
                back();
              },
            })
            : null,
        ),
        ui.el('button', { type: 'button', class: 'btn btn-ghost btn-block', on: { click: back } }, ui.icon('back', { size: 18 }), 'Back to tracks'),
      );
    };
    ui.sheet.open({ id: PREVIEW_ID, title: track.name, size: 'auto', render, onClose: () => handlers.onPreviewEnd?.() });
    // Zoom once the card has slid up, so the track fits the space above it.
    setTimeout(() => handlers.onPreview?.(track), 300);
  }

  function trackRow(track) {
    return ui.el(
      'div',
      { class: 'race-track' },
      ui.el(
        'button',
        { type: 'button', class: 'row', on: { click: () => openPreview(track, { saved: true }) } },
        ui.el('span', { class: 'row-icon' }, ui.icon('flag', { size: 20 })),
        ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: track.name }), ui.el('span', { class: 'row-hint num', text: trackHint(track) })),
        ui.icon('chevron', { size: 18 }),
      ),
    );
  }

  function renderList(body) {
    ui.clear(body);
    const tracks = handlers.tracks();
    body.append(safety());
    const group = handlers.group?.();
    if (group) {
      const box = ui.el('div', { class: 'stack' });
      body.append(ui.el('p', { class: 'section-title', text: 'Race group' }), box);
      renderGroupSection(box, group, ctx);
    }
    if (tracks.length) {
      body.append(ui.el('p', { class: 'section-title', text: 'Your tracks' }), ui.el('div', { class: 'list' }, tracks.map((t) => trackRow(t))));
    } else {
      body.append(
        ui.el(
          'div',
          { class: 'card race-empty' },
          ui.el('strong', { text: 'No tracks yet' }),
          ui.el('p', { class: 'muted small', text: 'At the circuit, stop on the start/finish line, tap Record a track and drive one lap. The map then zooms to fit the whole track on your screen.' }),
        ),
      );
    }
    body.append(
      ...worldSection(),
      ui.el('p', { class: 'section-title', text: 'Not listed?' }),
      ui.el('button', { type: 'button', class: 'btn btn-accent btn-block', on: { click: () => renderRecord(body) } }, ui.icon('plus', { size: 20 }), 'Record a track'),
      ui.el('button', { type: 'button', class: 'btn btn-ghost btn-block', on: { click: () => handlers.onPracticeDemo() } }, ui.icon('play', { size: 18 }), 'Demo lap on a practice circuit'),
    );
  }

  // ---------------------------------------------------------------- tracks (built from OpenStreetMap)

  function worldRow(t) {
    const away = t.distance != null ? ` · ${km(t.distance)} away` : '';
    return ui.el(
      'div',
      { class: 'race-track' },
      ui.el(
        'button',
        { type: 'button', class: 'row', on: { click: () => openPreview(t, { saved: false }) } },
        ui.el('span', { class: 'row-icon' }, ui.icon('flag', { size: 20 })),
        ui.el('span', { class: 'row-text' },
          ui.el('span', { class: 'row-title', text: t.name }),
          ui.el('span', { class: 'row-hint num', text: `${t.country} · ${km(t.length)} lap${away}` })),
        ui.icon('chevron', { size: 18 }),
      ),
    );
  }

  function worldSection() {
    const results = ui.el('div', { class: 'list race-world' });
    const note = ui.el('p', { class: 'small muted', text: 'Loading tracks…' });
    const input = ui.el('input', {
      class: 'input', id: 'race-world-q', type: 'search', value: worldQuery,
      placeholder: 'Search a track, town or country', autocomplete: 'off', 'aria-label': 'Search tracks',
    });
    let data = null;
    const near = () => {
      const p = store.get().position;
      return p && Number.isFinite(p.lng) ? [p.lng, p.lat] : null;
    };
    const draw = () => {
      ui.clear(results);
      if (!data) return;
      const list = findTracks(data.tracks, { query: worldQuery, near: near(), limit: worldQuery ? 20 : 6 });
      if (!list.length) {
        results.append(ui.el('p', { class: 'muted small race-world-empty', text: 'That track isn’t in the list yet. Try another name or the country, or record it yourself below.' }));
        return;
      }
      for (const t of list) results.append(worldRow(t));
    };
    input.addEventListener('input', () => {
      worldQuery = input.value;
      draw();
    });
    loadWorldTracks()
      .then((d) => {
        data = d;
        const when = d.generatedAt ? new Date(d.generatedAt).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : '';
        note.textContent = `${d.tracks.length} circuits${when ? `, updated ${when}` : ''}. Nearest first.`;
        draw();
      })
      .catch((err) => {
        note.textContent = err.message;
      });
    return [ui.el('p', { class: 'section-title', text: 'Tracks' }), input, results, note];
  }

  // ---------------------------------------------------------------- lap history

  function renderHistory(body, track, onBack = () => renderList(body)) {
    ui.clear(body);
    const saved = handlers.tracks().find((t) => t.id === track.id) ?? track;
    const s = lapStats(saved);
    const stat = (label, value) => ui.el('div', { class: 'race-stat' }, ui.el('span', { class: 'race-stat-value num', text: value }), ui.el('span', { class: 'race-stat-label', text: label }));
    body.append(
      ui.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', on: { click: onBack } }, ui.icon('back', { size: 18 }), 'Back'),
      ui.el('h3', { class: 'race-history-title', text: saved.name }),
      ui.el('div', { class: 'race-stats' },
        stat('Best lap', s.best ? formatLap(s.best) : '–'),
        stat('Average', s.average ? formatLap(s.average) : '–'),
        stat('Laps', String(s.count))),
    );
    if (!s.count) {
      body.append(ui.el('p', { class: 'muted small', text: 'No laps yet. Tap Race at the circuit: every lap you finish is saved here, newest first.' }));
      return;
    }
    const rows = s.newestFirst.map((l, i) => {
      const n = s.count - i;
      const best = l.ms === s.best;
      const when = new Date(l.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      return ui.el(
        'div',
        { class: `row race-lap${best ? ' is-best' : ''}` },
        ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: `Lap ${n}` }), ui.el('span', { class: 'row-hint', text: when })),
        ui.el('span', { class: 'race-lap-delta num', text: best ? 'Best' : formatDelta(l.ms - s.best) }),
        ui.el('span', { class: 'row-meta race-lap-time', text: formatLap(l.ms) }),
      );
    });
    body.append(ui.el('div', { class: 'list' }, rows));
  }

  function renderRecord(body) {
    ui.clear(body);
    body.append(
      safety(),
      ui.el(
        'ol',
        { class: 'race-steps' },
        ui.el('li', { text: 'Stop on the start/finish line, pointing the way you race.' }),
        ui.el('li', { text: 'Tap Start and drive one full lap.' }),
        ui.el('li', { text: 'Back at the line, the track saves itself and timing begins.' }),
      ),
      ui.el('button', { type: 'button', class: 'btn btn-go btn-block', on: { click: () => handlers.onRecord() } }, ui.icon('play', { size: 22 }), 'Start'),
      ui.el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Back', on: { click: () => renderList(body) } }),
    );
  }

  function open() {
    if (store.get().mode === 'race') return;
    ui.sheet.open({ id: SHEET_ID, title: 'Track day', size: 'tall', render: (body) => renderList(body) });
  }

  return Object.freeze({ open });
}
