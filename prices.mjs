export const PRICE_LIST_LIMIT = 30;
const modes = new Set(['any', 'percent', 'price']);
const validAppId = value => Number.isSafeInteger(value) && value > 0 && value <= 4294967295;

function validatePriceSnapshot(snapshot) {
  const invalid = () => { throw new Error('Сервер не подтвердил список скидок. Обновите его.'); };
  const settings = snapshot?.settings;
  if (!settings || !Array.isArray(snapshot.items) || snapshot.items.length > PRICE_LIST_LIMIT || !Array.isArray(settings.regions)
      || settings.regions.some(region => !region || !/^[a-z]{2}$/.test(region.country || '') || !/^[A-Z]{3}$/.test(region.currency || ''))
      || settings.country != null && !settings.regions.some(region => region.country === settings.country)) invalid();
  const ids = new Set();
  for (const item of snapshot.items) {
    if (!validAppId(item?.app_id) || ids.has(item.app_id) || typeof item.name !== 'string' || !item.name.trim()
        || !item.rule || typeof item.rule.enabled !== 'boolean' || !modes.has(item.rule.mode)
        || !Number.isSafeInteger(item.rule.percent) || item.rule.percent < 1 || item.rule.percent > 100) invalid();
    ids.add(item.app_id);
  }
  return snapshot;
}

function validatePriceSearch(value) {
  if (!Array.isArray(value?.games) || value.games.some(game => !validAppId(game?.app_id) || typeof game.name !== 'string' || !game.name.trim())) {
    throw new Error('Сервер не подтвердил результаты поиска. Повторите поиск.');
  }
  return value;
}

