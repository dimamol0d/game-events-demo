import { escapeHTML as h, safeURL, safeImageURL, eventRoute, eventLabel, excerpt, formatDate, coverageText, latestPublications, sourceLabel, publicationLanguage, MODES, DEFAULT_PREFS } from './model.mjs';

const paths = {
  home: '<path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  library: '<path d="M4 4h4v17H4zM11 4h4v17h-4zM18 4l4 16-4 1-4-16z"/>',
  inbox: '<path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4zM10 21h4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="m14 5-7 7 7 7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>',
  external: '<path d="M14 3h7v7M21 3 10 14M10 5H4v16h16v-6"/>',
};
export function icon(name, extra = '') { return `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`; }

export function art(game, className = '', lazy = true) {
  const url = safeImageURL(game.image_url);
  return url ? `<img class="game-art ${className}" src="${h(url)}" alt="" ${lazy ? 'loading="lazy"' : ''} decoding="async" referrerpolicy="no-referrer">` : `<div class="game-art art-fallback ${className}" aria-hidden="true">${h(game.name?.slice(0, 2) || 'Игра')}</div>`;
}

export function externalLink(url, label, className = '') {
  const valid = safeURL(url);
  return valid ? `<a class="${className}" href="${h(valid)}" target="_blank" rel="noopener noreferrer">${h(label)} ${icon('external')}</a>` : '';
}

export function shell(route, bootstrap) {
  const active = route.page === 'game' || route.page === 'settings' ? 'library' : route.page;
  const nav = [['home', 'Главная'], ['search', 'Поиск'], ['library', 'Библиотека'], ['inbox', 'Уведомления']].map(([key, label]) => `<a class="nav-item ${active === key ? 'active' : ''}" href="#${key}" ${active === key ? 'aria-current="page"' : ''}>${icon(key)}<span>${label}</span>${key === 'inbox' ? '<span class="unread-count" data-unread' + (!bootstrap?.unread_count ? ' hidden' : '') + '>' + h(bootstrap?.unread_count || '') + '</span>' : ''}</a>`).join('');
  const running = bootstrap?.health?.worker_running;
  return `<div class="app-layout">
    <aside class="sidebar"><a class="brand" href="#home"><svg class="brand-mark" viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="16"/><circle cx="21" cy="21" r="8"/><path d="M21 5v16l12-8"/><circle class="radar-dot" cx="21" cy="21" r="2.7"/></svg><span>Игровой<br>радар</span></a>
    <nav class="desktop-nav" aria-label="Основная навигация">${nav}</nav>
    <div class="sidebar-bottom"><span class="connection-status"><i class="status-dot ${running ? 'is-running' : ''}"></i>${running ? 'Проверка игр работает' : 'Проверка игр приостановлена'}</span><p>Черновая версия<br>Развиваем постепенно</p></div></aside>
    <div class="workspace"><header class="topbar"><a class="mobile-brand" href="#home">Игровой радар</a><div class="topbar-context">Всё об обновлениях ваших игр</div><div class="profile-pill"><span class="avatar" aria-hidden="true">${h((bootstrap?.profile?.name || 'М').slice(0, 1))}</span><span>${h(bootstrap?.profile?.name || 'Мой профиль')}<small>${bootstrap?.profile?.local_only === false ? 'Профиль Telegram' : 'В этом браузере'}</small></span></div></header>
      <main id="main-content" tabindex="-1"></main>
    </div><nav class="mobile-nav" aria-label="Навигация на телефоне">${nav}</nav>
  </div>`;
}

