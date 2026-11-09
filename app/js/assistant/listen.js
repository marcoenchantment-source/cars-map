// Speech-to-text with the Web Speech API (en-AU, interim results, 3 alternatives).
// The recogniser constructor is injected so the logic is testable without a browser.

const MAX_LISTEN_MS = 12000;

/** The browser's recogniser constructor, or null when voice input isn't supported. */
export function getRecognition(win = globalThis) {
  return win?.SpeechRecognition ?? win?.webkitSpeechRecognition ?? null;
}

/** SpeechRecognitionErrorEvent.error → what we tell the driver. */
export function classifyError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'blocked';
    case 'audio-capture':
      return 'no-mic';
    case 'network':
      return 'network';
    case 'no-speech':
      return 'no-speech';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

/**
 * Read a SpeechRecognitionResultList: the live transcript, whether it's final, and the
 * alternatives for the whole utterance (earlier segments + each alternative of the last).
 */
export function readResults(results) {
  const list = Array.from(results ?? []);
  if (!list.length) return { transcript: '', final: false, alternatives: [] };
  const best = (r) => String(r?.[0]?.transcript ?? '');
  const transcript = list.map(best).join(' ').replace(/\s+/g, ' ').trim();
  const final = list.every((r) => r?.isFinal);
  const prefix = list.slice(0, -1).map(best).join(' ');
  const last = list[list.length - 1];
  const alternatives = Array.from(last ?? [])
    .map((alt) => `${prefix} ${alt?.transcript ?? ''}`.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return { transcript, final, alternatives: alternatives.length ? alternatives : [transcript] };
}

/**
 * Start one listening session.
 * handlers: onInterim(text), onSound(active), onResult(alternatives[]), onError(kind), onEnd()
 * @returns {{stop: Function, abort: Function}}
 */
export function startListening(Recognition, handlers, { lang = 'en-AU', timeoutMs = MAX_LISTEN_MS } = {}) {
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  let finalAlts = null;
  let interim = '';
  let error = null;
  let done = false;

  rec.onresult = (e) => {
    const r = readResults(e.results);
    interim = r.transcript;
    if (r.final) finalAlts = r.alternatives;
    handlers.onInterim?.(r.transcript);
  };
  rec.onsoundstart = () => handlers.onSound?.(true);
  rec.onspeechstart = () => handlers.onSound?.(true);
  rec.onspeechend = () => handlers.onSound?.(false);
  rec.onerror = (e) => {
    error = classifyError(e?.error);
  };
  rec.onend = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (finalAlts?.length) handlers.onResult?.(finalAlts);
    else if (interim && error !== 'aborted') handlers.onResult?.([interim]);
    else handlers.onError?.(error ?? 'no-speech');
    handlers.onEnd?.();
  };

  const timer = setTimeout(() => {
    try {
      rec.stop();
    } catch (err) {
      console.warn('[copilot] stop failed', err);
    }
  }, timeoutMs);

  try {
    rec.start();
  } catch (err) {
    console.warn('[copilot] speech recognition did not start', err);
    clearTimeout(timer);
    done = true;
    handlers.onError?.('unknown');
    handlers.onEnd?.();
  }

  return {
    stop: () => rec.stop(),
    abort: () => {
      error = 'aborted';
      finalAlts = null;
      interim = '';
      rec.abort();
    },
  };
}

/** Driver-facing explanation for a listening failure. */
export function errorMessage(kind) {
  switch (kind) {
    case 'blocked':
      return 'The microphone is blocked for Cars Map. Tap the icon beside the address bar, then Permissions → Microphone → Allow, and reload. You can type below meanwhile.';
    case 'no-mic':
      return "I can't find a microphone. Type your request below.";
    case 'network':
      return 'Voice input needs signal. Try again, or type below.';
    case 'unsupported':
      return "This browser can't do voice input. Type your request below. Chrome on Android works best.";
    default:
      return "Voice input didn't start. Type your request below.";
  }
}
