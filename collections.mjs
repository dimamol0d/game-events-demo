export const COLLECTION_LIMIT = 20;
export const COLLECTION_NAME_LIMIT = 40;

export function normalizeCollectionName(value = '') { return String(value).normalize('NFC').trim().replace(/\s+/gu, ' '); }
export function collectionNameError(value, collections = [], exceptId = null) {
  const name = normalizeCollectionName(value);
  if (!name) return 'Введите название списка.';
  if ([...name].length > COLLECTION_NAME_LIMIT) return 'Название — не больше 40 символов.';
  if (collections.some(item => item.id !== exceptId && normalizeCollectionName(item.name).toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) return 'Список с таким названием уже есть.';
  return '';
}
export function ownedCollections(collections = [], library = []) {
  const known = new Set(library.map(game => Number(game.app_id)));
  return collections.filter(item => Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0).slice(0, COLLECTION_LIMIT).map(item => ({ id: Number(item.id), name: String(item.name || ''), app_ids: [...new Set((item.app_ids || []).map(Number))].filter(id => known.has(id)) }));
}
export function collectionGames(library = [], collections = [], filter = 'all', query = '') {
  const grouped = new Set(collections.flatMap(item => item.app_ids));
  const members = new Set(collections.find(item => item.id === Number(filter))?.app_ids || []);
  const text = query.trim().toLocaleLowerCase('ru');
  return library.filter(game => (filter === 'all' || filter === 'unsorted' && !grouped.has(Number(game.app_id)) || members.has(Number(game.app_id))) && (!text || `${game.name} ${game.app_id}`.toLocaleLowerCase('ru').includes(text)));
}
export function createCollectionTools() {
  const state = { filter: 'all', libraryQuery: '', query: '', selected: new Set(), listId: null, gameId: null, gameSelected: new Set(), membersOnly: false, name: '', createName: '', busy: false, loading: false, message: '', error: '', deleteId: null };
  let library = []; let collections = [];
  function reconcile(games = [], groups = []) {
    library = games; collections = ownedCollections(groups, games);
    if (!['all', 'unsorted'].includes(state.filter) && !collections.some(item => item.id === Number(state.filter))) state.filter = 'all';
    const known = new Set(games.map(game => Number(game.app_id)));
    for (const appId of state.selected) if (!known.has(appId)) state.selected.delete(appId);
    const groupsKnown = new Set(collections.map(item => item.id));
    for (const id of state.gameSelected) if (!groupsKnown.has(id)) state.gameSelected.delete(id);
  }
  function group(id = state.listId) { return collections.find(item => item.id === Number(id)); }
  function startList(id) { if (state.listId !== id) { state.listId = id; state.selected.clear(); state.query = ''; state.membersOnly = false; state.error = ''; state.message = ''; state.deleteId = null; state.name = group(id)?.name || ''; } }
  function startGame(appId, { force = false } = {}) { if (state.gameId !== appId || force) { state.gameId = appId; state.gameSelected = new Set(collections.filter(item => item.app_ids.includes(appId)).map(item => item.id)); state.error = ''; state.message = ''; } }
  function filtered() { const games = collectionGames(library, collections, state.membersOnly ? state.listId : 'all', state.query); return games; }
  function toggle(appId, checked) { if (!library.some(game => Number(game.app_id) === appId)) return false; if (checked) state.selected.add(appId); else state.selected.delete(appId); return true; }
  function selectFiltered() { for (const game of filtered()) state.selected.add(Number(game.app_id)); }
  function clear() { Object.assign(state, { filter: 'all', libraryQuery: '', query: '', selected: new Set(), listId: null, gameId: null, gameSelected: new Set(), membersOnly: false, name: '', createName: '', busy: false, loading: false, message: '', error: '', deleteId: null }); library = []; collections = []; }
  return { state, reconcile, group, startList, startGame, filtered, toggle, selectFiltered, clear, get collections() { return collections; } };
}
