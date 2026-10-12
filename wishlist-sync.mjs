import { escapeHTML as h, formatDate } from './model.mjs?v=20261012-wishlistsync1';
import { expectedPriceRegion, PRICE_LIST_LIMIT } from './prices.mjs?v=20261012-wishlistsync1';

const validId = id => Number.isSafeInteger(id) && id > 0 && id <= 4294967295;
const validToken = token => /^[a-f0-9]{64}$/.test(token || '');
const sameRegion = (a, b) => a?.country === b?.country && a?.version === b?.version;
const sameBinding = (a, b) => a?.account_token === b?.account_token && sameRegion(a?.region, b?.region);
const validDate = value => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
const staleCodes = new Set(['steam_connection_changed', 'steam_not_connected', 'steam_region_changed']);
const syncErrors = { steam_wishlist_private: 'Steam не открыл список желаемого. Проверьте его доступность в настройках профиля Steam. Игры в «Хочу купить» сохранены.', steam_connection_changed: 'Steam-аккаунт изменился. Подключите нужный аккаунт и обновите синхронизацию.', steam_not_connected: 'Steam не подключён. Откройте профиль и подключите аккаунт.', steam_wishlist_unavailable: 'Steam временно не вернул желаемое. Попробуем снова позже. Игры в «Хочу купить» сохранены.' };

export function validateWishlistSync(value, offset = 0) {
  const invalid = () => { throw new Error('Сервер не подтвердил состояние синхронизации. Обновите его перед повтором.'); };
  if (!value || typeof value.enabled !== 'boolean' || typeof value.connected !== 'boolean' || typeof value.region_ready !== 'boolean'
      || !Number.isSafeInteger(value.version) || value.version < 0 || value.connected && !validToken(value.account_token)
      || !value.connected && value.account_token !== null || value.region !== null && (!/^[a-z]{2}$/.test(value.region?.country || '') || typeof value.region.version !== 'string' || !value.region.version.trim())
      || value.region_ready !== Boolean(value.region) || !value.rule || value.rule.enabled !== true || !['any', 'percent'].includes(value.rule.mode)
      || !Number.isSafeInteger(value.rule.percent) || value.rule.percent < 1 || value.rule.percent > 100
      || !Number.isSafeInteger(value.interval_seconds) || value.interval_seconds < 60
      || typeof value.state !== 'string' || typeof value.notice !== 'string' || value.error !== null && typeof value.error !== 'string'
      || !['new_only', 'all'].includes(value.initial_policy) || !Array.isArray(value.pending) || value.pending.length > 50
      || !Number.isSafeInteger(value.pending_total) || value.pending_total < 0 || value.pending_total > 20000
      || value.offset !== offset || offset + value.pending.length > value.pending_total
      || value.next_offset !== null && (!Number.isSafeInteger(value.next_offset) || value.next_offset !== offset + value.pending.length || value.next_offset >= value.pending_total || !value.pending.length)
      || value.next_offset === null && offset + value.pending.length !== value.pending_total
      || value.limit !== PRICE_LIST_LIMIT || !Number.isSafeInteger(value.slots_remaining) || value.slots_remaining < 0 || value.slots_remaining > value.limit) invalid();
  for (const key of ['check_available_at', 'last_checked_at', 'last_success_at', 'next_check_at']) if (!validDate(value[key])) invalid();
  const ids = new Set();
  for (const entry of value.pending) {
    if (!validId(entry?.app_id) || ids.has(entry.app_id) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 1000
        || !['game', 'dlc', 'unknown'].includes(entry.type) || !['pending', 'unavailable', 'unsupported'].includes(entry.status)
        || typeof entry.requires_selection !== 'boolean') invalid();
    ids.add(entry.app_id);
  }
  return value;
}

