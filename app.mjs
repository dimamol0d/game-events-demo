import { api, ApiError } from './api.mjs?v=20261005-foundation2';
import { parseRoute, mergeEvents, preferencesForMode, eventMatchesId } from './model.mjs?v=20261005-foundation2';
import { shell, homePage, libraryPage, searchPage, searchResults, gamePage, settingsPage, inboxPage, loadingState, errorState, connectionScreen } from './views.mjs?v=20261005-foundation2';
import { createTelegramAdapter, loadTelegramSDK } from './telegram.mjs?v=20261005-foundation2';
import { loadRuntimeConfig } from './config.mjs?v=20261005-foundation2';

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

function toast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.hidden = false;
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, 5500);
}

function main() { return document.querySelector('#main-content'); }
function setMain(html, focus = false) {
  const schedule = main().querySelector('.delivery-schedule[open]');
  const active = schedule?.contains(document.activeElement) ? document.activeElement : null;
  main().innerHTML = html;
  if (schedule) main().querySelector('.delivery-schedule')?.replaceWith(schedule);
  if (active?.isConnected) active.focus({ preventScroll: true });
  if (focus) main().focus({ preventScroll: true });
}
function updateUnread(count) {
  if (state.bootstrap) state.bootstrap.unread_count = count;
  document.querySelectorAll('[data-unread]').forEach(badge => { badge.textContent = String(count || ''); badge.hidden = !count; });
}
function updateNavigation() {
  const active = ['game', 'settings'].includes(state.route.page) ? 'library' : state.route.page;
  document.querySelectorAll('.nav-item').forEach(link => {
    const current = link.hash === '#' + active;
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  telegram.updateBack(['game', 'settings'].includes(state.route.page) ? () => { location.hash = state.route.page === 'settings' ? `#game/${state.route.appId}` : '#library'; } : null);
}

async function syncBootstrap() {
  state.bootstrap = await api.bootstrap();
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
    || event.translation_status === 'ready' || String(event.original_language || '').toLowerCase().startsWith('ru') || !event.contents?.trim()) return;
  translationRequested.add(String(event.id));
  requestTranslation(event).catch(() => {});
}

async function requestTranslation(event) {
  const eventId = Number(event.id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return false;
  const epoch = navigationEpoch;
  const result = await api.translate(eventId);
  if (epoch !== navigationEpoch || state.route.page !== 'game') return result.queued;
  if (result.queued) {
    event.translation_status = 'pending';
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
  if (document.hidden || state.route.page !== 'game' || !state.game || (state.game.game.poll_status !== 'awaiting' && !state.game.events.some(event => event.translation_status === 'pending'))) return;
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
      if (fresh.game.poll_status === 'awaiting' || merged.some(event => event.translation_status === 'pending')) scheduleGamePoll(epoch, Math.min(delay * 1.5, 20000));
    } catch { if (epoch === navigationEpoch) scheduleGamePoll(epoch, 20000); }
  }, delay);
}

function scheduleOverviewPoll(epoch, delay = 5000) {
  clearTimeout(overviewPollTimer);
  if (!state.bootstrap || !['home', 'library', 'inbox'].includes(state.route.page) || document.hidden) return;
  const games = [...state.bootstrap.library, ...state.bootstrap.featured];
  const pending = games.some(game => game.poll_status === 'awaiting' || game.latest_event?.translation_status === 'pending')
    || state.route.page === 'inbox' && state.notifications?.items?.some(item => item.event.translation_status === 'pending')
    || Number(state.bootstrap.delivery_status?.pending_count) > 0;
  if (!pending) return;
  overviewPollTimer = setTimeout(async () => {
    if (epoch !== navigationEpoch || document.hidden) return;
    if (document.querySelector('.delivery-schedule[open]')) { scheduleOverviewPoll(epoch, 10000); return; }
    try {
      await syncBootstrap();
      if (epoch !== navigationEpoch) return;
      if (document.querySelector('.delivery-schedule[open]')) { scheduleOverviewPoll(epoch, 10000); return; }
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
  const previous = state.route;
  state.route = parseRoute(location.hash);
  const route = state.route;
  const epoch = ++navigationEpoch;
  updateNavigation();
  document.title = ({ home: 'Главная', search: 'Поиск игр', library: 'Библиотека', inbox: 'Уведомления', game: 'Игра', settings: 'Настройки' }[route.page] || 'Главная') + ' — Игровой радар';
  if (previous.page !== route.page || previous.appId !== route.appId) window.scrollTo({ top: 0, behavior: 'instant' });
  if (route.page === 'home') {
    setMain(homePage(state.bootstrap, state.config), focus);
    if (force || Date.now() - bootstrapUpdatedAt > 5000) {
      try { await syncBootstrap(); if (epoch === navigationEpoch) setMain(homePage(state.bootstrap, state.config)); }
      catch (error) { if (epoch === navigationEpoch) toast(error.message); }
    }
    scheduleOverviewPoll(epoch);
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
  if (action === 'retry') { if (!state.bootstrap) await start(); else await loadRoute({ force: true }); }
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

document.addEventListener('change', event => {
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
window.addEventListener('pagehide', () => { searchController?.abort(); clearTimeout(gamePollTimer); clearTimeout(overviewPollTimer); clearTimeout(searchTimer); telegram.destroy(); });
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  telegram.init();
  if (state.bootstrap) loadRoute({ focus: false, force: true });
});
document.addEventListener('visibilitychange', () => {
  if (!state.bootstrap) return;
  if (document.hidden) { clearTimeout(gamePollTimer); clearTimeout(overviewPollTimer); }
  else { scheduleGamePoll(navigationEpoch); scheduleOverviewPoll(navigationEpoch); }
});

async function start() {
  clearTimeout(gamePollTimer);
  clearTimeout(overviewPollTimer);
  searchController?.abort();
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
