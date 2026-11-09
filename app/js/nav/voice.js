// Spoken guidance: a small queue over speechSynthesis.
// Prefers an Australian English voice, then British, then any English. `high` priority cuts in.
// iPhone only lets a page speak after speech started inside a tap, so we "prime" it with a
// silent utterance on `voice:prime` (emitted inside the GO button's click) and on the first tap.

const MAX_QUEUE = 3;
const STALE_MS = 9000;
const AFTER_CANCEL_MS = 90;
const MAX_TEXT = 300;

function voiceRank(v) {
  const lang = String(v.lang || '').replace('_', '-').toLowerCase();
  if (lang === 'en-au') return 0;
  if (lang === 'en-gb') return 1;
  if (lang.startsWith('en')) return 2;
  return 9;
}

function pickVoice(synth) {
  let voices = [];
  try {
    voices = synth.getVoices() ?? [];
  } catch {
    return null;
  }
  const english = voices.filter((v) => voiceRank(v) < 9);
  english.sort((a, b) => voiceRank(a) - voiceRank(b) || Number(b.localService) - Number(a.localService) || Number(b.default) - Number(a.default));
  return english[0] ?? null;
}

export function createVoice({ store, bus, actions }) {
  const synth = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  const supported = !!synth && typeof Utterance === 'function';
  let voice = null;
  let queue = [];
  let speaking = null;
  let watchdog = null;
  let primed = false;

  const enabled = () => supported && store.get().settings.voice !== false;

  function refreshVoice() {
    if (supported) voice = pickVoice(synth);
  }

  function finish(u) {
    if (speaking !== u) return;
    clearTimeout(watchdog);
    speaking = null;
    pump();
  }

  function speakNow(item) {
    const u = new Utterance(item.text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-AU';
    u.rate = 1.02;
    u.pitch = 1;
    u.volume = 1;
    speaking = u;
    u.onend = () => finish(u);
    u.onerror = () => finish(u);
    // Some engines never fire `end`; never let one stuck utterance block guidance.
    watchdog = setTimeout(() => {
      if (speaking !== u) return;
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      finish(u);
    }, 4000 + item.text.length * 95);
    try {
      if (synth.paused) synth.resume();
      synth.speak(u);
    } catch (err) {
      console.warn('[voice] speak failed', err);
      finish(u);
    }
  }

  function pump() {
    if (speaking || !queue.length || !enabled()) return;
    const now = Date.now();
    const fresh = queue.filter((q) => q.priority === 'high' || now - q.at < STALE_MS);
    const [item, ...rest] = fresh;
    queue = rest;
    if (item) speakNow(item);
  }

  function cancelAll() {
    queue = [];
    clearTimeout(watchdog);
    speaking = null;
    if (!supported) return;
    try {
      synth.cancel();
    } catch {
      /* ignore */
    }
  }

  /** Speak text. priority 'high' interrupts whatever is being said. Returns false if not spoken. */
  function say(text, { priority = 'normal' } = {}) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!clean || !enabled()) return false;
    const item = { text: clean, priority: priority === 'high' ? 'high' : 'normal', at: Date.now() };
    if (item.priority === 'high') {
      const busy = !!speaking || synth.speaking || synth.pending;
      cancelAll();
      queue = [item];
      // Chrome drops an utterance spoken in the same tick as cancel(); give it a moment.
      if (busy) setTimeout(pump, AFTER_CANCEL_MS);
      else pump();
      return true;
    }
    queue = [...queue, item].slice(-MAX_QUEUE);
    pump();
    return true;
  }

  /** Unlock speech on iPhone. Must run inside a user gesture. */
  function prime() {
    if (!supported) return;
    try {
      const u = new Utterance(' ');
      u.volume = 0;
      synth.speak(u);
      primed = true;
    } catch (err) {
      console.warn('[voice] could not unlock speech', err);
    }
  }

  if (supported) {
    refreshVoice();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refreshVoice);
    else synth.onvoiceschanged = refreshVoice;
    const firstTap = () => {
      if (!primed) prime();
    };
    document.addEventListener('pointerup', firstTap, { once: true, capture: true });
    document.addEventListener('keydown', firstTap, { once: true, capture: true });
  }

  bus.on('voice:prime', prime);
  bus.on('voice:say', (p) => {
    if (p && typeof p.text === 'string') say(p.text, { priority: p.priority });
  });
  store.select(
    (s) => s.settings.voice,
    (on) => {
      if (on === false) cancelAll();
    },
  );
  actions.register('say', (text) => {
    say(text);
  });

  return Object.freeze({ say, cancel: cancelAll, prime, supported });
}
