// Event bus for module-to-module messages. Handlers run synchronously in subscription order.
// A failing handler is logged and never stops the others.

export function createBus() {
  const handlers = new Map();

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => off(event, fn);
  }

  function once(event, fn) {
    const offFn = on(event, (payload) => {
      offFn();
      fn(payload);
    });
    return offFn;
  }

  function off(event, fn) {
    handlers.get(event)?.delete(fn);
  }

  function emit(event, payload) {
    const set = handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] handler for "${event}" failed`, err);
      }
    }
  }

  return Object.freeze({ on, once, off, emit });
}
