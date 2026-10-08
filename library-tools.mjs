import { DEFAULT_PREFS, preferencesForMode } from './model.mjs?v=20261009-library3';

export const BULK_LIMIT = 100;
export const PREFERENCE_LABELS = Object.freeze({ enabled: 'Уведомления', mode: 'Режим', patches: 'Обновления', news: 'Новости', builds: 'Сборки', include_unknown: 'Неизвестная важность', timing: 'Когда присылать', translation_mode: 'Язык' });
export function preferenceLabel(key, value) {
  if (typeof value === 'boolean') return value ? 'Включено' : 'Выключено';
  return ({ mode: { major: 'Только важное', updates: 'Все обновления', all: 'Всё подряд', custom: 'Вручную', medium: 'Средние (прежний режим)', minor: 'Небольшие (прежний режим)' }, timing: { fast: 'Сразу после обнаружения', described: 'Когда есть описание' }, translation_mode: { auto: 'Сразу, затем русский', original: 'Оригинал', required: 'Дождаться русского' } })[key]?.[value] || String(value);
}
export function applyPreferencePatch(previous = {}, patch = {}) {
  const current = { ...DEFAULT_PREFS, ...previous };
  const base = Object.hasOwn(patch, 'mode') ? preferencesForMode(patch.mode, current) : current;
  return { ...base, ...patch };
}
export function createBulkSelection() {
  const state = { selected: new Set(), query: '', patch: {}, busy: false, message: '', error: '' };
  let games = [];
  function reconcile(library = []) {
    games = library;
    const known = new Set(games.map(game => Number(game.app_id)));
    for (const appId of state.selected) if (!known.has(appId)) state.selected.delete(appId);
  }
  function filtered() { const query = state.query.trim().toLocaleLowerCase('ru'); return games.filter(game => !query || `${game.name} ${game.app_id}`.toLocaleLowerCase('ru').includes(query)); }
  function toggle(appId, checked) {
    if (!games.some(game => Number(game.app_id) === appId)) return false;
    if (!checked) { state.selected.delete(appId); return true; }
    if (!state.selected.has(appId) && state.selected.size >= BULK_LIMIT) return false;
    state.selected.add(appId); return true;
  }
  function selectFiltered() { for (const game of filtered()) { if (state.selected.size >= BULK_LIMIT) break; state.selected.add(Number(game.app_id)); } }
  function selectedGames() { return games.filter(game => state.selected.has(Number(game.app_id))); }
  function changes() { return selectedGames().map(game => {
    const previous = { ...DEFAULT_PREFS, ...game.preferences };
    const next = applyPreferencePatch(previous, state.patch);
    return { game, next, fields: Object.keys(PREFERENCE_LABELS).filter(key => previous[key] !== next[key]).map(key => ({ key, before: previous[key], after: next[key] })) };
  }); }
  function payload() { return { app_ids: selectedGames().map(game => Number(game.app_id)), patch: { ...state.patch } }; }
  function clear() { Object.assign(state, { selected: new Set(), query: '', patch: {}, busy: false, message: '', error: '' }); games = []; }
  return { state, reconcile, filtered, toggle, selectFiltered, selectedGames, changes, payload, clear };
}

// Read-only tools invalidate even a late response from a transport that ignores
// AbortSignal. Mutations are managed separately and are never replayed here.
export function createToolRead(fetchResult, onChange = () => {}) {
  const state = { result: null, loading: false, error: '' };
  let generation = 0;
  let controller;
  function cancel({ clear = false } = {}) { generation++; controller?.abort(); controller = null; state.loading = false; if (clear) { state.result = null; state.error = ''; } }
  async function load(payload) {
    cancel({ clear: true });
    const current = generation;
    controller = new AbortController();
    const signal = controller.signal;
    state.loading = true; onChange();
    try {
      const result = await fetchResult(payload, signal);
      if (generation !== current) return false;
      state.result = result; return true;
    } catch (error) {
      if (generation !== current || signal.aborted) return false;
      state.error = error.message || 'Не удалось загрузить данные. Повторите попытку.'; return false;
    } finally { if (generation === current) { state.loading = false; controller = null; onChange(); } }
  }
  return { state, cancel, load };
}

