// The copilot's floating card above the dock: "Listening…" with live transcript and level bars,
// "Working on it…", then the reply with big tap targets (real <a href> for calls, texts, music).
// Also hosts the typed-request box used when the mic is unavailable (it doesn't replace the
// route-preview sheet). All text goes through ui.el (textContent).

const REPLY_MS = 7000;
const REPLY_WITH_ACTIONS_MS = 20000;

export function createBubble({ ui, host }) {
  const layer = ui.el('div', { class: 'copilot-layer', hidden: true });
  const card = ui.el('div', { class: 'copilot-card', role: 'status', 'aria-live': 'polite' });
  layer.append(card);
  host?.append(layer);
  let timer = null;

  function show(state) {
    clearTimeout(timer);
    ui.clear(card);
    card.dataset.state = state;
    layer.hidden = false;
  }

  function hide() {
    clearTimeout(timer);
    layer.hidden = true;
    ui.clear(card);
    card.dataset.state = '';
  }

  function level() {
    return ui.el('span', { class: 'copilot-level', 'aria-hidden': 'true' }, ui.el('i'), ui.el('i'), ui.el('i'), ui.el('i'));
  }

  /** Listening pill. Tap to cancel; "Type" switches to the text box. */
  function listening({ onCancel, onType }) {
    show('listening');
    const text = ui.el('span', { class: 'copilot-text', text: 'Listening…' });
    card.append(
      ui.el('button', { type: 'button', class: 'copilot-main', 'aria-label': 'Stop listening', on: { click: onCancel } }, ui.icon('mic', { size: 26 }), level(), text),
      ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost copilot-type', text: 'Type', on: { click: onType } }),
    );
    return {
      setText: (t) => {
        text.textContent = t || 'Listening…';
      },
      setSound: (on) => {
        card.dataset.sound = on ? 'on' : 'off';
      },
    };
  }

  function working(text = 'Working on it…') {
    show('working');
    card.append(ui.el('div', { class: 'copilot-main' }, ui.icon('spark', { size: 24 }), ui.el('span', { class: 'copilot-text', text })));
  }

  function actionLink(link, index) {
    const attrs = { class: `btn ${index === 0 ? 'btn-accent' : 'btn-ghost'} copilot-action`, href: link.href, text: link.label };
    if (link.kind === 'web') Object.assign(attrs, { target: '_blank', rel: 'noopener noreferrer' });
    return ui.el('a', { ...attrs, on: { click: () => setTimeout(hide, 400) } });
  }

  /** Show a Reply. onButton(action) handles in-app buttons (settings, contacts…). */
  function showReply(r, { onButton } = {}) {
    show('reply');
    card.classList.toggle('copilot-warn', r.tone === 'warn' || r.tone === 'bad');
    const links = r.links ?? [];
    const buttons = r.buttons ?? [];
    card.append(
      ui.el('div', { class: 'copilot-main' }, ui.icon(r.tone === 'warn' ? 'alert' : 'spark', { size: 24 }), ui.el('span', { class: 'copilot-text', text: r.text })),
      ui.el('button', { type: 'button', class: 'copilot-close', 'aria-label': 'Dismiss', on: { click: hide } }, ui.icon('close', { size: 18 })),
    );
    if (links.length || buttons.length) {
      card.append(
        ui.el(
          'div',
          { class: 'copilot-actions' },
          links.map(actionLink),
          buttons.map((b) => ui.el('button', { type: 'button', class: 'btn btn-ghost copilot-action', text: b.label, on: { click: () => { hide(); onButton?.(b.action); } } })),
        ),
      );
    }
    timer = setTimeout(hide, links.length || buttons.length ? REPLY_WITH_ACTIONS_MS : REPLY_MS);
  }

  /** Small typed-request box (fallback when voice isn't available). */
  function compose({ message = '', onSubmit, onRetry }) {
    show('compose');
    const input = ui.el('input', { class: 'input', type: 'text', id: 'copilot-input', placeholder: 'e.g. nearest servo', autocomplete: 'off', enterkeyhint: 'send', 'aria-label': 'Ask the copilot' });
    const submit = (text) => {
      const t = String(text ?? '').trim();
      if (t) onSubmit(t);
    };
    const form = ui.el(
      'form',
      { class: 'copilot-form', on: { submit: (e) => { e.preventDefault(); submit(input.value); } } },
      input,
      ui.el('button', { type: 'submit', class: 'btn btn-accent', 'aria-label': 'Send' }, ui.icon('send', { size: 20 })),
    );
    const chips = ['Nearest servo', 'How long left?', 'Report police', 'Play music'].map((c) =>
      ui.el('button', { type: 'button', class: 'chip', text: c, on: { click: () => submit(c) } }),
    );
    card.append(
      ui.el('div', { class: 'spread' }, ui.el('strong', { text: 'Ask the copilot' }), ui.el('button', { type: 'button', class: 'copilot-close', 'aria-label': 'Close', on: { click: hide } }, ui.icon('close', { size: 18 }))),
      message ? ui.el('p', { class: 'copilot-help small', text: message }) : null,
      form,
      ui.el('div', { class: 'cluster' }, chips, onRetry ? ui.el('button', { type: 'button', class: 'chip', on: { click: onRetry } }, ui.icon('mic', { size: 16 }), 'Try the mic') : null),
    );
    requestAnimationFrame(() => input.focus());
  }

  return Object.freeze({ listening, working, showReply, compose, hide, isOpen: () => !layer.hidden, state: () => card.dataset.state || '' });
}
