/**
 * @fileoverview Скрипты сайта автосервиса (ул. Доватора, 21, Ростов-на-Дону):
 * статус работы по московскому времени, мобильное меню, сворачивание отзывов,
 * лайтбокс галереи, подсветка активного пункта навигации.
 *
 * Стандарт: ES2019+, без зависимостей. Прогрессивное улучшение:
 * при отключённом JS страница остаётся полностью работоспособной.
 */

'use strict';

/* ============================================================
 * Типы (JSDoc)
 * ============================================================ */

/**
 * День недели: 0 — воскресенье, 1 — понедельник, …, 6 — суббота.
 * @typedef {0|1|2|3|4|5|6} WeekdayIndex
 */

/**
 * Расписание работы сервиса (местное время объекта, Москва: UTC+3).
 * @typedef {Object} Schedule
 * @property {number} openMin  Время открытия в минутах от полуночи (09:00 → 540).
 * @property {number} closeMin Время закрытия в минутах от полуночи (18:00 → 1080).
 * @property {ReadonlyArray<WeekdayIndex>} closedDays Дни, когда сервис не работает.
 */

/**
 * Текущие «московские» дата/время.
 * @typedef {Object} MoscowNow
 * @property {WeekdayIndex} weekday День недели.
 * @property {number} minutes Минуты от полуночи.
 */

/* ============================================================
 * Константы
 * ============================================================ */

/**
 * График из карточки организации: пн–сб 09:00–18:00, вс — выходной.
 * Источник: meta openingHours (Mo–Sa 09:00-18:00) карточки Яндекс Карт.
 * @type {Readonly<Schedule>}
 */
const SCHEDULE = Object.freeze({
    openMin: 9 * 60,
    closeMin: 18 * 60,
    closedDays: Object.freeze([0]),
});

/** Названия дней недели в родительном падеже (для фразы «в понедельник»). */
const WEEKDAY_GENITIVE = [
    'в воскресенье',
    'в понедельник',
    'во вторник',
    'в среду',
    'в четверг',
    'в пятницу',
    'в субботу',
];

/** Коды дней недели, возвращаемые Intl.DateTimeFormat в locale 'en-US'. */
const WEEKDAY_CODE_TO_INDEX = Object.freeze({
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
});

/** Часовой пояс сервиса (карточка указывает tzOffset = 10800 = UTC+3). */
const SERVICE_TIMEZONE = 'Europe/Moscow';

/* ============================================================
 * Утилиты
 * ============================================================ */

/**
 * Возвращает текущий день недели и минуты от полуночи в часовом поясе сервиса.
 * Использует Intl с часовым поясом, поэтому результат не зависит
 * от локального часового пояса посетителя.
 *
 * @returns {MoscowNow|null} Текущее время или null, если Intl недоступен.
 */
function getMoscowNow() {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: SERVICE_TIMEZONE,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(new Date());

        /** @type {Record<string, string>} */
        const map = {};
        for (const part of parts) {
            if (part.type !== 'literal') map[part.type] = part.value;
        }

        const weekday = WEEKDAY_CODE_TO_INDEX[map.weekday];
        if (weekday === undefined) return null;

        const hour = Number.parseInt(map.hour, 10);
        const minute = Number.parseInt(map.minute, 10);
        if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

        return /** @type {MoscowNow} */ ({ weekday, minutes: hour * 60 + minute });
    } catch (err) {
        console.warn('[open-status] не удалось определить время:', err);
        return null;
    }
}

/**
 * Проверяет, работает ли сервис в указанный момент.
 *
 * @param {MoscowNow} now Текущее время сервиса.
 * @returns {boolean} true, если сервис открыт.
 */
function isOpenAt(now) {
    if (SCHEDULE.closedDays.includes(now.weekday)) return false;
    return now.minutes >= SCHEDULE.openMin && now.minutes < SCHEDULE.closeMin;
}

/**
 * Формирует человекочитаемый текст статуса работы.
 *
 * @param {MoscowNow} now Текущее время сервиса.
 * @returns {string} Текст статуса, например «Открыто до 18:00».
 */
