// Settings panel: driving, route preferences, optional keys, plus sections other modules register.
const TOMTOM_KEY_RE = /^[A-Za-z0-9]{20,64}$/;
const ANTHROPIC_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

function keyField({ ui, id, label, hint, value, placeholder, validate, onSave, link }) {
  const input = ui.el('input', {
    id, class: 'input', type: 'password', value: value ?? '', placeholder,
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': `${id}-hint`,
  });
  const status = ui.el('span', { class: 'row-hint', id: `${id}-hint`, text: hint });
  const show = ui.el('button', {
    type: 'button', class: 'btn btn-sm btn-ghost', text: 'Show',
    on: {
      click: () => {
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        show.textContent = hidden ? 'Hide' : 'Show';
      },
    },
  });
  const save = ui.el('button', {
    type: 'button', class: 'btn btn-sm btn-accent', text: 'Save',
    on: {
      click: () => {
        const v = input.value.trim();
        if (v && !validate(v)) {
          status.textContent = 'That doesn’t look like a valid key. Copy it again and paste the whole thing.';
          input.focus();
          return;
        }
        onSave(v);
        status.textContent = v ? 'Saved on this phone only.' : 'Removed.';
        ui.toast(v ? `${label} saved` : `${label} removed`, { tone: 'good' });
      },
    },
  });
  return ui.el(
    'div',
    { class: 'card stack' },
    ui.el('label', { class: 'field', for: id }, ui.el('span', { text: label }), input),
    status,
    link ? ui.el('a', { href: link.href, target: '_blank', rel: 'noopener', class: 'small', text: link.text }) : null,
    ui.el('div', { class: 'cluster' }, save, show),
  );
}

export function initSettings(ctx) {
  const { store, bus, ui, config } = ctx;
  const setSetting = (key, value) => store.set((s) => ({ settings: { ...s.settings, [key]: value } }));

  ui.registerSettingsSection({
    id: 'driving', title: 'Driving', order: 10,
    render(c) {
      const s = store.get().settings;
      c.append(
        ui.el(
          'div',
          { class: 'list' },
          ui.toggleRow({ id: 'set-voice', label: 'Voice directions', hint: 'Spoken turn-by-turn guidance', checked: s.voice, onChange: (v) => setSetting('voice', v) }),
          ui.toggleRow({ id: 'set-car3d', label: '3D car', hint: 'Turn off to save battery on older phones', checked: s.car3d, onChange: (v) => setSetting('car3d', v) }),
        ),
        ui.segmented({
          id: 'set-units', label: 'Units', value: s.units,
          options: [{ value: 'metric', label: 'Kilometres' }, { value: 'imperial', label: 'Miles' }],
          onChange: (v) => setSetting('units', v),
        }),
      );
    },
  });

  ui.registerSettingsSection({
    id: 'route', title: 'Route preferences', order: 20,
    render(c) {
      const s = store.get().settings;
      c.append(
        ui.el(
          'div',
          { class: 'list' },
          ui.toggleRow({ id: 'set-tolls', label: 'Avoid tolls', checked: s.avoidTolls, onChange: (v) => setSetting('avoidTolls', v) }),
          ui.toggleRow({ id: 'set-motorways', label: 'Avoid freeways', checked: s.avoidMotorways, onChange: (v) => setSetting('avoidMotorways', v) }),
          ui.toggleRow({ id: 'set-ferries', label: 'Avoid ferries', checked: s.avoidFerries, onChange: (v) => setSetting('avoidFerries', v) }),
        ),
      );
    },
  });

  ui.registerSettingsSection({
    id: 'keys', title: 'Live traffic & AI', order: 70,
    render(c) {
      const s = store.get().settings;
      c.append(
        keyField({
          ui, id: 'tomtomKey', label: 'TomTom key (live traffic)', value: s.tomtomKey, placeholder: 'Paste your TomTom API key',
          hint: 'Free from TomTom’s developer site. Turns on live traffic colours and traffic-aware routes.',
          link: { href: 'https://developer.tomtom.com/', text: 'Get a free TomTom key' },
          validate: (v) => TOMTOM_KEY_RE.test(v),
          onSave: (v) => setSetting('tomtomKey', v),
        }),
        keyField({
          ui, id: 'anthropicKey', label: 'Claude key (smarter copilot)', value: s.anthropicKey, placeholder: 'sk-ant-…',
          hint: 'Optional. The copilot already understands driving commands; a key lets it answer anything.',
          link: { href: 'https://console.anthropic.com/', text: 'Get a Claude API key' },
          validate: (v) => ANTHROPIC_KEY_RE.test(v),
          onSave: (v) => setSetting('anthropicKey', v),
        }),
      );
    },
  });

  ui.registerSettingsSection({
    id: 'about', title: 'About', order: 100,
    render(c) {
      c.append(
        ui.el(
          'div',
          { class: 'card stack small' },
          ui.el('strong', { text: `${config.APP_NAME} ${config.APP_VERSION}` }),
          ui.el('span', { class: 'muted', text: 'Map data © OpenStreetMap contributors, tiles by OpenFreeMap. Routes by OSRM and Valhalla. Places by Photon (komoot). Friends and hazard reports travel over public Nostr relays: your location is end-to-end encrypted and only goes to friends you choose.' }),
          ui.el('span', { class: 'muted', text: 'Keys you add stay on this phone. Drive safely: set your route before you move and keep your eyes on the road.' }),
        ),
      );
    },
  });

  function open() {
    ui.sheet.open({
      id: 'settings',
      title: 'Settings',
      size: 'tall',
      render(body) {
        for (const section of ui.getSettingsSections()) {
          const container = ui.el('div', { class: 'stack', id: `settings-${section.id}` });
          body.append(ui.el('p', { class: 'section-title', text: section.title }), container);
          try {
            section.render(container, ctx);
          } catch (err) {
            console.error(`[settings] section ${section.id} failed`, err);
            container.append(ui.el('p', { class: 'muted small', text: 'This section could not load.' }));
          }
        }
      },
    });
  }

  ui.addDockItem({ id: 'settings', icon: 'settings', label: 'Settings', order: 90, onClick: open });
  bus.on('settings:open', (opts) => {
    open();
    if (opts?.focus) requestAnimationFrame(() => document.getElementById(opts.focus)?.focus());
  });
  ctx.actions.register('setSetting', (key, value) => {
    if (!(key in config.DEFAULT_SETTINGS)) throw new Error(`Unknown setting ${key}`);
    setSetting(key, value);
  });
  ctx.actions.register('openSettings', open);
}
