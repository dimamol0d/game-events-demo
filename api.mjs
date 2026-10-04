export class ApiError extends Error {
  constructor(message, code = 'request_failed', status = 0) {
    super(message); this.name = 'ApiError'; this.code = code; this.status = status;
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, clock = Date.now, recoveryCooldownMs = 10000, recoveryTimeoutMs = 10000 } = {}) {
  let config = { backendURL: '', remote: false, configured: true };
  let initDataProvider = () => '';
  let token = '';
  let expiresAt = 0;
  let authTask = null;
  let generation = 0;
  let refreshConfig = null;
  let recoveryTask = null;
  let lastRecoveryAt = -Infinity;

  function applyConfig(next) {
    if (config.backendURL !== next.backendURL || config.remote !== next.remote) {
      generation++; token = ''; expiresAt = 0; authTask = null;
    }
    config = next;
  }

  function configure(next, provider = () => '', reloadConfig = null) {
    // A new owner configuration invalidates in-flight authentication/discovery,
    // even when the endpoint happens to be unchanged.
    generation++; token = ''; expiresAt = 0; authTask = null; recoveryTask = null; lastRecoveryAt = -Infinity;
    applyConfig(next);
    initDataProvider = provider;
    refreshConfig = typeof reloadConfig === 'function' ? reloadConfig : null;
  }

  function abortIfNeeded(signal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Запрос отменён.', 'AbortError');
  }

  async function waitFor(promise, signal) {
    abortIfNeeded(signal);
    if (!signal) return promise;
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException('Запрос отменён.', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([promise, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }

  const endpoint = () => ({ backendURL: config.backendURL, remote: config.remote, generation });
  const isTransportFailure = error => error instanceof ApiError && ['offline', 'timeout'].includes(error.code) && !error.status;

  async function recover(failedEndpoint, error, signal) {
    abortIfNeeded(signal);
    if (!failedEndpoint.remote || !isTransportFailure(error)) return false;
    if (failedEndpoint.generation !== generation) return config.backendURL !== failedEndpoint.backendURL;
    if (!refreshConfig) return false;
    if (recoveryTask?.generation === generation) return waitFor(recoveryTask.promise, signal);
    if (clock() - lastRecoveryAt < recoveryCooldownMs) return false;
    lastRecoveryAt = clock();
    const capturedGeneration = generation;
    const reload = refreshConfig;
    const task = { generation: capturedGeneration, promise: null };
    task.promise = (async () => {
      let timeout;
      try {
        const limit = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('config_timeout')), recoveryTimeoutMs); });
        const next = await Promise.race([Promise.resolve().then(reload), limit]);
        if (generation !== capturedGeneration) return config.backendURL !== failedEndpoint.backendURL;
        if (!next?.configured || !next.remote || typeof next.backendURL !== 'string' || !next.backendURL) return false;
        applyConfig(next);
        return config.backendURL !== failedEndpoint.backendURL;
      } catch { return false; }
      finally { clearTimeout(timeout); if (recoveryTask === task) recoveryTask = null; }
    })();
    recoveryTask = task;
    return waitFor(task.promise, signal);
  }

  async function send(path, { method = 'GET', body, signal } = {}, authorization = '', target = endpoint()) {
    if (!path.startsWith('/api/') || /[\r\n]/.test(path)) throw new ApiError('Некорректный адрес запроса.');
    abortIfNeeded(signal);
    const headers = { Accept: 'application/json' };
    if (authorization) headers.Authorization = 'Bearer ' + authorization;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 40000);
    const options = { method, credentials: target.remote ? 'omit' : 'same-origin', redirect: 'error', headers, signal: controller.signal };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-Radar-Client'] = '1';
      options.body = JSON.stringify(body ?? {});
    }
    try {
      const response = await fetchImpl(target.backendURL + path, options);
      let result;
      try { result = await response.json(); }
      catch {
        if (response.status === 401) throw new ApiError('Сеанс Telegram истёк или не подтверждён. Закройте приложение и откройте его снова через бота.', 'auth_expired', 401);
        throw new ApiError(target.remote ? 'Домашний сервер не ответил данными приложения. Возможно, компьютер выключен или соединение недоступно.' : 'Сервер вернул непонятный ответ. Повторите попытку.', target.remote ? 'offline' : 'invalid_response');
      }
      if (!response.ok) {
        const message = response.status === 401 ? 'Сеанс Telegram истёк или не подтверждён. Закройте приложение и откройте его снова через бота.' : (result.message || `Не удалось выполнить запрос (${response.status}).`);
        throw new ApiError(message, response.status === 401 ? 'auth_expired' : result.error || 'request_failed', response.status);
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError || (error.name === 'AbortError' && signal?.aborted)) throw error;
      if (error.name === 'AbortError') throw new ApiError('Источник долго не отвечает. Попробуйте снова через некоторое время.', 'timeout');
      throw new ApiError(target.remote ? 'Домашний сервер сейчас недоступен. Возможно, компьютер выключен, приложение остановлено или нет соединения.' : 'Сервер недоступен. Проверьте, запущено ли приложение, и повторите попытку.', 'offline');
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }

  function authenticationTask(force = false) {
    if (!config.configured) throw new ApiError('Подключение к домашнему серверу ещё не настроено. Откройте приложение позже.', 'not_configured');
    const target = endpoint();
    if (!config.remote || (!force && token && expiresAt > clock() + 15000)) return { ...target, promise: Promise.resolve(null) };
    if (authTask?.generation === generation) return authTask;
    const initData = initDataProvider();
    if (typeof initData !== 'string' || !initData) throw new ApiError('Откройте приложение кнопкой в Telegram-боте. Обычная ссылка не подтверждает ваш профиль.', 'telegram_required');
    const task = { ...target, promise: null };
    task.promise = (async () => {
      const result = await send('/api/auth/telegram', { method: 'POST', body: { init_data: initData } }, '', target);
      if (target.generation !== generation) throw new ApiError('Адрес сервера изменился. Повторите попытку.', 'endpoint_changed');
      const expiry = Date.parse(result.expires_at);
      if (typeof result.token !== 'string' || !result.token || /\s/.test(result.token) || !Number.isFinite(expiry) || expiry <= clock()) throw new ApiError('Сервер не выдал действующий сеанс Telegram. Откройте приложение снова.', 'invalid_auth');
      token = result.token;
      expiresAt = expiry;
      return result;
    })().finally(() => { if (authTask === task) authTask = null; });
    authTask = task;
    return task;
  }

  async function authenticate(force = false, { signal, allowRecovery = true, recovery = { used: false } } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      abortIfNeeded(signal);
      const task = authenticationTask(force);
      try { return await waitFor(task.promise, signal); }
      catch (error) {
        abortIfNeeded(signal);
        if (attempt === 0 && task.generation !== generation) continue;
        if (attempt === 0 && allowRecovery && !recovery.used && isTransportFailure(error)) {
          recovery.used = true;
          if (await recover(task, error, signal)) continue;
        }
        throw error;
      }
    }
  }

  async function request(path, options = {}) {
    const recovery = { used: false };
    await authenticate(false, { signal: options.signal, recovery });
    const target = endpoint();
    try { return await send(path, options, target.remote ? token : '', target); }
    catch (error) {
      abortIfNeeded(options.signal);
      if (error.status === 401 && target.remote) {
        if (target.generation === generation) { token = ''; expiresAt = 0; }
        await authenticate(true, { signal: options.signal, allowRecovery: false });
        return await send(path, options, token);
      }
      if (!recovery.used && isTransportFailure(error)) {
        recovery.used = true;
        const changed = await recover(target, error, options.signal);
        // A lost mutation response may already have been applied. Only reads
        // can be automatically replayed after discovering another tunnel.
        if (changed && (options.method ?? 'GET') === 'GET') {
          await authenticate(false, { signal: options.signal, allowRecovery: false });
          return await send(path, options, config.remote ? token : '');
        }
      }
      throw error;
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
    testTelegramDelivery: () => request('/api/profile/delivery/test', { method: 'POST', body: {} }),
    translate: eventId => request(`/api/events/${eventId}/translate`, { method: 'POST', body: {} }),
  };
}

export const api = createApiClient();
