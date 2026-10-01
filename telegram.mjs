// Telegram is an optional host, not the owner of application or game state.
export function createTelegramAdapter(host = globalThis.window) {
  const getApp = () => host?.Telegram?.WebApp;
  let onBack = null;
  let attachedBack = null;
  let initialized = null;
  const cleanups = [];

  function syncTheme() {
    const app = getApp();
    const root = host?.document?.documentElement;
    if (app && root && app.initData) root.dataset.theme = app.colorScheme === 'light' ? 'light' : 'dark';
  }

  function updateBack(handler) {
    onBack = handler;
    const app = getApp();
    const button = app?.initData ? app.BackButton : null;
    if (!button) return;
    if (attachedBack) button.offClick?.(attachedBack);
    attachedBack = handler;
    if (handler) { button.onClick?.(handler); button.show?.(); }
    else button.hide?.();
  }

  function init() {
    const app = getApp();
    if (!app?.initData) return false;
    if (initialized === app) return true;
    initialized = app;
    syncTheme();
    app.ready?.();
    app.expand?.();
    app.onEvent?.('themeChanged', syncTheme);
    cleanups.push(() => app.offEvent?.('themeChanged', syncTheme));
    updateBack(onBack);
    return true;
  }

  function destroy() {
    for (const cleanup of cleanups.splice(0)) cleanup();
    updateBack(null);
    initialized = null;
  }

  // initData is deliberately not used for authentication in this local UI prototype.
  return { init, updateBack, destroy };
}
