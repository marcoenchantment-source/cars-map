// Tiny immutable store. State objects are frozen; every update creates a new object.

export function createStore(initial) {
  let state = Object.freeze({ ...initial });
  const subscribers = new Set();

  function get() {
    return state;
  }

  /**
   * Shallow-merge a patch into state. `patch` may be an object or a function (state) => patch.
   * Returning null/undefined from the function skips the update.
   */
  function set(patch) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    if (!p) return;
    const prev = state;
    state = Object.freeze({ ...prev, ...p });
    for (const fn of [...subscribers]) {
      try {
        fn(state, prev);
      } catch (err) {
        console.error('[store] subscriber failed', err);
      }
    }
  }

  /** Call fn(next, prev) after every update. Returns an unsubscribe function. */
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  /** Call fn(value, oldValue) only when selector(state) changes (by identity). */
  function select(selector, fn, { immediate = false } = {}) {
    let last = selector(state);
    if (immediate) fn(last, undefined);
    return subscribe((s) => {
      const value = selector(s);
      if (value !== last) {
        const old = last;
        last = value;
        fn(value, old);
      }
    });
  }

  return Object.freeze({ get, set, subscribe, select });
}
