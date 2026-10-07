export const LIBRARY_LIMIT = 100;
export const LIBRARY_FILE_LIMIT = 262144;
const FORMAT = 'steam-update-radar-library';
const booleanPreferences = new Set(['enabled', 'patches', 'builds', 'news', 'include_unknown']);
const modes = new Set(['major', 'updates', 'all', 'custom', 'medium', 'minor']);
const ownKeys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
const validId = value => Number.isSafeInteger(value) && value > 0 && value <= 4294967295;

function preferences(value) {
  if (!ownKeys(value, [...booleanPreferences, 'mode', 'timing'])) throw new Error('В файле есть неизвестные настройки игры.');
  for (const [key, setting] of Object.entries(value)) {
    if (booleanPreferences.has(key) ? typeof setting !== 'boolean' : key === 'mode' ? !modes.has(setting) : !['fast', 'described'].includes(setting)) throw new Error('В файле есть некорректные настройки игры.');
  }
  return { ...value };
}

function uniqueGames(games) {
  if (!Array.isArray(games) || !games.length || games.length > LIBRARY_LIMIT) throw new Error(`Укажите от 1 до ${LIBRARY_LIMIT} игр.`);
  const result = new Map();
  for (const game of games) {
    if (!ownKeys(game, ['app_id', 'name', 'preferences']) || !validId(game.app_id)) throw new Error('В списке есть некорректный Steam AppID.');
    if ('name' in game && (typeof game.name !== 'string' || !game.name.trim() || game.name.length > 500)) throw new Error('В файле есть некорректное название игры.');
    const item = { app_id: game.app_id, ...('name' in game ? { name: game.name } : {}), ...('preferences' in game ? { preferences: preferences(game.preferences) } : {}) };
    if (!result.has(item.app_id)) result.set(item.app_id, item);
  }
  return [...result.values()];
}

export function parseLibraryInput(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIBRARY_FILE_LIMIT) throw new Error('Список или файл слишком большой. Максимум 256 КиБ.');
  const input = text.trim();
  if (!input) throw new Error('Вставьте Steam-ссылки, AppID или содержимое сохранённого файла.');
  if (input.startsWith('{') || input.startsWith('[')) {
    let value;
    try { value = JSON.parse(input); } catch { throw new Error('Файл JSON повреждён или вставлен не полностью.'); }
    if (!ownKeys(value, ['format', 'version', 'games']) || value.format !== FORMAT || value.version !== 1) throw new Error('Этот формат файла не поддерживается. Нужен файл библиотеки «Игрового радара».');
    return uniqueGames(value.games);
  }
  const tokens = input.split(/[\s,;]+/).filter(Boolean);
  return uniqueGames(tokens.map(token => {
    if (/^\d+$/.test(token)) return { app_id: Number(token) };
    let url;
    try { url = new URL(token); } catch { throw new Error(`Не удалось распознать «${token.slice(0, 60)}». Укажите AppID или ссылку магазина Steam.`); }
    const match = /^\/app\/(\d+)(?:\/[^/]*)?\/?$/.exec(url.pathname);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'store.steampowered.com' || url.username || url.password || url.port || !match) throw new Error('Допустимы только AppID и ссылки store.steampowered.com/app/…');
    return { app_id: Number(match[1]) };
  }));
}

export function serializeLibrary(value) {
  if (!ownKeys(value, ['format', 'version', 'games']) || value.format !== FORMAT || value.version !== 1) throw new Error('Сервер вернул непонятный формат библиотеки.');
  // An empty library is a valid backup, but cannot be imported as a selection.
  const games = Array.isArray(value.games) && value.games.length === 0 ? [] : uniqueGames(value.games);
  const json = JSON.stringify({ format: FORMAT, version: 1, games }, null, 2);
  if (new TextEncoder().encode(json).length > LIBRARY_FILE_LIMIT) throw new Error('Файл библиотеки превышает 256 КиБ.');
  return json;
}

export function importPayload(games) {
  return { games: games.map(({ app_id, preferences: prefs }) => ({ app_id, ...(prefs ? { preferences: { ...prefs } } : {}) })) };
}

export async function importLibraryBatches(games, send, onBatch = () => {}) {
  let completed = 0;
  let added = 0;
  let alreadyTracking = 0;
  const skipped = [];
  while (completed < games.length) {
    const batch = games.slice(completed, completed + 5);
    let result;
    try { result = await send(importPayload(batch)); }
    catch (error) { return { added, alreadyTracking, skipped, completed, remaining: games.slice(completed), error }; }
    const omitted = result?.skipped ?? [];
    const batchIds = new Set(batch.map(game => game.app_id));
    const validSkipped = Array.isArray(omitted) && omitted.length <= batch.length
      && new Set(omitted.map(game => game?.app_id)).size === omitted.length
      && omitted.every(game => batchIds.has(game?.app_id) && typeof game.name === 'string' && game.name.length <= 500 && typeof game.message === 'string' && game.message.length <= 500);
    if (!result || !validSkipped || !Number.isInteger(result.added) || result.added < 0 || !Number.isInteger(result.already_tracking) || result.already_tracking < 0 || result.added + result.already_tracking + omitted.length !== batch.length) {
      return { added, alreadyTracking, skipped, completed, remaining: games.slice(completed), error: new Error('Ответ сервера не подтверждает результат. Проверьте библиотеку перед повтором.') };
    }
    completed += batch.length;
    added += result.added;
    alreadyTracking += result.already_tracking;
    skipped.push(...omitted);
    try { onBatch({ batch, result, completed, added, alreadyTracking, skipped }); }
    catch (error) {
      // The server has confirmed this batch. A progress/render failure must
      // not turn it back into an unconfirmed mutation or send the next batch.
      return { added, alreadyTracking, skipped, completed, remaining: games.slice(completed), error };
    }
  }
  return { added, alreadyTracking, skipped, completed, remaining: [], error: null };
}
