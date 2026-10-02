# ☕ CoffeeCup — Coffee Shop Finder

> Find coffee shops near any place. See what is **open right now**, who has Wi-Fi, outdoor seating or step-free access — all on a live map.


---

## 📸 Preview

<p align="center">
  <img src="https://github.com/user-attachments/assets/2dc7f674-62b4-4c39-b772-ad2439d84db0" width="50%" />
  <img src="https://github.com/user-attachments/assets/8b0e1fc7-61c3-4b46-bb15-2cb114b1df6f" width="50%" />
  <img src="https://github.com/user-attachments/assets/759dfde7-a203-41f0-aa52-9b126fc3a130" width="50%" />
</p>

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

**For "use my location", run a local server instead.** Browsers only share
location over `localhost` or HTTPS, so opening the file directly makes that
button fail:

```bash
npm start     # then open http://localhost:5173
```

Nothing to install — `npm start` just launches `npx serve`.

---

## 🗂️ Project structure

```
index.html     Landing page: search, plus live-location cups floating around it
results.html   Results page: card list on the left, clustered map on the right
404.html       Not-found page

shared.js      Theme (light/dark), toasts, recent searches, geolocation
osm.js         All data work: geocoding, Overpass, opening-hours parser, distance
script.js      Landing page, including the floating cups
results.js     Results page: map, cards, filters, sorting, loading/empty/error states
style.css      One stylesheet: design tokens first, then layout, then components

test/          npm test (73 unit tests) and npm run check (build check)
```

| Page | Scripts it loads |
|------|------------------|
| `index.html` | `shared.js`, `osm.js`, `script.js` |
| `results.html` | Leaflet + MarkerCluster (CDN), `shared.js`, `osm.js`, `results.js` |

`shared.js` loads in `<head>` on purpose, so the saved theme is applied before
the page paints and dark-mode users never see a white flash.

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

**No ratings, prices or photos.** An older version showed them from the
Foursquare API, which has since been switched off — its endpoints now answer
`410 Gone`, and the replacement needs a paid key that a browser-only app cannot
keep secret. Rather than invent numbers, those were replaced with facts
OpenStreetMap really holds: open-now status from real opening hours, distance,
Wi-Fi, outdoor seating, takeaway and step-free access.

---

## 🚢 Deploy

Static site, files at the repository root, no build step.

- **GitHub Pages:** Settings → Pages → branch `main`, folder `/ (root)`.
- **Netlify / Vercel:** connect the repo, leave the build command empty,
  publish directory `.`

---

## 📄 License

MIT.
