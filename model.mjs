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

export function demoEvents(now = Date.now()) {
  const at = hours => new Date(now - hours * 3600000).toISOString();
  return [
    { id: 'demo:major', gameId: 570, kind: 'patch', severity: 'major', title: 'Обновление игрового процесса',
      summary: 'Карта, герои и предметы — пример того, как будет выглядеть большой патч.',
      detectedAt: at(3), source: 'Демонстрационный пример', demo: true,
      tags: ['Карта', 'Герои', 'Предметы'],
      details: ['Это выдуманный пример для настройки интерфейса, не новость о настоящем патче.',
        'В этом месте появится проверенное описание изменений и ссылка на официальную публикацию. Пока мы выбираем, как тебе удобнее это читать.'] },
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
