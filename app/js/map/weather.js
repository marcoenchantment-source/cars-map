// Weather view: animated rain radar (RainViewer, last hour) over the map, plus a live conditions
// card (Open-Meteo) for the place you're looking at. Tap anywhere on the map to check there.
import { describeWeather, windFrom, parseForecast, parseRadarIndex, isSevere } from './weatherCodes.js';

const RADAR_PREFIX = 'cm-radar-';
const RADAR_MAXZOOM = 7; // free radar tiles stop here; MapLibre scales them up beyond
const FRAME_MS = 650;
const HOLD_LAST_MS = 1800;
const RADAR_REFRESH_MS = 10 * 60 * 1000;
const WEATHER_TTL_MS = 10 * 60 * 1000;
const MIN_MOVE_M = 2000;
const TIMEOUT_MS = 8000;

const clock = (unixSec) =>
  new Date(unixSec * 1000).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

function buildCard(ui, onToggleRadar) {
  const iconBox = ui.el('span', { class: 'wx-icon' });
  const temp = ui.el('span', { class: 'wx-temp num', text: '–' });
  const label = ui.el('strong', { class: 'wx-label', text: 'Checking the weather…' });
  const place = ui.el('span', { class: 'wx-place', text: '' });
  const chips = ui.el('div', { class: 'wx-chips' });
  const warn = ui.el('p', { class: 'wx-warn', hidden: true });
  const radarTime = ui.el('span', { class: 'wx-radar-time', text: 'Rain radar loading…' });
  const playBtn = ui.el('button', { type: 'button', class: 'wx-play', 'aria-label': 'Pause the radar loop', on: { click: onToggleRadar } }, ui.icon('stop', { size: 16 }));
  const root = ui.el(
    'section',
    { class: 'weather-card', 'aria-label': 'Weather', hidden: true },
    ui.el('div', { class: 'wx-main' }, iconBox, temp, ui.el('div', { class: 'wx-text' }, label, place)),
    chips,
    warn,
    ui.el('div', { class: 'wx-radar' }, playBtn, radarTime, ui.el('span', { class: 'wx-hint', text: 'Tap the map to check anywhere' })),
  );
  return { root, iconBox, temp, label, place, chips, warn, radarTime, playBtn };
}

