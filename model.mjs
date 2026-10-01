export const games = Object.freeze([
  { id: 570, name: 'Dota 2', subtitle: 'Твоя игра. Только нужные изменения.', initials: 'D2' },
]);

export const defaultPreferences = Object.freeze({
  enabled: true, preset: 'updates', patches: true, builds: false, news: false, speed: 'fast',
});

export function normalizePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = { ...defaultPreferences };
  for (const key of ['enabled', 'patches', 'builds', 'news']) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  if (['updates', 'all', 'major', 'custom'].includes(source.preset)) result.preset = source.preset;
  if (['fast', 'detailed'].includes(source.speed)) result.speed = source.speed;
  return result;
}

export function applyPreset(preferences, preset) {
  const value = normalizePreferences(preferences);
  const options = {
    updates: { patches: true, builds: false, news: false },
    all: { patches: true, builds: true, news: true },
    major: { patches: true, builds: false, news: false },
  };
  return options[preset] ? { ...value, ...options[preset], preset } : { ...value, preset: 'custom' };
}

export function wouldNotify(event, preferences) {
  const value = normalizePreferences(preferences);
  if (!value.enabled) return false;
  if (value.preset === 'major') return event.kind === 'patch' && event.severity === 'major';
  return Boolean({ patch: value.patches, build: value.builds, news: value.news }[event.kind]);
}

export function selectEvents(events, gameId, tab, since = null) {
  return events.filter(event => event.gameId === gameId)
    .filter(event => tab !== 'important' || event.kind === 'patch')
    .filter(event => tab !== 'since' || !since || Date.parse(event.detectedAt) > Date.parse(since))
    .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
}

// A manually curated reference, not an event detected or delivered by this UI.
// Verified against Valve's patch feed and official Steam announcement on 2026-10-01.
export const latestDotaPatch = Object.freeze({
  id: 'reference:dota:7.41f', gameId: 570, kind: 'patch', severity: 'balance',
  title: 'Патч 7.41f — коротко о главном',
  summary: 'Изменены 35 героев и 16 предметов: Lina и Shadow Fiend ослаблены, Anti-Mage усилен. Daedalus и Dragon Lance стали дороже.',
  detectedAt: '2026-09-15T18:44:25Z', publishedAt: '2026-09-15T18:44:25Z',
  source: 'Valve · Dota2.com', demo: false, reference: true,
  tags: ['Баланс героев', 'Предметы', 'Исправления'],
  details: [
    'Герои. Lina: базовый интеллект 30 → 28; бонус скорости атаки за заряд Fiery Soul уменьшен с 8/16/24/32 до 7/14/21/28, длительность — с 18 до 16 секунд.',
    'Shadow Fiend: дополнительный урон за душу снижен с 3 до 2. Anti-Mage: урон Mana Break от сожжённой маны увеличен с 60% до 65%. Это отдельные изменения, не полный список героев.',
    "Предметы. Daedalus теперь стоит 5200 вместо 5100 золота, Dragon Lance — 2000 вместо 1900. Урон Arctic Blast у Shiva's Guard снижен с 260 до 225.",
    'Исправления из сопутствующей публикации Valve: убрана возможность прятаться в геометрии у верхней ямы Рошана; исправлены дополнительное золото Bounty Hunter и взаимодействие критического таланта Lina с другими критами.',
    'В подборке нет подтверждённого размера скачивания. Сводка составлена вручную по официальным источникам; полные списки изменений доступны ниже.',
  ],
  sourceLinks: [
    { label: 'Полный патч на Dota2.com', url: 'https://www.dota2.com/patches/7.41f' },
    { label: 'Публикация Valve и исправления', url: 'https://www.dota2.com/newsentry/677383425371407609?l=russian' },
  ],
});

export function demoEvents(now = Date.now()) {
  // Keep fictional examples older than the reference; never move a real release to today.
  const anchor = Math.min(now, Date.parse(latestDotaPatch.publishedAt));
  const at = hours => new Date(anchor - hours * 3600000).toISOString();
  return [
    { ...latestDotaPatch },
    { id: 'demo:build', gameId: 570, kind: 'build', severity: null, title: 'Изменился публичный билд',
      summary: 'Ранний технический сигнал. Сам по себе ещё не означает выход патча.',
      detectedAt: at(4), source: 'Пример сигнала SteamKit', demo: true, tags: ['Без описания'],
      oldBuild: 'DEMO-100', newBuild: 'DEMO-101',
      details: ['Пример смены билда. Размер скачивания и содержание обновления по этому сигналу неизвестны.'] },
    { id: 'demo:fix', gameId: 570, kind: 'patch', severity: 'small', title: 'Исправления и стабильность',
      summary: 'Пример небольшого обновления: исправленные ошибки без крупных изменений.',
      detectedAt: at(26), source: 'Демонстрационный пример', demo: true, tags: ['Исправления'],
      details: ['Тестовый пример маленького патча. Здесь будет оригинальный текст или проверенная сводка с источником.'] },
    { id: 'demo:news', gameId: 570, kind: 'news', severity: null, title: 'Новость от разработчиков',
      summary: 'Не каждая публикация — обновление игры. В истории они будут отличаться.',
      detectedAt: at(48), source: 'Демонстрационный пример', demo: true, tags: ['Новость'],
      details: ['Пример обычной новости. Она не помечена как патч и не включена в режим «Обновления».'] },
  ];
}

export function fromSnapshot(snapshot, gameId) {
  if (!snapshot || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.games)) {
    throw new Error('Сервер вернул данные неизвестного формата.');
  }
  const game = snapshot.games.find(item => Number(item.app_id) === gameId);
  const events = snapshot.events
    .filter(item => Number(item.app_id) === gameId && item.kind === 'public_build_changed')
    .filter(item => typeof item.detected_at === 'string' && Number.isFinite(Date.parse(item.detected_at)))
    .map(item => ({
      id: `lab:${item.event_key || item.id}`, gameId, kind: 'build', severity: null,
      title: 'Изменился публичный билд',
      summary: 'Steam зафиксировал новый билд. Подробности патча в этот экран пока не подключены.',
      detectedAt: item.detected_at, source: String(item.source || 'SteamKit'),
      oldBuild: String(item.old_build_id || '—'), newBuild: String(item.new_build_id || '—'),
      tags: ['Технический сигнал'], demo: false,
      details: ['Это настоящий сигнал из локальной базы, а не подтверждение крупного обновления.',
        'По BuildID нельзя надёжно определить размер скачивания или список изменений. Официальные публикации подключим отдельно.'],
    }));
  return { events, buildId: game?.build_id || null, observedAt: game?.observed_at || null,
    healthy: snapshot.health?.status === 'ok', tracked: Boolean(game) };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
    : 'Время неизвестно';
}

export function eventCountLabel(count) {
  const remainder = count % 100;
  if (remainder >= 11 && remainder <= 14) return `${count} событий`;
  return `${count} ${count % 10 === 1 ? 'событие' : count % 10 >= 2 && count % 10 <= 4 ? 'события' : 'событий'}`;
}
