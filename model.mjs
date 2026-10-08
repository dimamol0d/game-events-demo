export const DEFAULT_PREFS = Object.freeze({ enabled: true, mode: 'updates', patches: true, builds: false, news: false, include_unknown: true, timing: 'fast', translation_mode: 'auto' });
export const TRANSLATION_MODES = Object.freeze([
  { id: 'auto', name: 'Сразу, перевод добавится позже', text: 'Присылаем доступный текст без ожидания перевода. Когда краткий русский перевод готов, обновляем то же сообщение без нового уведомления.' },
  { id: 'original', name: 'Всегда оригинал', text: 'Присылаем исходный текст разработчика на его языке. Автоматический перевод не подменяет текст сообщения.' },
  { id: 'required', name: 'Только с русским переводом', text: 'Публикации на другом языке ждут готового краткого перевода. Текст разработчика на русском и технические сообщения о сборке переводить не нужно.' },
]);
export const MODES = Object.freeze([
  { id: 'major', name: 'Только важное', text: 'Новый контент и крупные изменения, явно описанные разработчиком. Обновления с неизвестной важностью — по переключателю ниже.' },
  { id: 'updates', name: 'Все обновления', text: 'Изменения самой игры: новый контент, баланс и исправления. Анонсы и технические сигналы без описания остаются в истории.' },
  { id: 'all', name: 'Всё подряд', text: 'Обновления, анонсы и технические сигналы о новой сборке. Сообщений может быть много; для самых ранних сигналов выберите «Сразу после обнаружения».' },
  { id: 'custom', name: 'Настроить вручную', text: 'Выберите, о каких событиях сообщать. Новый номер сборки сам по себе не объясняет, что изменилось для игрока.' },
  { id: 'medium', name: 'Средние (прежний режим)', text: 'Сохранён ваш прежний выбор. Среднюю важность пока надёжно не определяем; обновления без оценки придут только с переключателем ниже.', legacy: true },
  { id: 'minor', name: 'Небольшие изменения (прежний режим)', text: 'Исправления и небольшие изменения, явно описанные разработчиком. Обновления без оценки — по переключателю ниже.', legacy: true },
]);

export function modesForPreferences(preferences = DEFAULT_PREFS) {
  return MODES.filter(mode => !mode.legacy || mode.id === preferences.mode);
}

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
  const match = /^(game|settings|recap)\/(\d+)$/.exec(path);
  if (match && Number(match[2]) > 0 && Number.isSafeInteger(Number(match[2]))) {
    return { page: match[1], appId: Number(match[2]), eventId: new URLSearchParams(query).get('event') };
  }
  return { page: ['home', 'search', 'library', 'inbox', 'feed', 'profile', 'bulk', 'recap'].includes(path) ? path : 'home' };
}

export function normalizeFeedFilters(value = {}) {
  const appId = Number(value.app_id);
  return { kind: ['all', 'updates', 'news', 'builds'].includes(value.kind) ? value.kind : 'all',
    days: [0, 7, 30].includes(Number(value.days)) ? Number(value.days) : 7,
    ...(Number.isSafeInteger(appId) && appId > 0 ? { app_id: appId } : {}) };
}

// The feed is a read-only snapshot: changing filters or leaving the page
// invalidates even a response from a transport that does not honour abort.
export function createFeedPager(fetchPage, onChange = () => {}) {
  const state = { filters: normalizeFeedFilters(), events: [], nextCursor: null, hasMore: false,
    loading: false, loaded: false, error: '', errorIsMore: false };
  let epoch = 0;
  let controller;
  function cancel() {
    epoch++;
    controller?.abort(); controller = null;
    state.loading = false;
  }
  function setFilters(filters, { force = false } = {}) {
    const next = normalizeFeedFilters(filters);
    if (!force && JSON.stringify(next) === JSON.stringify(state.filters)) return false;
    cancel();
    Object.assign(state, { filters: next, events: [], nextCursor: null, hasMore: false,
      loaded: false, error: '', errorIsMore: false });
    return true;
  }
  async function load({ more = false } = {}) {
    if (state.loading || more && (!state.hasMore || !state.nextCursor)) return false;
    const requestEpoch = ++epoch;
    const requestController = new AbortController();
    controller = requestController;
    const cursor = more ? state.nextCursor : null;
    state.loading = true; state.error = ''; state.errorIsMore = more;
    onChange();
    try {
      const result = await fetchPage({ ...state.filters, limit: 30, ...(cursor ? { cursor } : {}) }, requestController.signal);
      if (epoch !== requestEpoch) return false;
      if (!Array.isArray(result?.events) || typeof result.has_more !== 'boolean'
        || result.has_more && (typeof result.next_cursor !== 'string' || !result.next_cursor || result.next_cursor === cursor)) {
        throw new Error('Сервер вернул неполную историю. Повторите попытку.');
      }
      state.events = more ? mergeEvents(state.events, result.events) : mergeEvents([], result.events);
      state.nextCursor = result.has_more ? result.next_cursor : null;
      state.hasMore = result.has_more; state.loaded = true;
      return true;
    } catch (error) {
      if (epoch !== requestEpoch || requestController.signal.aborted) return false;
      state.error = error.message || 'Не удалось загрузить историю. Повторите попытку.';
      return false;
    } finally {
      if (epoch === requestEpoch) { state.loading = false; controller = null; onChange(); }
    }
  }
  return { state, cancel, setFilters, load };
}

