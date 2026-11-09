// "Quick contacts" settings section + the small store behind it (ctx.storage key 'contacts').
import { addContact, removeContact, sanitiseContacts, fromPicker, telHref, MAX_CONTACTS } from './contacts.js';

const STORAGE_KEY = 'contacts';

export function createContactsStore(storage) {
  let list = sanitiseContacts(storage.load(STORAGE_KEY, []));
  const save = (next) => {
    list = next;
    storage.save(STORAGE_KEY, next);
  };
  return Object.freeze({
    all: () => list,
    add(input) {
      const r = addContact(list, input);
      if (r.ok) save(r.list);
      return r;
    },
    remove(id) {
      save(removeContact(list, id));
    },
  });
}

const pickerAvailable = () => typeof navigator !== 'undefined' && 'contacts' in navigator && typeof navigator.contacts?.select === 'function';

function contactRow(ui, c, onRemove) {
  return ui.el(
    'div',
    { class: 'row' },
    ui.el('span', { class: 'row-icon' }, ui.icon('phone', { size: 20 })),
    ui.el('span', { class: 'row-text' }, ui.el('span', { class: 'row-title', text: c.name }), ui.el('span', { class: 'row-hint', text: c.phone })),
    ui.el('a', { class: 'icon-btn', href: telHref(c.phone), 'aria-label': `Call ${c.name}`, title: `Call ${c.name}` }, ui.icon('phone', { size: 20 })),
    ui.iconButton('trash', `Remove ${c.name}`, () => onRemove(c)),
  );
}

/** Render the section into `container` (called each time Settings opens, and after changes). */
export function renderContactsSection(container, { ui, contacts }) {
  const rerender = () => {
    ui.clear(container);
    renderContactsSection(container, { ui, contacts });
  };
  const status = ui.el('span', { class: 'row-hint', id: 'contact-status', 'aria-live': 'polite', text: 'Say "call Mum" or "text Mum on my way". Your phone opens the dialler or messages app; Cars Map can’t call or text silently.' });
  const name = ui.el('input', { class: 'input', id: 'contact-name', type: 'text', placeholder: 'Name, e.g. Mum', autocomplete: 'off', maxlength: '40' });
  const phone = ui.el('input', { class: 'input', id: 'contact-phone', type: 'tel', placeholder: '0412 345 678', autocomplete: 'off', inputmode: 'tel', maxlength: '20' });
  const add = () => {
    const r = contacts.add({ name: name.value, phone: phone.value });
    if (!r.ok) {
      status.textContent = r.error;
      return;
    }
    ui.toast(`${r.contact.name} saved`, { tone: 'good' });
    rerender();
  };
  const pick = async () => {
    try {
      const picked = fromPicker(await navigator.contacts.select(['name', 'tel'], { multiple: true }));
      if (!picked.length) {
        status.textContent = 'No contacts with a phone number were picked.';
        return;
      }
      const failedNames = picked.filter((p) => !contacts.add(p).ok).map((p) => p.name);
      if (failedNames.length) ui.toast(`Couldn’t add ${failedNames.join(', ')}`, { tone: 'warn' });
      rerender();
    } catch (err) {
      console.warn('[copilot] contact picker failed', err);
      status.textContent = 'The contact picker didn’t open. Type the name and number instead.';
    }
  };
  const list = contacts.all();
  container.append(
    list.length
      ? ui.el('div', { class: 'list' }, list.map((c) => contactRow(ui, c, (x) => { contacts.remove(x.id); rerender(); })))
      : ui.el('p', { class: 'muted small', text: 'No quick contacts yet.' }),
    ui.el(
      'div',
      { class: 'card stack' },
      ui.el('label', { class: 'field', for: 'contact-name' }, ui.el('span', { text: 'Name' }), name),
      ui.el('label', { class: 'field', for: 'contact-phone' }, ui.el('span', { text: 'Phone' }), phone),
      status,
      ui.el(
        'div',
        { class: 'cluster' },
        ui.el('button', { type: 'button', class: 'btn btn-sm btn-accent', text: 'Add contact', disabled: list.length >= MAX_CONTACTS, on: { click: add } }),
        pickerAvailable() ? ui.el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Pick from phone', on: { click: pick } }) : null,
      ),
    ),
  );
}
