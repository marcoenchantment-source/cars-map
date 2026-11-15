// "Emergency contacts" list + the small store behind it (ctx.storage key 'contacts').
// The settings section itself is registered by the safety module, next to the crash-alert switch.
import { addContact, removeContact, sanitiseContacts, fromPicker, telHref, setContactCrew, MAX_CONTACTS } from './contacts.js';

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
    setCrew(id, crew) {
      save(setContactCrew(list, id, crew));
    },
  });
}

const pickerAvailable = () => typeof navigator !== 'undefined' && 'contacts' in navigator && typeof navigator.contacts?.select === 'function';

/** "Auto-alert in Crew" picker: which Crew friend gets an automatic crash alert for this contact. */
function crewPicker(ui, c, crew, onPick) {
  const select = ui.el(
    'select',
    { class: 'input cm-crew-pick', id: 'crew-' + c.id, 'aria-label': 'Crew friend for ' + c.name },
    ui.el('option', { value: '', text: crew.length ? 'Not in my Crew (text and call only)' : 'Add them in Crew for automatic alerts' }),
    crew.map((f) => ui.el('option', { value: f.pubkey, text: 'Auto-alert ' + f.name + ' in Crew', selected: f.pubkey === c.crew })),
  );
  select.disabled = crew.length === 0;
  select.addEventListener('change', () => onPick(select.value));
  return select;
}

function contactRowWithCrew(ui, c, { onRemove, crew, onPickCrew }) {
  return ui.el('div', { class: 'stack cm-contact' }, contactRow(ui, c, onRemove), crewPicker(ui, c, crew, (pk) => onPickCrew(c, pk)));
}

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
export function renderContactsSection(container, { ui, contacts, crew = [] }) {
  const rerender = () => {
    ui.clear(container);
    renderContactsSection(container, { ui, contacts, crew });
  };
  const status = ui.el('span', { class: 'row-hint', id: 'contact-status', 'aria-live': 'polite', text: 'Link a contact to their Crew profile and a crash alert reaches them automatically. Otherwise you get a one-tap Text and Call. You can also say "call Mum".' });
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
      ? ui.el('div', { class: 'list' }, list.map((c) => contactRowWithCrew(ui, c, {
        crew,
        onRemove: (x) => { contacts.remove(x.id); rerender(); },
        onPickCrew: (x, pk) => {
          contacts.setCrew(x.id, pk);
          ui.toast(pk ? x.name + ' will get crash alerts in Crew' : x.name + ': text and call only', { tone: 'good' });
        },
      })))
      : ui.el('p', { class: 'muted small', text: 'No emergency contacts yet. Add someone who should know if you crash.' }),
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
