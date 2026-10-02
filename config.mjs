const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function resolveConfig(value = {}, pageURL = globalThis.location?.href) {
  const page = new URL(pageURL);
  const localPage = LOOPBACK.has(page.hostname);
  let backendURL = '';
  if (value.backend_url) {
    const url = new URL(value.backend_url);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
      || (url.protocol !== 'https:' && !(localPage && LOOPBACK.has(url.hostname) && url.protocol === 'http:'))) {
      throw new Error('Адрес сервера приложения настроен неправильно.');
    }
    backendURL = url.origin;
  }
  let botURL = 'https://t.me/my_steam_radar_dm_bot';
  if (typeof value.bot_url === 'string') {
    const candidate = new URL(value.bot_url);
    if (candidate.protocol === 'https:' && candidate.hostname === 't.me' && /^\/[a-zA-Z0-9_]+\/?$/.test(candidate.pathname) && !candidate.username && !candidate.password && !candidate.search && !candidate.hash) botURL = candidate.href;
  }
  return { backendURL, botURL, remote: Boolean(backendURL && backendURL !== page.origin) || !localPage, configured: Boolean(backendURL) || localPage };
}

export async function loadRuntimeConfig(fetchImpl = globalThis.fetch, pageURL = globalThis.location?.href) {
  const response = await fetchImpl(new URL('./runtime-config.json', pageURL).href, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) {
    if (LOOPBACK.has(new URL(pageURL).hostname)) return resolveConfig({}, pageURL);
    throw new Error('Не удалось загрузить адрес домашнего сервера. Повторите попытку.');
  }
  return resolveConfig(await response.json(), pageURL);
}
