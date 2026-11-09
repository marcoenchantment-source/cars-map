// Shared UI kit: DOM builder, toasts, notices, the bottom sheet, and registries for the
// floating buttons, dock and settings sections that feature modules contribute.
import { icon } from './icons.js';

export { icon };

const PROPS_AS_PROPERTIES = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'type']);

/**
 * Build a DOM element. Strings become text nodes (never parsed as HTML).
 * props: class, text, on:{event:fn}, style:{}, dataset:{}, any attribute (aria-*, role, id...).
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'on') for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (PROPS_AS_PROPERTIES.has(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Remove all children of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Round icon button with an accessible label. */
export function iconButton(name, label, onClick, { className = 'icon-btn', size = 22 } = {}) {
  return el('button', { type: 'button', class: className, 'aria-label': label, title: label, on: { click: onClick } }, icon(name, { size }));
}

// ---------------------------------------------------------------- toasts

/** Short status message at the top of the screen. tone: info | good | warn | bad */
export function toast(message, { tone = 'info', ms = 2600 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', { class: `toast toast-${tone}`, role: 'status' }, message);
  host.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 320);
  }, ms);
}

// ---------------------------------------------------------------- notices

const activeNotices = new Map();

/**
 * Prominent card below the top HUD (hazard ahead, incoming message...). Same id replaces.
 * @param {{id:string, iconName?:string, title:string, body?:string, tone?:string,
 *          actions?:{label:string,onClick:Function,primary?:boolean}[], ms?:number}} opts
 * @returns {{close: Function}}
 */
export function notice({ id, iconName = 'alert', title, body = '', tone = 'info', actions = [], ms = 9000 }) {
  const host = document.getElementById('notices');
  if (!host) return { close() {} };
  activeNotices.get(id)?.close();
  const close = () => {
    clearTimeout(timer);
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
    if (activeNotices.get(id)?.node === node) activeNotices.delete(id);
  };
  const node = el(
    'div',
    { class: `notice notice-${tone}`, role: 'alert' },
    el('div', { class: 'notice-icon' }, icon(iconName, { size: 26 })),
    el(
      'div',
      { class: 'notice-text' },
      el('strong', { text: title }),
      body ? el('span', { text: body }) : null,
    ),
    actions.length
      ? el(
          'div',
          { class: 'notice-actions' },
          actions.map((a) =>
            el('button', {
              type: 'button',
              class: a.primary ? 'btn btn-sm btn-accent' : 'btn btn-sm btn-ghost',
              text: a.label,
              on: {
                click: () => {
                  close();
                  a.onClick?.();
                },
              },
            }),
          ),
        )
      : null,
    el('button', { type: 'button', class: 'notice-close', 'aria-label': 'Dismiss', on: { click: () => close() } }, icon('close', { size: 18 })),
  );
  host.prepend(node);
  requestAnimationFrame(() => node.classList.add('show'));
  const timer = ms > 0 ? setTimeout(close, ms) : null;
  const handle = { close, node };
  activeNotices.set(id, handle);
  return handle;
}

/** Close a notice by id (no-op if it isn't showing). */
export function closeNotice(id) {
  activeNotices.get(id)?.close();
}

// ---------------------------------------------------------------- sheet

let current = null; // {id, onClose}

function sheetEls() {
  return {
    root: document.getElementById('sheet'),
    title: document.getElementById('sheet-title'),
    body: document.getElementById('sheet-body'),
  };
}

export const sheet = Object.freeze({
  /**
   * Open the single bottom sheet (side panel on wide screens), replacing whatever is open.
   * render(body, api) fills the body; api = {close, setTitle}.
   * size: 'auto' (fits content) | 'tall' (most of the screen)
   */
  open({ id, title = '', render, onClose, size = 'auto' }) {
    const { root, title: titleEl, body } = sheetEls();
    if (!root) return null;
    if (current) {
      const prev = current;
      current = null;
      try {
        prev.onClose?.();
      } catch (err) {
        console.error('[sheet] onClose failed', err);
      }
    }
    current = { id, onClose };
    titleEl.textContent = title;
    clear(body);
    root.dataset.size = size;
    root.dataset.sheet = id;
    root.hidden = false;
    const api = { close: () => sheet.close(id), setTitle: (t) => (titleEl.textContent = t) };
    try {
      render?.(body, api);
    } catch (err) {
      console.error(`[sheet] render of "${id}" failed`, err);
      body.append(el('p', { class: 'muted', text: 'This panel could not load. Try again.' }));
    }
    requestAnimationFrame(() => root.classList.add('open'));
    document.dispatchEvent(new CustomEvent('carsmap:sheet', { detail: { id, open: true } }));
    return api;
  },

  /** Close the sheet (only if `id` matches the open one, when given). */
  close(id) {
    if (!current || (id && current.id !== id)) return;
    const { root } = sheetEls();
    const closing = current;
    current = null;
    root.classList.remove('open');
    setTimeout(() => {
      if (!current) root.hidden = true;
    }, 260);
    try {
      closing.onClose?.();
    } catch (err) {
      console.error('[sheet] onClose failed', err);
    }
    document.dispatchEvent(new CustomEvent('carsmap:sheet', { detail: { id: closing.id, open: false } }));
  },

  /** id of the open sheet, or null. */
  currentId() {
    return current?.id ?? null;
  },

  /** Visible height in px the sheet covers at the bottom of the screen (0 when closed or side panel). */
  coverage() {
    const { root } = sheetEls();
    if (!root || root.hidden || !root.classList.contains('open')) return { bottom: 0, left: 0 };
    const r = root.getBoundingClientRect();
    if (window.matchMedia('(min-width: 900px)').matches) return { bottom: 0, left: r.right + 8 };
    return { bottom: Math.max(0, window.innerHeight - r.top), left: 0 };
  },
});

