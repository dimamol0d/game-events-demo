export class ApiError extends Error {
  constructor(message, code = 'request_failed', status = 0) {
    super(message); this.name = 'ApiError'; this.code = code; this.status = status;
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  let config = { backendURL: '', remote: false, configured: true };
  let initDataProvider = () => '';
  let token = '';
  let expiresAt = 0;
  let authPromise = null;

  function configure(next, provider = () => '') {
    if (config.backendURL !== next.backendURL || config.remote !== next.remote) { token = ''; expiresAt = 0; authPromise = null; }
    config = next;
    initDataProvider = provider;
  }

  async function send(path, { method = 'GET', body, signal } = {}, authorization = '') {
    if (!path.startsWith('/api/') || /[\r\n]/.test(path)) throw new ApiError('Некорректный адрес запроса.');
    const headers = { Accept: 'application/json' };
    if (authorization) headers.Authorization = 'Bearer ' + authorization;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 40000);
    const options = { method, credentials: config.remote ? 'omit' : 'same-origin', redirect: 'error', headers, signal: controller.signal };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-Radar-Client'] = '1';
      options.body = JSON.stringify(body ?? {});
    }
    try {
      const response = await fetchImpl(config.backendURL + path, options);
      let result;
      try { result = await response.json(); }
      catch { throw new ApiError(config.remote ? 'Домашний сервер не ответил данными приложения. Возможно, компьютер выключен или соединение недоступно.' : 'Сервер вернул непонятный ответ. Повторите попытку.', config.remote ? 'offline' : 'invalid_response'); }
      if (!response.ok) {
        const message = response.status === 401 ? 'Сеанс Telegram истёк или не подтверждён. Закройте приложение и откройте его снова через бота.' : (result.message || `Не удалось выполнить запрос (${response.status}).`);
        throw new ApiError(message, response.status === 401 ? 'auth_expired' : result.error || 'request_failed', response.status);
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError || (error.name === 'AbortError' && signal?.aborted)) throw error;
      if (error.name === 'AbortError') throw new ApiError('Источник долго не отвечает. Попробуйте снова через некоторое время.', 'timeout');
      throw new ApiError(config.remote ? 'Домашний сервер сейчас недоступен. Возможно, компьютер выключен, приложение остановлено или нет соединения.' : 'Сервер недоступен. Проверьте, запущено ли приложение, и повторите попытку.', 'offline');
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }

  async function authenticate(force = false) {
    if (!config.configured) throw new ApiError('Подключение к домашнему серверу ещё не настроено. Откройте приложение позже.', 'not_configured');
    if (!config.remote) return null;
    if (!force && token && expiresAt > clock() + 15000) return null;
    if (authPromise) return authPromise;
    const initData = initDataProvider();
    if (typeof initData !== 'string' || !initData) throw new ApiError('Откройте приложение кнопкой в Telegram-боте. Обычная ссылка не подтверждает ваш профиль.', 'telegram_required');
    authPromise = (async () => {
      const result = await send('/api/auth/telegram', { method: 'POST', body: { init_data: initData } });
      const expiry = Date.parse(result.expires_at);
      if (typeof result.token !== 'string' || !result.token || /\s/.test(result.token) || !Number.isFinite(expiry) || expiry <= clock()) throw new ApiError('Сервер не выдал действующий сеанс Telegram. Откройте приложение снова.', 'invalid_auth');
      token = result.token;
      expiresAt = expiry;
      return result;
    })();
    try { return await authPromise; } finally { authPromise = null; }
  }

  async function request(path, options = {}) {
    await authenticate();
    try { return await send(path, options, config.remote ? token : ''); }
    catch (error) {
      if (error.status !== 401 || !config.remote) throw error;
      token = ''; expiresAt = 0;
      await authenticate(true);
      return await send(path, options, token);
    }
  }

  return {
    configure, authenticate, request,
    bootstrap: () => request('/api/bootstrap'),
    search: (query, kind, signal) => request(`/api/search?${new URLSearchParams({ q: query, kind })}`, { signal }),
    library: () => request('/api/library'),
    add: appId => request('/api/library', { method: 'POST', body: { app_id: appId } }),
    remove: appId => request(`/api/library/${appId}`, { method: 'DELETE' }),
    game: (appId, offset = 0) => request(`/api/games/${appId}?${new URLSearchParams({ offset, limit: 30 })}`),
    savePreferences: (appId, preferences) => request(`/api/library/${appId}/preferences`, { method: 'PUT', body: preferences }),
    refresh: appId => request(`/api/games/${appId}/refresh`, { method: 'POST', body: {} }),
    notifications: () => request('/api/notifications'),
    markRead: () => request('/api/notifications/read', { method: 'POST', body: {} }),
    setTelegramDelivery: enabled => request('/api/profile/delivery', { method: 'POST', body: { enabled } }),
    translate: eventId => request(`/api/events/${eventId}/translate`, { method: 'POST', body: {} }),
  };
}

export const api = createApiClient();
