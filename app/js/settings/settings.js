// Settings panel: driving, route preferences, plus sections other modules register.
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
    id: 'about', title: 'About', order: 100,
    render(c) {
      c.append(
        ui.el(
          'div',
          { class: 'card stack small' },
          ui.el('strong', { text: `${config.APP_NAME} ${config.APP_VERSION}` }),
          ui.el('span', { class: 'muted', text: 'Map data © OpenStreetMap contributors, tiles by OpenFreeMap. Routes by OSRM and Valhalla. Places by Photon (komoot). Friends and hazard reports travel over public Nostr relays: your location is end-to-end encrypted and only goes to friends you choose.' }),
          ui.el('span', { class: 'muted', text: 'Drive safely: set your route before you move and keep your eyes on the road.' }),
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
