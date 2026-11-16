// Builds app/data/world-tracks.json from OpenStreetMap race-track data (via Overpass).
// Runs monthly in GitHub Actions so track changes reach the app; safe to run by hand too:
//   node scripts/build-tracks.mjs            (all circuits)
//   node scripts/build-tracks.mjs wanneroo   (only ids containing "wanneroo")
// A circuit that can't be fetched keeps its previous entry, so a flaky run never loses tracks.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCircuit } from '../app/js/race/worldTracks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'app', 'data', 'world-tracks.json');
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'CarsMap-track-builder/1.0 (+https://github.com/marcoenchantment-source/cars-map)';
const BOX = 0.025; // degrees around the circuit's rough centre
const PAUSE_MS = 4000;

// [id, name, country, lat, lng, other names] — rough centres; the build finds the actual shape nearby.
export const CIRCUITS = [
  ['wanneroo', 'Wanneroo Raceway', 'Australia', -31.661, 115.786, ['Barbagallo', 'Perth', 'Neerabup']],
  ['collie', 'Collie Motorplex', 'Australia', -33.375, 116.262, ['Western Australia']],
  ['albert-park', 'Albert Park Circuit', 'Australia', -37.8497, 144.968],
  ['bathurst', 'Mount Panorama, Bathurst', 'Australia', -33.4485, 149.558, ['Bathurst 1000']],
  ['phillip-island', 'Phillip Island Grand Prix Circuit', 'Australia', -38.5016, 145.2321],
  ['sydney-motorsport-park', 'Sydney Motorsport Park', 'Australia', -33.803, 150.871, ['Eastern Creek', 'Sydney']],
  ['the-bend', 'The Bend Motorsport Park', 'Australia', -35.29, 139.45, ['Tailem Bend', 'Adelaide']],
  ['queensland-raceway', 'Queensland Raceway', 'Australia', -27.6906, 152.6544, ['Ipswich', 'Willowbank', 'Brisbane']],
  ['winton', 'Winton Motor Raceway', 'Australia', -36.5207, 146.0881],
  ['sandown', 'Sandown Raceway', 'Australia', -37.9497, 145.1675, ['Melbourne', 'Springvale']],
  ['hidden-valley', 'Hidden Valley Raceway', 'Australia', -12.4436, 130.9087, ['Darwin']],
  ['symmons-plains', 'Symmons Plains Raceway', 'Australia', -41.654, 147.25, ['Tasmania', 'Launceston']],
  ['morgan-park', 'Morgan Park Raceway', 'Australia', -28.262, 152.035],
  ['hampton-downs', 'Hampton Downs', 'New Zealand', -37.359, 175.08],
  ['highlands', 'Highlands Motorsport Park', 'New Zealand', -45.057, 169.234],
  ['silverstone', 'Silverstone', 'United Kingdom', 52.0786, -1.0169, ['UK', 'England', 'British GP']],
  ['brands-hatch', 'Brands Hatch', 'United Kingdom', 51.3569, 0.2631, ['UK', 'England']],
  ['monza', 'Monza', 'Italy', 45.6156, 9.2811, ['Autodromo Nazionale']],
  ['imola', 'Imola', 'Italy', 44.3439, 11.7167, ['Enzo e Dino Ferrari']],
  ['mugello', 'Mugello', 'Italy', 43.9975, 11.3719],
  ['spa', 'Spa-Francorchamps', 'Belgium', 50.4372, 5.9714],
  ['zandvoort', 'Zandvoort', 'Netherlands', 52.3888, 4.5409],
  ['nurburgring-gp', 'Nürburgring GP', 'Germany', 50.3356, 6.9475, ['Nurburgring', 'Nuerburgring']],
  ['red-bull-ring', 'Red Bull Ring', 'Austria', 47.2197, 14.7647],
  ['hungaroring', 'Hungaroring', 'Hungary', 47.5789, 19.2486],
  ['barcelona', 'Circuit de Barcelona-Catalunya', 'Spain', 41.57, 2.2611],
  ['le-mans-bugatti', 'Le Mans Bugatti Circuit', 'France', 47.9497, 0.2075],
  ['paul-ricard', 'Circuit Paul Ricard', 'France', 43.2506, 5.7917],
  ['monaco', 'Circuit de Monaco', 'Monaco', 43.7347, 7.4206],
  ['suzuka', 'Suzuka', 'Japan', 34.8431, 136.541],
  ['fuji', 'Fuji Speedway', 'Japan', 35.3717, 138.9271],
  ['shanghai', 'Shanghai International Circuit', 'China', 31.3389, 121.2197],
  ['marina-bay', 'Marina Bay Street Circuit', 'Singapore', 1.2914, 103.864],
  ['sepang', 'Sepang International Circuit', 'Malaysia', 2.7608, 101.7382],
  ['yas-marina', 'Yas Marina', 'United Arab Emirates', 24.4672, 54.6031],
  ['bahrain', 'Bahrain International Circuit', 'Bahrain', 26.0325, 50.5106],
  ['losail', 'Lusail International Circuit', 'Qatar', 25.49, 51.4542, ['Losail']],
  ['jeddah', 'Jeddah Corniche Circuit', 'Saudi Arabia', 21.6319, 39.1044],
  ['baku', 'Baku City Circuit', 'Azerbaijan', 40.3725, 49.8533],
  ['interlagos', 'Interlagos', 'Brazil', -23.7036, -46.6997, ['José Carlos Pace', 'Sao Paulo']],
  ['mexico-city', 'Autódromo Hermanos Rodríguez', 'Mexico', 19.4042, -99.0907],
  ['cota', 'Circuit of the Americas', 'United States', 30.1328, -97.6411, ['COTA', 'Austin', 'USA']],
  ['laguna-seca', 'WeatherTech Raceway Laguna Seca', 'United States', 36.5843, -121.7535, ['USA', 'Monterey']],
  ['road-america', 'Road America', 'United States', 43.7974, -87.9894, ['USA', 'Elkhart Lake']],
  ['watkins-glen', 'Watkins Glen', 'United States', 42.3369, -76.9272, ['USA']],
  ['montreal', 'Circuit Gilles Villeneuve', 'Canada', 45.5, -73.5228, ['Montreal']],
  ['kyalami', 'Kyalami', 'South Africa', -25.9989, 28.0697],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function query(lat, lng) {
  const b = [lat - BOX, lng - BOX * 1.2, lat + BOX, lng + BOX * 1.2].map((v) => v.toFixed(4)).join(',');
  return `[out:json][timeout:90];(way["highway"="raceway"](${b});relation["type"="circuit"](${b}););out tags geom;`;
}

async function overpass(q) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const server = SERVERS[attempt % SERVERS.length];
    try {
      const res = await fetch(server, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(75_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} from ${new URL(server).host}`);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      await sleep(4000 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Overpass elements → [{coords, oneway, tags}]; a type=circuit relation, when present, wins. */
export function waysFrom(json) {
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const toWay = (g, tags) => ({ coords: g.map((p) => [p.lon, p.lat]), oneway: tags?.oneway === 'yes', tags: tags ?? {} });
  const circuit = elements.find((e) => e.type === 'relation' && Array.isArray(e.members));
  if (circuit) {
    const members = circuit.members.filter((m) => m.type === 'way' && Array.isArray(m.geometry) && !/pit/i.test(m.role ?? ''));
    if (members.length) return members.map((m) => toWay(m.geometry, { role: m.role ?? '' }));
  }
  return elements.filter((e) => e.type === 'way' && Array.isArray(e.geometry)).map((e) => toWay(e.geometry, e.tags));
}

/** Write the catalogue (sorted) and return its tracks. */
async function save(byId) {
  const tracks = [...byId.values()].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL)', tracks })}\n`);
  return tracks;
}

async function main() {
  const only = process.argv[2]?.toLowerCase();
  let previous = { tracks: [] };
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  const byId = new Map((previous.tracks ?? []).map((t) => [t.id, t]));
  const list = only ? CIRCUITS.filter(([id]) => id.includes(only)) : CIRCUITS;
  let built = 0;
  let kept = 0;
  for (const [id, name, country, lat, lng, aka = []] of list) {
    try {
      const track = buildCircuit({ id, name, country, aka }, waysFrom(await overpass(query(lat, lng))));
      if (track) {
        byId.set(track.id, track);
        built++;
        process.stdout.write(`ok    ${name} (${(track.length / 1000).toFixed(2)} km)\n`);
        await save(byId); // keep progress even if the run is cut short
      } else {
        kept += byId.has(`osm:${id}`) ? 1 : 0;
        process.stdout.write(`none  ${name}: no closed lap in the map data\n`);
      }
    } catch (err) {
      kept += byId.has(`osm:${id}`) ? 1 : 0;
      process.stdout.write(`fail  ${name}: ${err.message}\n`);
    }
    await sleep(PAUSE_MS);
  }
  const tracks = await save(byId);
  process.stdout.write(`\n${tracks.length} tracks saved (${built} rebuilt, ${kept} kept from last time).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  });
}
