// Track day sheet: safety note, saved tracks (Race / Demo lap / Delete), record a new track,
// and a demo lap on a practice circuit for trying it at home.
import { formatLap } from './laps.js';
import { twoTapButton } from './panel.js';

const SHEET_ID = 'race';

/**
 * @param {object} ctx
 * @param {{tracks: () => object[], onRace: Function, onDemo: Function, onRecord: Function,
 *          onDelete: Function, onPracticeDemo: Function}} handlers
 */
export function createRaceSheet(ctx, handlers) {
  const { ui, geo, store } = ctx;
  let selectedId = null;

  const units = () => store.get().settings.units;

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

  function trackActions(track, rerender) {
    return ui.el(
      'div',
      { class: 'race-track-actions' },
      ui.el('button', { type: 'button', class: 'btn btn-go', on: { click: () => handlers.onRace(track) } }, ui.icon('flag', { size: 22 }), 'Race'),
      ui.el('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => handlers.onDemo(track) } }, ui.icon('play', { size: 18 }), 'Demo lap'),
      twoTapButton(ui, {
        text: 'Delete', armedText: 'Tap again to delete', className: 'btn btn-ghost race-delete', label: `Delete ${track.name}`,
        onConfirm: () => {
          handlers.onDelete(track.id);
          selectedId = null;
          rerender();
        },
      }),
    );
  }

  function trackRow(track, rerender) {
    const selected = track.id === selectedId;
    return ui.el(
      'div',
      { class: `race-track${selected ? ' is-selected' : ''}` },
      ui.el(
        'button',
        {
          type: 'button', class: 'row', 'aria-expanded': String(selected),
          on: {
            click: () => {
              selectedId = selected ? null : track.id;
              rerender();
            },
          },
        },
        ui.el('span', { class: 'row-icon' }, ui.icon('flag', { size: 20 })),
        ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: track.name }), ui.el('span', { class: 'row-hint num', text: trackHint(track) })),
        ui.icon('chevron', { size: 18 }),
      ),
      selected ? trackActions(track, rerender) : null,
    );
  }

  function renderList(body) {
    ui.clear(body);
    const rerender = () => renderList(body);
    const tracks = handlers.tracks();
    if (selectedId && !tracks.some((t) => t.id === selectedId)) selectedId = tracks[0]?.id ?? null;
    body.append(safety());
    if (tracks.length) {
      body.append(ui.el('p', { class: 'section-title', text: 'Your tracks' }), ui.el('div', { class: 'list' }, tracks.map((t) => trackRow(t, rerender))));
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
      ui.el('button', { type: 'button', class: 'btn btn-accent btn-block', on: { click: () => renderRecord(body) } }, ui.icon('plus', { size: 20 }), 'Record a track'),
      ui.el('button', { type: 'button', class: 'btn btn-ghost btn-block', on: { click: () => handlers.onPracticeDemo() } }, ui.icon('play', { size: 18 }), 'Demo lap on a practice circuit'),
    );
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

  return Object.freeze({ open, select: (id) => (selectedId = id) });
}
