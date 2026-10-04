--- core.js (原始)


+++ core.js (修改后)
// ============================================================
// PyOS Studio 5.0 Quantum · Core
// Ядро: utils, bus, storage, theme, settings, filesystem,
//       registry, launcher, plugins, sandbox, jarvis, kernel
// ============================================================

(() => {
  'use strict';
  if (window.__PYOS_CORE__) return;
  window.__PYOS_CORE__ = true;

  const DB_NAME = 'pyos-quantum';
  const DB_VERSION = 1;
  const DB_STORE = 'kv';
  const BOOT_TIME = Date.now();

  // ─────────────────────────────────────────────────────────
  // Module 1: Utils
  // ─────────────────────────────────────────────────────────
  /** @typedef {{(tag:string, attrs?:Object, ...kids:(Node|string)[]):HTMLElement}} HHelper */
  const Utils = (() => {
    /** @param {string} sel @param {ParentNode} [root] */
    const $ = (sel, root = document) => root.querySelector(sel);
    /** @param {string} sel @param {ParentNode} [root] */
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    /**
     * Фабрика элементов без innerHTML.
     * h('div', { class:'x', onclick: fn, dataset:{a:'1'} }, 'текст', node)
     * @param {string} tag
     * @param {Object} [attrs]
     * @param {...(Node|string)} kids
     * @returns {HTMLElement|SVGElement}
     */
    const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'text', 'g', 'use', 'line']);
    function h(tag, attrs = {}, ...kids) {
      const isSvg = SVG_TAGS.has(tag);
      const el = isSvg
        ? document.createElementNS('http://www.w3.org/2000/svg', tag)
        : document.createElement(tag);
      for (const [key, value] of Object.entries(attrs || {})) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') el.setAttribute('class', value);
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function')
          el.addEventListener(key.slice(2), value);
        else if (key === 'html') el.textContent = String(value); // безопасно: textContent
        else el.setAttribute(key, value === true ? '' : String(value));
      }
      for (const kid of kids.flat(Infinity)) {
        if (kid === null || kid === undefined || kid === false) continue;
        el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
      }
      return el;
    }

    /** @param {number} min @param {number} max */
    const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

    /** @param {Function} fn @param {number} ms */
    const debounce = (fn, ms = 200) => {
      let timer = 0;
      const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
      wrapped.cancel = () => clearTimeout(timer);
      return wrapped;
    };
    /** @param {Function} fn @param {number} ms */
    const throttle = (fn, ms = 100) => {
      let last = 0, timer = 0;
      return (...args) => {
        const now = Date.now();
        const rest = ms - (now - last);
        if (rest <= 0) { clearTimeout(timer); last = now; fn(...args); }
        else if (!timer) timer = setTimeout(() => { last = Date.now(); timer = 0; fn(...args); }, rest);
      };
    };

    /** @param {string} str */
    const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    /** @param {number} bytes */
    const formatBytes = (bytes) => {
      if (!Number.isFinite(bytes) || bytes < 0) return '0 Б';
      const units = ['Б', 'КБ', 'МБ', 'ГБ'];
      let u = 0, v = bytes;
      while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
      return `${u === 0 ? v : v.toFixed(1)} ${units[u]}`;
    };

    /** @param {Date|number} date */
    const formatTime = (date) => new Date(date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    /** @param {Date|number} date */
    const formatDate = (date) => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

    /** Ставит Material ripple на элемент от точки клика. */
    const ripple = (event, hostEl) => {
      const host = hostEl || event.currentTarget;
      if (!host || typeof host.getBoundingClientRect !== 'function') return;
      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const layer = h('span', { class: 'py-ripple', style: { width: size + 'px', height: size + 'px',
        left: (event.clientX - rect.left - size / 2) + 'px', top: (event.clientY - rect.top - size / 2) + 'px' } });
      host.appendChild(layer);
      layer.addEventListener('animationend', () => layer.remove(), { once: true });
    };

    /** Простой детерминированный хеш строки → число. */
    const hashStr = (str) => { let hv = 2166136261; for (let i = 0; i < str.length; i++) { hv ^= str.charCodeAt(i); hv = Math.imul(hv, 16777619); } return hv >>> 0; };

    return Object.freeze({ $, $$, h, rnd, clamp, uuid, debounce, throttle, escapeHtml, formatBytes, formatTime, formatDate, ripple, hashStr });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 2: Bus (EventTarget-based)
  // ─────────────────────────────────────────────────────────
  const Bus = (() => {
    const target = new EventTarget();
    return Object.freeze({
      /** @param {string} event @param {Function} fn */
      on(event, fn) { target.addEventListener(event, (e) => fn(e.detail, e)); return fn; },
      /** @param {string} event @param {Function} fn */
      off(event, fn) { target.removeEventListener(event, fn); },
      /** @param {string} event @param {Function} fn */
      once(event, fn) { const wrap = (e) => { target.removeEventListener(event, wrap); fn(e.detail, e); }; target.addEventListener(event, wrap); },
      /** @param {string} event @param {*} [detail] */
      emit(event, detail) { target.dispatchEvent(new CustomEvent(event, { detail })); }
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 3: Storage (IndexedDB + in-memory fallback)
  // ─────────────────────────────────────────────────────────
  const Storage = (() => {
    /** @type {IDBDatabase|null} */
    let db = null;
    /** Фолбэк-Map, если IndexedDB недоступен (НЕ localStorage). */
    const memFallback = new Map();
    let usingMem = false;

    /** Открывает базу; при отказе IDB включает mem-режим. */
    async function openDb() {
      if (db) return db;
      if (!('indexedDB' in window)) { usingMem = true; return null; }
      try {
        db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const base = req.result;
            if (!base.objectStoreNames.contains(DB_STORE)) base.createObjectStore(DB_STORE);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('IDB blocked'));
        });
        return db;
      } catch (err) {
        console.warn('[PyOS][Storage] IndexedDB недоступен, работаю в памяти:', err);
        usingMem = true;
        return null;
      }
    }

    /** Составной ключ namespace:key. */
    const fullKey = (ns, key) => `${ns}/${key}`;

    function idbGet(key) {
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(DB_STORE, 'readonly');
          const req = tx.objectStore(DB_STORE).get(key);
          req.onsuccess = () => resolve(req.result === undefined ? undefined : req.result);
          req.onerror = () => reject(req.error);
        } catch (err) { reject(err); }
      });
    }
    function idbSet(key, value) {
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        } catch (err) { reject(err); }
      });
    }
    function idbDel(key) {
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        } catch (err) { reject(err); }
      });
    }
    function idbKeys(prefix) {
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(DB_STORE, 'readonly');
          const req = tx.objectStore(DB_STORE).getAllKeys();
          req.onsuccess = () => resolve(req.result.filter((k) => typeof k === 'string' && k.startsWith(prefix)));
          req.onerror = () => reject(req.error);
        } catch (err) { reject(err); }
      });
    }

    return Object.freeze({
      /** Инициализация (открытие БД). Вызывается Kernel.boot(). */
      async init() { await openDb(); return !usingMem; },
      /** @returns {boolean} true если IDB реально работает */
      isPersistent() { return !!db && !usingMem; },
      /**
       * @param {string} ns пространство имён ('settings','vfs','plugins','session')
       * @param {string} key
       * @returns {Promise<any>}
       */
      async get(ns, key) {
        const fk = fullKey(ns, key);
        if (usingMem) return memFallback.get(fk);
        try { return await idbGet(fk); } catch (err) { console.error('[PyOS][Storage] get', err); return memFallback.get(fk); }
      },
      /** @param {string} ns @param {string} key @param {*} value */
      async set(ns, key, value) {
        const fk = fullKey(ns, key);
        memFallback.set(fk, value); // write-through кеш для надёжности
        if (usingMem) return true;
        try { return await idbSet(fk, value); } catch (err) { console.error('[PyOS][Storage] set', err); return false; }
      },
      /** @param {string} ns @param {string} key */
      async del(ns, key) {
        const fk = fullKey(ns, key);
        memFallback.delete(fk);
        if (usingMem) return true;
        try { return await idbDel(fk); } catch (err) { console.error('[PyOS][Storage] del', err); return false; }
      },
      /** @param {string} ns @returns {Promise<string[]>} ключи внутри пространства */
      async keys(ns) {
        const prefix = ns + '/';
        if (usingMem) return [...memFallback.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
        try { return (await idbKeys(prefix)).map((k) => k.slice(prefix.length)); }
        catch (err) { console.error('[PyOS][Storage] keys', err); return []; }
      },
      /** @param {string} ns удалить всё пространство имён */
      async clear(ns) {
        const ks = await this.keys(ns);
        for (const key of ks) await this.del(ns, key);
        Bus.emit('storage:cleared', { ns });
      },
      /** Полная очистка всей базы (используется Settings wipe и doctor). */
      async wipeAll() {
        memFallback.clear();
        if (!usingMem && db) {
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction(DB_STORE, 'readwrite');
              tx.objectStore(DB_STORE).clear();
              tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
          } catch (err) { console.error('[PyOS][Storage] wipeAll', err); }
        }
        Bus.emit('storage:wiped', {});
      }
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 4: Theme (акценты, обои, эффекты)
  // ─────────────────────────────────────────────────────────
  const Theme = (() => {
    const ACCENTS = Object.freeze([
      { id: 'blue',   label: 'Синий',   acc: '#4f8cff', acc2: '#8a5cff' },
      { id: 'green',  label: 'Зелёный', acc: '#3ddc84', acc2: '#2ab5d8' },
      { id: 'pink',   label: 'Розовый', acc: '#ff5c9d', acc2: '#a45cff' },
      { id: 'gold',   label: 'Золото',  acc: '#ffb454', acc2: '#ff5c7a' },
      { id: 'cyan',   label: 'Циан',    acc: '#3fd6ff', acc2: '#4f8cff' },
      { id: 'violet', label: 'Фиолет',  acc: '#8a5cff', acc2: '#ff5ca8' }
    ]);
    const WALLS = Object.freeze([
      { id: 'aurora', label: 'Aurora' }, { id: 'sunset', label: 'Sunset' },
      { id: 'ocean', label: 'Ocean' },   { id: 'matrix', label: 'Matrix' },
      { id: 'carbon', label: 'Carbon' }, { id: 'grid', label: 'Grid' },
      { id: 'galaxy', label: 'Galaxy' }, { id: 'cyber', label: 'Cyber' }
    ]);
    let currentAccent = 'blue';
    let currentWall = 'aurora';
    let fxOn = true;

    /** Создаёт слой обоев, если его ещё нет (до монтирования Desktop). */
    function ensureWallLayer() {
      let wallEl = Utils.$('.py-wall');
      if (!wallEl) {
        const root = document.getElementById('pyos-root');
        if (!root) return null;
        wallEl = Utils.h('div', { class: 'py-wall', 'aria-hidden': 'true' });
        root.prepend(wallEl);
      }
      return wallEl;
    }

    return Object.freeze({
      listAccents: () => ACCENTS,
      listWalls: () => WALLS,
      getAccent: () => currentAccent,
      getWall: () => currentWall,
      fxEnabled: () => fxOn,
      /**
       * Применить акцент по id. Пишет CSS-переменные на :root.
       * @param {string} id
       */
      applyAccent(id) {
        const accent = ACCENTS.find((a) => a.id === id) || ACCENTS[0];
        currentAccent = accent.id;
        const rs = document.documentElement.style;
        rs.setProperty('--acc', accent.acc);
        rs.setProperty('--acc-2', accent.acc2);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', accent.acc);
        Bus.emit('theme:accent', { id: accent.id });
        return accent.id;
      },
      /** Применить обои по id (CSS-градиент, data-атрибут слоя). @param {string} id */
      applyWall(id) {
        const known = WALLS.some((w) => w.id === id);
        currentWall = known ? id : 'aurora';
        const wallEl = ensureWallLayer();
        if (wallEl) wallEl.dataset.wall = currentWall;
        Bus.emit('theme:wall', { id: currentWall });
        return currentWall;
      },
      /** Вкл/выкл стеклянные эффекты и анимации. @param {boolean} on */
      toggleFx(on) {
        fxOn = !!on;
        document.documentElement.classList.toggle('py-nofx', !fxOn);
        Bus.emit('theme:fx', { on: fxOn });
        return fxOn;
      },
      /** Полный рендер текущего состояния темы. */
      applyAll(state) {
        if (state?.accent) this.applyAccent(state.accent);
        if (state?.wall) this.applyWall(state.wall);
        this.toggleFx(state?.fx !== false);
      }
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 5: Settings (кеш над Storage, ns='settings')
  // ─────────────────────────────────────────────────────────
  const Settings = (() => {
    const NS = 'settings';
    const cache = new Map();
    const DEFAULTS = Object.freeze({
      'user.name': 'Гость',
      'user.avatarSeed': 'P',
      'accent': 'blue',
      'wallpaper': 'aurora',
      'fx': true,
      'sounds.on': true,
      'sounds.volume': 0.7,
      'jarvis.on': false,
      'jarvis.geminiKey': '',
      'oobe.done': false,
      'terminal.theme': 'green',
      'pinned': ['terminal', 'files', 'editor', 'settings'],
      'recent': []
    });
    let loaded = false;

    return Object.freeze({
      /** Асинхронно загружает настройки из Storage в кеш. */
      async load() {
        try {
          const keys = await Storage.keys(NS);
          for (const key of keys) cache.set(key, await Storage.get(NS, key));
          loaded = true;
        } catch (err) {
          console.error('[PyOS][Settings] load failed:', err);
        }
        return loaded;
      },
      /** @param {string} key @param {*} [def] */
      get(key, def) {
        if (cache.has(key)) return cache.get(key);
        if (DEFAULTS[key] !== undefined) return DEFAULTS[key];
        return def;
      },
      /** @param {string} key @param {*} value сохраняет и шлёт settings:change */
      async set(key, value) {
        cache.set(key, value);
        await Storage.set(NS, key, value);
        Bus.emit('settings:change', { key, value });
      },
      /** Подписка на изменения конкретной клавиши (или любой, key=null). */
      onChange(cb) {
        const handler = (detail) => { if (!detail || detail.key === cb.key || !cb.key) cb.fn(detail); };
        Bus.on('settings:change', handler);
        return () => Bus.off('settings:change', handler);
      },
      isLoaded: () => loaded,
      allDefaults: () => ({ ...DEFAULTS }),
      /** Сброс всех настроек + очистка пространства. */
      async wipe() {
        cache.clear();
        await Storage.clear(NS);
        Bus.emit('settings:wiped', {});
      }
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 6: FileSystem (VFS поверх Storage, ns='vfs')
  // ─────────────────────────────────────────────────────────
  const FileSystem = (() => {
    const NS = 'vfs';

    /** Нормализует путь к абсолютному: '/', '../a' → '/a'. */
    function resolve(path) {
      const parts = String(path || '/').split('/').filter(Boolean);
      const out = [];
      for (const part of parts) {
        if (part === '.') continue;
        if (part === '..') out.pop();
        else out.push(part);
      }
      return '/' + out.join('/');
    }
    const parentOf = (path) => { const p = resolve(path); const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
    const baseName = (path) => { const p = resolve(path); const i = p.lastIndexOf('/'); return i === p.length - 1 ? '' : p.slice(i + 1); };

    async function stat(path) {
      return Storage.get(NS, resolve(path));
    }

    /** Автосидинг при первом запуске. */
    async function seed() {
      const marker = await Storage.get(NS, '__seeded__');
      if (marker) return false;
      const seeds = [
        ['/Документы', { type: 'dir', mtime: Date.now() }],
        ['/Проекты', { type: 'dir', mtime: Date.now() }],
        ['/Заметки', { type: 'dir', mtime: Date.now() }],
        ['/Документы/приветствие.md', { type: 'file', content: '# Добро пожаловать в PyOS 5.0\nЭто файл из **виртуальной ФС** на IndexedDB.\n\n*Открой* его в Редакторе или Заметках.', mtime: Date.now() }],
        ['/Проекты/main.py', { type: 'file', content: 'print("Hello from PyOS Quantum!")\n', mtime: Date.now() }]
      ];
      for (const [path, rec] of seeds) await Storage.set(NS, path, rec);
      await Storage.set(NS, '__seeded__', true);
      return true;
    }

    return Object.freeze({
      resolve, parentOf, baseName, stat,
      /** @param {string} path @returns {Promise<Array<{name,path,type,size,mtime}>>} */
      async list(path) {
        const dir = resolve(path);
        const keys = await Storage.keys(NS);
        const out = [];
        for (const key of keys) {
          if (key === '__seeded__' || !key.startsWith(dir === '/' ? '/' : dir + '/')) continue;
          const rel = key.slice(dir === '/' ? 1 : dir.length + 1);
          if (!rel) continue;
          const seg = rel.split('/')[0];
          const isDirChild = rel.includes('/');
          const childPath = (dir === '/' ? '' : dir) + '/' + seg;
          if (isDirChild) {
            if (!out.some((r) => r.path === childPath)) out.push({ name: seg, path: childPath, type: 'dir', size: 0, mtime: 0 });
          } else {
            const rec = await Storage.get(NS, key);
            if (rec) out.push({ name: seg, path: childPath, type: rec.type, size: rec.type === 'file' ? (rec.content || '').length : 0, mtime: rec.mtime || 0 });
          }
        }
        return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ru') : a.type === 'dir' ? -1 : 1));
      },
      /** @param {string} path @returns {Promise<string|null>} */
      async read(path) {
        const rec = await stat(path);
        return rec && rec.type === 'file' ? rec.content : null;
      },
      /** @param {string} path @param {string} content */
      async write(path, content) {
        const p = resolve(path);
        if (p === '/') throw new Error('Нельзя перезаписать корень');
        await Storage.set(NS, p, { type: 'file', content: String(content), mtime: Date.now() });
        Bus.emit('fs:changed', { path: p });
        return p;
      },
      /** @param {string} path */
      async mkdir(path) {
        const p = resolve(path);
        if (p === '/') return p;
        const existing = await stat(p);
        if (!existing) await Storage.set(NS, p, { type: 'dir', mtime: Date.now() });
        Bus.emit('fs:changed', { path: p });
        return p;
      },
      /** Переименование/перемещение вместе с поддеревом. */
      async rename(oldPath, newPath) {
        const from = resolve(oldPath), to = resolve(newPath);
        if (from === to) return to;
        if (to.startsWith(from + '/')) throw new Error('Нельзя переместить папку внутрь себя');
        const rec = await stat(from);
        if (!rec) throw new Error('Источник не найден: ' + from);
        const keys = await Storage.keys(NS);
        const affected = keys.filter((k) => k === from || k.startsWith(from + '/'));
        for (const key of affected) {
          const value = await Storage.get(NS, key);
          const mapped = to + key.slice(from.length);
          await Storage.set(NS, mapped, value);
          await Storage.del(NS, key);
        }
        Bus.emit('fs:changed', { path: to, movedFrom: from });
        return to;
      },
      /** Удаление файла или рекурсивно папки. */
      async remove(path) {
        const p = resolve(path);
        if (p === '/') throw new Error('Нельзя удалить корень');
        const keys = await Storage.keys(NS);
        const doomed = keys.filter((k) => k === p || k.startsWith(p + '/'));
        for (const key of doomed) await Storage.del(NS, key);
        Bus.emit('fs:changed', { path: p, removed: true });
        return doomed.length;
      },
      /** @returns {Promise<number>} суммарный объём содержимого в байтах */
      async usage() {
        const keys = await Storage.keys(NS);
        let total = 0;
        for (const key of keys) {
          if (key === '__seeded__') continue;
          const rec = await Storage.get(NS, key);
          if (rec?.type === 'file') total += (rec.content || '').length;
        }
        return total;
      },
      seed
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 7: Registry (реестр приложений)
  // ─────────────────────────────────────────────────────────
  const Registry = (() => {
    /** @type {Map<string,Object>} */
    const apps = new Map();

    /** Валидация манифеста. Возвращает список ошибок. */
    function validate(manifest) {
      const errors = [];
      if (!manifest || typeof manifest !== 'object') return ['манифест должен быть объектом'];
      if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) errors.push('id обязателен (kebab-case)');
      if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('name обязателен');
      if (typeof manifest.init !== 'function') errors.push('init должен быть функцией');
      return errors;
    }

    return Object.freeze({
      /**
       * Зарегистрировать приложение. При занятом id — замена.
       * @param {Object} manifest {id,name,icon,category,width,height,single,init,permissions}
       * @returns {boolean} успех
       */
      register(manifest) {
        const errors = validate(manifest);
        if (errors.length) { console.error('[PyOS][Registry]', errors.join('; ')); return false; }
        const normalized = {
          single: true, category: 'utility', width: 720, height: 520, icon: manifest.id,
          permissions: [], ...manifest
        };
        apps.set(normalized.id, Object.freeze(normalized));
        Bus.emit('registry:registered', { id: normalized.id });
        return true;
      },
      unregister(id) {
        const had = apps.delete(id);
        if (had) Bus.emit('registry:unregistered', { id });
        return had;
      },
      get: (id) => apps.get(id),
      list: () => [...apps.values()],
      has: (id) => apps.has(id)
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 8: Launcher (запуск + recent)
  // ─────────────────────────────────────────────────────────
  const Launcher = (() => {
    const RECENT_LIMIT = 12;
    /** @type {Map<string,WeakRef|Object>} appId → handle окна (слабая ссылка через обычный map с очисткой) */
    const running = new Map();

    return Object.freeze({
      /**
       * Запустить приложение по id.
       * @param {string} id
       * @param {Object} [opts] доп. параметры окна
       * @returns {Promise<Object|null>} window-handle
       */
      async launch(id, opts = {}) {
        const manifest = Registry.get(id);
        if (!manifest) { console.warn('[PyOS][Launcher] Нет такого приложения:', id); return null; }
        const ui = window.PyOSUI;
        if (!ui?.Windows) { console.warn('[PyOS][Launcher] UI ещё не готов'); return null; }

        // single-instance: фокус существующего
        if (manifest.single && running.has(id)) {
          const existing = running.get(id);
          if (existing && document.body.contains(existing.el)) {
            ui.Windows.focus(id);
            if (opts.payload) Bus.emit('app:payload', { id, payload: opts.payload });
            return existing;
          }
          running.delete(id);
        }

        const winHandle = ui.Windows.create({
          id, title: manifest.name, icon: manifest.icon,
          width: manifest.width, height: manifest.height
        });
        running.set(id, winHandle);

        // init(app-context) — ровно один раз на окно
        const appContext = {
          id, body: winHandle.body, window: winHandle, manifest,
          core: window.PyOSCore, ui,
          onDispose: (fn) => winHandle.addDispose(fn)
        };
        try {
          await manifest.init(appContext);
        } catch (err) {
          console.error(`[PyOS][Launcher] init("${id}") упало:`, err);
          winHandle.body.append(Utils.h('div', { class: 'py-note py-note--err', style: { margin: '16px' } },
            'Приложение не запустилось: ' + err.message));
        }

        winHandle.addDispose(() => running.delete(id));

        // recent
        const recent = [id, ...(Settings.get('recent', []) || []).filter((r) => r !== id)].slice(0, RECENT_LIMIT);
        Settings.set('recent', recent);

        Bus.emit('launcher:launched', { id });
        if (opts.payload) Bus.emit('app:payload', { id, payload: opts.payload });
        return winHandle;
      },
      /** @returns {string[]} последние запущенные id */
      recent: () => Settings.get('recent', []) || [],
      isRunning: (id) => running.has(id) && document.body.contains(running.get(id).el),
      listRunning: () => [...running.keys()].filter((id) => document.body.contains(running.get(id).el))
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 10: Sandbox (изолированный app-объект плагина)
  // ─────────────────────────────────────────────────────────
  const Sandbox = (() => {
    const VFS_ROOT = '/Плагины';

    /** Scoped-файлы плагина: только под /Плагины/<id>. */
    function scopedFiles(pluginId) {
      const prefix = `${VFS_ROOT}/${pluginId}`;
      const guard = (path) => {
        const abs = FileSystem.resolve(path);
        if (abs !== prefix && !abs.startsWith(prefix + '/')) throw new Error('Доступ вне песочницы запрещён: ' + abs);
        return abs;
      };
      return Object.freeze({
        read: (p) => FileSystem.read(guard(p)),
        write: (p, c) => FileSystem.write(guard(p), c),
        list: (p) => FileSystem.list(guard(p || prefix)),
        mkdir: (p) => FileSystem.mkdir(guard(p)),
        remove: (p) => FileSystem.remove(guard(p))
      });
    }

    /** Scoped-storage: ns='plugins', ключ '<id>/...'. */
    function scopedStorage(pluginId) {
      return Object.freeze({
        get: (key) => Storage.get('plugins', `${pluginId}/${key}`),
        set: (key, value) => Storage.set('plugins', `${pluginId}/${key}`, value),
        del: (key) => Storage.del('plugins', `${pluginId}/${key}`),
        keys: async () => (await Storage.keys('plugins')).filter((k) => k.startsWith(pluginId + '/')).map((k) => k.slice(pluginId.length + 1)),
        clear: async () => { for (const k of await Storage.keys('plugins')) if (k.startsWith(pluginId + '/')) await Storage.del('plugins', k); }
      });
    }

    /** Namespaced-bus: события вида 'plug:<id>::<event>'. */
    function scopedBus(pluginId) {
      const scope = (event) => `plug:${pluginId}::${event}`;
      const listeners = new Map();
      return Object.freeze({
        on(event, fn) { const wrapped = (detail) => fn(detail); listeners.set(event, wrapped); Bus.on(scope(event), wrapped); },
        off(event, fn) { const wrapped = listeners.get(event); if (wrapped) { Bus.off(scope(event), wrapped); listeners.delete(event); } },
        emit(event, detail) { Bus.emit(scope(event), detail); }
      });
    }

    /** Набор стилизованных builders для плагинов (без доступа к document напрямую). */
    const UiKit = Object.freeze({
      Button: (label, onClick, variant = '') => Utils.h('button', { class: 'py-btn' + (variant ? ' py-btn--' + variant : ''), onclick: onClick, type: 'button' }, label),
      Input: (placeholder = '') => Utils.h('input', { class: 'py-input', placeholder, type: 'text' }),
      Area: (placeholder = '') => Utils.h('textarea', { class: 'py-area', placeholder }),
      Card: (...kids) => Utils.h('div', { class: 'py-card' }, ...kids),
      Heading: (text) => Utils.h('h3', { style: { fontSize: '15px', marginBottom: '8px' } }, text),
      Text: (text) => Utils.h('p', { class: 'py-txt-2' }, text),
      Row: (...kids) => Utils.h('div', { class: 'py-flex py-gap-8' }, ...kids),
      Column: (...kids) => Utils.h('div', { class: 'py-col py-gap-8' }, ...kids),
      Switch: (checked, onChange) => Utils.h('button', { class: 'py-sw', role: 'switch', 'aria-checked': String(!!checked), onclick: (e) => { const next = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', String(next)); onChange(next); } }),
      Progress: (value = 0) => Utils.h('div', { class: 'py-prog' }, Utils.h('i', { style: { width: Utils.clamp(value, 0, 100) + '%' } }))
    });

    return Object.freeze({
      /**
       * Создать замороженный контекст для плагина.
       * @param {Object} manifest
       * @param {Object} windowHandle из Windows.create
       */
      create(manifest, windowHandle) {
        const pluginId = manifest.id;
        return Object.freeze({
          body: windowHandle.body,
          window: Object.freeze({
            setTitle: (t) => windowHandle.setTitle(t),
            close: () => windowHandle.close()
          }),
          manifest: Object.freeze({ ...manifest }),
          storage: scopedStorage(pluginId),
          files: scopedFiles(pluginId),
          notify: (title, text, icon) => window.PyOSUI?.Toast?.show(title, text, icon || 'plug'),
          bus: scopedBus(pluginId),
          ui: UiKit,
          jarvis: Object.freeze({
            addCommand: (regex, fn) => Jarvis.addCommand(regex, fn, pluginId),
            say: (text) => Jarvis.say(text)
          }),
          utils: Object.freeze({ rnd: Utils.rnd, clamp: Utils.clamp, formatBytes: Utils.formatBytes, uuid: Utils.uuid })
        });
      },
      VFS_ROOT
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 9: PluginLoader (Blob URL + dynamic import, без eval)
  // ─────────────────────────────────────────────────────────
  const PluginLoader = (() => {
    /** @type {Map<string,{manifest:Object,blobUrl:string}>} */
    const loaded = new Map();

    function validateManifest(manifest) {
      if (!manifest || typeof manifest !== 'object') return 'manifest должен быть объектом';
      if (typeof manifest.id !== 'string' || !/^[a-z][a-z0-9-]{2,}$/.test(manifest.id)) return 'manifest.id: строка, kebab-case, от 3 символов';
      if (typeof manifest.name !== 'string' || !manifest.name) return 'manifest.name обязателен';
      if (typeof manifest.version !== 'string') return 'manifest.version обязателен (строка)';
      if (manifest.entry !== 'default') return 'manifest.entry поддерживается только "default" (export default fn)';
      return null;
    }

    return Object.freeze({
      /**
       * Безопасная установка плагина: код как ES-модуль через Blob URL.
       * Никакого eval/new Function.
       * @param {string} code исходник модуля с export default function
       * @param {Object} manifest {id,name,version,entry,icon?,width?,height?}
       */
      async install(code, manifest) {
        const problem = validateManifest(manifest);
        if (problem) throw new Error('Манифест: ' + problem);
        if (loaded.has(manifest.id)) throw new Error('Плагин уже установлен: ' + manifest.id);
        if (Registry.has(manifest.id)) throw new Error('Конфликт id с системным приложением: ' + manifest.id);
        if (typeof code !== 'string' || !code.trim()) throw new Error('Пустой код плагина');

        const blob = new Blob([code], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const moduleNamespace = await import(/* webpackIgnore: true */ blobUrl);
          const factory = moduleNamespace.default;
          if (typeof factory !== 'function') throw new Error('Плагин должен иметь export default function');

          const fullManifest = {
            id: manifest.id, name: manifest.name, version: manifest.version,
            icon: manifest.icon || 'plug', category: 'plugin',
            width: manifest.width || 640, height: manifest.height || 460,
            single: true, permissions: manifest.permissions || [],
            init: async (app) => { await factory(app); }
          };
          if (!Registry.register(fullManifest)) throw new Error('Реестр отверг манифест');
          loaded.set(manifest.id, { manifest: fullManifest, blobUrl, factory });
          await Storage.set('plugins', manifest.id, { code, manifest });
          await Storage.set('plugins', manifest.id + '/__enabled__', true);
          Bus.emit('plugins:installed', { id: manifest.id });
          return fullManifest;
        } finally {
          // отзываем URL сразу после импорта — код уже в памяти Registry
          URL.revokeObjectURL(blobUrl);
          const entry = loaded.get(manifest.id);
          if (entry) entry.blobUrl = '';
        }
      },

      /** Удалить плагин из реестра и хранилища. */
      async uninstall(id) {
        Registry.unregister(id);
        loaded.delete(id);
        await Storage.del('plugins', id);
        await Storage.del('plugins', id + '/__enabled__');
        Bus.emit('plugins:uninstalled', { id });
        return true;
      },

      async enable(id) {
        const saved = await Storage.get('plugins', id);
        if (!saved) throw new Error('Плагин не найден в хранилище: ' + id);
        if (loaded.has(id)) return true;
        await this.install(saved.code, saved.manifest);
        await Storage.set('plugins', id + '/__enabled__', true);
        return true;
      },

      async disable(id) {
        await this.uninstall(id);
        const saved = await Storage.get('plugins', id);
        if (saved) await Storage.set('plugins', id, saved); // restore code after uninstall wiped it
        await Storage.set('plugins', id + '/__enabled__', false);
        return true;
      },

      /** Список установленных (из хранилища) с флагом активности. */
      async list() {
        const keys = await Storage.keys('plugins');
        const ids = [...new Set(keys.map((k) => k.split('/')[0]))].filter((k) => k !== '__proto__');
        const out = [];
        for (const id of ids) {
          const rec = await Storage.get('plugins', id);
          if (!rec?.manifest) continue;
          out.push({ manifest: rec.manifest, enabled: (await Storage.get('plugins', id + '/__enabled__')) !== false, active: loaded.has(id) });
        }
        return out;
      },
      isInstalled: (id) => loaded.has(id)
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 11: Jarvis (голосовой ассистент, Web Speech API)
  // ─────────────────────────────────────────────────────────
  const Jarvis = (() => {
    /** @type {Array<{pattern:RegExp,fn:Function,owner:string}>} */
    const commands = [];
    let recognition = null;
    let listening = false;
    let enabled = false;

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

    /** Озвучить текст через TTS (если доступен и звуки включены). */
    function say(text) {
      Bus.emit('jarvis:said', { text });
      if (Settings.get('sounds.on', true) === false) return;
      if (!('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ru-RU';
        utterance.rate = 1.05;
        utterance.volume = Number(Settings.get('sounds.volume', 0.7));
        window.speechSynthesis.speak(utterance);
      } catch (err) { console.warn('[PyOS][Jarvis] TTS недоступен:', err); }
    }

    /** Короткий звуковой сигнал через WebAudio (без файлов). */
    function beep(freq = 660, ms = 90) {
      if (Settings.get('sounds.on', true) === false) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        beep.ctx = beep.ctx || new Ctx();
        const osc = beep.ctx.createOscillator();
        const gain = beep.ctx.createGain();
        osc.frequency.value = freq; osc.type = 'sine';
        gain.gain.setValueAtTime(0.08, beep.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, beep.ctx.currentTime + ms / 1000);
        osc.connect(gain).connect(beep.ctx.destination);
        osc.start(); osc.stop(beep.ctx.currentTime + ms / 1000);
      } catch (err) { /* звук не критичен */ }
    }

    const norm = (text) => String(text).toLowerCase().replace(/ё/g, 'е').trim().replace(/[.,!?]+$/g, '');

    /** Обработать текстовую команду. @returns {Promise<boolean>} найдена ли команда */
    async function process(text) {
      const clean = norm(text);
      if (!clean) return false;
      Bus.emit('jarvis:heard', { text });
      for (const cmd of commands) {
        const match = cmd.pattern.exec(clean);
        if (match) {
          try { await cmd.fn(match, text); } catch (err) { console.error('[PyOS][Jarvis] команда упала:', err); say('Произошла ошибка при выполнении команды.'); }
          return true;
        }
      }
      say('Не понял команду: ' + text);
      return false;
    }

    /** Регистрация встроенных голосовых команд (20+). */
    function registerBuiltins() {
      const launchCmd = (id, re) => addCommand(re, () => {
        window.PyOSCore.Launcher.launch(id);
        say('Запускаю: ' + (window.PyOSCore.Registry.get(id)?.name || id));
      });
      addCommand(/^(?:привет|здорово|хай)$/, (_m, raw) => say('Привет! Я Джарвис, голосовой ассистент PyOS Quantum.'));
      addCommand(/^как дела$/, () => say('Все системы в норме.'));
      addCommand(/^кто ты/, () => say('Я ассистент операционной среды PyOS.'));
      addCommand(/^что ты умеешь/, () => say('Открывать приложения, менять тему и обои, управлять звуком, искать файлы и выполнять команды.'));
      addCommand(/^(?:время|который час)$/, () => say('Сейчас ' + Utils.formatTime(Date.now())));
      addCommand(/^какая дата/, () => say('Сегодня ' + Utils.formatDate(Date.now())));
      launchCmd('terminal', /^открой терминал$/);
      launchCmd('files', /^открой файлы$/);
      launchCmd('editor', /^открой редактор$/);
      launchCmd('calc', /^(?:открой )?калькулятор$/);
      launchCmd('notes', /^открой заметки$/);
      launchCmd('settings', /^(?:открой )?настройки$/);
      launchCmd('about', /^о системе$/);
      launchCmd('sn-music', /^(?:включи |открой )?музыка$/);
      launchCmd('sn-cal', /^открой календарь$/);
      launchCmd('sn-tasks', /^открой задачи$/);
      launchCmd('sn-mail', /^открой почту$/);
      launchCmd('sn-vault', /^открой хранилище паролей$/);
      launchCmd('sn-snake', /^открой змейку$/);
      launchCmd('sn-2048', /^(?:открой )?2048$/);
      launchCmd('plugin-studio', /^открой студию плагинов$/);
      addCommand(/(?:смени|поставь) (?:фон|обои) (aurora|sunset|ocean|matrix|carbon|grid|galaxy|cyber)/, (m) => { Theme.applyWall(m[1]); Settings.set('wallpaper', m[1]); say('Обои: ' + m[1]); });
      addCommand(/(?:смени|поставь) (?:цвет|акцент) (blue|green|pink|gold|cyan|violet)/, (m) => { Theme.applyAccent(m[1]); Settings.set('accent', m[1]); say('Акцент: ' + m[1]); });
      addCommand(/^громкость (\d+)/, (m) => { const v = Utils.clamp(Number(m[1]) / 100, 0, 1); Settings.set('sounds.volume', v); Bus.emit('sound:volume', { value: v }); say('Громкость ' + m[1] + ' процентов'); });
      addCommand(/^(?:выключи|убери) звук$/, () => { Settings.set('sounds.on', false); say('Звук выключен'); });
      addCommand(/^включи звук$/, () => { Settings.set('sounds.on', true); say('Звук включён'); });
      addCommand(/^(?:покажи )?уведомления$/, () => { window.PyOSUI?.TrayCenter?.open(); say('Центр уведомлений открыт'); });
      addCommand(/^(?:найди|поиск)[:\s]+(.+)/, (m) => { window.PyOSUI?.CommandPalette?.open(m[1]); say('Ищу: ' + m[1]); });
      addCommand(/^выполни команду (.+)/, async (m) => { const r = await Shell.run(m[1]); say(r.ok ? ('Выполнено. ' + (r.out || '')).slice(0, 160) : 'Ошибка: ' + r.err); });
      addCommand(/^закрой все окна$/, () => { window.PyOSUI?.Windows?.closeAll?.(); say('Все окна закрыты'); });
      addCommand(/^спасибо$/, () => say('Всегда пожалуйста.'));
      addCommand(/^что нового$/, () => say('Версия 5.0 Quantum: снап окон, виртуальная ФС, студия плагинов и голосовое управление.'));
    }

    /**
     * Добавить голосовую команду.
     * @param {RegExp} pattern регулярка по нормализованному тексту
     * @param {Function} fn (match, rawText) => void|Promise
     * @param {string} [owner] id плагина-владельца
     */
    function addCommand(pattern, fn, owner = 'system') {
      if (!(pattern instanceof RegExp) || typeof fn !== 'function') return false;
      commands.push({ pattern, fn, owner });
      return true;
    }

    function removeCommandsBy(owner) {
      for (let i = commands.length - 1; i >= 0; i--) if (commands[i].owner === owner) commands.splice(i, 1);
    }

    /** Запустить распознавание речи. */
    function listen() {
      if (!SpeechRecognitionCtor) { say('Распознавание речи не поддерживается этим браузером. Используйте ввод текста.'); return false; }
      if (listening) return true;
      recognition = new SpeechRecognitionCtor();
      recognition.lang = 'ru-RU';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        process(transcript);
      };
      recognition.onend = () => { listening = false; Bus.emit('jarvis:state', { listening: false }); };
      recognition.onerror = () => { listening = false; Bus.emit('jarvis:state', { listening: false }); };
      try { recognition.start(); listening = true; Bus.emit('jarvis:state', { listening: true }); beep(880, 60); return true; }
      catch (err) { console.warn('[PyOS][Jarvis] старт распознавания не удался:', err); return false; }
    }

    function stop() {
      if (recognition) { try { recognition.stop(); } catch (err) { /* noop */ } }
      listening = false;
      Bus.emit('jarvis:state', { listening: false });
    }

    /** Проверка Gemini API-ключа (опционально): HEAD-запрос к models endpoint. */
    async function testGemini(key) {
      const apiKey = key ?? Settings.get('jarvis.geminiKey', '');
      if (!apiKey) return { ok: false, message: 'Ключ не задан' };
      try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey));
        if (!response.ok) return { ok: false, message: 'HTTP ' + response.status };
        const data = await response.json();
        return { ok: true, message: `Ключ рабочий, моделей доступно: ${(data.models || []).length}` };
      } catch (err) {
        return { ok: false, message: 'Сеть недоступна: ' + err.message };
      }
    }

    return Object.freeze({
      enable(bool) { enabled = !!bool; Settings.set('jarvis.on', enabled); if (!enabled) stop(); Bus.emit('jarvis:enable', { on: enabled }); },
      isEnabled: () => enabled,
      isListening: () => listening,
      speechSupported: () => !!SpeechRecognitionCtor,
      say, beep, process, addCommand, removeCommandsBy, listen, stop, testGemini,
      commandCount: () => commands.length,
      /** Инжект реального Shell позже (Kernel связывает на boot). */
      _shell: null,
      registerBuiltins
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 12a: Shell (общий исполнитель команд — для Jarvis/Terminal)
  // ─────────────────────────────────────────────────────────
  const Shell = (() => {
    /** @type {Map<string,{desc:string,run:(args:string[])=>Promise<string>|string}>} */
    const commands = new Map();

    const def = (name, desc, run) => commands.set(name, { desc, run });

    def('help', 'список команд', () => [...commands.entries()].map(([n, c]) => n.padEnd(12) + c.desc).join('\n'));
    def('about', 'о системе', () => 'PyOS Studio 5.0 «Quantum» · vanilla JS · IndexedDB VFS');
    def('echo', 'печатает аргументы', (args) => args.join(' '));
    def('ls', 'список файлов в папке', async (args) => {
      const entries = await FileSystem.list(args[0] || '/');
      return entries.map((e) => (e.type === 'dir' ? '📁 ' : '📄 ') + e.name).join('\n') || '(пусто)';
    });
    def('cat', 'показать содержимое файла', async (args) => {
      if (!args[0]) return 'использование: cat <путь>';
      const content = await FileSystem.read(args[0]);
      return content === null ? 'файл не найден' : content;
    });
    def('touch', 'создать файл', async (args) => { if (!args[0]) return 'использование: touch <путь>'; await FileSystem.write(args[0], ''); return 'создан: ' + args[0]; });
    def('mkdir', 'создать папку', async (args) => { if (!args[0]) return 'использование: mkdir <путь>'; await FileSystem.mkdir(args[0]); return 'создана: ' + args[0]; });
    def('rm', 'удалить файл/папку', async (args) => { if (!args[0]) return 'использование: rm <путь>'; const n = await FileSystem.remove(args[0]); return n ? `удалено записей: ${n}` : 'не найдено'; });
    def('pwd', 'текущий корень VFS', () => '/');
    def('run', 'запустить приложение', (args) => { if (!args[0]) return 'использование: run <id>'; if (!Registry.has(args[0])) return 'нет приложения: ' + args[0]; Launcher.launch(args[0]); return 'запуск: ' + args[0]; });
    def('apps', 'список приложений', () => Registry.list().map((a) => a.id.padEnd(14) + a.name).join('\n'));
    def('theme', 'сменить акцент: theme <blue|green|pink|gold|cyan|violet>', (args) => { Theme.applyAccent(args[0] || 'blue'); Settings.set('accent', Theme.getAccent()); return 'акцент: ' + Theme.getAccent(); });
    def('wallpaper', 'сменить обои: wallpaper <aurora|...|cyber>', (args) => { Theme.applyWall(args[0] || 'aurora'); Settings.set('wallpaper', Theme.getWall()); return 'обои: ' + Theme.getWall(); });
    def('jarvis', 'команда для Джарвиса: jarvis <текст>', async (args) => { const found = await Jarvis.process(args.join(' ')); return found ? 'джарвис выполнил' : 'джарвис не понял'; });
    def('plugins', 'список плагинов', async () => { const list = await PluginLoader.list(); return list.length ? list.map((p) => `${p.active ? '●' : '○'} ${p.manifest.id} v${p.manifest.version}`).join('\n') : 'плагинов нет'; });
    def('clear', 'очистить вывод терминала', () => '\x1CCLEAR');
    def('neofetch', 'системная сводка', () => [
      '        ▄▄▄▄▄        user@pyos-quantum',
      '     ▄█████████▄     -----------------',
      '    ███▀     ▀███    OS: PyOS Studio 5.0 Quantum',
      '    ███  ▄▄▄  ███    Kernel: VanillaJS ES2022',
      '    █████████████    Shell: pysh 1.0',
      '     ▀█████████▀     WM: Quantum Compositor',
      '        ▀▀▀▀▀        Storage: IndexedDB',
      `                   Apps: ${Registry.list().length}   Uptime: ${Math.round((Date.now() - BOOT_TIME) / 1000)}s`
    ].join('\n'));
    def('calc', 'быстрое вычисление: calc 2+2', (args) => {
      const expr = args.join('');
      if (!/^[\d+\-*/%().\s^]+$/.test(expr)) return 'разрешены только цифры и + - * / % ( ) ^ .';
      // безопасный ручной парсер без eval
      return String(safeEval(expr));
    });

    /** Рекурсивный спуск: + - * / % ^ скобки унарный минус. */
    function safeEval(src) {
      let pos = 0;
      const s = src.replace(/\s+/g, '');
      const peek = () => s[pos];
      const eat = (ch) => { if (s[pos] === ch) { pos++; return true; } return false; };
      function parseExpr() {
        let left = parseTerm();
        while (peek() === '+' || peek() === '-') { const op = s[pos++]; const right = parseTerm(); left = op === '+' ? left + right : left - right; }
        return left;
      }
      function parseTerm() {
        let left = parsePow();
        while (peek() === '*' || peek() === '/' || peek() === '%') {
          const op = s[pos++]; const right = parsePow();
          if ((op === '/' || op === '%') && right === 0) throw new Error('деление на ноль');
          left = op === '*' ? left * right : op === '/' ? left / right : left % right;
        }
        return left;
      }
      function parsePow() {
        const base = parseAtom();
        if (eat('^')) return Math.pow(base, parsePow());
        return base;
      }
      function parseAtom() {
        if (eat('(')) { const v = parseExpr(); if (!eat(')')) throw new Error('нет закрывающей скобки'); return v; }
        const neg = eat('-');
        const start = pos;
        while (pos < s.length && /[\d.]/.test(s[pos])) pos++;
        if (start === pos) throw new Error('ошибка разбора у позиции ' + pos);
        const num = parseFloat(s.slice(start, pos));
        return neg ? -num : num;
      }
      const result = parseExpr();
      if (pos < s.length) throw new Error('лишние символы');
      return result;
    }

    return Object.freeze({
      /** Выполнить строку команды. @returns {Promise<{ok:boolean,out:string,err:string}>} */
      async run(line) {
        const [name, ...args] = String(line).trim().split(/\s+/);
        const cmd = commands.get(name);
        if (!cmd) return { ok: false, out: '', err: 'команда не найдена: ' + name };
        try {
          const out = await cmd.run(args);
          return { ok: true, out: out === undefined ? '' : String(out), err: '' };
        } catch (err) {
          return { ok: false, out: '', err: err.message };
        }
      },
      names: () => [...commands.keys()],
      describe: (name) => commands.get(name)?.desc || '',
      safeEval
    });
  })();

  // ─────────────────────────────────────────────────────────
  // Module 12: Kernel (DI-контейнер + boot)
  // ─────────────────────────────────────────────────────────
  const Kernel = (() => {
    /** @type {Map<string,Object>} */
    const modules = new Map();
    let booted = false;

    return Object.freeze({
      register(name, instance) { modules.set(name, instance); },
      get(name) { return modules.get(name); },
      isBooted: () => booted,
      uptimeMs: () => Date.now() - BOOT_TIME,
      /**
       * Асинхронная загрузка ядра. Не трогает UI.
       * 1) проверка IndexedDB 2) Settings 3) FS-sid 4) тема 5) OOBE-флаг 6) ready
       */
      async boot() {
        const stages = [];
        try {
          const persistent = await Storage.init();
          stages.push(persistent ? 'storage: IDB' : 'storage: memory');
        } catch (err) { console.error('[PyOS][Kernel] storage init:', err); stages.push('storage: FAILED'); }

        try { await Settings.load(); stages.push('settings: ok'); }
        catch (err) { console.error('[PyOS][Kernel] settings load:', err); }

        try { await FileSystem.seed(); stages.push('vfs: seeded'); }
        catch (err) { console.error('[PyOS][Kernel] vfs seed:', err); }

        try {
          Theme.applyAll({ accent: Settings.get('accent'), wall: Settings.get('wallpaper'), fx: Settings.get('fx') });
          stages.push('theme: applied');
        } catch (err) { console.error('[PyOS][Kernel] theme:', err); }

        try {
          Jarvis.enable(!!Settings.get('jarvis.on', false));
          Jarvis.registerBuiltins();
          stages.push('jarvis: ready');
        } catch (err) { console.error('[PyOS][Kernel] jarvis:', err); }

        booted = true;
        Bus.emit('kernel:ready', { stages, oobeDone: !!Settings.get('oobe.done', false) });
        console.info('[PyOS] Kernel ready:', stages.join(' · '));
        return { stages };
      }
    });
  })();

  // ─────────────────────────────────────────────────────────
  // PYOS_DOCTOR() — консольная диагностика
  // ─────────────────────────────────────────────────────────
  window.PYOS_DOCTOR = async function PYOS_DOCTOR() {
    const problems = [];
    const checks = [];
    const check = (name, ok, note = '') => { checks.push({ name, ok, note }); if (!ok) problems.push(name + (note ? ': ' + note : '')); };

    check('core loaded', !!window.PyOSCore);
    check('ui loaded', !!window.PyOSUI);
    check('apps loaded', !!window.PyOSApps);
    check('kernel booted', Kernel.isBooted());
    check('storage persistent', Storage.isPersistent(), 'fallback in-memory');
    const expectedIcons = ['term', 'files', 'code', 'calc', 'notes', 'gear', 'info', 'plug', 'mic', 'power', 'search', 'lock', 'restart', 'plus', 'trash', 'edit', 'folder', 'file', 'pyfile', 'doc', 'play', 'save', 'refresh', 'palette', 'wave', 'user', 'star', 'close', 'minus', 'square', 'check', 'x', 'chevron',
      'sn-music', 'sn-brush', 'sn-calendar', 'sn-mail', 'sn-tasks', 'sn-vault', 'sn-lang', 'sn-pixel', 'sn-alarm', 'sn-game', 'sn-grid', 'sn-qr'];
    const missingIcons = expectedIcons.filter((n) => !document.getElementById('ic-' + n));
    check('svg sprite icons', missingIcons.length === 0, missingIcons.join(','));
    const snIds = ['sn-music', 'sn-canvas', 'sn-cal', 'sn-mail', 'sn-tasks', 'sn-vault', 'sn-trans', 'sn-pixel', 'sn-assist', 'sn-snake', 'sn-2048', 'sn-qr'];
    const missingSn = snIds.filter((id) => !Registry.has(id));
    check('12 SN apps registered', missingSn.length === 0, missingSn.join(','));
    check('jarvis commands ≥ 20', Jarvis.commandCount() >= 20, 'count=' + Jarvis.commandCount());
    check('shell commands ≥ 15', Shell.names().length >= 15, 'count=' + Shell.names().length);
    let fsOk = false;
    try { await FileSystem.mkdir('/__doctor__'); await FileSystem.write('/__doctor__/t.txt', 'ok'); fsOk = (await FileSystem.read('/__doctor__/t.txt')) === 'ok'; await FileSystem.remove('/__doctor__'); } catch (err) { /* ignore */ }
    check('vfs read/write', fsOk);
    check('no eval usage', !/\beval\s*\(|new\s+Function\s*\(/.test([...document.querySelectorAll('script')].map((s) => s.src).join('')), 'static scan');

    const summary = { version: '5.0.0', codename: 'Quantum', passed: checks.filter((c) => c.ok).length, failed: problems.length, checks, problems };
    console.groupCollapsed('%c PYOS DOCTOR ', 'background:#4f8cff;color:#fff;border-radius:4px');
    for (const c of checks) console.log(`${c.ok ? '✅' : '❌'} ${c.name}${c.note ? ' — ' + c.note : ''}`);
    console.log(problems.length ? '⚠️ Проблемы: ' + problems.join('; ') : '✨ Ошибок не найдено');
    console.groupEnd();
    return summary;
  };

  // ─────────────────────────────────────────────────────────
  // Сборка: экспорт в window.PyOSCore
  // ─────────────────────────────────────────────────────────
  window.PyOSCore = Object.freeze({
    Utils, Bus, Storage, Theme, Settings, FileSystem,
    Registry, Launcher, PluginLoader, Sandbox, Jarvis, Shell, Kernel,
    version: '5.0.0',
    codename: 'Quantum',
    bootTime: BOOT_TIME
  });

  Kernel.register('utils', Utils);
  Kernel.register('bus', Bus);
  Kernel.register('storage', Storage);
  Kernel.register('theme', Theme);
  Kernel.register('settings', Settings);
  Kernel.register('fs', FileSystem);
  Kernel.register('registry', Registry);
  Kernel.register('launcher', Launcher);
  Kernel.register('plugins', PluginLoader);
  Kernel.register('sandbox', Sandbox);
  Kernel.register('jarvis', Jarvis);
  Kernel.register('shell', Shell);

  const fireReady = () => {
    window.dispatchEvent(new CustomEvent('pyos:core:ready'));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      Kernel.boot().then(fireReady).catch((err) => {
        console.error('[PyOS] Boot fatal:', err);
        fireReady();
      });
    });
  } else {
    Kernel.boot().then(fireReady).catch((err) => {
      console.error('[PyOS] Boot fatal:', err);
      fireReady();
    });
  }
})();
