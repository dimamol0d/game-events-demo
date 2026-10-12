import { escapeHTML as h } from './model.mjs?v=20261012-syncaudit1';
import { expectedPriceRegion, PRICE_LIST_LIMIT } from './prices.mjs?v=20261012-syncaudit1';

const validId = id => Number.isSafeInteger(id) && id > 0 && id <= 4294967295;
const tokenPattern = /^[a-f0-9]{64}$/;
const sameRegion = (a, b) => a?.country === b?.country && a?.version === b?.version;

export function createPriceSteamImport() {
  const state = { open: false, loading: false, busy: false, connected: null, games: [], total: null, nextOffset: null, accountToken: '', wishlistToken: '', selected: new Set(), known: new Set(), capacity: 0, query: '', mode: 'any', percent: '50', error: '', message: '', failures: new Map(), skipped: new Map(), previewSnapshot: null, previewSlots: null, region: null };
  let generation = 0; let readEpoch = 0; let controller;
  function cancel() { readEpoch++; controller?.abort(); controller = null; state.loading = false; }
  function reset() { generation++; cancel(); Object.assign(state, { open: false, busy: false, connected: null, games: [], total: null, nextOffset: null, accountToken: '', wishlistToken: '', selected: new Set(), known: new Set(), capacity: 0, query: '', mode: 'any', percent: '50', error: '', message: '', failures: new Map(), skipped: new Map(), previewSnapshot: null, previewSlots: null, region: null }); }
  function invalidate(message = 'Список изменился. Загрузите желаемое из Steam снова.', { cancelRead = true } = {}) {
    if (cancelRead) cancel();
    Object.assign(state, { games: [], total: null, nextOffset: null, accountToken: '', wishlistToken: '', selected: new Set(), failures: new Map(), skipped: new Map(), previewSnapshot: null, previewSlots: null, region: null, error: message, message: '' });
  }
  function reconcile(snapshot) {
    if (state.region && !sameRegion(state.region, expectedPriceRegion(snapshot))) invalidate('Регион изменился. Загрузите желаемое из Steam снова.');
    state.known = new Set((snapshot?.items || []).map(item => Number(item.app_id)));
    state.capacity = Math.max(0, (snapshot?.limit || snapshot?.settings?.max_games || PRICE_LIST_LIMIT) - state.known.size);
    // Preview flags cover another device's recent additions, but a newer
    // authoritative price snapshot must supersede them, including removals.
    if (state.previewSnapshot === snapshot) {
      for (const game of state.games) if (game.already_watching === true) state.known.add(game.app_id);
      if (state.previewSlots !== null) state.capacity = Math.min(state.capacity, state.previewSlots);
    }
    for (const id of state.selected) if (state.known.has(id) || state.skipped.has(id)) state.selected.delete(id);
  }
  function filtered() { const query = state.query.trim().toLocaleLowerCase('ru'); return state.games.filter(game => !query || game.name.toLocaleLowerCase('ru').includes(query) || String(game.app_id).includes(query)); }
  function toggle(id, checked) {
    if (state.busy || state.loading || !state.games.some(game => game.app_id === id) || state.known.has(id) || state.skipped.has(id)) return false;
    if (!checked) { state.selected.delete(id); return true; }
    if (state.selected.size >= state.capacity) { state.error = `Свободных мест: ${state.capacity}. Снимите выбор с другой игры или освободите место в «Хочу купить».`; return false; }
    state.selected.add(id); state.error = ''; return true;
  }
  function rule() {
    if (state.mode === 'any') return { enabled: true, mode: 'any', percent: 50 };
    const text = String(state.percent).trim();
    if (state.mode !== 'percent' || !/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 100) throw new Error('Минимальная скидка должна быть от 1 до 100%.');
    return { enabled: true, mode: 'percent', percent: Number(text) };
  }
  async function load(fetcher, current, changed = () => {}, { more = false, snapshot } = {}) {
    if (state.busy || state.loading || more && state.nextOffset === null) return;
    cancel(); const owner = generation; const read = readEpoch; const offset = more ? state.nextOffset : 0;
    controller = new AbortController(); const signal = controller.signal;
    const valid = () => owner === generation && read === readEpoch && !signal.aborted && state.open && current();
    state.loading = true; state.error = ''; state.message = ''; changed();
    try {
      const result = await fetcher(offset, signal);
      if (!valid()) return;
      if (result?.connected === false) { invalidate(''); state.connected = false; return; }
      const games = result?.games;
      if (!Array.isArray(games) || games.length > 50 || !Number.isSafeInteger(result.total) || result.total < 0 || result.total > 20000
          || result.offset !== offset || offset + games.length > result.total || !tokenPattern.test(result.account_token || '') || !tokenPattern.test(result.wishlist_token || '')
          || result.next_offset !== null && (!Number.isSafeInteger(result.next_offset) || result.next_offset !== offset + games.length || result.next_offset >= result.total || !games.length)
          || result.next_offset === null && offset + games.length !== result.total) throw new Error('Steam вернул неполный список. Загрузите его снова.');
      if (more && (result.account_token !== state.accountToken || result.wishlist_token !== state.wishlistToken || result.total !== state.total)) { invalidate(); return; }
      const ids = new Set(more ? state.games.map(game => game.app_id) : []);
      for (const game of games) {
        if (!validId(game?.app_id) || typeof game?.name !== 'string' || !game.name.trim() || game.name.length > 1000 || ids.has(game.app_id)) throw new Error('Не удалось прочитать список желаемого Steam. Загрузите его снова.');
        ids.add(game.app_id);
      }
      if (!more) { state.selected.clear(); state.failures.clear(); state.skipped.clear(); state.query = ''; }
      state.games = more ? [...state.games, ...games] : games; state.connected = true;
      state.total = result.total; state.nextOffset = result.next_offset; state.accountToken = result.account_token; state.wishlistToken = result.wishlist_token;
      state.previewSnapshot = snapshot; state.previewSlots = Number.isSafeInteger(result.slots_remaining) && result.slots_remaining >= 0 ? result.slots_remaining : null; state.region = expectedPriceRegion(snapshot);
      reconcile(snapshot);
      state.message = result.total ? 'Отметьте нужные игры. Добавление начнётся только после вашего нажатия.' : 'Steam вернул пустой список желаемого. Если в Steam есть игры, проверьте доступность профиля и повторите загрузку.';
      if (result.notice) state.message += ' ' + String(result.notice);
    } catch (error) {
      if (valid()) {
        state.error = error.message || 'Не удалось загрузить желаемое из Steam.';
        if (['steam_connection_changed', 'steam_not_connected', 'steam_wishlist_private', 'steam_wishlist_changed'].includes(error.code)) invalidate(state.error);
        if (error.code === 'steam_not_connected') state.connected = false;
      }
    }
    finally { if (owner === generation && read === readEpoch) { state.loading = false; controller = null; if (current()) changed(); } else if (owner === generation && current()) changed(); }
  }
  async function add(send, current, accept, changed = () => {}, { snapshot } = {}) {
    if (state.busy || state.loading) return { added: 0 };
    reconcile(snapshot); const region = expectedPriceRegion(snapshot);
    if (state.selected.size > state.capacity) { state.error = `Выбрано ${state.selected.size}, свободных мест ${state.capacity}. Снимите лишний выбор или освободите место в «Хочу купить».`; changed(); return { added: 0 }; }
    let selectedRule;
    try { selectedRule = rule(); if (!region || !tokenPattern.test(state.accountToken)) throw new Error('Обновите список цен и желаемое из Steam перед добавлением.'); }
    catch (error) { state.error = error.message; changed(); return { added: 0 }; }
    const ids = [...state.selected]; if (!ids.length) return { added: 0 };
    const owner = generation; const account = state.accountToken;
    cancel(); const write = readEpoch;
    const valid = () => owner === generation && write === readEpoch && account === state.accountToken && current();
    state.busy = true; state.error = ''; state.message = `Добавляем выбранные игры: 0 из ${ids.length}…`; changed();
    let added = 0; let completed = 0;
    try {
      for (let start = 0; start < ids.length && valid(); start += 5) {
        const batch = ids.slice(start, start + 5);
        const result = await send({ app_ids: batch, rule: selectedRule, expected_region: region, account_token: account });
        if (!valid()) break;
        const observed = expectedPriceRegion(result?.wishlist);
        if (!sameRegion(region, observed) || !Array.isArray(result?.wishlist?.items) || !Array.isArray(result.added) || !Array.isArray(result.already_watching) || !Array.isArray(result.failed) || !Array.isArray(result.skipped)) throw new Error('Сервер не подтвердил результат добавления. Обновите список цен.');
        const confirmed = new Set();
        for (const id of [...result.added, ...result.already_watching]) {
          if (!validId(id) || !batch.includes(id) || confirmed.has(id) || !result.wishlist.items.some(game => game.app_id === id)) throw new Error('Сервер вернул неполное подтверждение. Обновите список цен перед повтором.');
          confirmed.add(id);
        }
        for (const entry of [...result.failed, ...result.skipped]) {
          if (!validId(entry?.app_id) || !batch.includes(entry.app_id) || confirmed.has(entry.app_id) || typeof entry.message !== 'string') throw new Error('Сервер вернул неполное подтверждение. Обновите список цен перед повтором.');
          confirmed.add(entry.app_id);
        }
        if (confirmed.size !== batch.length) throw new Error('Сервер подтвердил не все выбранные игры. Обновите список цен перед повтором.');
        accept(result.wishlist);
        for (const id of [...result.added, ...result.already_watching]) { state.selected.delete(id); state.failures.delete(id); const game = state.games.find(game => game.app_id === id); if (game) game.already_watching = true; }
        for (const entry of result.skipped) { state.selected.delete(entry.app_id); state.skipped.set(entry.app_id, entry.message); state.failures.delete(entry.app_id); }
        for (const entry of result.failed) state.failures.set(entry.app_id, entry.message);
        added += result.added.length; completed += batch.length; reconcile(result.wishlist);
        state.message = `Обработано ${completed} из ${ids.length}. Добавлено: ${added}.`; changed();
      }
      if (valid()) {
        state.message += ' У каждой игры можно отдельно изменить условие скидки.';
        if (state.failures.size) state.error = 'Часть игр не удалось добавить. Они остаются выбранными: повторите попытку или снимите с них выбор.';
      }
    } catch (error) {
      if (valid()) {
        state.error = `${error.message || 'Не удалось завершить импорт.'} Подтверждённые игры сохранены. Если ответ потерялся, часть игр могла добавиться; повтор не создаст дубликаты и сохранит настройки.`;
        if (['steam_connection_changed', 'steam_not_connected', 'steam_region_changed', 'steam_wishlist_changed'].includes(error.code)) invalidate(state.error);
        if (error.code === 'steam_not_connected') state.connected = false;
      }
    } finally { if (owner === generation) { if (write !== readEpoch && account === state.accountToken) state.message = 'Импорт остановлен. Уже отправленная часть могла сохраниться. Проверьте «Хочу купить» перед повтором; повтор не создаст дубликаты.'; state.busy = false; if (current()) changed(); } }
    return { added, completed };
  }
  return { state, cancel, reset, invalidate, reconcile, filtered, toggle, rule, load, add };
}

