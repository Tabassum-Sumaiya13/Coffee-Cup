/*
 * results.js - the results page: map, cards, filters and sorting.
 *
 * State lives in one object and every change re-renders from it. The old version
 * kept the cafe list in two places and filtered the copy that had no details
 * attached, so the filters could never match anything.
 */
(function () {
  'use strict';

  App.initTheme();

  var MAX_MARKERS = 300;

  var state = {
    center: null,       // { lat, lon, label }
    query: '',
    radius: 1500,
    cafes: [],          // everything the last search returned
    visible: [],        // what passes the current filters, in sort order
    selectedId: null,
    status: 'idle',     // 'idle' | 'loading' | 'ready' | 'empty' | 'error'
    error: null,
    sort: 'distance',
    filters: { open: false, wifi: false, outdoor: false, takeaway: false, step: false },
    mobileView: 'list'  // 'list' | 'map'
  };

  var map = null;
  var markers = {};        // cafe id -> Leaflet marker
  var centerMarker = null;
  var radiusCircle = null;
  var inFlight = null;     // AbortController for the running search

  /* ------------------------------------------------------------ elements */

  var el = {
    form: document.getElementById('results-search-form'),
    input: document.getElementById('results-search-input'),
    list: document.getElementById('results-list'),
    count: document.getElementById('results-count'),
    place: document.getElementById('results-place'),
    sort: document.getElementById('sort-select'),
    radius: document.getElementById('radius-select'),
    filterPanel: document.getElementById('filter-panel'),
    filterToggle: document.getElementById('filter-toggle'),
    filterCount: document.getElementById('filter-count'),
    clearFilters: document.getElementById('clear-filters'),
    locate: document.getElementById('results-locate'),
    viewToggle: document.getElementById('view-toggle'),
    shell: document.querySelector('.results-shell')
  };

  /* ---------------------------------------------------------------- map */

  function coffeeIcon(isOpen, isActive) {
    var classes = 'marker-pin' + (isOpen ? ' marker-open' : '') + (isActive ? ' marker-active' : '');
    return L.divIcon({
      className: '',
      html:
        '<div class="' + classes + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M2 21h18v-2H2v2zM20 8h-2V5h2v3zm0-5H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm-4 10c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V5h10v8z"/>' +
        '</svg></div>',
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -32]
    });
  }

  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true
    }).setView([40.7128, -74.006], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Clicking empty map space clears the selection.
    map.on('click', function () {
      if (state.selectedId) {
        state.selectedId = null;
        renderList();
        refreshMarkerIcons();
      }
    });
  }

  function clearMarkers() {
    Object.keys(markers).forEach(function (id) {
      map.removeLayer(markers[id]);
    });
    markers = {};
  }

  function drawCenter() {
    if (centerMarker) map.removeLayer(centerMarker);
    if (radiusCircle) map.removeLayer(radiusCircle);
    if (!state.center) return;

    radiusCircle = L.circle([state.center.lat, state.center.lon], {
      radius: state.radius,
      className: 'search-radius',
      interactive: false
    }).addTo(map);

    centerMarker = L.marker([state.center.lat, state.center.lon], {
      icon: L.divIcon({ className: '', html: '<div class="marker-center"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
      keyboard: false
    }).addTo(map);
  }

  function drawMarkers() {
    clearMarkers();
    if (!map) return;

    var shown = state.visible.slice(0, MAX_MARKERS);

    shown.forEach(function (cafe) {
      var marker = L.marker([cafe.lat, cafe.lon], {
        icon: coffeeIcon(cafe.hoursState === 'open', cafe.id === state.selectedId),
        title: cafe.name,
        riseOnHover: true
      });
      marker.bindPopup(popupHtml(cafe), { maxWidth: 300, minWidth: 220 });
      marker.on('click', function () {
        select(cafe.id, false);
      });
      marker.addTo(map);
      markers[cafe.id] = marker;
    });

    fitToResults();
  }

  function fitToResults() {
    if (!state.center) return;
    var points = state.visible.slice(0, MAX_MARKERS).map(function (c) {
      return [c.lat, c.lon];
    });
    points.push([state.center.lat, state.center.lon]);

    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.12), { animate: false, maxZoom: 16 });
    } else {
      map.setView([state.center.lat, state.center.lon], 15, { animate: false });
    }
  }

  function refreshMarkerIcons() {
    Object.keys(markers).forEach(function (id) {
      var cafe = findCafe(id);
      if (cafe) markers[id].setIcon(coffeeIcon(cafe.hoursState === 'open', id === state.selectedId));
    });
  }

  function findCafe(id) {
    for (var i = 0; i < state.cafes.length; i++) {
      if (state.cafes[i].id === id) return state.cafes[i];
    }
    return null;
  }

  /* ------------------------------------------------------------ searching */

  function runSearch(options) {
    // Cancel whatever is still running so results cannot arrive out of order.
    if (inFlight) inFlight.abort();
    var controller = new AbortController();
    inFlight = controller;

    state.status = 'loading';
    state.error = null;
    state.selectedId = null;
    render();

    OSM.search({
      query: options.query,
      center: options.center,
      radius: state.radius,
      signal: controller.signal
    })
      .then(function (result) {
        if (controller !== inFlight) return; // a newer search won
        state.center = result.center;
        state.cafes = result.cafes;
        state.status = result.cafes.length ? 'ready' : 'empty';

        if (!state.query && result.center.label) {
          el.input.value = result.center.label;
        }

        applyFilters();
        drawCenter();
        render();
        drawMarkers();
      })
      .catch(function (error) {
        if (controller !== inFlight) return;
        if (OSM.isAbort(error)) return;
        state.status = 'error';
        state.error = error && error.message ? error.message : 'Something went wrong. Please try again.';
        state.cafes = [];
        state.visible = [];
        clearMarkers();
        render();
      });
  }

  function searchText(query) {
    state.query = query;
    App.addRecent(query);
    syncUrl();
    runSearch({ query: query });
  }

  function searchCoords(coords, label) {
    state.query = '';
    state.center = { lat: coords.lat, lon: coords.lon, label: label || 'Your location' };
    el.input.value = label || 'Your location';
    syncUrl();
    runSearch({ center: state.center });
  }

  // Keep the address bar in step, so results can be shared and reloaded.
  function syncUrl() {
    var params = new URLSearchParams();
    if (state.query) params.set('search', state.query);
    else if (state.center) {
      params.set('lat', state.center.lat.toFixed(5));
      params.set('lon', state.center.lon.toFixed(5));
    }
    if (state.radius !== 1500) params.set('radius', String(state.radius));
    window.history.replaceState({}, '', '?' + params.toString());
  }

  /* ------------------------------------------------- filtering + sorting */

  function activeFilterCount() {
    return Object.keys(state.filters).filter(function (key) {
      return state.filters[key];
    }).length;
  }

  function applyFilters() {
    var f = state.filters;

    var list = state.cafes.filter(function (cafe) {
      if (f.open && cafe.hoursState !== 'open') return false;
      if (f.wifi && !cafe.wifi) return false;
      if (f.outdoor && !cafe.outdoor) return false;
      if (f.takeaway && !cafe.takeaway) return false;
      if (f.step && !cafe.wheelchair) return false;
      return true;
    });

    // Sorting is stable on distance first, so equal keys keep a sensible order.
    list.sort(function (a, b) {
      return (a.distance || 0) - (b.distance || 0);
    });

    if (state.sort === 'name') {
      list.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
    } else if (state.sort === 'open') {
      var rank = { open: 0, unknown: 1, closed: 2 };
      list.sort(function (a, b) {
        var diff = rank[a.hoursState] - rank[b.hoursState];
        return diff !== 0 ? diff : (a.distance || 0) - (b.distance || 0);
      });
    }
    // 'distance' needs nothing further - the list is already in that order.

    state.visible = list;
  }

  /* --------------------------------------------------------- rendering */

  function badge(label, title) {
    return '<span class="badge" title="' + App.escapeHtml(title || label) + '">' + App.escapeHtml(label) + '</span>';
  }

  function cafeBadges(cafe) {
    var out = '';
    if (cafe.wifi) out += badge('Wi-Fi', 'Internet access');
    if (cafe.outdoor) out += badge('Outdoor', 'Outdoor seating');
    if (cafe.takeaway) out += badge('Takeaway', 'Takeaway available');
    if (cafe.wheelchair) out += badge('Step-free', 'Step-free access');
    if (cafe.vegan) out += badge('Veg', 'Vegan or vegetarian options');
    return out;
  }

  // A deterministic hue per cafe, so each card gets its own calm colour instead
  // of the broken default-cafe.jpg the old code pointed at.
  function hueFor(name) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
    return hash;
  }

  function initials(name) {
    var words = name.replace(/[^\w\s]/g, ' ').trim().split(/\s+/);
    if (!words[0]) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function cardHtml(cafe) {
    var hoursClass =
      cafe.hoursState === 'open' ? 'status-open' : cafe.hoursState === 'closed' ? 'status-closed' : 'status-unknown';

    var distance = cafe.distance != null ? OSM.formatDistance(cafe.distance) : '';
    var subtitle = cafe.brand && cafe.brand !== cafe.name ? cafe.brand : cafe.cuisine;

    return (
      '<article class="cafe-card' + (cafe.id === state.selectedId ? ' is-selected' : '') + '" ' +
      'data-cafe-id="' + App.escapeHtml(cafe.id) + '" tabindex="0" role="button" ' +
      'aria-label="' + App.escapeHtml(cafe.name) + ', ' + App.escapeHtml(cafe.hoursLabel) + '">' +
        '<div class="cafe-thumb" style="--hue:' + hueFor(cafe.name) + '" aria-hidden="true">' +
          '<span>' + App.escapeHtml(initials(cafe.name)) + '</span>' +
        '</div>' +
        '<div class="cafe-body">' +
          '<h3 class="cafe-name">' + App.escapeHtml(cafe.name) + '</h3>' +
          (subtitle ? '<p class="cafe-sub">' + App.escapeHtml(subtitle) + '</p>' : '') +
          '<p class="cafe-status ' + hoursClass + '"><span class="dot"></span>' +
            App.escapeHtml(cafe.hoursLabel) + '</p>' +
          (cafe.address ? '<p class="cafe-meta">' + App.escapeHtml(cafe.address) + '</p>' : '') +
          (cafeBadges(cafe) ? '<div class="badge-row">' + cafeBadges(cafe) + '</div>' : '') +
        '</div>' +
        (distance ? '<span class="cafe-distance">' + App.escapeHtml(distance) + '</span>' : '') +
      '</article>'
    );
  }

  function popupHtml(cafe) {
    var html = '<div class="popup"><h3>' + App.escapeHtml(cafe.name) + '</h3>';

    var hoursClass =
      cafe.hoursState === 'open' ? 'status-open' : cafe.hoursState === 'closed' ? 'status-closed' : 'status-unknown';
    html += '<p class="cafe-status ' + hoursClass + '"><span class="dot"></span>' + App.escapeHtml(cafe.hoursLabel) + '</p>';

    if (cafe.address) html += '<p class="popup-row">' + App.escapeHtml(cafe.address) + '</p>';
    if (cafe.distance != null) {
      html += '<p class="popup-row">' + App.escapeHtml(OSM.formatDistance(cafe.distance)) + ' from your search</p>';
    }
    if (cafeBadges(cafe)) html += '<div class="badge-row">' + cafeBadges(cafe) + '</div>';

    if (cafe.week) {
      html += '<details class="popup-hours"><summary>Opening hours</summary><dl>';
      cafe.week.forEach(function (row) {
        html +=
          '<div><dt>' + App.escapeHtml(row.day) + '</dt><dd>' + App.escapeHtml(row.hours) + '</dd></div>';
      });
      html += '</dl></details>';
    } else if (cafe.openingHours) {
      html += '<p class="popup-row">' + App.escapeHtml(cafe.openingHours) + '</p>';
    }

    html += '<div class="popup-actions">';
    if (cafe.website) {
      html += '<a class="popup-link" href="' + App.escapeHtml(cafe.website) + '" target="_blank" rel="noopener noreferrer">Website</a>';
    }
    if (cafe.phone) {
      html += '<a class="popup-link" href="tel:' + App.escapeHtml(cafe.phone.replace(/[^\d+]/g, '')) + '">Call</a>';
    }
    html +=
      '<a class="popup-link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/directions?to=' +
      cafe.lat + '%2C' + cafe.lon + '">Directions</a>';
    html += '</div></div>';

    return html;
  }

  function skeletonHtml() {
    var out = '';
    for (var i = 0; i < 6; i++) {
      out +=
        '<div class="cafe-card is-skeleton" aria-hidden="true">' +
        '<div class="cafe-thumb"></div>' +
        '<div class="cafe-body">' +
        '<div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-line sk-short"></div>' +
        '</div></div>';
    }
    return out;
  }

  function stateHtml(icon, title, body, actionLabel, actionId) {
    return (
      '<div class="state-panel">' +
      '<div class="state-icon" aria-hidden="true">' + icon + '</div>' +
      '<h2>' + App.escapeHtml(title) + '</h2>' +
      '<p>' + App.escapeHtml(body) + '</p>' +
      (actionLabel ? '<button type="button" class="button" id="' + actionId + '">' + App.escapeHtml(actionLabel) + '</button>' : '') +
      '</div>'
    );
  }

  function renderList() {
    if (state.status === 'loading') {
      el.list.innerHTML = skeletonHtml();
      return;
    }

    if (state.status === 'error') {
      el.list.innerHTML = stateHtml('!', 'That did not work', state.error, 'Try again', 'retry-search');
      var retry = document.getElementById('retry-search');
      if (retry) {
        retry.addEventListener('click', function () {
          if (state.query) searchText(state.query);
          else if (state.center) runSearch({ center: state.center });
        });
      }
      return;
    }

    if (state.status === 'idle') {
      el.list.innerHTML = stateHtml(
        '?',
        'Where are you looking?',
        'Search for a city, address or postcode to find coffee nearby.',
        null,
        null
      );
      return;
    }

    if (state.status === 'empty') {
      el.list.innerHTML = stateHtml(
        '0',
        'No coffee shops here',
        'OpenStreetMap has nothing mapped within ' +
          OSM.formatDistance(state.radius) +
          ' of this spot. Try a wider radius or a different area.',
        'Widen the search',
        'widen-search'
      );
      var widen = document.getElementById('widen-search');
      if (widen) {
        widen.addEventListener('click', function () {
          state.radius = Math.min(5000, state.radius * 2);
          el.radius.value = String(state.radius);
          syncUrl();
          runSearch(state.query ? { query: state.query } : { center: state.center });
        });
      }
      return;
    }

    // Results exist, but the filters hide all of them.
    if (!state.visible.length) {
      el.list.innerHTML = stateHtml(
        '0',
        'Nothing matches those filters',
        'We found ' + state.cafes.length + ' coffee shops nearby, but none match every filter you picked.',
        'Clear filters',
        'clear-from-empty'
      );
      var clear = document.getElementById('clear-from-empty');
      if (clear) clear.addEventListener('click', resetFilters);
      return;
    }

    el.list.innerHTML = state.visible
      .map(function (cafe) {
        return cardHtml(cafe);
      })
      .join('');
  }

  function renderSummary() {
    var total = state.cafes.length;
    var shown = state.visible.length;

    if (state.status === 'loading') {
      el.count.textContent = 'Searching…';
    } else if (state.status === 'ready') {
      el.count.textContent =
        shown === total
          ? shown + (shown === 1 ? ' coffee shop' : ' coffee shops')
          : shown + ' of ' + total + ' coffee shops';
    } else if (state.status === 'empty') {
      el.count.textContent = 'No results';
    } else {
      el.count.textContent = '';
    }

    el.place.textContent = state.center && state.center.label ? state.center.label : '';

    var count = activeFilterCount();
    el.filterCount.textContent = count ? String(count) : '';
    el.filterCount.hidden = !count;
    el.clearFilters.hidden = !count;
  }

  function render() {
    renderSummary();
    renderList();
  }

  /* ------------------------------------------------------------ selection */

  function select(id, fromCard) {
    state.selectedId = id;
    renderList();
    refreshMarkerIcons();

    var marker = markers[id];
    var cafe = findCafe(id);

    if (marker && cafe) {
      if (fromCard) {
        // On a phone the map is a separate view, so bring it forward.
        if (window.matchMedia('(max-width: 900px)').matches) setMobileView('map');
        map.setView([cafe.lat, cafe.lon], Math.max(map.getZoom(), 16), { animate: true });
      }
      marker.openPopup();
    }

    if (!fromCard) {
      var card = el.list.querySelector('[data-cafe-id="' + cssEscape(id) + '"]');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Cafe ids look like "node/12345", and the slash needs escaping in a selector.
  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^\w-]/g, '\\$&');
  }

  /* --------------------------------------------------------------- events */

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = el.input.value.trim();
    if (!query) {
      el.input.focus();
      App.toast('Type a place to search for.', 'error');
      return;
    }
    searchText(query);
  });

  el.sort.addEventListener('change', function () {
    state.sort = el.sort.value;
    applyFilters();
    render();
    drawMarkers();
  });

  el.radius.addEventListener('change', function () {
    state.radius = parseInt(el.radius.value, 10) || 1500;
    syncUrl();
    if (state.query) runSearch({ query: state.query });
    else if (state.center) runSearch({ center: state.center });
  });

  // Filter checkboxes live inside the panel.
  el.filterPanel.addEventListener('change', function (event) {
    var box = event.target.closest('input[type="checkbox"][data-filter]');
    if (!box) return;
    state.filters[box.getAttribute('data-filter')] = box.checked;
    applyFilters();
    render();
    drawMarkers();
  });

  function resetFilters() {
    Object.keys(state.filters).forEach(function (key) {
      state.filters[key] = false;
    });
    var boxes = el.filterPanel.querySelectorAll('input[type="checkbox"][data-filter]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
    applyFilters();
    render();
    drawMarkers();
  }

  el.clearFilters.addEventListener('click', resetFilters);

  function setFilterPanel(open) {
    el.filterPanel.hidden = !open;
    el.filterToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  el.filterToggle.addEventListener('click', function () {
    setFilterPanel(el.filterPanel.hidden);
  });

  // Close the filter panel on Escape or on a click outside it.
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !el.filterPanel.hidden) {
      setFilterPanel(false);
      el.filterToggle.focus();
    }
  });

  document.addEventListener('click', function (event) {
    if (el.filterPanel.hidden) return;
    if (el.filterPanel.contains(event.target) || el.filterToggle.contains(event.target)) return;
    setFilterPanel(false);
  });

  // Cards: click and keyboard both select.
  el.list.addEventListener('click', function (event) {
    var card = event.target.closest('[data-cafe-id]');
    if (card) select(card.getAttribute('data-cafe-id'), true);
  });

  el.list.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var card = event.target.closest('[data-cafe-id]');
    if (!card) return;
    event.preventDefault();
    select(card.getAttribute('data-cafe-id'), true);
  });

  // Hovering a card lifts its marker.
  el.list.addEventListener('mouseover', function (event) {
    var card = event.target.closest('[data-cafe-id]');
    if (!card) return;
    var marker = markers[card.getAttribute('data-cafe-id')];
    if (marker) marker.setZIndexOffset(1000);
  });

  el.list.addEventListener('mouseout', function (event) {
    var card = event.target.closest('[data-cafe-id]');
    if (!card) return;
    var marker = markers[card.getAttribute('data-cafe-id')];
    if (marker) marker.setZIndexOffset(0);
  });

  if (el.locate) {
    el.locate.addEventListener('click', function () {
      el.locate.disabled = true;
      App.locateMe()
        .then(function (coords) {
          return OSM.reverseGeocode(coords.lat, coords.lon).then(function (label) {
            searchCoords(coords, label);
          });
        })
        .catch(function (error) {
          App.toast(error.message, 'error');
        })
        .then(function () {
          el.locate.disabled = false;
        });
    });
  }

  /* ----------------------------------------------------- mobile list/map */

  function setMobileView(view) {
    state.mobileView = view;
    el.shell.setAttribute('data-mobile-view', view);
    var buttons = el.viewToggle.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var isActive = buttons[i].getAttribute('data-view') === view;
      buttons[i].classList.toggle('is-active', isActive);
      buttons[i].setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    // Leaflet needs telling when its container changes size.
    if (view === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 60);
  }

  el.viewToggle.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-view]');
    if (button) setMobileView(button.getAttribute('data-view'));
  });

  // Switching between phone and desktop layouts also changes the map size.
  window.addEventListener('resize', function () {
    if (map) map.invalidateSize();
  });

  /* ------------------------------------------------------------- start up */

  function start() {
    initMap();
    setMobileView('list');

    var params = new URLSearchParams(window.location.search);
    var query = (params.get('search') || '').trim();
    var lat = parseFloat(params.get('lat'));
    var lon = parseFloat(params.get('lon'));
    var radius = parseInt(params.get('radius'), 10);

    if (radius && [500, 1000, 1500, 3000, 5000].indexOf(radius) !== -1) {
      state.radius = radius;
      el.radius.value = String(radius);
    }

    if (query) {
      el.input.value = query;
      searchText(query);
    } else if (isFinite(lat) && isFinite(lon)) {
      OSM.reverseGeocode(lat, lon).then(function (label) {
        searchCoords({ lat: lat, lon: lon }, label);
      });
    } else {
      state.status = 'idle';
      render();
      el.input.focus();
    }
  }

  start();
})();
