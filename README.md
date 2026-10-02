# ☕ CoffeeCup — Coffee Shop Finder

> Find coffee shops near any place. See what is **open right now**, who has Wi-Fi, outdoor seating or step-free access — all on a live map.


---

## 📸 Preview

<p align="center">
        <img src="Screenshot%202026-10-02%20234517.png" width="49%" alt="CoffeeCup landing page in dark mode" />
        <img src="Screenshot%202026-10-02%20234538.png" width="49%" alt="CoffeeCup map view before searching" />
        <img src="Screenshot%202026-10-02%20234606.png" width="49%" alt="CoffeeCup landing page in light mode" />
        <img src="Screenshot%202026-10-02%20235208.png" width="49%" alt="CoffeeCup coffee shop search results and map" />
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



## 📄 License

MIT.
