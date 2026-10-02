# ☕ CoffeeCup — Coffee Shop Finder

> Find coffee shops near any place. See what is **open right now**, who has Wi-Fi, outdoor seating or step-free access — all on a live map.

No API key. No backend. No sign-up.

---

## 📸 Preview

<p align="center">
  <img src="https://github.com/user-attachments/assets/2dc7f674-62b4-4c39-b772-ad2439d84db0" width="50%" />
  <img src="https://github.com/user-attachments/assets/8b0e1fc7-61c3-4b46-bb15-2cb114b1df6f" width="50%" />
  <img src="https://github.com/user-attachments/assets/759dfde7-a203-41f0-aa52-9b126fc3a130" width="50%" />
</p>

---

## 📑 Contents

- [Run it](#-run-it)
- [How it works](#-how-it-works)
- [Project structure](#-project-structure)
- [Where the data comes from](#-where-the-data-comes-from)
- [Tests](#-tests)
- [Deploy](#-deploy)
- [License](#-license)

---

## 🚀 Run it

It is a plain static site. There is no build step.

**Quickest way — just open the file:**

```bash
git clone https://github.com/Tabassum-Sumaiya13/Coffee-Cup.git
cd Coffee-Cup
start index.html      # Windows
# open index.html     # macOS
```

That works because all scripts are classic `<script>` tags, so the browser does
not block them on `file://`.

**Better way — run a local server** (needed if you want the "use my location"
button, because browsers only share location over `http://localhost` or HTTPS):

```bash
npm start
```

Then open <http://localhost:5173>. The only thing `npm start` does is launch
`npx serve`; there are **no dependencies to install**.

---

## 🧠 How it works

One search makes exactly **two** network calls:

```
You type "Brooklyn"
        │
        ▼
1. Nominatim  ──►  turns the text into coordinates (40.65, -73.95)
        │
        ▼
2. Overpass   ──►  lists every cafe within the chosen radius
        │
        ▼
   osm.js shapes the raw tags into cafe objects
   (name, address, open/closed, distance, Wi-Fi, outdoor seating…)
        │
        ▼
   results.js renders the cards and the map markers
```

A few details worth knowing:

- **Opening hours are calculated, not just displayed.** `osm.js` parses the raw
  OpenStreetMap `opening_hours` string (things like
  `Mo-Fr 07:30-19:00; Sa,Su 08:30-19:00`) and works out whether the place is
  open *at this moment*, including hours that run past midnight. If a string is
  too unusual to read, the app shows the raw text instead of guessing.
- **Overpass is volunteer-run and often busy.** The app tries four different
  Overpass servers in turn before giving up, so one overloaded server does not
  break the search.
- **Searches cancel each other.** Starting a new search aborts the old one, so
  slow results can never overwrite newer ones.
- **The URL holds the search.** `results.html?search=Brooklyn&radius=3000` can be
  shared or reloaded and gives the same results.

---

## 🗂️ Project structure

```
index.html     Landing page: search box, "use my location", suggestion chips
results.html   Results page: card list on the left, map on the right
404.html       Not-found page

shared.js      Theme switching (light/dark), toasts, recent searches, geolocation
osm.js         All data work: geocoding, Overpass, opening-hours parser, distance
script.js      Landing page behaviour
results.js     Results page: map, cards, filters, sorting, loading/empty/error states
style.css      One stylesheet. Design tokens at the top, then layout, then components

favicon.svg    Site icon
coffee-cup2.png  Cup artwork on the landing page

test/
  opening-hours.test.js   73 tests for the hours parser, distance and URL safety
  syntax-check.js         Build check (see below)
```

**Who loads what**

| Page | Scripts |
|------|---------|
| `index.html` | `shared.js`, `script.js` |
| `results.html` | Leaflet (CDN), `shared.js`, `osm.js`, `results.js` |
| `404.html` | `shared.js` |

`shared.js` is loaded in `<head>` on purpose, so the saved theme is applied
before the page paints and dark-mode users never see a white flash.

---

## 🌍 Where the data comes from

| What | Service | Key needed |
|------|---------|-----------|
| Place search | [Nominatim](https://nominatim.org/) | No |
| Coffee shops | [Overpass](https://overpass-api.de/) (OpenStreetMap) | No |
| Map tiles | OpenStreetMap | No |
| Map library | [Leaflet 1.9.4](https://leafletjs.com/) via CDN | No |

Everything comes from **OpenStreetMap**, so the app needs no account and no
secret key.

### A note on ratings, prices and photos

Earlier versions showed star ratings, price levels and photos from the
Foursquare Places API. **That API has been switched off** — its old endpoints now
answer `410 Gone`, and the replacement needs a paid key, which cannot be kept
secret in a site that runs entirely in the browser.

Rather than show fake numbers, those fields were replaced with facts
OpenStreetMap actually records:

| Removed | Replaced with |
|---------|---------------|
| Star rating | **Open now / closed**, worked out from real opening hours |
| Price level | **Distance** from your search point |
| Photos | A generated colour tile per cafe |
| — | Wi-Fi, outdoor seating, takeaway, step-free access filters |

> ⚠️ If you are browsing the git history: older commits contain a hard-coded
> Foursquare API key. That key is dead, but if it was ever reused elsewhere,
> revoke it.

---

## ✅ Tests

```bash
npm test     # 73 tests: opening-hours parser, distance, URL safety
npm run check    # build check
```

`npm run check` stands in for a build step. It confirms that:

- every script parses,
- no file uses `import`/`export` (they are loaded as classic scripts, so that
  would silently break the page — this is the exact bug that once killed
  `script.js`),
- every local file referenced by the HTML really exists,
- no API key has been committed,
- the CSS braces balance,
- every `getElementById` has a matching element.

Both commands use plain Node. Nothing to install.

---

## 🚢 Deploy

The site is static, so any host works. Files sit at the repository root, so no
build settings are needed.

**GitHub Pages:** Settings → Pages → deploy from branch `main`, folder `/ (root)`.

**Netlify / Vercel / Cloudflare Pages:** connect the repo and leave the build
command empty. Publish directory: `.` (the root).

---

## 📄 License

MIT.