export function normalizeRecapFilters(value = {}) {
  const appId = Number(value.app_id);
  const days = [7, 30, 90].includes(Number(value.days)) ? Number(value.days) : 30;
  const kinds = ['updates', ...(value.news ? ['news'] : []), ...(value.builds ? ['builds'] : [])].join(',');
  const custom = value.period === 'custom';
  const since = typeof value.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.since) ? value.since : '';
  return { app_id: Number.isSafeInteger(appId) && appId > 0 ? appId : 0, days, period: custom ? 'custom' : String(days), since, news: Boolean(value.news), builds: Boolean(value.builds), kinds };
}
export function recapRequest(filters, now = new Date()) {
  if (!filters.app_id) throw new Error('Выберите игру из библиотеки.');
  if (filters.period !== 'custom') return { app_id: filters.app_id, days: filters.days, kinds: filters.kinds };
  const date = new Date(`${filters.since}T00:00:00`);
  const parts = filters.since.split('-').map(Number);
  if (!filters.since || !Number.isFinite(date.getTime()) || date.getFullYear() !== parts[0] || date.getMonth() + 1 !== parts[1] || date.getDate() !== parts[2] || date > now) throw new Error('Выберите корректную дату в прошлом или сегодня.');
  if (now - date > 365 * 86400000) throw new Error('Можно посмотреть период до одного года. Выберите более позднюю дату.');
  return { app_id: filters.app_id, since: date.toISOString(), until: now.toISOString(), kinds: filters.kinds };
}
export function createRecapPager(fetchPage, onChange = () => {}) {
  const state = { filters: normalizeRecapFilters(), result: null, items: [], loading: false, error: '', errorIsMore: false, hasMore: false, nextCursor: null };
  let generation = 0;
  let controller;
  let snapshot = null;
  function cancel() { generation++; controller?.abort(); controller = null; state.loading = false; }
  function setFilters(value, { force = false } = {}) {
    const next = normalizeRecapFilters(value);
    if (!force && JSON.stringify(next) === JSON.stringify(state.filters)) return false;
    cancel(); snapshot = null; Object.assign(state, { filters: next, result: null, items: [], error: '', errorIsMore: false, hasMore: false, nextCursor: null }); return true;
  }
  async function load({ more = false } = {}) {
    if (state.loading || more && (!state.hasMore || !state.nextCursor)) return false;
    const requestGeneration = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    const cursor = more ? state.nextCursor : null;
    state.loading = true; state.error = ''; state.errorIsMore = more; onChange();
    try {
      const payload = more && snapshot ? snapshot : recapRequest(state.filters);
      const result = await fetchPage({ ...payload, limit: 20, ...(cursor ? { cursor } : {}) }, signal);
      if (generation !== requestGeneration) return false;
      if (!Array.isArray(result?.items) || typeof result.has_more !== 'boolean' || result.has_more && (typeof result.next_cursor !== 'string' || !result.next_cursor || result.next_cursor === cursor)) throw new Error('Сервер вернул неполный обзор. Повторите попытку.');
      snapshot = payload;
      const map = new Map((more ? state.items : []).map(item => [String(item.event?.id), item]));
      for (const item of result.items) map.set(String(item.event?.id), item);
      state.items = [...map.values()]; state.result = result; state.hasMore = result.has_more; state.nextCursor = result.has_more ? result.next_cursor : null; return true;
    } catch (error) { if (generation !== requestGeneration || signal.aborted) return false; state.error = error.message || 'Не удалось загрузить обзор.'; return false; }
    finally { if (generation === requestGeneration) { state.loading = false; controller = null; onChange(); } }
  }
  return { state, cancel, setFilters, load };
}
