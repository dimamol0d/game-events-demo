import { games, demoEvents, applyPreset } from './model.mjs';
import { readLocalState, writeLocalState } from './storage.mjs';
import { loadLaboratory } from './api.mjs';
import { createTelegramAdapter } from './telegram.mjs';
import { renderApp } from './views.mjs';
import { DEMO_ONLY } from './deployment.mjs';

const root = document.querySelector('#app');
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const game = games[0];
const local = readLocalState(storage, game.id);
const openedAt = new Date().toISOString();
const visits = { demo: local.lastVisit, lab: readLocalState(storage, `${game.id}:lab`).lastVisit };
const state = { game, events: demoEvents(), preferences: local.preferences, draft: { ...local.preferences },
  page: 'game', eventId: null, tab: 'important', since: visits.demo, mode: 'demo',
  loading: false, error: null, lab: null, toast: '', requestId: 0, demoOnly: DEMO_ONLY };
const telegram = createTelegramAdapter();

function draw() {
  root.innerHTML = renderApp(state);
  telegram.updateBack(state.eventId || state.page === 'settings' ? () => { location.hash = '#game'; } : null);
}

function route() {
  const hash = location.hash.slice(1);
  state.page = hash === 'settings' ? 'settings' : 'game';
  try { state.eventId = hash.startsWith('event/') ? decodeURIComponent(hash.slice(6)) : null; }
  catch { state.eventId = null; }
  if (state.page === 'settings') { state.draft = { ...state.preferences }; state.toast = ''; }
  draw();
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.querySelector('main h1')?.focus({ preventScroll: true });
}

function saveVisit() {
  const storageId = state.mode === 'lab' ? `${game.id}:lab` : game.id;
  const prefs = state.mode === 'lab' ? readLocalState(storage, storageId).preferences : state.preferences;
  writeLocalState(storage, storageId, { preferences: prefs, lastVisit: openedAt });
}

async function refresh() {
  const requestId = ++state.requestId;
  state.error = null;
  if (state.mode === 'demo') {
    state.loading = false; state.events = demoEvents(); state.lab = null; draw(); saveVisit(); return;
  }
  state.loading = true; state.events = []; draw();
  try {
    const data = await loadLaboratory(game.id);
    if (requestId !== state.requestId || state.mode !== 'lab') return;
    state.lab = data; state.events = data.events;
    saveVisit();
  } catch (error) {
    if (requestId !== state.requestId || state.mode !== 'lab') return;
    state.error = error.name === 'TimeoutError' ? 'Лаборатория не ответила вовремя. Повтори загрузку.' : error.message || 'Не удалось прочитать лабораторию.';
  } finally {
    if (requestId === state.requestId) { state.loading = false; draw(); }
  }
}

function changeMode(mode) {
  if (state.demoOnly && mode !== 'demo') return;
  state.mode = mode; state.since = visits[mode]; state.eventId = null;
  if (location.hash.startsWith('#event/')) location.hash = '#game';
  refresh();
}

root.addEventListener('click', event => {
  const target = event.target.closest('[data-action], [data-tab], [data-event]');
  if (!target) return;
  if (target.dataset.event) { location.hash = `#event/${encodeURIComponent(target.dataset.event)}`; return; }
  if (target.dataset.tab) { state.tab = target.dataset.tab; draw(); return; }
  switch (target.dataset.action) {
    case 'back': location.hash = '#game'; break;
    case 'settings': location.hash = '#settings'; break;
    case 'refresh': refresh(); break;
    case 'demo': changeMode('demo'); break;
    case 'save': {
      const saved = writeLocalState(storage, game.id, { preferences: state.draft, lastVisit: openedAt });
      if (saved) state.preferences = { ...state.draft };
      state.toast = saved ? 'Сохранено на этом устройстве. Бот пока не использует эти настройки.' : 'Браузер запретил сохранение. Настройки не сохранены.';
      draw(); break;
    }
  }
});

root.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'data-mode') { changeMode(target.value); return; }
  if (target.name === 'preset') state.draft = applyPreset(state.draft, target.value);
  else if (target.name === 'speed') state.draft.speed = target.value;
  else if (target.dataset.setting) state.draft[target.dataset.setting] = target.checked;
  else return;
  state.toast = ''; draw();
  const focusSelector = target.dataset.setting ? `[data-setting="${target.dataset.setting}"]` : `[name="${target.name}"][value="${target.value}"]`;
  document.querySelector(focusSelector)?.focus();
});

window.addEventListener('hashchange', route);
window.addEventListener('load', () => telegram.init(), { once: true });
window.addEventListener('pagehide', () => telegram.destroy());
route();
telegram.init();
saveVisit();