export function pageHeader(title, text, actions = '') {
  return `<div class="page-heading"><div><h1>${h(title)}</h1>${text ? `<p>${h(text)}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

export function emptyState(title, text, action = '') {
  return `<div class="empty-state"><div class="empty-symbol">${icon('library')}</div><h2>${h(title)}</h2><p>${h(text)}</p>${action}</div>`;
}

export function errorState(message, retry = 'retry') {
  return `<div class="error-state" role="alert"><h2>Не получилось загрузить</h2><p>${h(message)}</p><button class="button secondary" type="button" data-action="${retry}">Попробовать снова</button></div>`;
}

export function loadingState(text = 'Загружаем данные…') {
  return `<div class="loading-state" role="status"><span class="loading-orbit" aria-hidden="true"></span>${h(text)}</div>`;
}

export function connectionScreen(error, config = {}) {
  const isLogin = error.code === 'telegram_required';
  const expired = ['auth_expired', 'invalid_auth'].includes(error.code);
  const title = isLogin ? 'Откройте радар в Telegram' : expired ? 'Откройте приложение снова' : error.code === 'not_configured' ? 'Готовим подключение' : error.code === 'telegram_unavailable' ? 'Не удалось подключить Telegram' : ['offline', 'timeout', 'invalid_response'].includes(error.code) ? 'Домашний сервер недоступен' : 'Не удалось открыть приложение';
  return `<main id="main-content" tabindex="-1" class="connection-screen"><div class="connection-card"><a class="connection-brand" href="#home">Игровой радар</a><div class="empty-symbol">${icon(isLogin || expired ? 'inbox' : 'refresh')}</div><h1>${h(title)}</h1><p>${h(error.message || 'Не удалось подключиться к серверу.')}</p>${!isLogin && !expired ? '<p class="connection-explanation">Приложение получает данные с домашнего компьютера. Он должен быть включён, а сервер приложения — запущен. Открытая страница сама не запускает отслеживание.</p>' : '<p class="connection-explanation">Вход подтверждается Telegram. Библиотека и настройки будут доступны после открытия кнопкой в боте.</p>'}<div class="connection-actions">${externalLink(config.botURL, 'Открыть бота', 'button primary')}<button class="button secondary" type="button" data-action="retry">Попробовать снова</button></div></div></main>`;
}

export function deliveryControls(profile, config = {}) {
  if (profile?.local_only !== false) return '';
  const enabled = profile.telegram_delivery_enabled;
  const canMessage = profile.telegram_can_message;
  return `<div class="telegram-delivery"><div><h3>${enabled ? 'Уведомления в Telegram включены' : 'Уведомления в Telegram'}</h3><p>${enabled ? 'Новые события придут в чат с ботом по настройкам ваших игр.' : canMessage ? 'Можно получать выбранные события прямо в чат с ботом.' : 'Откройте бота и нажмите «Начать», чтобы он мог присылать вам сообщения.'}</p></div><div class="delivery-actions">${canMessage ? `<button class="button ${enabled ? 'secondary' : 'primary'}" type="button" data-action="delivery" data-enabled="${enabled ? 'false' : 'true'}">${enabled ? 'Отключить Telegram' : 'Получать в Telegram'}</button>` : `${externalLink(config.botURL, 'Открыть бота', 'button primary')}<button class="button secondary" type="button" data-action="write-access">Разрешить уведомления</button>`}</div></div>`;
}

export function addButton(game, library, compact = false) {
  const added = library.some(item => Number(item.app_id) === Number(game.app_id));
  return added ? `<a class="button ${compact ? 'small ' : ''}quiet in-library" href="#game/${game.app_id}" aria-label="Открыть ${h(game.name)} в библиотеке">${icon('check')}В библиотеке</a>` : `<button class="button ${compact ? 'small ' : ''}primary" type="button" data-action="add" data-app-id="${game.app_id}" aria-label="Добавить ${h(game.name)} в библиотеку">${icon('plus')}Добавить</button>`;
}

export function gameRow(game, library, { actions = true, preferences = false } = {}) {
  const mode = MODES.find(item => item.id === game.preferences?.mode)?.name;
  return `<div class="game-row"><a href="#game/${game.app_id}" class="game-row-main">${art(game)}<div class="game-row-copy"><h3>${h(game.name)}</h3><div class="row-meta"><span class="type-label">${game.type === 'dlc' ? 'DLC' : 'Игра'}</span>${preferences && mode ? `<span>${game.preferences.enabled ? h(mode) : 'Уведомления выключены'}</span>` : `<span>${h(coverageText(game))}</span>`}</div>${game.latest_event ? `<p>${h(publicationLanguage(game.latest_event).title)}</p>` : ''}</div></a>${actions ? `<div class="row-actions">${preferences ? `<a class="icon-button" href="#settings/${game.app_id}" aria-label="Настройки ${h(game.name)}">${icon('settings')}</a>` : addButton(game, library, true)}</div>` : ''}</div>`;
}

export function homePage(bootstrap, config = {}) {
  const featured = bootstrap.featured || [];
  const library = bootstrap.library || [];
  const publications = latestPublications(featured).slice(0, 3);
  return `${pageHeader('Главная', 'Последние публикации и игры, за которыми стоит следить.', '<a class="button secondary" href="#search">' + icon('search') + 'Найти игру</a>')}
    ${deliveryControls(bootstrap.profile, config)}<section class="bulletin-section" aria-labelledby="bulletin-title"><div class="section-heading"><h2 id="bulletin-title">Из последних обновлений</h2><span class="subtle">Официальные источники</span></div>
    ${publications.length ? `<div class="bulletin-grid">${publications.map((game, index) => `<article class="bulletin ${index === 0 ? 'bulletin-lead' : ''}">${art(game, '', index !== 0)}<div class="bulletin-body"><a class="bulletin-game" href="#game/${game.app_id}">${h(game.name)}</a><div class="event-meta"><span>${h(eventLabel(game.latest_event))}</span><time>${h(formatDate(game.latest_event.published_at || game.latest_event.sort_at))}</time></div><h3><a href="${eventRoute(game.latest_event)}">${h(publicationLanguage(game.latest_event).title)}</a></h3><p>${h(excerpt(publicationLanguage(game.latest_event).contents, index === 0 ? 215 : 120) || 'Откройте официальную публикацию и доступную историю игры.')}</p><a class="bulletin-link" href="${eventRoute(game.latest_event)}">Читать публикацию ${icon('external')}</a></div></article>`).join('')}</div>` : `<div class="inline-empty"><h3>Первые публикации появятся после проверки</h3><p>Можно уже выбрать игры и собрать библиотеку. Если источник недоступен, это будет видно на странице игры.</p></div>`}</section>
    <div class="home-columns"><section class="featured-section" aria-labelledby="featured-title"><div class="section-heading"><h2 id="featured-title">Известные игры</h2><a class="text-link" href="#search">Открыть поиск</a></div><div class="game-list">${featured.map(game => gameRow(game, library)).join('') || '<p class="subtle">Подборка ещё не загружена. Найдите интересующую игру в поиске.</p>'}</div></section>
    <section class="personal-section" aria-labelledby="personal-title"><div class="section-heading"><h2 id="personal-title">Ваша библиотека</h2><a class="text-link" href="#library">Открыть</a></div>${library.length ? `<div class="game-list compact-list">${library.slice(0, 4).map(game => gameRow(game, library, { actions: false, preferences: true })).join('')}</div>` : `<div class="library-invitation"><div class="empty-symbol">${icon('library')}</div><h3>Соберите свой список</h3><p>Добавьте игры, которые вам интересны. Для каждой можно выбрать собственный режим уведомлений.</p><a class="button primary" href="#search">${icon('plus')}Добавить первую игру</a></div>`}<div class="home-note"><span class="note-mark" aria-hidden="true">i</span><p>Сохраняем найденные события в историю. Ваши настройки определяют, о чём появится уведомление.</p></div></section></div>`;
}

export function searchPage(query = '', kind = 'game') {
  return `${pageHeader('Поиск игр', 'Найдите игру в Steam и добавьте её в свою библиотеку.')}
    <form id="search-form" class="search-form" role="search"><div class="search-field">${icon('search')}<label class="sr-only" for="search-input">Название игры или Steam AppID</label><input id="search-input" name="q" type="search" value="${h(query)}" placeholder="Название игры или Steam AppID" autocomplete="off" enterkeyhint="search"><button class="search-submit" type="submit" aria-label="Найти игру">Найти</button></div><fieldset class="type-filters"><legend class="sr-only">Тип приложения Steam</legend>${[['game', 'Игры'], ['dlc', 'DLC'], ['all', 'Всё']].map(([value, label]) => `<label><input type="radio" name="kind" value="${value}" ${value === kind ? 'checked' : ''}><span>${label}</span></label>`).join('')}</fieldset></form>
    <div id="search-results" aria-live="polite">${query ? loadingState('Ищем в каталоге Steam…') : emptyState('Какая игра вас интересует?', 'Начните с названия. DLC можно искать отдельно или вместе с играми.')}</div>`;
}

export function searchResults(result, library) {
  const games = result.games || [];
  return `${result.notice ? `<div class="notice">${h(result.notice)}</div>` : ''}${result.status === 'partial' ? '<p class="source-warning">Каталог доступен частично. Если игры нет, попробуйте точное название или AppID.</p>' : ''}${games.length ? `<div class="section-heading search-results-heading"><h2>Результаты поиска</h2><span class="subtle">${games.length} найдено</span></div><div class="game-list search-list">${games.map(game => gameRow(game, library)).join('')}</div><p class="page-footnote">Игра в каталоге может иметь неполные источники обновлений. После добавления проверим, какие данные доступны.</p>` : emptyState('Ничего не найдено', 'Проверьте название, смените фильтр или укажите Steam AppID.')}`;
}

export function libraryPage(games) {
  return `${pageHeader('Библиотека', 'Ваши игры и личные правила уведомлений.', '<a class="button primary" href="#search">' + icon('plus') + 'Добавить игру</a>')}${games.length ? `<div class="game-list library-list">${games.map(game => gameRow(game, games, { preferences: true })).join('')}</div><p class="page-footnote">Это ваш список отслеживания. Владеть игрой в Steam, чтобы добавить её сюда, не требуется.</p>` : emptyState('Здесь будут ваши игры', 'Добавьте одну или несколько игр. История общая, а режим уведомлений для каждой игры выбираете вы.', '<a class="button primary" href="#search">Найти первую игру</a>')}`;
}

export function eventCard(event, selected = false, preferred = 'ru') {
  const isBuild = event.kind === 'public_build_changed';
  const date = event.published_at || event.sort_at || event.detected_at;
  const source = sourceLabel(event.source);
  const language = publicationLanguage(event, preferred);
  const languageControls = selected && !isBuild ? language.originalRussian ? '<p class="translation-note">Исходная публикация на русском.</p>' : `<div class="publication-language" role="group" aria-label="Язык публикации"><button class="language-button ${language.russian ? 'selected' : ''}" type="button" data-action="language" data-event-id="${h(event.id)}" data-language="ru" ${!language.translated ? 'disabled' : ''}>Русский</button><button class="language-button ${!language.russian ? 'selected' : ''}" type="button" data-action="language" data-event-id="${h(event.id)}" data-language="original">Оригинал</button></div><p class="translation-note">${language.russian ? 'Автоматический перевод. Термины и числа можно сверить с оригиналом.' : language.translated ? 'Исходный текст разработчика.' : event.translation_status === 'pending' ? 'Русский перевод готовится. Сейчас показываем оригинал.' : 'Русский перевод пока недоступен. Показываем оригинал.'}</p>${!language.translated && event.translation_status !== 'pending' && event.contents?.trim() ? `<button class="button small secondary translate-button" type="button" data-action="translate" data-event-id="${h(event.id)}">Перевести на русский</button>` : ''}` : '';
  return `<article class="event-card ${selected ? 'event-selected' : ''}" id="event-${h(String(event.id).replace(/[^a-zA-Z0-9_-]/g, '_'))}"><div class="event-meta"><span class="event-kind ${isBuild ? 'is-build' : event.kind === 'official_news_published' ? 'is-news' : ''}">${h(eventLabel(event))}</span><time datetime="${h(date || '')}">${h(formatDate(date, isBuild))}</time>${event.baseline ? '<span class="archive-label">Из доступной истории</span>' : ''}</div><h3>${selected ? h(language.title) : `<a href="${eventRoute(event)}">${h(language.title)}</a>`}</h3>
    ${languageControls}${isBuild ? `<p class="build-change">${h(event.old_build_id || 'Неизвестный билд')} <span aria-label="сменился на">→</span> ${h(event.new_build_id || 'Неизвестный билд')}</p><p class="subtle">Изменился публичный билд. По этому сигналу нельзя определить содержание и важность обновления.</p>` : selected ? `${language.contents ? `<div class="publication-text">${h(language.contents)}</div>` : '<p class="text-pending">Содержание пока не получено. Публикацию можно открыть у разработчика.</p>'}` : `<p class="event-excerpt">${h(excerpt(language.contents, 260) || 'Содержание пока не получено. Доступен заголовок и ссылка на публикацию.')}</p>`}
    ${selected && language.russian && event.translation_truncated ? '<p class="notice">Перевод сокращён. Полный полученный текст доступен в разделе «Оригинал».</p>' : ''}${selected && event.contents_truncated ? '<p class="notice">Исходный текст сокращён; полная публикация доступна по ссылке на источник ниже.</p>' : ''}<div class="event-footer">${selected || isBuild ? '' : `<a class="text-link" href="${eventRoute(event)}">Читать полностью</a>`}${externalLink(event.url, source, 'source-link')}${selected ? `<a class="text-link close-event" href="#game/${event.app_id}">Свернуть</a>` : ''}</div>${selected && event.detected_at ? `<p class="event-detected">Сохранено ${h(formatDate(event.detected_at, true))}${event.severity ? ' · Категория: ' + h({ major: 'крупное', medium: 'среднее', minor: 'мелкое' }[event.severity] || event.severity) : ''}</p>` : ''}</article>`;
}

export function gamePage(data, library, eventId = null, paginationLoading = false, languages = {}) {
  const { game, events = [], pagination = {} } = data;
  const added = library.some(item => Number(item.app_id) === Number(game.app_id));
  const selectedFound = eventId && events.some(event => String(event.id) === eventId);
  return `<a class="back-link" href="#library">${icon('arrow')}Библиотека</a><section class="game-heading"><div class="game-heading-copy"><span class="type-label">${game.type === 'dlc' ? 'Дополнение DLC' : 'Игра Steam'}</span><h1>${h(game.name)}</h1><div class="game-heading-actions">${addButton(game, library)}${added ? `<a class="button secondary" href="#settings/${game.app_id}">${icon('settings')}Настройки</a>` : ''}${externalLink(game.store_url, 'В Steam', 'text-link')}</div>${game.type === 'dlc' ? `<p class="parent-game">У дополнения может не быть собственной ленты обновлений. При необходимости добавьте ${game.parent_app_id ? `<a href="#game/${game.parent_app_id}">основную игру</a>` : 'основную игру'}.</p>` : ''}</div>${art(game, 'game-heading-art', false)}</section>
    <div class="coverage-bar"><div><span class="coverage-status status-${h(game.poll_status || 'awaiting')}"><i class="status-dot ${game.poll_status === 'ready' ? 'is-running' : ''}"></i>${h(coverageText(game))}</span>${game.last_polled_at ? `<small>Последняя проверка: ${h(formatDate(game.last_polled_at, true))}</small>` : '<small>Первые данные могут появиться не сразу.</small>'}${!added && !game.seed ? '<small>Добавьте игру в библиотеку, чтобы запустить проверку.</small>' : ''}</div><button class="button small secondary" type="button" data-action="refresh" data-app-id="${game.app_id}" ${!added && !game.seed ? 'disabled title="Сначала добавьте игру в библиотеку"' : ''}>${icon('refresh')}Проверить</button></div>
    <div class="section-heading timeline-heading"><h2>История событий</h2>${game.build_id ? `<span class="subtle">Публичный билд ${h(game.build_id)}</span>` : ''}</div><p class="timeline-intro">Публикации разработчика и замеченные изменения билдов. Для этой игры сохраняем доступные данные; полная история Steam может быть недоступна.</p>
    ${eventId && !selectedFound ? '<div class="notice">Этого события ещё нет на загруженной странице. Загрузите следующую часть истории ниже.</div>' : ''}
    <div class="timeline">${events.length ? events.map(event => eventCard(event, String(event.id) === eventId, languages[String(event.id)] || 'ru')).join('') : emptyState(game.poll_status === 'awaiting' ? 'Ожидаем первую проверку' : 'Сохранённых событий пока нет', game.poll_status === 'awaiting' ? 'Игра добавлена в очередь. Можно настроить уведомления; история появится после получения данных.' : 'Источник ещё не дал доступных событий. Попробуйте проверить игру снова.')}</div>
    ${pagination.has_more ? `<div class="load-more"><button class="button secondary" type="button" data-action="more" ${paginationLoading ? 'disabled' : ''}>${paginationLoading ? 'Загружаем…' : 'Ещё из истории'}</button></div>` : ''}`;
}

export function settingsPage(game) {
  const prefs = { ...DEFAULT_PREFS, ...game.preferences };
  return `<a class="back-link" href="#game/${game.app_id}">${icon('arrow')}${h(game.name)}</a>${pageHeader('Настройки уведомлений', 'Для ' + game.name)}
    <form id="preferences-form" class="preferences-form" data-app-id="${game.app_id}"><section class="settings-section"><label class="switch-row"><div><strong>Получать уведомления</strong><p>Выключение сохраняет игру в библиотеке и не скрывает историю.</p></div><input name="enabled" type="checkbox" ${prefs.enabled ? 'checked' : ''}><span class="switch-visual" aria-hidden="true"></span></label></section>
    <section class="settings-section"><h2>Что присылать</h2><div class="mode-grid">${MODES.map(mode => `<label class="mode-option"><input type="radio" name="mode" value="${mode.id}" ${prefs.mode === mode.id ? 'checked' : ''}><div><strong>${h(mode.name)}${mode.id === 'updates' ? '<span class="recommended-label">Рекомендуем</span>' : ''}</strong><p>${h(mode.text)}</p></div></label>`).join('')}</div>
    <div id="custom-types" class="custom-types" ${prefs.mode !== 'custom' ? 'hidden' : ''}><h3>Типы событий</h3>${[['patches', 'Патчи и исправления'], ['news', 'Официальные новости'], ['builds', 'Новые публичные билды']].map(([name, label]) => `<label class="check-row"><input type="checkbox" name="${name}" ${prefs[name] ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
    <div id="severity-note" class="notice severity-note" ${!['major', 'medium', 'minor'].includes(prefs.mode) ? 'hidden' : ''}>Классификация по крупности ещё не работает: у текущих публикаций категория неизвестна. Без неоценённых публикаций уведомления в этом режиме пока не придут.</div>
    <label class="check-row unknown-option"><input type="checkbox" name="include_unknown" ${prefs.include_unknown ? 'checked' : ''}><div><strong>Включать публикации без оценки крупности</strong><p>В режимах «крупные», «средние» и «мелкие» они придут дополнительно к выбранной категории. Это не означает, что они относятся к ней.</p></div></label>
    <div id="noise-warning" class="notice noise-warning" ${prefs.mode !== 'all' && !(prefs.mode === 'custom' && prefs.builds) ? 'hidden' : ''}>Возможны частые уведомления. Новый билд может оказаться техническим изменением без понятного игроку содержания.</div></section>
    <section class="settings-section"><h2>Когда присылать</h2><label class="timing-option"><input name="timing" type="radio" value="described" ${prefs.timing === 'described' ? 'checked' : ''}><div><strong>Когда есть описание разработчика</strong><p>Пропускаем технические билды. Публикации без текста ждут последующей проверки. Если текст не появится, уведомления не будет. Полноту информации этот режим не гарантирует.</p></div></label><label class="timing-option"><input name="timing" type="radio" value="fast" ${prefs.timing === 'fast' ? 'checked' : ''}><div><strong>Сразу после обнаружения</strong><p>Показываем выбранные типы событий с доступными на тот момент данными. Содержание может появиться позже.</p></div></label><p id="build-timing-note" class="subtle" ${(prefs.mode !== 'all' && !prefs.builds) || prefs.timing !== 'described' ? 'hidden' : ''}>Билды выбраны, но в режиме «Когда есть описание разработчика» уведомления о них пропускаются.</p></section>
    <div class="settings-save"><div id="preferences-message" role="status" aria-live="polite"></div><button class="button primary" type="submit">Сохранить настройки</button></div></form><div class="remove-game"><button class="button danger" type="button" data-action="remove" data-app-id="${game.app_id}">Убрать из библиотеки</button><p>Уведомления по этой игре прекратятся. Сохранённая история останется доступна; игру можно добавить снова.</p></div>`;
}

export function inboxPage(result, profile = {}, config = {}) {
  const deliveryText = profile.local_only === false ? profile.telegram_delivery_enabled ? 'Новые уведомления также отправляются в Telegram. История сообщений остаётся здесь.' : 'Уведомления сохраняются здесь. Доставку в Telegram можно включить по своему выбору.' : 'Уведомления этого локального профиля приходят сюда. Для доставки в Telegram откройте приложение через бота.';
  return `${pageHeader('Уведомления', 'События, которые прошли ваши настройки.', result.unread_count ? '<button class="button secondary" type="button" data-action="read">Отметить прочитанными</button>' : '')}${deliveryControls(profile, config)}<div class="delivery-note"><span class="note-mark" aria-hidden="true">i</span><p>${h(deliveryText)}</p></div>${result.items?.length ? `<div class="inbox-list">${result.items.map(item => `<article class="inbox-item ${item.read ? '' : 'is-unread'}"><div class="inbox-marker" aria-hidden="true"></div><div class="inbox-content"><div class="event-meta"><a class="inbox-game" href="#game/${item.event.app_id}">${h(item.event.game_name)}</a><time>${h(formatDate(item.created_at, true))}</time></div><h2><a href="${eventRoute(item.event)}">${h(publicationLanguage(item.event).title)}</a></h2><p>${h(excerpt(publicationLanguage(item.event).contents, 180) || (item.event.kind === 'public_build_changed' ? 'Замечено изменение публичного билда.' : 'Откройте публикацию для подробностей.'))}</p><div class="inbox-reason">${icon('settings')}<span>${h(item.reason || 'Соответствует настройкам игры.')}</span><a href="#settings/${item.event.app_id}">Изменить</a></div></div></article>`).join('')}</div>` : emptyState('Пока тихо', 'Новые события появятся здесь после обнаружения, если они подходят под ваши настройки. Старые публикации при добавлении игры не считаются новыми уведомлениями.', '<a class="button secondary" href="#library">Посмотреть библиотеку</a>')}`;
}
