// Keep the screen on while navigating. The browser drops the lock whenever the page is hidden,
// so it is re-acquired when the page becomes visible again. Rejections are expected and harmless.

export function createWakeLock({ ui }) {
  let wanted = false;
  let sentinel = null;
  let requesting = false;
  let warned = false;

  function tip() {
    if (warned) return;
    warned = true;
    ui.toast('Tip: set Auto-Lock to Never while driving so your screen stays on.', { ms: 5000 });
  }

  async function request() {
    if (!wanted || sentinel || requesting || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator)) {
      tip();
      return;
    }
    requesting = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!wanted) {
        lock.release().catch(() => {});
        return;
      }
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
    } catch (err) {
      console.warn('[wakelock] not granted', err?.name ?? err);
      tip();
    } finally {
      requesting = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') request();
  });

  return Object.freeze({
    acquire() {
      wanted = true;
      request();
    },
    release() {
      wanted = false;
      const lock = sentinel;
      sentinel = null;
      lock?.release().catch(() => {});
    },
  });
}
