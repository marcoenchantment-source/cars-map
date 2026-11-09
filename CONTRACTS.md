# Cars Map — architecture & module contracts

Source of truth for everyone building a module. Read it fully before writing code.

## What we are building

A phone-first **GPS navigation web app** (PWA), served as static files from `app/`.
The owner will drive with it on their phone tomorrow at 10 am (Perth, Western Australia,
en-AU, metric, drives on the left). It must actually navigate: GPS, search, routes,
turn-by-turn voice, rerouting, arrival. Then the fun: a customisable 3D car with flame pops,
friends, chat by voice, crowd hazard reports, track-day lap timing, a voice copilot.

Original handwritten brief (owner's words, summarised):
- Like a "god's eye" map but with real-life traffic data.
- Contact other users through the map by voice chat converted into text.
- AI-powered: helps put the destination on the map, chooses a convenient route that avoids
  traffic where possible; interactive (music, texts, calls).
- Users report hazards on the route: hidden radar cameras, police, weather, etc.
- Add friends; see their location on the map only if allowed between those friends.
- Users modify their icon: a **car**. Change paint colour, rims, add **flames** that pop on a
  timer (every 1 s / 3 s / 5 s) in patterns: single pop, double pop, triple pop.
- Track races: the map zooms to fit the whole track for the device's screen.
- Show all routes used before as lines on roads passed before.
- Road changes: when users drive a road that is under modification (map is wrong), the map
  update is applied only once **50 or more users** pass on the same changed route.

## Stack & rules

- Plain ES modules in the browser, **no build step, no npm runtime deps** besides vendored
  files in `app/vendor/` (MapLibre GL 5.24 as global `maplibregl`, three.js 0.186 at
  `app/vendor/three/three.module.js`, nostr-tools 2.25 IIFE at `app/vendor/nostr.bundle.js`
  → global `NostrTools`, qrcode-generator at `app/vendor/qrcode.mjs`).
- CSP is `script-src 'self'`: **no inline scripts, no eval, no `new Function`**. External
  scripts must be vendored. `connect-src` allows any https/wss host.
- **Security:** never put user/remote text into `innerHTML`. Build DOM with `ui.el()` (which
  uses textContent). Validate all remote data (relay events, API JSON) before use; treat it as
  untrusted. Never log keys. Keys live only in `store.get().settings` (persisted locally).
- **Immutability:** never mutate store state or objects you received; build new ones.
- Files small and focused (aim < 400 lines, hard max 800). Functions < 50 lines where practical.
- Errors: handle at every boundary (network, permissions, storage). User-facing messages say
  what happened and what to do. `console.error/warn` for failures only; no `console.log`.
- Pure logic goes in DOM-free files and gets **unit tests** in `tests/<area>.test.js` using
  `node:test` + `node:assert/strict` (run `npm test` from the project root). Aim for 80%+
  coverage of pure logic.
- Driving safety: big touch targets (≥ 48 px, primary driving controls ≥ 56 px), short text,
  voice where possible, no tiny text in the driving HUD.
- en-AU copy. Plain, active, short. "Re-centre", "kilometres", "servo" is fine for petrol station.

## Running it

- `npm run vendor` (already done) · `npm start` → http://127.0.0.1:8787 · `npm test`.
- In dev (localhost or `?debug`), `window.__carsmap` is the app context.
- No real GPS on a desktop: the nav module provides a **demo drive** that feeds simulated fixes
  along a route (and accepts manual fixes) — use it to test.

## The context object (`ctx`)

Every feature module exports `async function init(ctx)`; `main.js` imports it dynamically
inside try/catch (a failing module never breaks the app). `ctx` is frozen:

| key | what |
|---|---|
| `store` | `createStore` — `get()`, `set(patch \| fn)`, `subscribe(fn)`, `select(selector, fn, {immediate})` (core/store.js) |
| `bus` | event bus — `on(evt, fn) → off`, `once`, `off`, `emit(evt, payload)` (core/bus.js) |
| `ui` | UI kit (ui/ui.js): `el`, `clear`, `icon`, `iconButton`, `toast`, `notice`, `sheet`, `addFab`, `addDockItem`, `registerSettingsSection`, `toggleRow`, `segmented` |
| `geo` | pure geo helpers (core/geo.js): haversine, bearing, angleDiff, destination, cumulativeDistances, nearestOnLine, pointAlong, sliceAlong, bboxOf, simplify, decodePolyline, geohashEncode/Bounds/Neighbors, formatDistance, spokenDistance, formatDuration, speedForDisplay |
| `storage` | `load(key, fallback)`, `save(key, value)`, `remove(key)` — namespaced, safe localStorage |
| `config` | config.js constants (ENDPOINTS, NOSTR_RELAYS, NAV, ROAD_CONSENSUS_USERS, DEFAULT_CAR, DEFAULT_SETTINGS, HAZARD_TYPES, DEFAULT_CENTER) |
| `actions` | `register(name, fn)`, `call(name, ...args)`, `has(name)` — cross-module verbs |
| `map` | the `maplibregl.Map` |
| `mapView` | `{ map, ready (Promise), camera, routes, land, fitBounds(bbox), hudPadding(), setDestination(place\|null), reduceMotion }` |

`mapView.camera`: `onFrame(fn(pose)) → off` (fires every animation frame with the interpolated
pose; the 3D car uses this so it moves in lockstep with the camera), `pose()`, `recenter()`.

`mapView.routes`: `showRoutes(routes, selectedIndex)`, `setActiveRoute(route)`,
`setRemaining(coords)`, `clear()`. Always `await ctx.mapView.ready` before adding sources/layers.
Custom layer ids must start with `cm-`. Add data layers before `'label-road'` unless they must
sit on top (car, markers).

## Store shape (`store.get()`)

```js
{
  mode: 'explore' | 'preview' | 'navigate' | 'race',
  follow: boolean,              // camera follows the car (set false on user gestures)
  theme: 'light' | 'dark',      // resolved look; <html data-theme> mirrors it
  settings: { voice, units, avoidTolls, avoidMotorways, avoidFerries, theme, buildings3d,
              traffic, showDrivenRoads, car3d, tomtomKey, anthropicKey },
  car: CarLook,
  position: Fix | null,         // latest raw GPS fix (nav module writes it)
  destination: Place | null,
  routes: Route[], selectedRoute: number,   // preview
  activeRoute: Route | null,    // being driven
  progress: NavProgress | null,
  online: boolean,
}
```
Update with new objects: `store.set(s => ({ settings: { ...s.settings, voice: false } }))`.
`settings` and `car` persist automatically.

## Data models

```js
Fix      = { lng, lat, accuracy /*m*/, speed /*m/s|null*/, heading /*deg|null*/, timestamp /*ms*/, simulated: bool }
Pose     = { lng, lat, bearing /*deg*/, speed /*m/s*/, accuracy, onRoute: bool }
Place    = { id, name, label /*address line*/, lng, lat, kind? /*e.g. 'fuel'*/, source? }
Route    = {
  id, provider: 'osrm'|'valhalla'|'tomtom',
  geometry: [[lng,lat],...], cum: number[] /* geo.cumulativeDistances(geometry) */,
  distance /*m*/, duration /*s, best estimate incl. traffic if known*/,
  durationNoTraffic? /*s*/, trafficDelay? /*s*/,
  summary /* "via Mitchell Fwy" */, bbox: [w,s,e,n],
  steps: Step[], congestion?: [{ coords:[[lng,lat]...], level:'free'|'slow'|'heavy'|'closed' }],
  hasTolls?: bool, options: { avoidTolls, avoidMotorways, avoidFerries }
}
Step     = {
  index, type /* depart|turn|continue|merge|on-ramp|off-ramp|fork|end-of-road|roundabout|rotary|exit-roundabout|uturn|arrive|new-name|notification */,
  modifier /* uturn|sharp right|right|slight right|straight|slight left|left|sharp left|null */,
  location: [lng,lat], along /* m from route start where the manoeuvre happens */,
  distance /* m of this step */, duration /* s */, road /* name or ref, may be '' */,
  exit? /* roundabout exit number */, instruction /* "Turn left onto Hay Street" */,
}
NavProgress = {
  routeId, snapped:[lng,lat], along, offRouteMeters, onRoute: bool,
  distanceRemaining, durationRemaining, eta /*epoch ms*/,
  stepIndex /* index of NEXT manoeuvre */, distanceToManeuver, currentRoad, speed,
}
CarLook  = { name, color /*#hex*/, rim: 'five'|'mesh'|'dish', pat: 'off'|'single'|'double'|'triple', int: 1|3|5, body: 'coupe'|'ute'|'hatch' }
Hazard   = { id, type /* config.HAZARD_TYPES id */, lng, lat, reportedAt, expiresAt, confirms, denies, by /*pubkey hex*/, mine: bool }
Friend   = { pubkey /*hex*/, name, sharing: bool /* I share my location with them */, theirLocation?: {lng,lat,bearing,speed,at}, car?: CarLook }
```

## Events (bus)

| event | payload | emitted by |
|---|---|---|
| `gps:fix` | Fix | nav (real GPS or demo drive) |
| `gps:sim` | `{ active }` — a simulation (demo drive, demo lap) is feeding `simulated: true` fixes; real GPS is ignored while active | nav, race |
| `gps:status` | `{ state: 'prompt'\|'granted'\|'denied'\|'unavailable'\|'searching'\|'ok', message? }` | nav |
| `pose` | Pose — the car's displayed position (snapped to route while navigating) | nav |
| `nav:start` | `{ route }` | nav |
| `nav:progress` | NavProgress | nav |
| `nav:step` | `{ step, nextStep }` when the upcoming manoeuvre changes | nav |
| `nav:offroute` / `nav:rerouted` | `{}` / `{ route }` | nav |
| `nav:arrive` | `{ destination, trip: { startedAt, endedAt, distance, duration, avgSpeed, maxSpeed, track } }` | nav |
| `nav:stop` | `{ reason: 'user'\|'arrived' }` | nav |
| `route:pick` | `{ index }` — user tapped an alternative on the map | map |
| `route:ready` | `{ routes, destination }` | search |
| `place:selected` | Place | search |
| `map:longpress` | `{ lngLat }` | map |
| `map:landed` | `{ center }` intro finished | map |
| `mode:change` | `{ mode }` | main |
| `voice:say` | `{ text, priority: 'high'\|'normal' }` — anyone can ask the voice to speak | anyone |
| `hazards:updated` | `{ hazards }` | social |
| `friends:updated` | `{ friends }` | social |
| `chat:message` | `{ from: Friend, text, at, incoming: bool }` | social |
| `car:changed` | CarLook | car |
| `settings:open` | `{ focus? }` | anyone |
| `app:ready` | `{}` | main |

## Actions (cross-module verbs; the copilot calls these)

| name | signature | owner |
|---|---|---|
| `search` | `(query, { near?: [lng,lat], limit? }) → Promise<Place[]>` | search |
| `reverseGeocode` | `([lng,lat]) → Promise<Place\|null>` | search |
| `planRoute` | `(place) → Promise<Route[]>` (opens the route preview) | search |
| `startNavigation` | `(route, destination) → void` | nav |
| `stopNavigation` | `() → void` | nav |
| `startDemoDrive` | `(route, { speedFactor? }) → void` | nav |
| `navStatus` | `() → { eta, distanceRemaining, durationRemaining, nextInstruction, destination } \| null` | nav |
| `say` | `(text) → void` | nav |
| `reportHazard` | `(type, { lngLat? }) → Promise<void>` | social |
| `sendMessage` | `(friendName, text) → Promise<void>` | social |
| `listFriends` | `() → Friend[]` | social |
| `openGarage` | `() → void` | car |
| `setCarLook` | `(patch: Partial<CarLook>) → void` | car |
| `popFlames` | `() → void` | car |
| `openRace` | `() → void` | race |
| `openTrips` | `() → void` | history |
| `setSetting` | `(key, value) → void` | main |
| `recenter` | `() → void` | main |

## UI kit & layout

DOM slots in `index.html` (all inside `#app`, which carries `data-mode`):
- `#search-slot` (top; hidden while navigating/racing) — search module.
- `#nav-banner-slot` (top) — nav module manoeuvre banner.
- `#hud-left` (bottom-left column) — nav speed gauge; race lap timer may add here.
- `#fabs` (bottom-right column) — via `ui.addFab({ id, icon, label, onClick, order, tone, modes, size })`.
  Orders in use: compass 5, layers 8, recenter 10. Suggested: report hazard 30 (tone 'warn',
  size 'lg', modes all), copilot mic 40 (tone 'accent'), friends 50.
- `#bottom-slot` (above the dock) — nav ETA bar / race panel.
- `#dock` (explore only) — via `ui.addDockItem({ id, icon, label, onClick, order })`.
  Orders: Garage 20, Crew (friends) 30, Track day 40, Logbook 50, Settings 90.
- `#notices` — `ui.notice({ id, iconName, title, body, tone, actions, ms })` for hazard-ahead,
  incoming messages, friend requests.
- `#toasts` — `ui.toast(msg, { tone })`.
- One sheet: `ui.sheet.open({ id, title, render(body, api), onClose, size: 'auto'|'tall' })`,
  `ui.sheet.close(id)`, `ui.sheet.currentId()`.

CSS: tokens in `css/app.css` (`--land --water --park --ink --ink-2 --ink-3 --surface --surface-2
--surface-3 --line --pill --pill-2 --pill-ink --pill-ink-2 --accent --accent-strong --accent-ink
--accent-soft --flame --flame-2 --good --warn --bad --shadow --shadow-sm --font-display
--font-body --r-xl --r-lg --r-md --r-sm --gap`). Components: `.btn .btn-accent .btn-ghost
.btn-danger .btn-go .btn-sm .btn-block .icon-btn .fab .dock .hud-pill .card .list .row
.row-icon .row-text .row-title .row-hint .row-meta .chip[aria-pressed] .field .input .seg
.section-title .stack .cluster .spread .muted .small .num`. Put module-specific CSS only in
your own `css/<module>.css` (already linked). Use tokens, never literal colours that work in
one theme only (car paint colours are content, they're fine). Display numerals:
`font-family: var(--font-display)` + tabular-nums. Respect `prefers-reduced-motion`.

Visual identity: lavender land, ink-dark HUD pills (from the owner's prototype), violet accent,
flame orange/yellow for anything "hot" (flames, Go button, hazard report). Typeface pair:
Saira Semi Condensed (display, numerals — motorsport feel) + Figtree (UI text).

## Module ownership (do not edit files you don't own)

| module dir | owner | files |
|---|---|---|
| `core/ map/ ui/ settings/ main.js config.js css/app.css index.html` | lead | — |
| `search/` (+ `routing/`) | agent A | search UI, geocoding, routing providers, route preview |
| `nav/` | agent B | GPS, demo drive, nav engine, voice, wake lock, HUD, arrival |
| `car/` | agent C | 3D car layer, 2D car art, flames, garage, friends' car markers helper |
| `social/` | agent D | identity, relays, friends, location sharing, chat, hazards, road-change consensus |
| `history/ race/ assistant/` | agent E | trips & driven roads, track day, voice copilot |

If you need something from a file you don't own (a new store key, a CSS token, a config
constant), **don't edit it** — put the request in your final report and work around it locally.