export function initWeather(ctx) {
  const { store, ui, geo, config, mapView, actions } = ctx;
  const { map } = mapView;
  let radar = null;
  let frame = 0;
  let loopTimer = null;
  let refreshTimer = null;
  let playing = !mapView.reduceMotion;
  let last = null; // { lngLat, at }
  let pending = null;
  let pin = null;

  const card = buildCard(ui, () => {
    playing = !playing;
    card.playBtn.replaceChildren(ui.icon(playing ? 'stop' : 'play', { size: 16 }));
    card.playBtn.setAttribute('aria-label', playing ? 'Pause the radar loop' : 'Play the radar loop');
    playing ? loop() : showFrame(radar ? radar.frames.length - 1 : 0);
  });
  document.querySelector('.hud-top')?.append(card.root);

  const active = () => store.get().settings.mapView === 'weather';

  // ---------------------------------------------------------------- radar
  function clearRadar() {
    clearTimeout(loopTimer);
    for (let i = 0; i < 16; i++) {
      const id = `${RADAR_PREFIX}${i}`;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
  }

  function showFrame(i) {
    if (!radar) return;
    frame = i;
    radar.frames.forEach((_, k) => {
      const id = `${RADAR_PREFIX}${k}`;
      if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', k === i ? 0.72 : 0);
    });
    const f = radar.frames[i];
    const isLatest = i === radar.frames.length - 1;
    card.radarTime.textContent = `Rain radar · ${clock(f.time)}${isLatest ? ' (latest)' : ''}`;
  }

  function loop() {
    clearTimeout(loopTimer);
    if (!radar || !playing || !active() || document.hidden) return;
    const next = (frame + 1) % radar.frames.length;
    showFrame(next);
    loopTimer = setTimeout(loop, next === radar.frames.length - 1 ? HOLD_LAST_MS : FRAME_MS);
  }

  async function loadRadar() {
    try {
      const res = await fetch(config.ENDPOINTS.rainviewer, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`radar index ${res.status}`);
      const parsed = parseRadarIndex(await res.json());
      if (!parsed || !active()) return;
      clearRadar();
      radar = parsed;
      const beforeId = map.getLayer('label-road') ? 'label-road' : undefined;
      radar.frames.forEach((f, k) => {
        const id = `${RADAR_PREFIX}${k}`;
        map.addSource(id, {
          type: 'raster',
          tiles: [`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`],
          tileSize: 256,
          maxzoom: RADAR_MAXZOOM,
          attribution: 'Radar © RainViewer',
        });
        map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, beforeId);
      });
      showFrame(radar.frames.length - 1);
      if (playing) loopTimer = setTimeout(loop, HOLD_LAST_MS);
    } catch (err) {
      if (/not done loading/i.test(err?.message ?? '')) {
        map.once('idle', loadRadar);
        return;
      }
      console.warn('[weather] radar unavailable', err);
      card.radarTime.textContent = 'Rain radar unavailable right now';
    }
  }

  // ---------------------------------------------------------------- conditions
  function renderConditions(w, name) {
    const { label, icon } = describeWeather(w.code, w.isDay);
    card.iconBox.replaceChildren(ui.icon(icon, { size: 34 }));
    card.temp.textContent = `${Math.round(w.temp)}°`;
    card.label.textContent = label;
    const feels = w.feels != null ? `feels ${Math.round(w.feels)}°` : '';
    card.place.textContent = [name, feels].filter(Boolean).join(' · ');
    const chip = (iconName, text) => ui.el('span', { class: 'wx-chip' }, ui.icon(iconName, { size: 15 }), text);
    card.chips.replaceChildren(
      ...[
        w.windKmh != null ? chip('wind', `${windFrom(w.windDeg)} ${Math.round(w.windKmh)} km/h`) : null,
        w.rainChance != null ? chip('weather', `Rain ${w.rainChance}% next hr`) : null,
        w.humidity != null ? chip('drop', `${Math.round(w.humidity)}% humidity`) : null,
      ].filter(Boolean),
    );
    const severe = isSevere(w.code, w.windKmh ?? 0);
    card.warn.hidden = !severe;
    card.warn.textContent = severe ? `Take care: ${label.toLowerCase()}${(w.windKmh ?? 0) >= 60 ? ', strong wind' : ''}. Slow down and leave more room.` : '';
    card.root.dataset.severe = String(severe);
  }

  async function nameFor(lngLat) {
    if (!actions.has('reverseGeocode')) return '';
    try {
      const p = await actions.call('reverseGeocode', lngLat);
      return (p?.label?.split(',').map((s) => s.trim()).find((s) => s && !/^\d/.test(s)) || p?.name || '').slice(0, 40);
    } catch {
      return '';
    }
  }

  async function checkWeather(lngLat, { force = false } = {}) {
    const now = Date.now();
    if (!force && last && now - last.at < WEATHER_TTL_MS && geo.haversine(last.lngLat, lngLat) < MIN_MOVE_M) return;
    pending?.abort();
    const ctl = new AbortController();
    pending = ctl;
    last = { lngLat, at: now };
    const [lng, lat] = lngLat;
    const url = `${config.ENDPOINTS.openMeteo}?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day' +
      '&hourly=precipitation_probability&forecast_hours=2&timezone=auto';
    try {
      const timeout = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const [res, name] = await Promise.all([fetch(url, { signal: ctl.signal }), nameFor(lngLat)]);
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`weather ${res.status}`);
      const w = parseForecast(await res.json());
      if (!w) throw new Error('unexpected weather data');
      if (pending === ctl) renderConditions(w, name);
    } catch (err) {
      if (ctl.signal.aborted && pending !== ctl) return;
      console.warn('[weather] conditions unavailable', err);
      card.label.textContent = 'Weather unavailable. Check your signal.';
      last = null;
    }
  }

  const centre = () => {
    const pose = mapView.camera.pose();
    const c = map.getCenter();
    return store.get().follow && pose ? [pose.lng, pose.lat] : [c.lng, c.lat];
  };

  function dropPin(lngLat) {
    pin?.remove();
    const dot = ui.el('div', { class: 'wx-pin', 'aria-hidden': 'true' });
    pin = new maplibregl.Marker({ element: dot }).setLngLat(lngLat).addTo(map);
  }

  // ---------------------------------------------------------------- lifecycle
  function sync() {
    const on = active();
    card.root.hidden = !on;
    clearInterval(refreshTimer);
    if (!on) {
      clearRadar();
      radar = null;
      pin?.remove();
      pin = null;
      return;
    }
    loadRadar();
    refreshTimer = setInterval(loadRadar, RADAR_REFRESH_MS);
    checkWeather(centre(), { force: true });
  }

  mapView.ready.then(() => {
    sync();
    store.select((s) => s.settings.mapView, () => setTimeout(sync, 0));
    // Theme/building changes re-add basemap layers; put the radar back on top of them.
    store.select((s) => `${s.theme}|${s.settings.buildings3d}`, () => active() && setTimeout(loadRadar, 50));
  });
  let moveTimer = null;
  map.on('moveend', () => {
    if (!active() || pin) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => checkWeather(centre()), 700);
  });
  map.on('click', (e) => {
    if (!active() || store.get().mode === 'navigate') return;
    const lngLat = [e.lngLat.lng, e.lngLat.lat];
    dropPin(lngLat);
    checkWeather(lngLat, { force: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active() && playing) loop();
  });
  ctx.actions.register('weatherHere', async () => {
    await checkWeather(centre(), { force: true });
    return card.label.textContent && card.temp.textContent !== '–'
      ? `${card.label.textContent}, ${card.temp.textContent.replace('°', ' degrees')}.`
      : 'I could not get the weather right now.';
  });
}
