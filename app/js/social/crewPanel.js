// The Crew sheet: connection status, friends (location switch, chat, remove), add a friend,
// my friend code (text, copy, QR) and the community road-changes summary.
import { qrSvg } from './qr.js';
import { renderThread } from './chatView.js';

const SHEET_ID = 'social-crew';

export function createCrewPanel(ctx, { nostr, friends, chat, location, roads }) {
  const { ui, config } = ctx;
  let view = { name: 'list' };
  let parts = null;
  let thread = null;

  function statusText() {
    const st = nostr.status();
    if (st.state === 'online') return `Connected · ${st.connected} of ${st.total} servers`;
    if (st.state === 'connecting') return 'Connecting…';
    return 'Offline. Friends, chat and reports sync when you have signal.';
  }

  function friendHint(f) {
    const live = location.describe(f.pubkey);
    if (live) return live;
    return f.linked ? 'Not sharing their location with you' : 'Waiting for them to add you back';
  }

  function removeControl(f) {
    const box = ui.el('div', { class: 'cm-remove' });
    const ask = () => {
      ui.clear(box);
      box.append(
        ui.el('span', { class: 'small', text: `Remove ${f.name}?` }),
        ui.el('button', { type: 'button', class: 'btn btn-sm btn-danger', text: 'Remove', on: { click: () => {
          friends.remove(f.pubkey);
          chat.forget(f.pubkey);
          ui.toast(`${f.name} removed`);
        } } }),
        ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Cancel', on: { click: reset } }),
      );
    };
    const reset = () => {
      ui.clear(box);
      if (!f.linked) {
        box.append(ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Say hello again', on: { click: () => {
          chat.sendHello(f.pubkey).then(() => ui.toast('Hello sent', { tone: 'good' })).catch((err) => ui.toast(err.message, { tone: 'bad' }));
        } } }));
      }
      box.append(ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Remove', on: { click: ask } }));
    };
    reset();
    return box;
  }

  function friendCard(f) {
    const unread = chat.unread(f.pubkey);
    return ui.el(
      'div',
      { class: 'cm-friend-card' },
      ui.el(
        'button',
        { type: 'button', class: 'row cm-friend-row', 'aria-label': `Chat with ${f.name}`, on: { click: () => open(f.pubkey) } },
        ui.el('span', { class: 'cm-avatar', style: f.car?.color ? { background: f.car.color } : null, text: f.name.slice(0, 1).toUpperCase() }),
        ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: f.name }), ui.el('span', { class: 'row-hint', text: friendHint(f) })),
        unread ? ui.el('span', { class: 'cm-badge', text: String(unread), 'aria-label': `${unread} unread` }) : null,
        ui.el('span', { class: 'row-icon' }, ui.icon('message', { size: 20 })),
      ),
      ui.toggleRow({
        id: `cm-share-${f.pubkey.slice(0, 16)}`,
        label: 'Share my location',
        hint: f.sharing ? `${f.name} can see where you are` : `${f.name} can’t see you`,
        checked: f.sharing,
        onChange: (on) => friends.setSharing(f.pubkey, on),
      }),
      removeControl(f),
    );
  }

  function renderFriends() {
    if (!parts) return;
    ui.clear(parts.friends);
    const list = friends.all();
    if (list.length === 0) {
      parts.friends.append(ui.el('p', { class: 'muted small', text: 'No one in your crew yet. Share your friend code below, or paste a friend’s code.' }));
    }
    for (const f of list) parts.friends.append(friendCard(f));
    parts.status.textContent = statusText();
    parts.status.dataset.state = nostr.status().state;
  }

  function addFriendForm() {
    const code = ui.el('input', { class: 'input', id: 'cm-add-code', placeholder: 'npub1…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const name = ui.el('input', { class: 'input', id: 'cm-add-name', placeholder: 'e.g. Sam', maxlength: '32', autocomplete: 'off' });
    const error = ui.el('p', { class: 'small cm-error', role: 'alert' });
    const btn = ui.el('button', { type: 'button', class: 'btn btn-accent', text: 'Add friend' });
    btn.addEventListener('click', async () => {
      error.textContent = '';
      btn.disabled = true;
      try {
        const f = await friends.addByCode(code.value, name.value);
        code.value = '';
        name.value = '';
        ui.toast(`${f.name} added to your crew`, { tone: 'good' });
        chat.sendHello(f.pubkey).catch(() => ui.toast('Added. Tap “Say hello again” when you have signal.', { tone: 'warn', ms: 4500 }));
      } catch (err) {
        error.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
    return ui.el(
      'div',
      { class: 'card stack' },
      ui.el('label', { class: 'field', for: 'cm-add-code' }, ui.el('span', { text: 'Friend code' }), code),
      ui.el('label', { class: 'field', for: 'cm-add-name' }, ui.el('span', { text: 'Name (optional)' }), name),
      error,
      btn,
    );
  }

  function myCodeCard() {
    const nameInput = ui.el('input', { class: 'input', id: 'cm-my-name', maxlength: '32', value: friends.profileName(), placeholder: friends.myName() });
    nameInput.addEventListener('change', () => friends.setProfileName(nameInput.value));
    const codeBox = ui.el('input', { class: 'input cm-code', id: 'cm-my-code', readonly: 'readonly', value: 'Loading…', 'aria-label': 'Your friend code' });
    const qrBox = ui.el('div', { class: 'cm-qr-box' });
    const copy = ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: true }, ui.icon('copy', { size: 18 }), 'Copy');
    const share = navigator.share ? ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: true }, ui.icon('share', { size: 18 }), 'Share') : null;
    nostr.start().then(() => {
      const npub = nostr.npub();
      codeBox.value = npub;
      copy.disabled = false;
      if (share) share.disabled = false;
      try {
        qrBox.append(qrSvg(npub, { label: 'QR code of your friend code' }));
      } catch (err) {
        console.warn('[social] QR failed', err?.message);
      }
      copy.addEventListener('click', () => {
        navigator.clipboard?.writeText(npub)
          .then(() => ui.toast('Friend code copied', { tone: 'good' }))
          .catch(() => {
            codeBox.select();
            ui.toast('Press and hold the code to copy it');
          });
      });
      share?.addEventListener('click', () => navigator.share({ title: 'My Cars Map friend code', text: npub }).catch(() => {}));
    }).catch(() => {
      codeBox.value = 'Unavailable right now. Reload to try again.';
    });
    return ui.el(
      'div',
      { class: 'card stack' },
      ui.el('label', { class: 'field', for: 'cm-my-name' }, ui.el('span', { text: 'Your name (friends see this)' }), nameInput),
      ui.el('label', { class: 'field', for: 'cm-my-code' }, ui.el('span', { text: 'Your friend code' }), codeBox),
      ui.el('div', { class: 'cluster' }, copy, share),
      qrBox,
    );
  }

  function renderRoads() {
    if (!parts) return;
    ui.clear(parts.roads);
    const threshold = config.ROAD_CONSENSUS_USERS;
    parts.roads.append(ui.el('p', { class: 'small muted', text: `When ${threshold} different drivers drive the same road that isn’t on the map, it’s added for everyone.` }));
    const summary = roads?.summary?.();
    if (!summary) return;
    if (summary.confirmed > 0) {
      parts.roads.append(ui.el('p', { class: 'small', text: `${summary.confirmed} new ${summary.confirmed === 1 ? 'road' : 'roads'} confirmed near you.` }));
    }
    if (summary.pending.length === 0) {
      parts.roads.append(ui.el('p', { class: 'small muted', text: 'No unconfirmed road changes near you.' }));
      return;
    }
    const list = ui.el('div', { class: 'list' });
    for (const p of summary.pending.slice(0, 6)) {
      list.append(ui.el(
        'div',
        { class: 'row' },
        ui.el('span', { class: 'row-icon' }, ui.icon('route', { size: 20 })),
        ui.el('span', { class: 'row-text' },
          ui.el('span', { class: 'row-title', text: p.mine ? 'Road you drove' : 'Unmapped road' }),
          ui.el('span', { class: 'row-hint', text: `${p.lengthText} long` })),
        ui.el('span', { class: 'row-meta', text: `${Math.min(p.drivers, threshold)} / ${threshold} drivers` }),
      ));
    }
    parts.roads.append(list);
  }

  function renderList(body, api) {
    api.setTitle('Crew');
    chat.setViewing(null);
    parts = {
      status: ui.el('p', { class: 'small cm-status', 'aria-live': 'polite' }),
      friends: ui.el('div', { class: 'stack cm-friends' }),
      roads: ui.el('div', { class: 'stack' }),
    };
    body.append(
      parts.status,
      ui.el('h3', { class: 'section-title', text: 'Your crew' }),
      parts.friends,
      ui.el('h3', { class: 'section-title', text: 'Add a friend' }),
      addFriendForm(),
      ui.el('h3', { class: 'section-title', text: 'Your friend code' }),
      myCodeCard(),
      ui.el('h3', { class: 'section-title', text: 'Road changes' }),
      parts.roads,
    );
    renderFriends();
    renderRoads();
  }

  function render(body, api) {
    const friend = view.name === 'thread' ? friends.get(view.pubkey) : null;
    if (!friend) {
      view = { name: 'list' };
      renderList(body, api);
      return;
    }
    api.setTitle(friend.name);
    chat.setViewing(friend.pubkey);
    thread = renderThread(body, { ui, chat, friend, describe: location.describe, onBack: () => open() });
  }

  function onClose() {
    thread?.stop();
    thread = null;
    parts = null;
    chat.setViewing(null);
  }

  /** Open the Crew list, or a friend's thread when a pubkey is given. */
  function open(pubkey = null) {
    thread?.stop();
    thread = null;
    parts = null;
    view = pubkey ? { name: 'thread', pubkey } : { name: 'list' };
    ui.sheet.open({ id: SHEET_ID, title: 'Crew', size: 'tall', render, onClose });
  }

  const isOpen = () => ui.sheet.currentId() === SHEET_ID;

  return Object.freeze({
    open,
    refreshFriends: () => isOpen() && renderFriends(),
    refreshRoads: () => isOpen() && renderRoads(),
    refreshThread(pubkey) {
      if (!isOpen()) return;
      if (thread && view.pubkey === pubkey) thread.update();
      else renderFriends();
    },
  });
}
