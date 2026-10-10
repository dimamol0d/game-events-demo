export const PRICE_LIST_LIMIT = 30;
const modes = new Set(['any', 'percent', 'price']);

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
  return snapshot?.settings?.regions?.find(item => item.country === snapshot.settings.country)?.currency || '';
}
export function expectedPriceRegion(snapshot) {
  const settings = snapshot?.settings;
  const country = settings?.country; const version = settings?.region_version;
  if (!/^[a-z]{2}$/.test(String(country || '')) || !settings?.regions?.some(region => region.country === country)
    || typeof version !== 'string' || !version.trim()) return null;
  return { country, version };
}
export function createPriceTools() {
  const state = { snapshot: null, loading: false, loaded: false, busy: false, error: '', message: '', country: '', query: '', kind: 'game', searchResult: null, searching: false, searchError: '', drafts: new Map(), removeId: null };
  let generation = 0; let readEpoch = 0; let searchEpoch = 0; let readController; let searchController;
  function cancelRead() { readEpoch++; readController?.abort(); readController = null; state.loading = false; }
  function cancelSearch() { searchEpoch++; searchController?.abort(); searchController = null; state.searching = false; }
  function cancel() { cancelRead(); cancelSearch(); }
  function accept(snapshot) {
    if (!snapshot?.settings || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.settings.regions)) throw new Error('Сервер не подтвердил список скидок. Обновите его.');
    const previous = state.snapshot;
    const regionChanged = previous?.settings.country !== snapshot.settings.country
      || previous?.settings.region_version !== snapshot.settings.region_version;
    for (const [id, draft] of state.drafts) {
      const oldRule = previous?.items.find(value => Number(value.app_id) === id)?.rule;
      const newRule = snapshot.items.find(value => Number(value.app_id) === id)?.rule;
      const monetary = draft.mode === 'price' || oldRule?.mode === 'price' || newRule?.mode === 'price';
      if (regionChanged && monetary || !newRule || JSON.stringify(oldRule) !== JSON.stringify(newRule)) state.drafts.delete(id);
    }
    state.snapshot = snapshot; state.loaded = true; state.country = snapshot.settings.country || ''; state.removeId = null;
  }
  function clear() { generation++; cancel(); Object.assign(state, { snapshot: null, loading: false, loaded: false, busy: false, error: '', message: '', country: '', query: '', kind: 'game', searchResult: null, searching: false, searchError: '', drafts: new Map(), removeId: null }); }
  async function load(fetcher, current, changed = () => {}) {
    if (state.busy) return;
    cancelRead(); const epoch = readEpoch; const owner = generation; readController = new AbortController(); const signal = readController.signal;
    const valid = () => owner === generation && epoch === readEpoch && !signal.aborted && current();
    state.loading = true; state.error = ''; changed();
    try { const snapshot = await fetcher(signal); if (valid()) accept(snapshot); }
    catch (error) { if (valid()) state.error = error.message || 'Не удалось получить цены.'; }
    finally { if (owner === generation && epoch === readEpoch) { state.loading = false; readController = null; if (current()) changed(); } }
  }
  async function search(fetcher, current, changed = () => {}) {
    cancelSearch(); const epoch = searchEpoch; const owner = generation; const query = state.query.trim(); const kind = state.kind;
    state.searchResult = null; state.searchError = '';
    if (!query) { changed(); return; }
    searchController = new AbortController(); const signal = searchController.signal;
    const valid = () => owner === generation && epoch === searchEpoch && !signal.aborted && query === state.query.trim() && kind === state.kind && current();
    state.searching = true; changed();
    try { const result = await fetcher(query, kind, signal); if (valid()) state.searchResult = result; }
    catch (error) { if (valid()) state.searchError = error.message || 'Не удалось найти игру.'; }
    finally { if (owner === generation && epoch === searchEpoch) { state.searching = false; searchController = null; if (current()) changed(); } }
  }
  async function write(task, current, changed = () => {}, message = 'Сохранено.') {
    if (state.busy || state.loading) return false;
    const owner = generation; cancel(); state.busy = true; state.error = ''; state.message = 'Сохраняем…'; changed();
    let saved = false;
    try { const snapshot = await task(); if (owner === generation && current()) { accept(snapshot); state.message = message; saved = true; } }
    catch (error) { if (owner === generation && current()) { state.error = `Не удалось подтвердить сохранение. ${error.message || 'Ответ потерялся.'} Обновите список и проверьте результат; повторное добавление не создаст дубликат.`; state.message = ''; } }
    finally { if (owner === generation) { state.busy = false; if (current()) changed(); } }
    return saved;
  }
  function item(appId) { return state.snapshot?.items.find(value => Number(value.app_id) === Number(appId)); }
  function draft(appId) {
    const id = Number(appId); if (!state.drafts.has(id)) { const rule = item(id)?.rule || {}; state.drafts.set(id, { enabled: rule.enabled !== false, mode: modes.has(rule.mode) ? rule.mode : 'any', percent: String(rule.percent || 50), price: rule.needs_confirmation ? '' : priceInput(rule.price_minor) }); }
    return state.drafts.get(id);
  }
  return { state, cancel, cancelSearch, clear, accept, load, search, write, item, draft };
}
