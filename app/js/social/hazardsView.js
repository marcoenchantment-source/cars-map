// Hazard UI: the big report grid, map markers, the tap-for-details sheet and the
// "hazard ahead" notice. All text goes through ui.el (textContent), never innerHTML.
import { formatDistance } from '../core/geo.js';
import { hazardType, agoText } from './hazardLogic.js';

const REPORT_SHEET = 'social-report';
const DETAIL_SHEET = 'social-hazard';

/** Words used in speech and titles ("Police reported ahead"). */
export const SPOKEN = Object.freeze({
  police: 'Police', camera: 'Speed camera', crash: 'Crash', hazard: 'Hazard', roadworks: 'Roadworks',
  weather: 'Bad weather', closure: 'Road closure', traffic: 'Traffic jam',
});

export const spokenName = (type) => SPOKEN[type] ?? hazardType(type)?.label ?? 'Hazard';

function metaLine(h, nowMs) {
  const parts = [`Reported ${agoText(h.reportedAt, nowMs)}`];
  if (h.confirms > 0) parts.push(`${h.confirms} confirmed`);
  if (h.denies > 0) parts.push(`${h.denies} said gone`);
  return parts.join(' · ');
}

/**
 * @param {object} ctx app context
 * @param {{onOpen:(id:string)=>void}} handlers
 */
export function createHazardView(ctx, { onOpen }) {
  const { ui, config } = ctx;
  const markers = new Map(); // id -> {marker, el, key}

  function openReportSheet(onPick) {
    ui.sheet.open({
      id: REPORT_SHEET,
      title: 'Report a hazard',
      render(body) {
        const grid = ui.el('div', { class: 'hz-grid', role: 'list' });
        for (const t of config.HAZARD_TYPES) {
          grid.append(
            ui.el(
              'button',
              { type: 'button', class: `hz-tile hz-${t.id}`, role: 'listitem', on: { click: () => onPick(t.id) } },
              ui.el('span', { class: 'hz-tile-icon' }, ui.icon(t.id, { size: 34 })),
              ui.el('span', { class: 'hz-tile-label', text: t.label }),
            ),
          );
        }
        body.append(
          grid,
          ui.el('p', { class: 'muted small hz-note', text: 'One tap reports it where you are now. Drivers nearby will see it.' }),
        );
      },
    });
  }

  function closeReportSheet() {
    ui.sheet.close(REPORT_SHEET);
  }

  function markerEl(h) {
    const label = hazardType(h.type)?.label ?? 'Hazard';
    return ui.el(
      'button',
      {
        type: 'button',
        class: `hz-marker hz-${h.type}${h.mine ? ' is-mine' : ''}`,
        'aria-label': `${label} reported`,
        title: label,
        on: {
          click: (e) => {
            e.stopPropagation();
            onOpen(h.id);
          },
        },
      },
      ui.icon(h.type, { size: 20 }),
    );
  }

  /** Diff the marker set against `list` (already capped/sorted by distance). */
  function renderMarkers(list) {
    if (!globalThis.maplibregl) return;
    const keep = new Set(list.map((h) => h.id));
    for (const [id, m] of markers) {
      if (!keep.has(id)) {
        m.marker.remove();
        markers.delete(id);
      }
    }
    for (const h of list) {
      const key = `${h.type}:${h.mine}`;
      const existing = markers.get(h.id);
      if (existing && existing.key === key) continue;
      existing?.marker.remove();
      const el = markerEl(h);
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([h.lng, h.lat]).addTo(ctx.map);
      markers.set(h.id, { marker, el, key });
    }
  }

  function openDetail(h, onVote) {
    const label = hazardType(h.type)?.label ?? 'Hazard';
    ui.sheet.open({
      id: DETAIL_SHEET,
      title: label,
      render(body, api) {
        const vote = (v) => {
          api.close();
          onVote(h, v);
        };
        body.append(
          ui.el(
            'div',
            { class: `hz-detail hz-${h.type}` },
            ui.el('span', { class: 'hz-detail-icon' }, ui.icon(h.type, { size: 30 })),
            ui.el(
              'div',
              { class: 'row-text' },
              ui.el('span', { class: 'row-title', text: metaLine(h, Date.now()) }),
              ui.el('span', { class: 'row-hint', text: h.mine ? 'You reported this.' : 'Is it still there?' }),
            ),
          ),
          ui.el(
            'div',
            { class: 'hz-votes' },
            ui.el('button', { type: 'button', class: 'btn btn-accent', text: 'Still there', on: { click: () => vote('confirm') } }),
            ui.el('button', { type: 'button', class: 'btn btn-ghost', text: h.mine ? 'Remove it' : 'Gone', on: { click: () => vote('deny') } }),
          ),
        );
      },
    });
  }

  function aheadNotice(h, distance, onVote) {
    ui.notice({
      id: `hz-ahead-${h.id.slice(0, 16)}`,
      iconName: h.type,
      title: `${spokenName(h.type)} ahead`,
      body: `${formatDistance(distance, ctx.store.get().settings.units).text} · reported ${agoText(h.reportedAt, Date.now())}`,
      tone: 'warn',
      ms: 14000,
      actions: [
        { label: 'Still there', onClick: () => onVote(h, 'confirm'), primary: true },
        { label: 'Gone', onClick: () => onVote(h, 'deny') },
      ],
    });
  }

  return Object.freeze({ openReportSheet, closeReportSheet, renderMarkers, openDetail, aheadNotice });
}
