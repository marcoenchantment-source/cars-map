// The Garage: a tuning bay with the live side-view car (popping flames, shift lights on
// "Rev it"), paint, rims, body, flame pattern and timing, and the name shown on the map.
// Every change applies live to the map car and saves through setCarLook.
import { PAINTS, NAME_MAX, normaliseLook, createFlameTimer, popCount, paintName, isHexColour, sanitiseName } from './flames.js';
import { createSideCar, svgEl, wheelArt, sideCarArt } from './car2d.js';

const RIM_OPTIONS = [
  { value: 'five', label: '5 spoke' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'dish', label: 'Deep dish' },
];
const BODY_OPTIONS = [
  { value: 'coupe', label: 'Coupe' },
  { value: 'ute', label: 'Ute' },
  { value: 'hatch', label: 'Hatch' },
];
const PAT_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'triple', label: 'Triple' },
];
const INT_OPTIONS = [
  { value: 1, label: '1 sec' },
  { value: 3, label: '3 sec' },
  { value: 5, label: '5 sec' },
];
const SHIFT_LIGHTS = 10;
const REV_MS = 1100;
const NAME_DEBOUNCE_MS = 350;
const REV_BUZZ = [22, 45, 22, 45, 40];

const labelOf = (options, value) => options.find((o) => o.value === value)?.label ?? '';

function specLine(look) {
  const pops = look.pat === 'off' ? 'No pops' : `${labelOf(PAT_OPTIONS, look.pat)} pop / ${look.int} s`;
  return `${labelOf(BODY_OPTIONS, look.body)} · ${labelOf(RIM_OPTIONS, look.rim)} · ${pops}`;
}

function rimArt(value) {
  return svgEl('svg', { viewBox: '17 29 26 26', width: 44, height: 44, 'aria-hidden': 'true', focusable: 'false' }, [wheelArt(30, value)]);
}

function bodyArt(look, value) {
  return svgEl('svg', { viewBox: '-2 4 122 52', width: 92, height: 39, 'aria-hidden': 'true', focusable: 'false' }, [
    sideCarArt({ ...look, body: value }),
  ]);
}

/** Radio group of picture tiles. Returns { node, sync(value, look) }. */
function tileGroup(ui, { id, label, options, art, onChange }) {
  const node = ui.el('div', { class: 'garage-tiles', role: 'radiogroup', 'aria-label': label, id });
  const buttons = options.map((opt) => {
    const pic = ui.el('span', { class: 'garage-tile-art' });
    const btn = ui.el('button', {
      type: 'button', role: 'radio', class: 'garage-tile', 'aria-checked': 'false',
      on: { click: () => onChange(opt.value) },
    }, pic, ui.el('span', { class: 'garage-tile-label', text: opt.label }));
    node.append(btn);
    return { opt, btn, pic };
  });
  return {
    node,
    sync(value, look) {
      for (const { opt, btn, pic } of buttons) {
        btn.setAttribute('aria-checked', String(opt.value === value));
        pic.replaceChildren(art(look, opt.value));
      }
    },
  };
}

function swatchGroup(ui, { onPick }) {
  const node = ui.el('div', { class: 'garage-swatches', role: 'radiogroup', 'aria-label': 'Paint colour' });
  const buttons = PAINTS.map((p) => {
    const btn = ui.el('button', {
      type: 'button', role: 'radio', class: 'garage-swatch', 'aria-label': p.name, title: p.name, 'aria-checked': 'false',
      on: { click: () => onPick(p.color) },
    });
    btn.style.setProperty('--swatch', p.color); // preset constant
    node.append(btn);
    return { color: p.color, btn };
  });
  const picker = ui.el('input', { type: 'color', class: 'garage-picker', 'aria-label': 'Custom paint colour', value: '#1e88e5' });
  picker.addEventListener('input', () => {
    if (isHexColour(picker.value)) onPick(picker.value);
  });
  const custom = ui.el('label', { class: 'garage-swatch garage-swatch-custom', title: 'Custom colour' }, picker);
  node.append(custom);
  return {
    node,
    sync(color) {
      let preset = false;
      for (const { color: c, btn } of buttons) {
        const on = c === color;
        preset ||= on;
        btn.setAttribute('aria-checked', String(on));
      }
      custom.classList.toggle('is-on', !preset);
      if (!preset) custom.style.setProperty('--swatch', color);
      if (picker.value.toLowerCase() !== color) picker.value = color;
    },
  };
}

function buildBay(ui, look) {
  const preview = createSideCar(look, { size: 300, bob: true, label: 'Your car' });
  const leds = Array.from({ length: SHIFT_LIGHTS }, (_, i) => {
    const led = ui.el('span', { class: 'garage-led' });
    led.style.setProperty('--i', String(i));
    return led;
  });
  const plate = ui.el('span', { class: 'garage-plate' });
  const bay = ui.el(
    'div',
    { class: 'garage-bay' },
    ui.el('div', { class: 'garage-door', 'aria-hidden': 'true' }),
    ui.el('div', { class: 'garage-shift', 'aria-hidden': 'true' }, leds),
    ui.el('div', { class: 'garage-stage' }, ui.el('div', { class: 'garage-glow', 'aria-hidden': 'true' }), preview.el),
    plate,
  );
  return { bay, preview, plate };
}

