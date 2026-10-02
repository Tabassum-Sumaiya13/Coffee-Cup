/*
 * shared.js - small helpers used by both pages.
 * Theme switching, HTML escaping, toasts and the recent-search list.
 */
(function (global) {
  'use strict';

  var THEME_KEY = 'coffeecup:theme';
  var RECENT_KEY = 'coffeecup:recent';
  var MAX_RECENT = 5;

  /* ------------------------------------------------------------- storage */

  // localStorage throws in private mode and when site data is blocked, so every
  // use is guarded and the app keeps working without it.
  function readStore(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (e) {
      /* ignore - storage is a convenience, not a requirement */
    }
  }

  /* --------------------------------------------------------------- theme */

  // 'light' | 'dark' | null, where null means "follow the operating system".
  function getStoredTheme() {
    var value = readStore(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  }

  function systemPrefersDark() {
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function effectiveTheme() {
    return getStoredTheme() || (systemPrefersDark() ? 'dark' : 'light');
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1a1310' : '#f3e2d4');
    // Let the map (and anything else) react to the change.
    global.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  function setTheme(theme) {
    if (theme === 'light' || theme === 'dark') writeStore(THEME_KEY, theme);
    applyTheme(theme);
    syncToggles();
  }

  function toggleTheme() {
    setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
  }

  // Keep every theme button on the page showing the current state.
  function syncToggles() {
    var dark = effectiveTheme() === 'dark';
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', dark ? 'true' : 'false');
      buttons[i].setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      buttons[i].title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    }
  }

  var themeReady = false;

  // Safe to call more than once: shared.js runs this on load so pages need no
  // inline script, and the page scripts may call it again without double-binding.
  function initTheme() {
    if (themeReady) {
      syncToggles();
      return;
    }
    themeReady = true;
    applyTheme(effectiveTheme());

    // Follow the system only while the user has not made a choice.
    if (global.matchMedia) {
      var query = global.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (!getStoredTheme()) {
          applyTheme(systemPrefersDark() ? 'dark' : 'light');
          syncToggles();
        }
      };
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }

    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-theme-toggle]');
      if (button) {
        event.preventDefault();
        toggleTheme();
      }
    });

    syncToggles();
  }

  /* ---------------------------------------------------------------- text */

  // Everything from OSM is user-submitted, so it is escaped before it ever
  // reaches innerHTML. The old code injected cafe names raw.
  function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------ recent searches */

  function getRecent() {
    try {
      var parsed = JSON.parse(readStore(RECENT_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(function (item) {
          return typeof item === 'string' && item.trim();
        })
        .slice(0, MAX_RECENT);
    } catch (e) {
      return [];
    }
  }

  function addRecent(query) {
    if (!query || !query.trim()) return;
    var text = query.trim();
    var list = getRecent().filter(function (item) {
      return item.toLowerCase() !== text.toLowerCase();
    });
    list.unshift(text);
    writeStore(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  }

  function clearRecent() {
    writeStore(RECENT_KEY, '[]');
  }

  /* -------------------------------------------------------------- toasts */

  var toastTimer = null;

  // A short message at the bottom of the screen, replacing the old alert()s.
  function toast(message, kind) {
    var host = document.getElementById('toast');
    if (!host) return;
    host.textContent = message;
    host.className = 'toast is-visible' + (kind ? ' toast-' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      host.className = 'toast';
    }, 4000);
  }

  /* ------------------------------------------------------------ geolocation */

  // Promise wrapper around the browser location API, with readable errors.
  function locateMe() {
    return new Promise(function (resolve, reject) {
      if (!global.navigator.geolocation) {
        reject(new Error('Your browser cannot share your location.'));
        return;
      }
      global.navigator.geolocation.getCurrentPosition(
        function (position) {
          resolve({ lat: position.coords.latitude, lon: position.coords.longitude });
        },
        function (error) {
          if (error.code === 1) reject(new Error('Location permission was declined.'));
          else if (error.code === 3) reject(new Error('Finding your location took too long.'));
          else reject(new Error('We could not work out where you are.'));
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  global.App = {
    initTheme: initTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    effectiveTheme: effectiveTheme,
    escapeHtml: escapeHtml,
    getRecent: getRecent,
    addRecent: addRecent,
    clearRecent: clearRecent,
    toast: toast,
    locateMe: locateMe
  };

  // This file is loaded from <head> without `defer`, so the theme is applied
  // before the page paints and dark-mode users never see a flash of light.
  // Nothing here needs <body>: the click handler is delegated to `document`.
  initTheme();

  // The toggle buttons do not exist yet at this point, so refresh them once the
  // page has been parsed. That also covers pages with no script of their own.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncToggles);
  }
})(window);
