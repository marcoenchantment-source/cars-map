// App-wide constants. Every network host the app talks to is listed here.

export const APP_NAME = 'Cars Map';
export const APP_VERSION = '1.1.0';

/**
 * The app's own TomTom key (live traffic, traffic-aware routes, full address search).
 * It is a browser key: it ships to every phone, so it MUST be restricted to this app's
 * domain in the TomTom dashboard (Keys → Domain whitelisting). Empty = free services only.
 */
export const TOMTOM_KEY = '';

/** Perth CBD: the start view before GPS answers (the original prototype was set in Perth). */
export const DEFAULT_CENTER = [115.8605, -31.9505];
export const DEFAULT_ZOOM = 12.5;

export const ENDPOINTS = Object.freeze({
  tiles: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  osrm: 'https://router.project-osrm.org',
  valhalla: 'https://valhalla1.openstreetmap.de',
  photon: 'https://photon.komoot.io',
  nominatim: 'https://nominatim.openstreetmap.org',
  tomtom: 'https://api.tomtom.com',
  anthropic: 'https://api.anthropic.com/v1/messages',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile',
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
  rainviewer: 'https://api.rainviewer.com/public/weather-maps.json',
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
});

/** Public Nostr relays used for friends, chat and shared hazard reports. */
export const NOSTR_RELAYS = Object.freeze([
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://offchain.pub',
]);

export const NAV = Object.freeze({
  /** Distance from the route line (beyond GPS accuracy) that counts as off-route. */
  offRouteMeters: 40,
  /** Consecutive off-route fixes before rerouting. */
  offRouteFixes: 3,
  rerouteCooldownMs: 12000,
  /** Distance to the destination that counts as arrived. */
  arriveMeters: 35,
});

/** A crowd-detected road change is applied once this many different drivers confirm it. */
export const ROAD_CONSENSUS_USERS = 50;

export const DEFAULT_CAR = Object.freeze({
  name: 'You',
  color: '#1e88e5',
  rim: 'five', // five | mesh | dish
  pat: 'double', // off | single | double | triple  (flame pops)
  int: 3, // seconds between flame pops: 1 | 3 | 5
  body: 'coupe', // coupe | ute | hatch
});

export const DEFAULT_SETTINGS = Object.freeze({
  voice: true,
  units: 'metric', // metric | imperial
  avoidTolls: false,
  avoidMotorways: false,
  avoidFerries: false,
  theme: 'auto', // auto (day/night by sun) | system | light | dark
  buildings3d: true,
  view3d: true, // tilted chase view; false = flat top-down map
  mapView: 'standard', // standard | satellite | terrain | weather
  traffic: true, // live traffic colours (needs TOMTOM_KEY)
  showDrivenRoads: true,
  car3d: true,
});

/** Hazard types users can report. `ttlMin` = minutes before a report fades unless re-confirmed. */
export const HAZARD_TYPES = Object.freeze([
  { id: 'police', label: 'Police', ttlMin: 60 },
  { id: 'camera', label: 'Speed camera', ttlMin: 240 },
  { id: 'crash', label: 'Crash', ttlMin: 90 },
  { id: 'hazard', label: 'Hazard on road', ttlMin: 60 },
  { id: 'roadworks', label: 'Roadworks', ttlMin: 720 },
  { id: 'weather', label: 'Weather', ttlMin: 120 },
  { id: 'closure', label: 'Road closed', ttlMin: 360 },
  { id: 'traffic', label: 'Traffic jam', ttlMin: 45 },
]);
