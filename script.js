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

  /* ======================================================================
   * "Coffee near you" - real cafes from your live location, shown as
   * floating 3D cups.
   * ==================================================================== */

  var nearby = {
    section: document.getElementById('nearby'),
    ask: document.getElementById('nearby-ask'),
    enable: document.getElementById('nearby-enable'),
    scene: document.getElementById('cup-scene'),
    rail: document.getElementById('cup-rail'),
    status: document.getElementById('nearby-status'),
    sub: document.getElementById('nearby-sub')
  };

  // Where each cup floats on the desktop layout. The middle column is left
  // clear so the cups never sit on top of the title or the search box.
  // x/y are percentages of the hero, z is depth, s is scale, fade dims the
  // ones further back so the depth actually reads.
  var CUP_SPOTS = [
    { x:  9, y: 23, w: 116, tilt: -3, fade: 0.78 },
    { x: 90, y: 17, w: 126, tilt:  3, fade: 0.86 },
    { x: 15, y: 57, w: 146, tilt:  2, fade: 1    },
    { x: 87, y: 50, w: 136, tilt: -2, fade: 0.94 },
    { x: 24, y: 85, w: 100, tilt:  3, fade: 0.7  },
    { x: 78, y: 83, w: 112, tilt: -3, fade: 0.78 }
  ];

  var CUP_COUNT = CUP_SPOTS.length;
  var nearbyCenter = null;

  function setStatus(message) {
    nearby.status.textContent = message || '';
  }

  /* ---------------------------------------------------- building the cups */

  function cupBadges(cafe) {
    var labels = [];
    if (cafe.wifi) labels.push('Wi-Fi');
    if (cafe.outdoor) labels.push('Outdoor');
    if (cafe.takeaway) labels.push('Takeaway');
    if (cafe.wheelchair) labels.push('Step-free');

    return labels
      .slice(0, 2)
      .map(function (label) {
        return '<span class="badge">' + App.escapeHtml(label) + '</span>';
      })
      .join('');
  }

  // Position, depth and scale for one cup, as inline custom properties.
  // On narrow screens the stylesheet ignores these and lays the cups out as a
  // swipeable row instead.
  function spotStyle(index) {
    var spot = CUP_SPOTS[index % CUP_SPOTS.length];
    return (
      '--i:' + index + ';' +
      '--x:' + spot.x + '%;' +
      '--y:' + spot.y + '%;' +
      '--w:' + spot.w + 'px;' +
      '--tilt:' + spot.tilt + 'deg;' +
      '--fade:' + spot.fade + ';'
    );
  }

  // One cup: the illustration with a small label card under it.
  function cupHtml(cafe, index) {
    var statusClass =
      cafe.hoursState === 'open' ? 'status-open'
        : cafe.hoursState === 'closed' ? 'status-closed'
        : 'status-unknown';

    // "Closed · opens Tuesday at 08:00" is too long for a label this size.
    var shortStatus =
      cafe.hoursState === 'open' ? cafe.hoursLabel
        : cafe.hoursState === 'closed' ? 'Closed now'
        : 'Hours unknown';

    return (
      '<button type="button" class="cup" style="' + spotStyle(index) + '" ' +
      'data-cafe-lat="' + cafe.lat + '" data-cafe-lon="' + cafe.lon + '" ' +
      'aria-label="' + App.escapeHtml(cafe.name + ', ' + cafe.hoursLabel + ', ' +
        OSM.formatDistance(cafe.distance) + ' away') + '">' +
        '<img class="cup-art" src="coffee-cup.png" alt="" aria-hidden="true" ' +
          'width="512" height="512" loading="lazy" decoding="async">' +
        '<span class="cup-label">' +
          '<span class="cup-name">' + App.escapeHtml(cafe.name) + '</span>' +
          '<span class="cup-status ' + statusClass + '">' +
            '<span class="dot"></span>' + App.escapeHtml(shortStatus) +
          '</span>' +
          '<span class="cup-distance">' + App.escapeHtml(OSM.formatDistance(cafe.distance)) + '</span>' +
          (cupBadges(cafe) ? '<span class="cup-badges">' + cupBadges(cafe) + '</span>' : '') +
        '</span>' +
      '</button>'
    );
  }

  // Cups with no data: shown as decoration before a location is shared, and
  // when nothing is mapped nearby. The first one is eager so the page has
  // artwork immediately.
  function decorCupsHtml() {
    var out = '';
    for (var i = 0; i < CUP_COUNT; i++) {
      out +=
        '<div class="cup is-decor" style="' + spotStyle(i) + '" aria-hidden="true">' +
          '<img class="cup-art" src="coffee-cup.png" alt="" width="512" height="512" ' +
            'decoding="async"' + (i === 0 ? '' : ' loading="lazy"') + '>' +
        '</div>';
    }
    return out;
  }

  function loadingCupsHtml() {
    var out = '';
    for (var i = 0; i < CUP_COUNT; i++) {
      out +=
        '<div class="cup is-loading" style="' + spotStyle(i) + '" aria-hidden="true">' +
          '<img class="cup-art" src="coffee-cup.png" alt="" width="512" height="512" decoding="async">' +
          '<span class="cup-label">' +
            '<span class="cup-name">Loading</span>' +
            '<span class="cup-status">Loading</span>' +
            '<span class="cup-distance">000 m</span>' +
          '</span>' +
        '</div>';
    }
    return out;
  }

  /* ------------------------------------------------------------ loading */

  // Decoration: drifting cups with no data. This is what the page shows before
  // a location is shared, and when nothing is mapped nearby.
  function showDecor() {
    nearby.rail.innerHTML = decorCupsHtml();
    nearby.rail.classList.add('is-decor-only');
    nearby.scene.hidden = false;
  }

  function showCups(cafes, placeLabel) {
    nearby.rail.classList.remove('is-decor-only');
    nearby.rail.innerHTML = cafes
      .map(function (cafe, index) {
        return cupHtml(cafe, index);
      })
      .join('');

    nearby.sub.textContent = placeLabel
      ? 'The closest coffee to ' + placeLabel + ', right now.'
      : 'The closest coffee to you, right now.';
    setStatus('');
  }

  // The landing page gives up sooner than the results page does. Overpass can
  // be slow or fully overloaded, and a hero section must not spin for a minute
  // over something the visitor did not explicitly ask for.
  var NEARBY_DEADLINE = 18000;

  function loadNearby(coords) {
    nearby.ask.hidden = true;
    nearby.scene.hidden = false;
    nearby.rail.classList.remove('is-decor-only');
    nearby.rail.innerHTML = loadingCupsHtml();
    setStatus('Finding coffee around you…');

    nearbyCenter = { lat: coords.lat, lon: coords.lon, label: '' };

    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, NEARBY_DEADLINE);

    Promise.all([
      OSM.reverseGeocode(coords.lat, coords.lon, controller.signal),
      OSM.search({ center: nearbyCenter, radius: 1200, signal: controller.signal })
    ])
      .then(function (results) {
        clearTimeout(timer);
        var label = results[0];
        var cafes = results[1].cafes;
        nearbyCenter.label = label;

        if (!cafes.length) {
          showDecor();
          nearby.sub.textContent = 'We looked around ' + label + '.';
          setStatus('No coffee shops are mapped within 1.2 km of you. Try searching a nearby area instead.');
          return;
        }

        showCups(cafes.slice(0, CUP_COUNT), label);
      })
      .catch(function (error) {
        clearTimeout(timer);
        showDecor();
        nearby.ask.hidden = false;
        nearby.enable.disabled = false;

        if (timedOut) {
          setStatus('The map database is busy right now. Search a place above, or try again in a moment.');
        } else {
          setStatus(error && error.message ? error.message : 'We could not load coffee near you.');
        }
      });
  }

  function requestNearby() {
    nearby.enable.disabled = true;
    setStatus('Asking your browser for your location…');

    App.locateMe()
      .then(function (coords) {
        loadNearby(coords);
      })
      .catch(function (error) {
        setStatus(error.message);
        nearby.enable.disabled = false;
      });
  }

  nearby.enable.addEventListener('click', requestNearby);

  // Tapping a cup opens the results page centred on that cafe.
  nearby.rail.addEventListener('click', function (event) {
    var cup = event.target.closest('.cup[data-cafe-lat]');
    if (!cup || !nearbyCenter) return;
    var params = new URLSearchParams();
    params.set('lat', nearbyCenter.lat.toFixed(5));
    params.set('lon', nearbyCenter.lon.toFixed(5));
    params.set('focus', cup.getAttribute('data-cafe-lat') + ',' + cup.getAttribute('data-cafe-lon'));
    goToResults(params);
  });

  showDecor();

  // If location was already allowed on an earlier visit, load without asking
  // again. Browsers that do not support the Permissions API just show the
  // button, which is the safe default.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions
      .query({ name: 'geolocation' })
      .then(function (result) {
        if (result.state === 'granted') requestNearby();
      })
      .catch(function () {
        /* leave the button in place */
      });
  }
})();