export function createWishlistSyncTools() {
  const state = { status: null, pending: [], selected: new Set(), selectedEntries: new Map(), known: new Set(), capacity: 0, loading: false, busy: false, error: '', message: '', enabled: false, mode: 'any', percent: '50', dirty: false, failures: new Map(), needsRefresh: false };
  let generation = 0; let readEpoch = 0; let controller;
  function cancel() { readEpoch++; controller?.abort(); controller = null; state.loading = false; }
  function invalidate(message = '') {
    cancel(); Object.assign(state, { status: null, pending: [], selected: new Set(), selectedEntries: new Map(), error: message, message: '', failures: new Map(), needsRefresh: false, dirty: false });
  }
  function reset() { generation++; invalidate(); Object.assign(state, { busy: false, known: new Set(), capacity: 0, enabled: false, mode: 'any', percent: '50' }); }
  function reconcile(snapshot) {
    if (state.status && !sameRegion(state.status.region, expectedPriceRegion(snapshot))) invalidate('Регион изменился. Обновите состояние синхронизации.');
    state.known = new Set((snapshot?.items || []).map(item => Number(item.app_id)));
    state.capacity = Math.max(0, (snapshot?.limit || snapshot?.settings?.max_games || PRICE_LIST_LIMIT) - state.known.size);
    if (state.status) state.capacity = Math.min(state.capacity, state.status.slots_remaining);
    for (const id of state.selected) if (state.known.has(id)) { state.selected.delete(id); state.selectedEntries.delete(id); state.failures.delete(id); }
  }
  function entries() {
    const values = state.pending.slice(); const ids = new Set(values.map(entry => entry.app_id));
    for (const [id, entry] of state.selectedEntries) if (state.selected.has(id) && !ids.has(id)) values.push(entry);
    return values;
  }
  function toggle(id, checked) {
    if (state.busy || state.loading || !state.status?.enabled) return false;
    const entry = entries().find(value => value.app_id === id);
    if (!entry || entry.status === 'unsupported' || state.known.has(id)) return false;
    if (!checked) { state.selected.delete(id); state.selectedEntries.delete(id); return true; }
    if (state.selected.size >= state.capacity) { state.error = `Свободных мест: ${state.capacity}. Снимите выбор с другой игры или освободите место в «Хочу купить».`; return false; }
    state.selected.add(id); state.selectedEntries.set(id, entry); state.error = ''; return true;
  }
  function rule() {
    if (state.mode === 'any') return { enabled: true, mode: 'any', percent: 50 };
    const text = String(state.percent).trim();
    if (state.mode !== 'percent' || !/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 100) throw new Error('Минимальная скидка должна быть от 1 до 100%.');
    return { enabled: true, mode: 'percent', percent: Number(text) };
  }
  function accept(value, { more = false, snapshot, preserveDraft = true } = {}) {
    const before = state.status; const bindingChanged = before && !sameBinding(before, value);
    if (!sameRegion(value.region, expectedPriceRegion(snapshot))) throw new Error('Регион изменился. Обновите список цен и синхронизацию.');
    if (before && !bindingChanged && value.version < before.version) throw new Error('Состояние синхронизации устарело. Обновите его перед повтором.');
    if (bindingChanged) { state.selected.clear(); state.selectedEntries.clear(); state.failures.clear(); state.dirty = false; }
    if (more && (before.version !== value.version || !sameBinding(before, value) || before.pending_total !== value.pending_total)) throw new Error('Список изменился во время загрузки. Обновите состояние синхронизации.');
    const pending = more ? [...state.pending, ...value.pending] : value.pending.slice();
    if (new Set(pending.map(entry => entry.app_id)).size !== pending.length) throw new Error('Сервер вернул повторяющиеся игры. Обновите состояние синхронизации.');
    state.status = value; state.pending = pending; state.needsRefresh = false;
    if (!state.dirty || !preserveDraft) { state.enabled = value.enabled; state.mode = value.rule.mode; state.percent = String(value.rule.percent); state.dirty = false; }
    if (!value.enabled) { state.selected.clear(); state.selectedEntries.clear(); state.failures.clear(); }
    else if (!more && value.next_offset === null) {
      const ids = new Set(value.pending.map(entry => entry.app_id));
      for (const id of state.selected) if (!ids.has(id)) { state.selected.delete(id); state.selectedEntries.delete(id); state.failures.delete(id); }
    }
    reconcile(snapshot);
  }
  async function load(fetcher, current, changed = () => {}, { more = false, snapshot } = {}) {
    if (state.busy || state.loading) return false;
    reconcile(snapshot);
    if (more && (state.status?.next_offset == null || state.needsRefresh)) { changed(); return false; }
    cancel(); const owner = generation; const read = readEpoch; const offset = more ? state.status.next_offset : 0;
    controller = new AbortController(); const signal = controller.signal;
    const valid = () => owner === generation && read === readEpoch && !signal.aborted && current();
    state.loading = true; state.error = ''; state.message = ''; changed();
    try {
      const value = await fetcher(offset, signal); if (!valid()) return false;
      accept(validateWishlistSync(value, offset), { more, snapshot }); return true;
    } catch (error) { if (valid()) { state.error = error.message || 'Не удалось получить состояние синхронизации.'; state.needsRefresh = true; } return false; }
    finally { if (owner === generation && read === readEpoch) { state.loading = false; controller = null; if (current()) changed(); } }
  }
  function assertion(snapshot, { binding = true } = {}) {
    if (!state.status || state.needsRefresh) throw new Error('Сначала обновите состояние синхронизации.');
    const result = { version: state.status.version };
    if (binding) {
      const region = expectedPriceRegion(snapshot);
      if (!state.status.connected || !validToken(state.status.account_token)) throw new Error('Сначала подключите Steam в профиле.');
      if (!region || !sameRegion(region, state.status.region)) throw new Error('Сначала выберите регион и обновите список цен.');
      Object.assign(result, { account_token: state.status.account_token, expected_region: region });
    }
    return result;
  }
  async function mutate(send, current, changed = () => {}, { snapshot, kind, appIds } = {}) {
    if (state.busy || state.loading) return false;
    let payload;
    try {
      const enabled = state.enabled;
      if (kind === 'save') payload = enabled ? { enabled, ...assertion(snapshot), rule: rule() } : { enabled, ...assertion(snapshot, { binding: false }) };
      else if (kind === 'check') { if (!state.status?.enabled) throw new Error('Сначала включите синхронизацию.'); payload = assertion(snapshot, { binding: false }); }
      else {
        if (!state.status?.enabled) throw new Error('Сначала включите синхронизацию.');
        const ids = appIds || [...state.selected]; if (!ids.length) return false;
        if (!Array.isArray(ids) || ids.some(id => !validId(id) || !entries().some(entry => entry.app_id === id)) || new Set(ids).size !== ids.length) throw new Error('Выберите игры из текущего списка ожидания.');
        if (ids.length > 50) throw new Error('За один раз можно убрать из ожидания до 50 игр.');
        payload = { app_ids: ids, ...assertion(snapshot) };
      }
    } catch (error) { state.error = error.message; changed(); return false; }
    cancel(); const owner = generation; const write = readEpoch;
    const valid = () => owner === generation && write === readEpoch && current();
    state.busy = true; state.error = ''; state.message = kind === 'check' ? 'Ставим проверку в очередь…' : 'Сохраняем…'; changed();
    let saved = false;
    try {
      const value = await send(payload); if (!valid()) return false;
      const next = validateWishlistSync(value);
      if (next.version < payload.version || kind !== 'save' || payload.enabled) {
        if (next.version < payload.version || !sameBinding(state.status, next)) throw new Error('Steam-аккаунт или регион изменился. Обновите состояние синхронизации.');
      }
      accept(next, { snapshot, preserveDraft: kind !== 'save' });
      if (kind === 'dismiss') { for (const id of payload.app_ids) { state.selected.delete(id); state.selectedEntries.delete(id); state.failures.delete(id); } }
      state.message = kind === 'check' ? 'Проверка поставлена в очередь. Результат появится после обращения к Steam.' : kind === 'dismiss' ? 'Выбранные игры больше не ждут добавления. Игры из «Хочу купить» сохранены.' : next.enabled ? 'Синхронизация включена. Условия уже добавленных игр сохранены.' : 'Синхронизация выключена. Игры и их настройки сохранены.';
      saved = true;
    } catch (error) { if (valid()) { state.error = `${error.message || 'Не удалось подтвердить сохранение.'} Обновите состояние и проверьте результат перед повтором.`; state.message = ''; state.needsRefresh = true; if (staleCodes.has(error.code)) invalidate(state.error); } }
    finally { if (owner === generation) { state.busy = false; if (current()) changed(); } }
    return saved;
  }
  async function add(send, current, acceptWishlist, changed = () => {}, { snapshot } = {}) {
    if (state.busy || state.loading) return { added: 0 };
    reconcile(snapshot); let assertionValue;
    try {
      if (!state.status?.enabled) throw new Error('Сначала включите синхронизацию.');
      assertionValue = assertion(snapshot);
      if (state.selected.size > state.capacity) throw new Error(`Выбрано ${state.selected.size}, свободных мест ${state.capacity}. Снимите лишний выбор или освободите место в «Хочу купить».`);
    } catch (error) { state.error = error.message; changed(); return { added: 0 }; }
    const ids = [...state.selected]; if (!ids.length) return { added: 0 };
    cancel(); const owner = generation; const write = readEpoch;
    const valid = () => owner === generation && write === readEpoch && sameRegion(state.status?.region, assertionValue.expected_region) && state.status?.account_token === assertionValue.account_token && current();
    state.busy = true; state.error = ''; state.message = `Добавляем выбранные игры: 0 из ${ids.length}…`; changed();
    let added = 0; let completed = 0; let latestSnapshot = snapshot;
    try {
      for (let start = 0; start < ids.length && valid(); start += 5) {
        const batch = ids.slice(start, start + 5);
        const payload = { app_ids: batch, ...assertionValue, version: state.status.version };
        const result = await send(payload); if (!valid()) break;
        const next = validateWishlistSync(result?.sync);
        if (next.version < payload.version || !sameBinding(state.status, next) || !sameRegion(expectedPriceRegion(result?.wishlist), assertionValue.expected_region)
            || !Array.isArray(result?.wishlist?.items) || !Array.isArray(result.added) || !Array.isArray(result.already_watching) || !Array.isArray(result.failed) || !Array.isArray(result.skipped)) throw new Error('Сервер не подтвердил результат добавления. Обновите список цен и синхронизацию.');
        const confirmed = new Set();
        for (const id of [...result.added, ...result.already_watching]) {
          if (!validId(id) || !batch.includes(id) || confirmed.has(id) || !result.wishlist.items.some(entry => entry.app_id === id)) throw new Error('Сервер вернул неполное подтверждение добавления. Обновите список перед повтором.');
          confirmed.add(id);
        }
        for (const entry of [...result.failed, ...result.skipped]) {
          if (!validId(entry?.app_id) || !batch.includes(entry.app_id) || confirmed.has(entry.app_id) || typeof entry.message !== 'string') throw new Error('Сервер вернул неполное подтверждение добавления. Обновите список перед повтором.');
          confirmed.add(entry.app_id);
        }
        if (confirmed.size !== batch.length) throw new Error('Сервер подтвердил не все выбранные игры. Обновите список перед повтором.');
        acceptWishlist(result.wishlist); latestSnapshot = result.wishlist;
        for (const id of [...result.added, ...result.already_watching]) { state.selected.delete(id); state.selectedEntries.delete(id); state.failures.delete(id); }
        for (const entry of result.skipped) { state.selected.delete(entry.app_id); state.selectedEntries.delete(entry.app_id); state.failures.set(entry.app_id, entry.message); }
        for (const entry of result.failed) state.failures.set(entry.app_id, entry.message);
        accept(next, { snapshot: latestSnapshot }); added += result.added.length; completed += batch.length;
        state.message = `Обработано ${completed} из ${ids.length}. Добавлено: ${added}. Индивидуальные условия сохранены.`; changed();
      }
      if (valid() && state.selected.size) state.error = 'Часть игр не удалось добавить. Они остаются выбранными: повторите попытку или снимите выбор.';
    } catch (error) { if (valid()) { state.error = `${error.message || 'Не удалось завершить добавление.'} Подтверждённые игры сохранены. Если ответ потерялся, обновите список перед повтором: дубликаты не создаются, индивидуальные условия сохраняются.`; state.needsRefresh = true; if (staleCodes.has(error.code)) { const message = state.error; invalidate(message); } } }
    finally { if (owner === generation) { state.busy = false; if (current()) changed(); } }
    return { added, completed };
  }
  return { state, cancel, invalidate, reset, reconcile, entries, toggle, rule, load, mutate, add };
}

