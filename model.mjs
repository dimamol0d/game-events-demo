export const DEFAULT_PREFS = Object.freeze({ enabled: true, mode: 'updates', patches: true, builds: false, news: false, include_unknown: true, timing: 'described' });
export const MODES = Object.freeze([
  { id: 'updates', name: 'Обновления', text: 'Официальные патчи и исправления. Обычные новости и технические билды остаются в истории.' },
  { id: 'major', name: 'Только крупные', text: 'Обновления, которым присвоена категория «крупное». Неоценённые публикации — по переключателю ниже.' },
  { id: 'medium', name: 'Средние', text: 'Обновления с категорией «среднее». Неоценённые публикации — по переключателю ниже.' },
  { id: 'minor', name: 'Мелкие', text: 'Небольшие патчи и исправления с категорией «мелкое». Неоценённые публикации — по переключателю ниже.' },
  { id: 'all', name: 'Всё подряд', text: 'Обновления, новости и новые публичные билды. В активных играх сообщений может быть много.' },
  { id: 'custom', name: 'Свои правила', text: 'Выберите типы событий самостоятельно. Несколько технических билдов могут выйти за один день.' },
]);

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function safeURL(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) return '';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}

const IMAGE_HOSTS = new Set(['cdn.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com', 'shared.akamai.steamstatic.com', 'shared.fastly.steamstatic.com', 'store.akamai.steamstatic.com', 'store.cloudflare.steamstatic.com', 'steamcdn-a.akamaihd.net', 'cdn.steamstatic.com']);
export function safeImageURL(value) {
  const valid = safeURL(value);
  if (!valid) return '';
  const url = new URL(valid);
  return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname) && (!url.port || url.port === '443') ? url.href : '';
}

export function parseRoute(hash = '') {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const match = /^(game|settings)\/(\d+)$/.exec(path);
  if (match && Number(match[2]) > 0 && Number.isSafeInteger(Number(match[2]))) {
    return { page: match[1], appId: Number(match[2]), eventId: new URLSearchParams(query).get('event') };
  }
  return { page: ['home', 'search', 'library', 'inbox'].includes(path) ? path : 'home' };
}

export function eventRoute(event) {
  return `#game/${Number(event.app_id)}?event=${encodeURIComponent(String(event.id))}`;
}

export function mergeEvents(current = [], incoming = []) {
  const events = new Map();
  for (const event of [...current, ...incoming]) events.set(String(event.id), event);
  return [...events.values()];
}

export function formatDate(value, withTime = false) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}

export function eventLabel(event) {
  return ({ official_update_published: 'Обновление', official_news_published: 'Публикация', public_build_changed: 'Новый билд' })[event.kind] || 'Событие';
}

export function excerpt(text, length = 190) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length).trimEnd()}…` : clean;
}

export function preferencesForMode(mode, previous = DEFAULT_PREFS) {
  const prefs = { ...DEFAULT_PREFS, ...previous, mode };
  if (!MODES.some(item => item.id === mode)) return { ...prefs, mode: 'updates' };
  if (mode !== 'custom') return { ...prefs, patches: true, builds: mode === 'all', news: mode === 'all', include_unknown: ['major', 'medium', 'minor'].includes(mode) ? false : prefs.include_unknown };
  return prefs;
}

export function coverageText(game) {
  return ({ awaiting: 'Первая проверка ожидается', ready: 'Источники проверены', partial: 'Доступна часть источников', error: 'Проверка не удалась' })[game.poll_status] || 'Проверка ожидается';
}

export function sourceLabel(source) {
  if (['steam-news-api', 'steam_news', 'steam_news_api', 'steam_community_announcements'].includes(source)) return 'Официальная публикация в Steam';
  if (['steamkit', 'steamkit-pics', 'steamkit_pics', 'SteamKit/PICS'].includes(source)) return 'Данные Steam';
  if (['steamcmd-api', 'steamcmd_api', 'steamcmd.net', 'api.steamcmd.net'].includes(source)) return 'Проверка публичного билда';
  return 'Первоисточник';
}

export function publicationLanguage(event, preferred = 'ru') {
  const translated = event.translation_status === 'ready' && typeof event.contents_ru === 'string' && Boolean(event.contents_ru.trim());
  const russian = preferred !== 'original' && translated;
  return { title: russian && typeof event.title_ru === 'string' && event.title_ru.trim() ? event.title_ru : event.title,
    contents: russian ? event.contents_ru : event.contents, translated, russian,
    originalRussian: String(event.original_language || '').toLowerCase().startsWith('ru') };
}

export function latestPublications(games = []) {
  return games.filter(game => game.latest_event && ['official_update_published', 'official_news_published'].includes(game.latest_event.kind))
    .sort((a, b) => (Date.parse(b.latest_event.published_at || b.latest_event.sort_at) || 0) - (Date.parse(a.latest_event.published_at || a.latest_event.sort_at) || 0));
}
