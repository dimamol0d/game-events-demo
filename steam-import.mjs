// Steam credentials stay on the server. The temporary OpenID assertion lives
// only in memory until verification; it never becomes a Telegram session.
export function consumeSteamCallback(host = globalThis.window) {
  const url = new URL(host.location.href);
  if (!url.searchParams.has('steam_callback')) return null;
  const query = url.search.slice(1);
  host.history.replaceState(null, '', url.pathname + '#library');
  const values = new URLSearchParams(query);
  const keys = [...values.keys()];
  if (query.length > 6000 || values.get('steam_callback') !== '1'
    || !/^[a-f0-9]{64}$/.test(values.get('state') || '')
    || new Set(keys).size !== keys.length
    || keys.some(key => !['steam_callback', 'state'].includes(key) && !key.startsWith('openid.'))
    || keys.filter(key => key.startsWith('openid.')).length > 16) {
    return { error: 'Подтверждение Steam повреждено. Вернитесь в приложение и начните подключение снова.' };
  }
  return { query };
}

export function safeSteamLoginURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'steamcommunity.com'
      && url.pathname === '/openid/login' && !url.username && !url.password && !url.port && !url.hash
      && url.searchParams.get('openid.mode') === 'checkid_setup' ? url.href : '';
  } catch { return ''; }
}

export function createSteamSelection(limit = 100) {
  const state = { games: [], selected: new Set(), query: '', shown: 60, existing: new Set(), skipped: new Map(), slots: limit };
  function reconcile(library = []) {
    state.existing = new Set(library.map(game => Number(game.app_id)));
    state.slots = Math.max(0, limit - state.existing.size);
    const available = new Set(state.games.filter(game => !state.existing.has(game.app_id) && !state.skipped.has(game.app_id)).map(game => game.app_id));
    state.selected = new Set([...state.selected].filter(id => available.has(id)).slice(0, state.slots));
  }
  function setGames(games, library = []) {
    if (!Array.isArray(games) || games.length > 30000) throw new Error('Сервер вернул непонятный список игр Steam.');
    const unique = new Map();
    for (const game of games) {
      if (!Number.isInteger(game?.app_id) || game.app_id < 1 || game.app_id > 4294967295 || typeof game.name !== 'string') throw new Error('Сервер вернул непонятный список игр Steam.');
      if (!unique.has(game.app_id)) unique.set(game.app_id, { app_id: game.app_id, name: game.name.slice(0, 500) });
    }
    state.games = [...unique.values()];
    state.skipped.clear();
    state.shown = 60;
    reconcile(library);
  }
  function filtered() {
    const query = state.query.trim().toLocaleLowerCase('ru');
    return query ? state.games.filter(game => game.name.toLocaleLowerCase('ru').includes(query) || String(game.app_id).includes(query)) : state.games;
  }
  function toggle(id, checked) {
    if (!checked) { state.selected.delete(id); return true; }
    if (state.existing.has(id) || state.skipped.has(id) || !state.games.some(game => game.app_id === id)) return false;
    if (!state.selected.has(id) && state.selected.size >= state.slots) return false;
    state.selected.add(id); return true;
  }
  function selectFiltered() {
    const candidates = filtered().filter(game => !state.existing.has(game.app_id) && !state.skipped.has(game.app_id));
    for (const game of candidates) {
      if (state.selected.size >= state.slots) break;
      state.selected.add(game.app_id);
    }
  }
  function markSkipped(games) { for (const game of games) { state.skipped.set(game.app_id, game.message); state.selected.delete(game.app_id); } }
  function clear() { state.games = []; state.selected.clear(); state.skipped.clear(); state.query = ''; state.shown = 60; state.existing = new Set(); state.slots = limit; }
  return { state, reconcile, setGames, filtered, toggle, selectFiltered, markSkipped, clear,
    selectedGames: () => state.games.filter(game => state.selected.has(game.app_id)) };
}

// Reads are invalidated when closing the panel, changing routes or unlinking.
// Even a fetch implementation that ignores AbortSignal cannot restore old data.
export function createSteamReadGuard() {
  let epoch = 0;
  let controller;
  function cancel() { epoch++; controller?.abort(); controller = undefined; }
  return { cancel, begin() {
    cancel(); controller = new AbortController();
    const signal = controller.signal;
    const captured = epoch;
    return { signal, current: () => captured === epoch && !signal.aborted };
  } };
}
