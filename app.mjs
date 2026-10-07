import { api, ApiError } from './api.mjs?v=20261007-steam1';
import { parseRoute, mergeEvents, preferencesForMode, eventMatchesId, createFeedPager, escapeHTML as h } from './model.mjs?v=20261007-steam1';
import { shell, homePage, libraryPage, searchPage, searchResults, gamePage, settingsPage, inboxPage, feedPage, profilePage, steamPanel, steamSelectionRows, steamCallbackScreen, loadingState, errorState, connectionScreen } from './views.mjs?v=20261007-steam1';
import { createTelegramAdapter, loadTelegramSDK } from './telegram.mjs?v=20261007-steam1';
import { loadRuntimeConfig } from './config.mjs?v=20261007-steam1';
import { parseLibraryInput, serializeLibrary, importLibraryBatches, LIBRARY_FILE_LIMIT, LIBRARY_LIMIT } from './library-transfer.mjs?v=20261007-steam1';
import { consumeSteamCallback, safeSteamLoginURL, createSteamSelection, createSteamReadGuard } from './steam-import.mjs?v=20261007-steam1';

// Clear the external assertion before runtime discovery, Telegram SDK loading
// or authentication. The callback browser does not need a Telegram session.
const steamCallback = consumeSteamCallback(window);

const appRoot = document.querySelector('#app');
const toastElement = document.querySelector('#toast');
const telegram = createTelegramAdapter();
const state = { bootstrap: null, route: parseRoute(location.hash), search: { query: '', kind: 'game', result: null }, game: null, notifications: null, config: null, languages: {} };
let navigationEpoch = 0;
let searchEpoch = 0;
let searchTimer;
let searchController;
let toastTimer;
let gamePollTimer;
let overviewPollTimer;
let bootstrapUpdatedAt = 0;
const mutations = new Set();
const translationRequested = new Set();
const transfer = { open: false, input: '', entries: [], selected: new Set(), busy: false, message: '', exportText: '', readEpoch: 0 };
const steam = { open: false, status: null, loginURL: '', loaded: false, busy: '', message: '', error: '', pollCount: 0 };
const steamSelection = createSteamSelection(LIBRARY_LIMIT);
const steamReads = createSteamReadGuard();
let steamPollTimer;
let steamCallbackBusy = false;
const feed = createFeedPager((filters, signal) => api.libraryFeed(filters, signal), () => {
  if (state.route.page === 'feed') renderFeed();
});
let feedLibraryKey = '';

function renderFeed({ focus = false } = {}) {
  if (state.route.page !== 'feed') return;
  const activeId = document.activeElement?.closest('#feed-filters') ? document.activeElement.id : null;
  const scroll = window.scrollY;
  setMain(feedPage(feed.state, state.bootstrap.library), focus);
  if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
  window.scrollTo({ top: scroll, behavior: 'instant' });
}

function toast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.hidden = false;
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, 5500);
}

function main() { return document.querySelector('#main-content'); }
function setMain(html, focus = false) {
  const schedule = main().querySelector('.delivery-schedule[open]');
  const transferPanel = main().querySelector('#library-transfer:not([hidden])');
  const active = schedule?.contains(document.activeElement) || transferPanel?.contains(document.activeElement) ? document.activeElement : null;
  main().innerHTML = html;
  if (schedule) main().querySelector('.delivery-schedule')?.replaceWith(schedule);
  if (transferPanel && main().querySelector('#library-transfer')) main().querySelector('#library-transfer').replaceWith(transferPanel);
  drawTransfer();
  drawSteam();
  if (active?.isConnected) active.focus({ preventScroll: true });
  if (focus) main().focus({ preventScroll: true });
}

function drawSteam({ rowsOnly = false } = {}) {
  const panel = document.querySelector('#steam-panel');
  if (!panel || !state.bootstrap) return;
  panel.hidden = state.route.page !== 'profile' && !steam.open;
  if (panel.hidden) return;
  steamSelection.reconcile(state.bootstrap.library);
  const input = panel.querySelector('#steam-game-search');
  const focused = document.activeElement === input;
  const selectionStart = focused ? input.selectionStart : null;
  const selectionEnd = focused ? input.selectionEnd : null;
  const data = { ...steam, profile: state.route.page === 'profile' };
  if (rowsOnly && panel.querySelector('#steam-game-results')) panel.querySelector('#steam-game-results').innerHTML = steamSelectionRows(data, steamSelection.state, steamSelection.filtered());
  else panel.innerHTML = steamPanel(data, steamSelection.state, steamSelection.filtered());
  if (focused && !rowsOnly) {
    const next = panel.querySelector('#steam-game-search');
    next?.focus({ preventScroll: true });
    try { next?.setSelectionRange(selectionStart, selectionEnd); } catch { /* search fields on some clients do not support ranges */ }
  }
}

function cancelSteamReads() {
  clearTimeout(steamPollTimer);
  steamReads.cancel();
  if (steam.busy === 'Проверяем подключение…' || steam.busy === 'Загружаем игры из Steam…') steam.busy = '';
}

function scheduleSteamPoll() {
  clearTimeout(steamPollTimer);
  if (!steam.status?.pending || steam.busy || document.hidden || !['library', 'profile'].includes(state.route.page)
    || state.route.page === 'library' && !steam.open || steam.pollCount >= 12
    || Date.parse(steam.status.pending.expires_at) <= Date.now()) return;
  steamPollTimer = setTimeout(() => { steam.pollCount++; refreshSteam({ preview: true }); }, 5000);
}