export function wishlistSyncPanel(tools, { disabled = false } = {}) {
  const state = tools.state; const status = state.status; const locked = disabled || state.busy || state.loading;
  const cooldown = status?.check_available_at && Date.parse(status.check_available_at) > Date.now();
  const canEnable = status?.connected && status?.region_ready;
  const pending = tools.entries();
  const serverNotice = syncErrors[status?.error] || status?.notice || (status?.error ? 'Последняя проверка Steam не удалась. Можно повторить её позже; ваши игры сохранены.' : '');
  const date = value => value ? h(formatDate(value, true)) : 'Ещё не было';
  return `<section class="wishlist-sync" aria-labelledby="wishlist-sync-heading" aria-busy="${state.loading || state.busy}"><div class="section-heading"><h3 id="wishlist-sync-heading">Синхронизация со Steam</h3>${status ? `<span class="wishlist-sync-state">${status.enabled ? 'Включена' : 'Выключена'}</span>` : ''}</div><p class="subtle">Новые игры из желаемого Steam автоматически добавляются в «Хочу купить», пока есть место. Условия каждой добавленной игры можно настроить отдельно. Удаление игры в Steam не удаляет её из нашего списка.</p><p class="transfer-message" role="status" aria-live="polite">${h(state.error || state.message || (state.loading ? 'Получаем состояние синхронизации…' : serverNotice))}</p>${!status ? `<button type="button" class="button quiet small" data-action="price-sync-refresh" ${locked ? 'disabled' : ''}>${state.loading ? 'Загружаем…' : 'Обновить состояние'}</button>` : `${!status.connected ? '<p class="source-warning">Для синхронизации подключите Steam через официальный вход в профиле.</p><a class="button secondary small" href="#profile">Подключить Steam</a>' : ''}${!status.region_ready ? '<p class="source-warning">Сначала выберите регион магазина выше.</p>' : ''}<form id="wishlist-sync-form"><fieldset ${locked ? 'disabled' : ''}><legend class="sr-only">Настройки синхронизации желаемого Steam</legend><label class="check-row"><input name="enabled" type="checkbox" ${state.enabled ? 'checked' : ''} ${!canEnable && !status.enabled ? 'disabled' : ''}><span>Автоматически добавлять новые игры из Steam</span></label><div class="wishlist-sync-rule" ${!state.enabled ? 'hidden' : ''}><label class="schedule-field">Условие для новых игр<select name="mode"><option value="any" ${state.mode === 'any' ? 'selected' : ''}>При любой скидке</option><option value="percent" ${state.mode === 'percent' ? 'selected' : ''}>При скидке от выбранного процента</option></select></label><label class="schedule-field wishlist-sync-percent" ${state.mode !== 'percent' ? 'hidden' : ''}>Минимальная скидка, %<input name="percent" type="number" min="1" max="100" step="1" inputmode="numeric" value="${h(state.percent)}" ${state.mode !== 'percent' ? 'disabled' : ''}></label><p class="subtle">Это начальное условие только для новых игр. Уже заданные индивидуальные условия не меняются. Уведомления о скидках учитывают ваше расписание.</p></div><p class="wishlist-sync-draft" role="status">${state.dirty ? 'Есть несохранённые изменения.' : ''}</p><button type="submit" class="button secondary small" ${locked || state.enabled && !canEnable || state.needsRefresh ? 'disabled' : ''}>Сохранить синхронизацию</button></fieldset></form><p class="subtle">${status.initial_policy === 'all' ? 'При первом включении проверяем всё желаемое Steam. Если оно не помещается в список, предложим выбрать игры.' : 'При первом включении запоминаем текущее желаемое и добавляем только будущие новые игры. Для существующих игр используйте «Импорт желаемого из Steam».'} Проверяем примерно раз в ${Math.max(1, Math.round(status.interval_seconds / 3600))} часов, когда домашний ПК и сервер работают.</p>${status.enabled ? `<dl class="wishlist-sync-times"><div><dt>Последняя попытка</dt><dd>${date(status.last_checked_at)}</dd></div><div><dt>Последняя успешная проверка</dt><dd>${date(status.last_success_at)}</dd></div><div><dt>Следующая проверка</dt><dd>${status.next_check_at ? date(status.next_check_at) : 'После запуска сервера'}</dd></div></dl>` : ''}<div class="wishlist-sync-actions"><button type="button" class="button quiet small" data-action="price-sync-refresh" ${locked ? 'disabled' : ''}>Обновить состояние</button>${status.enabled ? `<button type="button" class="button secondary small" data-action="price-sync-check" ${locked || cooldown || state.needsRefresh ? 'disabled' : ''}>Проверить Steam сейчас</button>` : ''}</div>${status.enabled && cooldown ? `<p class="price-checked">Повторная проверка доступна: ${date(status.check_available_at)}. Кнопка ставит запрос в очередь, не проверяет Steam мгновенно.</p>` : ''}${status.enabled && status.pending_total ? `<div class="wishlist-sync-pending"><h4>Игры ещё не добавлены (${status.pending_total})</h4><p class="subtle">Свободно мест: ${state.capacity} из ${status.limit}. Если новые игры не помещаются, выбираете их вы. Игры с пометкой «Нужен ваш выбор» сами не добавятся. Для остальных сервер повторит попытку после временной ошибки Steam.</p><div class="price-steam-games">${pending.map(entry => {
    const selected = state.selected.has(entry.app_id); const known = state.known.has(entry.app_id); const failed = state.failures.get(entry.app_id);
    return `<div class="wishlist-sync-game"><label class="price-steam-game"><input type="checkbox" data-wishlist-sync-game="${entry.app_id}" ${selected ? 'checked' : ''} ${locked || entry.status === 'unsupported' || known || !selected && state.selected.size >= state.capacity ? 'disabled' : ''}><span><strong>${h(entry.name)}</strong><small>${entry.type === 'dlc' ? 'Дополнение DLC' : entry.type === 'game' ? 'Игра Steam' : 'Тип уточним при добавлении'} · AppID ${entry.app_id}</small>${entry.requires_selection ? '<small>Нужен ваш выбор</small>' : ''}${failed ? `<small class="source-warning">${h(failed)}</small>` : entry.status === 'unsupported' ? '<small class="source-warning">Steam не подтвердил игру или DLC.</small>' : entry.status === 'unavailable' ? '<small class="source-warning">Карточка Steam временно недоступна. Можно повторить добавление позже.</small>' : known ? '<small class="price-steam-known">Уже в «Хочу купить» · настройки сохранены</small>' : ''}</span></label><div class="wishlist-sync-game-actions"><a class="text-link" href="https://store.steampowered.com/app/${entry.app_id}/" target="_blank" rel="noopener noreferrer">В Steam</a><button type="button" class="button quiet small" data-action="price-sync-dismiss-game" data-app-id="${entry.app_id}" aria-label="Не добавлять ${h(entry.name)}" ${locked || state.needsRefresh ? 'disabled' : ''}>Не добавлять</button></div></div>`;
  }).join('')}</div>${status.next_offset !== null ? `<button type="button" class="button quiet small" data-action="price-sync-more" ${locked ? 'disabled' : ''}>Показать ещё игры</button>` : ''}<p class="wishlist-sync-selection" role="status">Выбрано: ${state.selected.size}${state.selected.size > state.capacity ? '. Снимите лишний выбор: свободных мест меньше.' : ''}</p><div class="wishlist-sync-actions"><button type="button" class="button secondary small" data-action="price-sync-select" ${locked || !state.selected.size || state.selected.size > state.capacity || state.needsRefresh ? 'disabled' : ''}>Добавить выбранные (${state.selected.size})</button><button type="button" class="button quiet small" data-action="price-sync-dismiss" ${locked || !state.selected.size || state.needsRefresh ? 'disabled' : ''}>Не добавлять выбранные</button><button type="button" class="button quiet small" data-action="price-sync-clear" ${locked || !state.selected.size ? 'disabled' : ''}>Снять выбор</button></div><p class="page-footnote">«Не добавлять» убирает игру из ожидания синхронизации. Это не удаляет её из желаемого Steam или «Хочу купить».</p></div>` : ''}`}</section>`;
}
