// Only raw signed initData is sent to the server; unsafe client identity fields
// never authorize a profile. Outside Telegram this adapter has no user data.
export async function loadTelegramSDK(host = globalThis.window) {
  if (host?.Telegram?.WebApp) return true;
  if (!host?.document) return false;
  return await new Promise(resolve => {
    const script = host.document.createElement('script');
    const timer = setTimeout(() => resolve(false), 10000);
    const finish = value => { clearTimeout(timer); resolve(value); };
    script.src = 'https://telegram.org/js/telegram-web-app.js?61';
    script.async = true;
    script.onload = () => finish(Boolean(host.Telegram?.WebApp));
    script.onerror = () => finish(false);
    host.document.head.append(script);
  });
}

export function createTelegramAdapter(host = globalThis.window) {
  let app;
  let backHandler;
  let initialized = false;
  const cleanups = [];

  function syncAppearance() {
    const root = host?.document?.documentElement;
    if (!root || !app) return;
    root.dataset.theme = app.colorScheme === 'dark' ? 'dark' : 'light';
    const inset = app.contentSafeAreaInset || app.safeAreaInset || {};
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      const value = Number(inset[edge]);
      root.style.setProperty('--tg-inset-' + edge, Number.isFinite(value) && value > 0 ? value + 'px' : '0px');
    }
    if (Number.isFinite(app.viewportStableHeight) && app.viewportStableHeight > 0) root.style.setProperty('--app-height', app.viewportStableHeight + 'px');
  }

  function updateBack(handler) {
    if (app?.BackButton && backHandler) app.BackButton.offClick?.(backHandler);
    backHandler = handler;
    if (!app?.BackButton) return;
    if (handler) { app.BackButton.onClick?.(handler); app.BackButton.show?.(); }
    else app.BackButton.hide?.();
  }

  function init() {
    if (initialized) return true;
    const candidate = host?.Telegram?.WebApp;
    if (!candidate?.initData) return false;
    app = candidate;
    initialized = true;
    syncAppearance();
    app.ready?.();
    for (const name of ['themeChanged', 'viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) {
      app.onEvent?.(name, syncAppearance);
      cleanups.push(() => app.offEvent?.(name, syncAppearance));
    }
    updateBack(backHandler);
    return true;
  }

  function destroy() {
    for (const cleanup of cleanups.splice(0)) cleanup();
    updateBack(null);
    app = undefined;
    initialized = false;
  }
  function rawInitData() {
    const raw = host?.Telegram?.WebApp?.initData;
    return typeof raw === 'string' ? raw : '';
  }
  // Called only as a direct response to an explicit user delivery action.
  async function requestWriteAccess() {
    const webApp = host?.Telegram?.WebApp;
    if (!webApp?.requestWriteAccess) return false;
    return await new Promise(resolve => webApp.requestWriteAccess(allowed => resolve(Boolean(allowed))));
  }
  return { init, updateBack, destroy, rawInitData, requestWriteAccess };
}