async function refreshSteam({ preview = true, autoOpen = false, forceLibrary = false } = {}) {
  if (!state.bootstrap || steam.busy) return;
  const read = steamReads.begin();
  steam.busy = 'Проверяем подключение…'; steam.error = ''; drawSteam();
  try {
    const status = await api.steamStatus(read.signal);
    if (!read.current()) return;
    const changed = steam.status?.account?.steam_id !== status.account?.steam_id;
    steam.status = status;
    if (changed || !status.connected) { steamSelection.clear(); steam.loaded = false; }
    if (status.connected || !status.pending) steam.loginURL = '';
    if (autoOpen && status.pending) steam.open = true;
    if (preview && status.connected && (forceLibrary || !steam.loaded)) {
      steam.busy = 'Загружаем игры из Steam…'; drawSteam();
      const result = await api.steamLibrary(read.signal);
      if (!read.current()) return;
      steamSelection.setGames(result.games, state.bootstrap.library);
      steam.loaded = true;
      steam.message = result.games.length ? 'Список получен. Выберите игры — добавляем только после вашего нажатия.' : 'В этом Steam-аккаунте нет игр, доступных для импорта. Можно добавить интересующую игру обычным поиском.';
    }
  } catch (error) { if (read.current()) steam.error = error.message; }
  finally { if (read.current()) { steam.busy = ''; drawSteam(); scheduleSteamPoll(); } }
}

async function connectSteam() {
  if (steam.busy) return;
  cancelSteamReads(); steam.busy = 'Готовим вход в Steam…'; steam.error = ''; steam.message = ''; drawSteam();
  try {
    const result = await api.linkSteam();
    const url = safeSteamLoginURL(result.url);
    if (!url) throw new Error('Сервер вернул неправильную ссылку входа. Повторите попытку.');
    steam.loginURL = url;
    steam.status = { ...(steam.status || {}), pending: { expires_at: result.expires_at } };
    steam.pollCount = 0;
    steam.message = 'Ссылка готова. Нажмите «Продолжить в Steam», подтвердите вход и вернитесь сюда.';
  } catch (error) { steam.error = error.message; }
  finally { steam.busy = ''; drawSteam(); scheduleSteamPoll(); }
}

async function unlinkSteam() {
  if (steam.busy) return;
  cancelSteamReads(); steam.busy = 'Отвязываем Steam…'; steam.error = ''; drawSteam();
  try {
    const result = await api.unlinkSteam();
    steam.status = result; steam.loginURL = ''; steamSelection.clear(); steam.loaded = false;
    steam.message = 'Steam отвязан. Ваши игры и настройки в радаре сохранены.';
  } catch (error) { steam.error = error.message; }
  finally { steam.busy = ''; drawSteam(); }
}

async function importSteamGames() {
  if (steam.busy || transfer.busy) return;
  // Capacity may have changed since Steam was fetched or in another screen.
  steamSelection.reconcile(state.bootstrap.library);
  const games = steamSelection.selectedGames();
  if (!games.length) { drawSteam(); return; }
  cancelSteamReads(); steam.busy = 'Добавляем выбранные игры…'; steam.error = ''; drawSteam();
  const result = await importLibraryBatches(games, payload => api.importLibrary(payload), progress => {
    const confirmed = new Set(progress.batch.map(game => game.app_id));
    for (const id of confirmed) { steamSelection.state.selected.delete(id); steamSelection.state.existing.add(id); }
    steam.message = `Обработано ${progress.completed} из ${games.length}. Добавлено: ${progress.added}. Уже отслеживаются: ${progress.alreadyTracking}.`;
    drawSteam();
  });
  steam.message = `Добавлено: ${result.added}. Уже отслеживаются: ${result.alreadyTracking}.`;
  if (result.error) {
    const failedNames = result.remaining.slice(0, 5).map(game => `${game.name} (AppID ${game.app_id})`).join(', ');
    steam.error = `${result.error.message} Не подтверждена часть: ${failedNames}. Подтверждённые игры сохранены. Остальные остаются выбраны: можно снять выбор с проблемной игры и повторить. При потере ответа часть игр могла добавиться; повтор не создаёт дубликаты и сохраняет настройки.`;
  } else steam.message += ' Готово.';
  try { await syncBootstrap(); } catch { steam.error += ' Не удалось обновить библиотеку на экране. Проверьте её перед повтором.'; }
  steam.busy = ''; renderAfterLibraryChange(); drawSteam();
  if (!result.error) toast(`Добавлено из Steam: ${result.added}.`);
}

async function verifySteamCallback() {
  if (!steamCallback || steamCallbackBusy) return;
  steamCallbackBusy = true;
  appRoot.innerHTML = steamCallbackScreen({}, state.config || { botURL: 'https://t.me/my_steam_radar_dm_bot' });
  try {
    if (steamCallback.error) throw new Error(steamCallback.error);
    state.config = await loadRuntimeConfig();
    api.configure(state.config, () => '', () => loadRuntimeConfig());
    await api.steamCallback({ query: steamCallback.query });
    // Retain no assertion after success. Even on a lost response the original
    // app can check the persisted connection without replaying the assertion.
    steamCallback.query = '';
    appRoot.innerHTML = steamCallbackScreen({ done: true }, state.config);
  } catch (error) {
    const transport = ['offline', 'timeout', 'not_configured'].includes(error.code) || !state.config;
    appRoot.innerHTML = steamCallbackScreen({ error: error.message + ' Вернитесь в приложение и нажмите «Проверить подключение»: при потере ответа вход мог уже завершиться.', retry: transport && Boolean(steamCallback.query) }, state.config || { botURL: 'https://t.me/my_steam_radar_dm_bot' });
  } finally { steamCallbackBusy = false; }
}

function selectedTransferGames() { return transfer.entries.filter(game => transfer.selected.has(game.app_id)); }

