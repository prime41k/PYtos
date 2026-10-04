--- ui.js (原始)


+++ ui.js (修改后)
// ============================================================
// PyOS Studio 5.0 Quantum · UI
// Оконный менеджер, рабочий стол, панель задач, Пуск, трей,
// командная палитра, контекстные меню, тосты, OOBE, Boot
// ============================================================

(() => {
  'use strict';
  if (window.__PYOS_UI__) return;
  window.__PYOS_UI__ = true;

  /** Ожидание готовности ядра — без setTimeout-хаков. */
  const waitCore = new Promise((resolve) => {
    if (window.PyOSCore) resolve(window.PyOSCore);
    else window.addEventListener('pyos:core:ready', () => resolve(window.PyOSCore), { once: true });
  });

  // Ссылки на модули ядра заполняются после waitCore; до этого — через getter.
  let Core = null, Utils = null, Bus = null, Theme = null, Settings = null, Registry = null, Launcher = null, FileSystem = null, Jarvis = null;

  // ─────────────────────────────────────────────────────────
  // Module 1: IconRenderer
  // ─────────────────────────────────────────────────────────
  const IconRenderer = (() => {
    const KNOWN_CACHE = new Map();

    /** Есть ли символ с таким id в спрайте? */
    function existsInSprite(name) {
      if (KNOWN_CACHE.has(name)) return KNOWN_CACHE.get(name);
      const found = !!document.getElementById('ic-' + name);
      KNOWN_CACHE.set(name, found);
      return found;
    }

    /**
     * Цветная заглушка: SVG с градиентом по хешу имени + первая буква.
     * Никогда не «серая вилка».
     */
    function generateFallback(name, label) {
      const seed = Utils.hashStr(name || label || 'x');
      const hueA = seed % 360;
      const hueB = (hueA + 70) % 360;
      const gradId = 'fg-' + seed.toString(36);
      const letter = String(label || name || '?').trim().charAt(0).toUpperCase();
      const svg = Utils.h('svg', { class: 'py-ic py-ic-gen', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        Utils.h('defs', {},
          Utils.h('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '1', y2: '1' },
            Utils.h('stop', { offset: '0', 'stop-color': `hsl(${hueA} 85% 62%)` }),
            Utils.h('stop', { offset: '1', 'stop-color': `hsl(${hueB} 85% 45%)` })
          )
        ),
        Utils.h('rect', { x: '1', y: '1', width: '22', height: '22', rx: '6', fill: `url(#${gradId})` }),
        Utils.h('text', { x: '12', y: '16.5', 'text-anchor': 'middle', 'font-size': '13' }, letter)
      );
      return svg;
    }

    /** Добавляет недостающий символ прямо в спрайт (на лету). */
    function ensureInSprite(name, pathD) {
      if (existsInSprite(name)) return true;
      const sprite = document.querySelector('svg[aria-hidden="true"]');
      if (!sprite || !pathD) return false;
      const symbol = Utils.h('symbol', { id: 'ic-' + name, viewBox: '0 0 24 24' },
        Utils.h('path', { d: pathD }));
      sprite.append(symbol);
      KNOWN_CACHE.set(name, true);
      return true;
    }

    /**
     * Иконка по имени: <svg><use href="#ic-name"/></svg>,
     * при отсутствии — цветная заглушка.
     * @param {string} name
     * @param {Object} [opts] { size:'sm'|'lg'|'xl', label:string }
     */
    function get(name, opts = {}) {
      const sizeClass = opts.size ? ' py-ic--' + opts.size : '';
      if (name && existsInSprite(name)) {
        return Utils.h('svg', { class: 'py-ic' + sizeClass, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
          Utils.h('use', { href: '#ic-' + name }));
      }
      const fallback = generateFallback(name, opts.label || name);
      fallback.setAttribute('class', 'py-ic py-ic-gen' + sizeClass);
      return fallback;
    }

    return Object.freeze({ get, existsInSprite, ensureInSprite, generateFallback, invalidateCache: () => KNOWN_CACHE.clear() });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 2: Windows (оконный менеджер)
  // ─────────────────────────────────────────────────────────
  const Windows = (() => {
    /** @type {Map<string,Object>} appId+seq → handle */
    const wins = new Map();
    let zTop = 20;
    let seq = 0;
    let focusedId = null;

    const DOCK_GAP = 84;

    /** Каскадная стартовая позиция нового окна. */
    function nextPosition(width, height) {
      const count = wins.size;
      const baseX = Math.max(12, (window.innerWidth - width) / 2);
      const baseY = Math.max(12, (window.innerHeight - height) / 2 - 40);
      const offset = (count % 6) * 26;
      return {
        x: Utils.clamp(baseX + offset - 60, 8, window.innerWidth - width - 8),
        y: Utils.clamp(baseY + offset - 40, 8, window.innerHeight - height - DOCK_GAP)
      };
    }

    /** Перетаскивание за заголовок. */
    function attachDrag(winEl, titlebarEl, handle) {
      let startX = 0, startY = 0, originX = 0, originY = 0, active = false;
      const onMove = (event) => {
        if (!active) return;
        const nx = Utils.clamp(originX + event.clientX - startX, -winEl.offsetWidth + 90, window.innerWidth - 90);
        const ny = Utils.clamp(originY + event.clientY - startY, 0, window.innerHeight - DOCK_GAP);
        handle.state.x = nx; handle.state.y = ny;
        winEl.style.left = nx + 'px';
        winEl.style.top = ny + 'px';
        updateSnapHint(event.clientX, event.clientY, handle);
      };
      const onUp = () => {
        if (!active) return;
        active = false;
        winEl.classList.remove('is-drag');
        document.body.classList.remove('is-windowing');
        removeSnapHint();
        applyPendingSnap(handle);
      };
      titlebarEl.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.py-wctl')) return;
        if (handle.state.max) return;
        active = true;
        startX = event.clientX; startY = event.clientY;
        originX = handle.state.x; originY = handle.state.y;
        winEl.classList.add('is-drag');
        document.body.classList.add('is-windowing');
        focus(handle.winId);
      });
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      handle.addDispose(() => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); });
    }

  /* Snap-ассист: 6 зон (лево/право/4 угла) */
    const SNAP_ZONES = [
      { id: 'left',   test: (x) => x < 60,                          rect: () => ({ l: 12, t: 12, r: window.innerWidth / 2, b: window.innerHeight - DOCK_GAP }) },
      { id: 'right',  test: (x, y, w) => x > w - 60,                rect: () => ({ l: window.innerWidth / 2, t: 12, r: window.innerWidth - 12, b: window.innerHeight - DOCK_GAP }) },
      { id: 'tl',     test: (x, y) => x < 90 && y < 60,             rect: () => ({ l: 12, t: 12, r: window.innerWidth / 2, b: window.innerHeight / 2 }) },
      { id: 'tr',     test: (x, y, w) => x > w - 90 && y < 60,      rect: () => ({ l: window.innerWidth / 2, t: 12, r: window.innerWidth - 12, b: window.innerHeight / 2 }) },
      { id: 'bl',     test: (x, y, w, h) => x < 90 && y > h - 140,  rect: () => ({ l: 12, t: window.innerHeight / 2, r: window.innerWidth / 2, b: window.innerHeight - DOCK_GAP }) },
      { id: 'br',     test: (x, y, w, h) => x > w - 90 && y > h - 140, rect: () => ({ l: window.innerWidth / 2, t: window.innerHeight / 2, r: window.innerWidth - 12, b: window.innerHeight - DOCK_GAP }) }
    ];
    let snapHintEl = null, pendingSnap = null;

    function updateSnapHint(x, y, handle) {
      const zone = SNAP_ZONES.find((z) => z.test(x, y, window.innerWidth, window.innerHeight));
      if (!zone) { removeSnapHint(); return; }
      pendingSnap = { zone, handle };
      const r = zone.rect();
      if (!snapHintEl) {
        snapHintEl = Utils.h('div', { class: 'py-snapzone', 'aria-hidden': 'true' });
        document.body.append(snapHintEl);
      }
      snapHintEl.style.setProperty('--sz-top', (r.t / window.innerHeight * 100) + '%');
      snapHintEl.style.setProperty('--sz-right', ((window.innerWidth - r.r) / window.innerWidth * 100) + '%');
      snapHintEl.style.setProperty('--sz-bottom', ((window.innerHeight - r.b) / window.innerHeight * 100) + '%');
      snapHintEl.style.setProperty('--sz-left', (r.l / window.innerWidth * 100) + '%');
    }
    function removeSnapHint() { snapHintEl?.remove(); snapHintEl = null; }
    function applyPendingSnap(handle) {
      if (!pendingSnap || pendingSnap.handle !== handle) { pendingSnap = null; return; }
      const { zone } = pendingSnap;
      pendingSnap = null;
      snap(handle.winId, zone.id);
    }

    /** Ресайз за края и углы (8 направлений). */
    function attachResize(winEl, handle) {
      for (const dir of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
        const grip = Utils.h('div', { class: 'py-resize', dataset: { dir }, 'aria-hidden': 'true' });
        winEl.append(grip);
        grip.addEventListener('pointerdown', (event) => {
          if (handle.state.max) return;
          event.stopPropagation();
          let active = true;
          const sx = event.clientX, sy = event.clientY;
          const sw = parseInt(winEl.style.width, 10), sh = parseInt(winEl.style.height, 10);
          const sl = handle.state.x, st = handle.state.y;
          focus(handle.winId);
          const onMove = (moveEvent) => {
            if (!active) return;
            const dx = moveEvent.clientX - sx, dy = moveEvent.clientY - sy;
            let nw = sw, nh = sh, nl = sl, nt = st;
            if (dir.includes('e')) nw = Math.max(handle.minW, sw + dx);
            if (dir.includes('s')) nh = Math.max(handle.minH, sh + dy);
            if (dir.includes('w')) { nw = Math.max(handle.minW, sw - dx); nl = sl + (sw - nw); }
            if (dir.includes('n')) { nh = Math.max(handle.minH, sh - dy); nt = st + (sh - nh); }
            winEl.style.width = nw + 'px'; winEl.style.height = nh + 'px';
            winEl.style.left = nl + 'px'; winEl.style.top = nt + 'px';
            Object.assign(handle.state, { x: nl, y: nt, w: nw, h: nh });
            Bus.emit('windows:resized', { id: handle.appId });
          };
          const onUp = () => { active = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
          window.addEventListener('pointermove', onMove, { passive: true });
          window.addEventListener('pointerup', onUp);
        });
      }
    }

    /**
     * Создать окно.
     * @param {{id?:string,title:string,icon?:string,width?:number,height?:number,single?:boolean}} opts
     * @returns {Object} handle { el, body, winId, appId, setTitle, setIcon, close, focus, minimize, maximize, snap, markDirty, markSaved, addDispose }
     */
    function create(opts) {
      const appId = opts.id || Utils.uuid();
      const allowMultiple = opts.single === false;
      if (!allowMultiple && wins.has(appId)) {
        const existing = wins.get(appId);
        if (existing && document.body.contains(existing.el)) { focus(existing.winId); return existing; }
      }
      const winId = appId + '#' + (++seq);
      const width = Utils.clamp(opts.width || 720, 320, window.innerWidth - 24);
      const height = Utils.clamp(opts.height || 520, 220, window.innerHeight - DOCK_GAP - 24);
      const pos = nextPosition(width, height);

      const winEl = Utils.h('div', {
        class: 'py-win sn-open-' + Utils.rnd(0, 5),
        role: 'dialog', 'aria-label': opts.title, tabindex: '-1',
        style: { left: pos.x + 'px', top: pos.y + 'px', width: width + 'px', height: height + 'px', zIndex: ++zTop }
      });

      const iconSlot = Utils.h('span', { class: 'py-flex' }, IconRenderer.get(opts.icon, { label: opts.title }));
      const titleEl = Utils.h('span', { class: 'py-wtitle py-trunc' }, opts.title);
      const dirtyDot = Utils.h('i', { class: 'py-wdot', title: 'статус сохранения' });

      const btnMin = Utils.h('button', { class: 'py-tbtn', 'aria-label': 'Свернуть', onclick: () => minimize(winId) }, IconRenderer.get('minus'));
      const btnMax = Utils.h('button', { class: 'py-tbtn', 'aria-label': 'Развернуть', onclick: () => maximize(winId) }, IconRenderer.get('square'));
      const btnClose = Utils.h('button', { class: 'py-tbtn', 'aria-label': 'Закрыть', onclick: () => close(winId) }, IconRenderer.get('close'));

      const titlebar = Utils.h('header', { class: 'py-titlebar' },
        iconSlot, titleEl, dirtyDot,
        Utils.h('div', { class: 'py-wctl' }, btnMin, btnMax, btnClose));

      const body = Utils.h('main', { class: 'py-wbody' });
      winEl.append(titlebar, body);

      const disposers = [];
      const handle = {
        el: winEl, body, winId, appId,
        disposers,
        state: { x: pos.x, y: pos.y, w: width, h: height, max: false, min: false, prev: null },
        minW: 320, minH: 200,
        setTitle(text) { titleEl.textContent = text; winEl.setAttribute('aria-label', text); Bus.emit('windows:title', { id: appId, title: text }); },
        setIcon(iconName) { iconSlot.replaceChildren(IconRenderer.get(iconName, { label: titleEl.textContent })); },
        markDirty() { dirtyDot.className = 'py-wdot is-dirty'; },
        markSaved() { dirtyDot.className = 'py-wdot is-saved'; },
        close: () => close(winId),
        focus: () => focus(winId),
        minimize: () => minimize(winId),
        maximize: () => maximize(winId),
        snap: (zone) => snap(winId, zone),
        addDispose(fn) { disposers.push(fn); }
      };

      titlebar.addEventListener('dblclick', () => maximize(winId));
      winEl.addEventListener('pointerdown', () => focus(winId), true);
      attachDrag(winEl, titlebar, handle);
      attachResize(winEl, handle);

      document.querySelector('.py-layer-win')?.append(winEl);
      wins.set(winId, handle);
      if (!allowMultiple) wins.set(appId, handle);

      winEl.addEventListener('animationend', () => winEl.classList.remove(...['sn-open-0','sn-open-1','sn-open-2','sn-open-3','sn-open-4','sn-open-5']), { once: true });

      focus(winId);
      Bus.emit('windows:opened', { id: appId, winId });
      return handle;
    }

    function focus(winId) {
      for (const [, handle] of wins) handle.el?.classList?.remove('is-focus');
      const handle = wins.get(winId);
      if (!handle) return;
      handle.el.style.zIndex = ++zTop;
      handle.el.classList.add('is-focus');
      handle.state.min = false;
      handle.el.classList.remove('is-min');
      focusedId = winId;
      Bus.emit('windows:focused', { id: handle.appId, winId });
    }

    function close(winId) {
      const handle = wins.get(winId);
      if (!handle) return;
      try { for (const fn of handle.disposers) fn(); } catch (err) { console.error('[PyOS][Windows] dispose:', err); }
      handle.el.classList.add('is-closing');
      handle.el.addEventListener('animationend', () => handle.el.remove(), { once: true });
      wins.delete(winId);
      if (wins.get(handle.appId) === handle) wins.delete(handle.appId);
      if (focusedId === winId) focusedId = null;
      Bus.emit('windows:closed', { id: handle.appId, winId });
    }

    function closeAll() { for (const [winId, handle] of [...wins]) if (handle.el) close(winId); }

    function minimize(winId) {
      const handle = wins.get(winId);
      if (!handle) return;
      handle.state.min = true;
      handle.el.classList.add('is-min');
      handle.el.classList.remove('is-focus');
      Bus.emit('windows:minimized', { id: handle.appId, winId });
    }

    function maximize(winId) {
      const handle = wins.get(winId);
      if (!handle) return;
      const s = handle.state, el = handle.el;
      if (s.max) {
        Object.assign(el.style, { left: s.prev.x + 'px', top: s.prev.y + 'px', width: s.prev.w + 'px', height: s.prev.h + 'px' });
        Object.assign(s, s.prev); s.max = false; s.prev = null;
        el.classList.remove('is-max');
      } else {
        s.prev = { x: s.x, y: s.y, w: parseInt(el.style.width, 10), h: parseInt(el.style.height, 10) };
        Object.assign(el.style, { left: '12px', top: '12px', width: (window.innerWidth - 24) + 'px', height: (window.innerHeight - DOCK_GAP - 12) + 'px' });
        s.x = 12; s.y = 12; s.max = true;
        el.classList.add('is-max');
      }
      Bus.emit('windows:maximized', { id: handle.appId, max: s.max });
    }

    /** Привязать окно к зоне: left|right|tl|tr|bl|br. */
    function snap(winId, zone) {
      const handle = wins.get(winId);
      if (!handle) return;
      const def = SNAP_ZONES.find((z) => z.id === zone);
      if (!def) return;
      const r = def.rect();
      const el = handle.el;
      Object.assign(el.style, { left: r.l + 'px', top: r.t + 'px', width: (r.r - r.l) + 'px', height: (r.b - r.t) + 'px' });
      Object.assign(handle.state, { x: r.l, y: r.t, w: r.r - r.l, h: r.b - r.t, max: false });
      Bus.emit('windows:snap', { id: handle.appId, zone });
    }

    /** Все окна приложения (для таскбара/бейджей). */
    function list() {
      const out = [];
      for (const [winId, handle] of wins) if (handle.el && winId.includes('#')) out.push({ winId, appId: handle.appId, minimized: handle.state.min, focused: focusedId === winId });
      return out;
    }
    function windowsOf(appId) { return list().filter((w) => w.appId === appId); }

    /** Развернуть/свернуть приложение из таскбара. */
    function toggleApp(appId) {
      const appWins = windowsOf(appId);
      if (!appWins.length) return false;
      const frontFocused = appWins.find((w) => w.focused);
      if (frontFocused) { minimize(frontFocused.winId); return true; }
      const firstMin = appWins.find((w) => w.minimized);
      focus(firstMin ? firstMin.winId : appWins[appWins.length - 1].winId);
      return true;
    }

    return Object.freeze({ create, close, closeAll, focus, minimize, maximize, snap, list, windowsOf, toggleApp, get: (winId) => wins.get(winId) });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 3: Desktop
  // ─────────────────────────────────────────────────────────
  const Desktop = (() => {
    let rootEl = null, iconsGrid = null, widgetsEl = null;
    const timers = new Set();

    /** Добавить ярлык приложения на стол. */
    function addIcon(appId) {
      const manifest = Registry.get(appId);
      if (!manifest || !iconsGrid) return;
      if (iconsGrid.querySelector(`[data-app="${appId}"]`)) return;
      const iconBtn = Utils.h('button', {
        class: 'py-deskicon', 'data-app': appId,
        'aria-label': 'Запустить ' + manifest.name, draggable: 'false'
      },
        IconRenderer.get(manifest.icon, { label: manifest.name }),
        Utils.h('span', {}, manifest.name));
      iconBtn.addEventListener('dblclick', () => Launcher.launch(appId));
      iconBtn.addEventListener('click', (event) => {
        Utils.$$('.py-deskicon.is-sel', iconsGrid).forEach((el) => el.classList.remove('is-sel'));
        iconBtn.classList.add('is-sel');
        event.stopPropagation();
      });
      iconBtn.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        ContextMenu.show(event.clientX, event.clientY, [
          { label: 'Открыть', icon: 'play', run: () => Launcher.launch(appId) },
          { label: 'Закрепить в Пуске', icon: 'pin', run: () => StartMenu.togglePin(appId) },
          '-',
          { label: 'Свернуть все окна', icon: 'minus', run: () => Windows.windowsOf(appId).forEach((w) => Windows.minimize(w.winId)) }
        ]);
      });
      iconsGrid.append(iconBtn);
    }

    function refreshIcons() {
      if (!iconsGrid) return;
      iconsGrid.replaceChildren();
      for (const manifest of Registry.list()) addIcon(manifest.id);
    }

    /** Виджеты: часы, дата, псевдо-производительность. */
    function buildWidgets() {
      const clockWidget = Utils.h('section', { class: 'py-widget', 'aria-label': 'Часы' },
        Utils.h('h4', {}, 'Время'),
        Utils.h('div', { class: 'py-clock-big', id: 'widget-clock' }, '--:--'),
        Utils.h('div', { class: 'py-txt-3', style: { fontSize: '11px' }, id: 'widget-date' }, ''));
      const perfWidget = Utils.h('section', { class: 'py-widget', 'aria-label': 'Производительность' },
        Utils.h('h4', {}, 'Система'),
        ...['CPU', 'RAM', 'GPU'].map((label) => Utils.h('div', { class: 'py-perf-row' },
          Utils.h('span', { style: { width: '30px' } }, label),
          Utils.h('div', { class: 'py-prog' }, Utils.h('i', { 'data-metric': label.toLowerCase(), style: { width: '20%' } })),
          Utils.h('span', { 'data-val': label.toLowerCase(), style: { width: '34px', textAlign: 'right' } }, '20%'))));

      widgetsEl.append(clockWidget, perfWidget);

      const tickClock = () => {
        const now = new Date();
        const clockEl = document.getElementById('widget-clock');
        const dateEl = document.getElementById('widget-date');
        if (clockEl) clockEl.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        if (dateEl) dateEl.textContent = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
      };
      tickClock();
      const clockTimer = setInterval(tickClock, 10_000);
      timers.add(clockTimer);

      const perfTimer = setInterval(() => {
        if (document.hidden) return;
        for (const metric of ['cpu', 'ram', 'gpu']) {
          const bar = widgetsEl.querySelector(`[data-metric="${metric}"]`);
          const val = widgetsEl.querySelector(`[data-val="${metric}"]`);
          if (!bar) continue;
          const pct = Utils.rnd(metric === 'ram' ? 35 : 8, metric === 'ram' ? 70 : 55);
          bar.style.width = pct + '%';
          if (val) val.textContent = pct + '%';
        }
      }, 2500);
      timers.add(perfTimer);
    }

    /** Контекстное меню рабочего стола. */
    function attachDeskContext(root) {
      root.addEventListener('contextmenu', (event) => {
        if (event.target.closest('.py-win, .py-taskbar, .py-deskicon')) return;
        event.preventDefault();
        ContextMenu.show(event.clientX, event.clientY, [
          { label: 'Обновить ярлыки', icon: 'refresh', run: refreshIcons },
          { label: 'Командная палитра', icon: 'search', run: () => CommandPalette.open() },
          { label: 'Настройки', icon: 'gear', run: () => Launcher.launch('settings') },
          '-',
          { label: 'Фокус-режим', icon: 'wave', run: toggleFocusMode },
          { label: 'Закрыть все окна', icon: 'close', danger: true, run: () => Windows.closeAll() }
        ]);
      });
      root.addEventListener('click', (event) => {
        if (event.target === root || event.target.classList.contains('py-icons-grid') || event.target.classList.contains('py-layer-icons')) {
          Utils.$$('.py-deskicon.is-sel', root).forEach((el) => el.classList.remove('is-sel'));
        }
      });
    }

    function toggleFocusMode() {
      const on = rootEl.classList.toggle('focus-mode');
      Toast.show('Фокус-режим', on ? 'Ярлыки и виджеты скрыты' : 'Обычный режим', on ? 'star' : 'grid');
    }

    function mount() {
      const root = document.getElementById('pyos-root');
      root.classList.add('py-root');
      rootEl = root;

      const wallEl = Utils.h('div', { class: 'py-wall', 'aria-hidden': 'true' });
      wallEl.dataset.wall = Theme.getWall();
      const layerIcons = Utils.h('div', { class: 'py-layer py-layer-icons' });
      iconsGrid = Utils.h('div', { class: 'py-icons-grid', role: 'list', 'aria-label': 'Ярлыки приложений' });
      widgetsEl = Utils.h('div', { class: 'py-widgets' });
      layerIcons.append(iconsGrid, widgetsEl);
      const layerWin = Utils.h('div', { class: 'py-layer py-layer-win' });

      root.append(wallEl, layerIcons, layerWin);
      buildWidgets();
      attachDeskContext(root);
      refreshIcons();

      // синхронизация обоев при смене темы
      Bus.on('theme:wall', ({ id }) => { wallEl.dataset.wall = id; });
    }

    function unmountTimers() { for (const t of timers) clearInterval(t); timers.clear(); }

    return Object.freeze({ mount, addIcon, refreshIcons, toggleFocusMode, unmountTimers });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 4: Taskbar (плавающий док)
  // ─────────────────────────────────────────────────────────
  const Taskbar = (() => {
    let dockEl = null;
    let desksEl = null;
    let currentDesk = 1;
    const timers = new Set();

    /** Магнитный эффект: соседние иконки дока чуть сдвигаются при hover. */
    function attachMagnet(itemEl, dock) {
      itemEl.addEventListener('pointerenter', () => {
        const items = [...dock.children];
        const idx = items.indexOf(itemEl);
        for (let off = 1; off <= 2; off++) {
          for (const delta of [-off, off]) {
            const neighbor = items[idx + delta];
            if (neighbor) neighbor.style.transform = `translateX(${delta * off * -3}px)`;
          }
        }
      }, { passive: true });
      itemEl.addEventListener('pointerleave', () => {
        for (const child of dock.children) child.style.transform = '';
      }, { passive: true });
    }

    function renderDockItems() {
      if (!dockEl) return;
      dockEl.replaceChildren();
      const openList = Windows.list();
      const appIds = [...new Set(openList.map((w) => w.appId))];
      // добавляем запущенные через Launcher, даже если окно минимизировано полностью
      for (const runningId of Launcher.listRunning()) if (!appIds.includes(runningId)) appIds.push(runningId);

      for (const appId of appIds) {
        const manifest = Registry.get(appId);
        if (!manifest) continue;
        const appWins = Windows.windowsOf(appId);
        const front = appWins.some((w) => w.focused);
        const badgeCount = appWins.length;
        const item = Utils.h('button', {
          class: 'py-dockitem has-win' + (front ? ' is-front' : ''),
          'aria-label': manifest.name + (badgeCount > 1 ? `, окон: ${badgeCount}` : ''),
          dataset: { app: appId }
        }, IconRenderer.get(manifest.icon, { label: manifest.name }));
        if (badgeCount > 1) item.append(Utils.h('span', { class: 'py-badge' }, String(badgeCount)));
        item.addEventListener('click', () => Windows.toggleApp(appId));
        item.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          ContextMenu.show(event.clientX, event.clientY, [
            { label: 'Новое окно', icon: 'plus', run: () => Launcher.launch(appId) },
            { label: 'Свернуть все', icon: 'minus', run: () => appWins.forEach((w) => Windows.minimize(w.winId)) },
            '-',
            { label: 'Закрыть все', icon: 'close', danger: true, run: () => appWins.forEach((w) => Windows.close(w.winId)) }
          ]);
        });
        attachMagnet(item, dockEl);
        dockEl.append(item);
      }
    }

    function renderDesks() {
      if (!desksEl) return;
      desksEl.replaceChildren();
      for (let i = 1; i <= 4; i++) {
        desksEl.append(Utils.h('i', {
          class: i === currentDesk ? 'on' : '',
          title: 'Рабочий стол ' + i,
          onclick: () => switchDesk(i)
        }));
      }
    }

    function switchDesk(n) {
      currentDesk = Utils.clamp(n, 1, 4);
      renderDesks();
      Bus.emit('desk:switch', { desk: currentDesk });
      Toast.show('Рабочий стол ' + currentDesk, '', 'grid', { silent: true, ttl: 1200 });
    }

    function buildTray(trayEl) {
      // Jarvis orb
      const orb = Utils.h('button', { class: 'py-jarvis-orb', 'aria-label': 'Голосовой помощник Jarvis' },
        IconRenderer.get('mic', { size: 'sm' }));
      orb.addEventListener('click', () => {
        if (Jarvis.isListening()) { Jarvis.stop(); return; }
        if (!Jarvis.isEnabled()) Jarvis.enable(true);
        const ok = Jarvis.listen();
        if (!ok) {
          // Fallback: текстовый ввод команды
          Modal.prompt('Jarvis', 'Введите команду текстом:', (value) => { if (value) Jarvis.process(value); });
        }
      });
      Bus.on('jarvis:state', ({ listening }) => orb.classList.toggle('is-listening', listening));
      trayEl.append(orb);

      // Звук
      const soundBtn = Utils.h('button', { class: 'py-tbtn', 'aria-label': 'Звук' }, IconRenderer.get('volume', { size: 'sm' }));
      soundBtn.addEventListener('click', () => TrayCenter.open());
      trayEl.append(soundBtn);

      // Погода (демо)
      const weather = Utils.h('button', { class: 'py-tbtn py-tray-weather', 'aria-label': 'Погода (демо)' },
        IconRenderer.get('sun', { size: 'sm' }),
        Utils.h('span', { style: { fontSize: '11px', marginLeft: '4px' } }, '+21°'));
      weather.addEventListener('click', () => Toast.show('Погода · демо', 'Небольшая облачность, +21°C, ветер 3 м/с', 'sun'));
      trayEl.append(weather);

      // Уведомления
      const bellBtn = Utils.h('button', { class: 'py-tbtn', 'aria-label': 'Центр уведомлений' }, IconRenderer.get('bell', { size: 'sm' }));
      bellBtn.addEventListener('click', () => TrayCenter.toggle());
      trayEl.append(bellBtn);

      // Часы
      const clockEl = Utils.h('button', { class: 'py-tray-clock', 'aria-label': 'Дата и время' },
        Utils.h('b', { id: 'tray-time' }, '--:--'),
        Utils.h('span', { id: 'tray-date' }, ''));
      clockEl.addEventListener('click', () => TrayCenter.toggle());
      trayEl.append(clockEl);
      const tick = () => {
        const now = new Date();
        const timeEl = document.getElementById('tray-time');
        const dateEl = document.getElementById('tray-date');
        if (timeEl) timeEl.textContent = Utils.formatTime(now);
        if (dateEl) dateEl.textContent = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
      };
      tick();
      timers.add(setInterval(tick, 15_000));
    }

    function mount() {
      const taskbar = Utils.h('footer', { class: 'py-taskbar', role: 'toolbar', 'aria-label': 'Панель задач' });

      const startBtn = Utils.h('button', { class: 'py-startbtn', 'aria-label': 'Меню Пуск', 'aria-expanded': 'false' },
        IconRenderer.get('py-logo'));
      startBtn.addEventListener('click', (event) => { event.stopPropagation(); StartMenu.toggle(); });
      Bus.on('start:state', ({ open }) => startBtn.setAttribute('aria-expanded', String(open)));

      dockEl = Utils.h('nav', { class: 'py-dock', 'aria-label': 'Открытые приложения' });

      const trayEl = Utils.h('div', { class: 'py-tray' });
      desksEl = Utils.h('div', { class: 'py-desks', 'aria-label': 'Рабочие столы' });

      taskbar.append(startBtn, dockEl, desksEl, trayEl);
      buildTray(trayEl);
      document.getElementById('pyos-root').append(taskbar);
      renderDockItems();
      renderDesks();

      Bus.on('windows:opened', renderDockItems);
      Bus.on('windows:closed', renderDockItems);
      Bus.on('windows:focused', renderDockItems);
      Bus.on('windows:minimized', renderDockItems);
      Bus.on('launcher:launched', renderDockItems);
    }

    return Object.freeze({ mount, refresh: () => renderDockItems(), switchDesk, currentDesk: () => currentDesk });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 5: StartMenu (центрированное, Material You)
  // ─────────────────────────────────────────────────────────
  const StartMenu = (() => {
    let menuEl = null, veilEl = null, searchInput = null;
    let pinnedWrap = null, allWrap = null, recentWrap = null;
    let kbdIndex = -1, kbdTiles = [];
    let isOpen = false;

    const PIN_LIMIT = 8;

    function makeTile(manifest, small, index) {
      const tile = Utils.h('button', {
        class: 'py-tile' + (small ? ' py-tile--sm' : ''),
        'data-app': manifest.id,
        'aria-label': manifest.name,
        style: { '--i': String(index) }
      },
        Utils.h('span', { class: 'py-tile-ic' }, IconRenderer.get(manifest.icon, { size: small ? undefined : 'lg', label: manifest.name })),
        Utils.h('span', { class: 'py-tile-name' }, manifest.name));
      tile.addEventListener('click', (event) => {
        Utils.ripple(event, tile);
        Launcher.launch(manifest.id);
        close();
      });
      tile.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        ContextMenu.show(event.clientX, event.clientY, [
          { label: 'Открыть', icon: 'play', run: () => { Launcher.launch(manifest.id); close(); } },
          { label: StartMenu.isPinned(manifest.id) ? 'Открепить' : 'Закрепить', icon: 'pin', run: () => togglePin(manifest.id) }
        ]);
      });
      return tile;
    }

    function renderSections(filter = '') {
      const q = filter.trim().toLowerCase();
      const apps = Registry.list();
      const match = (m) => !q || m.name.toLowerCase().includes(q) || m.id.includes(q);

      const pinnedIds = Settings.get('pinned', []).filter((id) => Registry.has(id));
      const pinnedApps = apps.filter((a) => pinnedIds.includes(a.id) && match(a)).slice(0, PIN_LIMIT);
      pinnedWrap.replaceChildren(...pinnedApps.map((a, i) => makeTile(a, false, i)));

      const restApps = apps.filter((a) => !pinnedIds.includes(a.id) && match(a));
      allWrap.replaceChildren(...restApps.map((a, i) => makeTile(a, true, i)));

      const recentIds = Launcher.recent().filter((id) => Registry.has(id)).slice(0, 8);
      recentWrap.replaceChildren(...recentIds.map((id, i) => {
        const m = Registry.get(id);
        const bubble = Utils.h('button', { class: 'py-bubble', 'aria-label': 'Недавно: ' + m.name, style: { '--i': String(i) },
          onclick: () => { Launcher.launch(id); close(); } },
          IconRenderer.get(m.icon, { label: m.name }),
          Utils.h('time', {}, 'недавно'));
        return bubble;
      }));

      kbdTiles = [...pinnedWrap.children, ...allWrap.children];
      kbdIndex = -1;
    }

    function highlightMatches(query) {
      for (const tile of kbdTiles) {
        const nameEl = tile.querySelector('.py-tile-name');
        if (!nameEl) continue;
        const manifest = Registry.get(tile.dataset.app);
        nameEl.replaceChildren();
        const name = manifest?.name || '';
        const at = name.toLowerCase().indexOf(query.toLowerCase());
        if (query && at >= 0) {
          nameEl.append(document.createTextNode(name.slice(0, at)));
          nameEl.append(Utils.h('mark', { class: 'py-mark' }, name.slice(at, at + query.length)));
          nameEl.append(document.createTextNode(name.slice(at + query.length)));
        } else nameEl.textContent = name;
      }
    }

    function moveKbd(delta) {
      if (!kbdTiles.length) return;
      kbdTiles[kbdIndex]?.classList.remove('kbd-focus');
      kbdIndex = (kbdIndex + delta + kbdTiles.length) % kbdTiles.length;
      const target = kbdTiles[kbdIndex];
      target.classList.add('kbd-focus');
      target.scrollIntoView({ block: 'nearest' });
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      const host = document.getElementById('pyos-modals');
      veilEl = Utils.h('div', { class: 'py-start-veil', onclick: close });
      const userName = Settings.get('user.name', 'Гость');

      searchInput = Utils.h('input', {
        type: 'search', placeholder: 'Поиск приложений и файлов…',
        'aria-label': 'Поиск в меню Пуск', autocomplete: 'off'
      });
      searchInput.addEventListener('input', () => {
        renderSections(searchInput.value);
        highlightMatches(searchInput.value);
      });
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); moveKbd(1); }
        else if (event.key === 'Enter') {
          event.preventDefault();
          const active = kbdTiles[kbdIndex];
          if (active) active.click();
          else if (searchInput.value.trim()) CommandPalette.open(searchInput.value.trim());
        }
      });

      pinnedWrap = Utils.h('div', { class: 'py-tiles', role: 'group', 'aria-label': 'Закреплённые' });
      allWrap = Utils.h('div', { class: 'py-tiles py-tiles--all', role: 'group', 'aria-label': 'Все приложения' });
      recentWrap = Utils.h('div', { class: 'py-bubbles', role: 'group', 'aria-label': 'Недавние' });

      const powerBtn = Utils.h('button', { class: 'py-tbtn py-start-power', 'aria-label': 'Выключение' },
        IconRenderer.get('power'));
      powerBtn.addEventListener('click', () => showShutdownDialog());

      menuEl = Utils.h('section', { class: 'py-start', role: 'dialog', 'aria-label': 'Меню Пуск', tabindex: '-1' },
        Utils.h('div', { class: 'py-start-search' }, IconRenderer.get('search'), searchInput),
        Utils.h('div', { class: 'py-start-scroll' },
          Utils.h('h4', { class: 'py-start-label' }, 'Закреплённые'), pinnedWrap,
          Utils.h('h4', { class: 'py-start-label' }, 'Все приложения'), allWrap,
          Utils.h('h4', { class: 'py-start-label' }, 'Недавние'), recentWrap),
        Utils.h('footer', { class: 'py-start-user' },
          Utils.h('span', { class: 'py-avatar' }, (Settings.get('user.avatarSeed', 'P') || 'P').slice(0, 1).toUpperCase()),
          Utils.h('div', {},
            Utils.h('b', {}, userName),
            Utils.h('div', { class: 'py-txt-3', style: { fontSize: '11px' } }, 'PyOS Quantum')),
          powerBtn));

      host.append(veilEl, menuEl);
      renderSections();
      searchInput.focus();
      Bus.emit('start:state', { open: true });
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      menuEl?.classList.add('is-closing');
      const cleanup = () => { menuEl?.remove(); veilEl?.remove(); menuEl = veilEl = null; };
      menuEl?.addEventListener('animationend', cleanup, { once: true });
      if (!menuEl) cleanup();
      Bus.emit('start:state', { open: false });
    }

    function toggle() { isOpen ? close() : open(); }

    function isPinned(appId) { return (Settings.get('pinned', []) || []).includes(appId); }

    async function togglePin(appId) {
      const pinned = Settings.get('pinned', []).slice();
      const at = pinned.indexOf(appId);
      if (at >= 0) pinned.splice(at, 1);
      else if (pinned.length < PIN_LIMIT) pinned.push(appId);
      await Settings.set('pinned', pinned);
      if (isOpen) renderSections(searchInput?.value || '');
    }

    function showShutdownDialog() {
      close();
      Modal.confirm('Завершение работы', 'PyOS работает в браузере. Перезагрузить страницу?', () => location.reload(), 'Перезагрузить');
    }

    return Object.freeze({ open, close, toggle, isOpen: () => isOpen, togglePin, isPinned });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 6: TrayCenter (центр уведомлений и быстрых действий)
  // ─────────────────────────────────────────────────────────
  const TrayCenter = (() => {
    let panelEl = null;
    /** История уведомлений (в памяти сессии). */
    const history = [];

    function quickTiles() {
      const mkTile = (label, icon, pressed) => Utils.h('button', {
        class: 'py-qtile' + (pressed ? '' : ''), 'aria-pressed': String(!!pressed), 'aria-label': label
      }, IconRenderer.get(icon, { size: 'sm' }), Utils.h('span', {}, label));

      const fxTile = mkTile('Эффекты', 'palette', Theme.fxEnabled());
      fxTile.addEventListener('click', () => {
        const next = fxTile.getAttribute('aria-pressed') !== 'true';
        Theme.toggleFx(next); Settings.set('fx', next);
        fxTile.setAttribute('aria-pressed', String(next));
      });

      const jarvisTile = mkTile('Jarvis', 'mic', Jarvis.isEnabled());
      jarvisTile.addEventListener('click', () => {
        const next = jarvisTile.getAttribute('aria-pressed') !== 'true';
        Jarvis.enable(next);
        jarvisTile.setAttribute('aria-pressed', String(next));
      });

      const soundTile = mkTile('Звук', 'volume', Settings.get('sounds.on', true));
      soundTile.addEventListener('click', () => {
        const next = soundTile.getAttribute('aria-pressed') !== 'true';
        Settings.set('sounds.on', next);
        soundTile.setAttribute('aria-pressed', String(next));
      });

      const settingsTile = mkTile('Настройки', 'gear', false);
      settingsTile.addEventListener('click', () => { close(); Launcher.launch('settings'); });

      const aboutTile = mkTile('О системе', 'info', false);
      aboutTile.addEventListener('click', () => { close(); Launcher.launch('about'); });

      const restartTile = mkTile('Рестарт', 'restart', false);
      restartTile.addEventListener('click', () => location.reload());

      return [fxTile, jarvisTile, soundTile, settingsTile, aboutTile, restartTile];
    }

    function buildPanel() {
      const closeBtn = Utils.h('button', { class: 'py-tbtn', 'aria-label': 'Закрыть' }, IconRenderer.get('close', { size: 'sm' }));
      closeBtn.addEventListener('click', close);
      const header = Utils.h('div', { class: 'py-between' }, Utils.h('b', {}, 'Быстрые действия'), closeBtn);

      const grid = Utils.h('div', { class: 'py-qgrid' }, ...quickTiles());

      const volumeSlider = Utils.h('input', {
        class: 'py-range', type: 'range', min: '0', max: '100',
        value: String(Math.round(Settings.get('sounds.volume', 0.7) * 100)),
        'aria-label': 'Громкость'
      });
      volumeSlider.addEventListener('input', () => Settings.set('sounds.volume', Number(volumeSlider.value) / 100), { passive: true });
      const volumeRow = Utils.h('div', { class: 'py-flex py-gap-8' }, IconRenderer.get('volume', { size: 'sm' }), volumeSlider);

      const listEl = Utils.h('div', { class: 'py-col py-gap-8', id: 'tray-notifs' });
      const clearBtn = Utils.h('button', { class: 'py-chip' }, 'Очистить');
      clearBtn.addEventListener('click', () => { history.length = 0; renderHistory(listEl); });
      const notifHeader = Utils.h('div', { class: 'py-between' },
        Utils.h('b', { style: { fontSize: '12px' } }, 'Уведомления'), clearBtn);

      panelEl = Utils.h('aside', { class: 'py-tray-panel', role: 'complementary', 'aria-label': 'Центр уведомлений' },
        header, grid, volumeRow, Utils.h('hr', { class: 'py-sep' }), notifHeader, listEl);
      renderHistory(listEl);
      return panelEl;
    }

    function renderHistory(listEl) {
      listEl.replaceChildren();
      if (!history.length) { listEl.append(Utils.h('p', { class: 'py-txt-3', style: { fontSize: '12px' } }, 'Пока пусто')); return; }
      for (const record of history.slice(-12).reverse()) {
        listEl.append(Utils.h('div', { class: 'py-notif' },
          IconRenderer.get(record.icon || 'bell', { size: 'sm' }),
          Utils.h('div', { class: 'py-grow' },
            Utils.h('b', { style: { fontSize: '12px', display: 'block' } }, record.title),
            Utils.h('span', { class: 'py-txt-3', style: { fontSize: '11px' } }, record.text || '')),
          Utils.h('time', {}, Utils.formatTime(record.at))));
      }
    }

    function pushHistory(entry) {
      history.push(entry);
      if (panelEl) { const listEl = panelEl.querySelector('#tray-notifs'); if (listEl) renderHistory(listEl); }
    }

    function open() {
      if (panelEl) return;
      buildPanel();
      document.getElementById('pyos-root').append(panelEl);
    }
    function close() { panelEl?.remove(); panelEl = null; }
    function toggle() { panelEl ? close() : open(); }

    return Object.freeze({ open, close, toggle, pushHistory, isOpen: () => !!panelEl });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 7: CommandPalette (Ctrl+K)
  // ─────────────────────────────────────────────────────────
  const CommandPalette = (() => {
    let palEl = null, inputEl = null, listEl = null, selIndex = 0;
    let entries = [];

    async function collect(query) {
      const q = query.toLowerCase();
      const out = [];
      for (const m of Registry.list()) {
        if (!q || m.name.toLowerCase().includes(q) || m.id.includes(q)) {
          out.push({ sec: 'Приложения', label: m.name, icon: m.icon, run: () => Launcher.launch(m.id) });
        }
      }
      const actions = [
        { label: 'Сменить акцент', icon: 'palette', run: () => Launcher.launch('settings') },
        { label: 'Меню Пуск', icon: 'grid', run: () => StartMenu.open() },
        { label: 'Центр уведомлений', icon: 'bell', run: () => TrayCenter.open() },
        { label: 'Закрыть все окна', icon: 'close', run: () => Windows.closeAll() },
        { label: 'Скриншот-тост (демо)', icon: 'star', run: () => Toast.show('Готово', 'Демо-действие выполнено', 'check') }
      ];
      for (const a of actions) if (!q || a.label.toLowerCase().includes(q)) out.push({ sec: 'Действия', ...a });

      try {
        // поиск по VFS: перебираем папки верхнего уровня
        const roots = await FileSystem.list('/');
        const stack = roots.filter((r) => r.type === 'dir').map((r) => r.path);
        const files = [];
        for (const dir of stack.slice(0, 6)) {
          const items = await FileSystem.list(dir);
          files.push(...items);
        }
        for (const f of files) {
          if (q && !f.name.toLowerCase().includes(q)) continue;
          if (!q && files.indexOf(f) > 5) break;
          out.push({ sec: 'Файлы', label: f.name, icon: f.type === 'dir' ? 'folder' : (f.name.endsWith('.py') ? 'pyfile' : 'file'),
            run: () => { if (f.type === 'dir') Launcher.launch('files', { payload: f.path }); else Launcher.launch('editor', { payload: f.path }); } });
        }

      } catch (err) { console.warn('[PyOS][Palette] file search skipped:', err); }

      return out.slice(0, 40);
    }

    function renderList(items) {
      entries = items;
      selIndex = 0;
      listEl.replaceChildren();
      let lastSec = null;
      items.forEach((item, i) => {
        if (item.sec !== lastSec) { listEl.append(Utils.h('div', { class: 'py-pal-sec' }, item.sec)); lastSec = item.sec; }
        const row = Utils.h('button', { class: 'py-pal-item' + (i === 0 ? ' sel' : ''), 'data-i': String(i) },
          IconRenderer.get(item.icon, { size: 'sm', label: item.label }),
          Utils.h('span', { class: 'py-trunc' }, item.label),
          Utils.h('kbd', { class: 'py-kbd' }, '↵'));
        row.addEventListener('click', () => execute(i));
        row.addEventListener('pointerenter', () => { selIndex = i; syncSel(); }, { passive: true });
        listEl.append(row);
      });
      if (!items.length) listEl.append(Utils.h('p', { class: 'py-txt-3', style: { padding: '16px' } }, 'Ничего не найдено'));
    }

    function syncSel() {
      for (const row of listEl.querySelectorAll('.py-pal-item')) row.classList.toggle('sel', Number(row.dataset.i) === selIndex);
      listEl.querySelector('.py-pal-item.sel')?.scrollIntoView({ block: 'nearest' });
    }

    function execute(i) {
      const item = entries[i];
      close();
      if (item) item.run();
    }

    const refresh = Utils.debounce(async () => {
      renderList(await collect(inputEl.value));
    }, 120);

    function open(initialQuery = '') {
      if (palEl) { inputEl.value = initialQuery; refresh(); inputEl.focus(); return; }
      inputEl = Utils.h('input', { type: 'text', placeholder: 'Команда, приложение или файл…', 'aria-label': 'Командная палитра', value: initialQuery, autocomplete: 'off' });
      inputEl.addEventListener('input', refresh, { passive: true });
      inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); selIndex = Math.min(selIndex + 1, entries.length - 1); syncSel(); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); selIndex = Math.max(selIndex - 1, 0); syncSel(); }
        else if (event.key === 'Enter') { event.preventDefault(); execute(selIndex); }
        else if (event.key === 'Escape') { event.preventDefault(); close(); }
      });
      listEl = Utils.h('div', { class: 'py-pal-list', role: 'listbox' });
      palEl = Utils.h('div', { class: 'py-pal', role: 'dialog', 'aria-label': 'Командная палитра' },
        Utils.h('div', { class: 'py-pal-input' }, IconRenderer.get('search'), inputEl), listEl);
      const veil = Utils.h('div', { class: 'py-pal-veil' }, palEl);
      veil.dataset.role = 'pal-veil';
      veil.addEventListener('pointerdown', (event) => { if (event.target === veil) close(); });
      document.getElementById('pyos-modals').append(veil);
      palEl._veil = veil;
      refresh();
      inputEl.focus();
    }

    function close() {
      if (!palEl) return;
      palEl._veil?.remove();
      palEl = null;
    }
    function toggle(query) { palEl ? close() : open(query); }

    return Object.freeze({ open, close, toggle });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 8: ContextMenu
  // ─────────────────────────────────────────────────────────
  const ContextMenu = (() => {
    let menuEl = null;

    function close() { menuEl?.remove(); menuEl = null; }

    /**
     * @param {number} x @param {number} y
     * @param {Array<{label:string,icon?:string,run?:Function,danger?:boolean}|'-'>} items
     */
    function show(x, y, items) {
      close();
      menuEl = Utils.h('div', { class: 'py-ctx', role: 'menu', 'aria-label': 'Контекстное меню' });
      for (const item of items) {
        if (item === '-') { menuEl.append(Utils.h('div', { class: 'py-ctx-sep' })); continue; }
        const row = Utils.h('button', { class: 'py-ctx-item' + (item.danger ? ' danger' : ''), role: 'menuitem' },
          item.icon ? IconRenderer.get(item.icon, { size: 'sm' }) : null,
          Utils.h('span', {}, item.label));
        row.addEventListener('click', () => { close(); item.run?.(); });
        menuEl.append(row);
      }
      document.body.append(menuEl);
      const rect = menuEl.getBoundingClientRect();
      const ox = x + rect.width > window.innerWidth ? window.innerWidth - rect.width - 8 : x;
      const oy = y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 8 : y;
      menuEl.style.left = ox + 'px';
      menuEl.style.top = oy + 'px';
      const later = setTimeout(() => {
        clearTimeout(later);
        const dismiss = (event) => {
          if (!menuEl?.contains(event.target)) { close(); window.removeEventListener('pointerdown', dismiss); }
        };
        window.addEventListener('pointerdown', dismiss);
      }, 0);
    }

    return Object.freeze({ show, close });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 9: Toast
  // ─────────────────────────────────────────────────────────
  const Toast = (() => {
    const MAX_VISIBLE = 3;
    const DEFAULT_TTL = 4200;
    let visible = 0;

    /**
     * Показать тост. opts: { ttl:number, silent:boolean, action:{label,run} }
     */
    function show(title, text = '', icon = 'bell', opts = {}) {
      const stackHost = document.getElementById('pyos-toasts');
      let stack = stackHost.querySelector('.py-toast-stack');
      if (!stack) { stack = Utils.h('div', { class: 'py-toast-stack' }); stackHost.append(stack); }

      while (stack.children.length >= MAX_VISIBLE) stack.firstElementChild.remove();

      const ttl = opts.ttl ?? DEFAULT_TTL;
      const toast = Utils.h('div', { class: 'py-toast', role: 'status' },
        Utils.h('span', { class: 'py-toast-ic' }, IconRenderer.get(icon, { label: title })),
        Utils.h('div', { class: 'py-grow' }, Utils.h('b', {}, title), text ? Utils.h('p', {}, text) : null),
        Utils.h('button', { class: 'py-tbtn', 'aria-label': 'Закрыть уведомление', style: { width: '26px', height: '26px' } }, IconRenderer.get('x', { size: 'sm' })));
      toast.lastChild.addEventListener('click', () => dismiss(toast));

      if (opts.action) {
        const actionBtn = Utils.h('button', { class: 'py-btn py-btn--ghost', style: { alignSelf: 'center' } }, opts.action.label);
        actionBtn.addEventListener('click', () => { dismiss(toast); opts.action.run(); });
        toast.append(actionBtn);
      }

      const prog = Utils.h('i', { class: 'py-toast-prog', style: { animationDuration: ttl + 'ms' } });
      toast.append(prog);
      stack.append(toast);
      visible++;

      TrayCenter.pushHistory({ title, text, icon, at: Date.now() });
      if (!opts.silent && Settings.get('sounds.on', true)) Jarvis.beep(520, 55);

      const timer = setTimeout(() => dismiss(toast), ttl);
      toast._timer = timer;
      prog.addEventListener('animationend', () => { /* прогресс завершился — закрытие делает таймер */ });
      return toast;
    }

    function dismiss(toast) {
      clearTimeout(toast._timer);
      if (!toast.isConnected) return;
      toast.classList.add('is-out');
      toast.addEventListener('animationend', () => { toast.remove(); visible = Math.max(0, visible - 1); }, { once: true });
    }

    function clear() {
      const stack = document.querySelector('.py-toast-stack');
      if (stack) { for (const t of stack.children) clearTimeout(t._timer); stack.replaceChildren(); }
      visible = 0;
    }

    return Object.freeze({ show, clear });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 9b: Modal (подтверждения и prompt)
  // ─────────────────────────────────────────────────────────
  const Modal = (() => {
    function dialog(titleText, bodyNode, actions) {
      const veil = Utils.h('div', { class: 'py-modal-veil' });
      const box = Utils.h('div', { class: 'py-modal', role: 'alertdialog', 'aria-label': titleText },
        Utils.h('h3', {}, titleText), bodyNode,
        Utils.h('div', { class: 'py-modal-actions' }, ...actions));
      veil.append(box);
      const close = () => veil.remove();
      veil.addEventListener('pointerdown', (event) => { if (event.target === veil) close(); });
      document.getElementById('pyos-modals').append(veil);
      return { close, box };
    }

    /** Подтверждение: confirm(title, text, onYes, yesLabel). */
    function confirm(titleText, text, onYes, yesLabel = 'Да') {
      const cancelBtn = Utils.h('button', { class: 'py-btn py-btn--ghost' }, 'Отмена');
      const yesBtn = Utils.h('button', { class: 'py-btn py-btn--filled' }, yesLabel);
      const dlg = dialog(titleText, Utils.h('p', { class: 'py-txt-2' }, text), [cancelBtn, yesBtn]);
      cancelBtn.addEventListener('click', dlg.close);
      yesBtn.addEventListener('click', () => { dlg.close(); onYes(); });
      yesBtn.focus();
      return dlg;
    }

    /** Ввод текста: prompt(title, label, onSubmit). */
    function prompt(titleText, label, onSubmit, initialValue = '') {
      const input = Utils.h('input', { class: 'py-input', type: 'text', value: initialValue, 'aria-label': label });
      const okBtn = Utils.h('button', { class: 'py-btn py-btn--filled' }, 'OK');
      const cancelBtn = Utils.h('button', { class: 'py-btn py-btn--ghost' }, 'Отмена');
      const dlg = dialog(titleText, Utils.h('div', { class: 'py-field' }, Utils.h('label', {}, label), input), [cancelBtn, okBtn]);
      const submit = () => { const v = input.value.trim(); dlg.close(); if (v) onSubmit(v); };
      okBtn.addEventListener('click', submit);
      cancelBtn.addEventListener('click', dlg.close);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
      input.focus();
      return dlg;
    }

    return Object.freeze({ confirm, prompt, dialog });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 10: OOBE (мастер первого запуска, 8 шагов)
  // ─────────────────────────────────────────────────────────
  const OOBE = (() => {
    const TOTAL_STEPS = 8;

    async function run() {
      const state = { name: '', accent: 'blue', wall: 'aurora', sounds: true, jarvis: false, geminiKey: '', fx: true };
      let step = 0;
      let hostEl = null;

      return new Promise((resolve) => {
        const root = document.getElementById('pyos-root');
        hostEl = Utils.h('div', { class: 'py-oobe', role: 'dialog', 'aria-label': 'Первая настройка PyOS' });
        root.append(hostEl);

        const stepsBar = Utils.h('div', { class: 'py-oobe-steps', 'aria-hidden': 'true' });
        for (let i = 0; i < TOTAL_STEPS; i++) stepsBar.append(Utils.h('i', {}));
        const cardEl = Utils.h('div', { class: 'py-oobe-card' });
        hostEl.append(stepsBar, cardEl);

        const paintSteps = () => {
          [...stepsBar.children].forEach((el, i) => { el.className = i < step ? 'done' : i === step ? 'cur' : ''; });
        };

        const nav = (nextLabel, onNext, back = true) => {
          const buttons = [];
          if (back) buttons.push(Utils.h('button', { class: 'py-btn py-btn--ghost', onclick: () => { step--; render(); } }, 'Назад'));
          buttons.push(Utils.h('button', { class: 'py-btn py-btn--filled', onclick: () => { if (onNext && onNext() === false) return; step++; render(); } }, nextLabel));
          return Utils.h('div', { class: 'py-oobe-actions' }, ...buttons);
        };

        const head = (titleText, subText) => [
          Utils.h('div', { class: 'py-oobe-title' }, titleText),
          Utils.h('p', { class: 'py-oobe-sub' }, subText)];

        function render() {
          paintSteps();
          cardEl.replaceChildren();
          if (step === 0) {
            const logoBig = IconRenderer.get('py-logo');
            logoBig.classList.add('py-oobe-logo');
            cardEl.append(logoBig, ...head('Добро пожаловать в PyOS 5.0', 'Квантовая операционная среда прямо в браузере. Сейчас настроим всё под вас — это займёт минуту.'),
              nav('Начать', null));
          } else if (step === 1) {
            const nameInput = Utils.h('input', { class: 'py-input', placeholder: 'Как вас зовут?', value: state.name, 'aria-label': 'Имя пользователя' });
            const avatarPreview = Utils.h('span', { class: 'py-avatar', style: { width: '64px', height: '64px', fontSize: '26px' } }, (state.name || 'P').slice(0, 1).toUpperCase());
            nameInput.addEventListener('input', () => { avatarPreview.textContent = (nameInput.value.trim() || 'P').slice(0, 1).toUpperCase(); }, { passive: true });
            cardEl.append(...head('Кто за рулём?', 'Имя появится в меню Пуск и приветствиях.'),
              Utils.h('div', { class: 'py-col py-gap-12', style: { width: 'min(340px,90vw)' } }, avatarPreview, nameInput),
              nav('Далее', () => { state.name = nameInput.value.trim() || 'Гость'; }));
          } else if (step === 2) {
            const dots = Utils.h('div', { class: 'py-flex py-gap-12', style: { justifyContent: 'center' } });
            for (const accent of Theme.listAccents()) {
              const dot = Utils.h('button', { class: 'py-acc-dot' + (accent.id === state.accent ? ' cur' : ''),
                style: { background: `linear-gradient(135deg, ${accent.acc}, ${accent.acc2})` }, 'aria-label': accent.label, title: accent.label });
              dot.addEventListener('click', () => {
                state.accent = accent.id; Theme.applyAccent(accent.id);
                [...dots.children].forEach((c) => c.classList.remove('cur')); dot.classList.add('cur');
              });
              dots.append(dot);
            }
            cardEl.append(...head('Выберите акцент', 'Цвет интерфейса можно сменить позже в Настройках.'), dots, nav('Далее'));
          } else if (step === 3) {
            const thumbs = Utils.h('div', { class: 'py-flex py-gap-12', style: { flexWrap: 'wrap', justifyContent: 'center', maxWidth: '480px' } });
            for (const wall of Theme.listWalls()) {
              const thumb = Utils.h('button', { class: 'py-wall-thumb' + (wall.id === state.wall ? ' cur' : ''), 'aria-label': wall.label, dataset: { wall: wall.id } });
              // мини-превью: слой обоев с тем же data-wall внутри кнопки
              const mini = Utils.h('span', { class: 'py-wall', 'aria-hidden': 'true', style: { position: 'absolute', inset: '0', borderRadius: 'inherit' } });
              mini.dataset.wall = wall.id;
              thumb.style.position = 'relative'; thumb.style.overflow = 'hidden';
              thumb.append(mini);
              thumb.addEventListener('click', () => {
                state.wall = wall.id; Theme.applyWall(wall.id);
                [...thumbs.children].forEach((c) => c.classList.remove('cur')); thumb.classList.add('cur');
              });
              thumbs.append(thumb);
            }
            cardEl.append(...head('Обои рабочего стола', 'Все обои — процедурные CSS-градиенты, ноль загрузок.'), thumbs, nav('Далее'));
          } else if (step === 4) {
            const sw = Utils.h('button', { class: 'py-sw', role: 'switch', 'aria-checked': String(state.sounds) });
            sw.addEventListener('click', () => { state.sounds = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(state.sounds)); if (state.sounds) Jarvis.beep(660, 80); });
            cardEl.append(...head('Звуки системы', 'Тоны уведомлений и голос Джарвиса.'),
              Utils.h('div', { class: 'py-flex py-gap-12' }, Utils.h('span', {}, 'Включить звуки'), sw), nav('Далее'));
          } else if (step === 5) {
            const sw = Utils.h('button', { class: 'py-sw', role: 'switch', 'aria-checked': String(state.jarvis) });
            sw.addEventListener('click', () => { state.jarvis = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(state.jarvis)); });
            const keyInput = Utils.h('input', { class: 'py-input', type: 'password', placeholder: 'Gemini API key (необязательно)', 'aria-label': 'Gemini API ключ' });
            cardEl.append(...head('Голосовой ассистент', 'Jarvis понимает 20+ русскоязычных команд. Можно добавить Gemini-ключ для умных ответов.'),
              Utils.h('div', { class: 'py-flex py-gap-12' }, Utils.h('span', {}, 'Включить Jarvis'), sw),
              Utils.h('div', { class: 'py-field', style: { width: 'min(340px,90vw)' } }, keyInput),
              nav('Далее', () => { state.geminiKey = keyInput.value.trim(); }));
          } else if (step === 6) {
            const sw = Utils.h('button', { class: 'py-sw', role: 'switch', 'aria-checked': String(state.fx) });
            sw.addEventListener('click', () => { state.fx = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(state.fx)); Theme.toggleFx(state.fx); });
            cardEl.append(...head('Анимации и стекло', 'Blur, conic-обводки, пружинные переходы. Отключите для максимальной производительности.'),
              Utils.h('div', { class: 'py-flex py-gap-12' }, Utils.h('span', {}, 'Красивые эффекты'), sw), nav('Далее'));
          } else if (step === 7) {
            const bar = Utils.h('div', { class: 'py-prog' }, Utils.h('i', { style: { width: '0%' } }));
            const stageLine = Utils.h('div', { class: 'py-boot-stage' }, 'Подготовка рабочей среды…');
            cardEl.append(...head('Установка завершается', 'Сохраняем предпочтения в IndexedDB.'), bar, stageLine);
            const stages = ['Сохранение профиля…', 'Применение темы…', 'Инициализация файловой системы…', 'Регистрация приложений…', 'Готово!'];
            let idx = 0;
            const intervalId = setInterval(() => {
              idx++;
              bar.firstChild.style.width = Math.min(100, idx * 20) + '%';
              stageLine.textContent = stages[Math.min(idx, stages.length - 1)];
              if (idx >= 5) {
                clearInterval(intervalId);
                setTimeout(async () => {
                  await Settings.set('user.name', state.name);
                  await Settings.set('user.avatarSeed', (state.name || 'P').slice(0, 1).toUpperCase());
                  await Settings.set('accent', state.accent);
                  await Settings.set('wallpaper', state.wall);
                  await Settings.set('sounds.on', state.sounds);
                  await Settings.set('jarvis.on', state.jarvis);
                  if (state.geminiKey) await Settings.set('jarvis.geminiKey', state.geminiKey);
                  await Settings.set('fx', state.fx);
                  await Settings.set('oobe.done', true);
                  Jarvis.enable(state.jarvis);
                  hostEl.remove();
                  resolve();
                }, 350);
              }
            }, 420);
            return;
          }
        }

        render();
      });
    }

    const isDone = () => !!Settings.get('oobe.done', false);

    return Object.freeze({ run, isDone });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 11: Boot (экран загрузки со стадиями)
  // ─────────────────────────────────────────────────────────
  const Boot = (() => {
    const STAGES = [
      'Инициализация ядра Quantum…',
      'Проверка IndexedDB-хранилища…',
      'Монтирование виртуальной ФС…',
      'Загрузка профиля и темы…',
      'Сборка оболочек приложений…',
      'Калибровка оконного композитора…'
    ];

    /** Показывает boot-screen и проигрывает стадии; резолвится по завершении. */
    function run() {
      return new Promise((resolve) => {
        const root = document.getElementById('pyos-root');
        const logoEl = IconRenderer.get('py-logo');
        logoEl.classList.add('py-boot-logo');
        const barFill = Utils.h('i', { style: { width: '0%' } });
        const stageEl = Utils.h('div', { class: 'py-boot-stage' }, STAGES[0]);
        const bootEl = Utils.h('div', { class: 'py-boot py-shine', role: 'progressbar', 'aria-label': 'Загрузка PyOS' },
          logoEl,
          Utils.h('div', { style: { fontSize: '20px', fontWeight: '700', letterSpacing: '2px' } }, 'PyOS Studio 5.0'),
          Utils.h('div', { class: 'py-prog' }, barFill),
          stageEl);
        root.append(bootEl);

        let idx = 0;
        const intervalId = setInterval(() => {
          idx++;
          barFill.style.width = Math.min(100, idx * (100 / STAGES.length)) + '%';
          stageEl.textContent = STAGES[Math.min(idx, STAGES.length - 1)];
          if (idx >= STAGES.length) {
            clearInterval(intervalId);
            bootEl.classList.add('is-done');
            bootEl.addEventListener('transitionend', () => bootEl.remove(), { once: true });
            resolve();
          }
        }, 320);
      });
    }

    return Object.freeze({ run });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 12: Hooks (события ядра → UI) + хоткеи
  // ─────────────────────────────────────────────────────────
  const Hooks = (() => {
    let inited = false;

    function attachHotkeys() {
      window.addEventListener('keydown', (event) => {
        const inField = event.target.matches('input, textarea, select, [contenteditable="true"]');

        // Esc — закрыть верхний слой
        if (event.key === 'Escape') {
          if (ContextMenu.close && document.querySelector('.py-ctx')) ContextMenu.close();
          else if (StartMenu.isOpen()) StartMenu.close();
          else if (document.querySelector('.py-pal')) CommandPalette.close();
          else if (TrayCenter.isOpen()) TrayCenter.close();
          return;
        }
        if (inField) return;

        // Ctrl+K — палитра
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          CommandPalette.toggle();
          return;
        }
        // Win/Meta — Пуск: одиночное нажатие Meta ловим на keyup ниже.
        // Ctrl+1..4 — рабочие столы
        if ((event.ctrlKey || event.metaKey) && /^[1-4]$/.test(event.key)) {
          event.preventDefault();
          Taskbar.switchDesk(Number(event.key));
          return;
        }
        // Alt+J — Jarvis
        if (event.altKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          if (!Jarvis.isEnabled()) Jarvis.enable(true);
          if (!Jarvis.listen()) Modal.prompt('Jarvis', 'Введите команду текстом:', (value) => Jarvis.process(value));
          return;
        }
        // Ctrl+Space — тоже палитра (как альтернатива)
        if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
          event.preventDefault();
          StartMenu.toggle();
        }
      });

      // Одиночный Meta (⌘/Win) открывает Пуск: считаем на keyup
      let metaDownAlone = false;
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Meta' && !event.repeat) metaDownAlone = true;
        else if (event.key !== 'Meta') metaDownAlone = false;
      });
      window.addEventListener('keyup', (event) => {
        if (event.key === 'Meta' && metaDownAlone) { StartMenu.toggle(); }
        metaDownAlone = false;
      });
    }

    function init() {
      if (inited) return;
      inited = true;

      Bus.on('registry:registered', ({ id }) => { Desktop.addIcon(id); Taskbar.refresh(); });
      Bus.on('registry:unregistered', () => { Desktop.refreshIcons(); Taskbar.refresh(); });
      Bus.on('windows:opened', () => Taskbar.refresh());
      Bus.on('windows:closed', () => Taskbar.refresh());
      Bus.on('theme:accent', () => Toast.clear());
      Bus.on('kernel:ready', () => { /* уже обработано boot-промисом */ });

      attachHotkeys();
    }

    return Object.freeze({ init, attachHotkeys });
  })();

  // ─────────────────────────────────────────────────────────
  // Сборка: window.PyOSUI + legacy-фасад window.PYOS
  // ─────────────────────────────────────────────────────────
  const Api = Object.freeze({ IconRenderer, Windows, Desktop, Taskbar, StartMenu, TrayCenter, CommandPalette, ContextMenu, Toast, Modal, OOBE, Boot, Hooks });
  window.PyOSUI = Api;

  // Экспорт для приложений (совместимый фасад)
  window.PYOS = window.PYOS || {};

  // До готовности ядра ссылки null — заполняем сразу после waitCore
  waitCore.then(async () => {
    Core = window.PyOSCore;
    ({ Utils, Bus, Theme, Settings, Registry, Launcher, FileSystem, Jarvis } = Core);

    Object.assign(window.PYOS, {
      ui: Api,
      core: Core,
      bus: Bus,
      launch: (id, opts) => Launcher.launch(id, opts),
      notify: (title, text, icon) => Toast.show(title, text, icon),
      store: {
        get: (key, def) => Settings.get(key, def),
        set: (key, value) => Settings.set(key, value)
      },
      vfs: {
        list: (path) => FileSystem.list(path),
        read: (path) => FileSystem.read(path),
        write: (path, content) => FileSystem.write(path, content),
        mkdir: (path) => FileSystem.mkdir(path),
        remove: (path) => FileSystem.remove(path),
        stat: (path) => FileSystem.stat(path),
        rename: (from, to) => FileSystem.rename(from, to)
      },
      jarvis: {
        addCommand: (pattern, fn) => Jarvis.addCommand(pattern, fn, 'app'),
        say: (text) => Jarvis.say(text)
      }
    });

    await Boot.run();
    if (!OOBE.isDone()) await OOBE.run();

    Desktop.mount();
    Taskbar.mount();
    Hooks.init();

    // Приветствие
    Toast.show('Добро пожаловать', `${Settings.get('user.name', 'Гость')}, PyOS Quantum готов. Ctrl+K — палитра, Win — Пуск.`, 'py-logo', { ttl: 5200 });

    window.dispatchEvent(new CustomEvent('pyos:ui:ready'));
  });
})();
