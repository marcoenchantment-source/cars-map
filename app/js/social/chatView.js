// One chat thread inside the Crew sheet: messages, quick replies, text box and a
// hold-to-talk mic that turns speech into text for review before sending.
import { QUICK_REPLIES } from './chat.js';
import { createHoldToTalk } from './voiceInput.js';

const timeText = (at) => new Date(at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

/**
 * @returns {{update: () => void, stop: () => void}}
 */
export function renderThread(body, { ui, chat, friend, describe, onBack }) {
  const list = ui.el('div', { class: 'cm-thread', role: 'log', 'aria-label': `Messages with ${friend.name}` });
  const status = ui.el('p', { class: 'small muted cm-chat-status', 'aria-live': 'polite' });
  const input = ui.el('input', {
    class: 'input cm-chat-input', type: 'text', maxlength: '500', autocomplete: 'off', enterkeyhint: 'send',
    placeholder: `Message ${friend.name}`, 'aria-label': `Message ${friend.name}`,
  });
  const sendBtn = ui.el('button', { type: 'button', class: 'btn btn-accent cm-send', 'aria-label': 'Send' }, ui.icon('send', { size: 22 }));
  const mic = ui.el('button', { type: 'button', class: 'cm-mic', 'aria-label': 'Hold to talk', title: 'Hold to talk', 'aria-pressed': 'false' }, ui.icon('mic', { size: 26 }));

  async function doSend(text) {
    if (!String(text).trim() || sendBtn.disabled) return;
    sendBtn.disabled = true;
    try {
      await chat.send(friend.pubkey, text);
      input.value = '';
      status.textContent = '';
    } catch (err) {
      status.textContent = err.message;
    } finally {
      sendBtn.disabled = false;
    }
  }

  const talk = createHoldToTalk({
    onText: (t) => {
      input.value = t;
    },
    onDone: (t) => {
      status.textContent = t ? 'Check it, then tap send.' : '';
    },
    onState: (on) => {
      mic.classList.toggle('is-listening', on);
      mic.setAttribute('aria-pressed', String(on));
      if (on) status.textContent = 'Listening… let go when you’re done.';
    },
    onError: (msg) => {
      status.textContent = msg;
    },
  });
  if (talk.supported) talk.bind(mic);
  else mic.hidden = true;

  sendBtn.addEventListener('click', () => doSend(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSend(input.value);
    }
  });

  function update() {
    ui.clear(list);
    const msgs = chat.thread(friend.pubkey);
    if (msgs.length === 0) {
      list.append(ui.el('p', { class: 'muted small cm-thread-empty', text: `Say g’day to ${friend.name}. Hold the mic to talk instead of typing.` }));
    }
    for (const m of msgs) {
      list.append(
        ui.el(
          'div',
          { class: `cm-msg ${m.incoming ? 'is-in' : 'is-out'}${m.failed ? ' is-failed' : ''}` },
          ui.el('span', { class: 'cm-msg-text', text: m.text }),
          ui.el('span', { class: 'cm-msg-meta', text: m.failed ? 'Not sent' : timeText(m.at) }),
        ),
      );
    }
    list.scrollTop = list.scrollHeight;
  }

  body.append(
    ui.el(
      'div',
      { class: 'cm-thread-head' },
      ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', on: { click: onBack } }, ui.icon('back', { size: 18 }), 'Crew'),
      ui.el('span', { class: 'small muted', text: describe(friend.pubkey) ?? '' }),
    ),
    list,
    ui.el(
      'div',
      { class: 'cm-quick', role: 'group', 'aria-label': 'Quick replies' },
      QUICK_REPLIES.map((q) => ui.el('button', { type: 'button', class: 'chip', text: q, on: { click: () => doSend(q) } })),
    ),
    ui.el('div', { class: 'cm-compose' }, mic, input, sendBtn),
    status,
  );
  update();
  return { update, stop: () => talk.stop() };
}
