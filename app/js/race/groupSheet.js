// "Race group" section of the Track day sheet: create/join, share code + QR, pick a colour
// nobody else has, the members leaderboard, the 30-second group start, and leaving.
import { qrSvg } from '../social/qr.js';
import { colourById } from './groupModel.js';
import { formatLap } from './laps.js';
import { twoTapButton } from './panel.js';

function lobby(ui, link, rerender) {
  const name = ui.el('input', { class: 'input', id: 'rg-name', maxlength: '24', placeholder: 'Group name, e.g. Saturday crew', autocomplete: 'off' });
  const code = ui.el('input', { class: 'input', id: 'rg-code', placeholder: 'Paste a group code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const status = ui.el('p', { class: 'small muted', 'aria-live': 'polite' });
  const run = async (fn, okText) => {
    status.textContent = 'Connecting…';
    try {
      await fn();
      ui.toast(okText, { tone: 'good' });
      rerender();
    } catch (err) {
      status.textContent = err?.message || 'That didn’t work. Check your signal and try again.';
    }
  };
  return ui.el(
    'div',
    { class: 'card stack' },
    ui.el('p', { class: 'small', text: 'Racing with friends? Make a group and share its code. On the track, everyone sees each other’s cars in their own colour, with a live best-lap board.' }),
    ui.el('label', { class: 'field', for: 'rg-name' }, ui.el('span', { text: 'New group' }), name),
    ui.el('button', { type: 'button', class: 'btn btn-accent', on: { click: () => run(() => link.create(name.value), 'Group created') } }, ui.icon('plus', { size: 18 }), 'Create group'),
    ui.el('label', { class: 'field', for: 'rg-code' }, ui.el('span', { text: 'Or join one' }), code),
    ui.el('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => run(() => link.join(code.value), 'You joined the group') } }, 'Join with code'),
    status,
  );
}

function shareBox(ui, link) {
  const panel = ui.el('div', { class: 'stack', hidden: true });
  const toggle = ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-expanded': 'false' }, ui.icon('qr', { size: 18 }), 'Share group code');
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !panel.firstChild) {
      const code = link.code();
      const box = ui.el('input', { class: 'input rg-code-text', readonly: 'readonly', value: code, 'aria-label': 'Group code' });
      try {
        panel.append(ui.el('div', { class: 'cm-qr-box rg-qr' }, qrSvg(code, { label: 'QR code of the group code' })));
      } catch (err) {
        console.warn('[race] QR failed', err?.message);
      }
      panel.append(box, ui.el('button', {
        type: 'button', class: 'btn btn-sm btn-ghost', text: 'Copy code',
        on: { click: () => navigator.clipboard?.writeText(code).then(() => ui.toast('Group code copied', { tone: 'good' })).catch(() => box.select()) },
      }));
    }
  });
  return [toggle, panel];
}

function swatches(ui, link) {
  const taken = link.taken();
  const mine = link.mine()?.colour;
  return ui.el(
    'div',
    { class: 'rg-swatches', role: 'radiogroup', 'aria-label': 'Your group colour' },
    link.palette.map((c) => {
      const owner = taken.get(c.id);
      return ui.el('button', {
        type: 'button', class: 'rg-swatch', role: 'radio', 'aria-checked': String(c.id === mine),
        'aria-label': owner ? `${c.name}, taken by ${owner.name}` : c.name, title: owner ? `Taken by ${owner.name}` : c.name,
        disabled: Boolean(owner), style: { background: c.hex },
        on: { click: () => link.chooseColour(c.id) },
      });
    }),
  );
}

function memberRow(ui, m, geo) {
  const colour = colourById(m.colour);
  const ago = Math.round((Date.now() - m.at) / 1000);
  const where = m.trackName ? `On ${m.trackName}${m.laps ? ` · ${m.laps} laps` : ''}` : 'In the group';
  return ui.el(
    'div',
    { class: 'row rg-member' },
    ui.el('span', { class: 'rg-dot', style: { background: colour?.hex ?? 'var(--line)' }, 'aria-hidden': 'true' }),
    ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: m.name }), ui.el('span', { class: 'row-hint', text: ago < 20 ? `${where} · live` : `${where} · ${ago}s ago` })),
    ui.el('span', { class: 'row-meta race-lap-time', text: m.best ? formatLap(m.best) : '–' }),
  );
}

/** Render into container; re-renders itself when the group changes. */
export function renderGroupSection(container, link, ctx) {
  const { ui, store, geo } = ctx;
  const rerender = () => {
    if (!container.isConnected) return;
    ui.clear(container);
    draw();
  };
  const off = link.onChange(() => (container.isConnected ? rerender() : off()));

  function draw() {
    const g = link.group();
    if (!g) {
      container.append(lobby(ui, link, rerender));
      return;
    }
    const members = link.members();
    const colour = colourById(link.mine()?.colour);
    container.append(
      ui.el('div', { class: 'card stack rg-card' },
        ui.el('div', { class: 'spread' },
          ui.el('strong', { class: 'rg-name', text: g.name }),
          ui.el('span', { class: 'small muted', text: `${members.length + 1} ${members.length ? 'drivers' : 'driver (just you)'}` })),
        store.get().settings.ghostMode ? ui.el('p', { class: 'small rg-ghost', text: 'Ghost mode is on, so the group can’t see you. Turn it off in Settings → Privacy to race together.' }) : null,
        ...shareBox(ui, link),
        ui.el('p', { class: 'section-title', text: `Your colour${colour ? `: ${colour.name}` : ''}` }),
        swatches(ui, link),
        ui.el('p', { class: 'small muted', text: 'Your car shows this colour while you’re in the group. Greyed-out colours are taken.' }),
        ui.el('p', { class: 'section-title', text: 'Best laps' }),
        members.length
          ? ui.el('div', { class: 'list' }, members.map((m) => memberRow(ui, m, geo)))
          : ui.el('p', { class: 'small muted', text: 'Nobody else yet. Share the code with your crew.' }),
        ui.el('button', { type: 'button', class: 'btn btn-go btn-block', on: { click: () => link.startRace() } }, ui.icon('flag', { size: 22 }), 'Start group race'),
        ui.el('p', { class: 'small muted', text: 'Everyone in the group gets the same 30-second countdown.' }),
        twoTapButton(ui, { text: 'Leave group', armedText: 'Tap again to leave', className: 'btn btn-ghost btn-block', label: `Leave ${g.name}`, onConfirm: () => link.leave() }),
      ),
    );
  }

  draw();
}
