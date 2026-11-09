// Hold-to-talk speech-to-text (Web Speech API, en-AU). Interim words show live; the final
// text is handed back for review before sending.
import { cleanText } from './sanitize.js';

const RecognitionCtor = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

export const speechSupported = () => !!RecognitionCtor();

const ERROR_TEXT = {
  'not-allowed': 'Microphone is blocked. Allow it in your browser settings to talk.',
  'service-not-allowed': 'Voice typing isn’t allowed on this browser.',
  'no-speech': 'Didn’t catch that. Hold the mic and speak.',
  network: 'Voice typing needs signal.',
  'audio-capture': 'No microphone found.',
};

/**
 * @param {{onText:(text:string)=>void, onDone:(text:string)=>void, onState:(listening:boolean)=>void, onError:(msg:string)=>void}} cb
 */
export function createHoldToTalk({ onText, onDone, onState, onError }) {
  const Ctor = RecognitionCtor();
  let rec = null;
  let listening = false;
  let text = '';

  function start() {
    if (!Ctor || listening) return;
    text = '';
    try {
      rec = new Ctor();
      rec.lang = 'en-AU';
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let out = '';
        for (let i = 0; i < e.results.length; i++) out += `${e.results[i][0]?.transcript ?? ''} `;
        text = cleanText(out, 500);
        onText(text);
      };
      rec.onerror = (e) => {
        if (e?.error !== 'aborted') onError(ERROR_TEXT[e?.error] ?? 'Voice typing stopped. Try again.');
      };
      rec.onend = () => {
        listening = false;
        onState(false);
        onDone(text);
      };
      rec.start();
      listening = true;
      onState(true);
    } catch (err) {
      listening = false;
      onState(false);
      onError('Voice typing couldn’t start. Try again.');
      console.warn('[social] speech start failed', err?.message);
    }
  }

  function stop() {
    if (!rec || !listening) return;
    try {
      rec.stop();
    } catch (err) {
      console.warn('[social] speech stop failed', err?.message);
    }
  }

  /** Wire press-and-hold (pointer) and hold Space/Enter (keyboard) onto a button. */
  function bind(button) {
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      button.setPointerCapture?.(e.pointerId);
      start();
    });
    for (const evt of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(evt, () => stop());
    button.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        start();
      }
    });
    button.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') stop();
    });
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return Object.freeze({ supported: !!Ctor, start, stop, bind, isListening: () => listening });
}
