# Cars Map

A phone-first GPS navigation web app with your own customisable 3D car (paint, rims, body,
flame pops), voice turn-by-turn directions, crowd hazard reports, friends with encrypted live
location and voice-to-text chat, satellite / terrain / weather views, track-day lap timing,
a logbook of every road you've driven, and a voice copilot.

## Use it

Open the GitHub Pages link on your phone, allow location (and the microphone for voice), tap
**Where to?**, then **Go**. Add it to your home screen for a full-screen app. It keeps working
offline once loaded.

Optional keys (Settings → Live traffic & AI, stored only on your phone):
- **TomTom key** (free tier) for live traffic colours and traffic-aware routes.
- **Claude API key** for a copilot that can answer anything.

## Develop

```bash
npm install        # pinned libraries
npm run vendor     # copy them into app/vendor
npm start          # http://127.0.0.1:8787
npm test           # unit tests (node:test)
```

Pushing to `main` runs the tests and deploys `app/` to GitHub Pages
(`.github/workflows/pages.yml`). Architecture and module contracts: [CONTRACTS.md](CONTRACTS.md).

## Data & credits

Map data © OpenStreetMap contributors · tiles by OpenFreeMap · routing by OSRM and Valhalla ·
places by Photon (komoot) · imagery © Esri · elevation from Mapzen Terrain Tiles (AWS Open Data) ·
rain radar by RainViewer · weather by Open-Meteo · friends and hazard reports over public Nostr
relays · built with MapLibre GL, three.js and nostr-tools.