function buildStatusText(now) {
    const fmtMinutes = String(Math.floor(SCHEDULE.openMin / 60)).padStart(2, '0')
        + ':' + String(SCHEDULE.openMin % 60).padStart(2, '0');
    const closeText = String(Math.floor(SCHEDULE.closeMin / 60)).padStart(2, '0')
        + ':' + String(SCHEDULE.closeMin % 60).padStart(2, '0');

    if (isOpenAt(now)) {
        return `Открыто до ${closeText}`;
    }

    // Ищем ближайший рабочий день (сегодня с учётом времени, затем вперёд до недели).
    for (let offset = 0; offset <= 7; offset += 1) {
        const day = /** @type {WeekdayIndex} */ ((now.weekday + offset) % 7);
        if (SCHEDULE.closedDays.includes(day)) continue;

        if (offset === 0 && now.minutes < SCHEDULE.openMin) {
            return `Закрыто · откроется сегодня в ${fmtMinutes}`;
        }
        if (offset === 1) {
            return `Закрыто · откроется завтра в ${fmtMinutes}`;
        }
        if (offset > 1) {
            return `Закрыто · откроется ${WEEKDAY_GENITIVE[day]} в ${fmtMinutes}`;
        }
    }

    /* c unreachable: цикл покрывает полный недельный цикл. Запасной вариант. */
    return `пн–сб ${fmtMinutes}–${closeText}`;
}

/**
 * Обновляет виджет статуса работы в шапке героя.
 * При недоступности Intl оставляет статичный текст из разметки.
 *
 * @returns {void}
 */
function initOpenStatus() {
    const el = document.getElementById('open-status');
    if (!el) return;

    const now = getMoscowNow();
    if (!now) return; // остаётся статичный текст «пн–сб 09:00–18:00»

    el.textContent = buildStatusText(now);
    const wrapper = el.closest('.hero-status');
    if (wrapper) wrapper.classList.toggle('is-closed', !isOpenAt(now));
}

/* ============================================================
 * Мобильное меню
 * ============================================================ */

/**
 * Подключает бургер-меню для узких экранов.
 * Состояние синхронизируется с aria-expanded; при resize выше 760px
 * меню принудительно закрывается.
 *
 * @returns {void}
 */
function initNav() {
    const burger = document.getElementById('nav-burger');
    const nav = document.getElementById('site-nav');
    if (!burger || !nav) return;

    /**
     * Закрывает меню.
     * @returns {void}
     */
    const close = () => {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-label', 'Открыть меню');
    };

    burger.addEventListener('click', () => {
        const open = burger.getAttribute('aria-expanded') === 'true';
        if (open) {
            close();
        } else {
            nav.classList.add('is-open');
            burger.setAttribute('aria-expanded', 'true');
            burger.setAttribute('aria-label', 'Закрыть меню');
        }
    });

    nav.addEventListener('click', (event) => {
        if (event.target instanceof HTMLAnchorElement) close();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 760) close();
    });
}

/* ============================================================
 * Активный пункт навигации (scrollspy)
 * ============================================================ */

/**
 * Подсвечивает пункт навигации, соответствующий видимой секции.
 * Если IntersectionObserver недоступен — функция безопасно завершается.
 *
 * @returns {void}
 */
function initScrollSpy() {
    if (typeof IntersectionObserver !== 'function') return;

    const nav = document.getElementById('site-nav');
    if (!nav) return;

    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    const sections = links
        .map((link) => document.getElementById(link.hash.slice(1)))
        .filter((sec) => sec !== null);
    if (sections.length === 0) return;

    /** @type {Map<Element, HTMLAnchorElement>} */
    const bySection = new Map();
    links.forEach((link) => {
        const sec = document.getElementById(link.hash.slice(1));
        if (sec) bySection.set(sec, link);
    });

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            links.forEach((l) => l.classList.remove('is-active'));
            const active = bySection.get(entry.target);
            if (active) active.classList.add('is-active');
        }
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

    sections.forEach((sec) => observer.observe(sec));
}

/* ============================================================
 * Отзывы: раскрытие полного списка
 * ============================================================ */

/**
 * Подключает кнопку «Показать все 18 отзывов».
 * Без JS список раскрыт полностью (кнопка скрыта CSS-ом).
 *
 * @returns {void}
 */