function drawTransfer() {
  const panel = document.querySelector('#library-transfer');
  if (!panel) return;
  panel.hidden = !transfer.open;
  const input = panel.querySelector('#library-transfer-input');
  if (input.value !== transfer.input) input.value = transfer.input;
  panel.querySelector('#library-transfer-message').textContent = transfer.message;
  panel.querySelector('#library-export-copy').hidden = !transfer.exportText;
  panel.querySelector('#library-export-text').value = transfer.exportText;
  const knownIds = new Set(state.bootstrap?.library.map(game => Number(game.app_id)) || []);
  panel.querySelector('#library-transfer-preview').innerHTML = transfer.entries.length ? `<div class="transfer-preview"><div class="section-heading"><h3>Проверьте выбор</h3><button class="button small quiet" type="button" data-action="library-transfer-select">${selectedTransferGames().length === transfer.entries.length ? 'Снять выбор' : 'Выбрать все'}</button></div><div class="transfer-game-list">${transfer.entries.map(game => `<label class="transfer-game"><input type="checkbox" data-transfer-id="${game.app_id}" ${transfer.selected.has(game.app_id) ? 'checked' : ''}><span><strong>${h(game.name || `Игра Steam #${game.app_id}`)}</strong><small>AppID ${game.app_id}${knownIds.has(game.app_id) ? ' · Уже в библиотеке, настройки сохранятся' : ' · Проверим игру перед добавлением'}</small></span></label>`).join('')}</div><p class="subtle">Настройки уже добавленных игр сохраняются. Новые игры из файла получат сохранённые настройки, из ссылок — режим «Все обновления». Доставка сообщений и расписание профиля не меняются.</p><button class="button primary" type="button" data-action="library-transfer-import"></button></div>` : '';
  panel.querySelectorAll('input,textarea,button').forEach(control => { control.disabled = transfer.busy; });
  // A backup stays readable and selectable while another request is pending.
  panel.querySelector('#library-export-text').disabled = false;
  updateTransferSelection();
}

function updateTransferSelection() {
  const button = document.querySelector('[data-action="library-transfer-import"]');
  if (!button) return;
  const count = selectedTransferGames().length;
  button.disabled = transfer.busy || !count;
  button.textContent = transfer.busy ? 'Добавляем игры…' : `Добавить выбранные (${count})`;
  const select = document.querySelector('[data-action="library-transfer-select"]');
  if (select) select.textContent = count === transfer.entries.length ? 'Снять выбор' : 'Выбрать все';
}

function previewTransfer() {
  if (transfer.busy) return;
  try {
    transfer.entries = parseLibraryInput(transfer.input);
    transfer.selected = new Set(transfer.entries.map(game => game.app_id));
    transfer.message = `Распознано игр: ${transfer.entries.length}. Названия из файла будут проверены по Steam.`;
  } catch (error) {
    transfer.entries = []; transfer.selected.clear(); transfer.message = error.message;
  }
  drawTransfer();
}

async function importTransfer() {
  if (transfer.busy || steam.busy) return;
  const games = selectedTransferGames();
  if (!games.length) return;
  const existing = new Set(state.bootstrap.library.map(game => Number(game.app_id)));
  if (existing.size + games.filter(game => !existing.has(game.app_id)).length > LIBRARY_LIMIT) {
    transfer.message = `В библиотеке может быть до ${LIBRARY_LIMIT} игр. Уменьшите выбор или уберите ненужные игры.`; drawTransfer(); return;
  }
  transfer.busy = true; transfer.message = `Проверяем и добавляем ${games.length} игр…`; drawTransfer();
  const result = await importLibraryBatches(games, payload => api.importLibrary(payload), progress => {
    const confirmed = new Set(progress.batch.map(game => game.app_id));
    transfer.entries = transfer.entries.filter(game => !confirmed.has(game.app_id));
    for (const appId of confirmed) transfer.selected.delete(appId);
    transfer.message = `Обработано ${progress.completed} из ${games.length}. Добавлено: ${progress.added}. Уже отслеживаются: ${progress.alreadyTracking}.`;
    drawTransfer();
  });
  transfer.message = `Добавлено: ${result.added}. Уже отслеживаются: ${result.alreadyTracking}.`;
  if (result.error) transfer.message += ` ${result.error.message} Остались выбраны непроверенные игры. Если ответ потерялся, часть могла добавиться: проверьте библиотеку и повторите выбор. Повтор сохраняет существующие настройки.`;
  else transfer.message += ' Библиотека готова.';
  try { await syncBootstrap(); }
  catch { transfer.message += ' Не удалось обновить список на экране. Откройте библиотеку позже.'; }
  transfer.busy = false;
  if (state.route.page === 'library') renderAfterLibraryChange();
  drawTransfer();
  if (!result.error) toast(`В библиотеку добавлено игр: ${result.added}.`);
}

