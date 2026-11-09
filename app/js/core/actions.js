// Named actions that modules expose to each other (and to the voice copilot) without imports.
// Example: ctx.actions.register('reportHazard', fn); await ctx.actions.call('reportHazard', 'police').

export function createActions() {
  const table = new Map();

  return Object.freeze({
    register(name, fn) {
      if (typeof fn !== 'function') throw new TypeError(`Action "${name}" must be a function`);
      table.set(name, fn);
    },
    has(name) {
      return table.has(name);
    },
    async call(name, ...args) {
      const fn = table.get(name);
      if (!fn) throw new Error(`That feature is not available right now (${name}).`);
      return fn(...args);
    },
    list() {
      return [...table.keys()];
    },
  });
}
