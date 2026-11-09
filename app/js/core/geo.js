// Pure geographic helpers. Every coordinate is a [lng, lat] array.
// No DOM, no globals: safe to unit test under Node.

export const EARTH_RADIUS_M = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const toRad = (deg) => deg * D2R;
export const toDeg = (rad) => rad * R2D;
export const normalizeBearing = (deg) => ((deg % 360) + 360) % 360;

/** Great-circle distance in metres. */
export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * D2R;
  const dLng = (b[0] - a[0]) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearing(a, b) {
  const p1 = a[1] * D2R;
  const p2 = b[1] * D2R;
  const dl = (b[0] - a[0]) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return normalizeBearing(Math.atan2(y, x) * R2D);
}

/** Signed smallest turn from bearing a to bearing b, in (-180, 180]. Positive = clockwise (right). */
export function angleDiff(a, b) {
  const d = normalizeBearing(b - a);
  return d > 180 ? d - 360 : d;
}

/** Point reached travelling `dist` metres from p on bearing `brg`. */
export function destination(p, dist, brg) {
  const delta = dist / EARTH_RADIUS_M;
  const theta = brg * D2R;
  const p1 = p[1] * D2R;
  const l1 = p[0] * D2R;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(delta) + Math.cos(p1) * Math.sin(delta) * Math.cos(theta),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(p1),
      Math.cos(delta) - Math.sin(p1) * Math.sin(p2),
    );
  return [((l2 * R2D + 540) % 360) - 180, p2 * R2D];
}

/** Cumulative distance (m) at each vertex of a polyline. */
export function cumulativeDistances(coords) {
  if (!coords || coords.length === 0) return [];
  const out = new Array(coords.length);
  out[0] = 0;
  for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + haversine(coords[i - 1], coords[i]);
  return out;
}

/** Project p onto segment a-b using a local flat projection centred on p (accurate for short segments). */
export function projectOnSegment(p, a, b) {
  const kx = Math.cos(p[1] * D2R) * D2R * EARTH_RADIUS_M;
  const ky = D2R * EARTH_RADIUS_M;
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * ky;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return {
    t,
    dist: Math.hypot(px, py),
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  };
}

/**
 * Closest point on a polyline to p.
 * @param {number[][]} coords polyline
 * @param {number[]} cum cumulativeDistances(coords)
 * @param {number[]} p query point
 * @param {{from?: number, to?: number}} [range] vertex window to search (inclusive)
 * @returns {{index:number,t:number,dist:number,point:number[],along:number}|null}
 *   index = segment start vertex, along = metres from line start.
 */
export function nearestOnLine(coords, cum, p, range = {}) {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) {
    return { index: 0, t: 0, dist: haversine(p, coords[0]), point: coords[0], along: 0 };
  }
  const from = Math.max(0, range.from ?? 0);
  const to = Math.min(coords.length - 1, range.to ?? coords.length - 1);
  let best = null;
  for (let i = from; i < to; i++) {
    const r = projectOnSegment(p, coords[i], coords[i + 1]);
    if (!best || r.dist < best.dist) {
      best = {
        index: i,
        t: r.t,
        dist: r.dist,
        point: r.point,
        along: cum[i] + r.t * (cum[i + 1] - cum[i]),
      };
    }
  }
  return best;
}

/** Index i such that cum[i] <= along < cum[i+1] (clamped). */
export function segmentIndexAt(cum, along) {
  if (cum.length < 2) return 0;
  if (along <= 0) return 0;
  if (along >= cum[cum.length - 1]) return cum.length - 2;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point and travel bearing `along` metres from the start of the line. */
export function pointAlong(coords, cum, along) {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) return { point: coords[0], index: 0, bearing: 0 };
  const i = segmentIndexAt(cum, along);
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? Math.max(0, Math.min(1, (along - cum[i]) / segLen)) : 0;
  const a = coords[i];
  const b = coords[i + 1];
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    index: i,
    bearing: bearing(a, b),
  };
}

/** New polyline covering [fromAlong, toAlong] metres of the line. */
export function sliceAlong(coords, cum, fromAlong, toAlong = Infinity) {
  if (!coords || coords.length < 2) return coords ? [...coords] : [];
  const total = cum[cum.length - 1];
  const start = Math.max(0, Math.min(total, fromAlong));
  const end = Math.max(start, Math.min(total, toAlong));
  const a = pointAlong(coords, cum, start);
  const b = pointAlong(coords, cum, end);
  const out = [a.point];
  for (let i = a.index + 1; i <= b.index; i++) out.push(coords[i]);
  out.push(b.point);
  return out;
}