function section(ui, title, ...content) {
  const heading = ui.el('h3', { class: 'section-title garage-heading', text: title });
  return { heading, node: ui.el('section', { class: 'garage-section' }, heading, ...content) };
}

/**
 * Render the garage into the sheet body. Returns a cleanup function.
 * @param {object} ctx
 * @param {HTMLElement} body
 * @param {{setCarLook:(patch:object)=>void, revMapCar:()=>void}} deps
 */
function renderGarage(ctx, body, { setCarLook, revMapCar }) {
  const { ui, store } = ctx;
  let look = normaliseLook(store.get().car);
  const { bay, preview, plate } = buildBay(ui, look);
  const spec = ui.el('p', { class: 'garage-spec', 'aria-live': 'polite' });
  const timer = createFlameTimer(look, () => preview.pop());
  let revTimer = null;

  const rev = () => {
    timer.burst(Math.max(3, popCount(look.pat)));
    revMapCar();
    try {
      navigator.vibrate?.(REV_BUZZ);
    } catch {
      /* vibration is optional */
    }
    bay.classList.remove('is-revving');
    void bay.offsetWidth; // restart the CSS sweep
    bay.classList.add('is-revving');
    clearTimeout(revTimer);
    revTimer = setTimeout(() => bay.classList.remove('is-revving'), REV_MS);
  };
  const revBtn = ui.el('button', { type: 'button', class: 'btn btn-go garage-rev', on: { click: rev } }, ui.icon('spark', { size: 24 }), 'Rev it');

  const swatches = swatchGroup(ui, { onPick: (color) => setCarLook({ color }) });
  const rims = tileGroup(ui, { id: 'garage-rim', label: 'Rims', options: RIM_OPTIONS, art: (_, v) => rimArt(v), onChange: (rim) => setCarLook({ rim }) });
  const bodies = tileGroup(ui, { id: 'garage-body', label: 'Body', options: BODY_OPTIONS, art: bodyArt, onChange: (b) => setCarLook({ body: b }) });
  const pats = ui.segmented({ id: 'garage-pat', label: 'Flame pops', options: PAT_OPTIONS, value: look.pat, onChange: (pat) => setCarLook({ pat }) });
  const ints = ui.segmented({ id: 'garage-int', label: 'Pop every', options: INT_OPTIONS, value: look.int, onChange: (int) => setCarLook({ int }) });

  const nameInput = ui.el('input', {
    id: 'garage-name', class: 'input', type: 'text', maxlength: String(NAME_MAX), value: look.name,
    autocomplete: 'off', enterkeyhint: 'done', 'aria-describedby': 'garage-name-hint',
  });
  let nameTimer = null;
  const commitName = () => {
    clearTimeout(nameTimer);
    const name = sanitiseName(nameInput.value, NAME_MAX);
    if (name && name !== look.name) setCarLook({ name });
  };
  nameInput.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(commitName, NAME_DEBOUNCE_MS);
  });
  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  const paint = section(ui, 'Paint', swatches.node);
  body.classList.add('garage');
  body.append(
    bay,
    ui.el('div', { class: 'garage-actions' }, spec, revBtn),
    paint.node,
    section(ui, 'Rims', rims.node).node,
    section(ui, 'Body', bodies.node).node,
    section(ui, 'Flame pops', pats).node,
    section(ui, 'Every', ints).node,
    section(ui, 'Name on the map', ui.el('label', { class: 'field', for: 'garage-name' },
      nameInput,
      ui.el('span', { id: 'garage-name-hint', class: 'row-hint', text: `Friends see this above your car. Up to ${NAME_MAX} characters.` }))).node,
  );

  function refresh(next) {
    look = next;
    preview.setLook(look);
    timer.update(look);
    bay.style.setProperty('--car-paint', look.color);
    plate.textContent = look.name;
    spec.textContent = specLine(look);
    paint.heading.textContent = `Paint · ${paintName(look.color)}`;
    swatches.sync(look.color);
    rims.sync(look.rim, look);
    bodies.sync(look.body, look);
    for (const [group, value] of [[pats, look.pat], [ints, look.int]]) {
      const opts = group === pats ? PAT_OPTIONS : INT_OPTIONS;
      group.querySelectorAll('[role="radio"]').forEach((btn, i) => btn.setAttribute('aria-checked', String(opts[i]?.value === value)));
    }
    if (document.activeElement !== nameInput) nameInput.value = look.name;
  }
  refresh(look);
  timer.start();
  const unsubscribe = store.select((s) => s.car, (car) => refresh(normaliseLook(car)));

  return () => {
    unsubscribe();
    timer.stop();
    clearTimeout(revTimer);
    commitName();
    body.classList.remove('garage');
  };
}

/** Open the Garage sheet. */
export function openGarage(ctx, deps) {
  let cleanup = null;
  ctx.ui.sheet.open({
    id: 'garage',
    title: 'Garage',
    size: 'tall',
    render(body) {
      cleanup = renderGarage(ctx, body, deps);
    },
    onClose() {
      cleanup?.();
      cleanup = null;
    },
  });
}