function initReviewsToggle() {
    const btn = document.getElementById('reviews-toggle');
    const list = document.getElementById('reviews-list');
    if (!btn || !list) return;

    const total = list.querySelectorAll('.review-item').length;
    const visibleBefore = 6;

    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        if (expanded) {
            list.classList.remove('is-expanded');
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = `Показать все ${total} отзывов`;
            list.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            list.classList.add('is-expanded');
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = 'Свернуть список';
        }
    });

    // Доступность: если отзывов не больше видимого количества — кнопка не нужна.
    if (total <= visibleBefore) btn.hidden = true;
}

/* ============================================================
 * Лайтбокс галереи
 * ============================================================ */

/**
 * Подключает лайтбокс: открытие по клику/Enter, навигация стрелками,
 * закрытие по Esc/кнопке/фону, возврат фокуса на исходную кнопку.
 *
 * @returns {void}
 */
function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const imgEl = document.getElementById('lightbox-img');
    const counterEl = document.getElementById('lightbox-counter');
    const closeBtn = document.getElementById('lightbox-close');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    const items = Array.from(document.querySelectorAll('.gallery-item'));

    if (!lightbox || !imgEl || !counterEl || !closeBtn || !prevBtn || !nextBtn) return;
    if (items.length === 0) return;

    /** Исходная кнопка — для возврата фокуса после закрытия. @type {HTMLElement|null} */
    let opener = null;
    /** Текущий индекс фото. @type {number} */
    let index = 0;

    /**
     * Источники изображений в порядке галереи.
     * @type {string[]}
     */
    const sources = items.map((btn) => {
        const img = btn.querySelector('img');
        return img ? img.src : '';
    }).filter((src) => src !== '');

    /**
     * Показывает фото по индексу с проверкой границ.
     * @param {number} next Индекс фото.
     * @returns {void}
     */
    const show = (next) => {
        index = (next + sources.length) % sources.length;
        imgEl.src = sources[index];
        counterEl.textContent = `${index + 1} / ${sources.length}`;
    };

    /**
     * Открывает лайтбокс.
     * @param {HTMLElement} from Кнопка-источник.
     * @param {number} startIndex Индекс фото.
     * @returns {void}
     */
    const open = (from, startIndex) => {
        opener = from;
        show(startIndex);
        lightbox.hidden = false;
        document.body.classList.add('lightbox-open');
        closeBtn.focus();
    };

    /**
     * Закрывает лайтбокс и возвращает фокус.
     * @returns {void}
     */
    const close = () => {
        lightbox.hidden = true;
        document.body.classList.remove('lightbox-open');
        imgEl.src = '';
        if (opener && typeof opener.focus === 'function') opener.focus();
        opener = null;
    };

    items.forEach((btn, i) => {
        btn.addEventListener('click', () => open(btn, i));
    });

    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', () => show(index - 1));
    nextBtn.addEventListener('click', () => show(index + 1));

    lightbox.addEventListener('click', (event) => {
        if (event.target === lightbox) close();
    });

    document.addEventListener('keydown', (event) => {
        if (lightbox.hidden) return;
        if (event.key === 'Escape') close();
        if (event.key === 'ArrowLeft') show(index - 1);
        if (event.key === 'ArrowRight') show(index + 1);
    });
}

/* ============================================================
 * Инициализация
 * ============================================================ */

/**
 * Точка входа. Каждый модуль инициализируется независимо:
 * сбой одного не ломает остальные.
 *
 * @returns {void}
 */
function initApp() {
    const modules = [
        initOpenStatus,
        initNav,
        initScrollSpy,
        initReviewsToggle,
        initLightbox,
    ];

    for (const module of modules) {
        try {
            module();
        } catch (err) {
            console.error(`[site] ошибка в модуле ${module.name}:`, err);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

function initReviewsQuick(){const b=document.getElementById('reviews-show-all'); const l=document.getElementById('reviews-list'); if(!b||!l)return; b.addEventListener('click',function(){l.classList.add('is-expanded'); const t=document.getElementById('reviews-toggle'); if(t){t.setAttribute('aria-expanded','true');t.textContent='Свернуть список'; t.hidden=true} b.hidden=true})}
try{document.addEventListener('DOMContentLoaded',initReviewsQuick)}catch(e){}