export function initSheet() {
  const { root } = sheetEls();
  document.getElementById('sheet-close')?.addEventListener('click', () => sheet.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) sheet.close();
  });
  // Swipe the grip down to close (phones).
  const grip = root?.querySelector('.sheet-grip');
  let startY = null;
  grip?.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    grip.setPointerCapture(e.pointerId);
  });
  grip?.addEventListener('pointerup', (e) => {
    if (startY != null && e.clientY - startY > 60) sheet.close();
    startY = null;
  });
}

// ---------------------------------------------------------------- registries

const fabs = [];
const dockItems = [];
const settingsSections = [];

function insertOrdered(host, list, item) {
  list.push(item);
  list.sort((a, b) => a.order - b.order);
  for (const it of list) host.append(it.node); // re-append keeps order
}

/**
 * Add a floating round button on the right edge.
 * modes: which app modes show it (default all). tone: default | accent | warn
 * @returns {HTMLButtonElement}
 */
export function addFab({ id, icon: iconName, label, onClick, order = 50, tone = 'default', modes = null, size = 'md' }) {
  const host = document.getElementById('fabs');
  const node = el(
    'button',
    {
      type: 'button',
      class: `fab fab-${tone} fab-${size}`,
      id: `fab-${id}`,
      'aria-label': label,
      title: label,
      dataset: { modes: modes ? modes.join(' ') : 'all' },
      on: { click: onClick },
    },
    icon(iconName, { size: size === 'lg' ? 30 : 24 }),
  );
  if (host) insertOrdered(host, fabs, { order, node });
  return node;
}

/** Add an item to the bottom dock (explore mode). */
export function addDockItem({ id, icon: iconName, label, onClick, order = 50 }) {
  const host = document.getElementById('dock');
  const node = el(
    'button',
    { type: 'button', class: 'dock-item', id: `dock-${id}`, on: { click: onClick } },
    icon(iconName, { size: 24 }),
    el('span', { text: label }),
  );
  if (host) insertOrdered(host, dockItems, { order, node });
  return node;
}

/** Contribute a section to the Settings sheet. render(container) is called each time it opens. */
export function registerSettingsSection({ id, title, order = 50, render }) {
  settingsSections.push({ id, title, order, render });
  settingsSections.sort((a, b) => a.order - b.order);
}

export function getSettingsSections() {
  return [...settingsSections];
}

/** Show/hide mode-scoped floating buttons; called by main when the mode changes. */
export function applyModeVisibility(mode) {
  for (const { node } of fabs) {
    const modes = node.dataset.modes;
    const visible = modes === 'all' || modes.split(' ').includes(mode);
    node.classList.toggle('is-mode-hidden', !visible);
  }
}

// ---------------------------------------------------------------- form helpers

/** Labelled on/off switch. onChange(checked) */
export function toggleRow({ id, label, hint = '', checked, onChange }) {
  const input = el('input', { type: 'checkbox', id, class: 'switch-input', checked: !!checked, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return el(
    'label',
    { class: 'row row-toggle', for: id },
    el('span', { class: 'row-text' }, el('span', { class: 'row-title', text: label }), hint ? el('span', { class: 'row-hint', text: hint }) : null),
    input,
    el('span', { class: 'switch', 'aria-hidden': 'true' }),
  );
}

/** Segmented single-choice control. options: [{value, label}] onChange(value) */
export function segmented({ id, options, value, onChange, label }) {
  const group = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label ?? id, id });
  const render = (selected) => {
    clear(group);
    for (const opt of options) {
      group.append(
        el('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(opt.value === selected),
          class: 'seg-btn',
          text: opt.label,
          on: {
            click: () => {
              render(opt.value);
              onChange(opt.value);
            },
          },
        }),
      );
    }
  };
  render(value);
  return group;
}
