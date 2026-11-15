// Group race start: a big shared countdown (30 seconds) to an exact start time, so every
// phone in the group says "Go!" together. Spoken at 30, 10 and 5…1.
const SPEAK_AT = new Set([30, 20, 10, 5, 4, 3, 2, 1]);

export function initCountdown(ctx) {
  const { ui, bus } = ctx;
  let root = null;
  let timer = null;

  function close() {
    clearInterval(timer);
    root?.remove();
    root = null;
  }

  function show({ at, by }) {
    close();
    const num = ui.el('span', { class: 'rc-num num', 'aria-live': 'assertive' });
    const sub = ui.el('p', { class: 'rc-sub', text: by === 'You' ? 'You started a group race' : `${by} started a group race` });
    root = ui.el(
      'div',
      { class: 'rc', role: 'dialog', 'aria-label': 'Race start countdown' },
      ui.el('p', { class: 'rc-label', text: 'Race starts in' }),
      num,
      sub,
      ui.el('button', { type: 'button', class: 'btn btn-ghost rc-hide', text: 'Hide', on: { click: close } }),
    );
    document.getElementById('app')?.append(root);
    let lastSpoken = null;
    const tick = () => {
      const left = Math.ceil((at - Date.now()) / 1000);
      if (left <= 0) {
        num.textContent = 'GO!';
        root?.classList.add('is-go');
        if (lastSpoken !== 0) bus.emit('voice:say', { text: 'Go!', priority: 'high' });
        lastSpoken = 0;
        navigator.vibrate?.(600);
        clearInterval(timer);
        setTimeout(close, 1800);
        return;
      }
      num.textContent = String(left);
      if (SPEAK_AT.has(left) && lastSpoken !== left) {
        lastSpoken = left;
        bus.emit('voice:say', { text: left >= 10 ? `Race starts in ${left} seconds` : String(left), priority: 'high' });
      }
    };
    tick();
    timer = setInterval(tick, 200);
  }

  bus.on('race:countdown', show);
  return Object.freeze({ show, close });
}
