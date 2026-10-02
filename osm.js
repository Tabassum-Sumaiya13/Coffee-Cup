/*
 * osm.js - data layer for CoffeeCup.
 *
 * All data comes from OpenStreetMap, which needs no API key and so is safe to
 * call straight from the browser. Two services are used:
 *   - Nominatim : turns a text search ("Brooklyn") into coordinates.
 *   - Overpass  : lists cafes around those coordinates.
 *
 * The previous version used Foursquare for ratings, prices and photos. That API
 * has been switched off (it answers "410 Gone") and its replacement needs a paid
 * key, which cannot be kept secret in a static site. OSM carries no ratings or
 * prices, so nothing here invents them.
 */
(function (global) {
  'use strict';

  // Overpass is volunteer-run and its round-robin host is often overloaded, so
  // we try several backends in turn. Order matters: fastest first.
  var OVERPASS_ENDPOINTS = [
    'https://lambert.openstreetmap.de/api/interpreter',
    'https://gall.openstreetmap.de/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  var PER_ENDPOINT_TIMEOUT = 20000; // ms before giving up on one backend
  var GEOCODE_TIMEOUT = 15000;

  /* ---------------------------------------------------------------- errors */

  // One error type carrying a `kind`, so the UI can show a useful message
  // instead of a generic "something went wrong".
  function DataError(kind, message) {
    this.name = 'DataError';
    this.kind = kind; // 'offline' | 'not-found' | 'unavailable' | 'aborted'
    this.message = message;
  }
  DataError.prototype = Object.create(Error.prototype);

  function isAbort(error) {
    return (
      (error instanceof DataError && error.kind === 'aborted') ||
      (error && error.name === 'AbortError')
    );
  }

  /* -------------------------------------------------------------- fetching */

  // fetch() with a time limit. Also honours an outer AbortSignal, so starting a
  // new search cancels the one still in flight.
  function fetchWithTimeout(url, options, timeout, outerSignal) {
    options = options || {};
    var controller = new AbortController();
    var timedOut = false;

    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, timeout);

    function onOuterAbort() {
      controller.abort();
    }
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort();
      else outerSignal.addEventListener('abort', onOuterAbort);
    }

    options.signal = controller.signal;

    function cleanup() {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
    }

    return fetch(url, options).then(
      function (response) {
        cleanup();
        return response;
      },
      function (error) {
        cleanup();
        // An outer abort is a deliberate cancel; a timeout is a failure.
        if (outerSignal && outerSignal.aborted) {
          throw new DataError('aborted', 'Search cancelled.');
        }
        if (timedOut) throw new DataError('unavailable', 'The request timed out.');
        throw error;
      }
    );
  }

  function rethrowNetwork(error) {
    if (error instanceof DataError) throw error;
    if (isAbort(error)) throw new DataError('aborted', 'Search cancelled.');
    if (!navigator.onLine) {
      throw new DataError('offline', 'You appear to be offline. Check your connection and try again.');
    }
    throw new DataError('unavailable', 'Could not reach the map service. Please try again.');
  }

  /* ------------------------------------------------------------- geocoding */

  // Turn a place name into { lat, lon, label }.
  function geocode(query, outerSignal) {
    var url =
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=' +
      encodeURIComponent(query);

    return fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, GEOCODE_TIMEOUT, outerSignal)
      .then(function (response) {
        if (!response.ok) {
          throw new DataError('unavailable', 'The location service is busy. Please try again.');
        }
        return response.json();
      })
      .then(function (results) {
        if (!results || !results.length) {
          throw new DataError('not-found', 'We could not find that place. Try a city, address or postcode.');
        }
        var hit = results[0];
        return {
          lat: parseFloat(hit.lat),
          lon: parseFloat(hit.lon),
          label: shortLabel(hit)
        };
      })
      .catch(rethrowNetwork);
  }

  // Nominatim display names are very long. Keep the first few parts.
  function shortLabel(hit) {
    var full = hit.display_name || '';
    var parts = full.split(',').map(function (p) {
      return p.trim();
    });
    if (parts.length <= 3) return full;
    return parts.slice(0, 3).join(', ');
  }

  // Turn coordinates into a readable place name (used for "use my location").
  function reverseGeocode(lat, lon, outerSignal) {
    var url =
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=' +
      encodeURIComponent(lat) +
      '&lon=' +
      encodeURIComponent(lon);

    return fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, GEOCODE_TIMEOUT, outerSignal)
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (!data) return 'Your location';
        var a = data.address || {};
        var parts = [
          a.neighbourhood || a.suburb || a.city_district,
          a.city || a.town || a.village || a.county
        ].filter(Boolean);
        return parts.length ? parts.join(', ') : 'Your location';
      })
      .catch(function () {
        return 'Your location';
      });
  }

  /* ----------------------------------------------------------------- cafes */

  function buildOverpassQuery(lat, lon, radius) {
    // `nwr` covers nodes, ways and relations in one statement, and
    // `out center tags` gives every result a single coordinate. The old query
    // used `out body; >;`, so cafes mapped as buildings came back with no
    // lat/lon at all and broke the map markers.
    var around = '(around:' + radius + ',' + lat + ',' + lon + ');';
    return (
      '[out:json][timeout:25];(' +
      'nwr["amenity"="cafe"]' + around +
      'nwr["cuisine"="coffee_shop"]' + around +
      'nwr["shop"="coffee"]' + around +
      ');out center tags 300;'
    );
  }

  // Ask each Overpass backend in turn until one answers properly.
  function fetchCafes(lat, lon, radius, outerSignal) {
    var body = 'data=' + encodeURIComponent(buildOverpassQuery(lat, lon, radius));
    var index = 0;

    function attempt() {
      if (index >= OVERPASS_ENDPOINTS.length) {
        return Promise.reject(
          new DataError(
            'unavailable',
            'The coffee shop database is busy right now. Please try again in a moment.'
          )
        );
      }
      var endpoint = OVERPASS_ENDPOINTS[index++];

      return fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body
        },
        PER_ENDPOINT_TIMEOUT,
        outerSignal
      )
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json(); // a busy Overpass returns HTML, so this throws
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.elements)) throw new Error('Bad payload');
          return data.elements;
        })
        .catch(function (error) {
          // A real cancel must stop the chain, not move on to the next host.
          if (isAbort(error) || (outerSignal && outerSignal.aborted)) {
            throw new DataError('aborted', 'Search cancelled.');
          }
          if (!navigator.onLine) {
            throw new DataError('offline', 'You appear to be offline. Check your connection and try again.');
          }
          return attempt();
        });
    }

    return attempt();
  }

  /* -------------------------------------------------- opening hours parser */

  var DAY_KEYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var DAY_INDEX = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function toMinutes(text) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (h > 24 || min > 59) return null;
    return h * 60 + min;
  }

  // Parse an OSM `opening_hours` string into seven lists of {start,end} minute
  // ranges, one per weekday (index 0 = Sunday).
  //
  // Covers the shapes that actually occur in the data: "24/7",
  // "Mo-Su 07:00-19:00", "Mo-Fr 07:30-19:00; Sa,Su 08:30-19:00", "Su off",
  // a bare "10:30-21:30", and spans crossing midnight. Anything it cannot read
  // returns null, and the UI then shows the raw text instead of guessing.
  function parseOpeningHours(spec) {
    if (!spec || typeof spec !== 'string') return null;
    var text = spec.trim();
    if (!text) return null;

    var week = [[], [], [], [], [], [], []];
    var d;

    if (/^24\s*\/\s*7$/.test(text)) {
      for (d = 0; d < 7; d++) week[d].push({ start: 0, end: 1440 });
      return week;
    }

    // Rules should be separated by ";", but plenty of real entries use a comma
    // instead ("Mo-Fr 08:00-19:00, Sa-Su 10:00-18:00"). Treat a comma as a rule
    // break only when a time range comes before it and a weekday after it. That
    // leaves day lists ("Sa, Su 08:00-19:00") and split shifts
    // ("08:00-12:00,13:00-18:00") alone, because neither matches both halves.
    text = text.replace(/(\d{1,2}:\d{2})\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/gi, '$1;');

    var rules = text.split(';');
    var understoodAnything = false;

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i].trim();
      if (!rule) continue;

      // Date-based exceptions need a calendar we do not have: public and school
      // holidays, single dates ("Dec 25 off"), nth weekday of a month
      // ("Nov Th[4] off"), week numbers and sunrise/sunset times. Skip just
      // that rule rather than giving up on the whole string, so normal weekly
      // hours still work. A seasonal entry whose only rule is month-based ends
      // up with nothing understood, and correctly falls back to raw text.
      if (/^(PH|SH)\b/i.test(rule)) continue;
      if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|sunrise|sunset|dusk|dawn)\b/i.test(rule)) {
        continue;
      }
      if (/\[-?\d\]/.test(rule)) continue;

      var closed = /\b(off|closed)\b/i.test(rule);
      var dayPart = '';
      var timePart = '';

      // Split "Mo-Fr 07:00-19:00" into a day part and a time part. A rule may
      // also be days only ("Su off") or times only ("10:30-21:30").
      var match = /^([A-Za-z,\-\s]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+)$/.exec(rule);
      if (match) {
        dayPart = match[1].trim();
        timePart = match[2].trim();
      } else if (closed) {
        dayPart = rule.replace(/\b(off|closed)\b/i, '').trim();
      } else {
        return null; // a shape we do not understand
      }

      var days = parseDaySpec(dayPart);
      if (!days) return null;

      var j;
      if (closed) {
        for (j = 0; j < days.length; j++) week[days[j]] = [];
        understoodAnything = true;
        continue;
      }

      var spans = parseTimeSpans(timePart);
      if (!spans) return null;

      // Later rules override earlier ones for the same day, per OSM semantics.
      for (j = 0; j < days.length; j++) week[days[j]] = [];

      for (j = 0; j < days.length; j++) {
        var day = days[j];
        for (var s = 0; s < spans.length; s++) {
          var span = spans[s];
          if (span.end <= span.start) {
            // Crosses midnight: finish today, carry on tomorrow.
            week[day].push({ start: span.start, end: 1440 });
            week[(day + 1) % 7].push({ start: 0, end: span.end });
          } else {
            week[day].push(span);
          }
        }
      }
      understoodAnything = true;
    }

    return understoodAnything ? week : null;
  }

  // "Mo-Fr", "Sa,Su", "Mo-We,Fr", or "" meaning every day.
  function parseDaySpec(spec) {
    if (!spec) return [0, 1, 2, 3, 4, 5, 6];
    var out = [];
    var chunks = spec.split(',');

    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i].trim();
      if (!chunk) continue;

      var range = /^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/.exec(chunk);
      if (range) {
        var from = DAY_INDEX[normaliseDay(range[1])];
        var to = DAY_INDEX[normaliseDay(range[2])];
        if (from === undefined || to === undefined) return null;
        // Ranges may wrap around the end of the week, e.g. Sa-Su or Fr-Mo.
        for (var d = from; ; d = (d + 1) % 7) {
          out.push(d);
          if (d === to) break;
        }
        continue;
      }

      var single = DAY_INDEX[normaliseDay(chunk)];
      if (single === undefined) return null;
      out.push(single);
    }

    return out.length ? out : null;
  }

  function normaliseDay(text) {
    if (!text || text.length < 2) return '';
    var key = text.charAt(0).toUpperCase() + text.charAt(1).toLowerCase();
    return DAY_KEYS.indexOf(key) === -1 ? '' : key;
  }

  // "07:00-19:00" or "08:00-12:00,13:00-18:00".
  function parseTimeSpans(spec) {
    var out = [];
    var chunks = spec.split(',');
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i].trim();
      if (!chunk) continue;
      var m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(chunk);
      if (!m) return null;
      var start = toMinutes(m[1]);
      var end = toMinutes(m[2]);
      if (start === null || end === null) return null;
      out.push({ start: start, end: end });
    }
    return out.length ? out : null;
  }

  function formatMinutes(total) {
    var m = total % 1440;
    var h = Math.floor(m / 60);
    var min = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
  }

  // Work out whether a cafe is open at `now`.
  // Returns { state: 'open' | 'closed' | 'unknown', label, detail }.
  function getOpenState(spec, now) {
    now = now || new Date();
    if (!spec) return { state: 'unknown', label: 'Hours not listed', detail: '' };

    var week = parseOpeningHours(spec);
    if (!week) {
      // Human-readable but not machine-readable: show it as it is.
      return { state: 'unknown', label: spec.length > 32 ? 'See opening hours' : spec, detail: spec };
    }

    var day = now.getDay();
    var minutes = now.getHours() * 60 + now.getMinutes();
    var today = week[day];

    for (var i = 0; i < today.length; i++) {
      if (minutes >= today[i].start && minutes < today[i].end) {
        var closesAt = today[i].end;
        return {
          state: 'open',
          label: closesAt >= 1440 ? 'Open now' : 'Open until ' + formatMinutes(closesAt),
          detail: spec
        };
      }
    }

    // Closed, so find the next opening within the coming week.
    for (var ahead = 0; ahead < 8; ahead++) {
      var d = (day + ahead) % 7;
      var spans = week[d];
      for (var s = 0; s < spans.length; s++) {
        if (ahead === 0 && spans[s].start <= minutes) continue;
        var when;
        if (ahead === 0) when = 'today at ' + formatMinutes(spans[s].start);
        else if (ahead === 1) when = 'tomorrow at ' + formatMinutes(spans[s].start);
        else when = DAY_NAMES[d] + ' at ' + formatMinutes(spans[s].start);
        return { state: 'closed', label: 'Closed · opens ' + when, detail: spec };
      }
    }

    return { state: 'closed', label: 'Closed', detail: spec };
  }

  // Turn the raw spec into one line per day, for the map popup.
  function formatWeek(spec) {
    var week = parseOpeningHours(spec);
    if (!week) return null;
    var order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
    return order.map(function (d) {
      var spans = week[d];
      return {
        day: DAY_NAMES[d],
        hours: spans.length
          ? spans
              .map(function (s) {
                return formatMinutes(s.start) + '-' + (s.end >= 1440 ? '24:00' : formatMinutes(s.end));
              })
              .join(', ')
          : 'Closed'
      };
    });
  }

  /* -------------------------------------------------------------- distance */

  // Great-circle distance in metres.
  function distanceMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function formatDistance(meters) {
    if (meters == null || !isFinite(meters)) return '';
    if (meters < 1000) return Math.round(meters / 10) * 10 + ' m';
    return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
  }

  /* -------------------------------------------------- shaping the results */

  function truthy(value) {
    return (
      value === 'yes' ||
      value === 'designated' ||
      value === 'wlan' ||
      value === 'terminal' ||
      value === 'limited'
    );
  }

  // Only let http(s) links through, so a bad tag cannot become a javascript: URL.
  function sanitiseUrl(value) {
    if (!value) return '';
    var url = String(value).trim();
    if (/^www\./i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\//i.test(url)) return '';
    try {
      return new URL(url).href;
    } catch (e) {
      return '';
    }
  }

  // Normalise one Overpass element into the shape the UI works with.
  function toCafe(element, origin) {
    var tags = element.tags || {};
    var lat = element.lat != null ? element.lat : element.center && element.center.lat;
    var lon = element.lon != null ? element.lon : element.center && element.center.lon;
    if (lat == null || lon == null) return null; // nothing to pin on the map

    var street = tags['addr:street'];
    var house = tags['addr:housenumber'];
    var address = street ? (house ? house + ' ' + street : street) : '';
    var city = tags['addr:city'] || tags['addr:suburb'] || '';
    if (address && city) address += ', ' + city;
    else if (!address && city) address = city;

    var hours = getOpenState(tags.opening_hours);

    return {
      id: element.type + '/' + element.id,
      name: tags.name || tags['name:en'] || tags.official_name || 'Unnamed coffee shop',
      lat: lat,
      lon: lon,
      address: address,
      brand: tags.brand || '',
      cuisine: (tags.cuisine || '').split(';')[0].replace(/_/g, ' '),
      phone: tags.phone || tags['contact:phone'] || '',
      website: sanitiseUrl(tags.website || tags['contact:website']),
      openingHours: tags.opening_hours || '',
      hoursState: hours.state,
      hoursLabel: hours.label,
      week: tags.opening_hours ? formatWeek(tags.opening_hours) : null,
      wifi: truthy(tags.internet_access),
      outdoor: truthy(tags.outdoor_seating),
      takeaway: truthy(tags.takeaway),
      wheelchair: truthy(tags.wheelchair),
      vegan: truthy(tags['diet:vegan']) || truthy(tags['diet:vegetarian']),
      distance: origin ? distanceMeters(origin.lat, origin.lon, lat, lon) : null
    };
  }

  // The single call the UI makes: a place (or coordinates) in, sorted cafes out.
  function search(options) {
    var signal = options.signal;
    var radius = options.radius || 1500;

    var locate = options.center ? Promise.resolve(options.center) : geocode(options.query, signal);

    return locate.then(function (center) {
      return fetchCafes(center.lat, center.lon, radius, signal).then(function (elements) {
        var cafes = [];
        var seen = {};

        for (var i = 0; i < elements.length; i++) {
          var cafe = toCafe(elements[i], center);
          if (!cafe) continue;
          // OSM often holds both a node and a building outline for one shop.
          var key = cafe.name.toLowerCase() + '|' + cafe.lat.toFixed(4) + '|' + cafe.lon.toFixed(4);
          if (seen[key]) continue;
          seen[key] = true;
          cafes.push(cafe);
        }

        cafes.sort(function (a, b) {
          return (a.distance || 0) - (b.distance || 0);
        });

        return { center: center, cafes: cafes, radius: radius };
      });
    });
  }

  global.OSM = {
    search: search,
    geocode: geocode,
    reverseGeocode: reverseGeocode,
    DataError: DataError,
    isAbort: isAbort,
    // exported so the test script can check them
    parseOpeningHours: parseOpeningHours,
    getOpenState: getOpenState,
    formatWeek: formatWeek,
    distanceMeters: distanceMeters,
    formatDistance: formatDistance,
    sanitiseUrl: sanitiseUrl
  };
})(typeof window !== 'undefined' ? window : globalThis);