export function minorUnits(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 && result <= 10 ** 10 ? result : null;
}
export function priceInput(value) {
  return Number.isSafeInteger(value) && value > 0 ? `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}` : '';
}
export function formatPrice(value, currency) {
  if (!Number.isSafeInteger(value) || value < 0 || !/^[A-Z]{3}$/.test(String(currency || ''))) return 'Цена неизвестна';
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(value / 100); }
  catch { return `${priceInput(value) || '0.00'} ${currency}`; }
}
export function priceRule(draft, currency, { needsConfirmation = false } = {}) {
  if (!modes.has(draft.mode)) return { error: 'Выберите условие скидки.' };
  // Disabling a paused old-currency rule does not confirm or reinterpret its
  // amount. The server preserves that rule until a new amount is saved.
  if (needsConfirmation && draft.enabled === false && draft.mode === 'price') return { rule: { enabled: false } };
  const result = { enabled: Boolean(draft.enabled), mode: draft.mode, percent: 50, price_minor: null, currency: null };
  if (draft.mode === 'percent') {
    const text = String(draft.percent ?? '').trim();
    if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 100) return { error: 'Скидка должна быть от 1 до 100%.' };
    result.percent = Number(text);
  }
  if (draft.mode === 'price') {
    if (!/^[A-Z]{3}$/.test(String(currency || ''))) return { error: 'Сначала выберите регион магазина.' };
    const value = minorUnits(draft.price);
    if (value === null) return { error: 'Введите цену больше нуля, максимум два знака после запятой.' };
    result.price_minor = value; result.currency = currency;
  }
  return { rule: result };
}
export function regionCurrency(snapshot) {
  const regions = snapshot?.settings?.regions;
  return Array.isArray(regions) ? regions.find(item => item?.country === snapshot.settings.country)?.currency || '' : '';
}
export function expectedPriceRegion(snapshot) {
  const settings = snapshot?.settings;
  const country = settings?.country; const version = settings?.region_version;
  if (!/^[a-z]{2}$/.test(String(country || '')) || !Array.isArray(settings?.regions) || !settings.regions.some(region => region?.country === country)
    || typeof version !== 'string' || !version.trim()) return null;
  return { country, version };
}
export function bulkPriceRule(draft) {
  if (draft.mode === 'disabled') return { rule: { enabled: false } };
  if (draft.mode === 'any') return { rule: { enabled: true, mode: 'any' } };
  if (draft.mode !== 'percent') return { error: 'Выберите условие скидки.' };
  const text = String(draft.percent ?? '').trim();
  if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 100) return { error: 'Скидка должна быть от 1 до 100%.' };
  return { rule: { enabled: true, mode: 'percent', percent: Number(text) } };
}
const newBulkState = () => ({ open: false, selected: new Set(), mode: 'any', percent: '50', region: null, message: '' });
function validHistoryDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function validatePriceHistory(value, appId, snapshot) {
  const region = expectedPriceRegion(snapshot); const currency = regionCurrency(snapshot);
  if (!region || value?.app_id !== Number(appId) || value?.country !== region.country
      || value?.region_version !== region.version || value?.currency !== currency) {
    throw new Error('Регион или список игр изменился. Обновите список цен и откройте историю снова.');
  }
  const amount = number => Number.isSafeInteger(number) && number >= 0;
  if (!Array.isArray(value.points) || value.points.length > 120 || !Number.isSafeInteger(value.total_points)
      || value.total_points < value.points.length || typeof value.truncated !== 'boolean'
      || value.truncated !== (value.total_points > value.points.length)) throw new Error('Сервер вернул неполную историю цен. Повторите загрузку.');
  let previous = -Infinity;
  for (const point of value.points) {
    const at = Date.parse(point?.observed_at); const seen = Date.parse(point?.last_seen_at);
    if (!validHistoryDate(point?.observed_at) || !validHistoryDate(point?.last_seen_at) || at < previous || seen < at
        || !amount(point?.initial) || !amount(point?.final) || point.initial < point.final
        || !Number.isSafeInteger(point?.discount_percent) || point.discount_percent < 0 || point.discount_percent > 100) {
      throw new Error('Не удалось прочитать сохранённые проверки цены. Повторите загрузку.');
    }
    previous = at;
  }
  if (value.points.length) {
    if (!validHistoryDate(value.started_at) || !validHistoryDate(value.last_changed_at)
        || !amount(value.minimum?.final) || !validHistoryDate(value.minimum?.observed_at)) {
      throw new Error('Сервер не подтвердил даты или минимальную зафиксированную цену.');
    }
  } else if (value.minimum !== null || value.total_points !== 0) throw new Error('Сервер вернул неполную историю цен.');
  for (const name of ['last_checked_at', 'last_success_at']) {
    if (value[name] != null && !validHistoryDate(value[name])) throw new Error('Сервер не подтвердил дату проверки цены.');
  }
  return value;
}
export function createPriceTools() {
  const state = { snapshot: null, loading: false, loaded: false, busy: false, error: '', message: '', country: '', query: '', kind: 'game', searchResult: null, searching: false, searchError: '', drafts: new Map(), histories: new Map(), removeId: null, bulk: newBulkState() };
  let generation = 0; let readEpoch = 0; let searchEpoch = 0; let readController; let searchController;
  function cancelRead() { readEpoch++; readController?.abort(); readController = null; state.loading = false; }
  function cancelSearch() { searchEpoch++; searchController?.abort(); searchController = null; state.searching = false; }
  function cancelHistory(entry) {
    entry.read++; entry.controller?.abort(); entry.controller = null;
    if (entry.loading) entry.error = 'Загрузка истории прервана. Нажмите «Повторить», чтобы продолжить.';
    entry.loading = false;
  }
  function cancelHistories() { for (const entry of state.histories.values()) cancelHistory(entry); }
  function cancel() { cancelRead(); cancelSearch(); cancelHistories(); }
  function accept(snapshot) {
    validatePriceSnapshot(snapshot);
    const previous = state.snapshot;
    const regionChanged = previous?.settings.country !== snapshot.settings.country
      || previous?.settings.region_version !== snapshot.settings.region_version;
    for (const [id, entry] of state.histories) {
      const next = snapshot.items.find(value => Number(value.app_id) === id);
      if (regionChanged || !next) { cancelHistory(entry); state.histories.delete(id); }
      else {
        const before = previous?.items.find(value => Number(value.app_id) === id);
        if (JSON.stringify(before?.price) !== JSON.stringify(next.price)) {
          cancelHistory(entry); entry.stale = Boolean(entry.data);
        }
      }
    }
    for (const [id, draft] of state.drafts) {
      const oldRule = previous?.items.find(value => Number(value.app_id) === id)?.rule;
      const newRule = snapshot.items.find(value => Number(value.app_id) === id)?.rule;
      const monetary = draft.mode === 'price' || oldRule?.mode === 'price' || newRule?.mode === 'price';
      if (regionChanged && monetary || !newRule || !draft.dirty && JSON.stringify(oldRule) !== JSON.stringify(newRule)) state.drafts.delete(id);
    }
    const ids = new Set(snapshot.items.map(value => value.app_id));
    for (const id of state.bulk.selected) if (!ids.has(id)) state.bulk.selected.delete(id);
    if (previous && regionChanged) {
      if (state.bulk.selected.size) state.bulk.message = 'Регион изменился. Выберите игры заново перед применением общего условия.';
      state.bulk.selected.clear(); state.bulk.region = null;
    }
    state.snapshot = snapshot; state.loaded = true; state.country = snapshot.settings.country || ''; state.removeId = null;
  }
  function clear() { generation++; cancel(); Object.assign(state, { snapshot: null, loading: false, loaded: false, busy: false, error: '', message: '', country: '', query: '', kind: 'game', searchResult: null, searching: false, searchError: '', drafts: new Map(), histories: new Map(), removeId: null, bulk: newBulkState() }); }
  async function load(fetcher, current, changed = () => {}, { background = false } = {}) {
    if (state.busy) return false;
    cancelRead(); const epoch = readEpoch; const owner = generation; readController = new AbortController(); const signal = readController.signal;
    const valid = () => owner === generation && epoch === readEpoch && !signal.aborted && current();
    state.loading = !background; state.error = ''; changed();
    try { const snapshot = await fetcher(signal); if (!valid()) return false; accept(snapshot); return true; }
    catch (error) { if (valid()) state.error = error.message || 'Не удалось получить цены.'; return false; }
    finally { if (owner === generation && epoch === readEpoch) { state.loading = false; readController = null; if (current()) changed(); } }
  }
  async function search(fetcher, current, changed = () => {}) {
    cancelSearch(); const epoch = searchEpoch; const owner = generation; const query = state.query.trim(); const kind = state.kind;
    state.searchResult = null; state.searchError = '';
    if (!query) { changed(); return; }
    searchController = new AbortController(); const signal = searchController.signal;
    const valid = () => owner === generation && epoch === searchEpoch && !signal.aborted && query === state.query.trim() && kind === state.kind && current();
    state.searching = true; changed();
    try { const result = await fetcher(query, kind, signal); if (valid()) state.searchResult = validatePriceSearch(result); }
    catch (error) { if (valid()) state.searchError = error.message || 'Не удалось найти игру.'; }
    finally { if (owner === generation && epoch === searchEpoch) { state.searching = false; searchController = null; if (current()) changed(); } }
  }
  async function write(task, current, changed = () => {}, message = 'Сохранено.', { failureHelp = 'Обновите список и проверьте результат; повторное добавление не создаст дубликат.' } = {}) {
    if (state.busy || state.loading) return false;
    const owner = generation; cancel(); state.busy = true; state.error = ''; state.message = 'Сохраняем…'; changed();
    let saved = false;
    try { const snapshot = await task(); if (owner === generation && current()) { accept(snapshot); state.message = message; saved = true; } }
    catch (error) { if (owner === generation && current()) { state.error = `Не удалось подтвердить сохранение. ${error.message || 'Ответ потерялся.'} ${failureHelp}`; state.message = ''; } }
    finally { if (owner === generation) { state.busy = false; if (current()) changed(); } }
    return saved;
  }
  function item(appId) { return state.snapshot?.items.find(value => Number(value.app_id) === Number(appId)); }
  function history(appId) {
    const id = Number(appId); if (!item(id)) return null;
    if (!state.histories.has(id)) state.histories.set(id, { open: false, data: null, loading: false, error: '', stale: false, read: 0, controller: null });
    return state.histories.get(id);
  }
  function closeHistory(appId) {
    const entry = state.histories.get(Number(appId)); if (!entry) return;
    cancelHistory(entry); entry.open = false;
  }
  async function loadHistory(appId, fetcher, current, changed = () => {}, { force = false } = {}) {
    if (state.busy || state.loading) return false;
    const id = Number(appId); const entry = history(id); if (!entry) return false;
    entry.open = true;
    if (entry.loading || entry.data && !entry.stale && !force) { changed(); return false; }
    const region = expectedPriceRegion(state.snapshot);
    if (!region) { entry.error = 'Обновите список цен перед загрузкой истории.'; changed(); return false; }
    cancelHistory(entry); const read = entry.read; const owner = generation;
    entry.controller = new AbortController(); const signal = entry.controller.signal;
    const valid = () => owner === generation && state.histories.get(id) === entry && read === entry.read && !signal.aborted
      && Boolean(item(id)) && expectedPriceRegion(state.snapshot)?.country === region.country
      && expectedPriceRegion(state.snapshot)?.version === region.version && current();
    entry.loading = true; entry.error = ''; changed();
    try {
      const result = await fetcher(id, signal);
      if (!valid()) return false;
      entry.data = validatePriceHistory(result, id, state.snapshot); entry.stale = false;
      return true;
    } catch (error) {
      if (valid()) entry.error = error.message || 'Не удалось загрузить историю цен.';
      return false;
    } finally {
      if (owner === generation && state.histories.get(id) === entry && read === entry.read) {
        entry.loading = false; entry.controller = null; if (current()) changed();
      }
    }
  }
  function draft(appId) {
    const id = Number(appId); if (!state.drafts.has(id)) { const rule = item(id)?.rule || {}; state.drafts.set(id, { enabled: rule.enabled !== false, mode: modes.has(rule.mode) ? rule.mode : 'any', percent: String(rule.percent || 50), price: rule.needs_confirmation ? '' : priceInput(rule.price_minor) }); }
    return state.drafts.get(id);
  }
  function toggleBulk(appId, selected) {
    const id = Number(appId);
    if (!state.bulk.open || state.busy || state.loading || !validAppId(id) || !item(id)) return false;
    if (selected) {
      if (state.bulk.selected.size >= PRICE_LIST_LIMIT && !state.bulk.selected.has(id)) return false;
      if (!state.bulk.selected.size) state.bulk.region = expectedPriceRegion(state.snapshot);
      state.bulk.selected.add(id);
    } else state.bulk.selected.delete(id);
    state.bulk.message = ''; return true;
  }
  function selectAllBulk() {
    if (!state.bulk.open || state.busy || state.loading) return;
    state.bulk.region = expectedPriceRegion(state.snapshot);
    state.bulk.selected = new Set((state.snapshot?.items || []).map(value => value.app_id)); state.bulk.message = '';
  }
  function bulkRequest() {
    const appIds = [...state.bulk.selected];
    if (!appIds.length) return { error: 'Выберите игры в списке ниже.' };
    if (appIds.length > PRICE_LIST_LIMIT || appIds.some(id => !validAppId(id) || !item(id))) return { error: 'Список игр изменился. Обновите его и выберите игры заново.' };
    if (appIds.some(id => state.drafts.get(id)?.dirty)) return { error: 'У выбранных игр есть несохранённые личные условия. Сначала сохраните их или снимите выбор с этих игр.' };
    const expectedRegion = expectedPriceRegion(state.snapshot);
    if (!expectedRegion || state.bulk.region?.country !== expectedRegion.country || state.bulk.region?.version !== expectedRegion.version) return { error: 'Регион изменился или не подтверждён. Обновите список и выберите игры заново.' };
    const parsed = bulkPriceRule(state.bulk); if (parsed.error) return parsed;
    return { appIds, rule: parsed.rule, expectedRegion };
  }
  return { state, cancel, cancelSearch, clear, accept, load, search, write, item, draft, history, closeHistory, loadHistory, toggleBulk, selectAllBulk, bulkRequest };
}
