import { escapeHtml as h, formatDate, selectEvents, wouldNotify, eventCountLabel } from './model.mjs';

export function icon(name) {
  const paths = {
    game: '<path d="M7 7h10l4 10-3 2-4-4h-4l-4 4-3-2 4-10Z"/><path d="M7 11v4m-2-2h4m6-1h.01m2 2h.01"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>', back: '<path d="m14 5-7 7 7 7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7"/>',
    check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    build: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.game}</svg>`;
}

function kindLabel(event) {
  return event.kind === 'build' ? 'Билд' : event.kind === 'news' ? 'Новость' : event.severity === 'major' ? 'Большой патч' : event.severity === 'balance' ? 'Балансный патч' : 'Исправления';
}

function sourceLinks(event) {
  return (event.sourceLinks || []).flatMap(link => {
    try {
      const url = new URL(link.url);
      if (url.protocol !== 'https:' || url.username || url.password) return [];
      return [`<a class="secondary-button source-link" href="${h(url.href)}" target="_blank" rel="noopener noreferrer">${h(link.label)}</a>`];
    } catch { return []; }
  }).join('');
}

function eventRow(event, preferences) {
  return `<button type="button" class="event-row" data-event="${h(event.id)}">
    <span class="event-icon ${event.kind}">${icon(event.kind === 'build' ? 'build' : event.kind === 'news' ? 'clock' : 'game')}</span>
    <span class="event-body"><span class="event-meta">${h(kindLabel(event))}<span>${h(formatDate(event.detectedAt))}</span></span>
      <strong>${h(event.title)}</strong><span class="event-summary">${h(event.summary)}</span>
      <span class="event-footer">${event.demo ? 'Пример' : h(event.source)}${wouldNotify(event, preferences) ? '<span>Выбран фильтром</span>' : ''}</span>
    </span><span class="row-arrow">${icon('arrow')}</span></button>`;
}

function detail(state, event) {
  return `<section class="detail" aria-labelledby="detail-title">
    <button type="button" class="text-button back-button" data-action="back">${icon('back')}Назад к игре</button>
    <div class="detail-heading"><span class="category">${h(kindLabel(event))}${event.demo ? ' · Пример' : ''}</span>
      <h1 id="detail-title" tabindex="-1">${h(event.title)}</h1><p class="subtle">${h(formatDate(event.detectedAt))} · ${h(event.source)}</p></div>
    <p class="detail-lead">${h(event.summary)}</p>
    <div class="tag-list">${event.tags.map(tag => `<span>${h(tag)}</span>`).join('')}</div>
    ${event.details.map(text => `<p class="detail-paragraph">${h(text)}</p>`).join('')}
    ${event.kind === 'build' ? `<dl class="build-detail"><div><dt>Предыдущий билд</dt><dd>${h(event.oldBuild)}</dd></div><div><dt>Новый билд</dt><dd>${h(event.newBuild)}</dd></div></dl>` : ''}
    ${sourceLinks(event)}
    <aside class="notice">${event.reference ? 'Это настоящий патч, добавленный вручную для показа интерфейса. Дата — время официальной публикации, не обнаружения нашим сервисом. Приложение ещё не обновляет эту сводку автоматически.' : event.demo ? 'Это выдуманный пример для обсуждения экрана, не настоящий патч.' : 'Описания официальных обновлений ещё не подключены к этому экрану.'}</aside>
    <button type="button" class="secondary-button" data-action="settings">${icon('bell')}Настроить, что получать</button>
  </section>`;
}

function feed(state) {
  if (state.loading) return '<section class="empty-state" role="status"><div class="loading-dot"></div><h2>Загружаю события…</h2><p>Читаю локальную лабораторию.</p></section>';
  if (state.error) return `<section class="empty-state"><h2>Не удалось получить данные</h2><p>${h(state.error)}</p>
    <button class="primary-button" data-action="refresh">Попробовать ещё раз</button><button class="text-button" data-action="demo">Посмотреть примеры</button></section>`;
  const events = selectEvents(state.events, state.game.id, state.tab, state.since);
  const featured = state.tab === 'important' ? events[0] : null;
  return `<section class="feed" aria-label="События игры">
    ${state.tab === 'since' ? `<p class="context-note">${state.since ? `После ${h(formatDate(state.since))}. История визитов хранится на этом устройстве.` : 'Первый визит в этом режиме — показываем доступную историю.'}</p>` : ''}
    ${featured ? `<button type="button" class="featured-event" data-event="${h(featured.id)}">
      <span class="category">${featured.reference ? 'Настоящий патч · добавлен вручную' : `Последнее важное${featured.demo ? ' · Пример' : ''}`}</span><h2>${h(featured.title)}</h2>
      <p>${h(featured.summary)}</p><div class="tag-list">${featured.tags.map(tag => `<span>${h(tag)}</span>`).join('')}</div>
      <span class="featured-bottom">${h(formatDate(featured.detectedAt))}<span>Посмотреть изменения ${icon('arrow')}</span></span></button>` : ''}
    <div class="section-title"><h2>${state.tab === 'important' ? 'Ранее' : state.tab === 'since' ? 'Что появилось' : 'История событий'}</h2><span>${eventCountLabel(featured ? events.length - 1 : events.length)}</span></div>
    ${events.length ? `<div class="event-list">${(featured ? events.slice(1) : events).map(event => eventRow(event, state.preferences)).join('') || '<p class="context-note">Других важных обновлений в этой выборке нет.</p>'}</div>`
      : `<div class="empty-state"><span class="empty-icon">${icon('clock')}</span><h3>${state.tab === 'since' ? 'Новых событий в выборке нет' : state.tab === 'important' ? 'Подтверждённых патчей здесь пока нет' : 'В выборке пока нет событий'}</h3>
        <p>${state.mode === 'lab' ? 'Этот экран читает последние 100 событий лаборатории по всем играм. Пока подключены только реальные смены билда; это не полная история патчей.' : 'Попробуй другую вкладку или вернись позже.'}</p>
        ${state.tab === 'important' ? '<button class="text-button" data-tab="all">Посмотреть все события</button>' : ''}</div>`}
    ${state.mode === 'lab' && events.length ? '<p class="context-note">Показаны события Dota из последних 100 событий лаборатории. Официальные публикации ещё не подключены.</p>' : ''}
  </section>`;
}

function settings(state) {
  const p = state.draft;
  const presets = [
    ['updates', 'Обновления', 'Патчи и исправления, без технического шума.'],
    ['all', 'Всё подряд', 'Патчи, новости и каждый доступный сигнал билда.'],
    ['major', 'Только крупное', 'Только патчи с подтверждёнными большими изменениями.'],
    ['custom', 'Свой режим', 'Выбери нужные типы событий самостоятельно.'],
  ];
  const matched = state.events.filter(event => wouldNotify(event, p));
  return `<section class="settings" aria-labelledby="settings-title"><div class="page-heading"><span class="category">${h(state.game.name)}</span><h1 id="settings-title" tabindex="-1">Что тебе присылать?</h1><p>Меньше шума. Больше нужного.</p></div>
    <aside class="notice">Настраиваем будущие уведомления. Сейчас выбор сохраняется только на этом устройстве и не меняет работу Telegram-бота.</aside>
    <label class="toggle-line"><span><strong>Получать уведомления</strong><small>Черновая настройка для этой игры</small></span><input type="checkbox" data-setting="enabled" ${p.enabled ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
    <fieldset class="presets"><legend>Режим уведомлений</legend>${presets.map(([id, title, description]) => `<label class="preset ${p.preset === id ? 'selected' : ''}"><input type="radio" name="preset" value="${id}" ${p.preset === id ? 'checked' : ''}><span><strong>${title}</strong><small>${description}</small></span><span class="radio-mark" aria-hidden="true"></span></label>`).join('')}</fieldset>
    ${p.preset === 'all' ? '<p class="warning-note">Билды могут меняться часто. Этот режим способен присылать много сообщений.</p>' : ''}
    ${p.preset === 'major' ? '<p class="warning-note">В макете этот режим можно попробовать. Надёжное определение размера настоящего патча ещё не подключено.</p>' : ''}
    ${p.preset === 'custom' ? `<fieldset class="custom-options"><legend>Типы событий</legend>${[['patches', 'Патчи и исправления'], ['builds', 'Смены публичного билда'], ['news', 'Новости разработчиков']].map(([key, label]) => `<label><input type="checkbox" data-setting="${key}" ${p[key] ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>` : ''}
    <fieldset class="speed-options"><legend>Скорость или подробности?</legend><label><input type="radio" name="speed" value="fast" ${p.speed === 'fast' ? 'checked' : ''}><span><strong>Быстрый сигнал</strong><small>Как только заметили событие, даже без описания.</small></span></label><label><input type="radio" name="speed" value="detailed" ${p.speed === 'detailed' ? 'checked' : ''}><span><strong>Дождаться подробностей</strong><small>Получить сообщение, когда появится проверенное описание.</small></span></label></fieldset>
    <div class="filter-preview"><div><h2>Как сработает фильтр</h2><span>${matched.length} из ${state.events.length} ${state.mode === 'demo' ? 'примеров' : 'событий выборки'}</span></div><p>${matched.length ? matched.map(event => h(event.title)).join('<br>') : 'В этой выборке ничего не подходит.'}</p><small>Это проверка типов событий, не прогноз частоты или сроков доставки.</small></div>
    <button type="button" class="primary-button save-button" data-action="save">${icon('check')}Сохранить на этом устройстве</button>
    ${state.toast ? `<p class="save-status" role="status">${h(state.toast)}</p>` : ''}
  </section>`;
}

export function renderApp(state) {
  const event = state.events.find(item => item.id === state.eventId);
  return `<div class="app-shell"><header class="app-header"><a class="brand" href="#game"><span class="brand-symbol" aria-hidden="true">g<span>•</span></span><span>Игровые обновления<small>Первый интерфейс</small></span></a>
    ${state.demoOnly ? '<span class="prototype-label">Прототип</span>' : `<label class="mode-select"><span class="sr-only">Источник данных</span><select id="data-mode"><option value="demo" ${state.mode === 'demo' ? 'selected' : ''}>Примеры</option><option value="lab" ${state.mode === 'lab' ? 'selected' : ''}>Лаборатория</option></select></label>`}</header>
    <main id="main-content"><div class="mode-banner ${state.mode} ${state.mode === 'lab' && !state.loading && !state.error && state.lab?.healthy ? 'connected' : ''}"><span class="status-dot"></span><span>${state.mode === 'demo' ? 'Прототип. Патч 7.41f настоящий; остальные события выдуманы.' : state.loading ? 'Подключаю лабораторию…' : state.error ? 'Лаборатория недоступна. Примеры не подставляются.' : `Реальные билды · ${state.lab?.healthy ? 'система работает' : 'наблюдение требует проверки'}`}</span></div>
    ${state.page === 'settings' ? settings(state) : event ? detail(state, event) : `<section class="game-hero" aria-labelledby="game-title"><div class="game-art"><img src="${h(new URL('./assets/dota2-logo.png', import.meta.url).href)}" alt="Оригинальный логотип Dota 2" width="128" height="128"></div>
      <div class="game-heading"><span class="platform-label">Steam</span><h1 id="game-title" tabindex="-1">${h(state.game.name)}</h1><p>${h(state.game.subtitle)}</p><button type="button" class="notification-button" data-action="settings">${icon('bell')}Мои уведомления ${icon('arrow')}</button></div>
      <div class="game-facts"><span>Публичный билд</span><strong>${h(state.mode === 'demo' ? 'Пример' : state.lab?.buildId || 'Нет данных')}</strong><small>${state.mode === 'lab' && state.lab?.observedAt ? `Замечен ${h(formatDate(state.lab.observedAt))}` : 'Описания дополнят ранний сигнал'}</small></div></section>
      <nav class="event-tabs" aria-label="Разделы событий">${[['important', 'Важное'], ['all', 'Все события'], ['since', 'С прошлого визита']].map(([id, label]) => `<button type="button" data-tab="${id}" ${state.tab === id ? 'aria-current="page" class="active"' : ''}>${label}</button>`).join('')}<button type="button" class="refresh-button" data-action="refresh" aria-label="Обновить события" ${state.loading ? 'disabled' : ''}>${icon('refresh')}</button></nav>${feed(state)}`}
    </main><footer class="app-footer"><span>Сначала Dota. Остальные игры — следующий этап.</span><span>${state.demoOnly ? 'Демонстрационный' : 'Локальный'} прототип · не сервис Valve</span></footer>
    <nav class="bottom-nav" aria-label="Основная навигация"><a href="#game" ${state.page === 'game' ? 'aria-current="page"' : ''}>${icon('game')}<span>${h(state.game.name)}</span></a><a href="#settings" ${state.page === 'settings' ? 'aria-current="page"' : ''}>${icon('bell')}<span>Уведомления</span></a></nav></div>`;
}
