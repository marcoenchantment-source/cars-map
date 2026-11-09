// Safe JSON wrappers around localStorage. Storage can be missing or full (private mode,
// quota), so every call is guarded and falls back to the provided default.

const PREFIX = 'carsmap.';

export function load(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] could not read ${key}`, err);
    return fallback;
  }
}

export function save(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[storage] could not save ${key}`, err);
    return false;
  }
}

export function remove(key) {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch (err) {
    console.warn(`[storage] could not remove ${key}`, err);
  }
}