export function priceSteamImportPanel(tools, { disabled = false } = {}) {
  const state = tools.state; if (!state.open) return '';
  const locked = state.busy || state.loading || disabled;
  const games = tools.filtered();
  return `<section class="price-steam-import" aria-labelledby="price-steam-import-heading" aria-busy="${state.busy || state.loading}"><div class="section-heading"><h3 id="price-steam-import-heading">Желаемое из Steam</h3><button type="button" class="button quiet small" data-action="price-steam-close" ${state.busy ? 'disabled' : ''}>Закрыть</button></div><p class="subtle">Загружаем желаемое подключённого Steam-аккаунта. Выбранные игры и DLC попадут в «Хочу купить»; существующие условия скидок сохранятся. Это разовый импорт: новые игры в Steam автоматически сюда не добавляются.</p><p class="transfer-message" role="status" aria-live="polite">${h(state.error || state.message || (state.loading ? 'Загружаем список Steam…' : ''))}</p>${state.connected === false ? '<p>Сначала подключите Steam через официальный вход в профиле, затем вернитесь в «Скидки» и нажмите импорт снова.</p><a class="button secondary" href="#profile">Подключить Steam в профиле</a>' : ''}${state.connected === true && state.total !== null ? `<div class="price-steam-count"><span>Загружено: ${state.games.length} из ${state.total}</span><span>Выбрано: ${state.selected.size} · свободно мест: ${state.capacity}</span></div>${state.games.length ? `<label class="schedule-field">Поиск среди загруженных игр<input id="price-steam-search" type="search" maxlength="200" value="${h(state.query)}" placeholder="Название или AppID" ${locked ? 'disabled' : ''}></label><div class="price-steam-games">${games.map(game => {
    const known = state.known.has(game.app_id); const skipped = state.skipped.get(game.app_id); const failed = state.failures.get(game.app_id); const selected = state.selected.has(game.app_id);
    return `<label class="price-steam-game"><input type="checkbox" data-price-steam-game="${game.app_id}" ${selected ? 'checked' : ''} ${locked || known || skipped || !selected && state.selected.size >= state.capacity ? 'disabled' : ''}><span><strong>${h(game.name)}</strong><small>${game.type === 'dlc' ? 'Дополнение DLC' : game.type === 'game' ? 'Игра Steam' : 'Тип уточним при добавлении'} · AppID ${game.app_id}</small>${known ? '<small class="price-steam-known">Уже в «Хочу купить» · настройки сохранены</small>' : skipped || failed ? `<small class="source-warning">${h(skipped || failed)}</small>` : ''}</span></label>`;
  }).join('') || '<p class="subtle">Среди загруженных игр ничего не найдено. Можно загрузить следующую часть списка.</p>'}</div>${state.nextOffset !== null ? `<button type="button" class="button quiet small" data-action="price-steam-more" ${locked ? 'disabled' : ''}>Загрузить ещё игры</button>` : ''}<form id="price-steam-import-form"><fieldset ${locked ? 'disabled' : ''}><legend>Условие для новых игр</legend><label class="schedule-field">Когда сообщать<select name="mode"><option value="any" ${state.mode === 'any' ? 'selected' : ''}>При любой скидке</option><option value="percent" ${state.mode === 'percent' ? 'selected' : ''}>При скидке от выбранного процента</option></select></label>${state.mode === 'percent' ? `<label class="schedule-field">Минимальная скидка, %<input name="percent" type="number" min="1" max="100" step="1" inputmode="numeric" value="${h(state.percent)}"></label>` : ''}<p class="subtle">Это начальное условие только для новых игр. После импорта каждую игру можно настроить отдельно. Подходящие скидки, которые уже идут, тоже могут прийти по вашему расписанию.</p>${state.selected.size > state.capacity ? `<p class="source-warning">Выбрано больше игр, чем свободных мест. Снимите лишний выбор перед добавлением.</p>` : ''}<div class="price-steam-actions"><button class="button secondary" type="submit" ${locked || !state.selected.size || state.selected.size > state.capacity ? 'disabled' : ''}>Добавить выбранные (${state.selected.size})</button><button class="button quiet small" type="button" data-action="price-steam-clear" ${locked || !state.selected.size ? 'disabled' : ''}>Снять выбор</button></div></fieldset></form>` : ''}` : ''}<button type="button" class="button quiet small" data-action="price-steam-refresh" ${locked ? 'disabled' : ''}>${state.total === null ? 'Повторить загрузку' : 'Загрузить из Steam заново'}</button></section>`;
}
