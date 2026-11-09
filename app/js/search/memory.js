// Home, Work and recent places, kept in local storage. Validated on load (storage is untrusted).
import { addRecent, loadPlaces, sanitizePlace } from './places.js';

export function createPlaceMemory(storage) {
  let recents = loadPlaces(storage.load('recentPlaces', []));
  let home = sanitizePlace(storage.load('home', null));
  let work = sanitizePlace(storage.load('work', null));
  const listeners = new Set();
  const changed = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (err) {
        console.error('[search] place listener failed', err);
      }
    }
  };

  function saveSlot(key, place) {
    const clean = sanitizePlace(place);
    if (!clean) throw new Error('That place has no usable location. Pick it again from search.');
    if (key === 'home') home = clean;
    else work = clean;
    if (!storage.save(key, clean)) throw new Error('Couldn’t save on this phone. Storage may be full or blocked.');
    changed();
    return clean;
  }

  return Object.freeze({
    recents: () => recents,
    home: () => home,
    work: () => work,
    remember(place) {
      recents = addRecent(recents, place);
      storage.save('recentPlaces', recents);
      changed();
    },
    clearRecents() {
      recents = [];
      storage.save('recentPlaces', recents);
      changed();
    },
    setHome: (place) => saveSlot('home', place),
    setWork: (place) => saveSlot('work', place),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}