export function eventRoute(event) {
  return `#game/${Number(event.app_id)}?event=${encodeURIComponent(String(event.id))}`;
}

export function mergeEvents(current = [], incoming = []) {
  const events = new Map();
  for (const event of [...current, ...incoming]) events.set(String(event.id), event);
  const related = new Set();
  for (const event of events.values()) {
    if (!event.release_id || !Array.isArray(event.related_events)) continue;
    for (const item of event.related_events) if (item?.id != null && String(item.id) !== String(event.id)) related.add(String(item.id));
  }
  return [...events.values()].filter(event => !related.has(String(event.id)));
}

export function formatDate(value, withTime = false) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}

export function eventLabel(event) {
  if (event.understanding) return ({ update: 'Обновление игры', announcement: 'Анонс или новость', unknown: 'Тип пока не определён', build: 'Новая сборка игры' })[event.understanding.category] || 'Публикация';
  return ({ official_update_published: 'Обновление', official_news_published: 'Публикация', public_build_changed: 'Новый билд' })[event.kind] || 'Событие';
}

export function excerpt(text, length = 190) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length).trimEnd()}…` : clean;
}

export function preferencesForMode(mode, previous = DEFAULT_PREFS) {
  const prefs = { ...DEFAULT_PREFS, ...previous, mode };
  if (!MODES.some(item => item.id === mode)) return { ...prefs, mode: 'updates' };
  if (mode !== 'custom') return { ...prefs, patches: true, builds: mode === 'all', news: mode === 'all', include_unknown: mode === 'major' ? true : ['medium', 'minor'].includes(mode) ? false : prefs.include_unknown };
  return prefs;
}

export function eventUnderstanding(event, preferred = 'ru') {
  const language = publicationLanguage(event, preferred);
  const original = event.understanding || {};
  const localized = language.russian && event.understanding_ru ? event.understanding_ru : original;
  const useShort = language.shortRussian && Array.isArray(event.summary_points_ru);
  const summary = (useShort ? event.summary_points_ru : Array.isArray(localized.summary_points) ? localized.summary_points : []).filter(point => typeof point === 'string' && point.trim()).slice(0, 4);
  const importanceLevel = original.importance || ({ major: 'important', minor: 'routine' })[original.severity] || 'unknown';
  const importance = ({ important: 'Важное обновление', routine: 'Небольшие изменения' })[importanceLevel] || 'Важность пока неизвестна';
  return { ...original, summary_points: summary, importance_label: importance, importance_level: importanceLevel,
    summary_translated: !language.originalRussian && (useShort || Boolean(language.russian && event.understanding_ru)),
    summary_original: summary.length > 0 && !language.originalRussian && !useShort && !(language.russian && event.understanding_ru),
    category_reason_ru: original.category_reason_ru || '', importance_reason_ru: original.importance_reason_ru || '', severity_reason_ru: original.severity_reason_ru || '',
    version_labels: Array.isArray(original.version_labels) ? original.version_labels : [],
    explicit_build_ids: Array.isArray(original.explicit_build_ids) ? original.explicit_build_ids : [],
    change_types: Array.isArray(original.change_types) ? original.change_types : [] };
}

export function eventMatchesId(event, eventId) {
  if (!eventId) return false;
  return String(event.id) === String(eventId) || Array.isArray(event.related_events) && event.related_events.some(item => item?.id != null && String(item.id) === String(eventId));
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
  const shortTranslated = event.short_translation_status === 'ready' && (typeof event.short_title_ru === 'string' && Boolean(event.short_title_ru.trim()) || Array.isArray(event.summary_points_ru) && event.summary_points_ru.length > 0);
  const shortRussian = preferred !== 'original' && shortTranslated;
  return { title: shortRussian && typeof event.short_title_ru === 'string' && event.short_title_ru.trim() ? event.short_title_ru : russian && typeof event.title_ru === 'string' && event.title_ru.trim() ? event.title_ru : event.title,
    contents: russian ? event.contents_ru : event.contents, translated, russian, shortTranslated, shortRussian,
    originalRussian: String(event.original_language || '').toLowerCase().startsWith('ru') };
}

export function latestPublications(games = []) {
  return games.filter(game => game.latest_event && ['official_update_published', 'official_news_published'].includes(game.latest_event.kind))
    .sort((a, b) => (Date.parse(b.latest_event.published_at || b.latest_event.sort_at) || 0) - (Date.parse(a.latest_event.published_at || a.latest_event.sort_at) || 0));
}