/** [west, south, east, north] */
export function bboxOf(coords) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const c of coords) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w, s, e, n];
}

/** Ramer-Douglas-Peucker simplification with tolerance in metres. Returns a new array. */
export function simplify(coords, toleranceM = 5) {
  if (!coords || coords.length <= 2) return coords ? [...coords] : [];
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = -1;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = projectOnSegment(coords[i], coords[first], coords[last]).dist;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Decode a Google-style encoded polyline (precision 5 for Google/OSRM, 6 for Valhalla) into [lng, lat]. */
export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length + 1);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length + 1);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

// ---------- geohash (used to bucket shared hazard reports by area) ----------

const GH32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(lat, lng, precision = 6) {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngLo = mid;
      } else {
        ch <<= 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch <<= 1;
        latHi = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += GH32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Bounds of a geohash cell: {south, west, north, east}. */
export function geohashBounds(hash) {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let even = true;
  for (const c of hash.toLowerCase()) {
    const v = GH32.indexOf(c);
    if (v < 0) throw new Error(`Invalid geohash character: ${c}`);
    for (let b = 4; b >= 0; b--) {
      const bitOn = (v >> b) & 1;
      if (even) {
        const mid = (lngLo + lngHi) / 2;
        if (bitOn) lngLo = mid;
        else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (bitOn) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { south: latLo, west: lngLo, north: latHi, east: lngHi };
}

/** The cell plus its 8 neighbours (same precision). */
export function geohashNeighbors(hash) {
  const b = geohashBounds(hash);
  const dLat = b.north - b.south;
  const dLng = b.east - b.west;
  const cLat = (b.north + b.south) / 2;
  const cLng = (b.east + b.west) / 2;
  const out = new Set();
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      const lat = Math.max(-89.999, Math.min(89.999, cLat + dy * dLat));
      const lng = ((cLng + dx * dLng + 540) % 360) - 180;
      out.add(geohashEncode(lat, lng, hash.length));
    }
  }
  return [...out];
}

// ---------- formatting ----------

/** Display distance: {value, unit, text}. units: 'metric' | 'imperial'. */
export function formatDistance(m, units = 'metric') {
  if (!Number.isFinite(m)) return { value: '–', unit: '', text: '–' };
  if (units === 'imperial') {
    const miles = m / 1609.344;
    if (miles < 0.1) {
      const ft = Math.max(10, Math.round((m * 3.28084) / 10) * 10);
      return { value: String(ft), unit: 'ft', text: `${ft} ft` };
    }
    const v = miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
    return { value: v, unit: 'mi', text: `${v} mi` };
  }
  if (m < 1000) {
    const step = m < 100 ? 10 : 50;
    const v = Math.max(step === 10 ? 10 : 50, Math.round(m / step) * step);
    if (v >= 1000) return { value: '1.0', unit: 'km', text: '1.0 km' };
    return { value: String(v), unit: 'm', text: `${v} m` };
  }
  const km = m / 1000;
  const v = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return { value: v, unit: 'km', text: `${v} km` };
}

/** Distance phrased for speech, e.g. "300 metres", "1.5 kilometres". */
export function spokenDistance(m, units = 'metric') {
  if (units === 'imperial') {
    const miles = m / 1609.344;
    if (miles < 0.15) return `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} feet`;
    if (miles < 0.4) return 'a quarter of a mile';
    if (miles < 0.65) return 'half a mile';
    const v = miles < 10 ? Number(miles.toFixed(1)) : Math.round(miles);
    return `${v} ${v === 1 ? 'mile' : 'miles'}`;
  }
  if (m < 1000) {
    const step = m < 200 ? 10 : 50;
    return `${Math.max(10, Math.round(m / step) * step)} metres`;
  }
  const km = m / 1000;
  const v = km < 10 ? Number(km.toFixed(1)) : Math.round(km);
  return `${v} ${v === 1 ? 'kilometre' : 'kilometres'}`;
}

/** "1 h 05 min", "12 min", "< 1 min". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  const mins = Math.round(seconds / 60);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, '0');
  return `${h} h ${mm} min`;
}

/** Speed in m/s to display units (km/h or mph), rounded. */
export function speedForDisplay(mps, units = 'metric') {
  if (!Number.isFinite(mps) || mps < 0) return 0;
  return Math.round(units === 'imperial' ? mps * 2.236936 : mps * 3.6);
}
