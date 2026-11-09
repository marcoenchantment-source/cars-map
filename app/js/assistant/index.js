// Voice copilot: mic FAB + copilotListen/copilotAsk actions, intent executor, calls/texts/music
// links, Quick contacts settings, and the optional Claude-powered fallback.
import { createExecutor } from './executor.js';
import { createBubble } from './bubble.js';
import { getRecognition, startListening, errorMessage } from './listen.js';
import { createContactsStore, renderContactsSection } from './contactsSettings.js';
import { createClaudeSession } from './claude.js';
import { buildTools } from './tools.js';
import { reply } from './reply.js';
import { formatClock } from './phrases.js';

const IS_IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent ?? '');

function canOpenNow() {
  return !!(typeof navigator !== 'undefined' && navigator.userActivation?.isActive);
}

/** Open a link from inside the user's gesture (tel:, sms:, music sites). */
function openLink(link) {
  const a = document.createElement('a');
  a.href = link.href;
  if (link.kind === 'web') {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
}

function speakLocally(text) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-AU';
    synth.speak(u);
  } catch (err) {
    console.warn('[copilot] speech failed', err);
  }
}

export async function init(ctx) {
  const { ui, store, bus, actions, storage, config, geo } = ctx;
  const contacts = createContactsStore(storage);
  const bubble = createBubble({ ui, host: document.getElementById('app') });
  let lastIncoming = null;
  bus.on('chat:message', (m) => {
    if (m?.incoming && typeof m.from?.name === 'string') lastIncoming = m.from.name;
  });

  const getNear = () => {
    const p = store.get().position;
    if (p && Number.isFinite(p.lng) && Number.isFinite(p.lat)) return [p.lng, p.lat];
    const c = ctx.map?.getCenter?.();
    return c ? [c.lng, c.lat] : null;
  };

  let friendNames = [];
  bus.on('friends:updated', (e) => {
    friendNames = Array.isArray(e?.friends) ? e.friends.map((f) => f?.name).filter((n) => typeof n === 'string') : [];
  });

  let claudeSession = null;
  const executor = createExecutor({
    actions, getState: () => store.get(), config, geo, getNear, canOpenNow, isIOS: IS_IOS,
    getContacts: () => contacts.all(),
    lastIncoming: () => lastIncoming,
    closeSheet: () => ui.sheet.close(),
    claude: async (text) => {
      const r = await claudeSession.ask(text);
      const links = r.replies.flatMap((x) => x.links ?? []);
      const buttons = r.replies.flatMap((x) => x.buttons ?? []);
      return reply(r.text, { links, buttons, tone: r.error ? 'warn' : 'info' });
    },
  });

  claudeSession = createClaudeSession({
    endpoint: config.ENDPOINTS.anthropic,
    getApiKey: () => store.get().settings.anthropicKey,
    fetchImpl: (...args) => fetch(...args),
    tools: buildTools(config.HAZARD_TYPES),
    runTool: (name, input) => executor.runTool(name, input),
    getContext: () => contextSnapshot(),
  });

  function contextSnapshot() {
    const s = store.get();
    const p = s.progress;
    const nav = s.mode === 'navigate' && p && Number.isFinite(p.durationRemaining)
      ? { destination: s.destination?.name ?? '', minutesLeft: Math.round(p.durationRemaining / 60), kmLeft: (p.distanceRemaining / 1000).toFixed(1) }
      : null;
    return {
      clock: formatClock(Date.now()),
      position: s.position && Number.isFinite(s.position.lat) ? { lat: s.position.lat, lng: s.position.lng } : null,
      mode: s.mode,
      destination: s.destination?.name ?? '',
      nav,
      friends: friendNames,
      contacts: contacts.all().map((c) => c.name),
      avoid: { tolls: !!s.settings.avoidTolls, freeways: !!s.settings.avoidMotorways, ferries: !!s.settings.avoidFerries },
    };
  }

  function speak(text) {
    if (!text) return;
    if (actions.has('say')) bus.emit('voice:say', { text, priority: 'high' });
    else if (store.get().settings.voice !== false) speakLocally(text);
  }

  function onButton(action) {
    if (action === 'settings') bus.emit('settings:open', {});
    else if (action === 'contacts') bus.emit('settings:open', { focus: 'contact-name' });
    else if (action === 'listen') listen();
    else if (action === 'type') openCompose();
  }

  function present(r) {
    if (r.speak !== false) speak(r.text);
    const auto = (r.links ?? []).find((l) => l.autoOpen);
    if (auto && canOpenNow()) {
      openLink(auto);
      bubble.showReply({ ...r, links: r.links.filter((l) => l !== auto) }, { onButton });
      return;
    }
    bubble.showReply(r, { onButton });
  }

  async function respond(input) {
    bubble.working();
    let r;
    try {
      r = await executor.handle(input);
    } catch (err) {
      console.error('[copilot] request failed', err);
      r = reply("Sorry, that didn't work. Try again.", { tone: 'warn' });
    }
    present(r);
    return r;
  }

  function openCompose(message = '') {
    stopSession();
    bubble.compose({ message, onSubmit: (t) => respond(t), onRetry: getRecognition(window) ? () => listen() : null });
  }

  let session = null; // {abort} of the live recogniser
  let token = null; // identifies the live session so late events from old ones are ignored
  const fab = ui.addFab({ id: 'copilot', icon: 'mic', label: 'Ask the copilot', order: 40, tone: 'accent', onClick: () => (token ? cancel() : listen()) });

  function stopSession() {
    const s = session;
    session = null;
    token = null;
    fab.dataset.active = 'false';
    try {
      s?.abort();
    } catch (err) {
      console.warn('[copilot] abort failed', err);
    }
  }

  function cancel() {
    stopSession();
    bubble.hide();
  }

  function finish(mine) {
    if (token !== mine) return false;
    token = null;
    session = null;
    fab.dataset.active = 'false';
    return true;
  }

  function onListenError(kind) {
    if (kind === 'aborted') bubble.hide();
    else if (kind === 'no-speech') bubble.showReply(reply("I didn't hear anything. Tap the mic and try again.", { speak: false, buttons: [{ label: 'Type instead', action: 'type' }] }), { onButton });
    else openCompose(errorMessage(kind));
  }

  function listen() {
    const Recognition = getRecognition(window);
    if (!Recognition) {
      openCompose(errorMessage('unsupported'));
      return;
    }
    stopSession();
    try {
      window.speechSynthesis?.cancel(); // don't transcribe our own voice
    } catch (err) {
      console.warn('[copilot] could not pause speech', err);
    }
    const pill = bubble.listening({ onCancel: cancel, onType: () => openCompose() });
    const mine = {};
    token = mine;
    fab.dataset.active = 'true';
    const handle = startListening(Recognition, {
      onInterim: (t) => token === mine && pill.setText(t),
      onSound: (on) => token === mine && pill.setSound(on),
      onResult: (alts) => finish(mine) && respond(alts),
      onError: (kind) => finish(mine) && onListenError(kind),
    });
    if (token === mine) session = handle;
  }

  actions.register('copilotListen', listen);
  actions.register('copilotAsk', (text) => respond(String(text ?? '')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bubble.isOpen()) cancel();
  });

  ui.registerSettingsSection({ id: 'contacts', title: 'Quick contacts', order: 60, render: (c) => renderContactsSection(c, { ui, contacts }) });
}
