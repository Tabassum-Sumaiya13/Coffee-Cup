/*
 * script.js - the landing page.
 *
 * The previous version of this file began with `import "@radix-ui/themes/..."`
 * and ended with a JSX component. Loaded through a plain <script> tag that is a
 * syntax error, so nothing in the file ran and the search button did nothing.
 * Radix and React were never used by this app, so they are gone.
 */
(function () {
  'use strict';

  App.initTheme();

  var form = document.getElementById('search-form');
  var input = document.getElementById('search-input');
  var locateButton = document.getElementById('locate-button');
  var recentWrap = document.getElementById('recent-searches');
  var hint = document.getElementById('search-hint');

  /* --------------------------------------------------------- submitting */

  function goToResults(params) {
    window.location.href = 'results.html?' + params.toString();
  }

  function showHint(message) {
    if (!hint) return;
    hint.textContent = message || '';
    hint.classList.toggle('is-visible', !!message);
  }

  // A real <form> means Enter works for free and mobile keyboards show "Go".
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = input.value.trim();

    if (!query) {
      // Inline message plus focus, instead of the old blocking alert().
      showHint('Type a city, address or postcode to search.');
      input.focus();
      return;
    }

    showHint('');
    App.addRecent(query);
    var params = new URLSearchParams();
    params.set('search', query);
    goToResults(params);
  });

  input.addEventListener('input', function () {
    if (input.value.trim()) showHint('');
  });

  /* ------------------------------------------------------- use my location */

  if (locateButton) {
    locateButton.addEventListener('click', function () {
      locateButton.disabled = true;
      locateButton.classList.add('is-busy');
      showHint('');

      App.locateMe()
        .then(function (coords) {
          var params = new URLSearchParams();
          params.set('lat', coords.lat.toFixed(5));
          params.set('lon', coords.lon.toFixed(5));
          goToResults(params);
        })
        .catch(function (error) {
          App.toast(error.message, 'error');
          locateButton.disabled = false;
          locateButton.classList.remove('is-busy');
        });
    });
  }

  /* ------------------------------------------------- suggestion + recent chips */

  // Any chip with a data-query runs that search straight away.
  document.addEventListener('click', function (event) {
    var chip = event.target.closest('[data-query]');
    if (!chip) return;
    var query = chip.getAttribute('data-query');
    if (!query) return;
    App.addRecent(query);
    var params = new URLSearchParams();
    params.set('search', query);
    goToResults(params);
  });

  function renderRecent() {
    if (!recentWrap) return;
    var list = App.getRecent();

    if (!list.length) {
      recentWrap.hidden = true;
      recentWrap.innerHTML = '';
      return;
    }

    var html =
      '<div class="recent-head">' +
      '<span class="recent-label">Recent searches</span>' +
      '<button type="button" class="link-button" id="clear-recent">Clear</button>' +
      '</div><div class="chip-row">';

    for (var i = 0; i < list.length; i++) {
      var safe = App.escapeHtml(list[i]);
      html += '<button type="button" class="chip" data-query="' + safe + '">' + safe + '</button>';
    }

    recentWrap.innerHTML = html + '</div>';
    recentWrap.hidden = false;

    document.getElementById('clear-recent').addEventListener('click', function () {
      App.clearRecent();
      renderRecent();
    });
  }

  renderRecent();
  input.focus();
})();