async function exportTransfer() {
  if (transfer.busy) return;
  transfer.busy = true; transfer.message = 'Сохраняем библиотеку…'; drawTransfer();
  try {
    transfer.exportText = serializeLibrary(await api.exportLibrary());
    transfer.open = true;
    const blob = new Blob([transfer.exportText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url; link.download = 'steam-radar-library.json'; document.body.append(link); link.click(); link.remove();
      transfer.message = 'Файл подготовлен. Если скачивание не появилось, скопируйте JSON ниже.';
    } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  } catch (error) { transfer.message = error.message; transfer.open = true; }
  finally { transfer.busy = false; drawTransfer(); }
}

async function copyTransfer() {
  if (!transfer.exportText) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
    await navigator.clipboard.writeText(transfer.exportText);
    transfer.message = 'JSON скопирован. Сохраните его в файл или личные заметки.';
  } catch {
    const input = document.querySelector('#library-export-text');
    input?.focus(); input?.select();
    transfer.message = 'Автоматическое копирование недоступно. Текст выделен — скопируйте его вручную.';
  }
  document.querySelector('#library-transfer-message')?.replaceChildren(document.createTextNode(transfer.message));
}
function updateUnread(count) {
  if (state.bootstrap) state.bootstrap.unread_count = count;
  document.querySelectorAll('[data-unread]').forEach(badge => { badge.textContent = String(count || ''); badge.hidden = !count; });
}
function updateNavigation() {
  const active = ['game', 'settings', 'feed'].includes(state.route.page) ? 'library' : state.route.page;
  document.querySelectorAll('.nav-item').forEach(link => {
    const current = link.hash === '#' + active;
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  telegram.updateBack(['game', 'settings', 'feed', 'profile'].includes(state.route.page) ? () => { location.hash = state.route.page === 'settings' ? `#game/${state.route.appId}` : '#library'; } : null);
}

async function syncBootstrap() {
  state.bootstrap = await api.bootstrap();
  steamSelection.reconcile(state.bootstrap.library);
  bootstrapUpdatedAt = Date.now();
  updateUnread(state.bootstrap.unread_count);
  return state.bootstrap;
}

function updateGameSummary(game) {
  for (const key of ['library', 'featured']) {
    state.bootstrap[key] = state.bootstrap[key].map(previous => Number(previous.app_id) === Number(game.app_id) ? { ...previous, ...game } : previous);
  }
}

function renderGame({ focus = false, loadingMore = false } = {}) {
  if (!state.game || state.game.game.app_id !== state.route.appId) return;
  setMain(gamePage(state.game, state.bootstrap.library, state.route.eventId, loadingMore, state.languages), focus);
  if (focus && state.route.eventId) {
    const selected = state.game.events.find(item => eventMatchesId(item, state.route.eventId));
    const id = String(selected?.id || state.route.eventId).replace(/[^a-zA-Z0-9_-]/g, '_');
    document.getElementById('event-' + id)?.scrollIntoView({ block: 'start' });
  }
  queueSelectedTranslation();
}

function queueSelectedTranslation() {
  const event = state.game?.events.find(item => eventMatchesId(item, state.route.eventId));
  if (!event || translationRequested.has(String(event.id)) || event.kind === 'public_build_changed'
    || event.short_translation_status === 'ready' || String(event.original_language || '').toLowerCase().startsWith('ru') || !event.contents?.trim()) return;
  translationRequested.add(String(event.id));
  requestTranslation(event, true).catch(() => {});
}

async function requestTranslation(event, shortOnly = false) {
  const eventId = Number(event.id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return false;
  const epoch = navigationEpoch;
  const result = await (shortOnly ? api.translateShort(eventId) : api.translate(eventId));
  if (epoch !== navigationEpoch || state.route.page !== 'game') return result.queued;
  if (result.queued) {
    if (result.short_queued) event.short_translation_status = 'pending';
    if (result.full_queued || !shortOnly && result.full_queued === undefined) event.translation_status = 'pending';
    renderGame();
    scheduleGamePoll(epoch, 2500);
  } else {
    const index = state.game.events.findIndex(item => String(item.id) === String(event.id));
    const fresh = await api.game(state.route.appId, Math.floor(Math.max(0, index) / 30) * 30);
    if (epoch !== navigationEpoch || state.route.page !== 'game') return false;
    state.game.events = mergeEvents(state.game.events, fresh.events);
    updateGameSummary(fresh.game);
    renderGame();
  }
  return result.queued;
}

function scheduleGamePoll(epoch, delay = 4500) {
  clearTimeout(gamePollTimer);
  if (document.hidden || state.route.page !== 'game' || !state.game || (state.game.game.poll_status !== 'awaiting' && !state.game.events.some(event => event.translation_status === 'pending' || event.short_translation_status === 'pending'))) return;
  gamePollTimer = setTimeout(async () => {
    if (epoch !== navigationEpoch || document.hidden || state.route.page !== 'game') return;
    const appId = state.route.appId;
    try {
      const index = state.game.events.findIndex(item => eventMatchesId(item, state.route.eventId));
      const selectedOffset = Math.floor(Math.max(0, index) / 30) * 30;
      const [fresh, selectedPage] = await Promise.all([api.game(appId), selectedOffset ? api.game(appId, selectedOffset) : Promise.resolve(null)]);
      if (epoch !== navigationEpoch) return;
      updateGameSummary(fresh.game);
      const merged = mergeEvents(state.game.events, [...fresh.events, ...(selectedPage?.events || [])]).sort((a, b) => (Date.parse(b.sort_at || b.published_at || b.detected_at) || 0) - (Date.parse(a.sort_at || a.published_at || a.detected_at) || 0));
      state.game = { ...fresh, events: merged, pagination: state.game.events.length > 30 ? state.game.pagination : fresh.pagination };
      const scroll = window.scrollY;
      renderGame();
      window.scrollTo({ top: scroll, behavior: 'instant' });
      if (fresh.game.poll_status === 'awaiting' || merged.some(event => event.translation_status === 'pending' || event.short_translation_status === 'pending')) scheduleGamePoll(epoch, Math.min(delay * 1.5, 20000));
    } catch { if (epoch === navigationEpoch) scheduleGamePoll(epoch, 20000); }
  }, delay);
}

function scheduleOverviewPoll(epoch, delay = 5000) {
  clearTimeout(overviewPollTimer);
  if (!state.bootstrap || !['home', 'library', 'inbox'].includes(state.route.page) || document.hidden) return;
  const games = [...state.bootstrap.library, ...state.bootstrap.featured];
  const pending = games.some(game => game.poll_status === 'awaiting' || game.latest_event?.translation_status === 'pending' || game.latest_event?.short_translation_status === 'pending')
    || state.route.page === 'inbox' && state.notifications?.items?.some(item => item.event.translation_status === 'pending' || item.event.short_translation_status === 'pending')
    || Number(state.bootstrap.delivery_status?.pending_count) > 0;
  if (!pending) return;
  overviewPollTimer = setTimeout(async () => {
    if (epoch !== navigationEpoch || document.hidden) return;
    if (document.querySelector('.delivery-schedule[open], #library-transfer:not([hidden]), #steam-panel:not([hidden])')) { scheduleOverviewPoll(epoch, 10000); return; }
    try {
      await syncBootstrap();
      if (epoch !== navigationEpoch) return;
      if (document.querySelector('.delivery-schedule[open], #library-transfer:not([hidden]), #steam-panel:not([hidden])')) { scheduleOverviewPoll(epoch, 10000); return; }
      const scroll = window.scrollY;
      if (state.route.page === 'home') setMain(homePage(state.bootstrap, state.config));
      else if (state.route.page === 'library') setMain(libraryPage(state.bootstrap.library, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
      else if (state.route.page === 'inbox') {
        const result = await api.notifications();
        if (epoch !== navigationEpoch) return;
        state.notifications = result;
        updateUnread(result.unread_count);
        setMain(inboxPage(result, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
      }
      window.scrollTo({ top: scroll, behavior: 'instant' });
      scheduleOverviewPoll(epoch, Math.min(delay * 1.5, 20000));
    } catch { if (epoch === navigationEpoch) scheduleOverviewPoll(epoch, 20000); }
  }, delay);
}

async function loadRoute({ focus = true, force = false } = {}) {
  clearTimeout(gamePollTimer);
  clearTimeout(overviewPollTimer);
  clearTimeout(searchTimer);
  searchController?.abort();
  feed.cancel();
  cancelSteamReads();
  const previous = state.route;
  state.route = parseRoute(location.hash);
  const route = state.route;
  const epoch = ++navigationEpoch;
  updateNavigation();
  document.title = ({ home: 'Главная', search: 'Поиск игр', library: 'Библиотека', inbox: 'Уведомления', game: 'Игра', settings: 'Настройки', feed: 'Мои обновления', profile: 'Мой профиль' }[route.page] || 'Главная') + ' — Игровой радар';
  if (previous.page !== route.page || previous.appId !== route.appId) window.scrollTo({ top: 0, behavior: 'instant' });
  if (route.page === 'home') {
    setMain(homePage(state.bootstrap, state.config), focus);
    if (force || Date.now() - bootstrapUpdatedAt > 5000) {
      try { await syncBootstrap(); if (epoch === navigationEpoch) setMain(homePage(state.bootstrap, state.config)); }
      catch (error) { if (epoch === navigationEpoch) toast(error.message); }
    }
    scheduleOverviewPoll(epoch);
    refreshSteam({ preview: false });
    return;
  }
  if (route.page === 'profile') {
    setMain(profilePage(state.bootstrap.profile), focus);
    await refreshSteam({ preview: false });
    return;
  }
  if (route.page === 'search') {
    setMain(searchPage(state.search.query, state.search.kind), focus);
    if (state.search.result && !force) document.querySelector('#search-results').innerHTML = searchResults(state.search.result, state.bootstrap.library);
    else if (state.search.query.trim()) await runSearch();
    return;
  }
  if (route.page === 'library') {
    setMain(libraryPage(state.bootstrap.library, state.bootstrap.profile, state.config, state.bootstrap.delivery_status), focus);
    if (force || Date.now() - bootstrapUpdatedAt > 5000) {
      try { await syncBootstrap(); if (epoch === navigationEpoch) setMain(libraryPage(state.bootstrap.library, state.bootstrap.profile, state.config, state.bootstrap.delivery_status)); }
      catch (error) { if (epoch === navigationEpoch) setMain(errorState(error.message)); }
    }
    scheduleOverviewPoll(epoch);
    if (epoch === navigationEpoch) refreshSteam({ preview: steam.open, autoOpen: true });
    return;
  }
  if (route.page === 'feed') {
    const libraryKey = state.bootstrap.library.map(game => Number(game.app_id)).sort((a, b) => a - b).join(',');
    const filters = { ...feed.state.filters };
    if (filters.app_id && !state.bootstrap.library.some(game => Number(game.app_id) === filters.app_id)) delete filters.app_id;
    feed.setFilters(filters, { force: feedLibraryKey !== libraryKey });
    feedLibraryKey = libraryKey;
    renderFeed({ focus });
    if (state.bootstrap.library.length && (force || !feed.state.loaded)) await feed.load();
    return;
  }
  if (route.page === 'game' && state.game?.game.app_id === route.appId && !force) {
    renderGame({ focus });
    scheduleGamePoll(epoch);
    return;
  }
  setMain(loadingState(route.page === 'inbox' ? 'Загружаем уведомления…' : 'Загружаем игру…'), focus);
  try {
    if (route.page === 'inbox') {
      const result = await api.notifications();
      if (epoch !== navigationEpoch) return;
      state.notifications = result;
      updateUnread(result.unread_count);
      setMain(inboxPage(result, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
      scheduleOverviewPoll(epoch);
    } else {
      const result = await api.game(route.appId);
      if (epoch !== navigationEpoch) return;
      state.game = result;
      updateGameSummary(result.game);
      document.title = result.game.name + (route.page === 'settings' ? ' — Настройки' : '') + ' — Игровой радар';
      if (route.page === 'settings') {
        if (!state.bootstrap.library.some(game => game.app_id === route.appId)) {
          toast('Сначала добавьте игру в библиотеку.');
          location.hash = '#game/' + route.appId;
          return;
        }
        setMain(settingsPage(result.game));
      } else { renderGame({ focus: false }); scheduleGamePoll(epoch); }
    }
  } catch (error) { if (epoch === navigationEpoch) setMain(errorState(error.message)); }
}

async function runSearch() {
  clearTimeout(searchTimer);
  searchController?.abort();
  const region = document.querySelector('#search-results');
  if (!region || state.route.page !== 'search') return;
  const query = state.search.query.trim();
  const kind = state.search.kind;
  const epoch = ++searchEpoch;
  state.search.result = null;
  if (!query) {
    const container = document.createElement('div');
    container.innerHTML = searchPage('', kind);
    region.innerHTML = container.querySelector('#search-results').innerHTML;
    return;
  }
  region.innerHTML = loadingState('Ищем в каталоге Steam…');
  searchController = new AbortController();
  try {
    const result = await api.search(query, kind, searchController.signal);
    if (epoch !== searchEpoch || state.route.page !== 'search' || query !== state.search.query.trim() || kind !== state.search.kind) return;
    state.search.result = result;
    region.innerHTML = searchResults(result, state.bootstrap.library);
  } catch (error) {
    if (error.name === 'AbortError' || epoch !== searchEpoch || state.route.page !== 'search') return;
    region.innerHTML = errorState(error.message, 'retry-search');
  }
}

function renderAfterLibraryChange() {
  if (state.route.page === 'search') {
    const region = document.querySelector('#search-results');
    if (region && state.search.result) region.innerHTML = searchResults(state.search.result, state.bootstrap.library);
  } else if (state.route.page === 'home') setMain(homePage(state.bootstrap, state.config));
  else if (state.route.page === 'library') setMain(libraryPage(state.bootstrap.library, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
  else if (state.route.page === 'game') renderGame();
}

async function mutateButton(button, key, task) {
  if (mutations.has(key)) return;
  mutations.add(key);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try { await task(); }
  catch (error) { toast(error.message); }
  finally { mutations.delete(key); if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); } }
}

document.addEventListener('click', async event => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); main()?.focus(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const appId = Number(button.dataset.appId);
  if (action === 'steam-callback-retry') { await verifySteamCallback(); return; }
  if (action.startsWith('steam-')) {
    if (!state.bootstrap || !['library', 'profile'].includes(state.route.page)) return;
    if (action === 'steam-open') { steam.open = true; steam.pollCount = 0; drawSteam(); await refreshSteam(); }
    else if (action === 'steam-close' && !steam.busy) { steam.open = false; cancelSteamReads(); drawSteam(); }
    else if (action === 'steam-connect') await connectSteam();
    else if (action === 'steam-continue' && !steam.busy && steam.loginURL) {
      if (!telegram.openSteamLogin(steam.loginURL)) toast('Браузер не открылся. Повторите нажатие или разрешите открытие ссылок.');
      else { steam.message = 'Подтвердите вход в Steam, затем вернитесь сюда и проверьте подключение.'; drawSteam(); scheduleSteamPoll(); }
    }
    else if (action === 'steam-check') { steam.pollCount = 0; await refreshSteam({ preview: true }); }
    else if (action === 'steam-library') await refreshSteam({ forceLibrary: true });
    else if (action === 'steam-unlink') await unlinkSteam();
    else if (action === 'steam-import') await importSteamGames();
    else if (action === 'steam-select' && !steam.busy) { steamSelection.selectFiltered(); drawSteam({ rowsOnly: true }); }
    else if (action === 'steam-clear' && !steam.busy) { steamSelection.state.selected.clear(); drawSteam({ rowsOnly: true }); }
    else if (action === 'steam-more' && !steam.busy) { steamSelection.state.shown += 60; drawSteam({ rowsOnly: true }); }
    return;
  }
  if (action.startsWith('feed-')) {
    if (state.route.page !== 'feed' || !state.bootstrap.library.length) return;
    if (action === 'feed-more') await feed.load({ more: true });
    else if (action === 'feed-retry') await feed.load({ more: feed.state.errorIsMore });
    else if (action === 'feed-refresh') await feed.load();
    else if (action === 'feed-all') { feed.setFilters({ kind: 'all', days: 0 }); await feed.load(); }
    return;
  }
  if (action === 'library-transfer-open') {
    transfer.open = true; drawTransfer(); document.querySelector('#library-transfer-input')?.focus();
  }
  else if (action === 'library-transfer-close' && !transfer.busy) { transfer.open = false; drawTransfer(); }
  else if (action === 'library-transfer-select' && !transfer.busy) {
    transfer.selected = selectedTransferGames().length === transfer.entries.length ? new Set() : new Set(transfer.entries.map(game => game.app_id)); drawTransfer();
  }
  else if (action === 'library-transfer-import') await importTransfer();
  else if (action === 'library-export') await exportTransfer();
  else if (action === 'library-copy') await copyTransfer();
  else if (action === 'retry') { if (!state.bootstrap) await start(); else await loadRoute({ force: true }); }
  else if (action === 'retry-search') await runSearch();
  else if (action === 'language') {
    state.languages[button.dataset.eventId] = button.dataset.language === 'original' ? 'original' : 'ru';
    const scroll = window.scrollY;
    renderGame();
    window.scrollTo({ top: scroll, behavior: 'instant' });
  }
  else if (action === 'translate') await mutateButton(button, 'translate-' + button.dataset.eventId, async () => {
    const publication = state.game?.events.find(item => String(item.id) === button.dataset.eventId);
    if (!publication) return;
    translationRequested.add(String(publication.id));
    const queued = await requestTranslation(publication);
    const ready = state.game?.events.find(item => String(item.id) === button.dataset.eventId)?.translation_status === 'ready';
    toast(queued ? 'Русский перевод готовится. Пока доступен оригинал.' : ready ? 'Русский перевод готов.' : 'Перевод сейчас недоступен или уже готовится. Можно читать оригинал.');
  });
  else if (action === 'delivery') await mutateButton(button, 'delivery', async () => {
    const enabled = button.dataset.enabled === 'true';
    await api.setTelegramDelivery(enabled);
    await syncBootstrap();
    if (state.route.page === 'home') setMain(homePage(state.bootstrap, state.config));
    if (state.route.page === 'library') setMain(libraryPage(state.bootstrap.library, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
    if (state.route.page === 'inbox') setMain(inboxPage(state.notifications, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
    toast(enabled ? 'Уведомления в Telegram включены.' : 'Уведомления в Telegram выключены.');
  });
  else if (action === 'delivery-test') await mutateButton(button, 'delivery-test', async () => {
    const result = await api.testTelegramDelivery();
    await syncBootstrap();
    if (state.route.page === 'home') setMain(homePage(state.bootstrap, state.config));
    if (state.route.page === 'library') setMain(libraryPage(state.bootstrap.library, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
    if (state.route.page === 'inbox') setMain(inboxPage(state.notifications, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
    toast(result.message || 'Проверка доставки запрошена. Посмотрите чат с ботом.');
  });
  else if (action === 'write-access') await mutateButton(button, 'delivery', async () => {
    const allowed = await telegram.requestWriteAccess();
    if (!allowed) { toast('Уведомления не включены. Можно открыть бота и нажать «Начать», затем снова открыть приложение.'); return; }
    // initData can stay unchanged after Telegram grants access. The server
    // confirms permission with Bot API for this authenticated profile.
    await api.setTelegramDelivery(true);
    await syncBootstrap();
    toast('Уведомления в Telegram включены.');
    if (state.route.page === 'home') setMain(homePage(state.bootstrap, state.config));
    if (state.route.page === 'library') setMain(libraryPage(state.bootstrap.library, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
    if (state.route.page === 'inbox') setMain(inboxPage(state.notifications, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
  });
  else if (action === 'add') await mutateButton(button, 'add-' + appId, async () => {
    const result = await api.add(appId);
    if (!state.bootstrap.library.some(game => game.app_id === appId)) state.bootstrap.library.push(result.game);
    if (state.game?.game.app_id === appId) state.game.game = result.game;
    renderAfterLibraryChange();
    toast(result.game.name + ' — добавлено в библиотеку.');
    if (state.route.page === 'game') scheduleGamePoll(navigationEpoch);
  });
  else if (action === 'refresh') await mutateButton(button, 'refresh-' + appId, async () => {
    const result = await api.refresh(appId);
    toast(result.message || (result.queued ? 'Игра отправлена на проверку. Данные появятся после получения ответа источников.' : 'Игра недавно проверялась. Попробуйте позже.'));
    if (result.queued && state.game?.game.app_id === appId && state.route.page === 'game') {
      state.game.game.poll_status = 'awaiting';
      renderGame();
      scheduleGamePoll(navigationEpoch, 2500);
    }
  });
  else if (action === 'remove') await mutateButton(button, 'remove-' + appId, async () => {
    await api.remove(appId);
    clearTimeout(gamePollTimer);
    state.bootstrap.library = state.bootstrap.library.filter(game => Number(game.app_id) !== appId);
    if (state.game?.game.app_id === appId) state.game.game.preferences = null;
    toast('Убрано из библиотеки. История сохранена.');
    location.hash = '#library';
  });
  else if (action === 'more') await mutateButton(button, 'more-' + state.route.appId, async () => {
    const epoch = navigationEpoch;
    const offset = state.game.pagination?.next_offset;
    const result = await api.game(state.route.appId, offset ?? state.game.events.length);
    if (epoch !== navigationEpoch) return;
    state.game = { ...result, events: mergeEvents(state.game.events, result.events) };
    const scroll = window.scrollY;
    renderGame();
    window.scrollTo({ top: scroll, behavior: 'instant' });
    if (state.route.eventId) {
      const selected = state.game.events.find(item => eventMatchesId(item, state.route.eventId));
      const id = String(selected?.id || state.route.eventId).replace(/[^a-zA-Z0-9_-]/g, '_');
      document.getElementById('event-' + id)?.scrollIntoView({ block: 'start' });
    }
  });
  else if (action === 'read') await mutateButton(button, 'read', async () => {
    await api.markRead();
    updateUnread(0);
    if (state.notifications) state.notifications = { ...state.notifications, unread_count: 0, items: state.notifications.items.map(item => ({ ...item, read: true })) };
    if (state.route.page === 'inbox') setMain(inboxPage(state.notifications, state.bootstrap.profile, state.config, state.bootstrap.delivery_status));
    toast('Уведомления отмечены прочитанными.');
  });
});

document.addEventListener('input', event => {
  if (event.target.id === 'steam-game-search' && !steam.busy) {
    steamSelection.state.query = event.target.value; steamSelection.state.shown = 60; drawSteam({ rowsOnly: true }); return;
  }
  if (event.target.id === 'library-transfer-input') {
    transfer.input = event.target.value; transfer.readEpoch++; transfer.entries = []; transfer.selected.clear();
    transfer.message = 'Нажмите «Показать список», чтобы проверить изменения.'; drawTransfer(); return;
  }
  if (event.target.id !== 'search-input') return;
  state.search.query = event.target.value;
  state.search.result = null;
  searchController?.abort();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 420);
});

function syncPreferenceNotes(form) {
  const mode = form.elements.mode.value;
  form.querySelector('#custom-types').hidden = mode !== 'custom';
  form.querySelector('#severity-note').hidden = !['major', 'medium', 'minor'].includes(mode);
  form.querySelector('#unknown-option').hidden = !['major', 'medium', 'minor'].includes(mode);
  const builds = mode === 'all' || (mode === 'custom' && form.elements.builds.checked);
  form.querySelector('#noise-warning').hidden = !builds;
  form.querySelector('#build-timing-note').hidden = !builds || form.elements.timing.value !== 'described';
}

document.addEventListener('change', async event => {
  if (event.target.dataset.steamId) {
    if (steam.busy) return;
    const accepted = steamSelection.toggle(Number(event.target.dataset.steamId), event.target.checked);
    if (!accepted) toast('Выбрано максимально возможное число новых игр. Снимите выбор с другой игры.');
    drawSteam({ rowsOnly: true }); return;
  }
  const feedForm = event.target.closest('#feed-filters');
  if (feedForm) {
    if (state.route.page !== 'feed') return;
    if (feed.setFilters({ kind: feedForm.elements.kind.value, days: feedForm.elements.days.value, app_id: feedForm.elements.app_id.value })) await feed.load();
    return;
  }
  if (event.target.id === 'library-transfer-file') {
    const file = event.target.files?.[0];
    if (!file || transfer.busy) return;
    const epoch = ++transfer.readEpoch;
    try {
      if (file.size > LIBRARY_FILE_LIMIT) throw new Error('Файл слишком большой. Максимум 256 КиБ.');
      const text = await file.text();
      if (epoch !== transfer.readEpoch) return;
      transfer.input = text; previewTransfer();
    } catch (error) { if (epoch === transfer.readEpoch) { transfer.message = error.message; transfer.entries = []; transfer.selected.clear(); drawTransfer(); } }
    finally { event.target.value = ''; }
    return;
  }
  if (event.target.dataset.transferId) {
    const appId = Number(event.target.dataset.transferId);
    if (event.target.checked) transfer.selected.add(appId); else transfer.selected.delete(appId);
    updateTransferSelection(); return;
  }
  const scheduleForm = event.target.closest('#delivery-schedule-form');
  if (scheduleForm) {
    scheduleForm.querySelector('.schedule-daily').hidden = scheduleForm.elements.mode.value !== 'digest';
    scheduleForm.elements.daily_time.disabled = scheduleForm.elements.mode.value !== 'digest';
    scheduleForm.querySelector('.schedule-quiet-times').hidden = !scheduleForm.elements.quiet_enabled.checked;
    for (const name of ['quiet_start', 'quiet_end']) scheduleForm.elements[name].disabled = !scheduleForm.elements.quiet_enabled.checked;
    scheduleForm.querySelector('#schedule-message').textContent = 'Есть несохранённые изменения.';
    return;
  }
  if (event.target.name === 'kind' && event.target.closest('#search-form')) {
    state.search.kind = event.target.value;
    state.search.result = null;
    runSearch();
  }
  const form = event.target.closest('#preferences-form');
  if (!form) return;
  form.querySelector('#preferences-message').textContent = 'Есть несохранённые изменения.';
  if (event.target.name === 'mode') {
    const prefs = preferencesForMode(event.target.value, readPreferences(form));
    for (const key of ['patches', 'builds', 'news', 'include_unknown']) form.elements[key].checked = prefs[key];
  }
  syncPreferenceNotes(form);
});

function readPreferences(form) {
  return { enabled: form.elements.enabled.checked, mode: form.elements.mode.value, patches: form.elements.patches.checked, builds: form.elements.builds.checked, news: form.elements.news.checked, include_unknown: form.elements.include_unknown.checked, timing: form.elements.timing.value };
}

document.addEventListener('submit', async event => {
  if (event.target.id === 'feed-filters') { event.preventDefault(); return; }
  if (event.target.id === 'library-transfer-form') { event.preventDefault(); transfer.input = event.target.querySelector('#library-transfer-input').value; previewTransfer(); return; }
  if (event.target.id === 'search-form') { event.preventDefault(); await runSearch(); }
  if (event.target.id === 'delivery-schedule-form') {
    event.preventDefault();
    const form = event.target;
    const message = form.querySelector('#schedule-message');
    const schedule = { mode: form.elements.mode.value, utc_offset_minutes: Number(form.elements.utc_offset_minutes.value), quiet_enabled: form.elements.quiet_enabled.checked,
      ...(form.elements.mode.value === 'digest' ? { daily_time: form.elements.daily_time.value } : {}),
      ...(form.elements.quiet_enabled.checked ? { quiet_start: form.elements.quiet_start.value, quiet_end: form.elements.quiet_end.value } : {}) };
    await mutateButton(form.querySelector('[type="submit"]'), 'delivery-schedule', async () => {
      message.textContent = 'Сохраняем…';
      const controls = Array.from(form.querySelectorAll('input,select'));
      const disabled = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      try {
        const result = await api.saveDeliverySchedule(schedule);
        state.bootstrap.delivery_status = result.delivery_status;
        form.closest('details').querySelector('.schedule-caption').textContent = result.schedule.mode === 'digest' ? `Сводка в ${result.schedule.daily_time}` : 'Сразу после обнаружения';
        message.textContent = 'Расписание сохранено.';
        toast('Расписание сохранено. Фильтры игр продолжают действовать.');
      } catch (error) { message.textContent = 'Не сохранено. ' + error.message; throw error; }
      finally { controls.forEach((control, index) => { control.disabled = disabled[index]; }); }
    });
    return;
  }
  if (event.target.id !== 'preferences-form') return;
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('[type="submit"]');
  const appId = Number(form.dataset.appId);
  const message = form.querySelector('#preferences-message');
  const prefs = readPreferences(form);
  await mutateButton(button, 'prefs-' + appId, async () => {
    message.textContent = 'Сохраняем…';
    try {
      const result = await api.savePreferences(appId, prefs);
      state.bootstrap.library = state.bootstrap.library.map(game => game.app_id === appId ? { ...game, preferences: result.preferences } : game);
      if (state.game?.game.app_id === appId) state.game.game.preferences = result.preferences;
      message.textContent = 'Настройки сохранены.';
      toast('Настройки сохранены. Новые события будут проходить эти правила.');
    } catch (error) { message.textContent = 'Не сохранено. ' + error.message; throw error; }
  });
});

window.addEventListener('hashchange', () => {
  if (state.bootstrap) loadRoute();
});
window.addEventListener('pagehide', () => { feed.cancel(); cancelSteamReads(); searchController?.abort(); clearTimeout(gamePollTimer); clearTimeout(overviewPollTimer); clearTimeout(searchTimer); telegram.destroy(); });
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  telegram.init();
  if (state.bootstrap) loadRoute({ focus: false, force: true });
});
window.addEventListener('focus', () => {
  if (state.bootstrap && !document.hidden && ['library', 'profile'].includes(state.route.page)
    && (steam.open || state.route.page === 'profile') && (steam.status?.pending || steam.loginURL)) refreshSteam({ preview: true });
});
document.addEventListener('visibilitychange', () => {
  if (!state.bootstrap) return;
  if (document.hidden) { clearTimeout(gamePollTimer); clearTimeout(overviewPollTimer); cancelSteamReads(); }
  else {
    scheduleGamePoll(navigationEpoch); scheduleOverviewPoll(navigationEpoch);
    if (['library', 'profile'].includes(state.route.page) && (steam.open || state.route.page === 'profile')) refreshSteam({ preview: true });
  }
});

async function start() {
  clearTimeout(gamePollTimer);
  clearTimeout(overviewPollTimer);
  searchController?.abort();
  feed.cancel();
  cancelSteamReads();
  if (steamCallback) { await verifySteamCallback(); return; }
  // A fresh Telegram authentication may identify another profile. Do not show
  // a previous owner's linked Steam account or selection while bootstrap loads.
  steam.status = null; steam.loginURL = ''; steam.loaded = false; steam.busy = ''; steam.message = ''; steam.error = '';
  steamSelection.clear();
  state.bootstrap = null;
  appRoot.innerHTML = shell(state.route, state.bootstrap);
  setMain(loadingState('Подключаемся к приложению…'));
  try {
    state.config = await loadRuntimeConfig();
    if (state.config.remote) {
      if (!await loadTelegramSDK()) throw new ApiError('Не удалось загрузить компоненты Telegram. Проверьте соединение и повторите попытку.', 'telegram_unavailable');
      telegram.init();
      setMain(loadingState('Подтверждаем профиль Telegram…'));
    }
    api.configure(state.config, telegram.rawInitData, () => loadRuntimeConfig());
    await syncBootstrap();
    appRoot.innerHTML = shell(state.route, state.bootstrap);
    telegram.init();
    await loadRoute({ focus: false });
  } catch (error) {
    if (state.config?.remote || !state.config) appRoot.innerHTML = connectionScreen(error, state.config || { botURL: 'https://t.me/my_steam_radar_dm_bot' });
    else setMain(errorState(error.message));
  }
}

await start();
